# home-server

Infrastructure tooling for the Grizzly Bulls home-server NUC.

This repo manages the shared web gateway layer for a home-hosted NUC that runs multiple mostly-static sites and app containers behind Cloudflare Tunnel.

## Goals

- Keep all public web traffic behind Cloudflare Tunnel.
- Route multiple hostnames through one local Nginx reverse proxy.
- Keep app containers bound to `127.0.0.1` only.
- Make site routing declarative through `config/sites.yaml`.
- Generate Nginx and Cloudflare Tunnel config from the same site registry.
- Provide lightweight health checks, systemd monitoring, and repeatable bootstrap scripts.
- Avoid interfering with the existing `money-bot` Docker instances and IB Gateway containers.

## Target architecture

```text
Internet
  ↓
Cloudflare DNS / Access / Tunnel
  ↓
cloudflared on the NUC
  ↓
Nginx on the NUC
  ↓
localhost-bound apps and static roots
    - grizzly-bulls       127.0.0.1:8080
    - future-static-site  /opt/nuc-web/sites/<site>/public
    - future-next-site    127.0.0.1:8081
```

## Repo layout

```text
config/
  sites.example.yaml             Example declarative site registry
  cloudflared.example.yml        Handwritten Cloudflare Tunnel example
cloudflared/generated/           Generated tunnel config, ignored by git
nginx/
  templates/                     Nginx server block templates
  generated/                     Generated Nginx config, ignored by git
scripts/
  bootstrap-nuc.sh               Installs base host packages for the web gateway
  validate-sites-config.mjs      Validates config/sites.yaml or the example fallback
  render-nginx-config.mjs        Generates Nginx config from sites.yaml
  render-cloudflared-config.mjs  Generates Cloudflare Tunnel config from sites.yaml
  install-nginx-config.sh        Installs rendered config and reloads Nginx
  install-cloudflared-config.sh  Installs rendered tunnel config and restarts cloudflared
  check-health.sh                Checks Nginx, cloudflared, upstreams, and host routes
  monitor-gateway.sh             Stateful monitor wrapper with optional Discord alerts
  install-monitor-service.sh     Installs the systemd monitor service/timer
  lib/                           Shared shell and Node helpers
systemd/                         systemd service/timer templates
docs/
  architecture.md                System design notes
  runbooks/bootstrap-nuc.md      First-host setup steps
  runbooks/monitoring.md         Gateway monitor operations
```

## Quick start

Install dependencies locally:

```bash
corepack enable
pnpm install
```

Create your real site registry from the example:

```bash
cp config/sites.example.yaml config/sites.yaml
```

Validate the site registry:

```bash
pnpm validate:sites
```

Render Nginx and Cloudflare Tunnel config locally for inspection:

```bash
pnpm render:nginx
pnpm render:cloudflared
```

Validate formatting and scripts:

```bash
pnpm validate
```

On the NUC, once this repo is cloned:

```bash
sudo bash scripts/bootstrap-nuc.sh
sudo HOME_SERVER_CONFIG="$(pwd)/config/sites.yaml" bash scripts/install-nginx-config.sh
sudo HOME_SERVER_CONFIG="$(pwd)/config/sites.yaml" bash scripts/check-health.sh
```

To install the optional repeating gateway monitor:

```bash
cp .env.example .env
nano .env
sudo HOME_SERVER_ENV_FILE="$(pwd)/.env" bash scripts/install-monitor-service.sh
```

## Initial production convention

Reserve ports like this unless there is a strong reason to change them:

|  Port | Service                                        |
| ----: | ---------------------------------------------- |
|  8080 | Grizzly Bulls                                  |
|  8081 | Static site / future app #1                    |
|  8082 | Static site / future app #2                    |
| 8090+ | Internal/admin tools                           |
|  400x | Existing money-bot / IB Gateway host API ports |

Keep public HTTP ports closed. Nginx should listen on localhost and receive traffic from `cloudflared`.

## Safety notes

- Do not bind app containers to `0.0.0.0` unless deliberately exposing on LAN.
- Prefer `127.0.0.1:<port>` for every app container.
- Keep SSH Cloudflare Access separate from web hostnames.
- Stage Grizzly Bulls at `nuc-grizzly.grizzlybulls.com` before moving production DNS.
- Keep the existing production droplet available until NUC hosting has run cleanly for several days.
