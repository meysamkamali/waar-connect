#!/usr/bin/env bash
# Runs on the aaPanel server as root (cron, hourly). Copies the Let's Encrypt certificates that the
# panel issues and renews for the waar Connect names to the VM, where waar-certs.path reloads Nginx.
#
#   install -m 755 certsync-to-vm.sh /usr/local/sbin/waar-certsync
#   echo '17 * * * * root /usr/local/sbin/waar-certsync >>/var/log/waar-certsync.log 2>&1' > /etc/cron.d/waar-certsync
#
# Key: /root/.ssh/waar-certsync (ed25519), its public half in the VM's /home/certsync/.ssh/authorized_keys.
set -euo pipefail

VM=${VM:-10.0.0.41}
SYNC_USER=certsync
KEY=/root/.ssh/waar-certsync
SRC=/www/server/panel/vhost/cert
SITES="connect.waar.work media.connect.waar.work"

for s in $SITES; do
  if [ ! -s "$SRC/$s/fullchain.pem" ] || [ ! -s "$SRC/$s/privkey.pem" ]; then
    echo "$(date -Is) no certificate for $s on this server"
    continue
  fi
  rsync -a --chmod=F640 -e "ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new" \
    "$SRC/$s/fullchain.pem" "$SRC/$s/privkey.pem" "$SYNC_USER@$VM:/etc/waar-connect/certs/$s/" \
    && echo "$(date -Is) synced $s"
done
