#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ENV_FILE="${HOME_SERVER_ENV_FILE:-${REPO_ROOT}/.env}"

load_env_file "${ENV_FILE}"

HOME_SERVER_CONFIG="${HOME_SERVER_CONFIG:-${REPO_ROOT}/config/sites.yaml}" \
  node "${SCRIPT_DIR}/supabase-heartbeat.mjs"
