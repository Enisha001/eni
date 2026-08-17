use anyhow::Result;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TTSResult {
    pub audio_path: String,
    /// Extra audio paths when the text was chunked (chunk 0 = audio_path, chunks 1..N here)
    #[serde(default)]
    pub audio_chunks: Vec<String>,
}

#[derive(serde::Deserialize)]
struct TTSServerResponse {
    audio_path: String,
    #[allow(dead_code)]
    synthesis_time: f64,
    #[allow(dead_code)]
    file_size: usize,
}

#[derive(serde::Deserialize)]
struct TTSChunkEntry {
    audio_path: String,
}

#[derive(serde::Deserialize)]
struct TTSChunkedResponse {
    chunks: Vec<TTSChunkEntry>,
}

// Global TTS server state
static TTS_SERVER_STARTED: AtomicBool = AtomicBool::new(false);
// Monotonic counter for unique Kokoro temp filenames (avoids subsec_nanos collision on parallel synthesis)
static KOKORO_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);
const TTS_SERVER_PORT: u16 = 5050;

/// Warm up / start the TTS server (non-blocking call sites should spawn this).
pub async fn warmup_tts_server() -> Result<()> {
    ensure_tts_server().await
}

/// Start the TTS server if not already running
async fn ensure_tts_server() -> Result<()> {
    // Check if already started - skip health check if recently verified
    if TTS_SERVER_STARTED.load(Ordering::Relaxed) {
        // Server already marked as started, assume it's still running
        // (health checks will be done on actual requests if they fail)
        return Ok(());
    }

    // Try to set the started flag
    if TTS_SERVER_STARTED.compare_exchange(false, true, Ordering::SeqCst, Ordering::Relaxed).is_err() {
        // Another thread is starting the server, wait a bit
        tokio::time::sleep(Duration::from_millis(500)).await;
        return Ok(());
    }

    // Start new server
    eprintln!("[TTS SERVER] Starting TTS server on port {}...", TTS_SERVER_PORT);
    let python_path = get_python_path()?;
    let server_script = get_tts_server_script_path()?;

    Command::new(&python_path)
        .arg(&server_script)
        .arg(TTS_SERVER_PORT.to_string())
        .env("COQUI_TOS_AGREED", "1")
        .stdout(Stdio::inherit())  // Show stdout for debugging
        .stderr(Stdio::inherit())  // Show stderr for debugging
        .spawn()?;

    // Wait for server to be ready (using async sleep)
    eprintln!("[TTS SERVER] Waiting for server to be ready...");
    for i in 0..60 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if is_server_responsive().await {
            eprintln!("[TTS SERVER] Server ready after {}ms", i * 500);
            return Ok(());
        }
    }

    TTS_SERVER_STARTED.store(false, Ordering::Relaxed);
    Err(anyhow::anyhow!("TTS server failed to start within 30 seconds"))
}

/// Check if TTS server is responsive
async fn is_server_responsive() -> bool {
    let url = format!("http://127.0.0.1:{}/health", TTS_SERVER_PORT);
    match reqwest::Client::new()
        .get(&url)
        .timeout(Duration::from_secs(2))
        .send()
        .await
    {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

/// Get Python executable path
fn get_python_path() -> Result<String> {
    // Try multiple possible locations for the venv
    let possible_paths = vec![
        ".venv-tts/Scripts/python.exe",
        "../.venv-tts/Scripts/python.exe",
        "../../.venv-tts/Scripts/python.exe",
        "../../../.venv-tts/Scripts/python.exe",
        ".venv-tts/bin/python",
        "../.venv-tts/bin/python",
        "../../.venv-tts/bin/python",
        "../../../.venv-tts/bin/python",
    ];

    for venv_path in &possible_paths {
        let path = Path::new(venv_path);
        if path.exists() {
            eprintln!("[TTS SERVER] Found Python at: {}", venv_path);
            return Ok(path.canonicalize()?.to_string_lossy().to_string());
        }
    }

    // Try to find it relative to the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let project_root = exe_dir.join("../../../..");
            let python_path = project_root.join(".venv-tts/Scripts/python.exe");
            if python_path.exists() {
                eprintln!("[TTS SERVER] Found Python relative to exe: {:?}", python_path);
                return Ok(python_path.canonicalize()?.to_string_lossy().to_string());
            }
        }
    }

    eprintln!("[TTS SERVER] Using system Python (venv not found)");
    Ok("python".to_string())
}

/// Get TTS server script path
fn get_tts_server_script_path() -> Result<String> {
    // Priority 1: Check scripts/ directory (committed to repo)
    let repo_paths = vec![
        "scripts/tts_server.py",
        "../scripts/tts_server.py",
        "../../scripts/tts_server.py",
        "../../../scripts/tts_server.py",
    ];

    for script_path in &repo_paths {
        let path = Path::new(script_path);
        if path.exists() {
            eprintln!("[TTS SERVER] Found script at: {}", script_path);
            return Ok(path.canonicalize()?.to_string_lossy().to_string());
        }
    }

    // Priority 2: Check venv Scripts directory (fallback for legacy)
    let venv_paths = vec![
        ".venv-tts/Scripts/tts_server.py",
        "../.venv-tts/Scripts/tts_server.py",
        "../../.venv-tts/Scripts/tts_server.py",
        "../../../.venv-tts/Scripts/tts_server.py",
    ];

    for script_path in &venv_paths {
        let path = Path::new(script_path);
        if path.exists() {
            eprintln!("[TTS SERVER] Found script at: {}", script_path);
            return Ok(path.canonicalize()?.to_string_lossy().to_string());
        }
    }

    // Priority 3: Try to find it relative to the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // Go up from target/debug to project root
            let project_root = exe_dir.join("../../../..");
            
            // Try scripts/ first
            let script_path = project_root.join("scripts/tts_server.py");
            if script_path.exists() {
                eprintln!("[TTS SERVER] Found script relative to exe: {:?}", script_path);
                return Ok(script_path.canonicalize()?.to_string_lossy().to_string());
            }
            
            // Try venv fallback
            let venv_script_path = project_root.join(".venv-tts/Scripts/tts_server.py");
            if venv_script_path.exists() {
                eprintln!("[TTS SERVER] Found script relative to exe: {:?}", venv_script_path);
                return Ok(venv_script_path.canonicalize()?.to_string_lossy().to_string());
            }
        }
    }

    Err(anyhow::anyhow!(
        "TTS server script not found. Tried: {:?} and {:?}\nMake sure scripts/tts_server.py exists in the project root.",
        repo_paths, venv_paths
    ))
}

/// Synthesize speech using TTS with optional voice cloning
///
/// This uses Coqui TTS (https://github.com/coqui-ai/TTS) for text-to-speech
/// with voice cloning capabilities.
///
/// To use this, you need to:
/// 1. Install Coqui TTS: pip install TTS
/// 2. The TTS CLI will be available as 'tts'
pub async fn synthesize_speech(
    text: &str,
    voice_sample_path: Option<&str>,
) -> Result<TTSResult> {
    let start_time = std::time::Instant::now();
    eprintln!("\n[TTS TIMING] ========== Starting TTS synthesis ==========");
    eprintln!("[TTS TIMING] Text length: {} characters", text.len());

    // Ensure TTS server is running
    let setup_start = std::time::Instant::now();
    ensure_tts_server().await?;
    eprintln!("[TTS TIMING] Server check completed in: {:?}", setup_start.elapsed());

    // Determine model to use
    let model_name = if voice_sample_path.is_some() {
        eprintln!("[TTS] Model: XTTS v2 (voice cloning enabled)");
        "tts_models/multilingual/multi-dataset/xtts_v2"
    } else {
        eprintln!("[TTS] Model: Jenny (fast mode)");
        "tts_models/en/jenny/jenny"
    };

    let client = reqwest::Client::new();
    let cmd_start = std::time::Instant::now();

    // @group BusinessLogic > TextChunking : Only chunk texts longer than 250 chars.
    // XTTS v2 handles up to ~250 chars cleanly in one shot; chunking shorter texts adds
    // overhead without benefit because the server synthesises chunks sequentially anyway.
    const CHUNK_THRESHOLD: usize = 250;
    let use_chunked = text.len() > CHUNK_THRESHOLD && voice_sample_path.is_some();

    if use_chunked {
        eprintln!("[TTS] Text > {}chars — using chunked synthesis", CHUNK_THRESHOLD);
        let mut request_body = serde_json::json!({
            "text": text,
            "model_name": model_name,
            "max_chunk_chars": 200,
        });
        if let Some(voice_path) = voice_sample_path {
            eprintln!("[TTS] Using voice cloning with: {}", voice_path);
            request_body["speaker_wav"] = serde_json::json!(voice_path);
            request_body["language"] = serde_json::json!("en");
        }

        let url = format!("http://127.0.0.1:{}/synthesize-chunked", TTS_SERVER_PORT);
        let response = client
            .post(&url)
            .json(&request_body)
            .timeout(Duration::from_secs(180))
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(anyhow::anyhow!("TTS server error: {}", error_text));
        }

        let chunked: TTSChunkedResponse = response.json().await?;
        eprintln!("[TTS TIMING] Chunked synthesis took: {:?} ({} chunks)", cmd_start.elapsed(), chunked.chunks.len());

        let mut paths: Vec<String> = chunked.chunks.into_iter().map(|c| c.audio_path).collect();
        if paths.is_empty() {
            return Err(anyhow::anyhow!("TTS server returned no chunks"));
        }
        let first = paths.remove(0);
        eprintln!("[TTS TIMING] ========== TOTAL TTS TIME: {:?} ==========\n", start_time.elapsed());
        return Ok(TTSResult { audio_path: first, audio_chunks: paths });
    }

    // Single-shot synthesis for short texts
    let mut request_body = serde_json::json!({
        "text": text,
        "model_name": model_name,
    });
    if let Some(voice_path) = voice_sample_path {
        eprintln!("[TTS] Using voice cloning with: {}", voice_path);
        request_body["speaker_wav"] = serde_json::json!(voice_path);
        request_body["language"] = serde_json::json!("en");
    }

    eprintln!("[TTS] Sending request to TTS server...");
    let url = format!("http://127.0.0.1:{}/synthesize", TTS_SERVER_PORT);
    let response = client
        .post(&url)
        .json(&request_body)
        .timeout(Duration::from_secs(120))
        .send()
        .await?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(anyhow::anyhow!("TTS server error: {}", error_text));
    }

    let server_response: TTSServerResponse = response.json().await?;
    eprintln!("[TTS TIMING] TTS server synthesis took: {:?}", cmd_start.elapsed());

    let output_path = server_response.audio_path;
    eprintln!("[TTS] Success! Audio saved to: {}", output_path);

    let verify_start = std::time::Instant::now();
    if !Path::new(&output_path).exists() {
        return Err(anyhow::anyhow!("TTS output file not created"));
    }
    if let Ok(metadata) = std::fs::metadata(&output_path) {
        eprintln!("[TTS TIMING] Output file size: {} bytes", metadata.len());
    }
    eprintln!("[TTS TIMING] File verification took: {:?}", verify_start.elapsed());
    eprintln!("[TTS TIMING] ========== TOTAL TTS TIME: {:?} ==========\n", start_time.elapsed());

    Ok(TTSResult {
        audio_path: output_path,
        audio_chunks: vec![],
    })
}

/// Train/store voice sample for cloning
pub async fn train_voice(audio_path: &str) -> Result<String> {
    let path = Path::new(audio_path);
    if !path.exists() {
        return Err(anyhow::anyhow!("Audio file not found: {}", audio_path));
    }

    // Copy the voice sample to a persistent location
    let voice_dir = get_voice_samples_dir()?;
    std::fs::create_dir_all(&voice_dir)?;

    let voice_sample_path = voice_dir.join("user_voice.wav");

    // Always convert to 24000Hz mono WAV for XTTS v2 compatibility
    eprintln!("[TTS] Converting voice sample to 24000Hz mono WAV...");
    let output = Command::new("ffmpeg")
        .arg("-i")
        .arg(audio_path)
        .arg("-ar")
        .arg("24000")
        .arg("-ac")
        .arg("1")
        .arg("-y")
        .arg(&voice_sample_path)
        .output()  // tokio::process::Command::output() is async
        .await?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        eprintln!("[TTS] FFmpeg error: {}", error);
        return Err(anyhow::anyhow!("Failed to convert audio to WAV format: {}", error));
    }

    eprintln!("[TTS] Voice sample saved to: {}", voice_sample_path.display());
    Ok(voice_sample_path.to_string_lossy().to_string())
}

/// Get voice training status
pub fn get_voice_status() -> Result<(bool, Option<String>)> {
    let voice_dir = get_voice_samples_dir()?;
    let voice_sample_path = voice_dir.join("user_voice.wav");

    if voice_sample_path.exists() {
        Ok((true, Some(voice_sample_path.to_string_lossy().to_string())))
    } else {
        Ok((false, None))
    }
}

// @group KokoroTTS : Kokoro TTS via OpenAI-compatible API (Docker on port 8880)

/// Synthesize speech using Kokoro running in Docker.
/// Kokoro exposes a POST /v1/audio/speech endpoint compatible with the OpenAI TTS API.
pub async fn synthesize_with_kokoro(
    text: &str,
    endpoint: &str,
    voice: &str,
) -> Result<TTSResult> {
    let url = format!("{}/v1/audio/speech", endpoint.trim_end_matches('/'));
    eprintln!("[KOKORO] POST {} voice={} text_len={}", url, voice, text.len());

    let body = serde_json::json!({
        "model": "kokoro",
        "input": text,
        "voice": voice,
        "response_format": "mp3"   // wav = 32-bit float which rodio can't decode by default; mp3 is always supported
    });

    let response = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("Kokoro request failed: {e} — is Docker running on {endpoint}?"))?;

    if !response.status().is_success() {
        let status = response.status();
        let err_body = response.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("Kokoro TTS error {status}: {err_body}"));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();
    eprintln!("[KOKORO] Response content-type: {}", content_type);

    let bytes = response.bytes().await?;
    if bytes.is_empty() {
        return Err(anyhow::anyhow!("Kokoro returned empty audio response"));
    }
    // Sanity-check MP3 magic: ID3 tag (49 44 33) or sync word (FF Fx / FF Ex)
    if bytes.len() >= 3 {
        let ok = &bytes[..3] == b"ID3"
            || (bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0);
        if !ok {
            eprintln!("[KOKORO] WARNING: unexpected MP3 header {:?}. Content-type was: {}", &bytes[..3], content_type);
        } else {
            eprintln!("[KOKORO] MP3 header OK");
        }
    }

    // Unique filename via monotonic counter — avoids collision when sentences are synthesised in parallel
    let n = KOKORO_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let filename = format!("antarman_kokoro_{}.mp3", n);
    let output_path = std::env::temp_dir().join(filename);
    std::fs::write(&output_path, &bytes)?;

    eprintln!("[KOKORO] Saved {} bytes to {:?}", bytes.len(), output_path);

    Ok(TTSResult {
        audio_path: output_path.to_string_lossy().to_string(),
        audio_chunks: vec![],
    })
}
fn get_voice_samples_dir() -> Result<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    Ok(Path::new(&home).join(".antarman").join("voices"))
}
