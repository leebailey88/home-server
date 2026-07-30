#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

ENV_FILE="${HOME_SERVER_ENV_FILE:-${REPO_ROOT}/.env}"
STATE_DIR="${HOME_SERVER_STATE_DIR:-/var/lib/home-server}"
ON_BOOT_SEC="${HOME_SERVER_SUPABASE_HEARTBEAT_ON_BOOT_SEC:-5min}"
ON_UNIT_ACTIVE_SEC="${HOME_SERVER_SUPABASE_HEARTBEAT_INTERVAL:-8h}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SERVICE_NAME="home-server-supabase-heartbeat.service"
TIMER_NAME="home-server-supabase-heartbeat.timer"
DROPIN_NAME="10-production-settings.conf"
SERVICE_DROPIN_DIR="${SYSTEMD_DIR}/${SERVICE_NAME}.d"
TIMER_DROPIN_DIR="${SYSTEMD_DIR}/${TIMER_NAME}.d"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}

trap cleanup EXIT

render_template() {
  local template_file="$1"
  local output_file="$2"

  sed \
    -e "s#{{REPO_ROOT}}#${REPO_ROOT}#g" \
    -e "s#{{ENV_FILE}}#${ENV_FILE}#g" \
    -e "s#{{STATE_DIR}}#${STATE_DIR}#g" \
    -e "s#{{ON_BOOT_SEC}}#${ON_BOOT_SEC}#g" \
    -e "s#{{ON_UNIT_ACTIVE_SEC}}#${ON_UNIT_ACTIVE_SEC}#g" \
    "${template_file}" > "${output_file}"
}

if [[ ! -f "${ENV_FILE}" ]]; then
  fail "Supabase heartbeat env file does not exist: ${ENV_FILE}"
fi

if [[ ! -r "${ENV_FILE}" ]]; then
  fail "Supabase heartbeat env file is not readable: ${ENV_FILE}"
fi

log "Preflighting Supabase heartbeat with ${ENV_FILE}..."
HOME_SERVER_ENV_FILE="${ENV_FILE}" \
  HOME_SERVER_STATE_DIR="${STATE_DIR}" \
  bash "${REPO_ROOT}/scripts/run-supabase-heartbeat.sh"

log "Rendering Supabase heartbeat systemd units..."
render_template \
  "${REPO_ROOT}/systemd/${SERVICE_NAME}" \
  "${TMP_DIR}/${SERVICE_NAME}"
render_template \
  "${REPO_ROOT}/systemd/${TIMER_NAME}" \
  "${TMP_DIR}/${TIMER_NAME}"

cat > "${TMP_DIR}/${SERVICE_NAME}.${DROPIN_NAME}" <<EOF_SERVICE_DROPIN
[Service]
Environment="HOME_SERVER_ENV_FILE=${ENV_FILE}"
Environment="HOME_SERVER_STATE_DIR=${STATE_DIR}"
EOF_SERVICE_DROPIN

cat > "${TMP_DIR}/${TIMER_NAME}.${DROPIN_NAME}" <<EOF_TIMER_DROPIN
[Timer]
OnUnitActiveSec=
OnUnitActiveSec=${ON_UNIT_ACTIVE_SEC}
Persistent=true
AccuracySec=30m
RandomizedDelaySec=30m
EOF_TIMER_DROPIN

log "Installing Supabase heartbeat systemd units and production drop-ins..."
install -d -m 0755 \
  "${STATE_DIR}" \
  "${SERVICE_DROPIN_DIR}" \
  "${TIMER_DROPIN_DIR}"
install -m 0644 "${TMP_DIR}/${SERVICE_NAME}" "${SYSTEMD_DIR}/${SERVICE_NAME}"
install -m 0644 "${TMP_DIR}/${TIMER_NAME}" "${SYSTEMD_DIR}/${TIMER_NAME}"
install -m 0644 \
  "${TMP_DIR}/${SERVICE_NAME}.${DROPIN_NAME}" \
  "${SERVICE_DROPIN_DIR}/${DROPIN_NAME}"
install -m 0644 \
  "${TMP_DIR}/${TIMER_NAME}.${DROPIN_NAME}" \
  "${TIMER_DROPIN_DIR}/${DROPIN_NAME}"

systemctl daemon-reload
systemctl enable "${TIMER_NAME}"
systemctl reset-failed "${SERVICE_NAME}" || true

log "Running one Supabase heartbeat through the installed service..."
if ! systemctl start "${SERVICE_NAME}"; then
  fail "Installed Supabase heartbeat failed. Inspect with: journalctl -u ${SERVICE_NAME} -o cat -n 200"
fi

systemctl restart "${TIMER_NAME}"
systemctl status "${TIMER_NAME}" --no-pager
systemctl list-timers "${TIMER_NAME}" --all --no-pager
log "Supabase heartbeat installed with interval ${ON_UNIT_ACTIVE_SEC}."
