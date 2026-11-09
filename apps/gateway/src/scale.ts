// Scales a BGRA frame down before the encode. The H.264 encode is the gateway's main CPU cost and it
// grows with the pixel count, so a 540p return costs about a quarter of a 1080p one. sharp (libvips)
// does the resize with SIMD on its own threads.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import sharp from 'sharp';

sharp.concurrency(2);
sharp.cache(false);

export interface ScaledFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

/** The size to send: `height` at the source's aspect ratio, even numbers, never larger than the source. */
export function sizeFor(srcWidth: number, srcHeight: number, height: number): { width: number; height: number } {
  const h = Math.min(height, srcHeight) & ~1;
  const width = Math.max(2, Math.round((srcWidth * h) / srcHeight / 2) * 2);
  return { width, height: h };
}

/**
 * Sets the fourth byte of every pixel to 255. NDI BGRX leaves it at 0, and sharp premultiplies the
 * colour with it before resizing (its pipeline order, whatever the call order), which would black the
 * picture out. In place: the frame is the gateway's own copy.
 */
export function opaque(data: Uint8Array): void {
  if (data.byteOffset % 4 === 0 && data.byteLength % 4 === 0) {
    const words = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    for (let i = 0; i < words.length; i++) words[i] = (words[i] as number) | 0xff000000;
  } else {
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
  }
}

/** The frame at the given size; the same frame when nothing changes. Byte order (BGRA) is kept. */
export async function scaleBgra(data: Uint8Array, width: number, height: number, outWidth: number, outHeight: number): Promise<ScaledFrame> {
  if (outWidth === width && outHeight === height) return { data, width, height };
  opaque(data);
  const out = await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } })
    .resize(outWidth, outHeight, { kernel: 'lanczos2', fit: 'fill' })
    .raw()
    .toBuffer();
  return { data: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), width: outWidth, height: outHeight };
}
