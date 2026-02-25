#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$PROJECT_DIR/apps/server"
DESKTOP_DIR="$PROJECT_DIR/apps/desktop"

SIGNING_IDENTITY="${SIGNING_IDENTITY:-Developer ID Application: Amir Dauti (SVH2Q5D9QY)}"
NOTARY_PROFILE="${NOTARY_PROFILE:-notarytool-profile}"

HETZNER_HOST="${HETZNER_HOST:-root@virtualagency.ai}"
HETZNER_FRONTEND_PATH="${HETZNER_FRONTEND_PATH:-/var/www/virtual-agency/}"
HETZNER_DOWNLOAD_PATH="${HETZNER_DOWNLOAD_PATH:-/var/www/virtual-agency/downloads/VirtualAgencyServer-macOS.zip}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd pnpm
require_cmd cargo
require_cmd codesign
require_cmd xcrun
require_cmd ditto
require_cmd scp
require_cmd ssh
require_cmd security

if [[ -z "${VITE_CLERK_PUBLISHABLE_KEY:-}" && -z "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ]]; then
  echo "Missing Clerk publishable key for frontend build." >&2
  echo "Set VITE_CLERK_PUBLISHABLE_KEY (or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) before deploying web assets." >&2
  exit 1
fi

echo "=== Checking codesigning identity ==="
if ! security find-identity -v -p codesigning | grep -Fq "$SIGNING_IDENTITY"; then
  echo "Codesigning identity not found: $SIGNING_IDENTITY" >&2
  echo "Run: security find-identity -v -p codesigning" >&2
  exit 1
fi

echo "=== Building frontend (Vite) ==="
cd "$PROJECT_DIR"
pnpm --filter @virtual-agency/desktop build

echo "=== Building server (release) ==="
cd "$PROJECT_DIR"
cargo build --release -p virtual-agency-server

echo "=== Creating server .app bundle ==="
cd "$SERVER_DIR"
rm -rf VirtualAgencyServer.app VirtualAgencyServer.zip

mkdir -p VirtualAgencyServer.app/Contents/MacOS
mkdir -p VirtualAgencyServer.app/Contents/Resources

echo "=== Adding app icon ==="
APP_ICON_SRC="$DESKTOP_DIR/src-tauri/icons/icon.icns"
APP_ICON_DST="VirtualAgencyServer.app/Contents/Resources/AppIcon.icns"
if [[ ! -f "$APP_ICON_SRC" ]]; then
  echo "Missing app icon source: $APP_ICON_SRC" >&2
  exit 1
fi
cp "$APP_ICON_SRC" "$APP_ICON_DST"

cp "$PROJECT_DIR/target/release/virtual-agency-server" \
  VirtualAgencyServer.app/Contents/MacOS/server-binary

cat > VirtualAgencyServer.app/Contents/MacOS/VirtualAgencyServer << 'LAUNCHER'
#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SERVER_BIN="$DIR/server-binary"

osascript <<EOF
tell application "Terminal"
    activate
    do script "clear && echo 'Starting Virtual Agency Server...' && echo '' && \"$SERVER_BIN\"; echo ''; echo 'Server stopped. Press any key to close.'; read -n 1"
end tell
EOF
LAUNCHER

chmod +x VirtualAgencyServer.app/Contents/MacOS/VirtualAgencyServer
chmod +x VirtualAgencyServer.app/Contents/MacOS/server-binary

cat > VirtualAgencyServer.app/Contents/Info.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>VirtualAgencyServer</string>
    <key>CFBundleIdentifier</key>
    <string>ai.virtualagency.server</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleName</key>
    <string>VirtualAgencyServer</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.13</string>
    <key>LSUIElement</key>
    <false/>
</dict>
</plist>
EOF

echo "=== Signing ==="
codesign --force --options runtime \
  --sign "$SIGNING_IDENTITY" \
  VirtualAgencyServer.app/Contents/MacOS/server-binary -v

codesign --force --options runtime \
  --sign "$SIGNING_IDENTITY" \
  VirtualAgencyServer.app --deep -v

echo "=== Notarizing ==="
ditto -c -k --keepParent VirtualAgencyServer.app VirtualAgencyServer.zip
xcrun notarytool submit VirtualAgencyServer.zip \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait

echo "=== Stapling ==="
xcrun stapler staple VirtualAgencyServer.app
rm -f VirtualAgencyServer.zip
ditto -c -k --keepParent VirtualAgencyServer.app VirtualAgencyServer.zip

echo "=== Deploying frontend ==="
scp -r "$DESKTOP_DIR/dist/"* "$HETZNER_HOST:$HETZNER_FRONTEND_PATH"

echo "=== Deploying server download ==="
scp "$SERVER_DIR/VirtualAgencyServer.zip" "$HETZNER_HOST:$HETZNER_DOWNLOAD_PATH"

echo "=== Verifying deployment ==="
ssh "$HETZNER_HOST" "ls -la /var/www/virtual-agency/downloads/ && ls -la /var/www/virtual-agency/index.html | head -n 2"

echo "=== Done ==="
