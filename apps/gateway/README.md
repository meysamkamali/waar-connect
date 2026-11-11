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

The admin picks, per studio (PCR), the NDI source under **/app/admin → Return feed from NDI source**:
a list of every sender the gateway sees, each with its address and the VM interface it is on (or
"via router" when it sits behind one), the gateway's own outputs left out. A sender that is off right
now can be typed by name; it shows as "not seen now" until it comes back. The network a sender is on
plays no part in the choice: NDI names are unique per sender and the gateway connects to the address
the sender advertises. The gateway asks the API every 15 s which PCRs want a return feed, starts one
feed per PCR, and reports its sources and feed states every 5 s; the admin page shows them.

Per studio the admin also sets the **picture size** the gateway sends (1080p, 720p, 540p, 360p; default
540p) and its **bitrate** (default 1500 kbit/s). The program is scaled down before the encode (a box filter in the
gateway, 9 ms a frame for 1080p to 540p on the VM), and at 360p the sender's own low-bandwidth proxy
stream is taken, which is cheaper to decode as well. Bitrates go down to 200 kbit/s for a guest on a
poor connection. NDI
senders on networks the VM is not on go into **Admin → NDI senders on other networks**; `NDI_EXTRA_IPS`
in `.env` is added to that list, and discovery restarts by itself when the list changes. Nothing is configured on
the gateway itself except the API address and the shared token (`.env`, see `.env.example`).

With no NDI source set, a PCR keeps using the browser page `/app/return/:pcr` on the studio PC.
Both publish as `studio`; the later one replaces the earlier.

## What it does with the signal

- Video: BGRA frames from NDI are scaled to the studio's picture size (box filter for exact 2:1 and 3:1,
  bilinear otherwise, in JavaScript: sharp/libvips took 58 ms a frame on this CPU; `RETURN_HEIGHT`,
  540, when the studio sets none; 0 keeps the source's size) and go into the LiveKit video source (colour
  conversion and the H.264 encode happen inside the SDK's libwebrtc). Frame rate is capped
  (`RETURN_MAX_FPS`, 50 fps programs go out at 25); bitrate is capped (the studio's, else `RETURN_MAX_KBPS`, 1500).
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

Measured 2026-11-09 on the VM (Xeon E5-2680 v2, 2013, no AVX2), one 1080p25 program source:

| sent as | gateway process | where it goes |
|---|---|---|
| 1080p (source size) | 2.2 cores | OpenH264 encode about 1.5, NDI decode 0.5 |
| 540p (default) | 1.7 cores | main thread 0.9 (frame copy, 9 ms box filter, audio), NDI decode 0.5, encode 0.16 |

At 360p the sender's proxy stream is taken, so the NDI decode shrinks as well (not measured yet).
Guests' phones decode H.264 in hardware.

**One process per return** (since 2026-11-10). The scaling and the frame copies of a feed run on
JavaScript's one thread, about 0.9 of it for a 1080p25 source. With two live returns in one process
that thread was full and each feed sent 10 to 19 frames a second instead of 25. So the gateway
(`index.ts`) now only asks the API what is wanted, watches the NDI network and reports; every feed
runs in a process of its own (`feed-process.ts` starts `feed-worker.ts` and passes it the target,
fresh tokens and the address list over the process channel, and gets its status back each second).
Measured after the change with the same two 1080p25 returns at 540p: 23 to 25 frames a second each,
about 1.65 cores per feed process (its main thread 0.85, NDI decode 0.5, encode 0.14), the whole VM
at about half its eight cores.

It also keeps a fault to itself. A feed process that ends (the NDI receive that hangs ends it on
purpose) is started again after two seconds, and the other feeds never notice: tried on the VM by
killing one, which was publishing again 18 seconds later while the other stayed at 25 frames a
second. `GATEWAY_FEEDS=inline` puts the feeds back into the gateway's own process, for one feed
or for finding a fault.

Each feed's main thread is near its limit at 1080p in, 540p out. A return set to 360p takes the
sender's proxy stream and needs no scaling.

## Multiview strip

While a green-room guest is ticked MV, the API subscribes this feed's participant (`studio`) to the
cameras of the group. The feed asks the media server for each guest's smallest copy (320x180; rtc-node
has no call for that yet, so the request goes to its bindings, `requestSmallCopy` in `return-feed.ts`)
and draws every guest's latest frame into a small picture (`multiview.ts`: I420 to BGRA, the phone's
rotation applied, letterboxed, about half the frame rate).

Those pictures go into one wide picture, the strip: a dark panel holding one to eight guests in the
grid that makes them largest (`layoutTiles`). There is one strip for the whole group, every guest's
own picture included. It is published as its own track, `mv-strip`, on a clock of its own (it does
not wait for programme frames): H.264, in the shape of the multiview widget on the guest's screen,
three of its nine sections wide and one high (960x180 for a 540p return, never wider than 1280;
`stripSize` in the shared package gives the size, and `layoutTiles` lives there too so that the
admin's screen designer draws the same), a quarter of the return's bitrate cap within 150 to
500 kbit/s, 12.5 frames a second. The return itself is not touched: one decode, one encode.

The routing engine sends `mv-strip` to every guest of the multiview group, in place of each other's
cameras; nobody else ever gets it. The guest's page shows it in the multiview widget, wherever the
admin placed that on the guest's screen.
A few seconds after the last picture went quiet the track is unpublished again.

A guest counts as present while frames arrive from them: the media library does not report the server
ending a subscription, the frames just stop (or shrink to 8x8 placeholders, which are ignored).

Measured 2026-11-10 on the VM with three guests: too small to tell apart from the noise of a process
running three returns (2.89 cores with the strip, 2.92 without).

NDI® is a registered trademark of Vizrt NDI AB.
