// Scales a BGRA frame down before the encode, in plain JavaScript on the main thread. The H.264 encode
// grows with the pixel count, so a 540p return costs about a quarter of a 1080p one. Measured on the VM
// (Xeon E5-2680 v2): 1080p to 540p with the 2x2 box filter 9 ms a frame; sharp/libvips took 58 ms for
// the same because a four-channel picture goes through its alpha premultiply path, so no native scaler.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

export interface Size {
  width: number;
  height: number;
}

/** The size to send: `height` at the source's aspect ratio, even numbers, never larger than the source. */
export function sizeFor(srcWidth: number, srcHeight: number, height: number): Size {
  const h = Math.min(height, srcHeight) & ~1;
  const width = Math.max(2, Math.round((srcWidth * h) / srcHeight / 2) * 2);
  return { width, height: h };
}

/** Every output pixel is the mean of an n×n block (exact 2:1 and 3:1 shrinks). The fourth byte is set to 255. */
function box(src: Uint8Array, w: number, dst: Uint8Array, ow: number, oh: number, n: number): void {
  const stride = w * 4;
  const round = (n * n) >> 1;
  const div = n * n;
  for (let y = 0; y < oh; y++) {
    const row0 = y * n * stride;
    let o = y * ow * 4;
    for (let x = 0; x < ow; x++) {
      let b = 0;
      let g = 0;
      let r = 0;
      let p = row0 + x * n * 4;
      for (let dy = 0; dy < n; dy++) {
        let q = p;
        for (let dx = 0; dx < n; dx++) {
          b += src[q] as number;
          g += src[q + 1] as number;
          r += src[q + 2] as number;
          q += 4;
        }
        p += stride;
      }
      dst[o] = ((b + round) / div) | 0;
      dst[o + 1] = ((g + round) / div) | 0;
      dst[o + 2] = ((r + round) / div) | 0;
      dst[o + 3] = 255;
      o += 4;
    }
  }
}

/** Bilinear, integer weights (0..256), with the x taps computed once per frame. For ratios the box filter cannot do. */
function bilinear(src: Uint8Array, w: number, h: number, dst: Uint8Array, ow: number, oh: number): void {
  const stride = w * 4;
  const x0s = new Int32Array(ow);
  const fxs = new Int32Array(ow);
  for (let x = 0; x < ow; x++) {
    const sx = Math.min(w - 1, ((x + 0.5) * w) / ow - 0.5);
    const x0 = Math.max(0, Math.floor(sx));
    x0s[x] = Math.min(x0, w - 2) * 4;
    fxs[x] = Math.round((sx - Math.min(x0, w - 2)) * 256);
  }
  for (let y = 0; y < oh; y++) {
    const sy = Math.min(h - 1, ((y + 0.5) * h) / oh - 0.5);
    const y0 = Math.min(Math.max(0, Math.floor(sy)), h - 2);
    const fy = Math.round((sy - y0) * 256);
    const r0 = y0 * stride;
    const r1 = r0 + stride;
    let o = y * ow * 4;
    for (let x = 0; x < ow; x++) {
      const p = x0s[x] as number;
      const fx = fxs[x] as number;
      const gx = 256 - fx;
      for (let c = 0; c < 3; c++) {
        const top = (src[r0 + p + c] as number) * gx + (src[r0 + p + 4 + c] as number) * fx;
        const bottom = (src[r1 + p + c] as number) * gx + (src[r1 + p + 4 + c] as number) * fx;
        dst[o + c] = (top * (256 - fy) + bottom * fy + 32768) >> 16;
      }
      dst[o + 3] = 255;
      o += 4;
    }
  }
}

/**
 * Writes the frame scaled to `out` into `dst` (which must hold out.width × out.height × 4 bytes) and
 * returns `dst`; when nothing changes the source itself comes back untouched. Byte order (BGRA) is kept.
 */
export function scaleBgraInto(src: Uint8Array, width: number, height: number, out: Size, dst: Uint8Array): Uint8Array {
  if (out.width === width && out.height === height) return src;
  if (dst.length < out.width * out.height * 4) throw new Error('scale: destination too small');
  if (width === out.width * 2 && height === out.height * 2) box(src, width, dst, out.width, out.height, 2);
  else if (width === out.width * 3 && height === out.height * 3) box(src, width, dst, out.width, out.height, 3);
  else bilinear(src, width, height, dst, out.width, out.height);
  return dst;
}

/** Two destination buffers in turn, so the frame just handed to the encoder is not overwritten while it is read. */
export class ScaleBuffers {
  #bufs: Uint8Array[] = [];
  #next = 0;

  take(size: Size): Uint8Array {
    const bytes = size.width * size.height * 4;
    if (this.#bufs.length !== 2 || (this.#bufs[0] as Uint8Array).length !== bytes) this.#bufs = [new Uint8Array(bytes), new Uint8Array(bytes)];
    const buf = this.#bufs[this.#next] as Uint8Array;
    this.#next ^= 1;
    return buf;
  }
}
