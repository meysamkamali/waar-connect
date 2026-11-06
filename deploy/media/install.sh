#!/usr/bin/env bash
# waar Connect media server installer for the aaPanel machine (Ubuntu or Debian). Run as root
# from inside the deploy/media folder of a checkout. Safe to run again: it keeps an existing
# livekit.yaml and its secret.
#
#   sudo bash install.sh
#
# Afterwards: create the aaPanel site media.connect.waar.work (reverse proxy to 127.0.0.1:7880,
# WebSocket headers, Let's Encrypt). See ../web/README.md.

set -euo pipefail

DIR=/opt/waar-connect-media
TURN_DOMAIN=${TURN_DOMAIN:-turn.connect.waar.work}
API_KEY=${API_KEY:-waarconnect}
HERE=$(cd "$(dirname "$0")" && pwd)

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi

echo "== docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y docker.io docker-compose-v2 openssl curl
  systemctl enable --now docker
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get update
  apt-get install -y docker-compose-v2
fi
docker compose version

echo "== files in $DIR"
mkdir -p "$DIR"
install -m 644 "$HERE/docker-compose.yml" "$DIR/docker-compose.yml"
install -m 644 "$HERE/redis.conf" "$DIR/redis.conf"

if [ ! -f "$DIR/livekit.yaml" ]; then
  SECRET=$(openssl rand -hex 32)
  sed -e "s|REPLACE_WITH_A_LONG_RANDOM_SECRET|$SECRET|" \
      -e "s|waarconnect:|$API_KEY:|" \
      -e "s|turn.connect.waar.work|$TURN_DOMAIN|" \
      "$HERE/livekit.yaml.example" > "$DIR/livekit.yaml"
  chmod 600 "$DIR/livekit.yaml"
  {
    echo "LIVEKIT_URL=wss://media.connect.waar.work"
    echo "LIVEKIT_API_KEY=$API_KEY"
    echo "LIVEKIT_API_SECRET=$SECRET"
  } > "$DIR/credentials.env"
  chmod 600 "$DIR/credentials.env"
  echo "new livekit.yaml written; credentials for the web .env are in $DIR/credentials.env"
else
  echo "keeping existing livekit.yaml"
fi

echo "== firewall"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 3478/udp comment 'waar Connect TURN'
  ufw allow 7881/tcp comment 'waar Connect WebRTC TCP'
  ufw allow 7882/udp comment 'waar Connect WebRTC UDP'
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port=3478/udp --add-port=7881/tcp --add-port=7882/udp
  firewall-cmd --reload
else
  echo "no active ufw or firewalld found; open 3478/udp, 7881/tcp, 7882/udp in the aaPanel firewall or the router"
fi

echo "== start"
cd "$DIR"
docker compose pull
docker compose up -d
sleep 3
docker compose ps

echo "== check (LiveKit needs a few seconds for STUN discovery)"
for _ in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7880 || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "LiveKit answers on 127.0.0.1:7880 (HTTP $code)"
    exit 0
  fi
  sleep 2
done
echo "LiveKit did not answer; see: docker compose -f $DIR/docker-compose.yml logs livekit" >&2
exit 1
