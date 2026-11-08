# waar Connect API

Node 24, Fastify, Drizzle, Postgres. Serves `/api/v1/*` behind Nginx on the VM; the phase 0 pages keep
`/api/*` on their own process until `apps/web` replaces them.

## Run

```bash
cp .env.example .env            # fill in DATABASE_URL, LiveKit key and secret, PUBLIC_URL
npm run db:migrate              # applies ./drizzle to the database
PASSWORD='…' npm run user:add -- you@waar.tv "Your Name" admin
npm run dev                     # or: npm run build && npm run start
```

Postgres on the VM comes from `deploy/vm/db/docker-compose.yml`. After a schema change:
`npm run db:generate` writes a new migration into `./drizzle`; commit it; `npm run db:migrate` applies it.

## Endpoints

Sessions are a cookie set by login. Roles: `admin`, `producer`, `engineer`.

| Method and path | Who | What |
|---|---|---|
| `POST /auth/login` `{email,password}` | anyone | sets the session cookie (final phase; with `OPEN_ACCESS=1` the staff screens need none, see `src/auth/open.ts`) |
| `POST /auth/logout`, `GET /me` | signed in | |
| `GET /pcrs`, `GET /pcrs/:id` | signed in | list of open PCRs; one PCR with its seated guests and their invite links |
| `POST /pcrs` `{name,settings?}`, `PATCH /pcrs/:id`, `POST /pcrs/:id/archive` | admin | settings: slots, outputNames, readyRequired, ifbAllowed, languages; a change restarts the room controller |
| `GET /contacts?q=`, `POST /contacts`, `PATCH /contacts/:id`, `DELETE /contacts/:id` | read: signed in; write: admin, producer | the guest contact book |
| `POST /pcrs/:id/guests` `{contactId}` or `{displayName,language}` | staff | seats a contact (idempotent per PCR) or a one-off name; returns the guest with its identity |
| `PATCH /guests/:id`, `DELETE /guests/:id` | staff | delete also shows a connected guest out |
| `POST /guests/:id/invite` `{expiresInHours?,maxUses?}` | staff | invite token and link `PUBLIC_URL/app/g/<token>` |
| `POST /invites/:token/revoke` | staff | |
| `GET /invite/:token` | public | guest, PCR and a LiveKit token (identity `guest:<id>`); counts a use |
| `POST /pcrs/:id/join` | staff | LiveKit token as `producer:<user>` or `engineer:<user>` |
| `POST /pcrs/:id/monitor` | staff | hidden receive-only token |
| `POST /pcrs/:id/outputs/:slot/token` | staff | 7-day token as `out:slot-<n>` for the output page, with the slot's output name |
| `POST /pcrs/:id/studio-token` | staff | 7-day token as `studio` for the return feed page |
| `GET /pcrs/:id/room` | staff | live snapshot: guests with place/tally/slot, staff, outputs, connected identities, tracks |
| `POST /pcrs/:id/room/actions` | staff | one action, returns the new snapshot (see below) |
| `POST /livekit/webhook` | LiveKit | signed room events, stored in `events` and fed to the room controller |
| `GET /health` | anyone | |

Every endpoint is under `/api/v1`. Errors are `{ "error": "message" }` with 400, 401, 403, 404, 409, 410 or 429.

## Room actions (M3)

Body is `{ "type": …, … }`. Guests are addressed by identity (`guest:<id>`, shown in the PCR view).

| type | fields | notes |
|---|---|---|
| `admit` | guest | lobby → green room |
| `talk` | to: `none` / `all` / [identities] | the caller's own talk track; the server lists the allowed guests in `wc.talk_allowed` and the staff page applies them as track permissions |
| `face` | guest or null | the caller's camera to one guest |
| `table` | guest, table or null | guests at the same table hear and see each other |
| `studioSound`, `program`, `ready` | guest, on | ready: engineer or admin only |
| `slot` | guest, slot or null | exclusive; refused while the guest is on the studio side |
| `handoff` | guest | green → studio, tally standby; needs a slot and, if the PCR says so, the ready mark |
| `tally` | guest, `standby` / `onair` | |
| `bringBack` | guest | studio → green, tally off |
| `ifb` | guest, on | engineer or admin; only when the program allows it |
| `cue` | to: identity or `all`, text | data message, topic `wc.cue` |
| `command` | guest, command | data message to the guest page, topic `wc.cmd` |
| `kick` | guest | removes the participant |

After every action and every webhook the controller pushes participant attributes (`wc.*`) and calls
`UpdateSubscriptions` for every connected participant from the shared routing engine, so the wire
matches the matrix. A guest who drops keeps place, slot and tally for 15 minutes for a reconnect; on a
restart the controller rebuilds its state from the attributes LiveKit still holds.
