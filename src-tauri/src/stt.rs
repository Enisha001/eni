use anyhow::Result;
use std::path::Path;
use tokio::process::Command;

#[derive(serde::Deserialize, serde::Serialize)]
pub struct TranscriptionResult {
    pub text: String,
}

/// Transcribe audio using Whisper
///
/// This function expects whisper.cpp to be installed and available in the system
/// You can install it from: https://github.com/ggerganov/whisper.cpp
///
/// For local inference, we'll use whisper.cpp CLI
pub async fn transcribe_audio(audio_path: &str) -> Result<TranscriptionResult> {
    let path = Path::new(audio_path);
    if !path.exists() {
        return Err(anyhow::anyhow!("Audio file not found: {}", audio_path));
    }

    // Try to use whisper.cpp if available
    // First, check if whisper executable exists
    let whisper_path = get_whisper_path()?;

    // Use platform-appropriate temp directory
    let temp_dir = std::env::temp_dir();
    let output_base = temp_dir.join("whisper_output");
    let output_base_str = output_base.to_string_lossy().to_string();
    let output_txt = temp_dir.join("whisper_output.txt");
    let _ = std::fs::remove_file(&output_txt);

    let output = Command::new(&whisper_path)
        .arg("-m")
        .arg(get_model_path()?)
        .arg("-f")
        .arg(audio_path)
        .arg("-otxt")
        .arg("-of")
        .arg(&output_base_str)
        .output()  // tokio::process::Command::output() is async
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let mut details = format!("exit status: {}", output.status);
        if !stderr.is_empty() {
            details.push_str(&format!("\nstderr: {}", stderr));
        }
        if !stdout.is_empty() {
            details.push_str(&format!("\nstdout: {}", stdout));
        }
        return Err(anyhow::anyhow!("Whisper transcription failed ({})", details));
    }

    // Read the transcription from the output file
    let transcription = std::fs::read_to_string(&output_txt)?;

    Ok(TranscriptionResult {
        text: transcription.trim().to_string(),
    })
}

/// Get the whisper executable path
/// Users should install whisper.cpp and set WHISPER_PATH environment variable
/// or place it in a standard location
pub fn get_whisper_path() -> Result<String> {
    // Check environment variable first
    if let Ok(path) = std::env::var("WHISPER_PATH") {
        return Ok(path);
    }

    // Check standard locations based on platform
    // whisper-cli.exe is the current binary name (main.exe was deprecated in v1.7+)
    let standard_paths = if cfg!(target_os = "windows") {
        vec![
            "C:\\whisper\\whisper-cli.exe",
            "C:\\Program Files\\whisper\\whisper-cli.exe",
            ".\\whisper.cpp\\whisper-cli.exe",
            ".\\whisper\\whisper-cli.exe",
            "whisper-cli.exe",
            "C:\\whisper\\main.exe",
            "C:\\Program Files\\whisper\\main.exe",
            ".\\whisper.cpp\\main.exe",
            ".\\whisper\\main.exe",
            "main.exe",
        ]
    } else {
        vec![
            "/usr/local/bin/whisper-cli",
            "/usr/bin/whisper-cli",
            "./whisper.cpp/whisper-cli",
            "/usr/local/bin/whisper",
            "/usr/bin/whisper",
            "./whisper.cpp/main",
            "./models/whisper",
        ]
    };

    for path in standard_paths {
        if Path::new(path).exists() {
            return Ok(path.to_string());
        }
    }

    let setup_msg = if cfg!(target_os = "windows") {
        "Whisper executable not found. Please run setup_whisper.ps1 to install whisper.cpp automatically,\n\
        or download whisper-cli.exe from: https://github.com/ggerganov/whisper.cpp/releases\n\
        and place it in C:\\whisper\\ or set the WHISPER_PATH environment variable."
    } else {
        "Whisper executable not found. Please install whisper.cpp and set WHISPER_PATH environment variable.\n\
        Download from: https://github.com/ggerganov/whisper.cpp"
    };

    Err(anyhow::anyhow!(setup_msg))
}

/// Get the whisper model path
/// Users should download a model and set WHISPER_MODEL_PATH environment variable
fn get_model_path() -> Result<String> {
    // Check environment variable first
    if let Ok(path) = std::env::var("WHISPER_MODEL_PATH") {
        return Ok(path);
    }

    // Check standard locations for base model based on platform
    let standard_paths = if cfg!(target_os = "windows") {
        vec![
            "C:\\whisper\\models\\ggml-base.en.bin",
            "C:\\whisper\\models\\ggml-base.bin",
            ".\\models\\ggml-base.en.bin",
            ".\\models\\ggml-base.bin",
            ".\\whisper.cpp\\models\\ggml-base.en.bin",
            ".\\whisper.cpp\\models\\ggml-base.bin",
        ]
    } else {
        vec![
            "./models/ggml-base.en.bin",
            "./models/ggml-base.bin",
            "/usr/local/share/whisper/ggml-base.bin",
            "./whisper.cpp/models/ggml-base.bin",
        ]
    };

    for path in standard_paths {
        if Path::new(path).exists() {
            return Ok(path.to_string());
        }
    }

    let setup_msg = if cfg!(target_os = "windows") {
        "Whisper model not found. Please run setup_whisper.ps1 to download a model automatically,\n\
        or download manually from: https://huggingface.co/ggerganov/whisper.cpp\n\
        and set WHISPER_MODEL_PATH environment variable."
    } else {
        "Whisper model not found. Please download a model and set WHISPER_MODEL_PATH environment variable.\n\
        Download models from: https://huggingface.co/ggerganov/whisper.cpp"
    };

    Err(anyhow::anyhow!(setup_msg))
}
