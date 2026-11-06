# The aaPanel server

**Since the evening of 2026-11-05 waar Connect no longer runs here.** It moved to its own VM
(`../vm/README.md`). The aaPanel server keeps two small jobs only:

1. The sites `connect.waar.work` (with `connect.waarmedia.com`) and `media.connect.waar.work` still
   exist so the panel issues and renews their Let's Encrypt certificates; their proxy config is a
   `301` to `https://$host:8443$request_uri`, so links without the port still land on the VM.
2. `/usr/local/sbin/waar-certsync` (from `../vm/certsync-to-vm.sh`, cron `/etc/cron.d/waar-certsync`,
   key `/root/.ssh/waar-certsync`) copies the certificates to the VM every hour.

`bt-api.py` stays useful for re-issuing a certificate, for example once `connect.waarmedia.com` has
DNS: `python3 /root/waar-connect-tools/bt-api.py ssl connect.waar.work connect.waarmedia.com`.

The rest of this file describes the first deployment, which ran entirely on this machine for one
afternoon, and is kept as a reference.

---

Everything runs here: the pages and token server (later the full apps and API) as an aaPanel Node
project behind Nginx, and LiveKit in Docker next to it (`../media/README.md`).

## Sites

| aaPanel site | Domains | What it does |
|---|---|---|
| `connect.waar.work` | `connect.waar.work`, `connect.waarmedia.com` | reverse proxy to the Node app on `127.0.0.1:8787` |
| `media.connect.waar.work` | `media.connect.waar.work` | reverse proxy to LiveKit on `127.0.0.1:7880` (WebSocket) |

Both sites get Let's Encrypt certificates and forced HTTPS. Camera and microphone access in browsers
needs HTTPS; there is no HTTP mode. Issue the main site's certificate for `connect.waar.work` alone
first and re-issue with both names once `connect.waarmedia.com` points here, or the request fails.

## What is installed (done 2026-11-05 over SSH)

| Piece | Where | Managed by |
|---|---|---|
| Code | `/www/wwwroot/waar-connect` (copied, not a git clone yet) | this repository |
| App service | `waar-connect-phase0.service` (systemd, user `www`, Node from `/usr/bin/node`) | `systemctl` |
| App config | `/www/wwwroot/waar-connect/apps/phase0/.env` (PIN, LiveKit key and secret) | root only |
| LiveKit + Redis | `/opt/waar-connect-media` (docker compose, host network) | `docker compose` |
| Sites | `connect.waar.work` (+ `connect.waarmedia.com`), `media.connect.waar.work` | aaPanel (certificates renew there) |
| Proxy configs | `/www/server/panel/vhost/nginx/proxy/<site>/waarconnect_<site>.conf` from `nginx/` here | this repository |
| Firewall | ufw: 3478/udp, 7881/tcp, 7882/udp added; 7880 stays closed | ufw |

The sites were created through the panel's own API with `bt-api.py` (run on the server as root; it
reads the panel's API token from the panel's config and never prints it). The panel's reverse-proxy
endpoint is not reachable through the API, so the proxy files are installed by hand in the same
layout the panel uses, and `enable-php` is commented out in both vhosts because nothing there is PHP.

## Steps (to repeat on a fresh machine)

1. **Node.** Node 22.18 or newer system-wide (`/usr/bin/node`); the server runs the built JavaScript.
2. **Code.** Put the repository at `/www/wwwroot/waar-connect`, then `npm ci` and
   `npm run phase0:build`. Create `apps/phase0/.env` from `.env.example`; take `LIVEKIT_URL`,
   `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from `/opt/waar-connect-media/credentials.env` after
   running the media installer, and choose a `PHASE0_PIN`. `chown www:www` and `chmod 600` it.
3. **Media server.** `cd deploy/media && sudo bash install.sh` (see `../media/README.md`).
4. **App service.** Install `waar-connect-phase0.service` (unit text below), then
   `systemctl daemon-reload && systemctl enable --now waar-connect-phase0`.
5. **Sites.** `python3 deploy/web/bt-api.py add-site connect.waar.work connect.waarmedia.com`,
   `… add-site media.connect.waar.work`, `… ssl connect.waar.work`, `… ssl media.connect.waar.work`
   (Let's Encrypt over HTTP-01; the names must resolve publicly and port 80 must reach the machine).
   Re-run `ssl connect.waar.work connect.waarmedia.com` once the second domain's DNS points here.
6. **Proxy configs.** Copy `nginx/<site>.proxy.conf` to
   `/www/server/panel/vhost/nginx/proxy/<site>/waarconnect_<site>.conf`, add
   `include /www/server/panel/vhost/nginx/proxy/<site>/*.conf;` above `#REWRITE-START` in the vhost,
   comment out `include enable-php…`, then `nginx -t && nginx -s reload`.
7. **Firewall and router.** ufw: 3478/udp, 7881/tcp, 7882/udp (the installer does it). On the station
   router forward TCP 80, 443, 7881 and UDP 3478, 7882 from the public IP to this machine. Keep 7880
   closed; it is loopback only.

## systemd unit

```ini
[Unit]
Description=waar Connect phase 0 (token server and pages)
After=network.target docker.service

[Service]
Type=simple
User=www
Group=www
WorkingDirectory=/www/wwwroot/waar-connect/apps/phase0
ExecStart=/usr/bin/node --env-file=/www/wwwroot/waar-connect/apps/phase0/.env /www/wwwroot/waar-connect/apps/phase0/dist/server/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

## Checks

- `https://connect.waar.work/api/health` returns `{"ok":true,...}` with the LiveKit URL.
- `https://media.connect.waar.work` returns `OK`.
- The launcher at `https://connect.waar.work/` shows the "Source code" link in the footer.
- A guest page joined from a phone on mobile data shows `direct` in its stats panel; `relay` means
  only TURN got through; no connection at all means the router does not forward the media ports.

## Updating the app

From this PC (until the repository has a remote): copy the tree with `tar` over SSH excluding
`node_modules`, `dist`, `.git` and `.env`, then on the server:

```bash
cd /www/wwwroot/waar-connect && npm ci && npm run phase0:build && chown -R www:www . && systemctl restart waar-connect-phase0
```
