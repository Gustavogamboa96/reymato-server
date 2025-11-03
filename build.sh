#!/bin/bash

# Build script for Rey Mato Server
# This script is used for deployment on Render or other cloud platforms

echo "🚀 Starting Rey Mato Server build process..."

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Compile TypeScript
echo "🔨 Compiling TypeScript..."
npm run compile

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ Build completed successfully!"
    echo "📁 Built files are in the 'dist' directory"
else
    echo "❌ Build failed!"
    exit 1
fi

echo "🎮 Rey Mato Server is ready to deploy!"