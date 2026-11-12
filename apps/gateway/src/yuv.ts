// libyuv through koffi, where the machine has it (Ubuntu: the package libyuv0). It scales and turns
// I420 pictures with the processor's vector instructions: fitting 720p into 1080p takes a few
// milliseconds, where the JavaScript in outframe.ts takes about forty and cannot keep 25 pictures a
// second on an older core. Without the library the outputs use the JavaScript fitter.
// The library is checked when it is loaded: a small picture is scaled into a part of a larger one and
// turned each way, and the result compared with what outframe.ts makes.
// libyuv is BSD-licensed (The LibYuv Project Authors); it is loaded at run time, not shipped here.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import koffi from 'koffi';
import { log } from './log.ts';
import { blackI420, chromaSize, Fitter, fitRect, i420Bytes, rotateI420, uprightSize, type PictureFitter, type Rect, type Rotation } from './outframe.ts';

/** libyuv's FilterMode "box": the best it has. Scaling up, it is two-tap in each direction. */
const FILTER_BOX = 3;

type Fn = (...args: unknown[]) => number;

/** Where the library usually is; YUV_LIB in the environment wins. */
export function yuvCandidates(explicit?: string): string[] {
  if (explicit) return [explicit];
  if (process.platform === 'win32') return ['libyuv.dll', 'yuv.dll'];
  return ['libyuv.so.0', '/usr/lib/x86_64-linux-gnu/libyuv.so.0', '/usr/local/lib/libyuv.so.0', 'libyuv.so'];
}

export class Yuv {
  readonly path: string;
  /** The library turns pictures the way outframe.ts does (checked at load). When not, they are turned in JavaScript. */
  readonly turns: boolean;
  readonly #scale: Fn;
  readonly #rotate: Fn;

  /** The first candidate that loads and passes the check; undefined when the machine has none. */
  static load(explicit?: string): Yuv | undefined {
    for (const path of yuvCandidates(explicit)) {
      let yuv: Yuv;
      try {
        yuv = new Yuv(path);
      } catch {
        continue; // not there
      }
      const fault = yuv.#scaleFault();
      if (fault) {
        log('warn', 'libyuv is there but does not scale as expected; not used', { path, fault });
        continue;
      }
      return yuv;
    }
    return undefined;
  }

  private constructor(path: string) {
    const lib = koffi.load(path);
    this.path = path;
    this.#scale = lib.func(
      'int I420Scale(const void *src_y, int src_stride_y, const void *src_u, int src_stride_u, const void *src_v, int src_stride_v, int src_width, int src_height, void *dst_y, int dst_stride_y, void *dst_u, int dst_stride_u, void *dst_v, int dst_stride_v, int dst_width, int dst_height, int filtering)',
    ) as unknown as Fn;
    this.#rotate = lib.func(
      'int I420Rotate(const void *src_y, int src_stride_y, const void *src_u, int src_stride_u, const void *src_v, int src_stride_v, void *dst_y, int dst_stride_y, void *dst_u, int dst_stride_u, void *dst_v, int dst_stride_v, int width, int height, int mode)',
    ) as unknown as Fn;
    this.turns = this.#turnsAsWeDo();
  }

  /** Scales the upright picture `src` (sw x sh) into the rectangle `r` of `dst` (dw x dh, even numbers; `r` even too). */
  scale(src: Uint8Array, sw: number, sh: number, dst: Uint8Array, dw: number, dh: number, r: Rect): void {
    const scw = chromaSize(sw);
    const sch = chromaSize(sh);
    const dcw = dw >> 1;
    const dch = dh >> 1;
    const su = sw * sh;
    const sv = su + scw * sch;
    const du = dw * dh;
    const dv = du + dcw * dch;
    const c = (r.y >> 1) * dcw + (r.x >> 1);
    const rc = this.#scale(src, sw, src.subarray(su), scw, src.subarray(sv), scw, sw, sh, dst.subarray(r.y * dw + r.x), dw, dst.subarray(du + c), dcw, dst.subarray(dv + c), dcw, r.width, r.height, FILTER_BOX);
    if (rc !== 0) throw new Error(`I420Scale failed (${rc})`);
  }

  /** Turns an I420 picture upright into `dst` (i420Bytes of the upright size). */
  rotate(src: Uint8Array, sw: number, sh: number, rotation: Rotation, dst: Uint8Array): { width: number; height: number } {
    const up = uprightSize(sw, sh, rotation);
    const scw = chromaSize(sw);
    const sch = chromaSize(sh);
    const ucw = chromaSize(up.width);
    const uch = chromaSize(up.height);
    const su = sw * sh;
    const uu = up.width * up.height;
    const rc = this.#rotate(src, sw, src.subarray(su), scw, src.subarray(su + scw * sch), scw, dst, up.width, dst.subarray(uu), ucw, dst.subarray(uu + ucw * uch), ucw, sw, sh, rotation);
    if (rc !== 0) throw new Error(`I420Rotate failed (${rc})`);
    return up;
  }

  /** A flat 8x8 picture into the middle of a black 32x16 one: the right bytes changed, and no others. */
  #scaleFault(): string | null {
    try {
      const src = new Uint8Array(i420Bytes(8, 8));
      src.fill(100, 0, 64);
      src.fill(90, 64, 80);
      src.fill(160, 80, 96);
      const dw = 32;
      const dh = 16;
      const dst = new Uint8Array(i420Bytes(dw, dh));
      blackI420(dst, dw, dh);
      const r = fitRect(8, 8, dw, dh); // 16x16 at x 8
      this.scale(src, 8, 8, dst, dw, dh, r);
      const y = (px: number, py: number) => dst[py * dw + px];
      const u = (px: number, py: number) => dst[dw * dh + py * (dw >> 1) + px];
      const v = (px: number, py: number) => dst[dw * dh + (dw >> 1) * (dh >> 1) + py * (dw >> 1) + px];
      const want: [string, number | undefined, number][] = [
        ['y inside, first', y(r.x, 0), 100],
        ['y inside, last', y(r.x + r.width - 1, dh - 1), 100],
        ['y left of it', y(r.x - 1, 0), 16],
        ['y right of it', y(r.x + r.width, dh - 1), 16],
        ['u inside', u(r.x >> 1, 0), 90],
        ['u left of it', u((r.x >> 1) - 1, 3), 128],
        ['v inside, last', v(((r.x + r.width) >> 1) - 1, (dh >> 1) - 1), 160],
        ['v right of it', v((r.x + r.width) >> 1, (dh >> 1) - 1), 128],
      ];
      const bad = want.find(([, got, exp]) => got !== exp);
      return bad ? `${bad[0]}: ${bad[1]} instead of ${bad[2]}` : null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  #turnsAsWeDo(): boolean {
    try {
      const w = 6;
      const h = 4;
      const src = new Uint8Array(i420Bytes(w, h));
      for (let i = 0; i < src.length; i++) src[i] = (i * 37 + 11) % 251;
      for (const rotation of [90, 180, 270] as const) {
        const up = uprightSize(w, h, rotation);
        const ours = new Uint8Array(i420Bytes(up.width, up.height));
        const theirs = new Uint8Array(ours.length);
        rotateI420(src, w, h, rotation, ours);
        this.rotate(src, w, h, rotation, theirs);
        for (let i = 0; i < ours.length; i++) if (ours[i] !== theirs[i]) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}

/** Fits pictures into an output size with libyuv: the same result as outframe.ts's Fitter, a fraction of its time. */
export class NativeFitter implements PictureFitter {
  readonly #yuv: Yuv;
  #upright = new Uint8Array(0);

  constructor(yuv: Yuv) {
    this.#yuv = yuv;
  }

  fit(src: Uint8Array, sw: number, sh: number, rotation: Rotation, dst: Uint8Array, dw: number, dh: number): void {
    let u = src;
    let uw = sw;
    let uh = sh;
    if (rotation !== 0) {
      const up = uprightSize(sw, sh, rotation);
      const bytes = i420Bytes(up.width, up.height);
      if (this.#upright.length < bytes) this.#upright = new Uint8Array(bytes);
      if (this.#yuv.turns) this.#yuv.rotate(src, sw, sh, rotation, this.#upright);
      else rotateI420(src, sw, sh, rotation, this.#upright);
      u = this.#upright;
      uw = up.width;
      uh = up.height;
    }
    const r = fitRect(uw, uh, dw, dh);
    if (r.width !== dw || r.height !== dh) blackI420(dst, dw, dh);
    this.#yuv.scale(u, uw, uh, dst, dw, dh, r);
  }
}

/** The fitter this machine can run: libyuv's when the library is there, else the JavaScript one. */
export function loadFitter(explicit?: string): { fitter: PictureFitter; by: 'libyuv' | 'javascript'; path: string | null } {
  const yuv = Yuv.load(explicit);
  return yuv ? { fitter: new NativeFitter(yuv), by: 'libyuv', path: yuv.path } : { fitter: new Fitter(), by: 'javascript', path: null };
}
