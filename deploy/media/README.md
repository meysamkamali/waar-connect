# Media server (LiveKit)

LiveKit with its embedded TURN server and a private Redis, in Docker with host networking. The same
files serve any host: today the dedicated VM (`../vm/README.md`), for one afternoon the aaPanel
server. A reverse proxy on the same machine terminates TLS for the signaling WebSocket and talks to
127.0.0.1:7880.

```
 guests ──wss 443──► Nginx (media.connect.waar.work) ──► 127.0.0.1:7880  LiveKit signaling
 guests ──UDP 7882 / TCP 7881 ────────────────────────► LiveKit media
 guests ──UDP 3478 ───────────────────────────────────► LiveKit TURN
```

## What TURN can and cannot do here

Port 443 belongs to Nginx on this machine, TCP and UDP (HTTP/3 is enabled), so TURN over TLS on 443
is not possible on one IP address. TURN runs on the standard UDP 3478, with WebRTC over TCP 7881 as
the fallback for networks that block UDP. That covers mobile networks, home and most office networks.
The strict corporate or hotel firewall that allows only TCP 443 is the one case that will fail; such a
guest switches to mobile data. If that case ever matters, the fix is a second public IP for TURN over
TLS 443, not a second server.

## DNS (all to this machine's IP)

| Record | Purpose |
|---|---|
| `connect.waar.work` | the pages and the API |
| `connect.waarmedia.com` | same site, pointed later |
| `media.connect.waar.work` | LiveKit signaling (WebSocket over TLS) |
| `turn.connect.waar.work` | TURN hostname advertised to clients |

## Firewall (inbound)

| Port | Protocol | Purpose |
|---|---|---|
| 80, 443 | TCP | Nginx (already open for aaPanel sites) |
| 3478 | UDP | TURN and STUN |
| 7881 | TCP | WebRTC over TCP when UDP is blocked |
| 7882 | UDP | all WebRTC media (single muxed port) |

Do not open 7880; it is bound to 127.0.0.1 and reached only through Nginx. `install.sh` adds the
three new rules to ufw or firewalld when one is active; otherwise add them in aaPanel → Security.

## Install

On the server, as root, from a checkout of this repository:

```bash
cd /www/wwwroot/waar-connect/deploy/media && sudo bash install.sh
```

The script installs Docker if missing, writes `/opt/waar-connect-media/livekit.yaml` with a fresh
secret, opens the firewall ports, starts LiveKit and Redis, and checks that LiveKit answers. The key
and secret for the web `.env` are left in `/opt/waar-connect-media/credentials.env`.

Then create the site `media.connect.waar.work` in aaPanel with a reverse proxy to `127.0.0.1:7880`
and a Let's Encrypt certificate; the exact Nginx snippet is in `../web/README.md`.

## Checks

- `curl http://127.0.0.1:7880` on the server returns `OK`.
- `curl https://media.connect.waar.work` from anywhere returns `OK`.
- The guest page's stats panel shows `direct` on a normal network and `relay` with `relay=1`.
- `docker compose -f /opt/waar-connect-media/docker-compose.yml logs livekit` shows
  "Starting TURN server" at start-up.

## Upgrade

Change the image tag in `docker-compose.yml`, copy it to `/opt/waar-connect-media`, then
`docker compose pull && docker compose up -d` there. Read the LiveKit release notes first.

## Later (phase 1)

- Egress worker for ISO recordings: a second compose service sharing the Redis on 6380.
- Webhook URL in `livekit.yaml` pointing at connect-api.
- Prometheus metrics on 6789 for the engineer's station view.
- Sizing: each guest costs about 3 Mbps in and up to 3 Mbps out per receiver; six guests with the
  gateway and a producer stay under 60 Mbps. Watch CPU on the aaPanel machine during the first shows.
