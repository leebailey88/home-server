# Gateway monitoring runbook

The gateway monitor is optional and opt-in. It runs the same local health checks as `scripts/check-health.sh`, stores a small firing/recovered state file, and can send Discord alerts when the gateway first fails and when it recovers.

## What it checks

The monitor wraps:

```bash
bash scripts/check-health.sh
```

That check validates:

- Nginx config syntax
- `cloudflared.service` status, if installed
- each enabled site's upstream `healthUrl`, if configured
- each enabled site's local Nginx route using the first configured hostname as the `Host` header

## Configure environment

Create a local `.env` from the example:

```bash
cp .env.example .env
nano .env
```

At minimum, set the config path that should be used on the NUC:

```bash
HOME_SERVER_CONFIG=/home/lee/projects/home-server/config/sites.yaml
```

Optional Discord webhooks:

```bash
DISCORD_MONITOR_WARNING_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_MONITOR_CRITICAL_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

If only the warning webhook is set, failure alerts fall back to that webhook. Recovery alerts use the warning webhook.

## Install the systemd timer

From the repo root on the NUC:

```bash
sudo HOME_SERVER_ENV_FILE="$(pwd)/.env" bash scripts/install-monitor-service.sh
```

Defaults:

```text
HOME_SERVER_MONITOR_ON_BOOT_SEC=2min
HOME_SERVER_MONITOR_INTERVAL=5min
HOME_SERVER_STATE_DIR=/var/lib/home-server
```

Override them in `.env` or in the install command environment.

## Inspect status

```bash
sudo systemctl status home-server-gateway-monitor.timer --no-pager
sudo systemctl status home-server-gateway-monitor.service --no-pager
```

Recent logs:

```bash
sudo journalctl -u home-server-gateway-monitor.service -o cat -n 200
```

Run one check manually through systemd:

```bash
sudo systemctl start home-server-gateway-monitor.service
sudo journalctl -u home-server-gateway-monitor.service -o cat -n 100
```

Run one check directly without systemd:

```bash
HOME_SERVER_ENV_FILE="$(pwd)/.env" bash scripts/monitor-gateway.sh
```

## Disable monitoring

```bash
sudo systemctl disable --now home-server-gateway-monitor.timer
```

The unit files remain installed under `/etc/systemd/system/` so they can be re-enabled later.

## Alert behavior

The monitor writes one state file:

```text
/var/lib/home-server/gateway-monitor.state
```

Behavior:

- healthy check writes `ok`
- failed check writes `firing`
- the first transition into `firing` sends a failure alert
- repeated failures do not spam Discord
- the first transition from `firing` back to `ok` sends a recovery alert

Delete the state file to force the next failure to alert again:

```bash
sudo rm -f /var/lib/home-server/gateway-monitor.state
```
