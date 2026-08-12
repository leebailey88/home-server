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

The login flow deliberately does **not** wait for global browser `networkidle`. Modern Next.js pages may continuously prefetch or perform background requests, so `networkidle` is not a reliable signal that authentication completed. The monitor instead waits for the expected dashboard URL and visible dashboard marker.

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

It sends Discord alerts on first failure, changed failure message, and recovery.

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
