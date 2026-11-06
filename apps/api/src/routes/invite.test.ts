import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inviteProblem } from './invite.ts';

const now = new Date('2026-11-06T10:00:00Z');
const later = new Date('2026-11-07T10:00:00Z');
const earlier = new Date('2026-11-05T10:00:00Z');

describe('inviteProblem', () => {
  it('accepts a fresh invite for a planned or live episode', () => {
    assert.equal(inviteProblem({ revokedAt: null, expiresAt: later, uses: 0, maxUses: 0, episodeStatus: 'planned' }, now), null);
    assert.equal(inviteProblem({ revokedAt: null, expiresAt: later, uses: 4, maxUses: 5, episodeStatus: 'live' }, now), null);
  });
  it('refuses revoked, expired, used-up and ended', () => {
    assert.match(inviteProblem({ revokedAt: now, expiresAt: later, uses: 0, maxUses: 0, episodeStatus: 'live' }, now)!, /cancelled/);
    assert.match(inviteProblem({ revokedAt: null, expiresAt: earlier, uses: 0, maxUses: 0, episodeStatus: 'live' }, now)!, /expired/);
    assert.match(inviteProblem({ revokedAt: null, expiresAt: later, uses: 1, maxUses: 1, episodeStatus: 'live' }, now)!, /already/);
    assert.match(inviteProblem({ revokedAt: null, expiresAt: later, uses: 0, maxUses: 0, episodeStatus: 'ended' }, now)!, /ended/);
  });
});
