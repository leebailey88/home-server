# External uptime monitoring

The NUC gateway monitor checks local upstreams, local Nginx routes, public routes, and cron logs from the NUC itself. That is useful, but it cannot alert if the NUC, Cloudflare Tunnel, DNS path, internet connection, or power is unavailable.

Run the external uptime monitor from a separate host such as a small DigitalOcean droplet. It reads `config/sites.yaml` and checks enabled `publicHealthChecks` for all enabled sites.

## What it checks

The external monitor checks only public URLs from `publicHealthChecks`, including expected HTTP status and optional `expectedBodyContains`.

It does not check local Nginx routes, Docker containers, cron logs, or Supabase heartbeats. Those remain NUC-local responsibilities.

## Install on a droplet

Clone or pull this repo on the droplet, then run:

```bash
cd /opt/home-server
sudo bash scripts/install-external-uptime-monitor.sh
```

Edit the env file and add Discord webhook URLs:

```bash
sudo nano /etc/home-server-external-uptime-monitor.env
```

Run one check manually:

```bash
sudo systemctl start home-server-external-uptime-monitor.service
sudo journalctl -u home-server-external-uptime-monitor.service -n 200 --no-pager
```

Check the timer:

```bash
systemctl status home-server-external-uptime-monitor.timer --no-pager
systemctl list-timers | grep home-server-external-uptime-monitor
```

## State and alert behavior

The monitor stores state in `/var/lib/home-server-external-monitor/state.json` by default.

It sends Discord alerts on:

- first transition into failure
- newly failing endpoint while already failing
- recovery after a prior failure

It intentionally avoids sending a Discord message on every failed timer run.

## Updating site checks

Update `config/sites.yaml` in this repo and deploy/pull that change onto the external droplet. The monitor uses the same `publicHealthChecks` list as the NUC gateway monitor, so public endpoint inventory stays centralized in one place.
