import { randomBytes } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { identityFor, outputIdentity } from '@waar-connect/shared';
import { z } from 'zod';
import { episodes, events, guests, invites, programs, slots } from '../db/schema.ts';
import { notFound, parseOr400 } from '../http.ts';
import { mintToken } from '../livekit/tokens.ts';

const Id = z.object({ id: z.uuid() });
const CreateBody = z.object({ title: z.string().trim().min(1).max(120), startsAt: z.iso.datetime().optional() });
const SlotParams = z.object({ id: z.uuid(), slot: z.coerce.number().int().min(1).max(16) });

function newRoomName(): string {
  return `ep-${randomBytes(4).toString('hex')}`;
}

export async function episodeRoutes(app: FastifyInstance): Promise<void> {
  const { db, cfg } = app.ctx;
  const staff = app.requireRole('admin', 'producer', 'engineer');
  const producers = app.requireRole('admin', 'producer');

  app.post('/programs/:id/episodes', { preHandler: producers }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    const body = params && parseOr400(CreateBody, req.body, reply);
    if (!params || !body) return;
    const [program] = await db.select().from(programs).where(eq(programs.id, params.id)).limit(1);
    if (!program) return notFound(reply, 'Program');

    const episode = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(episodes)
        .values({ programId: program.id, title: body.title, startsAt: body.startsAt ? new Date(body.startsAt) : null, livekitRoom: newRoomName() })
        .returning();
      if (!row) throw new Error('insert returned nothing');
      await tx.insert(slots).values(
        Array.from({ length: program.settings.slots }, (_, i) => ({ episodeId: row.id, number: i + 1, outputName: `Guest ${i + 1}` })),
      );
      await tx.insert(events).values({ episodeId: row.id, actor: req.user!.id, type: 'episode.created', payload: { title: row.title } });
      return row;
    });
    return reply.code(201).send({ episode });
  });

  app.get('/episodes/:id', { preHandler: app.requireUser }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, params.id)).limit(1);
    if (!episode) return notFound(reply, 'Episode');
    const [program] = await db.select().from(programs).where(eq(programs.id, episode.programId)).limit(1);
    const guestRows = await db.select().from(guests).where(eq(guests.episodeId, episode.id)).orderBy(asc(guests.createdAt));
    const slotRows = await db.select().from(slots).where(eq(slots.episodeId, episode.id)).orderBy(asc(slots.number));
    const inviteRows = guestRows.length
      ? await db
          .select({ token: invites.token, guestId: invites.guestId, expiresAt: invites.expiresAt, uses: invites.uses, maxUses: invites.maxUses })
          .from(invites)
          .innerJoin(guests, eq(invites.guestId, guests.id))
          .where(and(eq(guests.episodeId, episode.id), isNull(invites.revokedAt)))
      : [];
    return {
      episode,
      settings: program?.settings ?? null,
      guests: guestRows.map((g) => ({
        ...g,
        identity: identityFor('guest', g.id),
        invites: inviteRows.filter((i) => i.guestId === g.id).map((i) => ({ ...i, url: `${cfg.PUBLIC_URL}/g/${i.token}` })),
      })),
      slots: slotRows,
    };
  });

  app.post('/episodes/:id/start', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const [row] = await db
      .update(episodes)
      .set({ status: 'live', startedAt: new Date() })
      .where(and(eq(episodes.id, params.id), eq(episodes.status, 'planned')))
      .returning();
    if (!row) return reply.code(409).send({ error: 'Episode is not in the planned state.' });
    await db.insert(events).values({ episodeId: row.id, actor: req.user!.id, type: 'episode.started' });
    return { episode: row };
  });

  app.post('/episodes/:id/end', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const [row] = await db
      .update(episodes)
      .set({ status: 'ended', endedAt: new Date() })
      .where(and(eq(episodes.id, params.id), eq(episodes.status, 'live')))
      .returning();
    if (!row) return reply.code(409).send({ error: 'Episode is not live.' });
    await db.insert(events).values({ episodeId: row.id, actor: req.user!.id, type: 'episode.ended' });
    return { episode: row };
  });

  /** A producer or engineer joins the episode's room under their own identity. */
  app.post('/episodes/:id/join', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, params.id)).limit(1);
    if (!episode) return notFound(reply, 'Episode');
    const user = req.user!;
    const role = user.role === 'engineer' ? 'engineer' : 'producer';
    const token = await mintToken(cfg, 'staff', { room: episode.livekitRoom, identity: identityFor(role, user.id), name: user.name, metadata: { role } });
    return { ...token, room: episode.livekitRoom, role };
  });

  /** Hidden receive-only token for the staff multiview. */
  app.post('/episodes/:id/monitor', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, params.id)).limit(1);
    if (!episode) return notFound(reply, 'Episode');
    const identity = identityFor('monitor', `${req.user!.id.slice(0, 8)}-${randomBytes(2).toString('hex')}`);
    return { ...(await mintToken(cfg, 'monitor', { room: episode.livekitRoom, identity, name: `${req.user!.name} (monitor)` })), room: episode.livekitRoom };
  });

  /** Long-lived token for the output page of one slot; the link is pasted into the studio PC once. */
  app.post('/episodes/:id/outputs/:slot/token', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(SlotParams, req.params, reply);
    if (!params) return;
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, params.id)).limit(1);
    if (!episode) return notFound(reply, 'Episode');
    const [slot] = await db.select().from(slots).where(and(eq(slots.episodeId, episode.id), eq(slots.number, params.slot))).limit(1);
    if (!slot) return notFound(reply, 'Slot');
    const token = await mintToken(cfg, 'output', { room: episode.livekitRoom, identity: outputIdentity(slot.number), name: slot.outputName ?? `Guest ${slot.number}` });
    return { ...token, room: episode.livekitRoom, slot: slot.number };
  });

  /** Token for the studio return publisher (gateway or studio page). */
  app.post('/episodes/:id/studio-token', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, params.id)).limit(1);
    if (!episode) return notFound(reply, 'Episode');
    return { ...(await mintToken(cfg, 'studio', { room: episode.livekitRoom, identity: identityFor('studio', ''), name: 'Studio' })), room: episode.livekitRoom };
  });
}
