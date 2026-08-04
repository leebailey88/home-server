#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

ENV_FILE="${HOME_SERVER_ENV_FILE:-${REPO_ROOT}/.env}"
STATE_DIR="${HOME_SERVER_STATE_DIR:-/var/lib/home-server}"
GATEWAY_ON_BOOT_SEC="${HOME_SERVER_MONITOR_ON_BOOT_SEC:-2min}"
GATEWAY_INTERVAL="${HOME_SERVER_MONITOR_INTERVAL:-5min}"
JOBS_ON_BOOT_SEC="${HOME_SERVER_JOBS_MONITOR_ON_BOOT_SEC:-3min}"
JOBS_INTERVAL="${HOME_SERVER_JOBS_MONITOR_INTERVAL:-5min}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"

render_template() {
  local template_file="$1"
  local output_file="$2"
  local on_boot_sec="$3"
  local interval="$4"

  sed \
    -e "s#{{REPO_ROOT}}#${REPO_ROOT}#g" \
    -e "s#{{ENV_FILE}}#${ENV_FILE}#g" \
    -e "s#{{STATE_DIR}}#${STATE_DIR}#g" \
    -e "s#{{ON_BOOT_SEC}}#${on_boot_sec}#g" \
    -e "s#{{ON_UNIT_ACTIVE_SEC}}#${interval}#g" \
    "${template_file}" > "${output_file}"
}

install_monitor() {
  local service_name="$1"
  local timer_name="$2"
  local on_boot_sec="$3"
  local interval="$4"

  render_template \
    "${REPO_ROOT}/systemd/${service_name}" \
    "${SYSTEMD_DIR}/${service_name}" \
    "${on_boot_sec}" \
    "${interval}"
  render_template \
    "${REPO_ROOT}/systemd/${timer_name}" \
    "${SYSTEMD_DIR}/${timer_name}" \
    "${on_boot_sec}" \
    "${interval}"

  chmod 644 "${SYSTEMD_DIR}/${service_name}" "${SYSTEMD_DIR}/${timer_name}"
}

log "Installing gateway and background job monitor systemd units..."
mkdir -p "${STATE_DIR}"
chmod 755 "${STATE_DIR}"

install_monitor \
  "home-server-gateway-monitor.service" \
  "home-server-gateway-monitor.timer" \
  "${GATEWAY_ON_BOOT_SEC}" \
  "${GATEWAY_INTERVAL}"
install_monitor \
  "home-server-jobs-monitor.service" \
  "home-server-jobs-monitor.timer" \
  "${JOBS_ON_BOOT_SEC}" \
  "${JOBS_INTERVAL}"

systemctl daemon-reload
systemctl enable --now home-server-gateway-monitor.timer home-server-jobs-monitor.timer

log "Running one gateway monitor check now..."
if ! systemctl start home-server-gateway-monitor.service; then
  warn "Initial gateway monitor check failed. Inspect with: journalctl -u home-server-gateway-monitor.service -o cat -n 200"
fi

log "Running one background job monitor check now..."
if ! systemctl start home-server-jobs-monitor.service; then
  warn "Initial background job monitor check failed. Inspect with: journalctl -u home-server-jobs-monitor.service -o cat -n 200"
fi

systemctl status home-server-gateway-monitor.timer --no-pager
systemctl status home-server-jobs-monitor.timer --no-pager
log "Gateway and background job monitors installed."
