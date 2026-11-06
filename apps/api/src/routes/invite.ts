// The public side of an invite: the guest's link resolves to join information and a LiveKit token.
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { identityFor } from '@waar-connect/shared';
import { z } from 'zod';
import { episodes, guests, invites, programs } from '../db/schema.ts';
import { parseOr400 } from '../http.ts';
import { mintToken } from '../livekit/tokens.ts';

const TokenParam = z.object({ token: z.string().min(16).max(64) });

export interface InviteCheck {
  revokedAt: Date | null;
  expiresAt: Date;
  uses: number;
  maxUses: number;
  episodeStatus: 'planned' | 'live' | 'ended';
}

/** Why an invite cannot be used right now, or null when it can. Pure, so it is unit-tested. */
export function inviteProblem(i: InviteCheck, now: Date = new Date()): string | null {
  if (i.revokedAt) return 'This link was cancelled by the producer.';
  if (i.expiresAt.getTime() <= now.getTime()) return 'This link has expired.';
  if (i.maxUses > 0 && i.uses >= i.maxUses) return 'This link has already been used.';
  if (i.episodeStatus === 'ended') return 'This programme has ended.';
  return null;
}

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  const { db, cfg } = app.ctx;

  app.get('/invite/:token', async (req, reply) => {
    const params = parseOr400(TokenParam, req.params, reply);
    if (!params) return;
    const [row] = await db
      .select({ invite: invites, guest: guests, episode: episodes, settings: programs.settings, programName: programs.name })
      .from(invites)
      .innerJoin(guests, eq(invites.guestId, guests.id))
      .innerJoin(episodes, eq(guests.episodeId, episodes.id))
      .innerJoin(programs, eq(episodes.programId, programs.id))
      .where(eq(invites.token, params.token))
      .limit(1);
    if (!row) return reply.code(404).send({ error: 'This link is not valid.' });

    const problem = inviteProblem({ ...row.invite, episodeStatus: row.episode.status });
    if (problem) return reply.code(410).send({ error: problem });

    await db
      .update(invites)
      .set({ uses: sql`${invites.uses} + 1`, lastUsedAt: new Date() })
      .where(eq(invites.token, params.token));

    const livekit = await mintToken(cfg, 'guest', {
      room: row.episode.livekitRoom,
      identity: identityFor('guest', row.guest.id),
      name: row.guest.displayName,
      metadata: { language: row.guest.language },
    });
    return {
      guest: { id: row.guest.id, displayName: row.guest.displayName, language: row.guest.language },
      episode: { id: row.episode.id, title: row.episode.title, status: row.episode.status, program: row.programName },
      livekit,
    };
  });
}
