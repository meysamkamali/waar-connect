#!/usr/bin/env bash
# waar Connect API on the VM: Postgres in Docker, .env, build, migrations, systemd service, Nginx
# location and the LiveKit webhook. Run as root after install.sh, from the checkout:
#
#   sudo bash /opt/waar-connect/deploy/vm/install-api.sh
#
# Safe to run again: keeps existing .env files and the database.
set -euo pipefail

REPO=/opt/waar-connect
DB_DIR=/opt/waar-connect-db
APP_USER=waarconnect
MEDIA_CREDS=/opt/waar-connect-media/credentials.env

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi

echo "== postgres"
mkdir -p "$DB_DIR"
install -m 644 "$REPO/deploy/vm/db/docker-compose.yml" "$DB_DIR/docker-compose.yml"
if [ ! -f "$DB_DIR/.env" ]; then
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > "$DB_DIR/.env"
  chmod 600 "$DB_DIR/.env"
fi
(cd "$DB_DIR" && docker compose up -d >/dev/null 2>&1)
for _ in $(seq 1 30); do
  if (cd "$DB_DIR" && docker compose exec -T db pg_isready -U waarconnect -d waarconnect >/dev/null 2>&1); then break; fi
  sleep 2
done
(cd "$DB_DIR" && docker compose exec -T db pg_isready -U waarconnect -d waarconnect)

echo "== api environment"
ENV="$REPO/apps/api/.env"
if [ ! -f "$ENV" ]; then
  PW=$(sed -n 's/^POSTGRES_PASSWORD=//p' "$DB_DIR/.env")
  {
    echo "PORT=8788"
    echo "DATABASE_URL=postgres://waarconnect:$PW@127.0.0.1:5432/waarconnect"
    echo "LIVEKIT_URL=wss://media.connect.waar.work:8443"
    grep -E '^LIVEKIT_API_(KEY|SECRET)=' "$MEDIA_CREDS"
    echo "PUBLIC_URL=https://connect.waar.work:8443"
    echo "SESSION_TTL_HOURS=12"
    echo "COOKIE_SECURE=1"
    echo "DEFAULT_SLOTS=4"
  } > "$ENV"
  chown "$APP_USER:$APP_USER" "$ENV"
  chmod 600 "$ENV"
  echo "new api .env written"
else
  echo "keeping existing api .env"
fi

echo "== build"
cd "$REPO"
npm ci --no-audit --no-fund --loglevel=error
npm run -s build 2>&1 | grep -E "built in|error|TS[0-9]+" || true
chown -R "$APP_USER:$APP_USER" "$REPO"

echo "== migrations"
cd "$REPO/apps/api"
sudo -u "$APP_USER" node --env-file=.env dist/db/migrate.js

echo "== service"
install -m 644 "$REPO/deploy/vm/waar-connect-api.service" /etc/systemd/system/waar-connect-api.service
systemctl daemon-reload
systemctl enable waar-connect-api >/dev/null 2>&1 || true
systemctl restart waar-connect-api

echo "== nginx"
install -m 644 "$REPO/deploy/vm/nginx-connect.conf" /etc/nginx/sites-available/waar-connect.conf
nginx -t 2>&1 | tail -1
systemctl reload nginx

echo "== livekit webhook"
LK=/opt/waar-connect-media/livekit.yaml
if ! grep -q '^webhook:' "$LK"; then
  KEY=$(sed -n 's/^LIVEKIT_API_KEY=//p' "$MEDIA_CREDS")
  printf '\nwebhook:\n  api_key: %s\n  urls:\n    - http://127.0.0.1:8788/api/v1/livekit/webhook\n' "$KEY" >> "$LK"
  (cd /opt/waar-connect-media && docker compose restart livekit >/dev/null 2>&1)
  echo "webhook added to livekit.yaml, LiveKit restarted"
else
  echo "webhook already configured"
fi

echo "== checks"
sleep 2
echo "api service: $(systemctl is-active waar-connect-api)"
curl -s 127.0.0.1:8788/api/v1/health
echo
curl -sk --resolve connect.waar.work:8443:127.0.0.1 https://connect.waar.work:8443/api/v1/health
echo
