// Entry point: configuration, database, HTTP server, graceful stop.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { buildApp } from './app.ts';
import { purgeExpiredSessions } from './auth/sessions.ts';
import { loadConfig } from './config.ts';
import { connectDb } from './db/client.ts';

const cfg = loadConfig();
const { db, close } = connectDb(cfg.DATABASE_URL);
const app = await buildApp({ cfg, db });

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
