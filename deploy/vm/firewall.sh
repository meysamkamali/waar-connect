#!/usr/bin/env bash
# The firewall of a waar Connect server (ufw): everything closed but what the service needs.
# Run as root; safe to run again. The installers call it. With SKIP_FIREWALL=1 they leave the
# firewall alone, and this script is run by hand when the machine is ready for it:
#
#   sudo bash /opt/waar-connect/deploy/vm/firewall.sh
#
# Other networks than the station's defaults:
#   sudo NDI_NETWORKS="10.0.0.0/24 10.100.1.0/24" MDNS_NETWORKS="10.0.0.0/24" bash /opt/waar-connect/deploy/vm/firewall.sh
set -euo pipefail

WEB_PORT=${WEB_PORT:-8443}
# The server's own networks: mDNS finds NDI senders there and announces the gateway's sources.
MDNS_NETWORKS=${MDNS_NETWORKS:-"10.0.0.0/24 10.100.1.0/24"}
# The station networks that send NDI to the gateway or take NDI from it: the server LAN, the ENG
# network, the PCR1 NDI network and the PCR2 network.
NDI_NETWORKS=${NDI_NETWORKS:-"10.0.0.0/24 10.1.1.0/24 10.100.1.0/24 10.100.2.0/24"}

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi
command -v ufw >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw >/dev/null

ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
# 8443 is the port the router forwards from the internet. 443 and 80 are for the station's own
# machines, where the LAN DNS points the names straight at this server (no port in the address).
ufw allow "$WEB_PORT"/tcp comment 'waar Connect web + signaling' >/dev/null
ufw allow 443/tcp comment 'waar Connect web without the port, station only' >/dev/null
ufw allow 80/tcp comment 'waar Connect: redirect to HTTPS' >/dev/null
ufw allow 7881/tcp comment 'waar Connect WebRTC TCP' >/dev/null
ufw allow 7882/udp comment 'waar Connect WebRTC UDP' >/dev/null
ufw allow 3478/udp comment 'waar Connect TURN' >/dev/null
for net in $MDNS_NETWORKS; do
  ufw allow from "$net" to any port 5353 proto udp comment 'mDNS for NDI discovery' >/dev/null
done
# NDI itself, in and out, from every station network that sends or takes it.
# TCP: a receiver of the gateway's sources connects to 5960 (the list of sources) and to one port per
# source from 5961 up; without this a mixer sees the sources and gets no picture.
# UDP: NDI's fast delivery (reliable UDP) arrives on the receiving side's port, 5960 and up; here
# that is a sender delivering to one of the gateway's return feeds. Blocked, NDI falls back to TCP.
for net in $NDI_NETWORKS; do
  for proto in tcp udp; do
    ufw allow from "$net" to any port 5960:5999 proto "$proto" comment 'NDI in and out' >/dev/null
  done
done
ufw --force enable >/dev/null
ufw status numbered
