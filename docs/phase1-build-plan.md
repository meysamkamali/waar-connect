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
| Web apps | `apps/web`: Vite + Preact + TypeScript, one app with routes `/g/:token`, `/producer`, `/engineer`, `/out/:slot`, `/multiview` | Small, React-like, easy for a PHP team to read. The phase 0 modules (room setup, stats, clock) move into it. |
| Auth | Producer/engineer: email + password with sessions (phase 1), station SSO later. Guests: invite token in the link. Outputs: long-lived kiosk token per slot. | Matches SYSTEM-PLAN open point 5 until answered. |
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
| M4 | Guest app: check, lobby, green, studio, exit, cues, tally, three languages | A guest goes through all places without touching settings |
| M5 | Producer and engineer screens: door, grid, per-guest controls, stats, tests, ready | A show can be run from the screens alone |
| M6 | Output slot pages, multiview, manual tally, ISO recording per studio segment | Slot 1 shows the right guest with a slate otherwise; recordings land on disk |

Phase 0 pages stay in service until M4 replaces the guest page, so field tests continue meanwhile.
