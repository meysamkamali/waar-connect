// Open access for the test phase: no passwords until the final phase.
//
// With OPEN_ACCESS=1 a request without a session is served as a fixed producer, engineer or admin
// account. The screens say which one they are in the x-wc-role header (from their own path:
// /app/engineer, /app/admin, anything else is producer). The accounts live in the users table
// (foreign keys need them) but are disabled for password login, and a real session still wins.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { users } from '../db/schema.ts';
import type { SessionUser } from './sessions.ts';

export const OPEN_ROLE_HEADER = 'x-wc-role';

export type OpenRole = 'producer' | 'engineer' | 'admin';
export const OPEN_ROLES: readonly OpenRole[] = ['producer', 'engineer', 'admin'];

export const OPEN_ACCOUNTS: Readonly<Record<OpenRole, { email: string; name: string }>> = {
  producer: { email: 'producer@open.waar-connect.invalid', name: 'Producer' },
  engineer: { email: 'engineer@open.waar-connect.invalid', name: 'Engineer' },
  admin: { email: 'admin@open.waar-connect.invalid', name: 'Admin' },
};

/** The role a request asks for; producer unless the header says engineer or admin. */
export function openRoleFrom(header: string | string[] | undefined): OpenRole {
  const value = (Array.isArray(header) ? header[0] : header)?.trim().toLowerCase();
  return value === 'engineer' || value === 'admin' ? value : 'producer';
}

/** Creates the open accounts if missing and returns them as request users. */
export async function ensureOpenUsers(db: Db): Promise<Readonly<Record<OpenRole, SessionUser>>> {
  const out: Partial<Record<OpenRole, SessionUser>> = {};
  for (const role of OPEN_ROLES) {
    const account = OPEN_ACCOUNTS[role];
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, account.email)).limit(1);
    let id = existing?.id;
    if (!id) {
      // No scrypt prefix, so verifyPassword always says no; disabledAt blocks the login route too.
      const [row] = await db
        .insert(users)
        .values({ email: account.email, name: account.name, role, passwordHash: 'open-access', disabledAt: new Date() })
        .returning({ id: users.id });
      id = row!.id;
    }
    out[role] = { id, email: account.email, name: account.name, role, sessionId: '' };
  }
  return out as Record<OpenRole, SessionUser>;
}
