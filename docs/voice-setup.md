# Windows Voice Setup

## Requirements
- Whisper installed at `C:\whisper\whisper-cli.exe`
- Model file at `C:\whisper\models\ggml-base.en.bin`
- Python TTS environment available in `.venv-tts`

## Start app
```powershell
$env:WHISPER_PATH='C:\whisper\whisper-cli.exe'
$env:WHISPER_MODEL_PATH='C:\whisper\models\ggml-base.en.bin'
npm run tauri dev
```
