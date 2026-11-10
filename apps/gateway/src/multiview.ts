// The multiview burn-in: the pictures of the guests the producer ticked MV, drawn into a copy of the
// return picture. There is one multiview for the whole group, every guest's own picture included, and
// the group gets that one stream instead of one small stream per guest.
//
// Its place is fixed. Cut the picture into nine equal parts: the bottom-left part is where the phone
// shows the guest's own camera, so the multiview has the bottom-centre and the bottom-right part, as
// one dark panel with one to eight pictures inside. A phone that must not show the programme (the
// guest is on Black or on the PCR) shows that panel alone, so the panel is always opaque.
//
// Pure pixel work on BGRA buffers, in plain JavaScript; the pictures are small, so drawing them costs
// a few percent of a core.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { scaleBgraInto } from './scale.ts';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Every guest's picture is kept at this size, whatever arrives and whatever the tiles' size is. */
export const THUMB = { width: 320, height: 180 } as const;
/** More pictures than this would be too small to recognise on a phone. */
export const MAX_TILES = 8;

/** The multiview's panel: the bottom-centre and bottom-right ninths of the picture (two thirds wide, one third high). */
export function mvPanel(width: number, height: number): Rect {
  const x = Math.round(width / 3) & ~1;
  const y = Math.round((height * 2) / 3) & ~1;
  return { x, y, width: width - x, height: height - y };
}

/**
 * Where one to eight 16:9 pictures go inside the panel: the grid that makes them largest (two side
 * by side fill it; three in a row; then rows of three or four), the whole block centred, a shorter
 * last row centred too. Even numbers throughout.
 */
export function layoutTiles(count: number, panel: Rect): Rect[] {
  const n = Math.min(Math.max(0, Math.floor(count)), MAX_TILES);
  if (n === 0 || panel.width < 32 || panel.height < 18) return [];
  const gap = Math.max(2, Math.round(panel.width * 0.006)) & ~1;
  let best = { cols: 1, rows: n, tw: 0, waste: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const byWidth = (panel.width - gap * (cols + 1)) / cols;
    const byHeight = (((panel.height - gap * (rows + 1)) / rows) * 16) / 9;
    const tw = Math.floor(Math.min(byWidth, byHeight)) & ~1;
    const waste = cols * rows - n;
    // the largest picture wins; between equals, the grid with the fewest empty places
    if (tw > best.tw || (tw === best.tw && waste < best.waste)) best = { cols, rows, tw, waste };
  }
  const { cols, rows, tw } = best;
  if (tw < 8) return [];
  const th = Math.round((tw * 9) / 16) & ~1;
  const blockH = rows * th + (rows - 1) * gap;
  const y0 = panel.y + (((panel.height - blockH) / 2) & ~1);
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols);
    const rowW = inRow * tw + (inRow - 1) * gap;
    const x0 = panel.x + (((panel.width - rowW) / 2) & ~1);
    for (let c = 0; c < inRow; c++) out.push({ x: x0 + c * (tw + gap), y: y0 + r * (th + gap), width: tw, height: th });
  }
  return out;
}

/** Degrees the decoded frame must be turned clockwise to stand upright (a phone held on its side). */
export type Rotation = 0 | 90 | 180 | 270;

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Draws one decoded frame (I420: the Y plane, then U, then V, each tightly packed) into a BGRA
 * picture of dw x dh: upright, whole (letterboxed in near-black, never cropped), colours by BT.601
 * limited range as libyuv does. A large source is averaged down in brightness, block by block, so a
 * full-size frame does not shimmer in a small picture; colour is taken from the nearest sample.
 */
export function drawI420(src: Uint8Array, sw: number, sh: number, rotation: Rotation, dst: Uint8Array, dw: number, dh: number): void {
  const cw = (sw + 1) >> 1;
  const ch = (sh + 1) >> 1;
  const uOff = sw * sh;
  const vOff = uOff + cw * ch;
  if (sw < 2 || sh < 2 || src.length < vOff + cw * ch) throw new Error('multiview: I420 frame too short');
  if (dst.length < dw * dh * 4) throw new Error('multiview: destination too small');

  for (let i = 0, end = dw * dh * 4; i < end; i += 4) {
    dst[i] = 16;
    dst[i + 1] = 16;
    dst[i + 2] = 16;
    dst[i + 3] = 255;
  }

  const turned = rotation === 90 || rotation === 270;
  const uw = turned ? sh : sw; // the upright picture's size
  const uh = turned ? sw : sh;
  const scale = Math.min(dw / uw, dh / uh);
  const pw = Math.max(1, Math.min(dw, Math.round(uw * scale)));
  const ph = Math.max(1, Math.min(dh, Math.round(uh * scale)));
  const ox = (dw - pw) >> 1;
  const oy = (dh - ph) >> 1;
  const k = Math.max(1, Math.min(8, Math.floor(1 / scale))); // brightness is the mean of a k x k block
  const half = k >> 1;
  const area = k * k;

  for (let y = 0; y < ph; y++) {
    const uy = Math.min(uh - 1, Math.floor(((y + 0.5) * uh) / ph));
    let o = ((oy + y) * dw + ox) * 4;
    for (let x = 0; x < pw; x++) {
      const ux = Math.min(uw - 1, Math.floor(((x + 0.5) * uw) / pw));
      let sx: number;
      let sy: number;
      if (rotation === 0) {
        sx = ux;
        sy = uy;
      } else if (rotation === 90) {
        sx = uy;
        sy = sh - 1 - ux;
      } else if (rotation === 180) {
        sx = sw - 1 - ux;
        sy = sh - 1 - uy;
      } else {
        sx = sw - 1 - uy;
        sy = ux;
      }
      let Y: number;
      if (k === 1) Y = src[sy * sw + sx] as number;
      else {
        const x0 = Math.min(Math.max(0, sx - half), sw - k);
        const y0 = Math.min(Math.max(0, sy - half), sh - k);
        let sum = 0;
        for (let dy = 0; dy < k; dy++) {
          let p = (y0 + dy) * sw + x0;
          for (let dx = 0; dx < k; dx++) sum += src[p++] as number;
        }
        Y = ((sum + (area >> 1)) / area) | 0;
      }
      const ci = (sy >> 1) * cw + (sx >> 1);
      const U = (src[uOff + ci] as number) - 128;
      const V = (src[vOff + ci] as number) - 128;
      const c = 298 * (Y - 16) + 128;
      dst[o] = clamp8((c + 516 * U) >> 8);
      dst[o + 1] = clamp8((c - 100 * U - 208 * V) >> 8);
      dst[o + 2] = clamp8((c + 409 * V) >> 8);
      dst[o + 3] = 255;
      o += 4;
    }
  }
}

/** Fills a rectangle of a BGRA picture with one colour, clipped to the picture. */
export function fillRect(dst: Uint8Array, width: number, height: number, r: Rect, b: number, g: number, red: number): void {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(width, r.x + r.width);
  const y1 = Math.min(height, r.y + r.height);
  for (let y = y0; y < y1; y++) {
    let o = (y * width + x0) * 4;
    for (let x = x0; x < x1; x++) {
      dst[o] = b;
      dst[o + 1] = g;
      dst[o + 2] = red;
      dst[o + 3] = 255;
      o += 4;
    }
  }
}

/** Copies a small BGRA picture (tw x th) into a large one at (x, y), row by row, clipped to the large one. */
export function blit(dst: Uint8Array, width: number, height: number, tile: Uint8Array, tw: number, th: number, x: number, y: number): void {
  const x0 = Math.max(0, x);
  const x1 = Math.min(width, x + tw);
  if (x1 <= x0) return;
  for (let row = Math.max(0, -y); row < th && y + row < height; row++) {
    const from = (row * tw + (x0 - x)) * 4;
    dst.set(tile.subarray(from, from + (x1 - x0) * 4), ((y + row) * width + x0) * 4);
  }
}

interface Tile {
  /** The guest's latest picture at THUMB size. */
  thumb: Uint8Array;
  /** Counts the pictures drawn into thumb. */
  seq: number;
  at: number;
  /** thumb scaled to the size the layout asked for last, and which picture that was. */
  scaled: Uint8Array | null;
  scaledW: number;
  scaledH: number;
  scaledSeq: number;
}

/**
 * The guests in the multiview and their latest pictures. A guest's frame is drawn into a small
 * picture when it arrives (at most `everyMs` apart: these are thumbnails, half the frame rate is
 * plenty); composing copies those into the return picture and scales one only when it changed.
 *
 * A guest is shown while frames arrive: from the first frame until `staleMs` after the last one.
 * That is how a guest leaves the multiview here. The media library does not report the server
 * ending a subscription; the frames simply stop.
 */
export class Tiles {
  readonly #tiles = new Map<string, Tile>();
  readonly everyMs: number;
  readonly staleMs: number;

  constructor(everyMs = 75, staleMs = 2500) {
    this.everyMs = everyMs;
    this.staleMs = staleMs;
  }

  /** The guests whose pictures are live right now, in a fixed order, so a picture does not jump places when someone else's frame arrives. */
  identities(now: number): string[] {
    return [...this.#tiles]
      .filter(([, t]) => t.at > 0 && now - t.at < this.staleMs)
      .map(([id]) => id)
      .sort();
  }

  /** How many guests are shown right now. */
  count(now: number): number {
    return this.identities(now).length;
  }

  /** A camera we may get frames from. It shows from its first frame. */
  add(identity: string): void {
    if (this.#tiles.has(identity)) return;
    const thumb = new Uint8Array(THUMB.width * THUMB.height * 4);
    for (let i = 0; i < thumb.length; i += 4) {
      thumb[i] = 16;
      thumb[i + 1] = 16;
      thumb[i + 2] = 16;
      thumb[i + 3] = 255;
    }
    this.#tiles.set(identity, { thumb, seq: 0, at: 0, scaled: null, scaledW: 0, scaledH: 0, scaledSeq: -1 });
  }

  remove(identity: string): void {
    this.#tiles.delete(identity);
  }

  clear(): void {
    this.#tiles.clear();
  }

  /** True when this guest's picture is due for a new frame. Ask before touching the frame's pixels. */
  due(identity: string, now: number): boolean {
    const t = this.#tiles.get(identity);
    return t !== undefined && now - t.at >= this.everyMs;
  }

  /** A decoded I420 frame of this guest. */
  update(identity: string, src: Uint8Array, width: number, height: number, rotation: Rotation, now: number): void {
    const t = this.#tiles.get(identity);
    if (!t) return;
    drawI420(src, width, height, rotation, t.thumb, THUMB.width, THUMB.height);
    t.seq++;
    t.at = now;
  }

  /**
   * Draws the multiview into the BGRA picture `dst` (width x height): the dark panel over the
   * bottom-centre and bottom-right ninths, and the live guests' pictures in it. Returns how many.
   */
  compose(dst: Uint8Array, width: number, height: number, now: number): number {
    const ids = this.identities(now).slice(0, MAX_TILES);
    const panel = mvPanel(width, height);
    fillRect(dst, width, height, panel, 12, 12, 12);
    const rects = layoutTiles(ids.length, panel);
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i] as Rect;
      const t = this.#tiles.get(ids[i] as string) as Tile;
      if (t.scaled === null || t.scaledW !== r.width || t.scaledH !== r.height) {
        t.scaled = new Uint8Array(r.width * r.height * 4);
        t.scaledW = r.width;
        t.scaledH = r.height;
        t.scaledSeq = -1;
      }
      if (t.scaledSeq !== t.seq) {
        const out = scaleBgraInto(t.thumb, THUMB.width, THUMB.height, { width: r.width, height: r.height }, t.scaled);
        if (out !== t.scaled) t.scaled.set(out); // same size: the scaler hands the source back
        t.scaledSeq = t.seq;
      }
      blit(dst, width, height, t.scaled, r.width, r.height, r.x, r.y);
    }
    return rects.length;
  }
}
