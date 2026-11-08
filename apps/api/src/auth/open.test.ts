import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPEN_ACCOUNTS, openRoleFrom } from './open.ts';

test('open role: producer unless the header says engineer or admin', () => {
  assert.equal(openRoleFrom(undefined), 'producer');
  assert.equal(openRoleFrom(''), 'producer');
  assert.equal(openRoleFrom('producer'), 'producer');
  assert.equal(openRoleFrom('guest'), 'producer');
  assert.equal(openRoleFrom('engineer'), 'engineer');
  assert.equal(openRoleFrom(' Engineer '), 'engineer');
  assert.equal(openRoleFrom('admin'), 'admin');
  assert.equal(openRoleFrom(['engineer', 'producer']), 'engineer');
});

test('open accounts use addresses nobody can register', () => {
  for (const account of Object.values(OPEN_ACCOUNTS)) assert.match(account.email, /@open\.waar-connect\.invalid$/);
});
