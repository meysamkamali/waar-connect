import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultGuestState, guestAttributes, guestFromAttributes, identityFor, outputIdentity, roleOf, slotOfOutput } from './model.ts';

describe('identities', () => {
  it('build and parse round trip', () => {
    assert.equal(identityFor('guest', 'ali'), 'guest:ali');
    assert.equal(identityFor('studio', 'anything'), 'studio');
    assert.equal(outputIdentity(3), 'out:slot-3');
    assert.equal(roleOf('guest:ali'), 'guest');
    assert.equal(roleOf('studio'), 'studio');
    assert.equal(roleOf('out:slot-3'), 'out');
    assert.equal(roleOf('nobody'), undefined);
    assert.equal(slotOfOutput('out:slot-12'), 12);
    assert.equal(slotOfOutput('out:x'), null);
  });
});

describe('attributes', () => {
  it('round trip every field', () => {
    const g = { ...defaultGuestState('guest:ali'), place: 'studio' as const, tally: 'onair' as const, slot: 2, table: 't1', studioSound: true, program: true, ready: true };
    assert.deepEqual(guestFromAttributes('guest:ali', guestAttributes(g)), g);
  });
  it('fall back to the lobby defaults on garbage', () => {
    const g = guestFromAttributes('guest:ali', { 'wc.place': 'moon', 'wc.slot': '-4', 'wc.tally': '' });
    assert.deepEqual(g, defaultGuestState('guest:ali'));
  });
});
