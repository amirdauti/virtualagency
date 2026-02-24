#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HETZNER_HOST="${HETZNER_HOST:-root@virtualagency.ai}"
REMOTE_DIR="${REMOTE_DIR:-/opt/virtual-agency/billing-api}"
PORT="${PORT:-8787}"
PUBLIC_PROXY_PORT="${PUBLIC_PROXY_PORT:-1337}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/virtualagency}"
SERVICE_NAME="${SERVICE_NAME:-virtualagency-billing-api}"
ENV_FILE="${ENV_FILE:-/etc/virtualagency/billing-api.env}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd ssh
require_cmd scp
require_cmd tar

TMP_TGZ="$(mktemp -t va-billing-api.XXXXXX.tgz)"
trap 'rm -f "$TMP_TGZ"' EXIT

echo "=== Packaging billing API ==="
tar -czf "$TMP_TGZ" -C "$PROJECT_DIR/apps/billing-api" .

echo "=== Uploading to Hetzner ==="
scp "$TMP_TGZ" "$HETZNER_HOST:/tmp/virtualagency-billing-api.tgz"

echo "=== Installing on Hetzner ==="
ssh "$HETZNER_HOST" "REMOTE_DIR='$REMOTE_DIR' PORT='$PORT' PUBLIC_PROXY_PORT='$PUBLIC_PROXY_PORT' NGINX_SITE='$NGINX_SITE' SERVICE_NAME='$SERVICE_NAME' ENV_FILE='$ENV_FILE' bash -s" <<'REMOTE'
set -euo pipefail

mkdir -p "$REMOTE_DIR"
rm -rf "$REMOTE_DIR"/*
tar -xzf /tmp/virtualagency-billing-api.tgz -C "$REMOTE_DIR"
rm -f /tmp/virtualagency-billing-api.tgz

cd "$REMOTE_DIR"
npm install --omit=dev

mkdir -p "$(dirname "$ENV_FILE")"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" << 'EOF'
# Virtual Agency Billing API (Node/Express)
# Required:
# - STRIPE_SECRET_KEY=sk_live_...
# - STRIPE_WEBHOOK_SECRET=whsec_...
# - CLERK_SECRET_KEY=sk_live_...
# - CLERK_PUBLISHABLE_KEY=pk_live_...
# Optional:
# - APP_URL=https://virtualagency.ai
# - PORT=8787
# - STRIPE_PRICE_ID=price_...
# - HOSTED_AUTO_UPDATE_SSH_KEY_PATH=/root/.ssh/id_ed25519
# - HOSTED_AUTO_UPDATE_SSH_USER=root
# - HOSTED_AUTO_UPDATE_SSH_PORT=22

APP_URL=https://virtualagency.ai
PORT=8787
STRIPE_PRICE_ID=price_1StBe1GR9CoMLe1tlnlDu4Ik
EOF
  echo "Created env template: $ENV_FILE"
  echo "Edit it and set STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY."
fi

cat > "/etc/systemd/system/$SERVICE_NAME.service" << EOF
[Unit]
Description=Virtual Agency Billing API
After=network.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

python3 - <<'PY'
import os
from pathlib import Path

nginx_site = Path(os.environ["NGINX_SITE"])
port = os.environ["PORT"]
public_proxy_port = os.environ["PUBLIC_PROXY_PORT"]

text = nginx_site.read_text()
insertions = []

if "location /api/billing/" not in text:
    insertions.append(
        f"""

    location /api/billing/ {{
        proxy_pass http://127.0.0.1:{port}/api/billing/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }}
"""
    )

if "location /api/hosting/" not in text:
    insertions.append(
        f"""

    location /api/hosting/ {{
        proxy_pass http://127.0.0.1:{port}/api/hosting/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }}
"""
    )

if "location /api/public/" not in text:
    insertions.append(
        f"""

    location /api/public/ {{
        proxy_pass http://127.0.0.1:{public_proxy_port}/api/public/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }}
"""
    )

if insertions:
    idx = text.rfind("\n}")
    if idx == -1:
        raise SystemExit(f"Could not find closing brace in {nginx_site}")
    text = text[:idx] + "".join(insertions) + text[idx:]
    nginx_site.write_text(text)
PY

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
systemctl restart "$SERVICE_NAME" || true

nginx -t
systemctl reload nginx

echo "billing api: http://127.0.0.1:$PORT/api/billing/health"
for _ in $(seq 1 10); do
  if curl -fsS "http://127.0.0.1:$PORT/api/billing/health" >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:$PORT/api/billing/health" || true
    break
  fi
  sleep 0.5
done
REMOTE

echo "=== Done ==="
echo "Next: set secrets on Hetzner in $ENV_FILE and restart:"
echo "ssh $HETZNER_HOST \"sudo nano $ENV_FILE && sudo systemctl restart $SERVICE_NAME\""
