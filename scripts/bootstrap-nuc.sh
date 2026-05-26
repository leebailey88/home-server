#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

NUC_WEB_ROOT="${NUC_WEB_ROOT:-/opt/nuc-web}"
NODE_MAJOR="${NODE_MAJOR:-24}"

log "Installing base packages for NUC web gateway..."
apt-get update
apt-get install -y ca-certificates curl git gnupg jq nginx ufw fail2ban

if ! command -v node > /dev/null 2>&1 || ! node --version | grep -q "^v${NODE_MAJOR}\."; then
  log "Installing Node.js ${NODE_MAJOR}.x..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

log "Enabling corepack/pnpm..."
npm install --global corepack@latest
corepack enable
corepack prepare pnpm@latest --activate

log "Preparing ${NUC_WEB_ROOT}..."
mkdir -p "${NUC_WEB_ROOT}/sites" "${NUC_WEB_ROOT}/config" "${NUC_WEB_ROOT}/nginx"
chmod 755 "${NUC_WEB_ROOT}"

log "Enabling nginx..."
systemctl enable --now nginx
nginx -t

log "Allowing SSH through UFW; web traffic should arrive through cloudflared, not open WAN ports."
ufw allow OpenSSH || true
ufw --force enable || true

log "Bootstrap complete. Next: copy config/sites.example.yaml to config/sites.yaml, edit it, then run scripts/install-nginx-config.sh."
