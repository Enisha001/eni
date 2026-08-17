# Antarman - Your AI Inner Voice 🎙️

Talk to your conscience using your own cloned voice! Antarman is a fully local AI voice assistant that processes speech-to-text and text-to-speech offline, while connecting to Anthropic, OpenAI, or Azure OpenAI for intelligent responses.

## ✨ Features

- 🎤 **Voice Recording** - Capture your voice input locally
- 🔊 **Voice Cloning** - Train the system with your voice for personalized responses
- 🤖 **AI Integration** - Connect to Anthropic Claude, OpenAI GPT, or Azure OpenAI
- 💬 **Conversation History** - Track your conversations with your AI conscience
- 🔒 **Privacy First** - All voice processing happens locally (only AI text generation uses APIs)
- 🎨 **Beautiful UI** - Modern React interface with Tailwind CSS
- ⚡ **Desktop App** - Built with Tauri for native performance

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│           React Frontend (Vite)             │
│  - Voice UI with Tailwind CSS               │
│  - State Management (Zustand)               │
│  - Conversation History                     │
└─────────────────┬───────────────────────────┘
                  │ Tauri IPC
┌─────────────────▼───────────────────────────┐
│           Rust Backend (Tauri)              │
│  - Audio Recording (cpal)                   │
│  - Speech-to-Text (Whisper)                 │
│  - Text-to-Speech (Coqui TTS)               │
│  - API Clients (Anthropic/OpenAI/Azure)     │
└─────────────────────────────────────────────┘
```

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

### Required
- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **Rust** (latest stable) - [Install](https://rustup.rs/)
- **npm** or **yarn**

### Required for Voice Features

#### 1. Whisper.cpp (Speech-to-Text)

**Windows (Automated Setup - Recommended):**
```powershell
# Simply run the setup script - it will download and configure everything
.\setup_whisper.ps1

# Or double-click setup_whisper.bat
```

**Windows (Manual Setup):**
```powershell
# Download prebuilt binary from releases
# https://github.com/ggerganov/whisper.cpp/releases

# Create directory
mkdir C:\whisper\models

# Extract main.exe to C:\whisper\

# Download model
Invoke-WebRequest -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" -OutFile "C:\whisper\models\ggml-base.en.bin"

# Set environment variables (User level)
[System.Environment]::SetEnvironmentVariable("WHISPER_PATH", "C:\whisper\main.exe", [System.EnvironmentVariableTarget]::User)
[System.Environment]::SetEnvironmentVariable("WHISPER_MODEL_PATH", "C:\whisper\models\ggml-base.en.bin", [System.EnvironmentVariableTarget]::User)
```

**Linux/macOS:**
```bash
# Clone and build whisper.cpp
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
make

# Download a model (base model recommended)
bash ./models/download-ggml-model.sh base.en

# Set environment variables (add to ~/.bashrc or ~/.zshrc)
export WHISPER_PATH=/path/to/whisper.cpp/main
export WHISPER_MODEL_PATH=/path/to/whisper.cpp/models/ggml-base.en.bin
```

#### 2. Coqui TTS (Text-to-Speech with Voice Cloning)
```bash
# Install Coqui TTS
pip install TTS

# Verify installation
tts --help
```

#### 3. FFmpeg (Audio Processing)
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

### Platform-Specific Dependencies

#### Linux
```bash
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  alsa-utils \
  libasound2-dev
```

#### macOS
```bash
# Install Xcode Command Line Tools
xcode-select --install
```

#### Windows
- Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

## 🚀 Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/antarman.git
cd antarman
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**

Create environment variables for Whisper and TTS paths (if not in standard locations):
```bash
# Example for Linux/macOS
export WHISPER_PATH=/usr/local/bin/whisper
export WHISPER_MODEL_PATH=/usr/local/share/whisper/ggml-base.bin
export TTS_PATH=/usr/local/bin/tts
```

4. **Configure API Keys**

When you first run the app, go to Settings and add your API key for:
- Anthropic Claude: Get key from [console.anthropic.com](https://console.anthropic.com/)
- OpenAI: Get key from [platform.openai.com](https://platform.openai.com/)
- Azure OpenAI: Get key from Azure Portal

## 🎮 Usage

### Development Mode
```bash
npm run tauri dev
```

### Build for Production
```bash
npm run tauri build
```

The built application will be in `src-tauri/target/release/`.

## 🎤 Training Your Voice

1. Launch the application
2. Click the **Settings** icon (⚙️)
3. Scroll to **Voice Cloning** section
4. Click **Upload Voice Sample**
5. Select a 10-30 second audio sample of your voice
6. Wait for training to complete
7. Start talking! The AI will now respond in your voice

### Tips for Best Voice Cloning Results:
- Use a quiet environment
- Speak clearly and naturally
- 15-20 seconds of audio is ideal
- WAV format recommended (but MP3, OGG, M4A also work)

## 🔧 Configuration

### Whisper Models

You can use different Whisper models based on your needs:

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| tiny  | 75 MB | Fastest | Basic |
| base  | 142 MB | Fast | Good |
| small | 466 MB | Medium | Better |
| medium | 1.5 GB | Slow | Great |
| large | 2.9 GB | Slowest | Best |

Download models:
```bash
cd whisper.cpp
bash ./models/download-ggml-model.sh [model-name]
```

### TTS Models

Antarman uses:
- **Default**: `tts_models/en/ljspeech/tacotron2-DDC` (without voice cloning)
- **Voice Cloning**: `tts_models/multilingual/multi-dataset/xtts_v2` (with your voice)

## 📁 Project Structure

```
antarman/
├── src/                    # React frontend
│   ├── components/         # React components
│   │   ├── MessageList.tsx
│   │   ├── SettingsPanel.tsx
│   │   └── VoiceVisualizer.tsx
│   ├── App.tsx            # Main app component
│   ├── store.ts           # Zustand state management
│   ├── types.ts           # TypeScript types
│   └── tauri-api.ts       # Tauri command bindings
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── audio.rs       # Audio recording/playback
│   │   ├── stt.rs         # Speech-to-text (Whisper)
│   │   ├── tts.rs         # Text-to-speech (Coqui)
│   │   ├── ai_client.rs   # API clients
│   │   └── lib.rs         # Tauri commands
│   └── Cargo.toml         # Rust dependencies
└── package.json           # Node dependencies
```

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **State Management**: Zustand
- **Icons**: Lucide React
- **Desktop Framework**: Tauri 2
- **Backend**: Rust
- **Audio**: cpal, hound
- **HTTP**: reqwest
- **STT**: Whisper.cpp
- **TTS**: Coqui TTS
- **AI APIs**: Anthropic Claude, OpenAI GPT, Azure OpenAI

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is open source and available under the MIT License.

## 🐛 Troubleshooting

### Windows: "Whisper executable not found"
- Run `setup_whisper.ps1` or `setup_whisper.bat` to automatically install
- Ensure whisper.cpp is installed to `C:\whisper\main.exe`
- Verify environment variable: `echo $env:WHISPER_PATH` in PowerShell
- Restart your terminal/IDE after running setup
- If still not working, restart your computer to reload environment variables

### Windows: "Whisper model not found"
- Run `setup_whisper.ps1` to download the model automatically
- Verify the model exists at `C:\whisper\models\ggml-base.en.bin`
- Check environment variable: `echo $env:WHISPER_MODEL_PATH` in PowerShell
- If model download failed, download manually from [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp/tree/main)

### Linux/macOS: "Whisper executable not found"
- Ensure whisper.cpp is built and `WHISPER_PATH` is set
- Check that the path points to the `main` executable in whisper.cpp

### Linux/macOS: "Whisper model not found"
- Download a model using the whisper.cpp download script
- Set `WHISPER_MODEL_PATH` to point to the `.bin` file

### "Coqui TTS not found"
- Install TTS: `pip install TTS`
- Verify with: `tts --help`
- Set `TTS_PATH` if needed

### Audio recording not working
- Check microphone permissions
- Ensure ALSA is installed on Linux
- Try selecting a different input device in system settings

### Voice cloning not working
- Ensure ffmpeg is installed
- Check that audio sample is 10-30 seconds
- Try using WAV format

## 🎯 Roadmap

- [ ] Support for more TTS engines
- [ ] Multiple voice profiles
- [ ] Conversation analytics
- [ ] Custom wake words
- [ ] Plugin system
- [ ] Mobile support (iOS/Android)

## 💡 Inspiration

The name "Antarman" (अन्तरमन) comes from Sanskrit, meaning "inner self" or "conscience" - perfectly representing the concept of talking to your own AI conscience in your own voice.

## 📧 Contact

For questions or feedback, please open an issue on GitHub.

---

Made with ❤️ using Rust and React
