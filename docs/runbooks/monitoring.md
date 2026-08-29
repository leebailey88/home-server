# Home server monitoring runbook

The NUC uses two independent local monitors so web availability and background
job health cannot be confused with each other:

- `home-server-gateway-monitor` checks the web gateway and public routes. A
  persistent failure is critical.
- `home-server-jobs-monitor` checks cron and configured background-job logs. A
  failure is a warning and does not imply that the web gateway is unavailable.

Both monitors keep a small state file and send Discord notifications only on a
transition into failure and on the first recovery.

## Gateway monitor

The gateway monitor wraps:

```bash
bash scripts/check-health.sh
```

It validates:

- Nginx configuration syntax
- `cloudflared.service` status, if installed
- each enabled site's upstream `healthUrl`, if configured
- each enabled site's local Nginx routes using the configured hostnames
- optional expected HTTP statuses and response text
- optional public HTTPS checks through Cloudflare, DNS, and the tunnel

For proxy sites that define both `healthUrl` and `healthBodyContains`, each
local Nginx hostname check replays the health endpoint path through Nginx and
requires the configured service-identity marker. This verifies that the Host
header reaches the intended upstream without depending on framework-specific
root-page rendering. Proxy sites without a health identity, and static sites,
keep their configured root-page status/body checks.

Background jobs are intentionally not part of this check.

### Gateway debounce

A failed gateway check is immediately retried before Discord fires. Defaults:

```text
HOME_SERVER_GATEWAY_RETRY_COUNT=1
HOME_SERVER_GATEWAY_RETRY_DELAY_SECONDS=5
```

This filters a brief DNS, Cloudflare, or network hiccup without waiting for the
next five-minute timer run. If the retry also fails, the monitor enters
`firing` and sends a critical alert.

Failure alerts contain the failing or warning lines first rather than the
beginning of the full health-check transcript. The complete transcript remains
available in the systemd journal.

## Background job monitor

The job monitor wraps:

```bash
bash scripts/check-jobs-health.sh
```

It checks:

- `cron.service` or `crond.service`, unless disabled
- host-level `cronJobs` from `config/sites.yaml`
- per-site `cronJobs` from `config/sites.yaml`
- log-file existence and freshness
- configured success markers
- high-signal error patterns such as `ERROR`, `Error:`, `FAILED`, `Exception`,
  `Traceback`, `exited with error code`, `command not found`, and
  `No such file or directory`

Job failures are sent as warning-level `home-server-jobs` alerts, not critical
`home-server-gateway` alerts.

### Run-state-aware log checks

For jobs with `successPatterns`, the checker compares the latest matching
success with the latest matching error in the log tail:

- newer success than error: healthy
- newer error than success: failed
- no success marker in the retained tail: failed

This prevents an old error from keeping a job in a false firing state after a
newer run has completed successfully.

Jobs without `successPatterns` retain the conservative legacy behavior: any
matching error in the retained log tail is treated as a current failure. Add a
stable completion marker whenever a job has one.

Example:

```yaml
sites:
  - key: grizzly-bulls
    cronJobs:
      - key: runtime-data-refresh
        logPath: /var/log/grizzly-bulls-runtime-data.log
        maxAgeMinutes: 4500
        successPatterns:
          - Runtime data refresh complete
```

## Site health check options

Each enabled site can opt into deeper gateway checks in `config/sites.yaml`:

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
    publicHealthChecks:
      - url: https://grizzlybulls.com/api/health
        expectedStatus: 200
        expectedBodyContains: '"service":"grizzly-bulls"'
      - url: https://www.grizzlybulls.com/
        expectedStatus: 200
        expectedBodyContains: Grizzly Bulls
```

When `healthBodyContains` is present on a proxy site, it serves two purposes:
the direct upstream health check verifies the service itself, and the local
Nginx hostname check calls the same health path through `127.0.0.1:80` with the
configured Host header to verify routing to that exact service. This is
preferred over using mutable marketing-page text as the routing identity.

Static sites can use the same `expectedStatus`, `expectedBodyContains`, and
`publicHealthChecks` fields. Proxy sites without `healthBodyContains` also keep
their existing root-page `expectedBodyContains` behavior.

## Environment

Create a local `.env` from the example and keep the NUC paths accurate:

```bash
cp .env.example .env
nano .env
```

Typical NUC values:

```text
HOME_SERVER_CONFIG=/home/lee/projects/home-server/config/sites.yaml
HOME_SERVER_ENV_FILE=/home/lee/projects/home-server/.env
HOME_SERVER_STATE_DIR=/var/lib/home-server

HOME_SERVER_MONITOR_ON_BOOT_SEC=2min
HOME_SERVER_MONITOR_INTERVAL=5min
HOME_SERVER_GATEWAY_RETRY_COUNT=1
HOME_SERVER_GATEWAY_RETRY_DELAY_SECONDS=5

HOME_SERVER_JOBS_MONITOR_ON_BOOT_SEC=3min
HOME_SERVER_JOBS_MONITOR_INTERVAL=5min

HEALTH_TIMEOUT_MS=5000
HOME_SERVER_SKIP_PUBLIC_HEALTH_CHECKS=false
HOME_SERVER_SKIP_CRON_CHECKS=false
HOME_SERVER_SKIP_CRON_DAEMON_CHECK=false
HOME_SERVER_CRON_MAX_AGE_MINUTES=1500
HOME_SERVER_CRON_LOG_TAIL_BYTES=65536
```

Set the Discord webhooks:

```text
DISCORD_MONITOR_WARNING_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_MONITOR_CRITICAL_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_MONITOR_RECOVERY_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Gateway failures prefer the critical webhook. Background-job failures prefer
the warning webhook. Recovery uses `DISCORD_MONITOR_RECOVERY_WEBHOOK_URL` when
set, otherwise the monitor's failure webhook.

## Install or update the monitors

From the repository root on the NUC:

```bash
sudo HOME_SERVER_ENV_FILE="$(pwd)/.env" bash scripts/install-monitor-service.sh
```

The installer renders, enables, and runs both monitors:

```text
home-server-gateway-monitor.service
home-server-gateway-monitor.timer
home-server-jobs-monitor.service
home-server-jobs-monitor.timer
```

Re-run the installer after changing these unit templates or monitor cadence.

## Validate manually

Run the checks directly first:

```bash
HOME_SERVER_ENV_FILE="$(pwd)/.env" bash scripts/monitor-gateway.sh
HOME_SERVER_ENV_FILE="$(pwd)/.env" bash scripts/monitor-jobs.sh
```

Then run them through systemd:

```bash
sudo systemctl start home-server-gateway-monitor.service
sudo systemctl start home-server-jobs-monitor.service
```

Inspect recent output:

```bash
sudo journalctl -u home-server-gateway-monitor.service -o cat -n 200
sudo journalctl -u home-server-jobs-monitor.service -o cat -n 200
```

Timer status:

```bash
sudo systemctl status home-server-gateway-monitor.timer --no-pager
sudo systemctl status home-server-jobs-monitor.timer --no-pager
```

## Alert state

The monitors use independent state files:

```text
/var/lib/home-server/gateway-monitor.state
/var/lib/home-server/jobs-monitor.state
```

Each contains either `ok` or `firing`.

Behavior for each monitor:

- healthy check writes `ok`
- failed check writes `firing`
- first transition into `firing` sends one failure alert
- repeated failures do not spam Discord
- first transition from `firing` back to `ok` sends one recovery alert

Delete one state file to reset only that monitor:

```bash
sudo rm -f /var/lib/home-server/gateway-monitor.state
sudo rm -f /var/lib/home-server/jobs-monitor.state
```

## Disable monitoring

Disable either timer independently:

```bash
sudo systemctl disable --now home-server-gateway-monitor.timer
sudo systemctl disable --now home-server-jobs-monitor.timer
```

The installed unit files remain under `/etc/systemd/system/`.
