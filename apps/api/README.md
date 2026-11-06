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
| `POST /auth/login` `{email,password}` | anyone | sets the session cookie |
| `POST /auth/logout`, `GET /me` | signed in | |
| `GET /programs`, `GET /programs/:id` | signed in | list; program with its latest episodes |
| `POST /programs`, `PATCH /programs/:id`, `POST /programs/:id/archive` | admin, producer | settings: slots, readyRequired, ifbAllowed, languages |
| `POST /programs/:id/episodes` `{title,startsAt?}` | admin, producer | creates the episode, its LiveKit room name and its slots |
| `GET /episodes/:id` | signed in | episode, settings, guests with their invite links, slots |
| `POST /episodes/:id/start`, `…/end` | staff | planned → live → ended |
| `POST /episodes/:id/guests`, `PATCH /guests/:id`, `DELETE /guests/:id` | staff | guest records |
| `POST /guests/:id/invite` `{expiresInHours?,maxUses?}` | staff | invite token and link `PUBLIC_URL/g/<token>` |
| `POST /invites/:token/revoke` | staff | |
| `GET /invite/:token` | public | guest, episode and a LiveKit token (identity `guest:<id>`); counts a use |
| `POST /episodes/:id/join` | staff | LiveKit token as `producer:<user>` or `engineer:<user>` |
| `POST /episodes/:id/monitor` | staff | hidden receive-only token |
| `POST /episodes/:id/outputs/:slot/token` | staff | 7-day token as `out:slot-<n>` for the output page |
| `POST /episodes/:id/studio-token` | staff | 7-day token as `studio` for the return publisher |
| `POST /livekit/webhook` | LiveKit | signed room events, stored in `events` |
| `GET /health` | anyone | |

Every endpoint is under `/api/v1`. Errors are `{ "error": "message" }` with 400, 401, 403, 404, 409, 410 or 429.

## What M3 adds

The room controller: in-memory `RoomState` per live episode fed by the webhooks, the green-room actions
(admit, talk, face, table, studio sound, program, slot, ready, hand-off, tally, bring back, cue, kick), and
after each action `UpdateParticipant` (attributes) plus `UpdateSubscriptions` from the shared routing engine.
