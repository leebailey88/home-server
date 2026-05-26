#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

CLOUDFLARED_OUTPUT_FILE="${CLOUDFLARED_OUTPUT_FILE:-${REPO_ROOT}/cloudflared/generated/config.yml}"
CLOUDFLARED_MERGED_OUTPUT_FILE="${CLOUDFLARED_MERGED_OUTPUT_FILE:-${REPO_ROOT}/cloudflared/generated/config.merged.yml}"
CLOUDFLARED_CONFIG_FILE="${CLOUDFLARED_CONFIG_FILE:-/etc/cloudflared/config.yml}"
CLOUDFLARED_BACKUP_DIR="${CLOUDFLARED_BACKUP_DIR:-/etc/cloudflared/backups}"

log "Rendering managed Cloudflare Tunnel config..."
cd "${REPO_ROOT}"
node scripts/render-cloudflared-config.mjs

if [[ ! -f "${CLOUDFLARED_OUTPUT_FILE}" ]]; then
  fail "Rendered Cloudflare Tunnel config was not found: ${CLOUDFLARED_OUTPUT_FILE}"
fi

log "Merging managed ingress with existing Cloudflare Tunnel config..."
node scripts/merge-cloudflared-config.mjs "${CLOUDFLARED_CONFIG_FILE}" "${CLOUDFLARED_OUTPUT_FILE}" "${CLOUDFLARED_MERGED_OUTPUT_FILE}"

if command -v cloudflared > /dev/null 2>&1; then
  log "Validating merged Cloudflare Tunnel config..."
  cloudflared tunnel ingress validate "${CLOUDFLARED_MERGED_OUTPUT_FILE}"
else
  warn "cloudflared command not found; skipping tunnel config validation"
fi

log "Installing merged Cloudflare Tunnel config to ${CLOUDFLARED_CONFIG_FILE}..."
install -d -m 0755 "$(dirname "${CLOUDFLARED_CONFIG_FILE}")"
install -d -m 0755 "${CLOUDFLARED_BACKUP_DIR}"

if [[ -f "${CLOUDFLARED_CONFIG_FILE}" ]]; then
  backup_file="${CLOUDFLARED_BACKUP_DIR}/config.yml.$(date -u +%Y%m%dT%H%M%SZ).bak"
  install -m 0600 "${CLOUDFLARED_CONFIG_FILE}" "${backup_file}"
  log "Backed up existing Cloudflare Tunnel config to ${backup_file}"
fi

install -m 0600 "${CLOUDFLARED_MERGED_OUTPUT_FILE}" "${CLOUDFLARED_CONFIG_FILE}"

if systemctl list-unit-files cloudflared.service > /dev/null 2>&1; then
  log "Restarting cloudflared..."
  systemctl restart cloudflared
  systemctl status cloudflared --no-pager
else
  warn "cloudflared.service not found. Config installed, but service was not restarted."
fi

log "Cloudflare Tunnel config installed."
