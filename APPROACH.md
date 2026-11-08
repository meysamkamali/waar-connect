# waar Connect — approach and architecture

Version 0.2 · 2026-11-05 · status: agreed direction, no code yet
Companion: `SYSTEM-PLAN.md` (places, roles, routing matrix, hand-off, hosting and domains).

waar Connect brings remote guests (phone or laptop, anywhere) into the WAAR studio for live programs:
each guest arrives as a separate video/audio source on the vision mixer, hears the studio and the other
guests but never themselves, sees the program return, and can be talked to privately by the producer.

## Decisions taken

| Topic | Decision | Why |
|---|---|---|
| Media core | **LiveKit**, self-hosted (Apache-2.0) | Production-grade SFU, simulcast, recording, ingress/egress, SIP, SDKs in every language. We build the product, not the WebRTC plumbing. |
| Relationship to VDO.Ninja | Ideas freely; code only under the AGPL rules below | Its code is tied to its own peer-to-peer signaling, so little transplants cleanly; its product thinking is the valuable part. |
| Licence of waar Connect | **AGPL-3.0-only**, public repository | We do not plan to sell it. AGPL keeps the door open to lift VDO.Ninja code where it saves time. Everything we depend on must be AGPL-compatible (Apache-2.0, MIT, BSD are fine). |
| Language | **TypeScript front to back** (Node backend, browser apps) | One stack, first-party LiveKit SDKs, shared types between guest, producer and gateway. PHP stays out of the realtime path. |
| Scope | One station, several studios and programs | No multi-tenant machinery; simpler code. |
| Product shape | Virtual places: Lobby → Green Room → Studio → back (see SYSTEM-PLAN.md) | Matches how a real station works; producer and engineer handle the guest off air, the studio only sees guests who were handed off. |
| Hosting | A dedicated VM in the station (10.0.0.41): Nginx on 8443 for `connect.waar.work` and `media.connect.waar.work`, LiveKit in Docker, TURN on UDP 3478; certificates issued by the aaPanel server and copied over | Separate from the station's other sites; 443 and 80 stay with aaPanel, so links carry :8443 (see SYSTEM-PLAN.md, Hosting). |

## What phase 1 must do

**Guest** — taps a link, passes a camera/mic/network check, waits in a lobby, is admitted, goes on air.
Hears studio mics and the other guests, never their own voice. Sees program return. Sees an ON AIR tally.
Hears the producer privately when the producer talks to them.

**Producer** — creates a program and an episode, generates one link per guest, sees the lobby, previews
a guest before admitting, sets quality, mutes, talks privately, reorders outputs, ends the episode.

**Studio** — gets each guest as its own SDI or NDI source with that guest's audio on it, plus a multiview.
Sends program video and a studio-mic mix back. Guest names reach CasparCG for lower thirds.

## Components

```
 guest phones/laptops ──WebRTC──┐                                   ┌── SDI/NDI per guest ──► vision mixer
                                 │        VPS (connect.waar.tv)      │
 producer console ──────────────►│  LiveKit server + TURN + Redis   │◄── program return (SDI in) ── mixer
                                 │  egress worker (ISO recordings)  │
 connect-api (Node/TS) ─────────►│  ingress (WHIP, optional)        │   connect-gateway PC in the studio
                                 └──────────────────────────────────┘
```

1. **LiveKit server** — single node with Redis, embedded TURN on UDP 3478, one UDP mux port, TCP fallback.
   Runs in Docker on the dedicated waar Connect VM in the station (decided 2026-11-05).
2. **Egress worker** — per-guest ISO recordings (participant egress) to local disk or MinIO, and an optional
   SRT or RTMP composite as a backup path into a hardware decoder.
3. **Ingress** — WHIP endpoint so OBS (30 or newer) can publish the program return if the browser
   publish path in the gateway is not good enough.
4. **connect-api** (Node, TypeScript, Postgres) — programs, episodes, guests, invite tokens with expiry,
   LiveKit access tokens (short TTL, grants per role), LiveKit webhooks (joined, left, track published),
   room state, CasparCG AMCP push for names, audit log.
5. **connect-guest** (PWA, TypeScript, LiveKit client SDK) — pre-call test, lobby, call screen,
   auto-reconnect, simulcast publish, tally and talkback indicators. Installable, works in Safari and Chrome.
6. **connect-producer** (web) — lobby, multiview grid on the low simulcast layer, per-guest controls
   (admit, mute, quality preset, private talk, kick), live stats (RTT, loss, bitrate), link generator.
7. **connect-gateway** — NDI in and out (decided 2026-11-06). Target design, now phase 1 instead of
   phase 3: a headless Node service (LiveKit `rtc-node` + NDI SDK) that subscribes to each studio slot and
   sends it as its own NDI source with audio, and receives the program NDI source to publish it into the
   room as the participant `studio`. It can run on the waar Connect VM itself if the VM shares the NDI
   network with the mixer, otherwise on a small studio PC. Interim for phase 0: the browser pages
   `/out.html` rendered by whatever the station has that outputs NDI (CasparCG HTML producer with the NDI
   consumer, or vMix), and NDI Tools Webcam Input feeding `/studio.html` for the return.
   **2026-11-08: the return side is built** (`apps/gateway`: NDI in through koffi + the NDI runtime,
   `@livekit/rtc-node` out as `studio`, H.264 at the source's resolution, mono mix-minus; the admin
   names the NDI source per PCR). The slot outputs (room → NDI) are the next step.

## Audio design

This is the part that decides whether it sounds professional.

- **Mix-minus for free.** The console sends an aux "remote send" bus = studio mics + playback, without the
  remote guests. The gateway publishes it as the `studio` audio track. Each guest subscribes to `studio`
  plus every other guest's track directly from the SFU. Nobody can ever hear themselves, with no per-guest
  N-1 buses to build.
- **Each guest reaches the console as its own channel**, embedded in that guest's SDI or NDI output.
- **Talkback** is a producer audio track whose subscription permissions list only the chosen guests. It is
  never subscribed by the gateway outputs, so it never reaches air.
- Opus 48 kHz, echo cancellation on, noise suppression on by default with a "music" preset that turns it off
  and raises the bitrate.

## Video design

- Guests publish 720p30 by default, 1080p30 where the network allows, simulcast on, H.264 preferred
  (hardware encoders on phones) with VP8 fallback, capped around 2.5 Mbps.
- Return feed is one 720p30 track around 2 Mbps that every guest subscribes to; the SFU fans it out.
- Targets: guest to SDI under 500 ms, return under 500 ms, so a conversation round trip stays near 1 s.

## Studio hardware

- Gateway PC: 8-core CPU, RTX-class GPU (browser decode plus OBS encode), 32 GB RAM, wired gigabit.
- Decklink Duo 2 (4 SDI, configurable in/out) for up to 3 guests plus return in, or Quad 2 for up to 7.
  NDI instead if the station already runs it.
- USB audio interface only if the studio send is not embedded in the return SDI.
- Test phones: one iPhone and one mid-range Android, because that is what guests will have.

## Reusing VDO.Ninja code under AGPL

Likely candidates: mobile camera and microphone edge cases, device pickers, audio meters, URL parameter
conventions, Electron Capture for clean window capture if OBS browser sources fall short (check that
repository's own licence first).

Rules from day one:

- Copy whole files with headers into `third_party/vdo-ninja/`, record the source commit in `NOTICE.md`.
- Add a dated "modified by WAAR" notice to each changed file.
- Keep a "Source code" link in the footer of every page a guest or producer can see.
- Never use the VDO.Ninja name or logos; never point at its public signaling or TURN servers.

## Phases

| Phase | Length | Outcome |
|---|---|---|
| 0 · Proof | 2 weeks | LiveKit on the VPS with TURN. Two phones into bare pages into OBS into SDI. Latency and quality measured on local mobile networks. Hosting location decided. |
| 1 · MVP | 6–8 weeks | Components 4–7 at minimum viable level. A real program on air with 2–4 guests. ISO recordings. |
| 2 · Hardening | 4–6 weeks | Tally, call-quality dashboard, CasparCG names, SIP phone fallback through LiveKit SIP, screen share, scheduled links with expiry, roles and audit. |
| 3 · Native gateway | later | Gateway app with direct NDI and Decklink output, no OBS in the chain. Multi-studio. |

## Risks

- **Mobile networks and carrier NAT** force TURN relays; test on real SIM cards in phase 0.
- **Studio audio loops** if the return carries the guests; insist on the N-1 bus before the first show.
- **Gateway CPU** with 6 browser decodes plus encodes; use the GPU, cap resolutions, measure.
- **One VPS** is a single point of failure; keep a scripted rebuild and the SIP phone fallback.
- **AGPL provenance** is cheap on day one and painful to reconstruct later.

## Open questions for WAAR

1. ~~SDI only, or is NDI already in the station?~~ **Answered 2026-11-06: NDI, in and out.**
2. Which vision mixer and audio console, and can the console give an aux bus without the remote guests?
3. vMix licence available, or OBS?
4. Where are most guests: Kurdistan and Iraq, or the diaspora in Europe? This sets the VPS location.
5. Who operates during the show: the producer, or the vision mixer operator?
