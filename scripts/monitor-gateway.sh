#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck source=scripts/lib/gateway-monitor-state.sh
source "${SCRIPT_DIR}/lib/gateway-monitor-state.sh"

ENV_FILE="${HOME_SERVER_ENV_FILE:-${REPO_ROOT}/.env}"
HOSTNAME_VALUE="$(hostname -f 2> /dev/null || hostname)"

load_env_file "${ENV_FILE}"

STATE_DIR="${HOME_SERVER_STATE_DIR:-/var/lib/home-server}"
STATE_FILE="${STATE_DIR}/gateway-monitor.state"
RETRY_COUNT="${HOME_SERVER_GATEWAY_RETRY_COUNT:-1}"
RETRY_DELAY_SECONDS="${HOME_SERVER_GATEWAY_RETRY_DELAY_SECONDS:-5}"

mkdir -p "${STATE_DIR}"

previous_status="unknown"
if [[ -f "${STATE_FILE}" ]]; then
  previous_status="$(cat "${STATE_FILE}" || true)"
fi

run_check() {
  set +e
  check_output="$(HOME_SERVER_CONFIG="${HOME_SERVER_CONFIG:-${REPO_ROOT}/config/sites.yaml}" bash "${SCRIPT_DIR}/check-health.sh" 2>&1)"
  check_status=$?
  set -e
}

failure_details() {
  local details
  details="$(printf '%s\n' "${check_output}" | grep -E '^\[FAIL\]|^\[WARN\]|failed|FAILED|error|ERROR' || true)"

  if [[ -z "${details}" ]]; then
    details="$(printf '%s\n' "${check_output}" | tail -n 30)"
  fi

  printf '%s\n' "${details}"
}

run_check

transient_retry_only=false
persistent_failure_fingerprints="$(gateway_failure_fingerprints "${check_output}")"
structured_failure_correlation=true
if [[ ${check_status} -ne 0 && -z "${persistent_failure_fingerprints}" ]]; then
  structured_failure_correlation=false
fi

if [[ ${check_status} -ne 0 && "${RETRY_COUNT}" =~ ^[0-9]+$ && ${RETRY_COUNT} -gt 0 ]]; then
  for ((attempt = 1; attempt <= RETRY_COUNT && check_status != 0; attempt += 1)); do
    printf '%s\n' "${check_output}" >&2
    warn "Gateway health check failed; retrying in ${RETRY_DELAY_SECONDS}s (${attempt}/${RETRY_COUNT})"
    sleep "${RETRY_DELAY_SECONDS}"
    run_check

    if [[ ${check_status} -eq 0 ]]; then
      break
    fi

    if [[ "${structured_failure_correlation}" == "true" ]]; then
      retry_failure_fingerprints="$(gateway_failure_fingerprints "${check_output}")"

      if [[ -z "${retry_failure_fingerprints}" ]]; then
        # A non-zero retry without a structured failure identity cannot safely be
        # correlated. Preserve the legacy fail-closed behavior.
        structured_failure_correlation=false
        continue
      fi

      persistent_failure_fingerprints="$(
        gateway_intersect_failure_fingerprints \
          "${persistent_failure_fingerprints}" \
          "${retry_failure_fingerprints}"
      )"

      if [[ -z "${persistent_failure_fingerprints}" ]]; then
        printf '%s\n' "${check_output}" >&2
        warn "Gateway retry failed only different structured checks; no failure persisted across attempts, suppressing critical transition"
        transient_retry_only=true
        check_status=0
        check_output="[home-server][warn] Gateway retries saw only non-repeating structured failures; treating them as transient rather than a persistent gateway outage."
        break
      fi
    fi
  done
fi

failure_webhook_url="${DISCORD_MONITOR_CRITICAL_WEBHOOK_URL:-${DISCORD_MONITOR_WARNING_WEBHOOK_URL:-}}"
recovery_webhook_url="${DISCORD_MONITOR_RECOVERY_WEBHOOK_URL:-${failure_webhook_url}}"

if [[ ${check_status} -eq 0 ]]; then
  printf 'ok' > "${STATE_FILE}"
  printf '%s\n' "${check_output}"

  if [[ "${previous_status}" == "firing" && -n "${recovery_webhook_url:-}" ]]; then
    recovery_details="All gateway checks passed."
    if [[ "${transient_retry_only}" == "true" ]]; then
      recovery_details="The persistent gateway failure cleared. The latest retries contained only non-repeating transient check failures."
    fi

    DISCORD_WEBHOOK_URL="${recovery_webhook_url}" \
      ALERT_STATUS="ok" \
      ALERT_SEVERITY="warning" \
      ALERT_SERVICE="home-server-gateway" \
      ALERT_HOSTNAME="${HOSTNAME_VALUE}" \
      ALERT_TITLE="NUC web gateway recovered" \
      ALERT_DETAILS="${recovery_details}" \
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
    ALERT_DETAILS="$(failure_details)" \
    node "${SCRIPT_DIR}/send-discord-alert.mjs" || warn "Failed to send Discord failure alert"
fi

exit "${check_status}"
