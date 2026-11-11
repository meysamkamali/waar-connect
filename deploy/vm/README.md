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
| Gateway (NDI return into the rooms) | `waar-connect-gateway.service`, user `waarconnect`, no port; `/opt/waar-connect/apps/gateway/.env` holds the token shared with the API | systemd, `install-gateway.sh` |
| NDI runtime | `/usr/local/lib/libndi.so.6` from the NDI SDK for Linux; licence texts in `/usr/local/share/doc/ndi/` | `install-gateway.sh --accept-ndi-license` |
| Second NIC (station NDI network) | `ens37`, 10.100.1.0/24 by DHCP from the MikroTik at 10.100.1.1; `/etc/netplan/60-ens37.yaml` (from `netplan-ens37.yaml`) | netplan |

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
- **The VM's own names.** The API and the gateway reach the media server by name
  (`LIVEKIT_URL=wss://media.connect.waar.work:8443`), so the VM must not depend on those router
  overrides. `/etc/hosts` on the VM carries
  `127.0.0.1 connect.waar.work media.connect.waar.work` (added 2026-11-11, a copy of the file before
  it is `/etc/hosts.before-waar-connect-names`). That day the router stopped answering the two names
  with 10.0.0.41 and gave 10.0.0.40 instead: after the next restart the return feeds stayed at
  "frames arrive; the room is not connected yet" and the room pages answered 500, until the names
  were pinned. Devices inside the station still need the router overrides; without them the pages
  do not open by name from the LAN.

## Checks

- On the VM: `curl -s 127.0.0.1:8787/api/health` and `curl -s 127.0.0.1:7880` (answers `OK`).
- From the LAN: `curl -sk --resolve connect.waar.work:8443:10.0.0.41 https://connect.waar.work:8443/api/health`.
- From outside, after the router rules: `https://connect.waar.work:8443/` opens the launcher; a phone
  on mobile data shows `direct` in its status pill.

## Gateway

`sudo bash /opt/waar-connect/deploy/vm/install-gateway.sh --accept-ndi-license` after `install-api.sh`:
puts a shared `GATEWAY_TOKEN` into the API's and the gateway's `.env`, downloads the NDI SDK for Linux
and installs its runtime (the flag is your acceptance of the NDI SDK licence), builds, and starts
`waar-connect-gateway`. Without the flag everything but the runtime is done and the service stays
stopped. The admin then names the NDI source per studio under `/app/admin`, with the picture size and bitrate the
gateway sends for it (default 540p at 1500 kbit/s, about a quarter of 1080p to encode). NDI senders on a
subnet the VM is not on are listed under **Admin → NDI senders on other networks** (mDNS does not cross the
router); `NDI_EXTRA_IPS` in the gateway `.env` is added to that list.

### Second NIC: the station's NDI network

Since 2026-11-09 the VM has a second VMXNET3 NIC, `ens37`, on the station's NDI network
10.100.1.0/24, so NDI senders there are found by mDNS and received directly. `netplan-ens37.yaml`
is the configuration (`/etc/netplan/60-ens37.yaml`, mode 600, then `netplan apply`):

- DHCP for the address only (the MikroTik at 10.100.1.1 leases it; 10.100.1.105 at the time of
  writing). The default route and DNS stay on `ens34`, where the public port forwards arrive.
- Routing table 100 with a rule `from 10.100.1.0/24`: whatever reaches the VM on `ens37` is answered
  through `ens37`, so the host is symmetric on both networks.
- ufw allows mDNS (5353/udp) from 10.100.1.0/24 as well (`install-gateway.sh` adds both rules).
- LiveKit keeps `rtc.interfaces.includes: [ens34]`: no ICE candidates on the NDI network. Station PCs
  reach the rooms the same way as before.

Measured 2026-11-09: 10.100.1.1 and 10.0.0.1 are one router (same MAC) on two VLANs, and it does
not pass traffic from 10.100.1.0/24 to the ENG network 10.1.1.0/24. "ENG07 (WAAR PGM on ENG07)" at
10.1.1.107 therefore still arrives over `ens34` through 10.0.0.1 and stays in `NDI_EXTRA_IPS`; the
NDI network's own senders ("NDI (OUT 1)" at 10.100.1.112) no longer need an entry there.

The station has more NDI subnets than the VM has legs (2026-11-09: "PCR2-INGEST" at 10.100.2.102, reached
through 10.0.0.1 but not found by mDNS), so the admin's list (Admin → NDI senders on other networks) holds 10.1.1.107 and
10.100.2.102 for now and grows by one address per machine. Two ways out of that list: have the MikroTik repeat mDNS from the NDI VLANs
into 10.0.0.0/24 (RouterOS 7.16+, `/ip/dns set mdns-repeat-ifaces=…`), or run the NDI discovery server
(`ndi-discovery-server` ships in the SDK tarball, `bin/x86_64-linux-gnu/`) on the VM and point every NDI
sender in the station at it, which turns mDNS off on those senders. Neither is set up yet.

## Updating the app

From the development PC (the API, web and gateway build together; `.env` files stay on the VM):

```bash
C=$(git rev-parse --short HEAD); tar --exclude=node_modules --exclude=dist --exclude=.git --exclude='.env' -czf - . | ssh -i ~/.ssh/waar-connect meysam@10.0.0.41 "sudo tar -xzf - -C /opt/waar-connect && cd /opt/waar-connect && sudo npm ci --no-audit --no-fund && sudo env WC_COMMIT=$C npm run -s build && sudo chown -R waarconnect:waarconnect /opt/waar-connect && (cd apps/api && sudo -u waarconnect node --env-file=.env dist/db/migrate.js) && sudo systemctl restart waar-connect-api waar-connect-phase0 waar-connect-gateway"
```

The commit hash is read on this PC first: the VM holds no git checkout, so inside the quoted remote command it would come out empty.

That command does not touch Nginx. After a change to `nginx-connect.conf`, on the VM:

```bash
sudo install -m 644 /opt/waar-connect/deploy/vm/nginx-connect.conf /etc/nginx/sites-available/waar-connect.conf && sudo nginx -t && sudo systemctl reload nginx
```

The site's root (`/`) redirects to the landing page `/app/` since 2026-11-10; the phase 0 test page that used to answer there is at `/index.html`.
