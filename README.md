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

## Project summary
Antarman is a privacy-first AI desktop assistant designed for personal productivity, voice interaction, and AI-powered conversations in a local Windows environment. It combines speech-to-text, AI chat generation, and text-to-speech playback in one cohesive project.

## Why this project matters
Antarman shows how a modern AI assistant can feel personal and useful without depending entirely on a cloud-first experience. The project emphasizes practicality, privacy, and a strong user experience while demonstrating a realistic integration of voice technology, desktop app development, and AI workflows.

## Architecture overview
The system is structured around a desktop-first architecture:
- Frontend: React + TypeScript user interface
- Desktop shell: Tauri runtime with native desktop integration
- AI layer: multiple provider support for Claude, OpenAI, Azure OpenAI, and local alternatives
- Speech layer: Whisper.cpp for transcription and a Python TTS backend for spoken output
- Storage: local conversation and settings persistence, including offline-safe patterns

## Project structure
- src/: frontend React application
- src-tauri/: Rust desktop backend and integration layer
- scripts/: TTS server and validation utilities
- docs/: project report, setup guide, and submission materials
- public/: static app assets

## Evaluation note
This project demonstrates practical full-stack integration across frontend, desktop shell, local storage, AI providers, and multimedia processing. It is suitable for academic evaluation because it combines technical depth with a polished user experience, solid documentation, and working setup guidance.

## Submission readiness
- Project builds successfully with `npm run build`
- Setup guide is documented for Windows and local dependencies
- Configurations for Whisper and TTS are included
- GitHub repository is kept aligned with the final project state
- Documentation supports both evaluation and practical reuse
