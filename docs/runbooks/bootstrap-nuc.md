# Bootstrap the NUC web gateway

## 1. Clone the repo

```bash
mkdir -p ~/projects
cd ~/projects
git clone git@github.com:leebailey88/home-server.git
cd home-server
```

## 2. Install local tooling

```bash
corepack enable
pnpm install
```

## 3. Create the site registry

```bash
cp config/sites.example.yaml config/sites.yaml
nano config/sites.yaml
```

Start with only the preview Grizzly Bulls hostname enabled:

```text
nuc-grizzly.grizzlybulls.com
```

Leave `grizzlybulls.com` and `www.grizzlybulls.com` commented out until the NUC preview hostname has been stable.

## 4. Create the local environment file

```bash
cp .env.example .env
nano .env
```

At minimum, make sure `HOME_SERVER_CONFIG` points at the real NUC checkout path:

```bash
HOME_SERVER_CONFIG=/home/lee/projects/home-server/config/sites.yaml
```

Add Discord monitor webhooks later if desired.

## 5. Validate and render config locally

```bash
pnpm validate:sites
pnpm render:nginx
pnpm render:cloudflared
```

The generated files are ignored by git:

```text
nginx/generated/*.conf
cloudflared/generated/config.yml
```

## 6. Bootstrap the host

```bash
sudo bash scripts/bootstrap-nuc.sh
```

## 7. Install Nginx config

```bash
sudo HOME_SERVER_CONFIG="$(pwd)/config/sites.yaml" bash scripts/install-nginx-config.sh
```

This renders the config, installs the generated server blocks into `/etc/nginx/sites-available/home-server`, writes the aggregate enabled config to `/etc/nginx/sites-enabled/home-server.conf`, runs `nginx -t`, and reloads Nginx.

## 8. Configure Cloudflare Tunnel

Use the generated tunnel config as a starting point:

```bash
pnpm render:cloudflared
cat cloudflared/generated/config.yml
```

If the generated config is ready for the NUC, install it with:

```bash
sudo HOME_SERVER_CONFIG="$(pwd)/config/sites.yaml" bash scripts/install-cloudflared-config.sh
```

Or manually copy/adapt it to:

```text
/etc/cloudflared/config.yml
```

Reload cloudflared manually if you do not use the installer:

```bash
sudo systemctl restart cloudflared
sudo systemctl status cloudflared --no-pager
```

## 9. Validate the local gateway

```bash
sudo HOME_SERVER_CONFIG="$(pwd)/config/sites.yaml" bash scripts/check-health.sh
curl -fsS -H 'Host: nuc-grizzly.grizzlybulls.com' http://127.0.0.1/
```

The health check validates:

- Nginx config syntax
- `cloudflared.service` status, if installed
- each enabled site's `healthUrl`, if configured
- each enabled site's local Nginx route using its first hostname as the `Host` header

## 10. Install optional repeating monitoring

```bash
sudo HOME_SERVER_ENV_FILE="$(pwd)/.env" bash scripts/install-monitor-service.sh
```

Inspect it with:

```bash
sudo systemctl status home-server-gateway-monitor.timer --no-pager
sudo journalctl -u home-server-gateway-monitor.service -o cat -n 100
```

See `docs/runbooks/monitoring.md` for alert behavior and operations.

## 11. Deploy Grizzly Bulls separately

From the `grizzly-bulls` repo on WSL:

```bash
pnpm deploy:nuc
```

That app should remain bound to `127.0.0.1:8080`.
