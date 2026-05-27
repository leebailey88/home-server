# Gateway monitoring runbook

The gateway monitor is optional and opt-in. It runs the same local health checks as `scripts/check-health.sh`, stores a small firing/recovered state file, and sends Discord alerts when the gateway first fails and when it recovers.

Discord remains the primary alerting channel. Set both monitor webhooks in `.env` before installing the timer.

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
- optional expected HTTP statuses and expected body text
- optional public HTTPS checks through Cloudflare/DNS/Tunnel using `publicHealthChecks`

## Site health check options

Each enabled site can opt into deeper checks in `config/sites.yaml`:

```yaml
sites:
  - key: grizzly-bulls
    enabled: true
    kind: proxy
    hostnames:
      - nuc-grizzly.grizzlybulls.com
      - grizzlybulls.com
      - www.grizzlybulls.com
    upstream: http://127.0.0.1:8080
    healthUrl: http://127.0.0.1:8080/api/health
    healthBodyContains: '"service":"grizzly-bulls"'
    expectedStatus: 200
    expectedBodyContains: Grizzly Bulls
    publicHealthChecks:
      - url: https://nuc-grizzly.grizzlybulls.com/api/health
        expectedStatus: 200
        expectedBodyContains: '"service":"grizzly-bulls"'
      - url: https://grizzlybulls.com/api/health
        expectedStatus: 200
        expectedBodyContains: '"service":"grizzly-bulls"'
      - url: https://www.grizzlybulls.com/
        expectedStatus: 200
        expectedBodyContains: Grizzly Bulls
```

Static sites can use the same `expectedStatus`, `expectedBodyContains`, and `publicHealthChecks` fields so the monitor verifies that Nginx is serving the right site, not merely returning a generic `index.html` fallback.

## Configure environment

Create a local `.env` from the example:

```bash
cp .env.example .env
nano .env
```

For the current NUC checkout, use:

```bash
HOME_SERVER_CONFIG=/home/lee/projects/home-server/config/sites.yaml
HOME_SERVER_ENV_FILE=/home/lee/projects/home-server/.env
HOME_SERVER_STATE_DIR=/var/lib/home-server
HEALTH_TIMEOUT_MS=5000
HOME_SERVER_SKIP_PUBLIC_HEALTH_CHECKS=false
```

Set Discord monitor webhooks:

```bash
DISCORD_MONITOR_WARNING_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_MONITOR_CRITICAL_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

If only the warning webhook is set, failure alerts fall back to that webhook. Recovery alerts use the warning webhook.

For first install, set `HOME_SERVER_SKIP_PUBLIC_HEALTH_CHECKS=true` only if public DNS/Tunnel routes are not ready yet. Flip it back to `false` once `curl https://grizzlybulls.com/api/health` succeeds from the NUC.

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

## Validate manually before relying on it

Run the direct check first:

```bash
HOME_SERVER_ENV_FILE="$(pwd)/.env" bash scripts/monitor-gateway.sh
```

Then run through systemd:

```bash
sudo systemctl start home-server-gateway-monitor.service
sudo journalctl -u home-server-gateway-monitor.service -o cat -n 100
```

## Inspect status

```bash
sudo systemctl status home-server-gateway-monitor.timer --no-pager
sudo systemctl status home-server-gateway-monitor.service --no-pager
```

Recent logs:

```bash
sudo journalctl -u home-server-gateway-monitor.service -o cat -n 200
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

## Current NUC cutover checklist

Your current state shows `money-bot-docker-monitor.timer` is already enabled, but `home-server-gateway-monitor.timer` is not installed yet. After merging this PR and pulling it on the NUC:

```bash
cd /home/lee/projects/home-server
git pull
pnpm install
pnpm validate:sites
sudo HOME_SERVER_CONFIG="$(pwd)/config/sites.yaml" bash scripts/check-health.sh
sudo HOME_SERVER_ENV_FILE="$(pwd)/.env" bash scripts/install-monitor-service.sh
sudo systemctl status home-server-gateway-monitor.timer --no-pager
```

Keep `GRIZZLY_BULLS_HEALTH_URL=http://127.0.0.1:8080/api/health` in `money-bot/.env` for redundant alerting until the dedicated gateway monitor has been clean for several days.
