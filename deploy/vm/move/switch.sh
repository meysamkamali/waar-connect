#!/usr/bin/env bash
# Moves the live service from the old server to the new one. Run from the development PC, at a
# quiet time, with someone at hand who can power the old server on again if it has to come back.
#
# In order:
#   1. checks both servers; refuses while a guest is connected or an NDI output runs on the old one
#   2. stops the API and the gateway on the old server (from here on nobody can join)
#   3. copies the database old -> new (copy-data.sh)
#   4. powers the old server off. It is the way back and is not changed in any way: see back.sh
#   5. gives the new server the service's address (a static address in netplan), under a safety
#      timer that puts its own address back if the server cannot be reached at the new one
#   6. restarts the services on the new server and checks them through the public names
#
#   bash deploy/vm/move/switch.sh               # the real switch
#   REHEARSE=1 bash deploy/vm/move/switch.sh    # steps 5 and 6 only, with the new server's own
#                                               # address made static, then put back: proves the
#                                               # address change and the safety timer work
#
# The old server must stay off afterwards: the router's DHCP reservation gives it the same address.
set -euo pipefail

OLD=${OLD:-10.0.0.41}            # the old server, which holds the service's address today
NEW=${NEW:-10.0.0.43}            # the new server's own address (DHCP)
ADDR=${ADDR:-$OLD}               # the address the service lives at: the router forwards the public
                                 # ports to it and the LAN DNS points the names at it
PREFIX=${PREFIX:-24}
GATEWAY=${GATEWAY:-10.0.0.1}
DNS=${DNS:-10.0.0.1}
IFACE=${IFACE:-enp1s0f0}         # the new server's port on the server LAN
NEW_ALIAS=${NEW_ALIAS:-waar-connect-pc} # the name the new server's SSH host key is filed under
KEY=${KEY:-$HOME/.ssh/waar-connect}
SSH_USER=${SSH_USER:-meysam}
REHEARSE=${REHEARSE:-0}
FORCE=${FORCE:-0}                # 1: switch although a guest is connected
HERE=$(cd "$(dirname "$0")" && pwd)
NETPLAN=/etc/netplan/90-waar-connect-address.yaml
[ "$REHEARSE" = 1 ] && ADDR=$NEW

say() { echo "$(date -u +%T) $*"; }
die() { say "STOPPED: $*"; exit 1; }
old() { ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=8 "$SSH_USER@$OLD" "$@"; }
new_at() { # new_at <address> <command>: the new server, wherever it is
  local host=$1
  shift
  ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=6 -o HostKeyAlias="$NEW_ALIAS" "$SSH_USER@$host" "$@"
}
answers() { timeout 3 bash -c "</dev/tcp/$1/22" 2>/dev/null; }

# ---- 1. checks ---------------------------------------------------------------------------------------------
say "checking the new server ($NEW)"
new_at "$NEW" true || die "the new server does not answer at $NEW (host key name: $NEW_ALIAS)"
new_at "$NEW" "bash -s" <<EOF || die "the new server is not ready"
set -e
for u in waar-connect-api waar-connect-gateway nginx docker avahi-daemon; do
  systemctl is-active --quiet \$u || { echo "   not running: \$u"; exit 1; }
done
curl -s -m 5 127.0.0.1:8788/api/v1/health | grep -q '"ok":true' || { echo "   the API is not healthy"; exit 1; }
for s in connect.waar.work media.connect.waar.work; do
  sudo openssl x509 -in /etc/waar-connect/certs/\$s/fullchain.pem -noout -checkend 604800 >/dev/null || { echo "   certificate of \$s is missing or ends within a week"; exit 1; }
done
command -v arping >/dev/null || { echo "   arping is not installed (apt install iputils-arping)"; exit 1; }
ip -br link show $IFACE >/dev/null || { echo "   no interface $IFACE"; exit 1; }
[ ! -e $NETPLAN ] || { echo "   $NETPLAN exists already: this server was switched before"; exit 1; }
sudo ufw status | grep -q '^Status: active' && echo "   firewall: on" || echo "   WARNING: the firewall is off (sudo bash /opt/waar-connect/deploy/vm/firewall.sh)"
ip -br -4 addr | grep -q ' 10\.100\.1\.' && echo "   NDI network: connected" || echo "   WARNING: no address on the NDI network 10.100.1.0/24 (second port not plugged in?)"
echo "   services, certificates and tools: ready"
EOF

if [ "$REHEARSE" != 1 ]; then
  say "checking the old server ($OLD)"
  old true || die "the old server does not answer at $OLD"
  BUSY=$(old 'bash -s' <<'EOF'
api=http://127.0.0.1:8788/api/v1
n=0
for id in $(curl -s -m 5 -H "x-wc-role: admin" $api/pcrs | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s).pcrs)console.log(p.id)})'); do
  c=$(curl -s -m 5 -H "x-wc-role: producer" $api/pcrs/$id/room | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).snapshot.connected.filter(x=>x.startsWith("guest:")).length)})') || exit 1
  n=$((n + c))
done
o=$(curl -s -m 5 -H "x-wc-role: admin" $api/gateway/status | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log((JSON.parse(s).status?.outputs??[]).length)})') || exit 1
echo "$n $o"
EOF
  ) || die "could not ask the old server whether it is in use"
  say "   guests connected and NDI outputs running on the old server: ${BUSY:-no answer}"
  if [ "$BUSY" != "0 0" ] && [ "$FORCE" != 1 ]; then die "the old server is in use; wait for a quiet moment (FORCE=1 switches anyway)"; fi

  # ---- 2. the old server stops taking guests ---------------------------------------------------------------
  say "stopping the API and the gateway on the old server"
  old 'sudo systemctl stop waar-connect-gateway waar-connect-api waar-connect-phase0'

  # ---- 3. the data -----------------------------------------------------------------------------------------
  if ! TO_ALIAS="$NEW_ALIAS" KEY="$KEY" SSH_USER="$SSH_USER" bash "$HERE/copy-data.sh" "$OLD" "$NEW"; then
    say "the copy failed: starting the old server's services again, nothing has moved"
    old 'sudo systemctl start waar-connect-api waar-connect-phase0 && sleep 3 && sudo systemctl start waar-connect-gateway'
    die "data copy failed"
  fi

  # ---- 4. the old server goes off --------------------------------------------------------------------------
  say "powering the old server off"
  old 'sudo systemctl poweroff' || true
  gone=0
  for _ in $(seq 1 60); do
    if answers "$OLD"; then gone=0; else gone=$((gone + 1)); fi
    [ "$gone" -ge 3 ] && break
    sleep 2
  done
  [ "$gone" -ge 3 ] || die "the old server still answers at $OLD after two minutes: not taking its address. Power it off by hand and run this again, or start its services (it was only stopped, nothing else changed)"
  say "   the old server is off"
fi

# ---- 5. the address ------------------------------------------------------------------------------------------
say "giving the new server the address $ADDR/$PREFIX (safety timer: 4 minutes)"
new_at "$NEW" "bash -s" <<EOF
set -e
sudo systemctl stop waar-move-revert.timer 2>/dev/null || true
sudo systemctl reset-failed waar-move-revert.service waar-move-apply.service 2>/dev/null || true
sudo tee $NETPLAN >/dev/null <<'YAML'
# Written by deploy/vm/move/switch.sh: this server holds the service's address, statically.
# Removing this file and running "netplan apply" gives it its own DHCP address back (back.sh).
network:
  version: 2
  ethernets:
    $IFACE:
      dhcp4: false
      addresses: [$ADDR/$PREFIX]
      routes:
        - to: default
          via: $GATEWAY
      nameservers:
        addresses: [$DNS]
YAML
sudo chmod 600 $NETPLAN
sudo netplan generate
# If nobody cancels this within 4 minutes, the file goes and the server is back at its own address.
sudo systemd-run --quiet --collect --unit=waar-move-revert --on-active=240 /bin/sh -c 'rm -f $NETPLAN; netplan apply'
# Applied by its own unit: this SSH session dies with the old address. The unit then tells the
# router and the neighbours which machine holds the address now (their ARP entry still names the
# old server), so the server is reachable there at once.
sudo systemd-run --quiet --collect --unit=waar-move-apply /bin/sh -c "netplan apply; sleep 3; arping -U -c 4 -I $IFACE $ADDR"
EOF

up=0
for _ in $(seq 1 40); do
  sleep 3
  if new_at "$ADDR" true 2>/dev/null; then up=1; break; fi
done
if [ "$up" != 1 ]; then
  say "the new server does not answer at $ADDR; waiting for the safety timer to put its own address back"
  for _ in $(seq 1 80); do
    sleep 3
    if new_at "$NEW" true 2>/dev/null; then say "   it is back at $NEW"; break; fi
  done
  die "the address change did not work. The old server is off: power it on to bring the service back (it was not changed)"
fi
new_at "$ADDR" 'sudo systemctl stop waar-move-revert.timer' && say "   reachable at $ADDR: safety timer cancelled"

# ---- 6. services ---------------------------------------------------------------------------------------------
say "restarting the services on the new server"
new_at "$ADDR" "bash -s" <<EOF
# the mDNS daemon takes the host name the old server held
sudo systemctl restart avahi-daemon
(cd /opt/waar-connect-media && sudo docker compose restart livekit >/dev/null 2>&1)
sleep 4
sudo systemctl restart waar-connect-api waar-connect-phase0
sleep 3
sudo systemctl restart waar-connect-gateway
sudo systemctl reload nginx
sleep 6
echo "   address:  \$(ip -4 addr show $IFACE | awk '/inet /{print \$2, (\$0 ~ /dynamic/ ? "(from DHCP)" : "(static)")}')"
echo "   services: api \$(systemctl is-active waar-connect-api), gateway \$(systemctl is-active waar-connect-gateway), web \$(systemctl is-active nginx)"
echo "   API:      \$(curl -s -m 5 127.0.0.1:8788/api/v1/health)"
curl -s -m 5 -H "x-wc-role: admin" http://127.0.0.1:8788/api/v1/pcrs | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log("   studios: ",JSON.parse(s).pcrs.map(p=>p.name).join(", "))})'
curl -s -m 5 -H "x-wc-role: admin" http://127.0.0.1:8788/api/v1/gateway/status | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s).status;console.log("   gateway:  returns",(j?.returns??[]).map(r=>r.pcrName+" "+r.state).join(", ")||"none","| NDI sources seen",(j?.sources??[]).length)})'
echo "   mDNS:     state \$(busctl --system call org.freedesktop.Avahi / org.freedesktop.Avahi.Server GetState | awk '{print \$2}') (2 = running), name \$(busctl --system call org.freedesktop.Avahi / org.freedesktop.Avahi.Server GetHostName | awk '{print \$2}')"
EOF

if [ "$REHEARSE" = 1 ]; then
  say "rehearsal: putting the new server's own DHCP address back"
  new_at "$ADDR" "sudo rm -f $NETPLAN && sudo systemd-run --quiet --collect --unit=waar-move-apply /usr/sbin/netplan apply"
  for _ in $(seq 1 40); do
    sleep 3
    if new_at "$NEW" "ip -br -4 addr show $IFACE | grep -q dynamic || ip -4 addr show $IFACE | grep -q dynamic" 2>/dev/null; then break; fi
  done
  new_at "$NEW" "echo \"   \$(ip -4 addr show $IFACE | grep inet | awk '{print \$2, \$NF, \$(NF-1)}' | tr '\n' ' ')\"; ls $NETPLAN 2>/dev/null || echo '   static file removed'"
  say "REHEARSED: the address change, the safety timer and the service restart work"
  exit 0
fi

say "checking through the public names from this PC"
curl -s -m 8 -o /dev/null -w "   https://connect.waar.work:8443/        -> %{http_code}\n" https://connect.waar.work:8443/ || true
curl -s -m 8 https://connect.waar.work:8443/api/v1/health | sed 's/^/   API: /' || true
echo
curl -s -m 8 -o /dev/null -w "   https://media.connect.waar.work:8443/  -> %{http_code}\n" https://media.connect.waar.work:8443/ || true
say "SWITCHED: the service runs on the new server at $ADDR. Check from outside with a phone on mobile data."
say "The old server must stay off (it would take the same address). The way back: bash deploy/vm/move/back.sh"
