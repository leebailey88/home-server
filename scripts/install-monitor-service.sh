#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

ENV_FILE="${HOME_SERVER_ENV_FILE:-${REPO_ROOT}/.env}"
STATE_DIR="${HOME_SERVER_STATE_DIR:-/var/lib/home-server}"
ON_BOOT_SEC="${HOME_SERVER_MONITOR_ON_BOOT_SEC:-2min}"
ON_UNIT_ACTIVE_SEC="${HOME_SERVER_MONITOR_INTERVAL:-5min}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SERVICE_NAME="home-server-gateway-monitor.service"
TIMER_NAME="home-server-gateway-monitor.timer"

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

log "Installing gateway monitor systemd units..."
mkdir -p "${STATE_DIR}"
chmod 755 "${STATE_DIR}"

render_template "${REPO_ROOT}/systemd/${SERVICE_NAME}" "${SYSTEMD_DIR}/${SERVICE_NAME}"
render_template "${REPO_ROOT}/systemd/${TIMER_NAME}" "${SYSTEMD_DIR}/${TIMER_NAME}"

chmod 644 "${SYSTEMD_DIR}/${SERVICE_NAME}" "${SYSTEMD_DIR}/${TIMER_NAME}"

systemctl daemon-reload
systemctl enable --now "${TIMER_NAME}"

log "Running one monitor check now..."
if ! systemctl start "${SERVICE_NAME}"; then
  warn "Initial monitor check failed. Inspect with: journalctl -u ${SERVICE_NAME} -o cat -n 200"
fi

systemctl status "${TIMER_NAME}" --no-pager
log "Gateway monitor installed."
