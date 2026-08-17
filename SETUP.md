# Quick Setup Guide

This guide will help you get Antarman up and running quickly.

## 🚀 Quick Start (5 minutes)

### 1. Install System Dependencies

**Linux (Ubuntu/Debian):**
```bash
# Tauri dependencies
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev librsvg2-dev

# Audio dependencies
sudo apt install alsa-utils libasound2-dev ffmpeg

# Python for TTS
sudo apt install python3 python3-pip
```

**macOS:**
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install ffmpeg
brew install ffmpeg

# Install Python
brew install python3
```

**Windows:**
- Install [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Install [Python 3.x](https://www.python.org/downloads/)
- Install [FFmpeg](https://ffmpeg.org/download.html) and add to PATH

### 2. Install Whisper.cpp (Speech-to-Text)

```bash
# Clone repository
cd ~
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp

# Build
make

# Download base model (142 MB, good balance of speed and accuracy)
bash ./models/download-ggml-model.sh base.en

# Add to your shell config (~/.bashrc, ~/.zshrc, or equivalent)
echo 'export WHISPER_PATH=~/whisper.cpp/main' >> ~/.bashrc
echo 'export WHISPER_MODEL_PATH=~/whisper.cpp/models/ggml-base.en.bin' >> ~/.bashrc

# Reload shell config
source ~/.bashrc
```

### 3. Install Coqui TTS (Text-to-Speech)

```bash
# Install Coqui TTS
pip install TTS

# Verify installation
tts --help

# The first time you run the app, TTS will download models (~1.5 GB)
```

### 4. Install Project Dependencies

```bash
# Navigate to project directory
cd /path/to/antarman

# Install Node dependencies
npm install

# Build will automatically install Rust dependencies
```

### 5. Get API Key

Choose one of the following:

**Option A: Anthropic Claude (Recommended)**
1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Create an account or sign in
3. Go to API Keys section
4. Create a new API key
5. Copy the key (starts with `sk-ant-`)

**Option B: OpenAI**
1. Go to [platform.openai.com](https://platform.openai.com/)
2. Sign in and go to API Keys
3. Create new secret key
4. Copy the key (starts with `sk-`)

**Option C: Azure OpenAI**
1. Access Azure Portal
2. Create OpenAI resource
3. Get API key and endpoint from resource

### 6. Run the Application

```bash
# Development mode
npm run tauri dev

# Or build for production
npm run tauri build
```

### 7. Configure in App

1. Click **Settings** icon (⚙️)
2. Select your AI provider (Anthropic/OpenAI/Azure)
3. Paste your API key
4. (Optional) Upload a 10-30 second voice sample for voice cloning
5. Start talking!

## 🎤 Recording Your Voice Sample

For the best voice cloning results:

1. Find a quiet room
2. Use a good microphone (headset or USB mic recommended)
3. Record 15-20 seconds of yourself speaking naturally
4. You can record using:
   ```bash
   # Linux
   arecord -d 20 -f cd my_voice.wav

   # macOS
   # Use QuickTime Player: File → New Audio Recording

   # Windows
   # Use Voice Recorder app or Audacity
   ```

## 🔍 Testing Installation

### Test Whisper
```bash
# Record a test audio
arecord -d 5 -f cd test.wav

# Transcribe
$WHISPER_PATH -m $WHISPER_MODEL_PATH -f test.wav
```

### Test TTS
```bash
# Generate speech
tts --text "Hello, this is a test" --out_path output.wav

# With XTTS model (for voice cloning)
tts --text "Testing voice cloning" \
    --model_name tts_models/multilingual/multi-dataset/xtts_v2 \
    --speaker_wav my_voice.wav \
    --language_idx en \
    --out_path cloned_output.wav
```

## 🐛 Common Issues

### "Whisper executable not found"
```bash
# Check if whisper is built
ls -la ~/whisper.cpp/main

# If not, rebuild
cd ~/whisper.cpp && make clean && make

# Set environment variable
export WHISPER_PATH=~/whisper.cpp/main
```

### "TTS not found"
```bash
# Check if TTS is installed
pip show TTS

# If not, install
pip install TTS

# If using virtualenv, activate it first
```

### "No audio input device"
```bash
# Linux - list devices
arecord -l

# Check ALSA
sudo apt install alsa-utils
```

### Build fails with "webkit2gtk not found"
```bash
# Linux
sudo apt install libwebkit2gtk-4.1-dev

# If that doesn't work, try
sudo apt install libwebkit2gtk-4.0-dev
```

## 💾 Storage Requirements

- Application: ~50 MB
- Whisper base model: ~142 MB
- TTS models (downloaded on first use): ~1.5 GB
- Voice samples: ~1-5 MB each

Total: ~2 GB

## 📚 Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Check out the [Architecture](#) section to understand how it works
- Join our community for support

## 🎯 Performance Tips

1. **Use base model** for Whisper (good balance)
2. **Close other apps** when using voice features
3. **Use SSD** for faster model loading
4. **16GB RAM recommended** for smooth experience
5. **GPU support** coming soon for faster processing

## 🔒 Privacy Notes

- All voice processing happens **locally**
- Only text is sent to AI APIs (Anthropic/OpenAI/Azure)
- Your voice samples are stored in `~/.antarman/voices/`
- Conversation history stored locally in browser storage
- No telemetry or analytics

---

**Need help?** Open an issue on GitHub or check the [Troubleshooting](README.md#troubleshooting) section.
