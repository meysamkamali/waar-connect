// Environment configuration, validated once at start-up.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  DATABASE_URL: z.string().startsWith('postgres', 'must be a postgres:// URL'),
  LIVEKIT_URL: z.string().regex(/^wss?:\/\//, 'must start with wss://'),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(32, 'at least 32 characters'),
  PUBLIC_URL: z.url(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: z.enum(['0', '1']).default('1'),
  DEFAULT_SLOTS: z.coerce.number().int().min(1).max(16).default(4),
  // Test phase: 1 serves the staff screens without passwords (see auth/open.ts). 0 for the final phase.
  OPEN_ACCESS: z.enum(['0', '1']).default('0'),
  // Shared secret of the gateway (apps/gateway); unset = no gateway, its routes answer 503.
  GATEWAY_TOKEN: z.string().min(16, 'at least 16 characters').optional(),
});

export type Config = Readonly<z.infer<typeof schema>> & { readonly cookieSecure: boolean; readonly openAccess: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Bad environment: ${issues}. Copy .env.example to .env and fill it in.`);
  }
  return { ...parsed.data, cookieSecure: parsed.data.COOKIE_SECURE === '1', openAccess: parsed.data.OPEN_ACCESS === '1' };
}
