#!/bin/bash
set -e

echo "Building Virtual Agency..."

# Install dependencies
pnpm install

# Build the application
pnpm tauri build

echo "Build complete! Check apps/desktop/src-tauri/target/release/"
