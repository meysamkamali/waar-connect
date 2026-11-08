# waar Connect gateway

Headless Node service between the studio's NDI network and the LiveKit room. Today it carries the
**return feed**: the program picture with the mix-minus arrives as an NDI source and goes into the
PCR's room as the participant `studio` (track `program`, H.264; track `mix-minus`, Opus). Later it
also takes each studio slot out of the room as its own NDI source.

```
 NDI source "MIXER (Program)" ──► gateway ──► LiveKit room ──► every studio guest,
 (picture + mix-minus)           studio       (participant        green-room guests on "studio"
                                 return       `studio`)
```

## How it is configured

The admin sets, per studio (PCR), the NDI source name under **/app/admin → Return feed from NDI**.
The gateway asks the API every 15 s which PCRs want a return feed, starts one feed per PCR, and
reports its sources and feed states every 5 s; the admin page shows them. Nothing is configured on
the gateway itself except the API address and the shared token (`.env`, see `.env.example`).

With no NDI source set, a PCR keeps using the browser page `/app/return/:pcr` on the studio PC.
Both publish as `studio`; the later one replaces the earlier.

## What it does with the signal

- Video: BGRA frames from NDI go straight into the LiveKit video source (colour conversion and the
  H.264 encode happen inside the SDK's libwebrtc). Resolution follows the source; frame rate is capped
  (`RETURN_MAX_FPS`, 50 fps programs go out at 25); bitrate is capped (`RETURN_MAX_KBPS`, 3000).
- Audio: 32-bit float planar in; the chosen channels (`RETURN_AUDIO_CHANNELS`, default 1 and 2) are
  averaged into one 16-bit channel at 48 kHz. A mix-minus is one signal, so mono is the right shape.
- No video for 2 s: black is sent and the state says `no-signal`. 20 s: the source is searched again
  (a restarted sender comes back on a new port).
- The room reconnects by itself; a fresh token comes with every poll.

## Running

```bash
cp .env.example .env          # API_URL, GATEWAY_TOKEN
npm run -w apps/gateway dev   # needs the NDI runtime on this machine
```

The NDI runtime is not in npm. On the VM `deploy/vm/install-gateway.sh` installs Avahi (libndi needs it) and the runtime from the NDI
SDK (you accept the NDI SDK licence when it asks), writes `.env` with a token shared with the API,
and installs the `waar-connect-gateway` systemd unit. On Windows the runtime that comes with NDI
Tools is found automatically.

NDI discovery is mDNS; a sender on another subnet is reached by listing its IP in `NDI_EXTRA_IPS`.

## CPU

Per 1080p25 return on the VM (Xeon E5-2680 v2): roughly half a core for the NDI decode and one to
two cores for the H.264 software encode. Guests' phones decode H.264 in hardware.

NDI® is a registered trademark of Vizrt NDI AB.
