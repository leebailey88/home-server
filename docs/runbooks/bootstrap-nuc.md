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

## 4. Validate and render config locally

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

## 5. Bootstrap the host

```bash
sudo bash scripts/bootstrap-nuc.sh
```

## 6. Install Nginx config

```bash
sudo HOME_SERVER_CONFIG="$(pwd)/config/sites.yaml" bash scripts/install-nginx-config.sh
```

This renders the config, installs the generated server blocks into `/etc/nginx/sites-available/home-server`, writes the aggregate enabled config to `/etc/nginx/sites-enabled/home-server.conf`, runs `nginx -t`, and reloads Nginx.

## 7. Configure Cloudflare Tunnel

Use the generated tunnel config as a starting point:

```bash
pnpm render:cloudflared
cat cloudflared/generated/config.yml
```

Then copy/adapt it to:

```text
/etc/cloudflared/config.yml
```

Reload cloudflared:

```bash
sudo systemctl restart cloudflared
sudo systemctl status cloudflared --no-pager
```

## 8. Validate the local gateway

```bash
sudo HOME_SERVER_CONFIG="$(pwd)/config/sites.yaml" bash scripts/check-health.sh
curl -fsS -H 'Host: nuc-grizzly.grizzlybulls.com' http://127.0.0.1/
```

The health check validates:

- Nginx config syntax
- `cloudflared.service` status, if installed
- each enabled site's `healthUrl`, if configured
- each enabled site's local Nginx route using its first hostname as the `Host` header

## 9. Deploy Grizzly Bulls separately

From the `grizzly-bulls` repo on WSL:

```bash
pnpm deploy:nuc
```

That app should remain bound to `127.0.0.1:8080`.
