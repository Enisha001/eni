@echo off
REM Quick setup script for Whisper.cpp on Windows
REM This script calls the PowerShell setup script

echo ========================================
echo   Whisper.cpp Setup for Antarman
echo ========================================
echo.

REM Check if PowerShell is available
where powershell >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: PowerShell not found. Please install PowerShell.
    pause
    exit /b 1
)

echo Running PowerShell setup script...
echo.

REM Run the PowerShell script with execution policy bypass
powershell -ExecutionPolicy Bypass -File "%~dp0setup_whisper.ps1"

echo.
echo Press any key to exit...
pause >nul
