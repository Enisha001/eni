"""
TTS Server - Persistent server for fast TTS inference with GPU acceleration
Keeps models loaded in memory to avoid repeated loading overhead
"""
import sys
import json
import logging
from pathlib import Path
from flask import Flask, request, jsonify, send_file
from TTS.api import TTS
import tempfile
import os
import torch
import threading

# Agree to Coqui TOS
os.environ["COQUI_TOS_AGREED"] = "1"

# Configure logging
logging.basicConfig(level=logging.INFO, format='[TTS SERVER] %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Global model cache and lock
models = {}
model_lock = threading.Lock()
temp_dir = tempfile.gettempdir()

# @group BusinessLogic > VoiceCloning : Precomputed XTTS conditioning latents cache
# Keyed by "model_name::speaker_wav_path" — eliminates per-request speaker encoding overhead
voice_latents_cache = {}

# Set ANTARMAN_SPEAKER_WAV to a WAV path to warm up that voice on server startup
DEFAULT_SPEAKER_WAV = os.environ.get('ANTARMAN_SPEAKER_WAV', '').strip()

# Check for GPU availability
USE_GPU = torch.cuda.is_available()
if USE_GPU:
    logger.info(f'GPU ENABLED: {torch.cuda.get_device_name(0)}')
    logger.info(f'GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.2f} GB')
else:
    logger.info('GPU NOT AVAILABLE - Using CPU')

def get_model(model_name):
    '''Get or load a TTS model (cached)'''
    with model_lock:
        if model_name not in models:
            logger.info(f'Loading model: {model_name}')
            start = __import__('time').time()

            # Load model with GPU support if available
            try:
                tts = TTS(model_name=model_name, gpu=USE_GPU)
                models[model_name] = tts
                elapsed = __import__('time').time() - start
                device = 'GPU' if USE_GPU else 'CPU'
                logger.info(f'Model loaded in {elapsed:.2f}s on {device}')
            except Exception as e:
                logger.error(f'Error loading model {model_name}: {e}')
                raise e
        return models[model_name]

# @group BusinessLogic > TextChunking : Split text into sentence-sized chunks for pipelined synthesis
def split_into_chunks(text: str, max_chars: int = 200) -> list[str]:
    '''Split text at sentence boundaries, keeping each chunk under max_chars.
    Falls back to comma/clause splits if a single sentence is still too long.
    Short fragments (< 40 chars) are merged into adjacent chunks — tiny phrases
    like "Hi!" or "Got it." sound unnatural when synthesised in isolation.'''
    import re
    MIN_CHUNK = 40
    # Split on sentence-ending punctuation followed by whitespace or end-of-string
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    chunks = []
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) <= max_chars:
            chunks.append(sentence)
        else:
            # Sub-split on commas / semicolons if sentence is too long
            sub_parts = re.split(r'(?<=[,;])\s+', sentence)
            current = ''
            for part in sub_parts:
                if not current:
                    current = part
                elif len(current) + 1 + len(part) <= max_chars:
                    current += ' ' + part
                else:
                    chunks.append(current.strip())
                    current = part
            if current.strip():
                chunks.append(current.strip())

    # Post-process: merge tiny fragments into adjacent chunks so we never
    # synthesise isolated short phrases that degrade voice quality.
    if len(chunks) > 1:
        merged = [chunks[0]]
        for chunk in chunks[1:]:
            if len(merged[-1]) < MIN_CHUNK or len(chunk) < MIN_CHUNK:
                merged[-1] = merged[-1] + ' ' + chunk
            else:
                merged.append(chunk)
        chunks = merged

    return chunks if chunks else [text.strip()]


@app.route('/health', methods=['GET'])
def health():
    '''Health check endpoint'''
    return jsonify({
        'status': 'ok',
        'loaded_models': list(models.keys()),
        'cached_voices': list(voice_latents_cache.keys()),
        'gpu_available': USE_GPU,
        'gpu_name': torch.cuda.get_device_name(0) if USE_GPU else None
    })

@app.route('/synthesize', methods=['POST'])
def synthesize():
    '''Synthesize speech from text'''
    try:
        data = request.json
        text = data.get('text')
        model_name = data.get('model_name', 'tts_models/en/jenny/jenny')
        speaker_wav = data.get('speaker_wav')
        language = data.get('language', 'en')

        if not text:
            return jsonify({'error': 'Missing text parameter'}), 400

        logger.info(f'Synthesizing: {len(text)} chars, model: {model_name}, GPU: {USE_GPU}')

        # Get cached model
        tts = get_model(model_name)

        # Generate unique output file with random component to avoid collisions
        import uuid
        output_filename = f'antarman_tts_{uuid.uuid4().hex}.wav'
        output_path = os.path.join(temp_dir, output_filename)

        start = __import__('time').time()

        # Lock during synthesis to prevent concurrent model access and OOM
        with model_lock:
            synthesis_error = None
            try:
                if speaker_wav and 'xtts' in model_name.lower():
                    # @group BusinessLogic > VoiceCloning : Use cached conditioning latents — no per-request speaker encoding
                    cache_key = f"{model_name}::{speaker_wav}"
                    if cache_key not in voice_latents_cache:
                        logger.info(f'Computing voice latents (first time) for: {speaker_wav}')
                        xtts_model = tts.synthesizer.tts_model
                        gpt_cond_latent, speaker_embedding = xtts_model.get_conditioning_latents(
                            audio_path=[speaker_wav]
                        )
                        voice_latents_cache[cache_key] = (gpt_cond_latent, speaker_embedding)
                        logger.info('Voice latents computed and cached')
                    else:
                        logger.info('Using cached voice latents (ready state)')

                    gpt_cond_latent, speaker_embedding = voice_latents_cache[cache_key]
                    xtts_model = tts.synthesizer.tts_model
                    out = xtts_model.inference(
                        text=text,
                        language=language,
                        gpt_cond_latent=gpt_cond_latent,
                        speaker_embedding=speaker_embedding,
                    )
                    import soundfile as sf
                    sf.write(output_path, out['wav'], xtts_model.config.audio.sample_rate)
                else:
                    # Standard TTS (Jenny or other non-XTTS model)
                    tts.tts_to_file(text=text, file_path=output_path)
            except RuntimeError as e:
                # XTTS failure — fallback to Jenny
                if speaker_wav:
                    synthesis_error = str(e)
                    logger.warning(f'XTTS voice cloning failed: {synthesis_error}')
                    logger.warning('Falling back to Jenny model (fast mode without voice cloning)')
                    jenny_tts = models.get('tts_models/en/jenny/jenny')
                    if jenny_tts is None:
                        jenny_tts = TTS(model_name='tts_models/en/jenny/jenny', gpu=USE_GPU)
                        models['tts_models/en/jenny/jenny'] = jenny_tts
                    jenny_tts.tts_to_file(text=text, file_path=output_path)
                    logger.info('Fallback synthesis with Jenny completed successfully')
                else:
                    raise

        elapsed = __import__('time').time() - start
        file_size = os.path.getsize(output_path)

        if synthesis_error:
            logger.info(f'Fallback synthesis completed in {elapsed:.2f}s, file size: {file_size} bytes')
        else:
            logger.info(f'Synthesis completed in {elapsed:.2f}s, file size: {file_size} bytes')

        return jsonify({
            'audio_path': output_path,
            'synthesis_time': elapsed,
            'file_size': file_size,
            'used_gpu': USE_GPU,
            'fallback_used': synthesis_error is not None,
            'original_error': synthesis_error
        })

    except Exception as e:
        logger.error(f'Synthesis error: {str(e)}')
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/synthesize-chunked', methods=['POST'])
def synthesize_chunked():
    '''Split text at sentence boundaries and synthesize each chunk independently.
    Returns an ordered list of audio_path entries so the client can pipeline
    playback of chunk N while chunk N+1 is still being generated.

    This is the key optimization for long texts: a 175-char response synthesizes
    as three ~60-char chunks (~4-5s each) instead of one 13.5s monolith, and the
    first chunk is playable within ~4s regardless of total response length.'''
    try:
        data = request.json
        text = data.get('text', '').strip()
        model_name = data.get('model_name', 'tts_models/multilingual/multi-dataset/xtts_v2')
        speaker_wav = data.get('speaker_wav')
        language = data.get('language', 'en')
        max_chunk_chars = int(data.get('max_chunk_chars', 100))

        if not text:
            return jsonify({'error': 'Missing text parameter'}), 400

        chunks = split_into_chunks(text, max_chars=max_chunk_chars)
        logger.info(f'Chunked {len(text)} chars into {len(chunks)} segments: {[len(c) for c in chunks]}')

        tts = get_model(model_name)
        results = []

        for idx, chunk in enumerate(chunks):
            import uuid
            output_path = os.path.join(temp_dir, f'antarman_tts_{uuid.uuid4().hex}.wav')
            start = __import__('time').time()

            with model_lock:
                if speaker_wav and 'xtts' in model_name.lower():
                    cache_key = f"{model_name}::{speaker_wav}"
                    if cache_key not in voice_latents_cache:
                        logger.info(f'Computing voice latents for: {speaker_wav}')
                        xtts_model = tts.synthesizer.tts_model
                        gpt_cond_latent, speaker_embedding = xtts_model.get_conditioning_latents(
                            audio_path=[speaker_wav]
                        )
                        voice_latents_cache[cache_key] = (gpt_cond_latent, speaker_embedding)

                    gpt_cond_latent, speaker_embedding = voice_latents_cache[cache_key]
                    xtts_model = tts.synthesizer.tts_model
                    out = xtts_model.inference(
                        text=chunk,
                        language=language,
                        gpt_cond_latent=gpt_cond_latent,
                        speaker_embedding=speaker_embedding,
                    )
                    import soundfile as sf
                    sf.write(output_path, out['wav'], xtts_model.config.audio.sample_rate)
                else:
                    tts.tts_to_file(text=chunk, file_path=output_path)

            elapsed = __import__('time').time() - start
            file_size = os.path.getsize(output_path)
            logger.info(f'Chunk {idx+1}/{len(chunks)} ({len(chunk)} chars) done in {elapsed:.2f}s')
            results.append({
                'audio_path': output_path,
                'chunk_index': idx,
                'chunk_text': chunk,
                'synthesis_time': elapsed,
                'file_size': file_size,
            })

        total_time = sum(r['synthesis_time'] for r in results)
        logger.info(f'All {len(chunks)} chunks done. Total synth time: {total_time:.2f}s')
        return jsonify({'chunks': results, 'total_synthesis_time': total_time, 'used_gpu': USE_GPU})

    except Exception as e:
        logger.error(f'Chunked synthesis error: {str(e)}')
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500

@app.route('/preload', methods=['POST'])
def preload():
    '''Preload a model into memory'''
    try:
        data = request.json
        model_name = data.get('model_name')

        if not model_name:
            return jsonify({'error': 'Missing model_name parameter'}), 400

        get_model(model_name)
        return jsonify({'status': 'loaded', 'model': model_name, 'gpu': USE_GPU})

    except Exception as e:
        logger.error(f'Preload error: {str(e)}')
        return jsonify({'error': str(e)}), 500

@app.route('/set-voice', methods=['POST'])
def set_voice():
    '''Precompute and cache XTTS conditioning latents for a speaker WAV.
    Call once after startup (or when the voice sample changes) to put the
    custom voice in ready state — subsequent /synthesize calls skip speaker
    encoding entirely and go straight to inference.'''
    try:
        data = request.json
        speaker_wav = data.get('speaker_wav', '').strip()
        model_name = data.get('model_name', 'tts_models/multilingual/multi-dataset/xtts_v2')

        if not speaker_wav:
            return jsonify({'error': 'Missing speaker_wav parameter'}), 400
        if not os.path.exists(speaker_wav):
            return jsonify({'error': f'Speaker WAV not found: {speaker_wav}'}), 404

        tts = get_model(model_name)

        cache_key = f"{model_name}::{speaker_wav}"
        with model_lock:
            if cache_key not in voice_latents_cache:
                logger.info(f'Precomputing voice latents for: {speaker_wav}')
                start = __import__('time').time()
                xtts_model = tts.synthesizer.tts_model
                gpt_cond_latent, speaker_embedding = xtts_model.get_conditioning_latents(
                    audio_path=[speaker_wav]
                )
                voice_latents_cache[cache_key] = (gpt_cond_latent, speaker_embedding)
                elapsed = __import__('time').time() - start
                logger.info(f'Voice ready — latents cached in {elapsed:.2f}s')
                return jsonify({
                    'status': 'ready',
                    'model': model_name,
                    'speaker_wav': speaker_wav,
                    'latent_compute_time': elapsed,
                    'was_cached': False
                })
            else:
                logger.info(f'Voice latents already cached for: {speaker_wav}')
                return jsonify({
                    'status': 'ready',
                    'model': model_name,
                    'speaker_wav': speaker_wav,
                    'latent_compute_time': 0,
                    'was_cached': True
                })

    except Exception as e:
        logger.error(f'Set-voice error: {str(e)}')
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


def cleanup_old_temp_files():
    '''Clean up temporary TTS files older than 1 hour'''
    try:
        import time
        current_time = time.time()
        cleanup_count = 0

        for filename in os.listdir(temp_dir):
            if filename.startswith('antarman_tts_') and filename.endswith('.wav'):
                file_path = os.path.join(temp_dir, filename)
                try:
                    file_age = current_time - os.path.getmtime(file_path)
                    # Delete files older than 1 hour (3600 seconds)
                    if file_age > 3600:
                        os.remove(file_path)
                        cleanup_count += 1
                except Exception as e:
                    logger.warning(f'Failed to delete temp file {filename}: {e}')

        if cleanup_count > 0:
            logger.info(f'Cleaned up {cleanup_count} old temporary audio files')
    except Exception as e:
        logger.warning(f'Temp file cleanup failed: {e}')

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5050

    logger.info('=' * 60)
    logger.info('Starting TTS Server with GPU Acceleration')
    logger.info(f'Port: {port}')
    logger.info(f'GPU Enabled: {USE_GPU}')
    if USE_GPU:
        logger.info(f'GPU Device: {torch.cuda.get_device_name(0)}')
    logger.info('=' * 60)

    # Clean up old temporary files on startup
    cleanup_old_temp_files()

    # Start server first, then preload model in background
    import threading
    def preload_model():
        # Preload XTTS v2 first — this is the voice cloning model and takes ~35s cold start.
        # Loading it now means the first user message won't stall waiting for it.
        xtts_model_name = 'tts_models/multilingual/multi-dataset/xtts_v2'
        try:
            logger.info('Preloading XTTS v2 model (voice cloning)...')
            tts = get_model(xtts_model_name)
            logger.info('XTTS v2 model loaded and ready!')

            # Precompute latents for the default speaker WAV so the very first
            # synthesis request is already in ready state (no speaker encoding delay)
            if DEFAULT_SPEAKER_WAV and os.path.exists(DEFAULT_SPEAKER_WAV):
                logger.info(f'Precomputing voice latents for default speaker: {DEFAULT_SPEAKER_WAV}')
                cache_key = f"{xtts_model_name}::{DEFAULT_SPEAKER_WAV}"
                with model_lock:
                    xtts = tts.synthesizer.tts_model
                    gpt_cond_latent, speaker_embedding = xtts.get_conditioning_latents(
                        audio_path=[DEFAULT_SPEAKER_WAV]
                    )
                    voice_latents_cache[cache_key] = (gpt_cond_latent, speaker_embedding)
                logger.info('Default voice latents ready — custom voice in ready state!')
            elif DEFAULT_SPEAKER_WAV:
                logger.warning(f'ANTARMAN_SPEAKER_WAV set but file not found: {DEFAULT_SPEAKER_WAV}')
        except Exception as e:
            logger.warning(f'Could not preload XTTS v2 model: {e}')
        try:
            logger.info('Preloading Jenny model (fast fallback)...')
            get_model('tts_models/en/jenny/jenny')
            logger.info('Jenny model loaded and ready!')
        except Exception as e:
            logger.warning(f'Could not preload Jenny model: {e}')

    # Preload in background thread so server can respond to health checks immediately
    threading.Thread(target=preload_model, daemon=True).start()

    # Use waitress for production-grade concurrent request handling
    try:
        from waitress import serve
        logger.info('Using Waitress WSGI server for better concurrency')
        serve(app, host='127.0.0.1', port=port, threads=8)
    except ImportError:
        logger.warning('Waitress not found, using Flask dev server (limited concurrency)')
        logger.warning('Install waitress for better performance: pip install waitress')
        app.run(host='127.0.0.1', port=port, threaded=True)
