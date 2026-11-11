// Database schema (Postgres, Drizzle). Column names are explicit; migrations live in ../../drizzle.
//
// Model since 2026-11-08: no programmes or episodes. A PCR (production control room, "studio") is a
// standing place with a fixed LiveKit room and output slots; the admin builds PCRs, producers work in
// them. Guests come from a contact book; seating a contact in a PCR makes a guest row whose invite
// link brings them to that PCR's door.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { boolean, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { normalizeFacePrefs, normalizeGuestPrefs, type FacePrefs, type GuestPrefs } from '@waar-connect/shared';

export const userRole = pgEnum('user_role', ['admin', 'producer', 'engineer']);

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

/** Per-PCR settings, set by the admin; defaults come from defaultPcrSettings(). */
export interface PcrSettings {
  /** Number of studio output slots (one output page, later one NDI/SDI output, each). */
  slots: number;
  /** An engineer may talk to a guest who is in the studio (IFB override). */
  ifbAllowed: boolean;
  /** A guest goes to the studio, and on air, only after the engineer approved them. */
  approval: boolean;
  /** Languages offered on guest invites: ku, ckb, ar, en, tr. */
  languages: string[];
  /** Label of each output slot as the vision mixer operator knows it, e.g. "SDI 3" or "NDI Guest 1". */
  outputNames: string[];
  /**
   * NDI source the gateway publishes as the return feed (program picture with the mix-minus on it),
   * e.g. "MIXER (Program)". null: the return feed page on the studio PC does it instead.
   */
  returnSource: string | null;
  /** Height of the return picture the gateway sends (1080, 720, 540, 360); null = the gateway's default. */
  returnHeight: number | null;
  /** Bitrate cap of the return picture, kbit/s; null = the gateway's default. */
  returnKbps: number | null;
  /** How a guest's phone connects by default: codec order, picture, bitrate. Set by the engineer. */
  guest: GuestPrefs;
  /** The producer's face camera as it is sent. Set by the engineer. */
  face: FacePrefs;
}

export function defaultPcrSettings(slots: number): PcrSettings {
  return {
    slots,
    ifbAllowed: true,
    approval: true,
    languages: ['ku', 'ckb', 'ar', 'en'],
    outputNames: Array.from({ length: slots }, (_, i) => `Guest ${i + 1}`),
    returnSource: null,
    returnHeight: null,
    returnKbps: null,
    guest: normalizeGuestPrefs(undefined),
    face: normalizeFacePrefs(undefined),
  };
}

/** A production control room: a standing room with its slots. Built by the admin. */
export const pcrs = pgTable('pcrs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  settings: jsonb('settings').$type<PcrSettings>().notNull(),
  /** LiveKit room name; one fixed room per PCR. */
  livekitRoom: text('livekit_room').notNull().unique(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...timestamps,
});

/** The guest contact book: how to reach a person outside the system. Producers edit it. */
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  /** Name as it should appear in CasparCG lower thirds; falls back to displayName. */
  casparName: text('caspar_name'),
  language: text('language').notNull().default('ku'),
  phone: text('phone'),
  whatsapp: text('whatsapp'),
  telegram: text('telegram'),
  skype: text('skype'),
  email: text('email'),
  other: text('other'),
  notes: text('notes'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
});

/** A contact seated in a PCR: the row the invite link and the LiveKit identity hang on. */
export const guests = pgTable(
  'guests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pcrId: uuid('pcr_id')
      .notNull()
      .references(() => pcrs.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    displayName: text('display_name').notNull(),
    language: text('language').notNull().default('ku'),
    ...timestamps,
  },
  (t) => [index('guests_pcr_idx').on(t.pcrId), index('guests_contact_idx').on(t.contactId)],
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

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pcrId: uuid('pcr_id').references(() => pcrs.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    /** Who did it: a user id, a participant identity, or 'livekit' for webhooks. */
    actor: text('actor').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
  },
  (t) => [index('events_pcr_at_idx').on(t.pcrId, t.at)],
);

export const statsSamples = pgTable(
  'stats_samples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pcrId: uuid('pcr_id')
      .notNull()
      .references(() => pcrs.id, { onDelete: 'cascade' }),
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
  (t) => [index('stats_pcr_identity_at_idx').on(t.pcrId, t.identity, t.at)],
);

/** Station-wide settings the admin edits, one row per key. `ndi_extra_ips`: string[] of NDI sender addresses. */
export const stationSettings = pgTable('station_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
