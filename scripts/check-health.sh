#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

log "Checking nginx config..."
nginx -t > /dev/null

if systemctl list-unit-files cloudflared.service > /dev/null 2>&1; then
  log "Checking cloudflared service..."
  systemctl is-active --quiet cloudflared || fail "cloudflared service is not active"
else
  warn "cloudflared.service not found; skipping service status check"
fi

log "Checking configured site upstreams and Nginx routes..."
node "${SCRIPT_DIR}/check-sites-health.mjs"

log "Health check complete."
