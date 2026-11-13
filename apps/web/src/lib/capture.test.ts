import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureSize, isWide, keepWide, WIDE, wideAttempts, type CameraTrack } from './capture.ts';

type Mode = [number, number];

/**
 * A camera as a browser presents it: native modes, wishes answered by the nearest one, and, where the
 * browser can cut pictures, a 16:9 set answered by cutting the nearest mode.
 */
function camera(modes: Mode[], opts: { cuts: boolean; start?: Mode }): CameraTrack & { calls: number } {
  let now: Mode = opts.start ?? modes[0]!;
  const distance = (m: Mode, w: number, h: number) => Math.abs(m[0] - w) / w + Math.abs(m[1] - h) / h;
  const track = {
    calls: 0,
    getSettings: () => ({ width: now[0], height: now[1] }),
    applyConstraints: async (c: Record<string, unknown>) => {
      track.calls++;
      const w = c['width'] as number;
      const h = c['height'] as number;
      const mustBeWide = Array.isArray(c['advanced']) && (c['advanced'] as Record<string, unknown>[]).some((s) => s['aspectRatio'] === WIDE);
      const candidates: Mode[] = mustBeWide && opts.cuts ? modes.map((m): Mode => (m[0] / m[1] > WIDE ? [Math.round(m[1] * WIDE), m[1]] : [m[0], Math.round(m[0] / WIDE)])) : modes;
      now = [...candidates].sort((a, b) => distance(a, w, h) - distance(b, w, h))[0]!;
    },
  };
  return track;
}

test('the camera is asked for the lines in 16:9, the shape named', () => {
  assert.deepEqual(captureSize(1080, 25), { width: 1920, height: 1080, frameRate: 25, aspectRatio: WIDE });
  assert.deepEqual(captureSize(540, 50), { width: 960, height: 540, frameRate: 50, aspectRatio: WIDE });
});

test('16:9 is 16:9 lying or upright; 4:3 and 3:2 are not', () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [960, 540], [540, 960], [1440, 810], [848, 480], [1920, 1088]] as Mode[]) assert.equal(isWide(w, h), true, `${w}x${h}`);
  for (const [w, h] of [[960, 720], [720, 960], [1440, 1080], [640, 480], [1620, 1080], [1080, 1080]] as Mode[]) assert.equal(isWide(w, h), false, `${w}x${h}`);
  assert.equal(isWide(undefined, 1080), false);
});

test('what is tried: the size asked with 16:9 a must, then each smaller size', () => {
  assert.deepEqual(wideAttempts(1080, 25).map((a) => a.height), [1080, 720, 540, 360]);
  assert.deepEqual(wideAttempts(360, 25).map((a) => a.height), [360]);
  assert.deepEqual(wideAttempts(720, 25)[0]!.advanced, [{ aspectRatio: WIDE }]);
});

test('a camera that gives 16:9 is left alone', async () => {
  const cam = camera([[1920, 1080]], { cuts: true });
  const kept = await keepWide(cam, 1080, 25);
  assert.equal(cam.calls, 0);
  assert.equal(kept.note, undefined);
  assert.deepEqual(kept.constraints, captureSize(1080, 25));
});

test('a camera whose largest 16:9 picture is smaller than asked sends that, and says so', async () => {
  const cam = camera([[1280, 720]], { cuts: true });
  const kept = await keepWide(cam, 1080, 25);
  assert.equal(cam.calls, 0);
  assert.match(kept.note ?? '', /no 1080p in 16:9: it sends 1280×720/);
  // upright, the same picture: the lines are the short side
  const upright = await keepWide({ getSettings: () => ({ width: 1080, height: 1920 }), applyConstraints: async () => undefined }, 1080, 25);
  assert.equal(upright.note, undefined);
});

test('the phone of 2026-11-13: 4:3 at "1080p", and the browser cuts: the same size in 16:9', async () => {
  const cam = camera([[640, 480], [1280, 720], [1440, 1080]], { cuts: true, start: [1440, 1080] });
  const kept = await keepWide(cam, 1080, 25);
  assert.deepEqual(cam.getSettings(), { width: 1440, height: 810 });
  assert.equal(cam.calls, 1);
  assert.match(kept.note ?? '', /no 1080p in 16:9 \(it gave 1440×1080\): it sends 1440×810/);
  assert.deepEqual(kept.constraints.advanced, [{ aspectRatio: WIDE }]);
});

test('a browser that does not cut: down to the largest size the camera has in 16:9', async () => {
  const cam = camera([[640, 480], [1280, 720], [1280, 960]], { cuts: false, start: [1280, 960] });
  const kept = await keepWide(cam, 1080, 25);
  assert.deepEqual(cam.getSettings(), { width: 1280, height: 720 });
  assert.equal(kept.constraints.height, 720);
  assert.match(kept.note ?? '', /it sends 1280×720/);
});

test('a camera with no 16:9 at all keeps its picture and says so', async () => {
  const cam = camera([[640, 480], [1280, 960]], { cuts: false, start: [1280, 960] });
  const kept = await keepWide(cam, 1080, 25);
  assert.match(kept.note ?? '', /no 16:9 picture/);
  assert.deepEqual(kept.constraints, captureSize(1080, 25));
});

test('a browser that tells no size is not touched', async () => {
  let calls = 0;
  const kept = await keepWide({ getSettings: () => ({}), applyConstraints: async () => void calls++ }, 720, 25);
  assert.equal(calls, 0);
  assert.equal(kept.note, undefined);
});
