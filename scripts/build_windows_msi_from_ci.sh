#!/usr/bin/env bash
set -euo pipefail

WORKFLOW_FILE="${WORKFLOW_FILE:-windows-server-msi.yml}"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}"
OUT_DIR="${OUT_DIR:-dist/windows}"
REPO="${REPO:-}"

VERSION="${1:-}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_cmd gh
require_cmd jq
require_cmd git

mkdir -p "$OUT_DIR"

if [[ -z "$REPO" ]]; then
  # Best-effort parse of origin URL. Works for:
  # - git@github.com:owner/repo.git
  # - git@github-personal:owner/repo.git (SSH alias)
  # - https://github.com/owner/repo.git
  ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
  REPO="$(printf "%s" "$ORIGIN_URL" | sed -nE 's#.*[:/]+([^/]+)/([^/.]+)(\\.git)?$#\\1/\\2#p' | head -n 1)"
fi

if [[ -z "$REPO" ]]; then
  echo "Could not infer GitHub repo from git remotes." >&2
  echo "Set REPO explicitly, e.g.: REPO=amirdauti/virtualagency ./scripts/build_windows_msi_from_ci.sh" >&2
  exit 1
fi

echo "=== Triggering Windows MSI build (GitHub Actions) ==="
echo "workflow: $WORKFLOW_FILE"
echo "repo:     $REPO"
echo "branch:   $BRANCH"

START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -n "$VERSION" ]]; then
  gh workflow run "$WORKFLOW_FILE" -R "$REPO" --ref "$BRANCH" -f version="$VERSION" >/dev/null
  echo "requested version: $VERSION"
else
  gh workflow run "$WORKFLOW_FILE" -R "$REPO" --ref "$BRANCH" >/dev/null
  echo "requested version: (auto)"
fi

echo "=== Locating run id ==="
RUN_ID=""
for _ in {1..30}; do
  RUN_ID="$(
    gh run list \
      -R "$REPO" \
      --workflow "$WORKFLOW_FILE" \
      --branch "$BRANCH" \
      --limit 20 \
      --json databaseId,createdAt,event,status \
    | jq -r --arg start "$START_TS" '
        map(select(.event=="workflow_dispatch"))
        | map(select(.createdAt > $start))
        | map(select(.status=="queued" or .status=="in_progress" or .status=="completed"))
        | first
        | .databaseId // empty
      '
  )"
  if [[ -n "$RUN_ID" ]]; then
    break
  fi
  sleep 2
done

if [[ -z "$RUN_ID" ]]; then
  echo "Failed to find workflow run for $WORKFLOW_FILE on $BRANCH after triggering." >&2
  echo "Tip: run 'gh run list --workflow $WORKFLOW_FILE --branch $BRANCH' and pass RUN_ID manually." >&2
  exit 1
fi

echo "run id:   $RUN_ID"

echo "=== Waiting for build to finish ==="
gh run watch -R "$REPO" "$RUN_ID" --exit-status

echo "=== Downloading artifact ==="
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

gh run download -R "$REPO" "$RUN_ID" --dir "$TMP_DIR" --name "VirtualAgencyServer-windows-msi"

MSI_PATH="$(find "$TMP_DIR" -maxdepth 5 -type f -name "*.msi" | head -n 1 || true)"
if [[ -z "$MSI_PATH" ]]; then
  echo "MSI artifact not found in downloaded run artifacts." >&2
  exit 1
fi

cp -f "$MSI_PATH" "$OUT_DIR/VirtualAgencyServer.msi"
echo "saved: $OUT_DIR/VirtualAgencyServer.msi"

echo "=== Next step: deploy from your local machine ==="
echo "scp \"$OUT_DIR/VirtualAgencyServer.msi\" root@virtualagency.ai:/var/www/virtual-agency/downloads/VirtualAgencyServer-windows.msi"
