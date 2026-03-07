#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$PROJECT_DIR/apps/desktop"

HETZNER_HOST="${HETZNER_HOST:-root@virtualagency.ai}"
HETZNER_FRONTEND_PATH="${HETZNER_FRONTEND_PATH:-/var/www/virtual-agency/}"
REMOTE_BILLING_ENV="${REMOTE_BILLING_ENV:-/etc/virtualagency/billing-api.env}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd scp
require_cmd ssh

PNPM_CMD="pnpm"
if ! command -v pnpm >/dev/null 2>&1; then
  require_cmd corepack
  PNPM_CMD="corepack pnpm"
fi

if [[ -z "${VITE_CLERK_PUBLISHABLE_KEY:-}" && -z "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ]]; then
  REMOTE_KEY="$(ssh "$HETZNER_HOST" "sudo sed -n 's/^CLERK_PUBLISHABLE_KEY=//p' '$REMOTE_BILLING_ENV' | tail -n 1" || true)"
  if [[ -n "$REMOTE_KEY" ]]; then
    export VITE_CLERK_PUBLISHABLE_KEY="$REMOTE_KEY"
    echo "Using CLERK_PUBLISHABLE_KEY from $HETZNER_HOST:$REMOTE_BILLING_ENV"
  fi
fi

if [[ -z "${VITE_CLERK_PUBLISHABLE_KEY:-}" && -z "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ]]; then
  echo "Missing Clerk publishable key for frontend build." >&2
  echo "Set VITE_CLERK_PUBLISHABLE_KEY (or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) and retry." >&2
  exit 1
fi

echo "=== Building frontend (Vite) ==="
cd "$PROJECT_DIR"
$PNPM_CMD --filter @virtual-agency/desktop build

echo "=== Uploading dist to Hetzner ==="
scp -r "$DESKTOP_DIR/dist/"* "$HETZNER_HOST:$HETZNER_FRONTEND_PATH"

echo "=== Done ==="
