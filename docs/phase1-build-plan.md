# Phase 1 build plan

Started 2026-11-06, after phase 0 proved the chain from a phone on mobile data to the VM.
Phase 1 turns the six test pages into the product described in `SYSTEM-PLAN.md`: Lobby, Green Room,
Studio, the producer and engineer screens, fixed output slots, and the server that enforces who hears
whom. NDI output is designed separately once the VM's CPU-only decoding has been measured.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shared domain | `packages/shared` (TypeScript, no dependencies) | Places, roles, identities, attributes and the routing matrix in one place, used by the API and every page, tested on its own. |
| API | `apps/api`: Node 24, Fastify, Drizzle ORM, Postgres 16 in Docker on the VM | Typed routes and schemas, cheap to run, one process. Postgres because episodes, guests, events and stats grow for years. |
| Realtime | LiveKit server SDK: tokens, `UpdateParticipant` (attributes, permissions), `UpdateSubscriptions`, webhooks | The server decides routing; clients only render what they are allowed to receive. |
| Web apps | `apps/web`: Vite + Preact + TypeScript, one app with routes `/g/:token`, `/producer[/:pcr]`, `/engineer[/:pcr]`, `/contacts`, `/admin`, `/admin/station`, `/return/:pcr`, `/out/:pcr/:slot` | Small, React-like, easy for a PHP team to read. The phase 0 modules (room setup, stats, clock) move into it. |
| Auth | **Test phase (decided 2026-11-06): no passwords.** `OPEN_ACCESS=1` serves `/app/producer` and `/app/engineer` as a fixed producer or engineer account; the screen tells the API which one (`x-wc-role`). Final phase: `OPEN_ACCESS=0`, email + password with sessions (built, kept), station SSO later. Guests: invite token in the link. Outputs: long-lived kiosk token per slot. | The user asked for no user/password until the final phase, as with the phase 0 PIN. Matches SYSTEM-PLAN open point 5 until answered. |
| Languages | Kurdish (Kurmanji and Sorani), Arabic, English; RTL from day one for the guest page | Guests choose nothing; the producer picks the language on the invite. |

## Repository layout after phase 1

```
packages/shared/   domain model + routing engine (this commit)
apps/api/          Fastify API, Drizzle schema, LiveKit control, webhooks
apps/web/          guest, producer, engineer, output and multiview pages (Preact)
apps/phase0/       the proof pages; frozen, kept for field tests until apps/web replaces them
deploy/            unchanged layout; the API and Postgres join the VM's compose/systemd set
```

## Domain model (shared package)

- **Place** `lobby | green | studio | left`, **Tally** `off | standby | onair`.
- **GuestState**: identity, place, tally, slot, table, studioSound, program, ready.
- **StaffState** (producer or engineer): identity, role, `talkTo` (none, all, or a list), `faceTo` (one guest or none).
- **RoomState**: guests, staff, outputs (identity + slot), ifbOverride (guests an engineer may talk to on air).
- **PublishedTrack**: sid, publisher identity, source (`camera`, `microphone`, `talkback`, `program-video`, `program-audio`).
- **Identities**: `guest:<id>`, `producer:<user>`, `engineer:<user>`, `studio` (the return), `out:slot-<n>`, `monitor:<x>`.
- **Attributes** on the guest participant (`wc.place`, `wc.tally`, `wc.slot`, `wc.table`, `wc.studio_sound`, `wc.program`, `wc.ready`), written only by the API.

## The routing engine

`canReceive(subscriber, track, state)` implements the table in SYSTEM-PLAN.md. `subscriptionPlan(state, tracks)`
returns, for every participant, the track sids they may receive. The API applies it with
`UpdateSubscriptions` after every state change; the clients also run it locally with auto-subscribe
off, so a page can never attach a track the server would not have sent. Talkback tracks additionally
carry per-track subscription permissions from `talkbackSubscribers(staff, state)`. Three locks.

Invariants, each a unit test:
1. A talkback track never reaches an output, the studio return or a monitor.
2. A participant never receives their own track.
3. A guest in the lobby receives nothing.
4. A guest in the studio hears the program and other studio guests, never producer or engineer, unless the engineer's IFB override names them.
5. An output receives only the camera and microphone of the guest in the studio on its slot.
6. Green-room guests hear each other only inside the same table.
7. Face-to-face sends the producer's camera to that one guest only.

## Data model (Postgres, Drizzle)

`users` (id, email, name, role, password_hash) · `programs` (id, name, settings json: slots, ready_required,
ifb_allowed, languages) · `episodes` (id, program_id, title, starts_at, status, livekit_room) ·
`guests` (id, episode_id, display_name, caspar_name, language, phone, notes) · `invites` (token, guest_id,
expires_at, uses, max_uses) · `slots` (episode_id, number, guest_id, output_name) · `events` (id, episode_id,
at, actor, type, payload json) · `stats_samples` (episode_id, identity, at, rtt, loss, kbps, width, fps, path).

## API surface (first cut)

- `POST /auth/login`, `GET /me`
- `GET/POST /programs`, `GET/POST /programs/:id/episodes`, `POST /episodes/:id/start|end`
- `POST /episodes/:id/guests`, `POST /guests/:id/invite` → link, `GET /invite/:token` → guest join info + LiveKit token
- Green-room actions, each a state change that triggers the routing engine:
  `admit`, `talk` (on/off, per guest or all), `face` (on/off), `table` (set/clear), `studio-sound`, `program`,
  `slot`, `ready`, `handoff`, `tally` (standby/onair/off), `bring-back`, `cue` (text), `kick`
- Engineer: `command` to a guest (quality, audio mode, relay, restart), `stats` ingest
- `POST /livekit/webhook` (joined, left, track published/unpublished) keeps RoomState in sync
- Output pages: `GET /out/:slot/token` with the kiosk token

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 ✅ 2026-11-06 | Shared model + routing engine with tests | `npm test` green; the invariants above hold |
| M2 ✅ 2026-11-06 | API skeleton: Postgres, auth, programs, episodes, guests, invites, tokens | A producer can create an episode and a guest link from an HTTP client |
| M3 ✅ 2026-11-06 | Routing applied live: webhooks, attributes, UpdateSubscriptions, talkback permissions | Controller tests cover admit, talk, table, hand-off, tally, bring back, IFB, reconnect and restart; live check on the VM: a guest joined through the webhook, admit → slot → ready → hand-off moved it to the studio and LiveKit holds the attributes. The two-phone run with a producer page waits for M5. |
| M4 ✅ 2026-11-06 (phone run pending) | Guest app: check, lobby, green, studio, exit, cues, tally, three languages | `apps/web` (Preact) served under `/app/`; invite links resolve, device check, one layout for lobby/green/studio driven by the server's attributes, cues and commands over data channel, raise hand and help, en/ku/ckb/ar with RTL. Translations need a native review. Verified in a browser up to the camera step; the first phone run through all places waits for the producer screen (M5) to drive it. |
| M5 ✅ 2026-11-06 (first run pending) | Producer and engineer screens: door, grid, per-guest controls, stats, tests, ready | `/app/producer` and `/app/engineer`: login, programmes and episodes, the room screen with studio slots, green room, door, guest list with invite links; per-guest talk, face, table, studio sound, program, slot, ready, hand-off, tally, bring back, IFB, cues, engineer commands and receive stats; staff talk track with the third-lock permissions. The engineer's bandwidth and echo tests are not built yet. Needs its first run with real guests. |
| M6 ✅ 2026-11-08 (model change) | **PCR model**: programmes and episodes replaced by standing PCRs built by the admin; guest contact book; seats and links from it; "guest sees / hears" controls in the green room; admin station lock for hardware; return feed page; output slot pages | `/app/admin` builds a studio with named slots; `/app/contacts` holds the phone book; the producer seats a contact and copies the link; `/app/return/:pcr` publishes picture + mix-minus from the locked capture inputs; `/app/out/:pcr/:slot` shows the slot's guest with a slate otherwise (400 ms receive buffer, auto-reconnect). Same day: engineer side, tables and slot choice removed from the UI and the ready mark removed altogether (the producer sends directly; first free slot on send); producer gets the phone's own report every 10 s plus settings commands (res, fps, kbps, codec, relay, facing, voice processing, mute, reload; since 2026-11-09 also the camera controls the phone offers: exposure offset and lock, white balance lock, focus lock, zoom, torch, shown only when the phone reports them). Not yet: multiview, ISO recording, NDI/SDI output (one web page per slot for now). |
| M7 ✅ 2026-11-09 | **Gateway, return side**: `apps/gateway` receives the PCR's NDI program source (koffi + NDI runtime) and publishes it into the room as `studio` (H.264 at the source's size, 3000 kbit/s cap, 50 fps sent as 25; mix-minus channels averaged to mono); admin picks the NDI source per PCR from the list the gateway sees (address, which VM network, the gateway's own outputs left out; a saved source that is off is marked, a name can be typed) and sees its feed states; `GATEWAY_TOKEN` authenticates the gateway to the API; `deploy/vm/install-gateway.sh` | Live on the VM (`waar-connect-gateway`, NDI runtime 6.3.2 + Avahi): PCR 1 takes the station's "ENG07 (WAAR PGM on ENG07)" (1080p25, 2 ch 48 kHz) and a room subscriber receives 1080p H.264; colour order checked with a red/blue test sender (red stays red). Measured 2.2 cores per 1080p25 feed at the source's size, 1.7 at the 540p default; since 2026-11-09 the admin sets picture size and bitrate per PCR (default 540p, 1500 kbit/s, scaled in the gateway before the encode), the NDI sender addresses for other subnets live in admin, and the staff pages show the VM's CPU and RAM for the test phase. Not yet: slot outputs room → NDI, a "no signal" slate instead of black |

Phase 0 pages stay in service until M4 replaces the guest page, so field tests continue meanwhile.
