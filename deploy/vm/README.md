# waar Connect on its own VM (inside the station)

Decided 2026-11-05: waar Connect runs on a dedicated Ubuntu VM on the station network instead of the
aaPanel server. The VM has no public IP of its own; it sits behind the station router like the aaPanel
server, with port forwarding for its own ports.

```
 internet ──TCP 8443──► router ──► VM 10.0.0.41  Nginx  ─► 127.0.0.1:8787  app (pages, tokens)
                                                      └─► 127.0.0.1:7880  LiveKit signaling
 internet ──UDP 7882 / UDP 3478 / TCP 7881 ──► router ──► VM  LiveKit media and TURN
                                   (checked 2026-11-08: UDP 7882 is forwarded; UDP 3478 is not yet)
 aaPanel 10.0.0.40 ──rsync hourly──► VM /etc/waar-connect/certs   (Let's Encrypt certificates)
```

## Why 8443 and why the certificates come from aaPanel

The station has one public IP and ports 80 and 443 on it belong to the aaPanel server. The VM
therefore serves HTTPS on **8443** and the links carry the port (`https://connect.waar.work:8443/…`).
Browsers need HTTPS for camera and microphone, not port 443. The only loss is the strict office or
hotel firewall that allows nothing but 80 and 443; that guest uses mobile data instead.

Let's Encrypt proves ownership through public port 80 or through the DNS provider's API. Port 80
belongs to aaPanel and waar.work's DNS is at GoDaddy, whose API is closed to small accounts. So aaPanel
keeps the two sites `connect.waar.work` and `media.connect.waar.work` only to issue and renew their
certificates, and an hourly job copies them to the VM. The aaPanel sites themselves answer with a
redirect to port 8443, so a link without the port still works.

## Pieces on the VM

| Piece | Where | Managed by |
|---|---|---|
| Code | `/opt/waar-connect` | this repository (copied with tar over SSH for now) |
| App | `waar-connect-phase0.service`, user `waarconnect`, port 8787 | systemd |
| App config | `/opt/waar-connect/apps/phase0/.env` (PIN, LiveKit key and secret) | root only |
| LiveKit + Redis | `/opt/waar-connect-media` (docker compose, host network), from `../media` | `docker compose` |
| Nginx | `/etc/nginx/sites-available/waar-connect.conf` (from `nginx-connect.conf`) | systemd |
| Certificates | `/etc/waar-connect/certs/<name>/{fullchain,privkey}.pem`, owner `certsync` | aaPanel job |
| Certificate reload | `waar-certs.path` → `waar-certs.service` → `/usr/local/sbin/waar-certs-apply` | systemd |
| Firewall | ufw: 22/tcp, 8443/tcp, 7881/tcp, 7882/udp, 3478/udp | ufw |
| Public IP on lo (TURN hairpin) | `waar-hairpin.service` → `/usr/local/sbin/waar-hairpin`, IP kept in `/etc/waar-connect/public-ip` | systemd |

## Install

On the VM, as a sudo user, with the repository at `/opt/waar-connect`:

```bash
sudo bash /opt/waar-connect/deploy/vm/install.sh
```

On the aaPanel server, as root, once:

```bash
install -m 755 deploy/vm/certsync-to-vm.sh /usr/local/sbin/waar-certsync
ssh-keygen -t ed25519 -f /root/.ssh/waar-certsync -N ""
echo '17 * * * * root /usr/local/sbin/waar-certsync >>/var/log/waar-certsync.log 2>&1' > /etc/cron.d/waar-certsync
```

Then put `/root/.ssh/waar-certsync.pub` into `/home/certsync/.ssh/authorized_keys` on the VM
(restricted with `from="10.0.0.40"`) and run `/usr/local/sbin/waar-certsync` once. Nginx on the VM
starts serving as soon as both certificates are present.

## Router and LAN DNS

- **Port forwarding** to 10.0.0.41: TCP 8443, TCP 7881, UDP 7882, UDP 3478. Nothing else.
- **DHCP reservation** for 10.0.0.41 (the VM takes its address from the router).
- **LAN DNS**: the router answers `*.waar.work` with 10.0.0.40 for devices inside the station. Add
  overrides so `connect.waar.work` and `media.connect.waar.work` resolve to 10.0.0.41 inside; outside,
  public DNS already points both names at the station's public IP.

## Checks

- On the VM: `curl -s 127.0.0.1:8787/api/health` and `curl -s 127.0.0.1:7880` (answers `OK`).
- From the LAN: `curl -sk --resolve connect.waar.work:8443:10.0.0.41 https://connect.waar.work:8443/api/health`.
- From outside, after the router rules: `https://connect.waar.work:8443/` opens the launcher; a phone
  on mobile data shows `direct` in its status pill.

## Updating the app

From the development PC, until the repository has a remote:

```bash
tar --exclude=node_modules --exclude=dist --exclude=.git --exclude='apps/phase0/.env' -czf - waar-connect | ssh meysam@10.0.0.41 'sudo tar -xzf - -C /opt && cd /opt/waar-connect && sudo npm ci --no-audit --no-fund && sudo npm run phase0:build && sudo chown -R waarconnect:waarconnect /opt/waar-connect && sudo systemctl restart waar-connect-phase0'
```
