#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
SERVICE_NAME="home-server-docker-storage-maintenance.service"
TIMER_NAME="home-server-docker-storage-maintenance.timer"

if ! command -v systemctl > /dev/null 2>&1; then
  fail "systemctl is required to install Docker storage maintenance. Run scripts/docker-storage-maintenance.sh manually on hosts without systemd."
fi

if [[ "$(ps -p 1 -o comm= 2> /dev/null || true)" != "systemd" ]]; then
  fail "systemd is not PID 1. Enable systemd before installing the timer, or run scripts/docker-storage-maintenance.sh manually."
fi

log "Installing conservative Docker storage maintenance timer..."

sed \
  -e "s#{{REPO_ROOT}}#${REPO_ROOT}#g" \
  "${REPO_ROOT}/systemd/${SERVICE_NAME}" > "${SYSTEMD_DIR}/${SERVICE_NAME}"
cp "${REPO_ROOT}/systemd/${TIMER_NAME}" "${SYSTEMD_DIR}/${TIMER_NAME}"
chmod 644 "${SYSTEMD_DIR}/${SERVICE_NAME}" "${SYSTEMD_DIR}/${TIMER_NAME}"

systemctl daemon-reload
systemctl enable --now "${TIMER_NAME}"

systemctl status "${TIMER_NAME}" --no-pager
systemctl list-timers "${TIMER_NAME}" --all --no-pager
log "Docker storage maintenance timer installed. No cleanup was run during installation."
