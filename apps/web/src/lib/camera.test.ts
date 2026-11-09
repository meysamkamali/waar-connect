import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraConstraints, clampTo, evLabel, mergeCameraRequest, parseCameraRequest, readCamera } from './camera.ts';

// What Chrome on an Android phone typically reports for the back camera.
const androidCaps = {
  width: { min: 1, max: 4000 },
  exposureCompensation: { min: -2, max: 2, step: 0.16666667 },
  exposureMode: ['continuous', 'manual'],
  whiteBalanceMode: ['continuous', 'manual'],
  focusMode: ['continuous', 'manual', 'single-shot'],
  zoom: { min: 1, max: 8, step: 0.1 },
  torch: true,
};
const androidNow = { exposureCompensation: 0, exposureMode: 'continuous', whiteBalanceMode: 'manual', focusMode: 'continuous', zoom: 1.5, torch: false };

test('readCamera: an Android camera offers everything, with its state', () => {
  const r = readCamera(androidCaps, androidNow);
  assert.deepEqual(r?.can, {
    exposureCompensation: { min: -2, max: 2, step: 0.16666667 },
    exposureLock: true,
    whiteBalanceLock: true,
    focusLock: true,
    zoom: { min: 1, max: 8, step: 0.1 },
    torch: true,
  });
  assert.deepEqual(r?.now, { exposureCompensation: 0, exposureLocked: false, whiteBalanceLocked: true, focusLocked: false, zoom: 1.5, torch: false });
});

test('readCamera: a plain webcam or Safari offers nothing', () => {
  assert.equal(readCamera({ width: { min: 1, max: 1920 }, facingMode: ['user'] }, { width: 1280 }), undefined);
  assert.equal(readCamera(undefined, undefined), undefined);
  // a mode list without 'manual' cannot lock; a zoom range of one value is no zoom; torch false is no torch
  assert.equal(readCamera({ exposureMode: ['continuous'], zoom: { min: 1, max: 1 }, torch: false }, {}), undefined);
});

test('readCamera: torch given as a list of accepted values still counts', () => {
  assert.deepEqual(readCamera({ torch: [true, false] }, { torch: true })?.can, { torch: true });
});

test('clampTo keeps the value inside the range and on the step', () => {
  const r = { min: -2, max: 2, step: 0.5 };
  assert.equal(clampTo(0.7, r), 0.5);
  assert.equal(clampTo(0.8, r), 1);
  assert.equal(clampTo(5, r), 2);
  assert.equal(clampTo(-9, r), -2);
  assert.equal(clampTo(1.23, { min: 1, max: 8, step: 0 }), 1.23);
  // EV steps of a sixth: counted from 0, so 0 and the ends come out exact
  const ev = { min: -2, max: 2, step: 0.16666667 };
  assert.equal(clampTo(0, ev), 0);
  assert.equal(clampTo(0.7, ev), 0.6667);
  assert.equal(clampTo(9, ev), 2);
});

test('parseCameraRequest keeps only the known keys with the right types', () => {
  assert.deepEqual(parseCameraRequest({ exposureCompensation: 1, torch: true, zoom: '3', focusLock: 'yes', junk: 1 }), { exposureCompensation: 1, torch: true });
  assert.deepEqual(parseCameraRequest({ auto: true }), { auto: true });
  assert.equal(parseCameraRequest({ junk: 1 }), undefined);
  assert.equal(parseCameraRequest('torch'), undefined);
});

test('mergeCameraRequest layers commands and forgets them on auto', () => {
  const a = mergeCameraRequest(undefined, { exposureLock: true });
  const b = mergeCameraRequest(a, { zoom: 2 });
  assert.deepEqual(b, { exposureLock: true, zoom: 2 });
  assert.deepEqual(mergeCameraRequest(b, { exposureLock: false }), { exposureLock: false, zoom: 2 });
  assert.equal(mergeCameraRequest(b, { auto: true }), undefined);
});

test('cameraConstraints: one set per setting, clamped, only what the camera offers', () => {
  const can = readCamera(androidCaps, androidNow)!.can;
  assert.deepEqual(cameraConstraints({ exposureLock: true, exposureCompensation: 9, zoom: 0.2, torch: true, whiteBalanceLock: false }, can), [
    { exposureMode: 'manual' },
    { whiteBalanceMode: 'continuous' },
    { exposureCompensation: 2 },
    { zoom: 1 },
    { torch: true },
  ]);
  // a camera without zoom or torch: those parts of the command are dropped
  assert.deepEqual(cameraConstraints({ zoom: 2, torch: true, focusLock: true }, { focusLock: true }), [{ focusMode: 'manual' }]);
});

test('cameraConstraints: auto puts every offered control back to the camera', () => {
  const can = readCamera(androidCaps, androidNow)!.can;
  assert.deepEqual(cameraConstraints({ auto: true }, can), [
    { exposureMode: 'continuous' },
    { whiteBalanceMode: 'continuous' },
    { focusMode: 'continuous' },
    { exposureCompensation: 0 },
    { zoom: 1 },
    { torch: false },
  ]);
  assert.deepEqual(cameraConstraints({ auto: true }, { torch: true }), [{ torch: false }]);
});

test('evLabel', () => {
  assert.equal(evLabel(0), '0 EV');
  assert.equal(evLabel(0.04), '0 EV');
  assert.equal(evLabel(0.6666), '+0.7 EV');
  assert.equal(evLabel(-1), '−1 EV');
  assert.equal(evLabel(2), '+2 EV');
});
