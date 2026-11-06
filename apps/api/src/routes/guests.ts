import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { episodes, events, guests, invites } from '../db/schema.ts';
import { notFound, parseOr400 } from '../http.ts';

const Id = z.object({ id: z.uuid() });
const GuestBody = z.object({
  displayName: z.string().trim().min(1).max(60),
  casparName: z.string().trim().max(60).nullable().optional(),
  language: z.string().min(2).max(8).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
const InviteBody = z.object({ expiresInHours: z.number().positive().max(24 * 30).default(72), maxUses: z.int().min(0).max(100).default(0) });
const TokenParam = z.object({ token: z.string().min(16).max(64) });

export function newInviteToken(): string {
  return randomBytes(18).toString('base64url'); // 24 url-safe characters
}

export async function guestRoutes(app: FastifyInstance): Promise<void> {
  const { db, cfg } = app.ctx;
  const staff = app.requireRole('admin', 'producer', 'engineer');

  app.post('/episodes/:id/guests', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    const body = params && parseOr400(GuestBody, req.body, reply);
    if (!params || !body) return;
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, params.id)).limit(1);
    if (!episode) return notFound(reply, 'Episode');
    const [guest] = await db
      .insert(guests)
      .values({ episodeId: episode.id, displayName: body.displayName, casparName: body.casparName ?? null, language: body.language ?? 'ku', phone: body.phone ?? null, notes: body.notes ?? null })
      .returning();
    await db.insert(events).values({ episodeId: episode.id, actor: req.user!.id, type: 'guest.created', payload: { guestId: guest!.id, displayName: guest!.displayName } });
    return reply.code(201).send({ guest });
  });

  app.patch('/guests/:id', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    const body = params && parseOr400(GuestBody.partial(), req.body, reply);
    if (!params || !body) return;
    const [guest] = await db.update(guests).set(body).where(eq(guests.id, params.id)).returning();
    if (!guest) return notFound(reply, 'Guest');
    return { guest };
  });

  app.delete('/guests/:id', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const [guest] = await db.delete(guests).where(eq(guests.id, params.id)).returning();
    if (!guest) return notFound(reply, 'Guest');
    await db.insert(events).values({ episodeId: guest.episodeId, actor: req.user!.id, type: 'guest.deleted', payload: { guestId: guest.id } });
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
    await db.insert(events).values({ episodeId: guest.episodeId, actor: req.user!.id, type: 'invite.created', payload: { guestId: guest.id, expiresAt: expiresAt.toISOString() } });
    return reply.code(201).send({ token, url: `${cfg.PUBLIC_URL}/app/g/${token}`, expiresAt, maxUses: body.maxUses });
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
