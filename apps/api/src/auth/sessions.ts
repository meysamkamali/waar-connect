// Server-side sessions for producers and engineers: a random id in a cookie, the row in Postgres.
import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { sessions, users } from '../db/schema.ts';

export const SESSION_COOKIE = 'wc_session';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'producer' | 'engineer';
  sessionId: string;
}

export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionExpiry(ttlHours: number, now: number = Date.now()): Date {
  return new Date(now + ttlHours * 3_600_000);
}

export function sessionCookieOptions(secure: boolean, expires: Date) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure, expires };
}

export async function createSession(db: Db, userId: string, ttlHours: number, userAgent: string | undefined): Promise<{ id: string; expiresAt: Date }> {
  const id = newSessionId();
  const expiresAt = sessionExpiry(ttlHours);
  await db.insert(sessions).values({ id, userId, expiresAt, userAgent: userAgent ?? null });
  return { id, expiresAt };
}

export async function userForSession(db: Db, sessionId: string): Promise<SessionUser | null> {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date()), isNull(users.disabledAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
