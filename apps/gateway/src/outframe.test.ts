import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blackI420, chromaSize, Fitter, fitRect, i420Bytes, interleavedToPlanar, nominalRate, rotateI420, uprightSize, weaveI420, type Rotation } from './outframe.ts';

/** An I420 picture whose brightness is given per pixel and whose colour planes are given per chroma sample. */
function picture(w: number, h: number, y: (x: number, y: number) => number, u: (x: number, y: number) => number = () => 128, v: (x: number, y: number) => number = () => 128): Uint8Array {
  const cw = chromaSize(w);
  const ch = chromaSize(h);
  const out = new Uint8Array(i420Bytes(w, h));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out[j * w + i] = y(i, j);
  for (let j = 0; j < ch; j++)
    for (let i = 0; i < cw; i++) {
      out[w * h + j * cw + i] = u(i, j);
      out[w * h + cw * ch + j * cw + i] = v(i, j);
    }
  return out;
}
const lumaAt = (p: Uint8Array, w: number, x: number, y: number) => p[y * w + x];
const uAt = (p: Uint8Array, w: number, h: number, x: number, y: number) => p[w * h + (y >> 1) * chromaSize(w) + (x >> 1)];

test('sizes: I420 bytes, black, and where a picture fits', () => {
  assert.equal(i420Bytes(1920, 1080), 1920 * 1080 * 1.5);
  assert.equal(i420Bytes(5, 3), 15 + 2 * 3 * 2, 'odd sizes round the colour planes up');
  const b = new Uint8Array(i420Bytes(4, 2)).fill(77);
  blackI420(b, 4, 2);
  assert.deepEqual([...b], [16, 16, 16, 16, 16, 16, 16, 16, 128, 128, 128, 128]);

  assert.deepEqual(fitRect(1280, 720, 1920, 1080), { x: 0, y: 0, width: 1920, height: 1080 }, 'the same shape fills it');
  assert.deepEqual(fitRect(720, 1280, 1920, 1080), { x: 656, y: 0, width: 608, height: 1080 }, 'an upright phone picture stands in the middle');
  assert.deepEqual(fitRect(640, 480, 1920, 1080), { x: 240, y: 0, width: 1440, height: 1080 }, '4:3 gets black on both sides');
  assert.deepEqual(fitRect(1920, 800, 1920, 1080), { x: 0, y: 140, width: 1920, height: 800 }, 'a wide picture gets black above and below');
  for (const [sw, sh] of [
    [853, 480],
    [479, 271],
    [1, 1],
  ] as const) {
    const r = fitRect(sw, sh, 1920, 1080);
    assert.ok(r.x % 2 === 0 && r.y % 2 === 0 && r.width % 2 === 0 && r.height % 2 === 0, 'even numbers');
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 1920 && r.y + r.height <= 1080, 'inside the output');
  }
  assert.deepEqual(uprightSize(1280, 720, 90), { width: 720, height: 1280 });
  assert.deepEqual(uprightSize(1280, 720, 180), { width: 1280, height: 720 });
});

test('a picture of the output size passes unchanged', () => {
  const src = picture(8, 4, (x, y) => 20 + x + 10 * y, (x) => 100 + x, (_x, y) => 140 + y);
  const dst = new Uint8Array(src.length);
  new Fitter().fit(src, 8, 4, 0, dst, 8, 4);
  assert.deepEqual([...dst], [...src]);
});

test('turning upright: the corner that was marked ends where it belongs', () => {
  // a 6x4 frame, bright at its top left corner (0,0), with colour marked at the same corner
  const w = 6;
  const h = 4;
  const src = picture(w, h, (x, y) => (x === 0 && y === 0 ? 235 : 16), (x, y) => (x === 0 && y === 0 ? 200 : 128));
  const where = (rotation: Rotation) => {
    const up = uprightSize(w, h, rotation);
    const dst = new Uint8Array(i420Bytes(up.width, up.height));
    assert.deepEqual(rotateI420(src, w, h, rotation, dst), up);
    const at: number[][] = [];
    for (let y = 0; y < up.height; y++) for (let x = 0; x < up.width; x++) if (lumaAt(dst, up.width, x, y) === 235) at.push([x, y]);
    assert.equal(at.length, 1, `${rotation}: the mark is there once`);
    const [x, y] = at[0] as [number, number];
    assert.equal(uAt(dst, up.width, up.height, x, y), 200, `${rotation}: its colour moved with it`);
    return `${x},${y} of ${up.width}x${up.height}`;
  };
  assert.equal(where(0), '0,0 of 6x4');
  assert.equal(where(90), '3,0 of 4x6', 'turned clockwise: the top left corner goes to the top right');
  assert.equal(where(180), '5,3 of 6x4');
  assert.equal(where(270), '0,5 of 4x6', 'turned the other way: to the bottom left');
});

test('fitting: stretched smoothly to a larger size, its ends kept, nothing outside its range', () => {
  // a ramp from dark at the left to bright at the right, twice as large
  const src = picture(16, 8, (x) => 16 + x * 14);
  const dst = new Uint8Array(i420Bytes(32, 16)).fill(1);
  new Fitter().fit(src, 16, 8, 0, dst, 32, 16);
  const row = Array.from({ length: 32 }, (_, x) => lumaAt(dst, 32, x, 5) as number);
  assert.equal(row[0], 16, 'the left end');
  assert.equal(row[31], 16 + 15 * 14, 'the right end');
  for (let x = 1; x < 32; x++) assert.ok((row[x] as number) >= (row[x - 1] as number), 'never darker towards the right');
  assert.ok(new Set(row).size > 16, 'values in between: it is interpolated, not doubled');
  assert.ok(row.every((v) => v >= 16 && v <= 226));
  for (let y = 0; y < 16; y++) assert.equal(lumaAt(dst, 32, 10, y), row[10], 'the same in every row');
  assert.equal(uAt(dst, 32, 16, 9, 9), 128, 'no colour came from nowhere');
});

test('fitting: an upright phone picture gets black beside it, and is not stretched', () => {
  // 4x8 upright, all bright, into 16x8
  const src = picture(4, 8, () => 200, () => 90, () => 170);
  const dst = new Uint8Array(i420Bytes(16, 8)).fill(1);
  new Fitter().fit(src, 4, 8, 0, dst, 16, 8);
  const r = fitRect(4, 8, 16, 8);
  assert.deepEqual(r, { x: 6, y: 0, width: 4, height: 8 });
  for (let x = 0; x < 16; x++) {
    const inside = x >= r.x && x < r.x + r.width;
    assert.equal(lumaAt(dst, 16, x, 4), inside ? 200 : 16, `column ${x}`);
    assert.equal(uAt(dst, 16, 8, x, 4), inside ? 90 : 128);
  }
});

test('fitting a turned frame: turned first, then fitted, with one Fitter over changing sizes', () => {
  const f = new Fitter();
  // a frame that arrives lying on its side: 8 wide, 4 high, bright in its left half; upright it is 4x8, bright at the top
  const lying = picture(8, 4, (x) => (x < 4 ? 220 : 30));
  const up = new Uint8Array(i420Bytes(4, 8));
  rotateI420(lying, 8, 4, 270, up);
  assert.equal(lumaAt(up, 4, 1, 1), 30);
  assert.equal(lumaAt(up, 4, 1, 6), 220, 'turned 270: the left of the frame is the bottom of the picture');
  const out = new Uint8Array(i420Bytes(16, 16));
  f.fit(lying, 8, 4, 270, out, 16, 16);
  const r = fitRect(4, 8, 16, 16);
  assert.deepEqual(r, { x: 4, y: 0, width: 8, height: 16 });
  assert.equal(lumaAt(out, 16, 8, 1), 30);
  assert.equal(lumaAt(out, 16, 8, 14), 220);
  assert.equal(lumaAt(out, 16, 1, 8), 16, 'black beside it');
  // then a different size through the same Fitter
  const small = picture(4, 2, () => 100);
  const out2 = new Uint8Array(i420Bytes(8, 4));
  f.fit(small, 4, 2, 0, out2, 8, 4);
  assert.ok([...out2.subarray(0, 32)].every((v) => v === 100));
});

test('weaving: the upper field from the first picture, the lower from the second, colour too', () => {
  const a = picture(4, 4, () => 50, () => 60, () => 70);
  const b = picture(4, 4, () => 200, () => 210, () => 220);
  const dst = new Uint8Array(a.length);
  weaveI420(a, b, dst, 4, 4);
  assert.deepEqual([0, 1, 2, 3].map((y) => lumaAt(dst, 4, 2, y)), [50, 200, 50, 200]);
  assert.deepEqual([...dst.subarray(16, 20)], [60, 60, 210, 210], 'colour line 0 from the first, line 1 from the second');
  assert.deepEqual([...dst.subarray(20, 24)], [70, 70, 220, 220]);
});

test('the stated frame rate of a stream sent as it arrives, and sound for NDI', () => {
  assert.equal(nominalRate(24.3), 25);
  assert.equal(nominalRate(29.6), 30);
  assert.equal(nominalRate(48), 50);
  assert.equal(nominalRate(61), 60);
  assert.equal(nominalRate(0), 25);
  assert.equal(nominalRate(Number.NaN), 25);
  const out = new Float32Array(6);
  interleavedToPlanar(new Int16Array([16384, -16384, 32767, -32768, 0, 8192]), 2, 3, 1, out);
  assert.deepEqual([...out].map((v) => Math.round(v * 1000) / 1000), [0.5, 1, 0, -0.5, -1, 0.25], 'left plane, then right plane');
  interleavedToPlanar(new Int16Array([16384, 16384]), 1, 2, 2, out);
  assert.equal(out[0], 1, 'with a gain of two');
});
