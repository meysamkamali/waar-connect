// The gateway (NDI in and out) talks to these: which PCRs want a return feed, with a token for the
// `studio` identity; and its status report, which the admin page reads back.
// The gateway is a service, not a person: it authenticates with the shared GATEWAY_TOKEN header,
// in the test phase and the final phase alike.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { GATEWAY_STALE_MS, RETURN_STATES, STUDIO_IDENTITY, type GatewayReport, type GatewayStatus } from '@waar-connect/shared';
import { z } from 'zod';
import { pcrs } from '../db/schema.ts';
import { parseOr400 } from '../http.ts';
import { mintToken } from '../livekit/tokens.ts';

export const GATEWAY_HEADER = 'x-wc-gateway';

/** The last report the gateway sent, kept in memory; the gateway repeats it every few seconds. */
export interface GatewayState {
  report: GatewayReport | null;
  seenAt: number;
}

export function newGatewayState(): GatewayState {
  return { report: null, seenAt: 0 };
}

export const Report = z.object({
  version: z.string().max(80),
  host: z.string().max(120),
  sources: z.array(z.object({ name: z.string().max(200), url: z.string().max(200).nullable() })).max(200),
  returns: z
    .array(
      z.object({
        pcrId: z.uuid(),
        pcrName: z.string().max(80),
        source: z.string().max(200),
        state: z.enum(RETURN_STATES),
        detail: z.string().max(500).nullable(),
        connected: z.boolean(),
        video: z.object({ width: z.int().min(0), height: z.int().min(0), fps: z.number().min(0) }).nullable(),
        audio: z.object({ channels: z.int().min(0), sampleRate: z.int().min(0) }).nullable(),
        publish: z.object({ codec: z.string().max(40), maxKbps: z.int().min(0), maxFps: z.number().min(0) }).nullable(),
        since: z.number(),
      }),
    )
    .max(64),
});

/** What the admin page shows: the last report, or null when none came within GATEWAY_STALE_MS. */
export function statusOf(state: GatewayState, now = Date.now()): GatewayStatus | null {
  if (!state.report || now - state.seenAt > GATEWAY_STALE_MS) return null;
  return { ...state.report, seenAt: state.seenAt };
}

export async function gatewayRoutes(app: FastifyInstance): Promise<void> {
  const { db, cfg, gateway } = app.ctx;
  const staff = app.requireRole('admin', 'producer', 'engineer');

  const fromGateway = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!cfg.GATEWAY_TOKEN) {
      await reply.code(503).send({ error: 'The API has no GATEWAY_TOKEN; run deploy/vm/install-gateway.sh.' });
      return;
    }
    const given = req.headers[GATEWAY_HEADER];
    if ((Array.isArray(given) ? given[0] : given) !== cfg.GATEWAY_TOKEN) await reply.code(401).send({ error: 'Gateway token mismatch.' });
  };

  /** Every open PCR with an NDI return source, each with a 7-day token for identity `studio`. */
  app.get('/gateway/returns', { preHandler: fromGateway }, async () => {
    const rows = await db.select().from(pcrs).where(isNull(pcrs.archivedAt));
    const returns = [];
    for (const pcr of rows) {
      const source = pcr.settings.returnSource;
      if (!source) continue;
      const token = await mintToken(cfg, 'studio', { room: pcr.livekitRoom, identity: STUDIO_IDENTITY, name: 'Studio' });
      returns.push({ pcrId: pcr.id, pcrName: pcr.name, room: pcr.livekitRoom, source, url: token.url, token: token.token });
    }
    return { returns };
  });

  app.post('/gateway/report', { preHandler: fromGateway }, async (req, reply) => {
    const body = parseOr400(Report, req.body, reply);
    if (!body) return;
    gateway.report = body;
    gateway.seenAt = Date.now();
    return { ok: true };
  });

  /** For the admin page: the gateway's sources and feed states, and whether a gateway is set up at all. */
  app.get('/gateway/status', { preHandler: staff }, async () => ({ configured: Boolean(cfg.GATEWAY_TOKEN), status: statusOf(gateway) }));
}
