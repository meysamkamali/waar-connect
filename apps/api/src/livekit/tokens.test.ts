import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { grantFor, mintToken } from './tokens.ts';

const keys = { LIVEKIT_URL: 'wss://media.example', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's'.repeat(32) };

function payload(token: string): Record<string, unknown> {
  const [, body] = token.split('.');
  return JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('tokens', () => {
  it('grants follow the audience', () => {
    assert.equal(grantFor('output', 'r').canPublish, false);
    assert.equal(grantFor('output', 'r').hidden, true);
    assert.equal(grantFor('studio', 'r').canSubscribe, true); // for the multiview burn-in; routing limits it to the group's cameras
    assert.equal(grantFor('guest', 'r').canPublish, true);
    assert.equal(grantFor('monitor', 'r').hidden, true);
  });
  it('mints a JWT with identity, room and ttl', async () => {
    const t = await mintToken(keys, 'guest', { room: 'ep-1', identity: 'guest:abc', name: 'Ali', metadata: { lang: 'ku' } });
    const p = payload(t.token);
    assert.equal(p['sub'], 'guest:abc');
    assert.equal(p['name'], 'Ali');
    assert.equal((p['video'] as Record<string, unknown>)['room'], 'ep-1');
    assert.equal(JSON.parse(p['metadata'] as string).lang, 'ku');
    assert.equal(Number(p['exp']) - Number(p['nbf']), 6 * 3600);
    assert.equal(t.url, keys.LIVEKIT_URL);
  });
});
