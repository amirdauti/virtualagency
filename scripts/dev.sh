#!/bin/bash
set -e

echo "Starting Virtual Agency development environment..."

# Check for required tools
command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required but not installed. Install with: npm install -g pnpm"; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "cargo is required but not installed. Install Rust from https://rustup.rs"; exit 1; }

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    pnpm install
fi

# Start Tauri dev
echo "Starting Tauri development server..."
pnpm tauri dev
