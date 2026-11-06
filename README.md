# waar Connect

Remote guests into the WAAR TV studio for live programs. A guest taps a link on a phone or laptop,
arrives as a separate SDI or NDI source on the vision mixer, hears the studio and the other guests but
never themselves, sees the program return, and is looked after off air by a producer and an engineer in
a virtual green room.

Status: **phase 0, proof of concept.** Media server deployment files and bare test pages. Nothing here
has been on air yet.

## Documents

- `APPROACH.md` — why LiveKit, why TypeScript, why AGPL, components, phases, risks.
- `SYSTEM-PLAN.md` — the places (Lobby, Green Room, Studio), roles, who hears whom, hand-off, hosting.
- `docs/phase0-test-sheet.md` — what to measure in phase 0 and where to write it down.
- `docs/phase1-build-plan.md` — stack, data model, API surface and milestones for the product build.
- `brand/` — logo files and the generator that makes them.

## Layout

```
packages/shared/ domain model (places, roles, identities, attributes) and the routing engine, with tests
apps/phase0/     proof app: token server (Node, Express) and six bare pages (Vite, TypeScript)
deploy/vm/       the waar Connect VM: installer, Nginx on 8443, services, certificate sync
deploy/media/    LiveKit + embedded TURN + Redis, docker compose (used by deploy/vm)
deploy/web/      the aaPanel server: certificate issuing and the redirect to the VM, panel API helper
docs/            working documents
brand/           logo sources and exports
```

## Phase 0 quick start

1. Media server: follow `deploy/media/README.md` (DNS, firewall, `docker compose up -d`).
2. Web: `npm install`, copy `apps/phase0/.env.example` to `apps/phase0/.env` and fill it in,
   `npm run phase0:build`, `npm run phase0:start`. In development `npm run phase0:dev` runs the Vite
   server with the API proxied.
3. Open the launcher page, enter the phase 0 PIN, and follow `docs/phase0-test-sheet.md`.

## Licence

AGPL-3.0-only. See `LICENSE` and `NOTICE.md`. The WAAR name and logo are not part of the licence.
