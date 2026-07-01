#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${HOME_SERVER_REPO_DIR:-$(pwd)}"
SERVICE_NAME="${HOME_SERVER_EXTERNAL_MONITOR_SERVICE_NAME:-home-server-external-uptime-monitor}"
ENV_FILE="${HOME_SERVER_EXTERNAL_MONITOR_ENV_FILE:-/etc/home-server-external-uptime-monitor.env}"
STATE_DIR="${HOME_SERVER_EXTERNAL_MONITOR_STATE_DIR:-/var/lib/home-server-external-monitor}"
RUN_USER="${HOME_SERVER_EXTERNAL_MONITOR_USER:-root}"
ON_BOOT_SEC="${HOME_SERVER_EXTERNAL_MONITOR_ON_BOOT_SEC:-2min}"
ON_UNIT_ACTIVE_SEC="${HOME_SERVER_EXTERNAL_MONITOR_INTERVAL:-5min}"
RANDOMIZED_DELAY_SEC="${HOME_SERVER_EXTERNAL_MONITOR_RANDOMIZED_DELAY_SEC:-30s}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "ERROR: run as root, e.g. sudo bash scripts/install-external-uptime-monitor.sh"
  exit 1
fi

if [[ ! -f "$REPO_DIR/scripts/external-uptime-monitor.mjs" ]]; then
  echo "ERROR: missing $REPO_DIR/scripts/external-uptime-monitor.mjs"
  echo "Run this installer from the home-server repo root or set HOME_SERVER_REPO_DIR."
  exit 1
fi

mkdir -p "$STATE_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" << EOF
# External public uptime monitor for home-server sites.
# This should run from a non-NUC host, such as a DigitalOcean droplet.
HOME_SERVER_CONFIG=$REPO_DIR/config/sites.yaml
HOME_SERVER_EXTERNAL_MONITOR_STATE_FILE=$STATE_DIR/state.json
HOME_SERVER_EXTERNAL_MONITOR_TIMEOUT_MS=10000
HOME_SERVER_EXTERNAL_MONITOR_USER_AGENT=home-server-external-uptime-monitor/1.0

# Reuse the same Discord webhooks as the NUC monitor, or set dedicated external monitor webhooks.
DISCORD_MONITOR_CRITICAL_WEBHOOK_URL=
DISCORD_MONITOR_RECOVERY_WEBHOOK_URL=
DISCORD_MONITOR_WARNING_WEBHOOK_URL=
# DISCORD_EXTERNAL_MONITOR_CRITICAL_WEBHOOK_URL=
# DISCORD_EXTERNAL_MONITOR_RECOVERY_WEBHOOK_URL=
EOF
  chmod 0600 "$ENV_FILE"
  echo "Created $ENV_FILE. Edit it and add Discord webhook URLs before relying on alerts."
else
  echo "Using existing $ENV_FILE"
fi

cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=External public uptime monitor for home-server sites
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$REPO_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/env node $REPO_DIR/scripts/external-uptime-monitor.mjs
EOF

cat > "/etc/systemd/system/${SERVICE_NAME}.timer" << EOF
[Unit]
Description=Run external public uptime monitor periodically

[Timer]
OnBootSec=$ON_BOOT_SEC
OnUnitActiveSec=$ON_UNIT_ACTIVE_SEC
RandomizedDelaySec=$RANDOMIZED_DELAY_SEC
Persistent=true
Unit=${SERVICE_NAME}.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.timer"

echo
printf 'Installed %s.timer\n' "$SERVICE_NAME"
printf 'Run one check now with:\n  sudo systemctl start %s.service\n' "$SERVICE_NAME"
printf 'View logs with:\n  sudo journalctl -u %s.service -n 200 --no-pager\n' "$SERVICE_NAME"
printf 'Edit env/webhooks with:\n  sudo nano %s\n' "$ENV_FILE"
