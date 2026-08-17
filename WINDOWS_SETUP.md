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
git clone https://github.com/yourusername/antarman.git
cd antarman

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

1. Verify installation: Check if `C:\whisper\main.exe` exists
2. Check environment variable:
   ```powershell
   echo $env:WHISPER_PATH
   ```
3. Restart your terminal/IDE
4. If still not working, restart your computer

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
