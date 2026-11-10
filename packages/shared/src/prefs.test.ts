import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { choiceMatches, DEFAULT_FACE_PREFS, DEFAULT_GUEST_PREFS, describeChoice, normalizeFacePrefs, normalizeGuestPrefs, pickCodec, type CodecChoice } from './prefs.ts';

// The station's example order: H.265 hardware, H.264 hardware, H.264 software, AV1 hardware.
const ORDER: CodecChoice[] = [
  { codec: 'h265', encoder: 'hw' },
  { codec: 'h264', encoder: 'hw' },
  { codec: 'h264', encoder: 'sw' },
  { codec: 'av1', encoder: 'hw' },
];

describe('pickCodec', () => {
  it('takes the first line the phone can do, from the top', () => {
    assert.equal(pickCodec(ORDER, { h265: 'hw', h264: 'hw', av1: 'sw' }), 'h265');
    assert.equal(pickCodec(ORDER, { h265: 'sw', h264: 'hw' }), 'h264', 'software H.265 does not satisfy a hardware line');
    assert.equal(pickCodec(ORDER, { h265: 'no', h264: 'sw', av1: 'hw' }), 'h264', 'the software H.264 line comes before AV1');
    assert.equal(pickCodec(ORDER, { h265: 'no', h264: 'no', av1: 'hw' }), 'av1');
  });
  it('skips codecs that failed on this phone, in the list and in the phone\'s own answer', () => {
    assert.equal(pickCodec(ORDER, { h265: 'hw', h264: 'hw' }, ['h265']), 'h264');
    assert.equal(pickCodec(ORDER, { h265: 'failed', h264: 'hw' }), 'h264');
    assert.equal(pickCodec(ORDER, { h265: 'hw', h264: 'hw', av1: 'hw' }, ['h265', 'h264']), 'av1');
  });
  it('falls back to H.264, then VP8, when no line fits', () => {
    assert.equal(pickCodec(ORDER, { h265: 'no', h264: 'unknown', av1: 'no' }), 'h264', 'a phone that does not say how it encodes fits no hardware or software line');
    assert.equal(pickCodec(ORDER, undefined), 'h264', 'not probed');
    assert.equal(pickCodec(ORDER, { h264: 'hw' }, ['h264']), 'vp8');
    assert.equal(pickCodec([], {}), 'h264');
  });
  it('an "any" line takes hardware, software and a phone that does not say', () => {
    const any: CodecChoice[] = [{ codec: 'av1', encoder: 'any' }];
    assert.equal(pickCodec(any, { av1: 'hw' }), 'av1');
    assert.equal(pickCodec(any, { av1: 'sw' }), 'av1');
    assert.equal(pickCodec(any, { av1: 'unknown' }), 'av1');
    assert.equal(pickCodec(any, undefined), 'av1');
    assert.equal(pickCodec(any, { av1: 'no' }), 'h264');
    assert.equal(choiceMatches({ codec: 'h264', encoder: 'sw' }, 'hw'), false);
  });
  it('the defaults are what the system did before: H.264', () => {
    assert.equal(pickCodec(DEFAULT_GUEST_PREFS.codecs, { h264: 'hw', h265: 'hw' }), 'h264');
    assert.equal(pickCodec(DEFAULT_GUEST_PREFS.codecs, { h264: 'unknown' }), 'h264');
  });
});

describe('normalize', () => {
  it('fills gaps with the defaults and keeps valid values', () => {
    assert.deepEqual(normalizeGuestPrefs(undefined), DEFAULT_GUEST_PREFS);
    assert.deepEqual(normalizeGuestPrefs({ height: 1080, kbps: 4000 }), { ...DEFAULT_GUEST_PREFS, height: 1080, kbps: 4000 });
    assert.deepEqual(normalizeGuestPrefs({ codecs: ORDER, height: 540, fps: 30, kbps: 1500, degrade: 'framerate' }), { codecs: ORDER, height: 540, fps: 30, kbps: 1500, degrade: 'framerate' });
    assert.notEqual(normalizeGuestPrefs(undefined).codecs, DEFAULT_GUEST_PREFS.codecs, 'a copy, never the shared default');
  });
  it('drops bad and repeated lines, clamps the bitrate, refuses odd sizes', () => {
    const p = normalizeGuestPrefs({
      codecs: [{ codec: 'h265', encoder: 'hw' }, { codec: 'h265', encoder: 'hw' }, { codec: 'mpeg2', encoder: 'hw' }, { codec: 'av1', encoder: 'gpu' }, 'x', { codec: 'vp9', encoder: 'any' }],
      height: 600,
      fps: 60,
      kbps: 99_999,
      degrade: 'best',
    });
    assert.deepEqual(p.codecs, [{ codec: 'h265', encoder: 'hw' }, { codec: 'vp9', encoder: 'any' }]);
    assert.equal(p.height, 720);
    assert.equal(p.fps, 25);
    assert.equal(p.kbps, 8000);
    assert.equal(p.degrade, 'resolution');
    assert.equal(normalizeGuestPrefs({ kbps: 10 }).kbps, 400);
    assert.deepEqual(normalizeGuestPrefs({ codecs: [] }).codecs, DEFAULT_GUEST_PREFS.codecs, 'an empty list is not a list');
  });
  it('face camera: defaults, valid values, clamping', () => {
    assert.deepEqual(normalizeFacePrefs(null), DEFAULT_FACE_PREFS);
    assert.deepEqual(normalizeFacePrefs({ height: 720, fps: 30, kbps: 1500 }), { height: 720, fps: 30, kbps: 1500 });
    assert.deepEqual(normalizeFacePrefs({ height: 1080, fps: 50, kbps: 20 }), { height: 360, fps: 25, kbps: 150 });
  });
  it('describes a line in words', () => {
    assert.equal(describeChoice({ codec: 'h265', encoder: 'hw' }), 'H.265 hardware');
    assert.equal(describeChoice({ codec: 'av1', encoder: 'any' }), 'AV1 any encoder');
  });
});
