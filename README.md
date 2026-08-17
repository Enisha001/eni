# Antarman - Final Year Project

Antarman is a personal AI assistant built for local voice-first interaction on Windows. The system captures voice input, transcribes speech with Whisper.cpp, sends the prompt to an AI provider, and responds using local text-to-speech.

## Purpose
This project demonstrates a privacy-first assistant experience suitable for a final-year software project submission.

## Core features
- voice recording and speech-to-text
- AI chat with Claude, OpenAI, or Azure OpenAI
- local TTS playback
- premium desktop UI
- local conversation and memory support

## Tech stack
- React + TypeScript + Vite
- Tauri + Rust desktop shell
- Whisper.cpp for speech recognition
- Python TTS server

## Quick start
```powershell
npm install
$env:WHISPER_PATH='C:\whisper\whisper-cli.exe'
$env:WHISPER_MODEL_PATH='C:\whisper\models\ggml-base.en.bin'
npm run tauri dev
```
