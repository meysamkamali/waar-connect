// waar Connect phase 0 — shared PIN gate with a small per-address attempt limit.
// Phase 1 replaces this with real accounts and per-guest invite tokens.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { createHash, timingSafeEqual } from 'node:crypto';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 20;

interface Bucket {
  failures: number;
  resetAt: number;
}

export class PinGate {
  readonly #digest: Buffer;
  readonly #buckets = new Map<string, Bucket>();

  constructor(pin: string) {
    this.#digest = sha256(pin);
  }

  /** Returns 'ok', 'wrong', or 'blocked' when the address has failed too often. */
  check(address: string, candidate: unknown): 'ok' | 'wrong' | 'blocked' {
    const now = Date.now();
    const bucket = this.#buckets.get(address);
    if (bucket && bucket.resetAt <= now) this.#buckets.delete(address);
    const live = this.#buckets.get(address);
    if (live && live.failures >= MAX_FAILURES) return 'blocked';

    if (typeof candidate === 'string' && timingSafeEqual(sha256(candidate), this.#digest)) {
      this.#buckets.delete(address);
      return 'ok';
    }
    if (live) live.failures += 1;
    else this.#buckets.set(address, { failures: 1, resetAt: now + WINDOW_MS });
    return 'wrong';
  }
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
