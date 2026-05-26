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

Start with only the preview Grizzly Bulls hostname enabled.

## 4. Bootstrap the host

```bash
sudo bash scripts/bootstrap-nuc.sh
```

## 5. Install Nginx config

```bash
sudo HOME_SERVER_CONFIG="$(pwd)/config/sites.yaml" bash scripts/install-nginx-config.sh
```

## 6. Configure Cloudflare Tunnel

Use `config/cloudflared.example.yml` as the model for `/etc/cloudflared/config.yml`.

Then reload cloudflared:

```bash
sudo systemctl restart cloudflared
sudo systemctl status cloudflared --no-pager
```

## 7. Validate

```bash
sudo HOME_SERVER_CONFIG="$(pwd)/config/sites.yaml" bash scripts/check-health.sh
curl -fsS -H 'Host: nuc-grizzly.grizzlybulls.com' http://127.0.0.1/
```

## 8. Deploy Grizzly Bulls separately

From the `grizzly-bulls` repo on WSL:

```bash
pnpm deploy:nuc
```

That app should remain bound to `127.0.0.1:8080`.
