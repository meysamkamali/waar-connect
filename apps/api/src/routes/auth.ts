import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyPassword } from '../auth/password.ts';
import { RateLimiter } from '../auth/ratelimit.ts';
import { createSession, deleteSession, SESSION_COOKIE, sessionCookieOptions } from '../auth/sessions.ts';
import { users } from '../db/schema.ts';
import { parseOr400 } from '../http.ts';

const LoginBody = z.object({ email: z.email(), password: z.string().min(1).max(200) });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { db, cfg } = app.ctx;
  const limiter = new RateLimiter(10, 15 * 60_000);

  app.post('/auth/login', async (req, reply) => {
    if (limiter.blocked(req.ip)) return reply.code(429).send({ error: 'Too many attempts. Try again in fifteen minutes.' });
    const body = parseOr400(LoginBody, req.body, reply);
    if (!body) return;

    const [user] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase())).limit(1);
    const ok = user !== undefined && user.disabledAt === null && (await verifyPassword(body.password, user.passwordHash));
    if (!ok || !user) {
      limiter.failure(req.ip);
      return reply.code(401).send({ error: 'Wrong email or password.' });
    }
    limiter.success(req.ip);

    const session = await createSession(db, user.id, cfg.SESSION_TTL_HOURS, req.headers['user-agent']);
    reply.setCookie(SESSION_COOKIE, session.id, sessionCookieOptions(cfg.cookieSecure, session.expiresAt));
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  });

  app.post('/auth/logout', { preHandler: app.requireUser }, async (req, reply) => {
    await deleteSession(db, req.user!.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', { preHandler: app.requireUser }, async (req) => {
    const { sessionId: _omit, ...user } = req.user!;
    return { user };
  });
}
