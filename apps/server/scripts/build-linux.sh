#!/bin/bash
# Build script for Linux - run this on the Hetzner server

set -e

echo "Building Virtual Agency Server for Linux..."

# Ensure we're in the right directory
cd "$(dirname "$0")/.."

# Install Rust if not present
if ! command -v cargo &> /dev/null; then
    echo "Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# Build release
cargo build --release

# Create dist directory
mkdir -p dist

# Copy binary
cp ../../target/release/virtual-agency-server dist/virtual-agency-server-linux-x64

# Create archive
cd dist
zip virtual-agency-server-linux-x64.zip virtual-agency-server-linux-x64

echo "Build complete! Binary at: dist/virtual-agency-server-linux-x64"
echo "Archive at: dist/virtual-agency-server-linux-x64.zip"
