import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assess, copiesOf, mainKbps, METER_GROUPS, toneOf, verdictWord, type Meter, type MeterKey, type QualityInput } from './quality.ts';
import type { StatsSummary } from './stats.ts';

const up = (over: Partial<StatsSummary> = {}): StatsSummary => ({
  kbps: 2300,
  lossPct: 0,
  rttMs: 80,
  jitterMs: undefined,
  bufferMs: undefined,
  width: 1280,
  height: 720,
  fps: 25,
  codec: 'h264',
  path: 'direct',
  limited: undefined,
  layers: [
    { rid: 'f', width: 1280, height: 720, fps: 25, kbps: 1900, codec: 'h264', mode: undefined },
    { rid: 'h', width: 640, height: 360, fps: 25, kbps: 300, codec: 'h264', mode: undefined },
    { rid: 'q', width: 320, height: 180, fps: 25, kbps: 100, codec: 'h264', mode: undefined },
  ],
  ...over,
});
const recv = (bufferMs: number): StatsSummary => ({ kbps: 500, lossPct: 0, rttMs: 2, jitterMs: 5, bufferMs, width: 640, height: 360, fps: 25, codec: 'h264', path: 'direct', limited: undefined });
const good: QualityInput = { line: 'excellent', up: up(), capKbps: 2500, cameraHeight: 720, askedFps: 25, recv: recv(120), ageMs: 500 };
const meter = (input: QualityInput, key: MeterKey): Meter => assess(input).meters.find((m) => m.key === key)!;

test('a healthy guest: every meter green, the verdict good, nothing to say', () => {
  const q = assess(good);
  assert.deepEqual(q.meters.map((m) => m.key), ['line', 'bitrate', 'size', 'frames', 'loss', 'rtt', 'delay']);
  assert.ok(q.meters.every((m) => m.tone === 'ok'), JSON.stringify(q.meters.map((m) => [m.key, m.tone])));
  assert.equal(q.tone, 'ok');
  assert.deepEqual(q.reasons, []);
  assert.equal(verdictWord(q), 'Good');
  assert.equal(meter(good, 'bitrate').text, '1900 of 2500 kbit/s', 'the full-size copy alone, not the three copies together');
  assert.equal(mainKbps(up()), 1900);
  assert.equal(meter(good, 'size').text, '720p of 720p');
  assert.equal(meter(good, 'frames').text, '25 of 25 fps');
  assert.equal(meter(good, 'delay').text, 'about 160 ms', 'half of 80 plus the 120 ms buffer here');
  assert.ok(Math.abs(meter(good, 'bitrate').fill - 0.76) < 0.01);
});

test('packet loss: clean under 0.5 %, watched to 2 %, a problem from 2 %', () => {
  assert.equal(meter({ ...good, up: up({ lossPct: 0.4 }) }, 'loss').tone, 'ok');
  assert.equal(meter({ ...good, up: up({ lossPct: 0.5 }) }, 'loss').tone, 'warn');
  assert.equal(meter({ ...good, up: up({ lossPct: 1.9 }) }, 'loss').tone, 'warn');
  const bad = assess({ ...good, up: up({ lossPct: 3.2 }) });
  assert.equal(bad.meters.find((m) => m.key === 'loss')!.tone, 'bad');
  assert.equal(bad.tone, 'bad');
  assert.deepEqual(bad.reasons, ['packet loss 3.2 %']);
  assert.equal(verdictWord(bad), 'Problem');
  assert.equal(meter({ ...good, up: up({ lossPct: 12 }) }, 'loss').fill, 1, 'the bar is full from 5 %');
});

test('network delay and the delay to this desk', () => {
  assert.equal(meter({ ...good, up: up({ rttMs: 149 }) }, 'rtt').tone, 'ok');
  assert.equal(meter({ ...good, up: up({ rttMs: 150 }) }, 'rtt').tone, 'warn');
  assert.equal(meter({ ...good, up: up({ rttMs: 400 }) }, 'rtt').tone, 'bad');
  assert.equal(meter({ ...good, recv: recv(280) }, 'delay').tone, 'warn', '40 + 280 = 320 ms');
  assert.equal(meter({ ...good, recv: recv(600) }, 'delay').tone, 'bad');
  assert.equal(meter({ ...good, recv: undefined }, 'delay').tone, 'none', 'nothing arrives here yet');
});

test('a low bitrate is a fault only when something holds it back', () => {
  const still = up({ layers: [{ rid: 'f', width: 1280, height: 720, fps: 25, kbps: 300, codec: 'h264', mode: undefined }] });
  assert.equal(meter({ ...good, up: still }, 'bitrate').tone, 'ok', 'a still picture needs little');
  const held = up({ limited: 'bandwidth', layers: [{ rid: 'f', width: 1280, height: 720, fps: 25, kbps: 1400, codec: 'h264', mode: undefined }] });
  assert.equal(meter({ ...good, up: held }, 'bitrate').tone, 'warn');
  assert.equal(meter({ ...good, up: held }, 'bitrate').note, 'held back by the network');
  assert.equal(meter({ ...good, up: held }, 'bitrate').flag, 'network');
  assert.equal(meter({ ...good, up: held }, 'bitrate').text, '1400 of 2500 kbit/s');
  const starved = up({ limited: 'bandwidth', layers: [{ rid: 'f', width: 1280, height: 720, fps: 25, kbps: 600, codec: 'h264', mode: undefined }] });
  assert.equal(meter({ ...good, up: starved }, 'bitrate').tone, 'bad', 'under 40 % of the cap');
  const hot = up({ limited: 'cpu' });
  assert.equal(meter({ ...good, up: hot }, 'bitrate').tone, 'warn');
  assert.deepEqual(assess({ ...good, up: hot }).reasons, ["bitrate held back by the phone's processor"]);
});

test('a shrunk picture, dropped frames and a poor line each show, the worst first', () => {
  const q = assess({ ...good, line: 'poor', up: up({ height: 360, width: 640, fps: 12, lossPct: 2.5 }) });
  const tones = Object.fromEntries(q.meters.map((m) => [m.key, m.tone]));
  assert.equal(tones['size'], 'bad', '360 of 720 is half');
  assert.equal(tones['frames'], 'bad', '12 of 25');
  assert.equal(tones['line'], 'warn');
  assert.equal(tones['loss'], 'bad');
  assert.equal(q.tone, 'bad');
  assert.deepEqual(q.reasons.slice(-1), ['line poor'], 'what is only to be watched comes last');
  assert.ok(q.reasons.includes('picture shrunk to 360p') && q.reasons.includes('only 12 frames a second') && q.reasons.includes('packet loss 2.5 %'));
  assert.equal(meter({ ...good, up: up({ height: 540 }) }, 'size').tone, 'warn', '540 of 720');
  const upright = meter({ ...good, up: up({ width: 720, height: 1280 }) }, 'size');
  assert.equal(upright.text, '720p of 720p', 'a phone held upright: the short side names the picture');
  assert.equal(upright.tone, 'ok');
  assert.equal(meter({ ...good, line: 'lost' }, 'line').tone, 'bad');
});

test('the meters in two groups, each with its own colour', () => {
  const q = assess({ ...good, up: up({ lossPct: 3 }) });
  const by = new Map(q.meters.map((m) => [m.key, m]));
  const tones = Object.fromEntries(METER_GROUPS.map((g) => [g.key, toneOf(g.meters.map((k) => by.get(k)!))]));
  assert.deepEqual(tones, { line: 'bad', picture: 'ok' });
  assert.deepEqual(METER_GROUPS.flatMap((g) => g.meters).sort(), q.meters.map((m) => m.key).sort(), 'every meter is in one group');
  assert.deepEqual(by.get('loss')!.marks, [0.1, 0.4], 'the limits are marked on the bar');
});

test('every copy the phone sends: its size, its bitrate, and what it may send', () => {
  const copies = assess(good).copies;
  assert.deepEqual(
    copies.map((c) => [c.name, c.kbps, c.ceilingKbps, c.full, c.paused]),
    [
      ['720p', 1900, 2500, true, false],
      ['360p', 300, 500, false, false],
      ['180p', 100, 150, false, false],
    ],
  );
  assert.ok(Math.abs(copies[0]!.fill - 0.76) < 0.01 && Math.abs(copies[1]!.fill - 0.6) < 0.01 && Math.abs(copies[2]!.fill - 0.667) < 0.01);
  // at a low cap the small copies get a share of it, not their own ceilings
  assert.deepEqual(copiesOf(up(), 400).map((c) => c.ceilingKbps), [400, 140, 48]);
  // a paused copy, and a phone held upright
  const held = up({
    layers: [
      { rid: 'f', width: 1080, height: 1920, fps: 25, kbps: 2100, codec: 'h264', mode: undefined },
      { rid: 'h', width: 540, height: 960, fps: 25, kbps: 0, codec: 'h264', mode: undefined },
      { rid: 'q', width: undefined, height: undefined, fps: undefined, kbps: 0, codec: 'h264', mode: undefined },
    ],
  });
  assert.deepEqual(copiesOf(held, 4000).map((c) => [c.name, c.paused, c.fill]), [
    ['1080p', false, 0.525],
    ['540p', true, 0],
    ['quarter', true, 0],
  ]);
  // one stream only: nothing to list
  assert.deepEqual(copiesOf(up({ layers: [{ rid: 'f', width: 1280, height: 720, fps: 25, kbps: 1900, codec: 'h264', mode: undefined }] }), 2500), []);
  assert.deepEqual(copiesOf(undefined, 2500), []);
  assert.deepEqual(assess({}).copies, []);
  assert.equal(copiesOf(up(), undefined)[1]!.ceilingKbps, undefined, 'no cap known: no ceiling to draw against');
});

test('no numbers, or old ones: shown grey and not judged', () => {
  const empty = assess({});
  assert.ok(empty.meters.every((m) => m.tone === 'none'));
  assert.equal(empty.tone, 'none');
  assert.equal(empty.stale, true);
  assert.equal(verdictWord(empty), 'No fresh numbers');
  const old = assess({ ...good, up: up({ lossPct: 9 }), ageMs: 20_000 });
  assert.equal(old.stale, true);
  assert.equal(old.meters.find((m) => m.key === 'loss')!.tone, 'none', 'a loss figure from 20 s ago says nothing about now');
  assert.equal(old.meters.find((m) => m.key === 'loss')!.text, '9.0 %', 'but it is still shown');
  assert.deepEqual(old.reasons, []);
  assert.equal(old.meters.find((m) => m.key === 'delay')!.tone, 'ok', "this desk's own numbers are fresh");
});
