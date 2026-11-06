// waar Connect phase 0 — LiveKit access tokens per role.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { AccessToken } from 'livekit-server-sdk';
import type { Config } from './config.ts';

export const ROLES = ['guest', 'studio', 'out', 'monitor'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Room names are short slugs; they appear in URLs and OBS source names. */
export const ROOM_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Display names: letters in any script, digits, space, dot, dash, underscore. */
export const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;

export interface TokenRequest {
  role: Role;
  room: string;
  name: string;
}

export interface TokenResult {
  token: string;
  identity: string;
  url: string;
}

/**
 * Identity carries the role so pages can filter by prefix.
 * The studio return is always exactly `studio`: guests subscribe to that one identity.
 * Out pages and monitors get a random suffix so several can watch the same guest.
 */
export function identityFor(role: Role, name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const suffix = Math.random().toString(36).slice(2, 7);
  switch (role) {
    case 'guest':
      return `guest:${slug}`;
    case 'studio':
      return 'studio';
    case 'out':
      return `out:${slug}-${suffix}`;
    case 'monitor':
      return `monitor:${suffix}`;
  }
}

export async function mintToken(cfg: Config, req: TokenRequest): Promise<TokenResult> {
  const identity = identityFor(req.role, req.name);
  const publishes = req.role === 'guest' || req.role === 'studio';
  const token = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity,
    name: req.role === 'studio' ? 'Studio' : req.name.trim(),
    // Shows run long; pages that stay open all evening must not expire mid-programme.
    ttl: publishes && req.role === 'guest' ? '3h' : '12h',
  });
  token.addGrant({
    room: req.room,
    roomJoin: true,
    canPublish: publishes,
    canSubscribe: true,
    canPublishData: true,
    // Out pages and monitors are invisible to the others; nobody should subscribe to a monitor.
    hidden: !publishes,
  });
  return { token: await token.toJwt(), identity, url: cfg.livekitUrl };
}
