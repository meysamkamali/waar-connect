// Live room of a PCR: snapshot for the producer and engineer screens, and the green-room actions.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { identityFor } from '@waar-connect/shared';
import { z } from 'zod';
import { pcrs } from '../db/schema.ts';
import { notFound, parseOr400 } from '../http.ts';
import { ActionError, type RoomAction } from '../rooms/controller.ts';

const Id = z.object({ id: z.uuid() });
const Identity = z.string().min(3).max(120);

const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('admit'), guest: Identity }),
  z.object({ type: z.literal('peer'), guest: Identity, other: Identity, on: z.boolean() }),
  z.object({ type: z.literal('studioSound'), guest: Identity, on: z.boolean() }),
  z.object({ type: z.literal('program'), guest: Identity, on: z.boolean() }),
  z.object({ type: z.literal('slot'), guest: Identity, slot: z.int().min(1).max(16).nullable() }),
  z.object({ type: z.literal('ready'), guest: Identity, on: z.boolean() }),
  z.object({ type: z.literal('handoff'), guest: Identity }),
  z.object({ type: z.literal('tally'), guest: Identity, tally: z.enum(['standby', 'onair']) }),
  z.object({ type: z.literal('bringBack'), guest: Identity }),
  z.object({ type: z.literal('kick'), guest: Identity }),
  z.object({ type: z.literal('ifb'), guest: Identity, on: z.boolean() }),
  z.object({ type: z.literal('talk'), to: z.union([z.literal('none'), z.literal('all'), z.array(Identity).max(32)]) }),
  z.object({ type: z.literal('face'), guest: Identity.nullable() }),
  z.object({ type: z.literal('cue'), to: z.union([z.literal('all'), Identity]), text: z.string().max(200) }),
  z.object({ type: z.literal('command'), guest: Identity, command: z.record(z.string(), z.unknown()) }),
]);

export async function roomRoutes(app: FastifyInstance): Promise<void> {
  const { db, rooms } = app.ctx;
  const staff = app.requireRole('admin', 'producer', 'engineer');

  async function controllerFor(pcrId: string) {
    const [pcr] = await db.select().from(pcrs).where(eq(pcrs.id, pcrId)).limit(1);
    if (!pcr) return { pcr: undefined, controller: null };
    return { pcr, controller: pcr.archivedAt ? null : await rooms.get(pcr.livekitRoom) };
  }

  app.get('/pcrs/:id/room', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    if (!params) return;
    const { pcr, controller } = await controllerFor(params.id);
    if (!pcr) return notFound(reply, 'PCR');
    if (!controller) return reply.code(409).send({ error: 'This studio is closed.' });
    return { snapshot: controller.snapshot() };
  });

  app.post('/pcrs/:id/room/actions', { preHandler: staff }, async (req, reply) => {
    const params = parseOr400(Id, req.params, reply);
    const body = params && parseOr400(Action, req.body, reply);
    if (!params || !body) return;
    const { pcr, controller } = await controllerFor(params.id);
    if (!pcr) return notFound(reply, 'PCR');
    if (!controller) return reply.code(409).send({ error: 'This studio is closed.' });

    const user = req.user!;
    const staffIdentity = identityFor(user.role === 'engineer' ? 'engineer' : 'producer', user.id);
    const action: RoomAction =
      body.type === 'talk' ? { type: 'talk', staff: staffIdentity, to: body.to } : body.type === 'face' ? { type: 'face', staff: staffIdentity, guest: body.guest } : body;

    try {
      const snapshot = await controller.act(action, staffIdentity);
      return { snapshot };
    } catch (err) {
      if (err instanceof ActionError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });
}
