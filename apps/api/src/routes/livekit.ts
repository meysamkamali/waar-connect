// LiveKit webhooks: every room event is recorded; M3 turns them into room state.
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { WebhookReceiver } from 'livekit-server-sdk';
import { episodes, events } from '../db/schema.ts';

export async function livekitRoutes(app: FastifyInstance): Promise<void> {
  const { db, cfg } = app.ctx;
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
    const [episode] = roomName ? await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.livekitRoom, roomName)).limit(1) : [];
    await db.insert(events).values({
      episodeId: episode?.id ?? null,
      actor: 'livekit',
      type: `livekit.${event.event}`,
      payload: {
        room: roomName ?? null,
        participant: event.participant?.identity ?? null,
        track: event.track ? { sid: event.track.sid, type: event.track.type, source: event.track.source, name: event.track.name } : null,
      },
    });
    return { ok: true };
  });
}
