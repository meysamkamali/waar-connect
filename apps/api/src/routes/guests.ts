// Guests: a contact (or a bare name) seated in a PCR, and the invite links that bring them to its door.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { identityFor } from '@waar-connect/shared';
import { z } from 'zod';
import { contacts, events, guests, invites, pcrs } from '../db/schema.ts';
import { notFound, parseOr400 } from '../http.ts';

const Id = z.object({ id: z.uuid() });
const SeatBody = z
  .object({
    contactId: z.uuid().optional(),
    displayName: z.string().trim().min(1).max(80).optional(),
    language: z.string().min(2).max(8).optional(),
  })
  .refine((b) => b.contactId !== undefined || b.displayName !== undefined, { message: 'contactId or displayName is required' });
const GuestPatch = z.object({ displayName: z.string().trim().min(1).max(80).optional(), language: z.string().min(2).max(8).optional() });
const InviteBody = z.object({ expiresInHours: z.number().positive().max(24 * 30).default(72), maxUses: z.int().min(0).max(100).default(0) });
const TokenParam = z.object({ token: z.string().min(16).max(64) });

export function newInviteToken(): string {
  return randomBytes(18).toString('base64url'); // 24 url-safe characters
}

export async function guestRoutes(app: FastifyInstance): Promise<void> {
  const { db, cfg, rooms } = app.ctx;
  const staff = app.requireRole('admin', 'producer', 'engineer');

  /** Seats a contact (or a bare name) in a PCR. Seating the same contact twice returns the same seat. */
  app.post('/pcrs/:id/guests', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    const body = params && parseOr400(SeatBody, req.body, reply);
    if (!params || !body) return;
    const [pcr] = await db.select().from(pcrs).where(eq(pcrs.id, params.id)).limit(1);
    if (!pcr) return notFound(reply, 'PCR');

    let displayName = body.displayName ?? '';
    let language = body.language ?? 'ku';
    let contactId: string | null = null;
    if (body.contactId) {
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, body.contactId)).limit(1);
      if (!contact) return notFound(reply, 'Contact');
      const [seated] = await db.select().from(guests).where(and(eq(guests.pcrId, pcr.id), eq(guests.contactId, contact.id))).limit(1);
      if (seated) return { guest: { ...seated, identity: identityFor('guest', seated.id) }, existing: true };
      contactId = contact.id;
      displayName = body.displayName ?? contact.displayName;
      language = body.language ?? contact.language;
    }
    const [guest] = await db.insert(guests).values({ pcrId: pcr.id, contactId, displayName, language }).returning();
    await db.insert(events).values({ pcrId: pcr.id, actor: req.user!.id, type: 'guest.seated', payload: { guestId: guest!.id, displayName, contactId } });
    return reply.code(201).send({ guest: { ...guest, identity: identityFor('guest', guest!.id) }, existing: false });
  });

  app.patch('/guests/:id', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    const body = params && parseOr400(GuestPatch, req.body, reply);
    if (!params || !body) return;
    const [guest] = await db.update(guests).set(body).where(eq(guests.id, params.id)).returning();
    if (!guest) return notFound(reply, 'Guest');
    return { guest: { ...guest, identity: identityFor('guest', guest.id) } };
  });

  /** Removes the seat and its links; a connected guest is shown out of the room as well. */
  app.delete('/guests/:id', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const [guest] = await db.delete(guests).where(eq(guests.id, params.id)).returning();
    if (!guest) return notFound(reply, 'Guest');
    const [pcr] = await db.select({ livekitRoom: pcrs.livekitRoom }).from(pcrs).where(eq(pcrs.id, guest.pcrId)).limit(1);
    if (pcr) {
      const controller = await rooms.get(pcr.livekitRoom).catch(() => null);
      await controller?.act({ type: 'kick', guest: identityFor('guest', guest.id) }, req.user!.id).catch(() => undefined);
    }
    await db.insert(events).values({ pcrId: guest.pcrId, actor: req.user!.id, type: 'guest.removed', payload: { guestId: guest.id } });
    return { ok: true };
  });

  app.post('/guests/:id/invite', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    const body = params && parseOr400(InviteBody, req.body ?? {}, reply);
    if (!params || !body) return;
    const [guest] = await db.select().from(guests).where(eq(guests.id, params.id)).limit(1);
    if (!guest) return notFound(reply, 'Guest');
    const token = newInviteToken();
    const expiresAt = new Date(Date.now() + body.expiresInHours * 3_600_000);
    await db.insert(invites).values({ token, guestId: guest.id, expiresAt, maxUses: body.maxUses });
    await db.insert(events).values({ pcrId: guest.pcrId, actor: req.user!.id, type: 'invite.created', payload: { guestId: guest.id, expiresAt: expiresAt.toISOString() } });
    return reply.code(201).send({ token, url: `${cfg.PUBLIC_URL}/app/g/${token}`, expiresAt, maxUses: body.maxUses, uses: 0 });
  });

  app.post('/invites/:token/revoke', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(TokenParam, req.params, reply);
    if (!params) return;
    const [row] = await db
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.token, params.token), isNull(invites.revokedAt)))
      .returning();
    if (!row) return notFound(reply, 'Invite');
    return { ok: true };
  });
}
