// Database schema (Postgres, Drizzle). Column names are explicit; migrations live in ../../drizzle.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['admin', 'producer', 'engineer']);
export const episodeStatus = pgEnum('episode_status', ['planned', 'live', 'ended']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: userRole('role').notNull(),
  passwordHash: text('password_hash').notNull(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  ...timestamps,
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

/** Per-program settings; defaults come from defaultProgramSettings(). */
export interface ProgramSettings {
  /** Number of studio output slots. */
  slots: number;
  /** The engineer's ready mark is required before a hand-off. */
  readyRequired: boolean;
  /** An engineer may talk to a guest who is in the studio (IFB override). */
  ifbAllowed: boolean;
  /** Languages offered on guest invites, BCP 47-ish: ku, ckb, ar, en, tr. */
  languages: string[];
}

export function defaultProgramSettings(slots: number): ProgramSettings {
  return { slots, readyRequired: true, ifbAllowed: false, languages: ['ku', 'ar', 'en'] };
}

export const programs = pgTable('programs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  settings: jsonb('settings').$type<ProgramSettings>().notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...timestamps,
});

export const episodes = pgTable(
  'episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    status: episodeStatus('status').notNull().default('planned'),
    /** LiveKit room name; one room per episode. */
    livekitRoom: text('livekit_room').notNull().unique(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('episodes_program_idx').on(t.programId)],
);

export const guests = pgTable(
  'guests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    /** Name as it should appear in CasparCG lower thirds; falls back to displayName. */
    casparName: text('caspar_name'),
    language: text('language').notNull().default('ku'),
    phone: text('phone'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [index('guests_episode_idx').on(t.episodeId)],
);

export const invites = pgTable(
  'invites',
  {
    token: text('token').primaryKey(),
    guestId: uuid('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** 0 = unlimited. */
    maxUses: integer('max_uses').notNull().default(0),
    uses: integer('uses').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('invites_guest_idx').on(t.guestId)],
);

export const slots = pgTable(
  'slots',
  {
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    guestId: uuid('guest_id').references(() => guests.id, { onDelete: 'set null' }),
    /** NDI or SDI output name shown to the vision mixer operator. */
    outputName: text('output_name'),
  },
  (t) => [primaryKey({ columns: [t.episodeId, t.number] })],
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    /** Who did it: a user id, a participant identity, or 'livekit' for webhooks. */
    actor: text('actor').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
  },
  (t) => [index('events_episode_at_idx').on(t.episodeId, t.at)],
);

export const statsSamples = pgTable(
  'stats_samples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episodes.id, { onDelete: 'cascade' }),
    identity: text('identity').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    rttMs: integer('rtt_ms'),
    lossPct: real('loss_pct'),
    kbps: integer('kbps'),
    width: integer('width'),
    height: integer('height'),
    fps: real('fps'),
    path: text('path'),
    relay: boolean('relay'),
  },
  (t) => [index('stats_episode_identity_at_idx').on(t.episodeId, t.identity, t.at)],
);
