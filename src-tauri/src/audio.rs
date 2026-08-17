use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{WavSpec, WavWriter};
use rodio::{Decoder, OutputStream, Sink};
use std::io::BufReader;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}};
use std::path::PathBuf;
use anyhow::Result;
use std::thread;

// @group Recording : Global recording state
static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static STOP_SIGNAL: AtomicBool = AtomicBool::new(false);

// @group VAD : Voice Activity Detection state
static VAD_ENABLED: AtomicBool = AtomicBool::new(false);
// Silence duration in milliseconds before auto-stop (default 1500ms)
static VAD_SILENCE_MS: AtomicU64 = AtomicU64::new(1500);
// @group VAD : Last computed RMS energy level (stored as f32 bits) for live level meter
static LAST_RMS: AtomicU64 = AtomicU64::new(0);

/// Public API to toggle VAD and configure silence threshold.
pub fn set_vad_enabled(enabled: bool, silence_ms: u64) {
    VAD_SILENCE_MS.store(silence_ms, Ordering::Relaxed);
    VAD_ENABLED.store(enabled, Ordering::Relaxed);
}

/// Returns the most recently computed RMS audio level (0.0 – 1.0 range).
pub fn get_audio_level() -> f32 {
    f32::from_bits(LAST_RMS.load(Ordering::Relaxed) as u32)
}

// @group AudioPlayback : Shared sink handle so stop_audio() can interrupt play_audio_file()
lazy_static::lazy_static! {
    static ref RECORDING_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
    static ref CURRENT_SINK: Mutex<Option<Arc<Sink>>> = Mutex::new(None);
}

pub struct AudioRecorder;

impl AudioRecorder {
    pub fn new() -> Self {
        Self
    }

    pub fn start_recording(&self, output_path: PathBuf) -> Result<()> {
        // Use compare_exchange to atomically check and set - prevents race condition
        if IS_RECORDING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return Err(anyhow::anyhow!("Already recording"));
        }

        // Reset stop signal
        STOP_SIGNAL.store(false, Ordering::SeqCst);

        // Set recording path with proper error handling
        match RECORDING_PATH.lock() {
            Ok(mut guard) => *guard = Some(output_path.clone()),
            Err(_) => {
                IS_RECORDING.store(false, Ordering::SeqCst);
                return Err(anyhow::anyhow!("Failed to acquire recording path lock"));
            }
        }

        let path = output_path.clone();
        
        // Spawn recording thread
        thread::spawn(move || {
            if let Err(e) = record_audio_sync(&path) {
                eprintln!("Recording error: {}", e);
            }
            IS_RECORDING.store(false, Ordering::SeqCst);
        });

        Ok(())
    }

    pub fn stop_recording(&self) -> Result<PathBuf> {
        if !IS_RECORDING.load(Ordering::SeqCst) {
            return Err(anyhow::anyhow!("Not currently recording"));
        }

        // Signal to stop
        STOP_SIGNAL.store(true, Ordering::SeqCst);

        // Wait for recording to stop (with timeout)
        for _ in 0..50 {
            if !IS_RECORDING.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(100));
        }

        let path = RECORDING_PATH.lock()
            .map_err(|_| anyhow::anyhow!("Failed to acquire recording path lock"))?
            .take()
            .ok_or_else(|| anyhow::anyhow!("No recording path"))?;

        Ok(path)
    }

    pub fn is_recording(&self) -> bool {
        IS_RECORDING.load(Ordering::SeqCst)
    }
}

fn record_audio_sync(output_path: &PathBuf) -> Result<()> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| anyhow::anyhow!("No input device available"))?;

    let config = device.default_input_config()?;

    let spec = WavSpec {
        channels: config.channels(),
        sample_rate: config.sample_rate().0,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let writer = WavWriter::create(output_path, spec)?;
    let writer = Arc::new(Mutex::new(writer));
    let writer_clone = writer.clone();

    // @group VAD : Shared last-loud-time so the polling loop can trigger auto-stop
    let last_loud_ms: Arc<AtomicU64> = Arc::new(AtomicU64::new(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    ));
    let last_loud_clone = Arc::clone(&last_loud_ms);

    let err_fn = |err| eprintln!("An error occurred on stream: {}", err);

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &_| {
                if let Ok(mut writer) = writer_clone.lock() {
                    // @group VAD : Compute RMS energy — always stored for the level meter, used for auto-stop when VAD is on
                    if !data.is_empty() {
                        let rms = (data.iter().map(|&s| (s * s) as f64).sum::<f64>() / data.len() as f64).sqrt() as f32;
                        LAST_RMS.store(rms.to_bits() as u64, Ordering::Relaxed);
                        if VAD_ENABLED.load(Ordering::Relaxed) && rms > 0.01 {
                            let now_ms = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;
                            last_loud_clone.store(now_ms, Ordering::Relaxed);
                        }
                    }
                    for &sample in data {
                        let amplitude = (sample * i16::MAX as f32) as i16;
                        let _ = writer.write_sample(amplitude);
                    }
                } else {
                    eprintln!("Failed to acquire writer lock in audio callback");
                }
            },
            err_fn,
            None,
        )?,
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _: &_| {
                if let Ok(mut writer) = writer_clone.lock() {
                    for &sample in data {
                        let _ = writer.write_sample(sample);
                    }
                } else {
                    eprintln!("Failed to acquire writer lock in audio callback");
                }
            },
            err_fn,
            None,
        )?,
        _ => return Err(anyhow::anyhow!("Unsupported sample format")),
    };

    stream.play()?;

    // Wait for stop signal (manual) or VAD silence timeout
    loop {
        if STOP_SIGNAL.load(Ordering::SeqCst) {
            break;
        }
        if VAD_ENABLED.load(Ordering::Relaxed) {
            let silence_ms = VAD_SILENCE_MS.load(Ordering::Relaxed);
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let last = last_loud_ms.load(Ordering::Relaxed);
            if now_ms.saturating_sub(last) > silence_ms {
                // Silence threshold exceeded — auto-stop
                STOP_SIGNAL.store(true, Ordering::SeqCst);
                break;
            }
        }
        thread::sleep(std::time::Duration::from_millis(50));
    }

    // Stop and finalize
    drop(stream);
    
    // Finalize the WAV file
    let writer = Arc::try_unwrap(writer)
        .map_err(|_| anyhow::anyhow!("Could not finalize writer - multiple references exist"))?
        .into_inner()
        .map_err(|_| anyhow::anyhow!("Failed to finalize writer - mutex poisoned"))?;
    writer.finalize()?;

    Ok(())
}

// @group AudioPlayback : Play a WAV file using rodio — no per-sentence process spawn overhead.
// OutputStream must stay alive on the same thread for the duration of playback (rodio requirement).
// Arc<Sink> is stored in CURRENT_SINK so stop_audio() can interrupt from another thread.
pub fn play_audio_file(path: &str) -> Result<()> {
    let start_time = std::time::Instant::now();
    eprintln!("\n[AUDIO] ========== Starting audio playback ==========");

    if !std::path::Path::new(path).exists() {
        return Err(anyhow::anyhow!("Audio file not found: {}", path));
    }
    if let Ok(meta) = std::fs::metadata(path) {
        eprintln!("[AUDIO] File size: {} bytes", meta.len());
    }

    // Stop any currently playing audio before starting new playback
    {
        let mut guard = CURRENT_SINK.lock().unwrap();
        if let Some(old) = guard.take() {
            old.stop();
        }
    }

    // OutputStream must live on this thread — create locally (not in a global)
    let (_stream, stream_handle) = OutputStream::try_default()
        .map_err(|e| anyhow::anyhow!("Audio output init failed: {}", e))?;

    let sink = Arc::new(
        Sink::try_new(&stream_handle)
            .map_err(|e| anyhow::anyhow!("Audio sink init failed: {}", e))?
    );
    // Keep a copy of the raw pointer so we can check ownership at cleanup
    let sink_id = Arc::as_ptr(&sink) as usize;

    // Publish sink so stop_audio() can reach it
    {
        let mut guard = CURRENT_SINK.lock().unwrap();
        *guard = Some(Arc::clone(&sink));
    }

    let file = std::fs::File::open(path)?;
    let source = Decoder::new(BufReader::new(file))
        .map_err(|e| anyhow::anyhow!("Audio decode failed: {}", e))?;

    sink.append(source);
    eprintln!("[AUDIO] Playback started in {:?}", start_time.elapsed());

    // Block this thread until the clip finishes or stop_audio() calls sink.stop()
    sink.sleep_until_end();

    // Clear the global only if it still holds our own sink (guards against a racing new call)
    {
        let mut guard = CURRENT_SINK.lock().unwrap();
        if let Some(ref s) = *guard {
            if Arc::as_ptr(s) as usize == sink_id {
                *guard = None;
            }
        }
    }

    eprintln!("[AUDIO] ========== Playback complete: {:?} ==========\n", start_time.elapsed());
    Ok(())
}

// @group AudioPlayback : Interrupt any in-progress playback immediately
pub fn stop_audio() -> Result<()> {
    eprintln!("[AUDIO] Stopping audio playback...");
    let mut guard = CURRENT_SINK.lock().unwrap();
    if let Some(sink) = guard.take() {
        sink.stop();
        eprintln!("[AUDIO] Sink stopped");
    }
    Ok(())
}
