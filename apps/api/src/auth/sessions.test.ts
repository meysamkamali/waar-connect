import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newSessionId, sessionCookieOptions, sessionExpiry } from './sessions.ts';

describe('sessions', () => {
  it('ids are long, url-safe and unique', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSessionId()));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{43}$/);
  });
  it('expiry and cookie options', () => {
    const now = Date.UTC(2026, 0, 1);
    const exp = sessionExpiry(12, now);
    assert.equal(exp.getTime() - now, 12 * 3_600_000);
    const opts = sessionCookieOptions(true, exp);
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.secure, true);
    assert.equal(opts.sameSite, 'lax');
    assert.equal(opts.path, '/');
  });
});
