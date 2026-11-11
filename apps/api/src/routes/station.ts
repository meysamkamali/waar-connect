// What the admin sets for the whole station, not for one studio: the producer's ready-made cues
// (each with its text in every language) and the guest's screen design. Both live in
// `station_settings`. A saved screen goes at once to every phone that is connected.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { asc, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { defaultScreen, LANGUAGE_CODES, MAX_CUE_LENGTH, MAX_CUES, normalizeCues, normalizeScreen, SCREEN_COLS, SCREEN_GUESTS, SCREEN_ROWS, WIDGET_KINDS, type Cue, type GuestScreen } from '@waar-connect/shared';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { pcrs } from '../db/schema.ts';
import { getSetting, setSetting } from '../db/settings.ts';
import { parseOr400 } from '../http.ts';

const CUES_KEY = 'cues';
const SCREEN_KEY = 'guest_screen';

const CuesBody = z.object({
  cues: z
    .array(
      z.object({
        id: z.string().max(24).optional(),
        text: z.record(z.enum(LANGUAGE_CODES as [string, ...string[]]), z.string().max(MAX_CUE_LENGTH * 2)),
      }),
    )
    .max(MAX_CUES),
});

const ScreenBody = z.object({
  screen: z.object({
    patterns: z
      .array(
        z.object({
          widgets: z
            .array(
              z.object({
                kind: z.enum(WIDGET_KINDS),
                col: z.int().min(0).max(SCREEN_COLS - 1),
                row: z.int().min(0).max(SCREEN_ROWS - 1),
                cols: z.int().min(1).max(SCREEN_COLS),
                rows: z.int().min(1).max(SCREEN_ROWS),
              }),
            )
            .max(WIDGET_KINDS.length),
        }),
      )
      .max(SCREEN_GUESTS),
  }),
});

/** The station's cues; its own list until the admin saves one. */
export async function loadCues(db: Db): Promise<Cue[]> {
  return normalizeCues(await getSetting(db, CUES_KEY));
}

/**
 * The guest's screen for the whole station. Until the admin saves one here: a design a studio was
 * given while designs were kept per studio (2026-11-11, the first such studio by name), else the
 * station's own.
 */
export async function loadScreen(db: Db): Promise<GuestScreen> {
  const saved = await getSetting(db, SCREEN_KEY);
  if (saved !== undefined) return normalizeScreen(saved);
  const own = JSON.stringify(defaultScreen());
  const rows = await db.select().from(pcrs).where(isNull(pcrs.archivedAt)).orderBy(asc(pcrs.name));
  for (const row of rows) {
    if (!row.settings.screen) continue;
    const screen = normalizeScreen(row.settings.screen);
    if (JSON.stringify(screen) !== own) return screen;
  }
  return defaultScreen();
}

export async function stationRoutes(app: FastifyInstance): Promise<void> {
  const { db, rooms } = app.ctx;
  const admin = app.requireRole('admin');
  const staff = app.requireRole('admin', 'producer', 'engineer');

  app.get('/cues', { preHandler: staff }, async () => ({ cues: await loadCues(db) }));

  app.put('/cues', { preHandler: admin }, async (req, reply) => {
    const body = parseOr400(CuesBody, req.body, reply);
    if (!body) return;
    const cues = normalizeCues(body.cues);
    await setSetting(db, CUES_KEY, cues);
    return { cues };
  });

  app.get('/screen', { preHandler: staff }, async () => ({ screen: await loadScreen(db) }));

  app.put('/screen', { preHandler: admin }, async (req, reply) => {
    const body = parseOr400(ScreenBody, req.body, reply);
    if (!body) return;
    const screen = normalizeScreen(body.screen);
    await setSetting(db, SCREEN_KEY, screen);
    // The phones that are connected now take the new design at once; the others get it with their link.
    const open = await db.select({ room: pcrs.livekitRoom }).from(pcrs).where(isNull(pcrs.archivedAt));
    for (const { room } of open) void rooms.tell(room, 'wc.screen', screen).catch(() => undefined);
    return { screen };
  });
}
