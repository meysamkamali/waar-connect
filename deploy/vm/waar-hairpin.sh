#!/usr/bin/env bash
# Puts the station's public IP on this VM's loopback interface ("hairpin").
#
# LiveKit's embedded TURN hands out relay candidates on the public IP, and the SFU in the same process
# has to send to them. The station router does not route a packet from the LAN back to its own WAN
# address, so without this every relay pair fails (requests sent, nothing comes back). With the address
# on lo those packets never leave the VM, and both ends see exactly the addresses they advertised.
#
# Runs at boot from waar-hairpin.service. Run it again by hand if the station's public IP changes
# (then restart LiveKit too, which learns its public IP at start-up). PUBLIC_IP=x.x.x.x overrides.
set -euo pipefail

STATE=/etc/waar-connect/public-ip
IP=${PUBLIC_IP:-}
is_ip() { [[ "$1" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; }

if [ -z "$IP" ]; then
  IP=$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 8 https://ifconfig.me 2>/dev/null || true)
fi
if ! is_ip "$IP"; then
  IP=$(cat "$STATE" 2>/dev/null || true)
fi
if ! is_ip "$IP"; then
  echo "waar-hairpin: public IP unknown (offline and no $STATE yet); nothing done" >&2
  exit 0
fi

OLD=$(cat "$STATE" 2>/dev/null || true)
if [ -n "$OLD" ] && [ "$OLD" != "$IP" ]; then
  ip addr del "$OLD/32" dev lo 2>/dev/null || true
fi
ip addr replace "$IP/32" dev lo
mkdir -p "$(dirname "$STATE")"
echo "$IP" > "$STATE"
echo "waar-hairpin: $IP is on lo"
