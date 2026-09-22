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
root-page rendering. Proxy sites without a health identity keep their
configured root-page status/body checks.

Static sites use a generated exact Nginx sentinel at `/_home-server-health`
with a site-specific body such as `home-server-static:altamont-previews`.
This verifies the virtual-host route without requiring a root `index.html` or
coupling monitoring to one path-addressed preview release.

Local Nginx hostname checks use Node's raw HTTP client rather than `fetch()` so
the synthetic `Host` header is transmitted exactly on the wire. Browser-style
fetch implementations may normalize or replace `Host` with the loopback URL's
host, which can silently exercise Nginx's default virtual server instead of the
configured hostname.

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
- log/status-file existence and freshness
- configured success markers
- high-signal error patterns such as `ERROR`, `Error:`, `FAILED`, `Exception`,
  `Traceback`, `exited with error code`, `command not found`, and
  `No such file or directory`

Job failures are sent as warning-level `home-server-jobs` alerts, not critical
`home-server-gateway` alerts.

### Run-state-aware content checks

For jobs with `successPatterns`, the checker compares the latest matching
success with the latest matching error in the retained log tail:

- newer success than error: healthy
- newer error than success: failed
- no success marker in the retained tail: failed

This prevents an old error from keeping a job in a false firing state after a
newer run has completed successfully.

Jobs without `successPatterns` retain the conservative legacy behavior: any
matching error in the retained log tail is treated as a current failure. Add a
stable completion marker whenever a generic job has one.

Example content-aware job:

```yaml
cronJobs:
  - key: community-bank-pilot-health-check
    logPath: /var/log/community-bank-pilot-health-check.log
    maxAgeMinutes: 5
    successPatterns:
      - Health check completed successfully
```

### Freshness-only checks for service-owned semantics

A service that already owns a richer semantic readiness contract should not
have that contract reinterpreted by the generic home-server log scanner.
For such a job, configure a durable terminal status file, keep a bounded
`maxAgeMinutes`, set `errorPatterns: false`, and omit `successPatterns`:

```yaml
sites:
  - key: grizzly-bulls
    cronJobs:
      - key: runtime-data-refresh
        logPath: /opt/grizzly-bulls/data/runtime-data-refresh.status
        maxAgeMinutes: 4500
        errorPatterns: false
```

That combination intentionally means **freshness-only** to the generic job
monitor:

- missing status file => failure;
- status file older than policy => failure;
- current status file => healthy at the home-server mechanism layer, regardless
  of whether its text says the latest execution succeeded or failed.

For Grizzly Bulls specifically, `/api/readiness` plus
`grizzly-bulls-monitor-runtime-readiness.sh` is the authoritative semantic
runtime-data monitor. Grizzly understands whether individual market,
billionaire, history, and indicator authorities are still fresh enough to
serve. A recent aggregate execution failure can therefore be `degraded` but
serviceable, while stale/missing required authority becomes `critical`.

The generic home-server monitor still catches the independent condition it is
best suited to detect: the runtime refresh mechanism/status file stopped
advancing altogether. It must not emit a second Spidey warning merely because
`runtime-data-refresh.status` contains `Runtime data refresh FAILED` when the
service's own readiness policy says the product remains serviceable.

Do not use freshness-only mode merely to silence an ordinary job failure. Use
it only when another documented service-owned readiness monitor is explicitly
the semantic authority.

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

Static sites do not need a root landing page solely for health monitoring.
Their generated Nginx server block exposes `/_home-server-health`, and the
local gateway check requires the matching `home-server-static:<site-key>`
identity. `publicHealthChecks` can still target a real public preview path when
end-user content availability should also be monitored.

Proxy sites without `healthBodyContains` keep their existing root-page
`expectedBodyContains` behavior.

### Restricted path proxies

A proxy hostname may expose only one reviewed public prefix while rejecting every
other path at Nginx:

```yaml
sites:
  - key: example-api
    kind: proxy
    hostnames:
      - api.example.com
    upstream: http://127.0.0.1:8080
    pathProxy:
      publicPrefix: /v1/
      upstreamPrefix: /api/v1/
    localCheckPath: /v1/openapi
    expectedStatus: 404
```

`publicPrefix` and `upstreamPrefix` must be non-root path prefixes ending in
`/`. The generated Nginx server forwards only the configured public prefix and
returns `404` for every other path on that hostname. `localCheckPath` lets the
gateway monitor verify the allowed route instead of probing the intentionally
blocked root path.

For the Aircraft Intelligence API, the dark AIR6E edge intentionally expects
`/v1/openapi`, a current lookup, and a history lookup to return the
application's bounded `404 not_found` while the Grizzly Bulls aircraft launch
gate remains off. It also checks `/api/health` for a bare `404` to prove the
restricted API hostname still blocks unrelated application routes.

These checks run through both the NUC gateway monitor and the external uptime
monitor when that monitor has the current repository checkout. They therefore
exercise real public DNS, TLS, Cloudflare, tunnel, Nginx, and application-gate
behavior without transporting an API key while the API is dark. After the
application launch gate is deliberately enabled, the same inventory must be
updated to the live AIR expectations rather than leaving dark `404` checks in
place.

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
A `config/sites.yaml`-only change is consumed directly by subsequent monitor
runs as long as the installed environment points at that repository config.

## Validate manually

Run the checks directly first:

```bash
sudo HOME_SERVER_ENV_FILE="$(pwd)/.env" bash scripts/monitor-gateway.sh
sudo HOME_SERVER_ENV_FILE="$(pwd)/.env" bash scripts/monitor-jobs.sh
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

For the Grizzly runtime authority split, a useful manual pair is:

```bash
HOME_SERVER_SKIP_CRON_DAEMON_CHECK=true node scripts/check-cron-health.mjs
curl -i http://127.0.0.1:8080/api/readiness
```

The first command should care about the terminal status file's age, not its
`status=failed` text. The second command owns the semantic healthy/degraded/
critical decision.

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
