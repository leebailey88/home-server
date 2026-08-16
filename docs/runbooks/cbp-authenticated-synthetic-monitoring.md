# Community Bank Pilot authenticated synthetic monitoring

This monitor verifies that Community Bank Pilot is not merely reachable, but usable by a synthetic banker user through the public production path.

It should run from a non-NUC host, such as a DigitalOcean droplet. The NUC-local gateway monitor checks containers, Nginx, Cloudflared, cron logs, and local/public routes. The external uptime monitor checks public URLs. This synthetic monitor adds an authenticated browser workflow.

## What it checks

The default smoke flow:

1. Opens the tenant login page.
2. Signs in with a dedicated synthetic user.
3. Waits until the browser has completed `/auth/post-login` and reached the tenant dashboard root.
4. Confirms the dashboard contains the stable `CEO dashboard` marker.
5. Visits read-only banker-facing report pages:
   - `/reports/balance-sheet`
   - `/reports/income-statement`
   - `/reports/liquidity`
   - `/reports/branch-performance`

The monitor intentionally avoids mutating production data. Do not add request-demo submission, imports, data edits, or billing actions to the recurring monitor.

Do not add `/reports/packages` or `/reports/import` to the default route list. `/reports/packages` is a namespace for package detail/export internals rather than a standalone page, and the manual `/reports/import` surface was retired when the banker workflow moved to nightly-source ingestion.

The browser blocks speculative Next.js link-prefetch requests, including `_rsc` GETs. Real page navigations are still allowed. This keeps the synthetic check focused on the routes it explicitly verifies and prevents background prefetches (including export links) from creating unnecessary load or abandoned server work when a run finishes.

The synthetic browser context also blocks service workers. Community Bank Pilot's production browser-resume service worker is a user-facing presentation-resilience layer for reconnecting discarded tabs; it must not interpose on this independent external probe. The synthetic monitor therefore certifies the underlying public network, authentication, application, and report-serving path directly rather than allowing a browser fallback layer to alter top-level navigation semantics.

The login flow deliberately does **not** wait for global browser `networkidle`. Modern Next.js pages may continuously prefetch or perform background requests, so `networkidle` is not a reliable signal that authentication completed. The monitor instead waits for the expected dashboard URL and visible dashboard marker.

A Playwright URL-wait exception is also not independently authoritative after Chromium has already committed the exact tenant dashboard root. Browser navigation bookkeeping can report a superseded navigation as `ERR_ABORTED` even though the intended document has committed. In that one case the monitor continues to the existing semantic dashboard-marker and page-health checks. It does **not** recover URL-wait failures while still on `/auth/post-login`, `/login`, another origin, or any other tenant path. The dashboard marker remains mandatory, so this hardening does not turn an incomplete or broken dashboard into a passing check.

## Authenticated failure semantics

The synthetic monitor treats the tenant dashboard root as the only successful post-login destination. Failure output includes a stable `Failure stage` and `Failure class` so incidents can be correlated with application-side health evidence without parsing Playwright prose.

Important classes include:

- `workspace_setup_misroute` — an already configured tenant synthetic user reached the apex `/auth/setup-workspace` route. This is terminal and fails immediately rather than consuming the full navigation timeout.
- `post_login_stalled` — the browser remained on the tenant `/auth/post-login` route until the navigation timeout.
- `login_not_completed` — authenticated navigation returned to the tenant login route.
- `dashboard_navigation_timeout` — navigation stayed on the tenant origin but never reached the dashboard root.
- `report_check_failed` — authentication completed, but a configured banker-facing report navigation or validation failed.

If an interrupted URL wait is recovered only because the browser has already committed the exact tenant dashboard root, the `Visited:` evidence includes `dashboard:navigation-wait-recovered` before the mandatory `dashboard:ok` marker. This preserves the navigation anomaly as safe diagnostic evidence without paging on it by itself.

Do not suppress these failures because a hosting/provider incident is known. The monitor represents customer-visible usability. Provider status may enrich incident diagnosis, but it must not turn a real authenticated failure into a passing check.

Failed runs also retain a bounded document-navigation trail. Each observation contains only `origin + pathname + HTTP status`; query strings, fragments, headers, request/response bodies, cookies, and credentials are never recorded. Playwright error output is reduced to its first concise line for the same reason. Keep this metadata-only boundary when extending diagnostics.

## Install on the droplet

From the `home-server` repo on the droplet:

```bash
git checkout main
git pull --ff-only origin main
pnpm install --frozen-lockfile

sudo bash scripts/install-cbp-synthetic-monitor.sh
```

The installer creates:

- `/etc/home-server-cbp-synthetic-monitor.env`
- `/etc/systemd/system/home-server-cbp-synthetic-monitor.service`
- `/etc/systemd/system/home-server-cbp-synthetic-monitor.timer`
- `/var/lib/home-server-synthetic-monitor`
- `/var/log/home-server-synthetic-monitor`

It also installs Playwright Chromium.

## Configure

```bash
sudo nano /etc/home-server-cbp-synthetic-monitor.env
```

Required values:

```bash
CBP_SYNTHETIC_BASE_URL=https://communitybankpilot.com
CBP_SYNTHETIC_TENANT_SLUG=REPLACE_WITH_TENANT_SLUG
CBP_SYNTHETIC_EMAIL=REPLACE_WITH_SYNTHETIC_USER_EMAIL
CBP_SYNTHETIC_PASSWORD=REPLACE_WITH_SYNTHETIC_USER_PASSWORD
CBP_SYNTHETIC_EXPECT_DASHBOARD_TEXT=CEO dashboard
CBP_SYNTHETIC_READ_ONLY_PATHS=/reports/balance-sheet,/reports/income-statement,/reports/liquidity,/reports/branch-performance
DISCORD_MONITOR_CRITICAL_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_MONITOR_RECOVERY_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_MONITOR_WARNING_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

If tenant routing needs a fully explicit origin, set:

```bash
CBP_SYNTHETIC_TENANT_URL=https://tenant.communitybankpilot.com
```

## Test

```bash
sudo systemctl start home-server-cbp-synthetic-monitor.service
sudo journalctl -u home-server-cbp-synthetic-monitor.service -n 200 --no-pager
```

A successful run should record `dashboard:ok` and each configured report path in the `Visited:` summary. If the previous state was firing, the first successful run also sends the recovery alert and clears the saved failure state.

A successful run that recovered only an interrupted Playwright URL wait after the exact dashboard URL had already committed records `dashboard:navigation-wait-recovered | dashboard:ok`. The semantic dashboard and all configured report checks still must pass.

A failed run should include `Failure stage`, `Failure class`, `Current URL`, the bounded `Documents` trail, screenshot path when available, and the explicit routes already visited. The saved state also keeps the last failure stage/class; a changed failure class can produce a new alert even if the concise error line is unchanged.

## Timer

```bash
systemctl status home-server-cbp-synthetic-monitor.timer --no-pager
systemctl list-timers | grep cbp-synthetic
```

Default cadence is every 15 minutes. Override during install:

```bash
sudo CBP_SYNTHETIC_MONITOR_INTERVAL=30min bash scripts/install-cbp-synthetic-monitor.sh
```

## Alert behavior

The monitor keeps state in:

```text
/var/lib/home-server-synthetic-monitor/cbp-authenticated-smoke-state.json
```

It sends Discord alerts on first failure, changed failure message/class, and recovery.

Screenshots from failed browser runs are written to:

```text
/var/log/home-server-synthetic-monitor
```

## Safe failure test

Temporarily set an impossible expected dashboard text:

```bash
sudo sed -i 's/^CBP_SYNTHETIC_EXPECT_DASHBOARD_TEXT=.*/CBP_SYNTHETIC_EXPECT_DASHBOARD_TEXT=THIS_TEXT_SHOULD_NOT_EXIST/' /etc/home-server-cbp-synthetic-monitor.env
sudo systemctl start home-server-cbp-synthetic-monitor.service
```

Confirm a Discord failure alert, then restore:

```bash
sudo sed -i 's/^CBP_SYNTHETIC_EXPECT_DASHBOARD_TEXT=.*/CBP_SYNTHETIC_EXPECT_DASHBOARD_TEXT=CEO dashboard/' /etc/home-server-cbp-synthetic-monitor.env
sudo systemctl start home-server-cbp-synthetic-monitor.service
```

Confirm a Discord recovery alert.
