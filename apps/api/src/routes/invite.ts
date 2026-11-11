// The public side of an invite: the guest's link resolves to join information and a LiveKit token.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { identityFor, normalizeGuestPrefs, normalizeScreen } from '@waar-connect/shared';
import { z } from 'zod';
import { guests, invites, pcrs } from '../db/schema.ts';
import { parseOr400 } from '../http.ts';
import { mintToken } from '../livekit/tokens.ts';

const TokenParam = z.object({ token: z.string().min(16).max(64) });

export interface InviteCheck {
  revokedAt: Date | null;
  expiresAt: Date;
  uses: number;
  maxUses: number;
  /** The PCR the seat belongs to has been archived. */
  closed: boolean;
}

/** Why an invite cannot be used right now, or null when it can. Pure, so it is unit-tested. */
export function inviteProblem(i: InviteCheck, now: Date = new Date()): string | null {
  if (i.revokedAt) return 'This link was cancelled by the producer.';
  if (i.expiresAt.getTime() <= now.getTime()) return 'This link has expired.';
  if (i.maxUses > 0 && i.uses >= i.maxUses) return 'This link has already been used.';
  if (i.closed) return 'This studio is closed.';
  return null;
}

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  const { db, cfg } = app.ctx;

  app.get('/invite/:token', async (req, reply) => {
    const params = parseOr400(TokenParam, req.params, reply);
    if (!params) return;
    const [row] = await db
      .select({ invite: invites, guest: guests, pcr: pcrs })
      .from(invites)
      .innerJoin(guests, eq(invites.guestId, guests.id))
      .innerJoin(pcrs, eq(guests.pcrId, pcrs.id))
      .where(eq(invites.token, params.token))
      .limit(1);
    if (!row) return reply.code(404).send({ error: 'This link is not valid.' });

    const problem = inviteProblem({ ...row.invite, closed: row.pcr.archivedAt !== null });
    if (problem) return reply.code(410).send({ error: problem });

    await db
      .update(invites)
      .set({ uses: sql`${invites.uses} + 1`, lastUsedAt: new Date() })
      .where(eq(invites.token, params.token));

    const livekit = await mintToken(cfg, 'guest', {
      room: row.pcr.livekitRoom,
      identity: identityFor('guest', row.guest.id),
      name: row.guest.displayName,
      metadata: { language: row.guest.language },
    });
    return {
      guest: { id: row.guest.id, displayName: row.guest.displayName, language: row.guest.language },
      pcr: { id: row.pcr.id, name: row.pcr.name },
      livekit,
      // How this phone should connect unless the producer or engineer pushes something else to it.
      prefs: normalizeGuestPrefs(row.pcr.settings.guest),
      // The guest's screen as the admin designed it for this studio.
      screen: normalizeScreen(row.pcr.settings.screen),
    };
  });
}
