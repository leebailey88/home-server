#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

log "Checking cron daemon, cron logs, and configured background jobs..."
node "${SCRIPT_DIR}/check-cron-health.mjs"

log "Background job health check complete."
