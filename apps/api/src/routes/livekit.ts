// LiveKit webhooks: every room event is recorded, and the live ones drive the room controller.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { WebhookReceiver } from 'livekit-server-sdk';
import { events, pcrs } from '../db/schema.ts';

export async function livekitRoutes(app: FastifyInstance): Promise<void> {
  const { db, cfg, rooms } = app.ctx;
  const receiver = new WebhookReceiver(cfg.LIVEKIT_API_KEY, cfg.LIVEKIT_API_SECRET);

  app.post('/livekit/webhook', async (req, reply) => {
    let event;
    try {
      event = await receiver.receive(typeof req.body === 'string' ? req.body : JSON.stringify(req.body), req.headers.authorization);
    } catch (err) {
      req.log.warn({ err }, 'webhook rejected');
      return reply.code(401).send({ error: 'Bad webhook signature.' });
    }

    const roomName = event.room?.name;
    const [pcr] = roomName ? await db.select({ id: pcrs.id }).from(pcrs).where(eq(pcrs.livekitRoom, roomName)).limit(1) : [];
    await db.insert(events).values({
      pcrId: pcr?.id ?? null,
      actor: 'livekit',
      type: `livekit.${event.event}`,
      payload: {
        room: roomName ?? null,
        participant: event.participant?.identity ?? null,
        track: event.track ? { sid: event.track.sid, type: event.track.type, source: event.track.source, name: event.track.name } : null,
      },
    }).catch((err: unknown) => req.log.error({ err, event: event.event, room: roomName }, 'webhook event not recorded; the room still gets it'));

    // Answer LiveKit at once; the controller work continues in the background.
    void reply.send({ ok: true });
    if (!roomName || !pcr) return;

    try {
      if (event.event === 'room_finished') {
        rooms.drop(roomName);
        return;
      }
      const controller = await rooms.get(roomName);
      if (!controller) return;
      const p = event.participant;
      switch (event.event) {
        case 'participant_joined':
          if (p) await controller.onParticipantJoined({ identity: p.identity, name: p.name, attributes: { ...p.attributes }, tracks: p.tracks.map((t) => ({ sid: t.sid, name: t.name, source: t.source, muted: t.muted })) });
          break;
        case 'participant_left':
          if (p) await controller.onParticipantLeft(p.identity);
          break;
        case 'track_published':
          if (p && event.track) await controller.onTrackPublished(p.identity, { sid: event.track.sid, name: event.track.name, source: event.track.source, muted: event.track.muted });
          break;
        case 'track_unpublished':
          if (event.track) await controller.onTrackUnpublished(event.track.sid);
          break;
        default:
          break;
      }
    } catch (err) {
      req.log.error({ err, event: event.event, room: roomName }, 'room controller failed on webhook');
    }
  });
}
