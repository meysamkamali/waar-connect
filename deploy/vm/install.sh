#!/usr/bin/env bash
# waar Connect on its own VM behind the station router (Ubuntu 24.04). Run as root from the checkout:
#
#   sudo bash /opt/waar-connect/deploy/vm/install.sh
#
# Installs Docker, Node 24, Nginx and ufw; builds the app; starts LiveKit (deploy/media) and the app
# as systemd services; installs the Nginx site on 8443 for connect.waar.work and
# media.connect.waar.work. Certificates are not issued here: they arrive from the aaPanel server
# into /etc/waar-connect/certs (see certsync-to-vm.sh) and a path unit reloads Nginx when they change.
# Safe to run again.

set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
APP_USER=waarconnect
SYNC_USER=certsync
WEB_PORT=${WEB_PORT:-8443}
CERT_DIR=/etc/waar-connect/certs
SITES="connect.waar.work media.connect.waar.work"

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi

echo "== packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git ufw nginx docker.io docker-compose-v2 openssl rsync >/dev/null
systemctl enable --now docker >/dev/null 2>&1 || true

echo "== node"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed -E 's/^v([0-9]+).*/\1/')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

echo "== users and folders"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$REPO" --shell /usr/sbin/nologin "$APP_USER"
id -u "$SYNC_USER" >/dev/null 2>&1 || useradd --system --create-home --home /home/$SYNC_USER --shell /bin/sh "$SYNC_USER"
mkdir -p "$CERT_DIR"
for s in $SITES; do
  mkdir -p "$CERT_DIR/$s"
  chown "$SYNC_USER:$SYNC_USER" "$CERT_DIR/$s"
  chmod 750 "$CERT_DIR/$s"
done
chmod 755 /etc/waar-connect "$CERT_DIR"

echo "== firewall"
ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow "$WEB_PORT"/tcp comment 'waar Connect web + signaling' >/dev/null
ufw allow 7881/tcp comment 'waar Connect WebRTC TCP' >/dev/null
ufw allow 7882/udp comment 'waar Connect WebRTC UDP' >/dev/null
ufw allow 3478/udp comment 'waar Connect TURN' >/dev/null
ufw --force enable >/dev/null
ufw status | grep -E "^(Status|$WEB_PORT|7881|7882|3478|22)" | head -8

echo "== app build"
cd "$REPO"
npm ci --no-audit --no-fund --loglevel=error
npm run -s phase0:build | grep -E "built in|error" || true
chown -R "$APP_USER:$APP_USER" "$REPO"

echo "== media server (LiveKit + Redis)"
bash "$REPO/deploy/media/install.sh"

echo "== app environment"
ENV="$REPO/apps/phase0/.env"
if [ ! -f "$ENV" ]; then
  PIN=$(shuf -i 100000-999999 -n 1)
  {
    echo "PORT=8787"
    sed "s|^LIVEKIT_URL=.*|LIVEKIT_URL=wss://media.connect.waar.work:$WEB_PORT|" /opt/waar-connect-media/credentials.env
    echo "PHASE0_PIN=$PIN"
    echo "SOURCE_URL=https://github.com/meysamkamali/waar-connect"
  } > "$ENV"
  chown "$APP_USER:$APP_USER" "$ENV"
  chmod 600 "$ENV"
  echo "new .env written with a fresh PIN (see $ENV)"
else
  echo "keeping existing .env"
fi

echo "== services"
install -m 644 "$REPO/deploy/vm/waar-connect-phase0.service" /etc/systemd/system/waar-connect-phase0.service
install -m 644 "$REPO/deploy/vm/waar-certs.path" /etc/systemd/system/waar-certs.path
install -m 644 "$REPO/deploy/vm/waar-certs.service" /etc/systemd/system/waar-certs.service
install -m 755 "$REPO/deploy/vm/certs-apply.sh" /usr/local/sbin/waar-certs-apply
systemctl daemon-reload
systemctl enable --now waar-connect-phase0 >/dev/null
systemctl restart waar-connect-phase0
systemctl enable --now waar-certs.path >/dev/null

echo "== nginx"
install -m 644 "$REPO/deploy/vm/nginx-connect.conf" /etc/nginx/sites-available/waar-connect.conf
rm -f /etc/nginx/sites-enabled/default
/usr/local/sbin/waar-certs-apply || true

echo "== checks"
sleep 1
systemctl is-active waar-connect-phase0 | sed 's/^/app service: /'
curl -s 127.0.0.1:8787/api/health; echo
curl -s -o /dev/null -w "livekit 7880 -> %{http_code}\n" 127.0.0.1:7880
echo "certificate sync user: $SYNC_USER (add the aaPanel server's key to /home/$SYNC_USER/.ssh/authorized_keys)"
