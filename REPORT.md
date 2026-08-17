# Antarman Project Report

## Project Overview
Antarman is a desktop AI personal assistant built with Tauri, React, and Rust. It supports local voice input, transcription with Whisper.cpp, AI chat through Claude/OpenAI/Azure, and text-to-speech playback with a local TTS service. The project emphasizes privacy-first behavior, local processing, and a premium executive-style UI.

## Key Features
- Voice recording and speech-to-text transcription
- AI chat integration with Anthropic, OpenAI, and Azure OpenAI
- Local TTS synthesis with fallback voice support
- Memory suggestions and conversation history
- Premium white-and-burgundy UI design
- Desktop experience via Tauri

## System Requirements
- Windows 10 or later
- Node.js 18+
- Rust stable
- Python 3.11+
- FFmpeg
- Microsoft C++ Build Tools

## Local Setup
1. Install project dependencies:
   ```powershell
   npm install
   ```
2. Set up Whisper:
   ```powershell
   .\setup_whisper.ps1
   ```
3. Activate the TTS virtual environment if needed:
   ```powershell
   .\ .venv-tts\Scripts\Activate.ps1
   ```
4. Start the app:
   ```powershell
   $env:WHISPER_PATH='C:\whisper\whisper-cli.exe'
   $env:WHISPER_MODEL_PATH='C:\whisper\models\ggml-base.en.bin'
   npm run tauri dev
   ```

## Verification Status
The project was validated with:
- `npm run build` → success
- Local UI served at `http://localhost:1420/` → success
- Local TTS health endpoint `http://127.0.0.1:5050/health` → success

## Notes
- Whisper is configured for Windows using the installed binary under `C:\whisper`.
- The local TTS service runs on port 5050.
- This repo has been prepared for final GitHub submission and packaging.
