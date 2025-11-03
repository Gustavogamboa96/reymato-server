@echo off

REM Build script for Rey Mato Server (Windows)
REM This script is used for deployment on Render or other cloud platforms

echo 🚀 Starting Rey Mato Server build process...

REM Install dependencies
echo 📦 Installing dependencies...
call npm ci

REM Compile TypeScript
echo 🔨 Compiling TypeScript...
call npm run compile

REM Check if build was successful
if %errorlevel% neq 0 (
    echo ❌ Build failed!
    exit /b 1
)

echo ✅ Build completed successfully!
echo 📁 Built files are in the 'dist' directory
echo 🎮 Rey Mato Server is ready to deploy!