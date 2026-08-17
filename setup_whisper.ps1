# Whisper.cpp Setup Script for Windows
# This script downloads and sets up whisper.cpp for the Antarman app

param(
    [string]$InstallPath = "C:\whisper",
    [string]$Model = "base.en"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Whisper.cpp Setup for Antarman" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Warning: Not running as administrator. Installation to C:\ may fail." -ForegroundColor Yellow
    Write-Host "Consider running: PowerShell as Administrator" -ForegroundColor Yellow
    Write-Host ""
}

# Create installation directory
Write-Host "[1/5] Creating installation directory: $InstallPath" -ForegroundColor Green
if (-not (Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    Write-Host "      Created directory: $InstallPath" -ForegroundColor Gray
} else {
    Write-Host "      Directory already exists" -ForegroundColor Gray
}

$modelsPath = Join-Path $InstallPath "models"
if (-not (Test-Path $modelsPath)) {
    New-Item -ItemType Directory -Path $modelsPath -Force | Out-Null
}

# Download whisper.cpp prebuilt binary
Write-Host ""
Write-Host "[2/5] Downloading whisper.cpp..." -ForegroundColor Green

$whisperUrl = "https://github.com/ggerganov/whisper.cpp/releases/latest/download/whisper-bin-x64.zip"
$zipPath = Join-Path $env:TEMP "whisper-bin.zip"
$extractPath = Join-Path $env:TEMP "whisper-extract"

try {
    Write-Host "      Downloading from GitHub releases..." -ForegroundColor Gray
    Invoke-WebRequest -Uri $whisperUrl -OutFile $zipPath -ErrorAction Stop
    Write-Host "      Download complete" -ForegroundColor Gray
} catch {
    Write-Host "      Failed to download prebuilt binary. Trying alternative method..." -ForegroundColor Yellow

    # Alternative: Download from a specific release
    $altUrl = "https://github.com/ggerganov/whisper.cpp/releases/download/v1.5.4/whisper-bin-x64.zip"
    try {
        Invoke-WebRequest -Uri $altUrl -OutFile $zipPath -ErrorAction Stop
        Write-Host "      Download complete (alternative source)" -ForegroundColor Gray
    } catch {
        Write-Host "      Error: Could not download whisper.cpp binary" -ForegroundColor Red
        Write-Host "      Please download manually from: https://github.com/ggerganov/whisper.cpp/releases" -ForegroundColor Red
        Write-Host "      Extract and place main.exe in: $InstallPath" -ForegroundColor Red
        exit 1
    }
}

# Extract the binary
Write-Host ""
Write-Host "[3/5] Extracting whisper.cpp..." -ForegroundColor Green
if (Test-Path $extractPath) {
    Remove-Item -Path $extractPath -Recurse -Force
}
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

# Find and copy the modern whisper executable when available
$cliExe = Get-ChildItem -Path $extractPath -Filter "whisper-cli.exe" -Recurse | Select-Object -First 1
if ($cliExe) {
    Copy-Item -Path $cliExe.FullName -Destination (Join-Path $InstallPath "whisper-cli.exe") -Force
    Write-Host "      Installed whisper-cli.exe to $InstallPath" -ForegroundColor Gray
} elseif (Get-ChildItem -Path $extractPath -Filter "main.exe" -Recurse | Select-Object -First 1) {
    $mainExe = Get-ChildItem -Path $extractPath -Filter "main.exe" -Recurse | Select-Object -First 1
    Copy-Item -Path $mainExe.FullName -Destination (Join-Path $InstallPath "main.exe") -Force
    Write-Host "      Installed main.exe to $InstallPath" -ForegroundColor Gray
} else {
    # Try to find whisper.exe or any executable
    $anyExe = Get-ChildItem -Path $extractPath -Filter "*.exe" -Recurse | Select-Object -First 1
    if ($anyExe) {
        Copy-Item -Path $anyExe.FullName -Destination (Join-Path $InstallPath "whisper-cli.exe") -Force
        Write-Host "      Installed $($anyExe.Name) as whisper-cli.exe to $InstallPath" -ForegroundColor Gray
    } else {
        Write-Host "      Warning: No executable found in download" -ForegroundColor Yellow
        Write-Host "      You may need to build whisper.cpp manually" -ForegroundColor Yellow
    }
}

# Clean up temp files
Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item -Path $extractPath -Recurse -Force -ErrorAction SilentlyContinue

# Download the model
Write-Host ""
Write-Host "[4/5] Downloading Whisper model ($Model)..." -ForegroundColor Green

$modelFileName = "ggml-$Model.bin"
$modelPath = Join-Path $modelsPath $modelFileName
$modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$Model.bin"

if (Test-Path $modelPath) {
    Write-Host "      Model already exists: $modelPath" -ForegroundColor Gray
    $response = Read-Host "      Re-download? (y/N)"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Host "      Skipping download" -ForegroundColor Gray
    } else {
        Remove-Item $modelPath -Force
        Write-Host "      Downloading model (this may take a few minutes)..." -ForegroundColor Gray
        Invoke-WebRequest -Uri $modelUrl -OutFile $modelPath
        Write-Host "      Model downloaded successfully" -ForegroundColor Gray
    }
} else {
    Write-Host "      Downloading model (this may take a few minutes)..." -ForegroundColor Gray
    try {
        Invoke-WebRequest -Uri $modelUrl -OutFile $modelPath -ErrorAction Stop
        Write-Host "      Model downloaded successfully" -ForegroundColor Gray
    } catch {
        Write-Host "      Error downloading model: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "      Please download manually from: $modelUrl" -ForegroundColor Red
        Write-Host "      Save to: $modelPath" -ForegroundColor Red
    }
}

# Set environment variables
Write-Host ""
Write-Host "[5/5] Setting environment variables..." -ForegroundColor Green

$whisperExePath = if (Test-Path (Join-Path $InstallPath "whisper-cli.exe")) { Join-Path $InstallPath "whisper-cli.exe" } else { Join-Path $InstallPath "main.exe" }

# Set user environment variables (permanent)
[System.Environment]::SetEnvironmentVariable("WHISPER_PATH", $whisperExePath, [System.EnvironmentVariableTarget]::User)
[System.Environment]::SetEnvironmentVariable("WHISPER_MODEL_PATH", $modelPath, [System.EnvironmentVariableTarget]::User)

# Set for current session
$env:WHISPER_PATH = $whisperExePath
$env:WHISPER_MODEL_PATH = $modelPath

Write-Host "      WHISPER_PATH = $whisperExePath" -ForegroundColor Gray
Write-Host "      WHISPER_MODEL_PATH = $modelPath" -ForegroundColor Gray
Write-Host "      Environment variables set for current user" -ForegroundColor Gray

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Installation Summary:" -ForegroundColor White
Write-Host "  - Whisper.cpp installed to: $InstallPath" -ForegroundColor White
Write-Host "  - Model installed: $modelFileName" -ForegroundColor White
Write-Host "  - Environment variables configured" -ForegroundColor White
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Restart your terminal or IDE to load new environment variables" -ForegroundColor White
Write-Host "  2. Run 'npm run tauri dev' to start the app" -ForegroundColor White
Write-Host "  3. Speech-to-text should now work!" -ForegroundColor White
Write-Host ""
Write-Host "Note: If you still get errors, try restarting your computer." -ForegroundColor Gray
Write-Host ""
