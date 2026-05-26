#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

CONFIG_FILE="${HOME_SERVER_CONFIG:-${REPO_ROOT}/config/sites.yaml}"
if [[ ! -f "${CONFIG_FILE}" ]]; then
  CONFIG_FILE="${REPO_ROOT}/config/sites.example.yaml"
fi

log "Checking nginx config..."
nginx -t > /dev/null

if systemctl list-unit-files cloudflared.service > /dev/null 2>&1; then
  log "Checking cloudflared service..."
  systemctl is-active --quiet cloudflared || fail "cloudflared service is not active"
else
  warn "cloudflared.service not found; skipping service status check"
fi

log "Checking configured health URLs..."
node --input-type=module "${CONFIG_FILE}" << 'NODE'
import fs from 'node:fs';
import YAML from 'yaml';

const configPath = process.argv[1];
const config = YAML.parse(fs.readFileSync(configPath, 'utf8'));
const sites = Array.isArray(config.sites) ? config.sites.filter((site) => site.enabled !== false) : [];
let failures = 0;

for (const site of sites) {
  if (!site.healthUrl) continue;
  try {
    const response = await fetch(site.healthUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      failures += 1;
      console.error(`[FAIL] ${site.key}: ${site.healthUrl} returned ${response.status}`);
    } else {
      console.log(`[OK] ${site.key}: ${site.healthUrl}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`[FAIL] ${site.key}: ${site.healthUrl} (${error.message})`);
  }
}

if (failures > 0) process.exit(1);
NODE

log "Health check complete."
