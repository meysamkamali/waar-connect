import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inviteProblem } from './invite.ts';

const now = new Date('2026-11-06T10:00:00Z');
const later = new Date('2026-11-07T10:00:00Z');
const earlier = new Date('2026-11-05T10:00:00Z');

describe('inviteProblem', () => {
  it('accepts a fresh invite for an open PCR', () => {
    assert.equal(inviteProblem({ revokedAt: null, expiresAt: later, uses: 0, maxUses: 0, closed: false }, now), null);
    assert.equal(inviteProblem({ revokedAt: null, expiresAt: later, uses: 4, maxUses: 5, closed: false }, now), null);
  });
  it('refuses revoked, expired, used-up and closed', () => {
    assert.match(inviteProblem({ revokedAt: now, expiresAt: later, uses: 0, maxUses: 0, closed: false }, now)!, /cancelled/);
    assert.match(inviteProblem({ revokedAt: null, expiresAt: earlier, uses: 0, maxUses: 0, closed: false }, now)!, /expired/);
    assert.match(inviteProblem({ revokedAt: null, expiresAt: later, uses: 1, maxUses: 1, closed: false }, now)!, /already/);
    assert.match(inviteProblem({ revokedAt: null, expiresAt: later, uses: 0, maxUses: 0, closed: true }, now)!, /closed/);
  });
});
