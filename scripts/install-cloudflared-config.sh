#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

CLOUDFLARED_OUTPUT_FILE="${CLOUDFLARED_OUTPUT_FILE:-${REPO_ROOT}/cloudflared/generated/config.yml}"
CLOUDFLARED_CONFIG_FILE="${CLOUDFLARED_CONFIG_FILE:-/etc/cloudflared/config.yml}"

log "Rendering Cloudflare Tunnel config..."
cd "${REPO_ROOT}"
node scripts/render-cloudflared-config.mjs

if [[ ! -f "${CLOUDFLARED_OUTPUT_FILE}" ]]; then
  fail "Rendered Cloudflare Tunnel config was not found: ${CLOUDFLARED_OUTPUT_FILE}"
fi

log "Installing Cloudflare Tunnel config to ${CLOUDFLARED_CONFIG_FILE}..."
install -d -m 0755 "$(dirname "${CLOUDFLARED_CONFIG_FILE}")"
install -m 0600 "${CLOUDFLARED_OUTPUT_FILE}" "${CLOUDFLARED_CONFIG_FILE}"

if systemctl list-unit-files cloudflared.service > /dev/null 2>&1; then
  log "Restarting cloudflared..."
  systemctl restart cloudflared
  systemctl status cloudflared --no-pager
else
  warn "cloudflared.service not found. Config installed, but service was not restarted."
fi

log "Cloudflare Tunnel config installed."
