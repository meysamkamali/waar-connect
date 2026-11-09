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
import { getSetting, setSetting } from '../db/settings.ts';
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
  sources: z
    .array(z.object({ name: z.string().max(200), url: z.string().max(200).nullable(), network: z.string().max(40).nullable(), own: z.boolean() }))
    .max(200),
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
        publish: z.object({ codec: z.string().max(40), maxKbps: z.int().min(0), maxFps: z.number().min(0), width: z.int().min(0), height: z.int().min(0) }).nullable(),
        since: z.number(),
      }),
    )
    .max(64),
  extraIps: z.array(z.string().max(120)).max(64),
  defaults: z.object({ height: z.int().min(0).nullable(), kbps: z.int().min(0), fps: z.number().min(0) }),
});

/** What the admin page shows: the last report, or null when none came within GATEWAY_STALE_MS. */
export function statusOf(state: GatewayState, now = Date.now()): GatewayStatus | null {
  if (!state.report || now - state.seenAt > GATEWAY_STALE_MS) return null;
  return { ...state.report, seenAt: state.seenAt };
}

/** Station setting: the admin's list of NDI sender addresses on networks the gateway is not on. */
export const EXTRA_IPS_KEY = 'ndi_extra_ips';
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)*$/;

/**
 * The address list from an array or one text with commas, spaces or new lines between the entries:
 * IPv4 addresses or host names, trimmed, lower-cased, without repeats. The first bad entry is named.
 */
export function parseExtraIps(input: unknown): string[] | { error: string } {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? [input] : [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return { error: 'addresses must be text' };
    for (const part of item.split(/[\s,;]+/)) {
      const a = part.trim().toLowerCase();
      if (!a) continue;
      const m = IPV4.exec(a);
      const ok = m ? m.slice(1).every((n) => Number(n) <= 255) : a.length <= 120 && HOSTNAME.test(a);
      if (!ok) return { error: `"${part}" is not an IPv4 address or host name` };
      if (!out.includes(a)) out.push(a);
    }
  }
  if (out.length > 32) return { error: 'at most 32 addresses' };
  return out;
}

export async function gatewayRoutes(app: FastifyInstance): Promise<void> {
  const { db, cfg, gateway } = app.ctx;
  const staff = app.requireRole('admin', 'producer', 'engineer');
  const admin = app.requireRole('admin');

  const loadExtraIps = async (): Promise<string[]> => {
    const parsed = parseExtraIps((await getSetting(db, EXTRA_IPS_KEY)) ?? []);
    return Array.isArray(parsed) ? parsed : [];
  };

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
      returns.push({
        pcrId: pcr.id,
        pcrName: pcr.name,
        room: pcr.livekitRoom,
        source,
        height: pcr.settings.returnHeight ?? null,
        kbps: pcr.settings.returnKbps ?? null,
        url: token.url,
        token: token.token,
      });
    }
    return { returns, extraIps: await loadExtraIps() };
  });

  app.post('/gateway/report', { preHandler: fromGateway }, async (req, reply) => {
    const body = parseOr400(Report, req.body, reply);
    if (!body) return;
    gateway.report = body;
    gateway.seenAt = Date.now();
    return { ok: true };
  });

  /** For the admin page: the gateway's sources and feed states, and whether a gateway is set up at all. */
  app.get('/gateway/status', { preHandler: staff }, async () => ({ configured: Boolean(cfg.GATEWAY_TOKEN), status: statusOf(gateway), extraIps: await loadExtraIps() }));

  /** The admin's list of NDI sender addresses on other networks; the gateway picks it up on its next poll. */
  app.put('/gateway/discovery', { preHandler: admin }, async (req, reply) => {
    const body = (req.body ?? {}) as { extraIps?: unknown };
    const parsed = parseExtraIps(body.extraIps);
    if (!Array.isArray(parsed)) return reply.code(400).send({ error: parsed.error });
    await setSetting(db, EXTRA_IPS_KEY, parsed);
    return { extraIps: parsed };
  });
}
