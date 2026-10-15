#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

TIMER_NAME="${HOME_SERVER_SUPABASE_HEARTBEAT_TIMER:-home-server-supabase-heartbeat.timer}"
STATE_DIR="${HOME_SERVER_STATE_DIR:-/var/lib/home-server}"
SUCCESS_FILE="${STATE_DIR}/supabase-heartbeat.last-success"
MAX_AGE_SECONDS="${HOME_SERVER_SUPABASE_HEARTBEAT_MAX_AGE_SECONDS:-86400}"

if [[ ! "${MAX_AGE_SECONDS}" =~ ^[0-9]+$ ]]; then
  fail "HOME_SERVER_SUPABASE_HEARTBEAT_MAX_AGE_SECONDS must be a positive integer."
fi

if ((MAX_AGE_SECONDS <= 0)); then
  fail "HOME_SERVER_SUPABASE_HEARTBEAT_MAX_AGE_SECONDS must be a positive integer."
fi

log "Checking Supabase heartbeat scheduler..."

if ! systemctl is-enabled --quiet "${TIMER_NAME}"; then
  fail "${TIMER_NAME} is not enabled."
fi

if ! systemctl is-active --quiet "${TIMER_NAME}"; then
  fail "${TIMER_NAME} is not active."
fi

next_trigger="$(
  systemctl show "${TIMER_NAME}" \
    --property=NextElapseUSecRealtime \
    --value
)"
if [[ -z "${next_trigger}" || "${next_trigger}" == "n/a" ]]; then
  fail "${TIMER_NAME} has no future activation scheduled."
fi

if [[ ! -f "${SUCCESS_FILE}" ]]; then
  fail "Supabase heartbeat success marker is missing: ${SUCCESS_FILE}"
fi

last_success_epoch="$(stat -c %Y "${SUCCESS_FILE}")"
now_epoch="$(date +%s)"
age_seconds=$((now_epoch - last_success_epoch))

if ((age_seconds < 0)); then
  fail "Supabase heartbeat success marker timestamp is in the future: ${SUCCESS_FILE}"
fi

if ((age_seconds > MAX_AGE_SECONDS)); then
  fail "Supabase heartbeat last succeeded ${age_seconds}s ago, exceeding ${MAX_AGE_SECONDS}s."
fi

last_success="$(cat "${SUCCESS_FILE}")"
log "Supabase heartbeat scheduler healthy; last success ${last_success} (${age_seconds}s ago); next activation ${next_trigger}."
