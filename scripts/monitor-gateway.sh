#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ENV_FILE="${HOME_SERVER_ENV_FILE:-${REPO_ROOT}/.env}"
STATE_DIR="${HOME_SERVER_STATE_DIR:-/var/lib/home-server}"
STATE_FILE="${STATE_DIR}/gateway-monitor.state"
HOSTNAME_VALUE="$(hostname -f 2> /dev/null || hostname)"

load_env_file "${ENV_FILE}"

mkdir -p "${STATE_DIR}"

previous_status="unknown"
if [[ -f "${STATE_FILE}" ]]; then
  previous_status="$(cat "${STATE_FILE}" || true)"
fi

set +e
check_output="$(HOME_SERVER_CONFIG="${HOME_SERVER_CONFIG:-${REPO_ROOT}/config/sites.yaml}" bash "${SCRIPT_DIR}/check-health.sh" 2>&1)"
check_status=$?
set -e

failure_webhook_url="${DISCORD_MONITOR_CRITICAL_WEBHOOK_URL:-${DISCORD_MONITOR_WARNING_WEBHOOK_URL:-}}"
recovery_webhook_url="${DISCORD_MONITOR_RECOVERY_WEBHOOK_URL:-${failure_webhook_url}}"

if [[ ${check_status} -eq 0 ]]; then
  printf 'ok' > "${STATE_FILE}"
  printf '%s\n' "${check_output}"

  if [[ "${previous_status}" == "firing" && -n "${recovery_webhook_url:-}" ]]; then
    DISCORD_WEBHOOK_URL="${recovery_webhook_url}" \
      ALERT_STATUS="ok" \
      ALERT_SEVERITY="warning" \
      ALERT_SERVICE="home-server-gateway" \
      ALERT_HOSTNAME="${HOSTNAME_VALUE}" \
      ALERT_TITLE="NUC web gateway recovered" \
      ALERT_DETAILS="${check_output}" \
      node "${SCRIPT_DIR}/send-discord-alert.mjs" || warn "Failed to send Discord recovery alert"
  fi

  exit 0
fi

printf 'firing' > "${STATE_FILE}"
printf '%s\n' "${check_output}" >&2

if [[ "${previous_status}" != "firing" && -n "${failure_webhook_url:-}" ]]; then
  DISCORD_WEBHOOK_URL="${failure_webhook_url}" \
    ALERT_STATUS="firing" \
    ALERT_SEVERITY="critical" \
    ALERT_SERVICE="home-server-gateway" \
    ALERT_HOSTNAME="${HOSTNAME_VALUE}" \
    ALERT_TITLE="NUC web gateway health check failed" \
    ALERT_DETAILS="${check_output}" \
    node "${SCRIPT_DIR}/send-discord-alert.mjs" || warn "Failed to send Discord failure alert"
fi

exit "${check_status}"
