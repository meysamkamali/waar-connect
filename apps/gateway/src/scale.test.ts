import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScaleBuffers, scaleBgraInto, sizeFor } from './scale.ts';

test('sizeFor keeps the aspect ratio with even sizes and never enlarges', () => {
  assert.deepEqual(sizeFor(1920, 1080, 540), { width: 960, height: 540 });
  assert.deepEqual(sizeFor(1920, 1080, 720), { width: 1280, height: 720 });
  assert.deepEqual(sizeFor(1280, 720, 1080), { width: 1280, height: 720 });
  assert.deepEqual(sizeFor(720, 576, 360), { width: 450, height: 360 });
  assert.deepEqual(sizeFor(16, 8, 360), { width: 16, height: 8 });
});

function frame(w: number, h: number, fill: (x: number, y: number) => [number, number, number]): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [b, g, r] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = b;
      data[i + 1] = g;
      data[i + 2] = r;
      data[i + 3] = 0; // X, as NDI BGRX may send it
    }
  return data;
}
const px = (d: Uint8Array, w: number, x: number, y: number) => [...d.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];

test('2:1 box: each output pixel is the mean of its 2x2 block, byte order kept, X byte made 255', () => {
  const src = frame(8, 4, (x) => (x < 4 ? [200, 20, 0] : [0, 0, 240]));
  const dst = new Uint8Array(4 * 2 * 4);
  const out = scaleBgraInto(src, 8, 4, { width: 4, height: 2 }, dst);
  assert.equal(out, dst);
  assert.deepEqual(px(out, 4, 0, 0), [200, 20, 0, 255]);
  assert.deepEqual(px(out, 4, 3, 1), [0, 0, 240, 255]);
  // a checkerboard of 0 and 100 averages to 50
  const chk = frame(4, 4, (x, y) => ((x + y) % 2 ? [100, 100, 100] : [0, 0, 0]));
  assert.deepEqual(px(scaleBgraInto(chk, 4, 4, { width: 2, height: 2 }, new Uint8Array(16)), 2, 1, 1), [50, 50, 50, 255]);
});

test('3:1 box and bilinear keep a flat colour flat and produce the asked size', () => {
  const flat = frame(12, 6, () => [10, 128, 250]);
  const d3 = scaleBgraInto(flat, 12, 6, { width: 4, height: 2 }, new Uint8Array(4 * 2 * 4));
  for (let i = 0; i < 8; i++) assert.deepEqual(px(d3, 4, i % 4, Math.floor(i / 4)), [10, 128, 250, 255]);
  const d32 = scaleBgraInto(flat, 12, 6, { width: 8, height: 4 }, new Uint8Array(8 * 4 * 4));
  for (let i = 0; i < 32; i++) assert.deepEqual(px(d32, 8, i % 8, Math.floor(i / 8)), [10, 128, 250, 255]);
});

test('bilinear blends a hard edge and stays inside the picture at the borders', () => {
  // 4 -> 3: the middle output pixel sits at source x 1.5, half black, half white
  const src = frame(4, 2, (x) => (x < 2 ? [0, 0, 0] : [240, 240, 240]));
  const out = scaleBgraInto(src, 4, 2, { width: 3, height: 2 }, new Uint8Array(3 * 2 * 4));
  assert.equal(px(out, 3, 0, 0)[0], 0);
  assert.equal(px(out, 3, 1, 0)[0], 120);
  assert.equal(px(out, 3, 2, 0)[0], 240);
  assert.equal(px(out, 3, 2, 1)[3], 255);
});

test('no change: the source comes back; a small destination is refused', () => {
  const src = frame(4, 2, () => [1, 2, 3]);
  assert.equal(scaleBgraInto(src, 4, 2, { width: 4, height: 2 }, new Uint8Array(0)), src);
  assert.throws(() => scaleBgraInto(src, 4, 2, { width: 2, height: 1 }, new Uint8Array(4)), /too small/);
});

test('ScaleBuffers alternates two buffers of the right size and renews them when the size changes', () => {
  const b = new ScaleBuffers();
  const a1 = b.take({ width: 4, height: 2 });
  const a2 = b.take({ width: 4, height: 2 });
  assert.notEqual(a1, a2);
  assert.equal(b.take({ width: 4, height: 2 }), a1);
  assert.equal(a1.length, 32);
  assert.equal(b.take({ width: 2, height: 2 }).length, 16);
});
