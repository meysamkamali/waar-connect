import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scaleBgra, sizeFor } from './scale.ts';

test('sizeFor keeps the aspect ratio with even sizes and never enlarges', () => {
  assert.deepEqual(sizeFor(1920, 1080, 540), { width: 960, height: 540 });
  assert.deepEqual(sizeFor(1920, 1080, 720), { width: 1280, height: 720 });
  assert.deepEqual(sizeFor(1280, 720, 1080), { width: 1280, height: 720 });
  assert.deepEqual(sizeFor(720, 576, 360), { width: 450, height: 360 });
  assert.deepEqual(sizeFor(16, 8, 360), { width: 16, height: 8 });
});

test('scaleBgra halves a picture and keeps the byte order (blue stays in the first byte)', async () => {
  const w = 8;
  const h = 4;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 200; // B
    data[i * 4 + 1] = 20; // G
    data[i * 4 + 2] = 0; // R
    data[i * 4 + 3] = 0; // X, as NDI BGRX may send it
  }
  const out = await scaleBgra(data, w, h, 4, 2);
  assert.equal(out.width, 4);
  assert.equal(out.height, 2);
  assert.equal(out.data.length, 4 * 2 * 4);
  assert.deepEqual([...out.data.slice(0, 4)], [200, 20, 0, 255]);
  assert.deepEqual([...out.data.slice(28, 32)], [200, 20, 0, 255]);
  const same = await scaleBgra(data, w, h, w, h);
  assert.equal(same.data, data);
});
