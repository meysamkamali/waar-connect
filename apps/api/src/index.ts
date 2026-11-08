// Entry point: configuration, database, LiveKit control, HTTP server, graceful stop.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { and, eq, isNull } from 'drizzle-orm';
import { RoomServiceClient } from 'livekit-server-sdk';
import { buildApp } from './app.ts';
import { purgeExpiredSessions } from './auth/sessions.ts';
import { loadConfig } from './config.ts';
import { connectDb } from './db/client.ts';
import { events, pcrs } from './db/schema.ts';
import { RoomRegistry, type RoomSettings } from './rooms/controller.ts';
import { LiveKitRoomControl } from './rooms/livekit-control.ts';
import { newGatewayState } from './routes/gateway.ts';

const cfg = loadConfig();
const { db, close } = connectDb(cfg.DATABASE_URL);

// The server API speaks HTTPS on the same host as the signaling WebSocket.
const livekitHttp = cfg.LIVEKIT_URL.replace(/^ws/, 'http');
const control = new LiveKitRoomControl(new RoomServiceClient(livekitHttp, cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET));

async function pcrFor(room: string) {
  const [row] = await db
    .select({ id: pcrs.id, settings: pcrs.settings })
    .from(pcrs)
    .where(and(eq(pcrs.livekitRoom, room), isNull(pcrs.archivedAt)))
    .limit(1);
  return row;
}

const rooms = new RoomRegistry(
  control,
  async (room): Promise<RoomSettings | null> => {
    const row = await pcrFor(room);
    return row ? { slots: row.settings.slots, ifbAllowed: row.settings.ifbAllowed } : null;
  },
  (room) => (type, actor, payload) => {
    void pcrFor(room)
      .then((row) => (row ? db.insert(events).values({ pcrId: row.id, actor, type, payload }) : undefined))
      .catch((err: unknown) => app.log.warn({ err, room, type }, 'event not recorded'));
  },
);

const app = await buildApp({ cfg, db, rooms, gateway: newGatewayState() });

const purge = setInterval(() => void purgeExpiredSessions(db).catch((err) => app.log.warn({ err }, 'session purge failed')), 3_600_000);

async function stop(signal: string): Promise<void> {
  app.log.info({ signal }, 'stopping');
  clearInterval(purge);
  await app.close();
  await close();
  process.exit(0);
}
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));

await app.listen({ host: '127.0.0.1', port: cfg.PORT });
