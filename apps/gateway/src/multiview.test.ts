import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blit, drawI420, fillRect, layoutTiles, MAX_TILES, THUMB, Tiles, type Rotation } from './multiview.ts';

test('layout: one row along the bottom, centred, even sizes, inside the picture', () => {
  for (const [w, h] of [
    [960, 540],
    [1920, 1080],
    [640, 360],
    [1280, 720],
  ] as const) {
    for (let n = 1; n <= MAX_TILES; n++) {
      const rects = layoutTiles(n, w, h);
      assert.equal(rects.length, n);
      const first = rects[0]!;
      const last = rects[n - 1]!;
      for (const r of rects) {
        assert.equal(r.width % 2, 0);
        assert.equal(r.height % 2, 0);
        assert.equal(r.y, first.y, 'one row');
        assert.equal(r.width, first.width);
        assert.ok(r.x >= 0 && r.x + r.width <= w && r.y >= 0 && r.y + r.height <= h, `${n} tiles fit in ${w}x${h}`);
        assert.ok(Math.abs(r.width / r.height - 16 / 9) < 0.06, '16:9 tiles');
      }
      assert.ok(first.y > h / 2, 'in the lower half');
      assert.ok(Math.abs(first.x - (w - (last.x + last.width))) <= 2, 'centred');
      for (let i = 1; i < n; i++) assert.ok(rects[i]!.x >= rects[i - 1]!.x + rects[i - 1]!.width, 'no overlap');
    }
  }
  assert.deepEqual(layoutTiles(0, 960, 540), []);
  assert.equal(layoutTiles(40, 960, 540).length, MAX_TILES, 'never more than the maximum');
  const four = layoutTiles(4, 960, 540);
  assert.equal(four[0]!.height, 118, 'about a fifth of a 540p picture');
  assert.ok(layoutTiles(8, 960, 540)[0]!.width < four[0]!.width, 'many guests: smaller pictures');
});

/** An I420 frame whose brightness is given per pixel; colour planes neutral unless set. */
function i420(w: number, h: number, luma: (x: number, y: number) => number, u = 128, v = 128): Uint8Array {
  const cw = (w + 1) >> 1;
  const ch = (h + 1) >> 1;
  const data = new Uint8Array(w * h + 2 * cw * ch);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = luma(x, y);
  data.fill(u, w * h, w * h + cw * ch);
  data.fill(v, w * h + cw * ch);
  return data;
}
const px = (d: Uint8Array, w: number, x: number, y: number) => [...d.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];

test('drawI420: grey levels and colours come out as BT.601 limited range says', () => {
  const out = new Uint8Array(4 * 2 * 4);
  drawI420(i420(4, 2, () => 235), 4, 2, 0, out, 4, 2);
  assert.deepEqual(px(out, 4, 0, 0), [255, 255, 255, 255], 'Y 235 is white');
  drawI420(i420(4, 2, () => 16), 4, 2, 0, out, 4, 2);
  assert.deepEqual(px(out, 4, 3, 1), [0, 0, 0, 255], 'Y 16 is black');
  drawI420(i420(4, 2, () => 81, 90, 240), 4, 2, 0, out, 4, 2); // red in BT.601
  const [b, g, r] = px(out, 4, 1, 1);
  assert.ok(r! > 240 && g! < 16 && b! < 16, `red stays red, got b${b} g${g} r${r}`);
  drawI420(i420(4, 2, () => 41, 240, 110), 4, 2, 0, out, 4, 2); // blue
  const [b2, g2, r2] = px(out, 4, 1, 1);
  assert.ok(b2! > 240 && g2! < 16 && r2! < 16, `blue stays blue, got b${b2} g${g2} r${r2}`);
});

test('drawI420: the phone\'s rotation is applied, so the picture stands upright', () => {
  // A 4x2 frame with one bright pixel at its top-left corner.
  const src = i420(4, 2, (x, y) => (x === 0 && y === 0 ? 235 : 16));
  const bright = (rotation: Rotation, dw: number, dh: number): [number, number][] => {
    const out = new Uint8Array(dw * dh * 4);
    drawI420(src, 4, 2, rotation, out, dw, dh);
    const hits: [number, number][] = [];
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) if (px(out, dw, x, y)[0]! > 200) hits.push([x, y]);
    return hits;
  };
  assert.deepEqual(bright(0, 4, 2), [[0, 0]], 'not turned: top left');
  assert.deepEqual(bright(180, 4, 2), [[3, 1]], 'turned half way: bottom right');
  assert.deepEqual(bright(90, 2, 4), [[1, 0]], 'a quarter turn clockwise: top right of the upright picture');
  assert.deepEqual(bright(270, 2, 4), [[0, 3]], 'a quarter turn the other way: bottom left');
});

test('drawI420: an upright phone picture is letterboxed whole into a wide tile, never cropped', () => {
  const out = new Uint8Array(16 * 8 * 4);
  drawI420(i420(4, 8, () => 235), 4, 8, 0, out, 16, 8); // 1:2 portrait into 2:1
  assert.deepEqual(px(out, 16, 0, 0), [16, 16, 16, 255], 'bars at the sides');
  assert.deepEqual(px(out, 16, 15, 7), [16, 16, 16, 255]);
  assert.deepEqual(px(out, 16, 7, 0), [255, 255, 255, 255], 'the picture in the middle, full height');
  assert.deepEqual(px(out, 16, 8, 7), [255, 255, 255, 255]);
  const white = Array.from({ length: 16 }, (_, x) => x).filter((x) => px(out, 16, x, 4)[0] === 255).length;
  assert.equal(white, 4, 'as wide as its share: 4 of 16');
});

test('drawI420: a large frame is averaged down, and bad input is refused', () => {
  // 16x16 checkerboard of black and white into 4x4: every output pixel is the mean, mid grey.
  const out = new Uint8Array(4 * 4 * 4);
  drawI420(i420(16, 16, (x, y) => ((x + y) % 2 ? 235 : 16)), 16, 16, 0, out, 4, 4);
  const [b] = px(out, 4, 2, 2);
  assert.ok(b! > 100 && b! < 155, `mean of black and white, got ${b}`);
  assert.throws(() => drawI420(new Uint8Array(10), 4, 4, 0, out, 4, 4), /too short/);
  assert.throws(() => drawI420(i420(4, 4, () => 16), 4, 4, 0, new Uint8Array(8), 4, 4), /too small/);
});

test('fillRect and blit stay inside the picture', () => {
  const dst = new Uint8Array(8 * 4 * 4);
  fillRect(dst, 8, 4, { x: -2, y: -2, width: 5, height: 4 }, 1, 2, 3);
  assert.deepEqual(px(dst, 8, 0, 0), [1, 2, 3, 255]);
  assert.deepEqual(px(dst, 8, 2, 1), [1, 2, 3, 255]);
  assert.deepEqual(px(dst, 8, 3, 0), [0, 0, 0, 0], 'outside the rectangle');
  assert.deepEqual(px(dst, 8, 0, 2), [0, 0, 0, 0]);

  const tile = new Uint8Array(2 * 2 * 4).fill(9);
  blit(dst, 8, 4, tile, 2, 2, 7, 3); // hangs over the right and the bottom edge
  assert.deepEqual(px(dst, 8, 7, 3), [9, 9, 9, 9]);
  assert.deepEqual(px(dst, 8, 6, 3), [0, 0, 0, 0]);
  blit(dst, 8, 4, tile, 2, 2, -1, -1); // and over the top left
  assert.deepEqual(px(dst, 8, 0, 0), [9, 9, 9, 9]);
  assert.deepEqual(px(dst, 8, 1, 0), [1, 2, 3, 255], 'only the part inside was written');
});

test('Tiles: guests in a fixed order, drawn into the row, frames taken no faster than asked', () => {
  const tiles = new Tiles(75, 2500);
  tiles.add('guest:b');
  tiles.add('guest:a');
  tiles.add('guest:a');
  assert.deepEqual(tiles.identities(1000), [], 'nobody is shown before a frame arrives');

  assert.equal(tiles.due('guest:a', 1000), true);
  tiles.update('guest:a', i420(8, 8, () => 235), 8, 8, 0, 1000); // white
  tiles.update('guest:b', i420(8, 8, () => 16), 8, 8, 0, 1000); // black
  assert.equal(tiles.due('guest:a', 1040), false, 'too soon');
  assert.equal(tiles.due('guest:a', 1080), true);
  assert.equal(tiles.due('guest:nobody', 1080), false);
  assert.deepEqual(tiles.identities(1100), ['guest:a', 'guest:b'], 'in a fixed order');
  assert.equal(tiles.count(1100), 2);

  const w = 960;
  const h = 540;
  const dst = new Uint8Array(w * h * 4);
  assert.equal(tiles.compose(dst, w, h, 1100), 2);
  const [ra, rb] = layoutTiles(2, w, h) as [{ x: number; y: number; width: number; height: number }, { x: number; y: number; width: number; height: number }];
  const mid = (r: { x: number; y: number; width: number; height: number }, from: Uint8Array = dst) => px(from, w, r.x + (r.width >> 1), r.y + (r.height >> 1));
  assert.deepEqual(mid(ra), [255, 255, 255, 255], "guest a's white picture is in the first place");
  assert.deepEqual(mid(rb), [0, 0, 0, 255], "guest b's black picture is in the second");
  assert.deepEqual(px(dst, w, ra.x - 1, ra.y - 1), [12, 12, 12, 255], 'the dark edge');
  assert.deepEqual(px(dst, w, 10, 10), [0, 0, 0, 0], 'the programme above is untouched');

  // Guest a's frames stop (the server ended the subscription; no event says so): after the stale time only b is left.
  tiles.update('guest:b', i420(8, 8, () => 16), 8, 8, 0, 3000);
  assert.deepEqual(tiles.identities(3400), ['guest:a', 'guest:b'], 'a is still within the stale time');
  assert.deepEqual(tiles.identities(3600), ['guest:b'], 'a went quiet 2.6 s ago');
  const again = new Uint8Array(w * h * 4);
  assert.equal(tiles.compose(again, w, h, 3600), 1);
  const [only] = layoutTiles(1, w, h);
  assert.deepEqual(mid(only!, again), [0, 0, 0, 255], 'guest b moved to the middle');
  // and a comes back the moment a frame arrives again
  tiles.update('guest:a', i420(8, 8, () => 235), 8, 8, 0, 3700);
  assert.equal(tiles.count(3700), 2);
  tiles.remove('guest:a');
  assert.equal(tiles.count(3700), 1);
  tiles.clear();
  assert.equal(tiles.compose(again, w, h, 3700), 0);
  assert.equal(tiles.count(9000), 0);
  assert.equal(THUMB.width / THUMB.height, 16 / 9);
});
