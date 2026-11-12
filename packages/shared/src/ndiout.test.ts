import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ndiOutputIdentity, outputIdentity, roleOf, slotOfOutput } from './model.ts';
import { DEFAULT_NDI_OUT, describeNdiOut, formatLabel, ndiOutNames, normalizeNdiOut, outSize, outTiming } from './ndiout.ts';

test('the setting: on with the house format by default, each part fixed or as the guest sends', () => {
  assert.deepEqual(DEFAULT_NDI_OUT, { on: true, height: 1080, rate: '50i' });
  assert.deepEqual(normalizeNdiOut(undefined), DEFAULT_NDI_OUT);
  assert.deepEqual(normalizeNdiOut('x'), DEFAULT_NDI_OUT);
  assert.deepEqual(normalizeNdiOut({ on: false, height: null, rate: null }), { on: false, height: null, rate: null });
  assert.deepEqual(normalizeNdiOut({ height: 720, rate: '25p' }), { on: true, height: 720, rate: '25p' });
  assert.deepEqual(normalizeNdiOut({ on: true, height: 999, rate: '60p' }), DEFAULT_NDI_OUT, 'a size or rate that is not offered falls back');
  assert.notEqual(normalizeNdiOut(undefined), DEFAULT_NDI_OUT, 'a copy each time');
});

test('formats as a broadcaster writes them', () => {
  assert.equal(formatLabel(1080, '50i'), '1080i50');
  assert.equal(formatLabel(1080, '50p'), '1080p50');
  assert.equal(formatLabel(720, '25p'), '720p25');
  assert.equal(describeNdiOut({ on: true, height: 1080, rate: '50i' }), '1080i50');
  assert.equal(describeNdiOut({ on: true, height: null, rate: null }), 'as the guest sends');
  assert.equal(describeNdiOut({ on: true, height: 720, rate: null }), '720p, frame rate as the guest sends');
  assert.equal(describeNdiOut({ on: true, height: null, rate: '50i' }), 'size as the guest sends, 50i');
  assert.equal(describeNdiOut({ on: false, height: 1080, rate: '50i' }), 'off');
});

test('timing: 50i is 25 frames a second of two fields each', () => {
  assert.deepEqual(outTiming('50i'), { fpsN: 25, fpsD: 1, interlaced: true });
  assert.deepEqual(outTiming('50p'), { fpsN: 50, fpsD: 1, interlaced: false });
  assert.deepEqual(outTiming('25p'), { fpsN: 25, fpsD: 1, interlaced: false });
  assert.deepEqual(outSize(1080), { width: 1920, height: 1080 });
  assert.deepEqual(outSize(720), { width: 1280, height: 720 });
  assert.deepEqual(outSize(540), { width: 960, height: 540 });
});

test('NDI names: the studio and the slot, one name per slot', () => {
  assert.deepEqual(ndiOutNames('PCR 1', ['Guest 1', 'Guest 2']), ['PCR 1 Guest 1', 'PCR 1 Guest 2']);
  assert.deepEqual(ndiOutNames('PCR 1', ['Sofa', 'Sofa', 'Desk']), ['PCR 1 Sofa 1', 'PCR 1 Sofa 2', 'PCR 1 Desk'], 'slots with the same name get their number');
  assert.deepEqual(ndiOutNames('News (A)', ['SDI 5 / left', '']), ['News A SDI 5 left', 'News A Guest 2'], 'characters NDI gives a meaning to are taken out');
  assert.equal(ndiOutNames('x'.repeat(80), ['y'])[0]!.length, 60);
});

test('an output identity for the page and one for the gateway, both for the same slot', () => {
  assert.equal(outputIdentity(3), 'out:slot-3');
  assert.equal(ndiOutputIdentity(3), 'out:slot-3:ndi');
  assert.equal(slotOfOutput('out:slot-3'), 3);
  assert.equal(slotOfOutput('out:slot-3:ndi'), 3);
  assert.equal(slotOfOutput('out:slot-3:other'), null);
  assert.equal(slotOfOutput('guest:abc'), null);
  assert.equal(roleOf('out:slot-3:ndi'), 'out');
});
