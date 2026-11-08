// NDI audio in (32-bit float, one plane per channel) to what the room takes (16-bit, one channel).
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

/**
 * Channel numbers as the admin writes them (1-based: "1,2") to zero-based indexes that exist in the
 * frame. Falls back to the first two channels, or the only one, when none of the wanted ones exist.
 */
export function pickChannels(wanted: readonly number[], available: number): number[] {
  const idx = wanted.map((n) => n - 1).filter((i) => i >= 0 && i < available);
  if (idx.length > 0) return idx;
  return available >= 2 ? [0, 1] : [0];
}

/**
 * Averages the chosen planes into one 16-bit channel. The mix-minus is one signal by nature (the
 * programme minus the guest), so stereo in becomes mono out, and the guest's earpiece hears the same
 * from both sides.
 */
export function planarToMonoInt16(planes: readonly Float32Array[], channels: readonly number[], samples: number): Int16Array {
  const out = new Int16Array(samples);
  const chosen = channels.map((c) => planes[c]).filter((p): p is Float32Array => p !== undefined);
  if (chosen.length === 0) return out;
  const scale = 32767 / chosen.length;
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (const plane of chosen) sum += plane[i] ?? 0;
    const v = Math.round(sum * scale);
    out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return out;
}

/** Splits an NDI planar buffer into one Float32Array per channel (views, no copy). */
export function planesOf(buffer: ArrayBuffer, channels: number, strideBytes: number, samples: number): Float32Array[] {
  const planes: Float32Array[] = [];
  for (let c = 0; c < channels; c++) planes.push(new Float32Array(buffer, c * strideBytes, samples));
  return planes;
}
