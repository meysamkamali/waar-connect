// libyuv's fitter against the JavaScript one. Runs where the library is installed (the VM); skipped elsewhere.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Fitter, i420Bytes, type Rotation } from './outframe.ts';
import { loadFitter, NativeFitter, Yuv } from './yuv.ts';

const yuv = Yuv.load(process.env['YUV_LIB']);
const skip = yuv ? false : 'libyuv is not installed on this machine';

/** A smooth picture with a different slope in each plane. */
function gradient(w: number, h: number): Uint8Array {
  const p = new Uint8Array(i420Bytes(w, h));
  const cw = (w + 1) >> 1;
  const ch = (h + 1) >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p[y * w + x] = 16 + Math.round((x / w) * 150 + (y / h) * 60);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      p[w * h + y * cw + x] = 60 + Math.round((x / cw) * 120);
      p[w * h + cw * ch + y * cw + x] = 70 + Math.round((y / ch) * 110);
    }
  return p;
}

function difference(a: Uint8Array, b: Uint8Array): { mean: number; worst: number } {
  let sum = 0;
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs((a[i] as number) - (b[i] as number));
    sum += d;
    if (d > worst) worst = d;
  }
  return { mean: sum / a.length, worst };
}

function both(sw: number, sh: number, rotation: Rotation, dw: number, dh: number): { js: Uint8Array; native: Uint8Array } {
  const src = gradient(sw, sh);
  const js = new Uint8Array(i420Bytes(dw, dh));
  const native = new Uint8Array(i420Bytes(dw, dh));
  new Fitter().fit(src, sw, sh, rotation, js, dw, dh);
  new NativeFitter(yuv as Yuv).fit(src, sw, sh, rotation, native, dw, dh);
  return { js, native };
}

test('the library turns pictures the way the JavaScript does', { skip }, () => {
  assert.equal((yuv as Yuv).turns, true);
});

test('720p into 1080p: the same picture as the JavaScript fitter', { skip }, () => {
  const { js, native } = both(1280, 720, 0, 1920, 1080);
  const d = difference(js, native);
  assert.ok(d.mean < 1 && d.worst <= 6, `mean ${d.mean.toFixed(3)}, worst ${d.worst}`);
});

test('1080p down into 720p: close to the JavaScript fitter', { skip }, () => {
  const { js, native } = both(1920, 1080, 0, 1280, 720);
  const d = difference(js, native);
  assert.ok(d.mean < 1.5 && d.worst <= 8, `mean ${d.mean.toFixed(3)}, worst ${d.worst}`);
});

test('an upright phone picture: black beside it, the picture in the middle', { skip }, () => {
  const { js, native } = both(720, 1280, 0, 1920, 1080);
  // the black bars are the same bytes exactly; the picture close
  const w = 1920;
  for (const x of [0, 300, 650, 1270, 1919]) {
    assert.equal(native[540 * w + x], js[540 * w + x], `column ${x}`);
  }
  assert.equal(native[0], 16);
  assert.equal(native[w * 1080], 128);
  const d = difference(js, native);
  assert.ok(d.mean < 1.5, `mean ${d.mean.toFixed(3)}`);
});

test('a picture that arrives on its side is turned and fitted like the JavaScript does it', { skip }, () => {
  for (const rotation of [90, 180, 270] as const) {
    const { js, native } = both(1280, 720, rotation, 1920, 1080);
    const d = difference(js, native);
    assert.ok(d.mean < 1.5, `rotation ${rotation}: mean ${d.mean.toFixed(3)}, worst ${d.worst}`);
  }
});

test('the same size goes through unchanged', { skip }, () => {
  const src = gradient(1280, 720);
  const out = new Uint8Array(i420Bytes(1280, 720));
  new NativeFitter(yuv as Yuv).fit(src, 1280, 720, 0, out, 1280, 720);
  assert.deepEqual(difference(src, out), { mean: 0, worst: 0 });
});

test('loadFitter falls back to JavaScript when the library is not where it was said to be', () => {
  const f = loadFitter('/nowhere/libyuv.so.0');
  assert.equal(f.by, 'javascript');
  assert.ok(f.fitter instanceof Fitter);
});
