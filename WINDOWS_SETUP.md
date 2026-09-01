# Windows Setup Guide for Antarman

Quick guide to get Antarman running on Windows with full voice features.

## Prerequisites

1. **Node.js** - Download from [nodejs.org](https://nodejs.org/)
2. **Rust** - Install from [rustup.rs](https://rustup.rs/)
3. **Python** (for TTS) - Download from [python.org](https://www.python.org/)

## Step-by-Step Setup

### 1. Clone and Install Dependencies

```powershell
# Clone the repository
git clone https://github.com/Enisha001/eni.git
cd eni

# Install Node dependencies
npm install
```

### 2. Setup Speech-to-Text (Whisper.cpp)

**Option A: Automated Setup (Recommended)**

Simply run the setup script:

```powershell
# Run in PowerShell
.\setup_whisper.ps1
```

Or double-click `setup_whisper.bat` in File Explorer.

**Option B: Manual Setup**

1. Download whisper.cpp from [releases](https://github.com/ggerganov/whisper.cpp/releases)
2. Create directory: `C:\whisper\models`
3. Extract `main.exe` to `C:\whisper\`
4. Download model:
   ```powershell
   Invoke-WebRequest -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" -OutFile "C:\whisper\models\ggml-base.en.bin"
   ```
5. Set environment variables:
   ```powershell
   [System.Environment]::SetEnvironmentVariable("WHISPER_PATH", "C:\whisper\main.exe", "User")
   [System.Environment]::SetEnvironmentVariable("WHISPER_MODEL_PATH", "C:\whisper\models\ggml-base.en.bin", "User")
   ```

### 3. Setup Text-to-Speech (Coqui TTS)

```powershell
# Install Coqui TTS
pip install TTS

# Coqui TTS 0.22.0 doesn't cap the transformers version it depends on, so a plain
# `pip install TTS` pulls whatever is latest — which breaks XTTS v2 loading (missing
# BeamSearchScorer / weights_only errors). Pin a known-compatible version:
pip install "transformers==4.36.2"

# Verify installation
tts --help
```

### 4. Configure API Keys

When you first run the app:
1. Click the Settings icon (⚙️)
2. Add your API key:
   - **Anthropic Claude**: Get from [console.anthropic.com](https://console.anthropic.com/)
   - **OpenAI**: Get from [platform.openai.com](https://platform.openai.com/)
   - **Azure OpenAI**: Get from Azure Portal

### 5. Run the Application

```powershell
# Start in development mode
npm run tauri dev
```

**Important**: After running setup_whisper.ps1, you MUST restart your terminal/IDE to load the new environment variables!

### 6. Train Your Voice (Optional)

1. Click Settings (⚙️)
2. Scroll to "Voice Cloning"
3. Upload a 10-30 second audio sample
4. Wait for training
5. Start talking!

## Troubleshooting

### "Whisper executable not found"

1. Verify installation: Check if `C:\whisper\whisper-cli.exe` exists
2. Check environment variable:
   ```powershell
   echo $env:WHISPER_PATH
   ```
3. Restart your terminal/IDE
4. If still not working, restart your computer

### Speech-to-text fails immediately with a "main.exe is deprecated" warning

Recent whisper.cpp releases renamed the transcription binary from `main.exe` to
`whisper-cli.exe`; the `main.exe` that now ships is just a stub that prints this
deprecation warning and exits without transcribing anything. Fix:

1. Make sure `C:\whisper\whisper-cli.exe` exists (re-run `setup_whisper.ps1`, or
   download `whisper-bin-x64.zip` from the
   [whisper.cpp releases page](https://github.com/ggerganov/whisper.cpp/releases)
   yourself and extract it).
2. `whisper-cli.exe` is dynamically linked — copy the **whole** extracted folder
   into `C:\whisper\`, not just the exe, so `ggml*.dll`, `whisper.dll`, and
   `llama.dll` end up alongside it. A missing DLL causes the same kind of silent
   failure.
3. Point `WHISPER_PATH` at `whisper-cli.exe`, not `main.exe`:
   ```powershell
   [System.Environment]::SetEnvironmentVariable("WHISPER_PATH", "C:\whisper\whisper-cli.exe", "User")
   ```
4. Restart your terminal/IDE so the updated environment variable is picked up.

### "Whisper model not found"

1. Verify model exists: Check `C:\whisper\models\ggml-base.en.bin`
2. Check environment variable:
   ```powershell
   echo $env:WHISPER_MODEL_PATH
   ```
3. Re-run setup script or download model manually

### "TTS not found"

1. Verify Python installation: `python --version`
2. Verify TTS installation: `tts --help`
3. If not found, reinstall: `pip install TTS --upgrade`

### Voice-cloned replies never arrive / message sending hangs for ~2 minutes

This means TTS synthesis is failing silently in the background (check the app's console
output for `[TTS SERVER]` or `[STREAM] TTS failed` lines). Two known causes with old
Coqui TTS 0.22.0:
- `cannot import name 'BeamSearchScorer' from 'transformers'` — your `transformers`
  version is too new. Fix: `pip install "transformers==4.36.2"`.
- `Weights only load failed ... Unsupported global: TTS.tts.configs.xtts_config.XttsConfig`
  — your `torch` version is >=2.6, which changed `torch.load`'s default to
  `weights_only=True`. `scripts/tts_server.py` already patches around this; if you're
  invoking XTTS v2 from your own script, apply the same `torch.load` patch shown there
  before importing `TTS.api`.

### Build Errors

If you get build errors with Tauri:

1. Install Visual Studio Build Tools:
   - Download from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   - Install "Desktop development with C++"

2. Install WebView2:
   - Usually pre-installed on Windows 11
   - Download from [microsoft.com](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

### Environment Variables Not Loading

After setting environment variables:

1. Close ALL terminal windows
2. Close your IDE (VS Code, etc.)
3. Reopen and test:
   ```powershell
   echo $env:WHISPER_PATH
   echo $env:WHISPER_MODEL_PATH
   ```
4. If still not working, restart your computer

## Quick Test

After setup, test each component:

```powershell
# Test Whisper
C:\whisper\main.exe --help

# Test TTS
tts --help

# Test environment variables
echo $env:WHISPER_PATH
echo $env:WHISPER_MODEL_PATH

# Run the app
npm run tauri dev
```

## Performance Tips

1. **Use the base model** for faster transcription (already default in setup)
2. **Close other apps** when using voice features for better performance
3. **Use a good microphone** for better transcription accuracy
4. **Speak clearly** and in a quiet environment

## Supported Windows Versions

- Windows 10 (version 1809 or later)
- Windows 11

## Need Help?

- Check [README.md](README.md) for general documentation
- Open an issue on [GitHub](https://github.com/yourusername/antarman/issues)
- See the full troubleshooting section in README.md

---

**Next Steps**: After setup is complete, try recording your voice and see your AI conscience respond!
