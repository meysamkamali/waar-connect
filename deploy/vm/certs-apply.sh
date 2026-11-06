#!/usr/bin/env bash
# Enables the waar Connect Nginx site once both certificates exist, then tests and reloads Nginx.
# Installed as /usr/local/sbin/waar-certs-apply; run by waar-certs.path whenever a certificate changes.
set -euo pipefail

CERT_DIR=/etc/waar-connect/certs
SITE_AVAILABLE=/etc/nginx/sites-available/waar-connect.conf
SITE_ENABLED=/etc/nginx/sites-enabled/waar-connect.conf

for s in connect.waar.work media.connect.waar.work; do
  if [ ! -s "$CERT_DIR/$s/fullchain.pem" ] || [ ! -s "$CERT_DIR/$s/privkey.pem" ]; then
    echo "waiting for certificate of $s in $CERT_DIR/$s"
    exit 0
  fi
done

ln -sf "$SITE_AVAILABLE" "$SITE_ENABLED"
if nginx -t >/dev/null 2>&1; then
  if systemctl is-active --quiet nginx; then
    systemctl reload nginx
  else
    systemctl start nginx
  fi
  echo "nginx reloaded with certificates: $(openssl x509 -in "$CERT_DIR/connect.waar.work/fullchain.pem" -noout -enddate)"
else
  nginx -t
  exit 1
fi
