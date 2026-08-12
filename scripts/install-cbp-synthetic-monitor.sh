#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${HOME_SERVER_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"
ENV_FILE="${CBP_SYNTHETIC_ENV_FILE:-/etc/home-server-cbp-synthetic-monitor.env}"
STATE_DIR="${CBP_SYNTHETIC_STATE_DIR:-/var/lib/home-server-synthetic-monitor}"
LOG_DIR="${CBP_SYNTHETIC_LOG_DIR:-/var/log/home-server-synthetic-monitor}"
INTERVAL="${CBP_SYNTHETIC_MONITOR_INTERVAL:-15min}"
SERVICE_FILE="/etc/systemd/system/home-server-cbp-synthetic-monitor.service"
TIMER_FILE="/etc/systemd/system/home-server-cbp-synthetic-monitor.timer"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "ERROR: install-cbp-synthetic-monitor.sh must be run as root."
  exit 1
fi

if [[ ! -f "$REPO_DIR/package.json" ]]; then
  echo "ERROR: home-server repo not found at $REPO_DIR"
  echo "Set HOME_SERVER_REPO_DIR=/path/to/home-server and rerun."
  exit 1
fi

mkdir -p "$STATE_DIR" "$LOG_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" << EOF
# Authenticated synthetic monitor for Community Bank Pilot.
# This should run from a non-NUC host, such as a DigitalOcean droplet.

CBP_SYNTHETIC_BASE_URL=https://communitybankpilot.com
CBP_SYNTHETIC_TENANT_SLUG=REPLACE_WITH_TENANT_SLUG
# Optional full tenant origin override:
# CBP_SYNTHETIC_TENANT_URL=https://REPLACE_WITH_TENANT_SLUG.communitybankpilot.com

CBP_SYNTHETIC_EMAIL=REPLACE_WITH_SYNTHETIC_USER_EMAIL
CBP_SYNTHETIC_PASSWORD=REPLACE_WITH_SYNTHETIC_USER_PASSWORD
CBP_SYNTHETIC_EXPECT_DASHBOARD_TEXT=CEO dashboard
CBP_SYNTHETIC_READ_ONLY_PATHS=/reports/balance-sheet,/reports/income-statement,/reports/packages,/reports/import
CBP_SYNTHETIC_TIMEOUT_MS=30000
CBP_SYNTHETIC_HEADLESS=true
CBP_SYNTHETIC_STATE_FILE=$STATE_DIR/cbp-authenticated-smoke-state.json
CBP_SYNTHETIC_SCREENSHOT_DIR=$LOG_DIR

DISCORD_MONITOR_CRITICAL_WEBHOOK_URL=
DISCORD_MONITOR_RECOVERY_WEBHOOK_URL=
DISCORD_MONITOR_WARNING_WEBHOOK_URL=
# DISCORD_SYNTHETIC_MONITOR_CRITICAL_WEBHOOK_URL=
# DISCORD_SYNTHETIC_MONITOR_RECOVERY_WEBHOOK_URL=
# DISCORD_SYNTHETIC_MONITOR_WARNING_WEBHOOK_URL=
EOF
  chmod 0600 "$ENV_FILE"
  echo "Created $ENV_FILE"
else
  echo "Leaving existing $ENV_FILE unchanged"
fi

if command -v pnpm > /dev/null 2>&1; then
  echo "Installing npm dependencies and Playwright Chromium..."
  (
    cd "$REPO_DIR"
    pnpm install --frozen-lockfile
    pnpm exec playwright install --with-deps chromium
  )
else
  echo "WARNING: pnpm not found. Install pnpm and run:"
  echo "  cd $REPO_DIR && pnpm install --frozen-lockfile && pnpm exec playwright install --with-deps chromium"
fi

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Community Bank Pilot authenticated synthetic monitor
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$REPO_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/env bash -lc 'cd "$REPO_DIR" && pnpm monitor:synthetic:cbp'
EOF

cat > "$TIMER_FILE" << EOF
[Unit]
Description=Run Community Bank Pilot authenticated synthetic monitor periodically

[Timer]
OnBootSec=3min
OnUnitActiveSec=$INTERVAL
AccuracySec=30s
RandomizedDelaySec=45s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now home-server-cbp-synthetic-monitor.timer

echo
echo "Installed:"
echo "- $SERVICE_FILE"
echo "- $TIMER_FILE"
echo "- $ENV_FILE"
echo
echo "Next:"
echo "1. Edit $ENV_FILE and set CBP_SYNTHETIC_TENANT_SLUG, CBP_SYNTHETIC_EMAIL, CBP_SYNTHETIC_PASSWORD, and Discord webhooks."
echo "2. Test with:"
echo "   sudo systemctl start home-server-cbp-synthetic-monitor.service"
echo "   sudo journalctl -u home-server-cbp-synthetic-monitor.service -n 200 --no-pager"
echo "3. Check timer:"
echo "   systemctl status home-server-cbp-synthetic-monitor.timer --no-pager"
