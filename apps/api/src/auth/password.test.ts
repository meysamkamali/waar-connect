import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from './password.ts';

describe('passwords', () => {
  it('hash and verify round trip, different salts each time', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    assert.notEqual(a, b);
    assert.ok(a.startsWith('scrypt$16384$8$1$'));
    assert.equal(await verifyPassword('correct horse', a), true);
    assert.equal(await verifyPassword('correct horse', b), true);
  });
  it('rejects wrong passwords and malformed hashes', async () => {
    const h = await hashPassword('secret');
    assert.equal(await verifyPassword('Secret', h), false);
    assert.equal(await verifyPassword('secret', 'nonsense'), false);
    assert.equal(await verifyPassword('secret', 'scrypt$1$1$1$$'), false);
  });
});
