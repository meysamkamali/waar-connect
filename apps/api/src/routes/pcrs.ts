// PCRs (production control rooms): the admin builds them, producers and engineers work in them.
// Also the tokens that let a staff screen, a monitor, an output page or the return feed join a PCR's room.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  CODEC_NAMES,
  DEGRADE_MODES,
  ENCODER_KINDS,
  FACE_KBPS,
  GUEST_KBPS,
  identityFor,
  MAX_CODEC_CHOICES,
  normalizeFacePrefs,
  normalizeGuestPrefs,
  outputIdentity,
} from '@waar-connect/shared';
import { z } from 'zod';
import { defaultPcrSettings, events, guests, invites, pcrs, type PcrSettings } from '../db/schema.ts';
import { notFound, parseOr400 } from '../http.ts';
import { mintToken } from '../livekit/tokens.ts';

const GuestPrefsBody = z.object({
  codecs: z.array(z.object({ codec: z.enum(CODEC_NAMES), encoder: z.enum(ENCODER_KINDS) })).min(1).max(MAX_CODEC_CHOICES),
  height: z.union([z.literal(360), z.literal(540), z.literal(720), z.literal(1080)]),
  fps: z.union([z.literal(25), z.literal(50)]),
  kbps: z.int().min(GUEST_KBPS.min).max(GUEST_KBPS.max),
  degrade: z.enum(DEGRADE_MODES),
});
const FacePrefsBody = z.object({
  height: z.union([z.literal(180), z.literal(360), z.literal(540), z.literal(720)]),
  fps: z.union([z.literal(15), z.literal(25), z.literal(30)]),
  kbps: z.int().min(FACE_KBPS.min).max(FACE_KBPS.max),
});

/** What an engineer may change on a PCR: how things connect, not what the studio is. */
export const TECHNICAL_KEYS: readonly (keyof PcrSettings)[] = ['returnSource', 'returnHeight', 'returnKbps', 'guest', 'face'];

/** Is this patch only about the technical settings? The engineer's limit; the admin has none. */
export function isTechnicalPatch(body: { name?: unknown; settings?: Record<string, unknown> | undefined }): boolean {
  if (body.name !== undefined) return false;
  return Object.keys(body.settings ?? {}).every((k) => (TECHNICAL_KEYS as readonly string[]).includes(k));
}

const Settings = z.object({
  slots: z.int().min(1).max(16),
  ifbAllowed: z.boolean(),
  approval: z.boolean(),
  languages: z.array(z.string().min(2).max(8)).min(1).max(8),
  outputNames: z.array(z.string().trim().max(40)).max(16),
  returnSource: z.string().trim().max(200).nullable(),
  returnHeight: z.union([z.literal(1080), z.literal(720), z.literal(540), z.literal(360)]).nullable(),
  returnKbps: z.int().min(200).max(8000).nullable(),
  guest: GuestPrefsBody,
  face: FacePrefsBody,
});
const CreateBody = z.object({ name: z.string().trim().min(1).max(80), settings: Settings.partial().optional() });
const PatchBody = z.object({ name: z.string().trim().min(1).max(80).optional(), settings: Settings.partial().optional() });
const Id = z.object({ id: z.uuid() });
const SlotParams = z.object({ id: z.uuid(), slot: z.coerce.number().int().min(1).max(16) });

type SettingsPatch = { [K in keyof PcrSettings]?: PcrSettings[K] | undefined };

/** Merges a partial settings patch; output names always cover exactly the slot count. */
export function mergeSettings(base: PcrSettings, patch: SettingsPatch | undefined): PcrSettings {
  // Rows written before a field existed have no key for it; null means "the page" or "the gateway's default".
  const out: PcrSettings = {
    ...base,
    outputNames: [...base.outputNames],
    approval: base.approval ?? true,
    returnSource: base.returnSource ?? null,
    returnHeight: base.returnHeight ?? null,
    returnKbps: base.returnKbps ?? null,
    guest: normalizeGuestPrefs(base.guest),
    face: normalizeFacePrefs(base.face),
  };
  // The guest's screen is the station's now (routes/station.ts); a design a studio still carries is not handed out.
  delete out.screen;
  if (patch) {
    if (patch.slots !== undefined) out.slots = patch.slots;
    if (patch.ifbAllowed !== undefined) out.ifbAllowed = patch.ifbAllowed;
    if (patch.approval !== undefined) out.approval = patch.approval;
    if (patch.languages !== undefined) out.languages = patch.languages;
    if (patch.outputNames !== undefined) out.outputNames = [...patch.outputNames];
    if (patch.returnSource !== undefined) out.returnSource = patch.returnSource?.trim() || null;
    if (patch.returnHeight !== undefined) out.returnHeight = patch.returnHeight;
    if (patch.returnKbps !== undefined) out.returnKbps = patch.returnKbps;
    if (patch.guest !== undefined) out.guest = normalizeGuestPrefs(patch.guest);
    if (patch.face !== undefined) out.face = normalizeFacePrefs(patch.face);
  }
  out.outputNames = Array.from({ length: out.slots }, (_, i) => out.outputNames[i]?.trim() || `Guest ${i + 1}`);
  return out;
}

function newRoomName(): string {
  return `pcr-${randomBytes(4).toString('hex')}`;
}

export async function pcrRoutes(app: FastifyInstance): Promise<void> {
  const { db, cfg, rooms } = app.ctx;
  const admin = app.requireRole('admin');
  const adminOrEngineer = app.requireRole('admin', 'engineer');
  const staff = app.requireRole('admin', 'producer', 'engineer');

  async function pcrById(id: string) {
    const [row] = await db.select().from(pcrs).where(eq(pcrs.id, id)).limit(1);
    return row;
  }
  /** Rows written before a setting existed lack its key; the pages always get every setting. */
  const complete = <T extends { settings: PcrSettings }>(row: T): T => ({ ...row, settings: mergeSettings(row.settings, undefined) });

  app.get('/pcrs', { preHandler: app.requireUser }, async () => {
    const rows = await db.select().from(pcrs).where(isNull(pcrs.archivedAt)).orderBy(asc(pcrs.name));
    return { pcrs: rows.map(complete) };
  });

  app.post('/pcrs', { preHandler: admin }, async (req, reply) => {
    const body = parseOr400(CreateBody, req.body, reply);
    if (!body) return;
    const settings = mergeSettings(defaultPcrSettings(cfg.DEFAULT_SLOTS), body.settings);
    const [row] = await db.insert(pcrs).values({ name: body.name, settings, livekitRoom: newRoomName() }).returning();
    await db.insert(events).values({ pcrId: row!.id, actor: req.user!.id, type: 'pcr.created', payload: { name: row!.name } });
    return reply.code(201).send({ pcr: row });
  });

  /** One PCR with its seated guests and their live invite links. */
  app.get('/pcrs/:id', { preHandler: app.requireUser }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const pcr = await pcrById(params.id);
    if (!pcr) return notFound(reply, 'PCR');
    const guestRows = await db.select().from(guests).where(eq(guests.pcrId, pcr.id)).orderBy(asc(guests.createdAt));
    const ids = guestRows.map((g) => g.id);
    const inviteRows = ids.length
      ? await db
          .select({ token: invites.token, guestId: invites.guestId, expiresAt: invites.expiresAt, uses: invites.uses, maxUses: invites.maxUses })
          .from(invites)
          .where(and(inArray(invites.guestId, ids), isNull(invites.revokedAt)))
      : [];
    return {
      pcr: complete(pcr),
      guests: guestRows.map((g) => ({
        ...g,
        identity: identityFor('guest', g.id),
        invites: inviteRows.filter((i) => i.guestId === g.id).map((i) => ({ ...i, url: `${cfg.PUBLIC_URL}/app/g/${i.token}` })),
      })),
    };
  });

  /** The admin changes anything; the engineer only how things connect (return feed, guest and face preferences). */
  app.patch('/pcrs/:id', { preHandler: adminOrEngineer }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    const body = params && parseOr400(PatchBody, req.body, reply);
    if (!params || !body) return;
    if (req.user!.role === 'engineer' && !isTechnicalPatch(body)) return reply.code(403).send({ error: 'The engineer changes the technical settings only; the rest is the admin\'s.' });
    const current = await pcrById(params.id);
    if (!current) return notFound(reply, 'PCR');
    const settings = mergeSettings(current.settings, body.settings);
    const [row] = await db
      .update(pcrs)
      .set({ name: body.name ?? current.name, settings })
      .where(eq(pcrs.id, params.id))
      .returning();
    // The running controller holds the slots and the IFB rule; when those change it rebuilds from
    // LiveKit on the next request. A technical change leaves the live room alone.
    const live = (s: PcrSettings) => `${s.slots}/${s.ifbAllowed}/${s.approval}`;
    if (live(settings) !== live(mergeSettings(current.settings, undefined))) rooms.drop(current.livekitRoom);
    await db.insert(events).values({ pcrId: current.id, actor: req.user!.id, type: 'pcr.updated', payload: { name: row!.name, settings: row!.settings } });
    return { pcr: row };
  });

  app.post('/pcrs/:id/archive', { preHandler: admin }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const [row] = await db.update(pcrs).set({ archivedAt: new Date() }).where(eq(pcrs.id, params.id)).returning();
    if (!row) return notFound(reply, 'PCR');
    rooms.drop(row.livekitRoom);
    await db.insert(events).values({ pcrId: row.id, actor: req.user!.id, type: 'pcr.archived' });
    return { pcr: row };
  });

  /** A producer or engineer joins the PCR's room under their own identity. */
  app.post('/pcrs/:id/join', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const pcr = await pcrById(params.id);
    if (!pcr) return notFound(reply, 'PCR');
    const user = req.user!;
    const role = user.role === 'engineer' ? 'engineer' : 'producer';
    const token = await mintToken(cfg, 'staff', { room: pcr.livekitRoom, identity: identityFor(role, user.id), name: user.name, metadata: { role } });
    return { ...token, room: pcr.livekitRoom, role };
  });

  /** Hidden receive-only token for a multiview or monitor page. */
  app.post('/pcrs/:id/monitor', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const pcr = await pcrById(params.id);
    if (!pcr) return notFound(reply, 'PCR');
    const identity = identityFor('monitor', `${req.user!.id.slice(0, 8)}-${randomBytes(2).toString('hex')}`);
    return { ...(await mintToken(cfg, 'monitor', { room: pcr.livekitRoom, identity, name: `${req.user!.name} (monitor)` })), room: pcr.livekitRoom };
  });

  /** Long-lived token for the output page of one slot; the page runs on the studio PC. */
  app.post('/pcrs/:id/outputs/:slot/token', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(SlotParams, req.params, reply);
    if (!params) return;
    const pcr = await pcrById(params.id);
    if (!pcr) return notFound(reply, 'PCR');
    if (params.slot > pcr.settings.slots) return notFound(reply, 'Slot');
    const name = pcr.settings.outputNames[params.slot - 1] ?? `Guest ${params.slot}`;
    const token = await mintToken(cfg, 'output', { room: pcr.livekitRoom, identity: outputIdentity(params.slot), name });
    return { ...token, room: pcr.livekitRoom, slot: params.slot, name, pcrName: pcr.name };
  });

  /** Token for the return feed publisher: program picture plus mix-minus, identity `studio`. */
  app.post('/pcrs/:id/studio-token', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const pcr = await pcrById(params.id);
    if (!pcr) return notFound(reply, 'PCR');
    return { ...(await mintToken(cfg, 'studio', { room: pcr.livekitRoom, identity: identityFor('studio', ''), name: 'Studio' })), room: pcr.livekitRoom, pcrName: pcr.name };
  });
}
