// Builds the Fastify application: cookies, sessions, role guards and the route groups.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ensureOpenUsers, OPEN_ROLE_HEADER, openRoleFrom } from './auth/open.ts';
import { SESSION_COOKIE, userForSession, type SessionUser } from './auth/sessions.ts';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { authRoutes } from './routes/auth.ts';
import { contactRoutes } from './routes/contacts.ts';
import { gatewayRoutes, type GatewayState } from './routes/gateway.ts';
import { guestRoutes } from './routes/guests.ts';
import { inviteRoutes } from './routes/invite.ts';
import { livekitRoutes } from './routes/livekit.ts';
import { pcrRoutes } from './routes/pcrs.ts';
import { roomRoutes } from './routes/room.ts';
import type { RoomRegistry } from './rooms/controller.ts';

export interface AppContext {
  cfg: Config;
  db: Db;
  rooms: RoomRegistry;
  /** The gateway's last status report (routes/gateway.ts). */
  gateway: GatewayState;
}

export type UserRole = SessionUser['role'];
type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
  interface FastifyInstance {
    ctx: AppContext;
    requireUser: Guard;
    requireRole(...roles: UserRole[]): Guard;
  }
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    trustProxy: 'loopback',
    bodyLimit: 64 * 1024,
  });

  app.decorate('ctx', ctx);
  app.decorateRequest('user', null);
  await app.register(cookie);

  // LiveKit posts webhooks as application/webhook+json; the signature check needs the raw body.
  app.addContentTypeParser('application/webhook+json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  // Test phase without passwords: requests with no session run as the open producer or engineer.
  const openUsers = ctx.cfg.openAccess ? await ensureOpenUsers(ctx.db) : null;
  if (openUsers) app.log.warn('OPEN_ACCESS=1: staff screens need no password (test phase)');

  app.addHook('onRequest', async (req) => {
    const sid = req.cookies[SESSION_COOKIE];
    req.user = sid ? await userForSession(ctx.db, sid) : null;
    if (!req.user && openUsers) req.user = openUsers[openRoleFrom(req.headers[OPEN_ROLE_HEADER])];
  });

  app.decorate('requireUser', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) await reply.code(401).send({ error: 'Sign in first.' });
  });

  app.decorate('requireRole', (...roles: UserRole[]): Guard => {
    return async (req, reply) => {
      if (!req.user) {
        await reply.code(401).send({ error: 'Sign in first.' });
        return;
      }
      if (!roles.includes(req.user.role)) await reply.code(403).send({ error: 'Not allowed for your role.' });
    };
  });

  app.get('/api/v1/health', async () => ({ ok: true, livekitUrl: ctx.cfg.LIVEKIT_URL, openAccess: ctx.cfg.openAccess }));

  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(pcrRoutes, { prefix: '/api/v1' });
  await app.register(contactRoutes, { prefix: '/api/v1' });
  await app.register(guestRoutes, { prefix: '/api/v1' });
  await app.register(inviteRoutes, { prefix: '/api/v1' });
  await app.register(roomRoutes, { prefix: '/api/v1' });
  await app.register(livekitRoutes, { prefix: '/api/v1' });
  await app.register(gatewayRoutes, { prefix: '/api/v1' });

  app.setNotFoundHandler(async (_req, reply) => reply.code(404).send({ error: 'Not found.' }));
  app.setErrorHandler(async (error: unknown, req, reply) => {
    const err = error as { statusCode?: unknown; message?: unknown };
    req.log.error({ err: error }, 'request failed');
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    const message = status === 500 || typeof err.message !== 'string' ? 'Server error.' : err.message;
    await reply.code(status).send({ error: message });
  });

  return app;
}
