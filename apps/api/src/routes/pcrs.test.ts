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
  assert.equal(more.ifbAllowed, true);

  const untouched = mergeSettings(base, undefined);
  assert.deepEqual(untouched, base);
  assert.notEqual(untouched.outputNames, base.outputNames);
});

test('mergeSettings: the NDI return source is trimmed, cleared by an empty string, and absent means null', () => {
  const base = defaultPcrSettings(2);
  assert.equal(base.returnSource, null);
  assert.equal(mergeSettings(base, { returnSource: '  MIXER (Program) ' }).returnSource, 'MIXER (Program)');
  const set = mergeSettings(base, { returnSource: 'MIXER (Program)' });
  assert.equal(mergeSettings(set, { slots: 3 }).returnSource, 'MIXER (Program)', 'untouched by other changes');
  assert.equal(mergeSettings(set, { returnSource: '' }).returnSource, null);
  assert.equal(mergeSettings(set, { returnSource: null }).returnSource, null);
  // A row written before the field existed
  const old = { ...base } as Partial<typeof base>;
  delete old.returnSource;
  assert.equal(mergeSettings(old as typeof base, undefined).returnSource, null);
});

test('return picture size and bitrate: null means the gateway default; other changes leave them alone', () => {
  const base = defaultPcrSettings(2);
  assert.equal(base.returnHeight, null);
  assert.equal(base.returnKbps, null);
  const set = mergeSettings(base, { returnHeight: 540, returnKbps: 1500 });
  assert.equal(set.returnHeight, 540);
  assert.equal(set.returnKbps, 1500);
  assert.equal(mergeSettings(set, { slots: 3 }).returnHeight, 540);
  assert.equal(mergeSettings(set, { returnHeight: null }).returnHeight, null);
  assert.equal(mergeSettings(set, { returnKbps: null }).returnKbps, null);
  // rows written before the fields existed
  const old = { ...base } as Partial<typeof base>;
  delete old.returnHeight;
  delete old.returnKbps;
  assert.equal(mergeSettings(old as typeof base, undefined).returnHeight, null);
});
