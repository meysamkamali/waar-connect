#!/usr/bin/env bash
# waar Connect gateway on the VM: shared token with the API, .env, NDI runtime, build, systemd unit.
# Run as root after install-api.sh, from the checkout:
#
#   sudo bash /opt/waar-connect/deploy/vm/install-gateway.sh                      # everything but the NDI runtime
#   sudo bash /opt/waar-connect/deploy/vm/install-gateway.sh --accept-ndi-license # also installs the NDI runtime
#
# The NDI runtime comes from the NDI SDK for Linux (https://ndi.video/for-developers/ndi-sdk/), whose
# licence you accept by passing --accept-ndi-license; the licence text is kept under
# /usr/local/share/doc/ndi/. Without the runtime the gateway service is installed but not started.
# Safe to run again: keeps existing .env files and tokens.
set -euo pipefail

REPO=/opt/waar-connect
APP_USER=waarconnect
API_ENV="$REPO/apps/api/.env"
GW_ENV="$REPO/apps/gateway/.env"
NDI_URL=https://downloads.ndi.tv/SDK/NDI_SDK_Linux/Install_NDI_SDK_v6_Linux.tar.gz
ACCEPT=0
for arg in "$@"; do
  case "$arg" in
    --accept-ndi-license) ACCEPT=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi
if [ ! -f "$API_ENV" ]; then
  echo "no $API_ENV; run install-api.sh first" >&2
  exit 1
fi

echo "== shared token"
TOKEN=$(sed -n 's/^GATEWAY_TOKEN=//p' "$API_ENV" | head -1)
if [ -z "$TOKEN" ]; then
  TOKEN=$(openssl rand -hex 24)
  printf '\n# gateway (apps/gateway) shared secret; install-gateway.sh wrote it\nGATEWAY_TOKEN=%s\n' "$TOKEN" >> "$API_ENV"
  echo "GATEWAY_TOKEN added to the API .env (API restart below)"
  API_RESTART=1
else
  echo "API already has a GATEWAY_TOKEN"
  API_RESTART=0
fi

echo "== gateway environment"
if [ ! -f "$GW_ENV" ]; then
  {
    echo "API_URL=http://127.0.0.1:8788"
    echo "GATEWAY_TOKEN=$TOKEN"
    echo "GATEWAY_NAME=$(hostname)"
    echo "# NDI senders on other subnets, comma-separated IPs (mDNS does not cross the router)"
    echo "NDI_EXTRA_IPS="
    echo "RETURN_MAX_KBPS=3000"
    echo "RETURN_MAX_FPS=30"
    echo "RETURN_AUDIO_CHANNELS=1,2"
  } > "$GW_ENV"
  chown "$APP_USER:$APP_USER" "$GW_ENV"
  chmod 600 "$GW_ENV"
  echo "new gateway .env written"
else
  if ! grep -q "^GATEWAY_TOKEN=$TOKEN$" "$GW_ENV"; then
    sed -i "s/^GATEWAY_TOKEN=.*/GATEWAY_TOKEN=$TOKEN/" "$GW_ENV"
    echo "gateway .env token brought in line with the API"
  else
    echo "keeping existing gateway .env"
  fi
fi

echo "== ndi runtime dependencies"
# libndi links against Avahi (mDNS discovery on the VM's own subnet); senders elsewhere are reached
# through NDI_EXTRA_IPS. The daemon needs UDP 5353 from the LAN.
if ! dpkg -s libavahi-client3 >/dev/null 2>&1 || ! dpkg -s avahi-daemon >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends avahi-daemon libavahi-client3 libavahi-common3 >/dev/null
  echo "avahi installed"
else
  echo "avahi present"
fi
systemctl enable --now avahi-daemon >/dev/null 2>&1 || true
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw allow from 10.0.0.0/24 to any port 5353 proto udp comment 'mDNS for NDI discovery' >/dev/null 2>&1 || true
fi

echo "== ndi runtime"
if ldconfig -p | grep -q 'libndi\.so\.6'; then
  echo "present: $(ldconfig -p | grep -m1 'libndi\.so\.6' | awk '{print $NF}')"
elif [ "$ACCEPT" = 1 ]; then
  CACHE=/var/cache/waar-ndi
  mkdir -p "$CACHE"
  if [ ! -s "$CACHE/sdk.tar.gz" ]; then
    echo "downloading $NDI_URL"
    curl -fsSL "$NDI_URL" -o "$CACHE/sdk.tar.gz"
  fi
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  tar -xzf "$CACHE/sdk.tar.gz" -C "$TMP"
  INSTALLER=$(find "$TMP" -maxdepth 1 -name 'Install_NDI_SDK*.sh' | head -1)
  [ -n "$INSTALLER" ] || { echo "installer script not found in the archive" >&2; exit 1; }
  # The installer prints the licence through $PAGER and reads one answer ("Type y or Y to agree");
  # --accept-ndi-license is that y. (Not `yes |`: with pipefail its SIGPIPE exit would abort us.)
  (cd "$TMP" && PAGER=cat sh "$INSTALLER" >/dev/null <<< "y")
  LIB=$(find "$TMP" -path '*x86_64-linux-gnu*' -name 'libndi.so.6.*' -type f | head -1)
  [ -n "$LIB" ] || { echo "libndi.so.6.* not found after extraction" >&2; exit 1; }
  install -m 644 "$LIB" /usr/local/lib/
  ln -sf "/usr/local/lib/$(basename "$LIB")" /usr/local/lib/libndi.so.6
  ln -sf /usr/local/lib/libndi.so.6 /usr/local/lib/libndi.so
  mkdir -p /usr/local/share/doc/ndi
  find "$TMP" -ipath '*licen*' -type f -exec cp -f {} /usr/local/share/doc/ndi/ \; 2>/dev/null || true
  ldconfig
  echo "installed $(basename "$LIB") to /usr/local/lib (licence texts in /usr/local/share/doc/ndi)"
else
  echo "not installed. Re-run with --accept-ndi-license to download the NDI SDK and install its runtime."
fi

echo "== build"
cd "$REPO"
npm approve-scripts koffi >/dev/null 2>&1 || true
npm ci --no-audit --no-fund --loglevel=error
npm run -s build 2>&1 | grep -E "built in|error|TS[0-9]+" || true
chown -R "$APP_USER:$APP_USER" "$REPO"

echo "== service"
install -m 644 "$REPO/deploy/vm/waar-connect-gateway.service" /etc/systemd/system/waar-connect-gateway.service
systemctl daemon-reload
if [ "$API_RESTART" = 1 ]; then
  systemctl restart waar-connect-api
fi
if ldconfig -p | grep -q 'libndi\.so\.6'; then
  systemctl enable waar-connect-gateway >/dev/null 2>&1 || true
  systemctl restart waar-connect-gateway
  sleep 3
  echo "gateway service: $(systemctl is-active waar-connect-gateway)"
  journalctl -u waar-connect-gateway -n 5 --no-pager -o cat
else
  systemctl disable --now waar-connect-gateway >/dev/null 2>&1 || true
  echo "gateway service installed, not started (no NDI runtime yet)"
fi

echo "== checks"
curl -s --retry 5 --retry-connrefused 127.0.0.1:8788/api/v1/health
echo
curl -s -o /dev/null -w "gateway routes: HTTP %{http_code} (401 = token required, as expected)\n" 127.0.0.1:8788/api/v1/gateway/returns
