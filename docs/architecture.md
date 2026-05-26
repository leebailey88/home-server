# Architecture

The home-server NUC uses a layered ingress model.

## Layers

1. **Cloudflare DNS / Tunnel**
   - Handles dynamic IP and avoids inbound router port forwarding.
   - Public hostnames route to local Nginx through `cloudflared`.
   - SSH remains a separate Cloudflare Access flow on `ssh.grizzlybulls.com`.

2. **Nginx local gateway**
   - Listens on `127.0.0.1:80` by default.
   - Routes by `Host` header.
   - Serves static sites directly or proxies to localhost-bound app containers.

3. **Apps / static roots**
   - Containers should bind to `127.0.0.1:<port>` only.
   - Static sites live under `/opt/nuc-web/sites/<site-key>/public`.

## Why this pattern

Cloudflare Tunnel is best at secure transport into the home network. Nginx is best at local host-based routing, static file serving, and consistent headers. Separating those concerns makes it easier to add sites without creating a new tunnel service for every app.

## Initial site

Grizzly Bulls should begin as a preview hostname:

```text
nuc-grizzly.grizzlybulls.com → cloudflared → Nginx → http://127.0.0.1:8080
```

Only after validation should `grizzlybulls.com` and `www.grizzlybulls.com` move to the NUC.
