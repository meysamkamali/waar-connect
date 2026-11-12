// Picture work for the NDI outputs, on I420 pictures (the Y plane, then U, then V, each tightly
// packed; that is what the decoder gives and what NDI takes): turning a guest's picture upright,
// fitting it into the output's size without stretching it (black beside it or above and below),
// weaving two pictures into one interlaced frame, and black for an empty slot.
// Plain JavaScript on typed arrays; where the machine has libyuv, yuv.ts does the fitting and the
// turning many times faster, to the same result. A picture that already has the output's size and
// stands upright is not touched at all: the caller sends the decoder's buffer as it is.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

/** Degrees the decoded frame must be turned clockwise to stand upright (a phone held on its side). */
export type Rotation = 0 | 90 | 180 | 270;

export const chromaSize = (n: number) => (n + 1) >> 1;
/** Bytes of an I420 picture. */
export const i420Bytes = (width: number, height: number) => width * height + 2 * chromaSize(width) * chromaSize(height);

/** Black: the darkest legal brightness, no colour. */
export function blackI420(dst: Uint8Array, width: number, height: number): void {
  const y = width * height;
  dst.fill(16, 0, y);
  dst.fill(128, y, i420Bytes(width, height));
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where an upright picture of sw x sh goes inside dw x dh: as large as fits, its shape kept, centred.
 * Even numbers throughout, so the colour planes line up.
 */
export function fitRect(sw: number, sh: number, dw: number, dh: number): Rect {
  const scale = Math.min(dw / sw, dh / sh);
  const width = Math.max(2, Math.min(dw, Math.round((sw * scale) / 2) * 2));
  const height = Math.max(2, Math.min(dh, Math.round((sh * scale) / 2) * 2));
  return { x: ((dw - width) >> 2) << 1, y: ((dh - height) >> 2) << 1, width, height };
}

/** The upright size of a frame that arrives turned. */
export function uprightSize(width: number, height: number, rotation: Rotation): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

function rotatePlane(src: Uint8Array, sOff: number, sw: number, sh: number, rotation: Rotation, dst: Uint8Array, dOff: number): void {
  // (ux, uy) is a place in the upright picture; the same mapping as the multiview's drawI420
  if (rotation === 180) {
    let o = dOff;
    for (let uy = 0; uy < sh; uy++) {
      let i = sOff + (sh - 1 - uy) * sw + (sw - 1);
      for (let ux = 0; ux < sw; ux++) dst[o++] = src[i--] as number;
    }
    return;
  }
  const uw = sh;
  const uh = sw;
  let o = dOff;
  if (rotation === 90) {
    // sx = uy, sy = sh - 1 - ux
    for (let uy = 0; uy < uh; uy++) {
      let i = sOff + (sh - 1) * sw + uy;
      for (let ux = 0; ux < uw; ux++) {
        dst[o++] = src[i] as number;
        i -= sw;
      }
    }
  } else {
    // 270: sx = sw - 1 - uy, sy = ux
    for (let uy = 0; uy < uh; uy++) {
      let i = sOff + (sw - 1 - uy);
      for (let ux = 0; ux < uw; ux++) {
        dst[o++] = src[i] as number;
        i += sw;
      }
    }
  }
}

/** Turns an I420 picture upright into `dst` (i420Bytes of the upright size). */
export function rotateI420(src: Uint8Array, sw: number, sh: number, rotation: Rotation, dst: Uint8Array): { width: number; height: number } {
  const up = uprightSize(sw, sh, rotation);
  if (rotation === 0) {
    dst.set(src.subarray(0, i420Bytes(sw, sh)));
    return up;
  }
  const scw = chromaSize(sw);
  const sch = chromaSize(sh);
  const ucw = chromaSize(up.width);
  const uch = chromaSize(up.height);
  rotatePlane(src, 0, sw, sh, rotation, dst, 0);
  rotatePlane(src, sw * sh, scw, sch, rotation, dst, up.width * up.height);
  rotatePlane(src, sw * sh + scw * sch, scw, sch, rotation, dst, up.width * up.height + ucw * uch);
  return up;
}

/** Something that fits pictures into an output size: this file's Fitter, or libyuv's (yuv.ts). */
export interface PictureFitter {
  /**
   * Draws the picture `src` (sw x sh, to be turned by `rotation`) into `dst` (dw x dh, even numbers):
   * upright, whole, its shape kept, black around it where the shapes differ.
   */
  fit(src: Uint8Array, sw: number, sh: number, rotation: Rotation, dst: Uint8Array, dw: number, dh: number): void;
}

/**
 * Fits pictures into an output size, in JavaScript. Keeps its work buffers and its tables between
 * frames, so a stream of pictures of one size costs no allocation. About forty milliseconds for
 * 720p into 1080p on the station's server: too slow for 25 a second there, hence yuv.ts.
 */
export class Fitter implements PictureFitter {
  #upright = new Uint8Array(0);
  #rowA = new Uint8Array(0);
  #rowB = new Uint8Array(0);
  #x0 = new Int32Array(0);
  #x1 = new Int32Array(0);
  #xf = new Int32Array(0);
  #tableFor = '';

  /**
   * Draws the picture `src` (sw x sh, to be turned by `rotation`) into `dst` (dw x dh, even numbers):
   * upright, whole, its shape kept, black around it where the shapes differ.
   */
  fit(src: Uint8Array, sw: number, sh: number, rotation: Rotation, dst: Uint8Array, dw: number, dh: number): void {
    let u = src;
    let uw = sw;
    let uh = sh;
    if (rotation !== 0) {
      const bytes = i420Bytes(sh, sw) > i420Bytes(sw, sh) ? i420Bytes(sh, sw) : i420Bytes(sw, sh);
      if (this.#upright.length < bytes) this.#upright = new Uint8Array(bytes);
      const up = rotateI420(src, sw, sh, rotation, this.#upright);
      u = this.#upright;
      uw = up.width;
      uh = up.height;
    }
    const r = fitRect(uw, uh, dw, dh);
    if (r.width !== dw || r.height !== dh) blackI420(dst, dw, dh);
    const ucw = chromaSize(uw);
    const uch = chromaSize(uh);
    const dcw = dw >> 1;
    const dch = dh >> 1;
    this.#plane(u, 0, uw, uh, dst, 0, dw, r.x, r.y, r.width, r.height, 'y');
    this.#plane(u, uw * uh, ucw, uch, dst, dw * dh, dcw, r.x >> 1, r.y >> 1, r.width >> 1, r.height >> 1, 'c');
    this.#plane(u, uw * uh + ucw * uch, ucw, uch, dst, dw * dh + dcw * dch, dcw, r.x >> 1, r.y >> 1, r.width >> 1, r.height >> 1, 'c');
  }

  /** One plane, sw x sh at sOff, into the rectangle (rx, ry, rw, rh) of a plane dStride wide at dOff: two-tap in each direction. */
  #plane(src: Uint8Array, sOff: number, sw: number, sh: number, dst: Uint8Array, dOff: number, dStride: number, rx: number, ry: number, rw: number, rh: number, which: string): void {
    if (sw === rw && sh === rh) {
      for (let y = 0; y < rh; y++) dst.set(src.subarray(sOff + y * sw, sOff + y * sw + rw), dOff + (ry + y) * dStride + rx);
      return;
    }
    // where each output column reads from: two neighbours and the weight of the second, in 256ths
    const key = `${which}:${sw}>${rw}`;
    if (this.#x0.length < rw) {
      this.#x0 = new Int32Array(rw);
      this.#x1 = new Int32Array(rw);
      this.#xf = new Int32Array(rw);
      this.#tableFor = '';
    }
    if (this.#rowA.length < rw) {
      this.#rowA = new Uint8Array(rw);
      this.#rowB = new Uint8Array(rw);
    }
    const x0 = this.#x0;
    const x1 = this.#x1;
    const xf = this.#xf;
    if (this.#tableFor !== key) {
      const step = sw / rw;
      for (let x = 0; x < rw; x++) {
        const f = (x + 0.5) * step - 0.5;
        const i = f <= 0 ? 0 : f >= sw - 1 ? sw - 1 : Math.floor(f);
        x0[x] = i;
        x1[x] = i >= sw - 1 ? sw - 1 : i + 1;
        xf[x] = f <= 0 || i >= sw - 1 ? 0 : Math.round((f - i) * 256);
      }
      this.#tableFor = key;
    }
    let a = this.#rowA;
    let b = this.#rowB;
    let rowOfA = -1;
    let rowOfB = -1;
    const stepY = sh / rh;
    for (let y = 0; y < rh; y++) {
      const f = (y + 0.5) * stepY - 0.5;
      const i0 = f <= 0 ? 0 : f >= sh - 1 ? sh - 1 : Math.floor(f);
      const i1 = i0 >= sh - 1 ? sh - 1 : i0 + 1;
      const wy = f <= 0 || i0 >= sh - 1 ? 0 : Math.round((f - i0) * 256);
      // the two source rows this output row lies between, each stretched to the output's width once
      if (rowOfA !== i0) {
        if (rowOfB === i0) {
          const t = a;
          a = b;
          b = t;
          rowOfB = rowOfA;
          rowOfA = i0;
        } else {
          const base = sOff + i0 * sw;
          for (let x = 0; x < rw; x++) {
            const p = src[base + (x0[x] as number)] as number;
            a[x] = p + ((((src[base + (x1[x] as number)] as number) - p) * (xf[x] as number) + 128) >> 8);
          }
          rowOfA = i0;
        }
      }
      let o = dOff + (ry + y) * dStride + rx;
      if (wy === 0) {
        dst.set(a.subarray(0, rw), o);
        continue;
      }
      if (rowOfB !== i1) {
        const base = sOff + i1 * sw;
        for (let x = 0; x < rw; x++) {
          const p = src[base + (x0[x] as number)] as number;
          b[x] = p + ((((src[base + (x1[x] as number)] as number) - p) * (xf[x] as number) + 128) >> 8);
        }
        rowOfB = i1;
      }
      for (let x = 0; x < rw; x++) {
        const p = a[x] as number;
        dst[o++] = p + ((((b[x] as number) - p) * wy + 128) >> 8);
      }
    }
  }
}

/**
 * One interlaced frame from two pictures of the same size: the upper field (lines 0, 2, 4…) from
 * `first`, the earlier picture, the lower field from `second`. The colour planes are woven the same
 * way, line by line, as interlaced 4:2:0 carries them.
 */
export function weaveI420(first: Uint8Array, second: Uint8Array, dst: Uint8Array, width: number, height: number): void {
  const weave = (off: number, w: number, h: number) => {
    for (let y = 0; y < h; y++) {
      const from = (y & 1) === 0 ? first : second;
      const at = off + y * w;
      dst.set(from.subarray(at, at + w), at);
    }
  };
  const cw = chromaSize(width);
  const ch = chromaSize(height);
  weave(0, width, height);
  weave(width * height, cw, ch);
  weave(width * height + cw * ch, cw, ch);
}

/** The frame rate to state for a stream that is sent as it arrives: the nearest usual one. */
export function nominalRate(measured: number): number {
  if (!Number.isFinite(measured) || measured <= 0) return 25;
  let best = 25;
  for (const r of [25, 30, 50, 60]) if (Math.abs(r - measured) < Math.abs(best - measured)) best = r;
  return best;
}

/** 16-bit sound, channels interleaved, to what NDI takes: 32-bit float, one plane per channel, with a gain. */
export function interleavedToPlanar(pcm: Int16Array, channels: number, samples: number, gain: number, out: Float32Array): void {
  const k = gain / 32768;
  for (let c = 0; c < channels; c++) {
    let i = c;
    const base = c * samples;
    for (let s = 0; s < samples; s++) {
      out[base + s] = (pcm[i] as number) * k;
      i += channels;
    }
  }
}
