#!/usr/bin/env bash
# The way back after switch.sh: the new server gives the service's address back and stops serving,
# then the old server is powered on by hand (it was never changed, so it comes up as it was).
# Run from the development PC.
#
#   bash deploy/vm/move/back.sh
#
# What was changed on the new server after the switch (guests, settings) stays there. To carry it
# back once the old server runs again:
#   FROM_ALIAS=waar-connect-pc bash deploy/vm/move/copy-data.sh <new server's own address> <old server>
set -euo pipefail

OLD=${OLD:-10.0.0.41}
NEW=${NEW:-10.0.0.43}
ADDR=${ADDR:-$OLD}
IFACE=${IFACE:-enp1s0f0}
NEW_ALIAS=${NEW_ALIAS:-waar-connect-pc}
KEY=${KEY:-$HOME/.ssh/waar-connect}
SSH_USER=${SSH_USER:-meysam}
NETPLAN=/etc/netplan/90-waar-connect-address.yaml

say() { echo "$(date -u +%T) $*"; }
new_at() {
  local host=$1
  shift
  ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=6 -o HostKeyAlias="$NEW_ALIAS" "$SSH_USER@$host" "$@"
}

say "the new server stops serving and gives the address $ADDR back"
new_at "$ADDR" "sudo systemctl stop waar-connect-gateway waar-connect-api waar-connect-phase0; sudo rm -f $NETPLAN && sudo systemd-run --quiet --collect --unit=waar-move-apply /usr/sbin/netplan apply" || {
  say "the new server does not answer at $ADDR. If it is already back at $NEW, only the old server needs powering on."
}
back=0
for _ in $(seq 1 40); do
  sleep 3
  if new_at "$NEW" true 2>/dev/null; then back=1; break; fi
done
[ "$back" = 1 ] && say "   the new server is at $NEW again" || say "   WARNING: the new server does not answer at $NEW yet"

say "NOW POWER THE OLD SERVER ON. Waiting up to 10 minutes for it at $OLD ..."
ok=0
for _ in $(seq 1 200); do
  sleep 3
  # the old server's own host key is the one filed under its address
  if ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=5 "$SSH_USER@$OLD" 'curl -s -m 5 127.0.0.1:8788/api/v1/health | grep -q "\"ok\":true"' 2>/dev/null; then ok=1; break; fi
done
if [ "$ok" = 1 ]; then
  ssh -i "$KEY" -o BatchMode=yes "$SSH_USER@$OLD" 'echo "   services: api $(systemctl is-active waar-connect-api), gateway $(systemctl is-active waar-connect-gateway), web $(systemctl is-active nginx)"'
  say "BACK: the old server serves at $OLD again"
else
  say "the old server does not answer healthy at $OLD yet; check it on its console"
fi
# the new server's services stay stopped until its next boot, so two servers never announce the
# same NDI names; start them by hand for more tests: sudo systemctl start waar-connect-api waar-connect-gateway
[ "$back" = 1 ] && new_at "$NEW" 'sudo systemctl restart avahi-daemon' || true
