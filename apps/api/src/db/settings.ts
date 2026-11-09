// Station-wide settings the admin edits: one row per key in `station_settings`, value as JSON.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { eq } from 'drizzle-orm';
import type { Db } from './client.ts';
import { stationSettings } from './schema.ts';

export async function getSetting(db: Db, key: string): Promise<unknown> {
  const [row] = await db.select().from(stationSettings).where(eq(stationSettings.key, key)).limit(1);
  return row?.value;
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  const updatedAt = new Date();
  await db
    .insert(stationSettings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: stationSettings.key, set: { value, updatedAt } });
}
