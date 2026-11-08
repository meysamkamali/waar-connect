import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultPcrSettings } from '../db/schema.ts';
import { mergeSettings } from './pcrs.ts';

test('mergeSettings keeps output names in step with the slot count', () => {
  const base = defaultPcrSettings(4);
  assert.deepEqual(base.outputNames, ['Guest 1', 'Guest 2', 'Guest 3', 'Guest 4']);

  const fewer = mergeSettings(base, { slots: 2 });
  assert.deepEqual(fewer.outputNames, ['Guest 1', 'Guest 2']);

  const more = mergeSettings(fewer, { slots: 3, outputNames: ['SDI 5', ''] });
  assert.deepEqual(more.outputNames, ['SDI 5', 'Guest 2', 'Guest 3']);
  assert.equal(more.readyRequired, false); // default since 2026-11-08: the producer decides

  const untouched = mergeSettings(base, undefined);
  assert.deepEqual(untouched, base);
  assert.notEqual(untouched.outputNames, base.outputNames);
});
