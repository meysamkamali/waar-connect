import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickChannels, planarToMonoInt16, planesOf } from './audio.ts';

test('pickChannels: 1-based wishes become zero-based indexes that exist', () => {
  assert.deepEqual(pickChannels([1, 2], 8), [0, 1]);
  assert.deepEqual(pickChannels([3, 4], 8), [2, 3]);
  assert.deepEqual(pickChannels([3, 4], 2), [0, 1], 'wanted channels missing: first pair');
  assert.deepEqual(pickChannels([5], 1), [0], 'mono source: the only channel');
  assert.deepEqual(pickChannels([1, 9], 4), [0], 'the existing one of two wishes');
});

test('planarToMonoInt16 averages the chosen planes and clips', () => {
  const left = Float32Array.from([0.5, -0.5, 1.5, 0]);
  const right = Float32Array.from([0.5, 0.5, 1.5, 0.25]);
  const other = Float32Array.from([9, 9, 9, 9]);
  const mono = planarToMonoInt16([left, right, other], [0, 1], 4);
  assert.deepEqual(Array.from(mono), [Math.round(0.5 * 32767), 0, 32767, Math.round(0.125 * 32767)]);
  const single = planarToMonoInt16([left, right, other], [0], 2);
  assert.deepEqual(Array.from(single), [Math.round(0.5 * 32767), Math.round(-0.5 * 32767)]);
  assert.deepEqual(Array.from(planarToMonoInt16([left], [7], 2)), [0, 0], 'no plane at all: silence');
});

test('planesOf cuts an NDI planar buffer by channel stride', () => {
  const samples = 3;
  const stride = 16; // 3 floats used, one float of padding per plane
  const buf = new ArrayBuffer(2 * stride);
  const all = new Float32Array(buf);
  all.set([1, 2, 3, 0, 4, 5, 6, 0]);
  const [l, r] = planesOf(buf, 2, stride, samples);
  assert.deepEqual(Array.from(l!), [1, 2, 3]);
  assert.deepEqual(Array.from(r!), [4, 5, 6]);
});
