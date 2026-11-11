// The guest's screen, as the admin designs it. The screen is nine equal sections, three by three.
// Widgets fill it: pictures (the studio feed, the guest's own camera, the multiview) take whole
// sections and do not lie on top of each other; overlays (the tally, the producer's cue banner, the
// guest's buttons) float over the pictures, docked in a section. There is one pattern for each number
// of guests on the screen, one to eight: a guest alone, or a multiview group of two, three, and so on.
//
// The multiview is one wide picture made by the return feed (track mv-strip). Its widget is three
// sections wide and one high, so the strip has exactly that shape (`stripSize`), and the pictures in
// it are laid out by `layoutTiles`, here so that the designer draws them as the gateway does.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

export const SCREEN_COLS = 3;
export const SCREEN_ROWS = 3;
/** One pattern per number of guests on the screen, one to eight (the multiview holds eight). */
export const SCREEN_GUESTS = 8;

export const PICTURE_KINDS = ['studio', 'self', 'mv'] as const;
export const OVERLAY_KINDS = ['status', 'cue', 'mic', 'hand', 'help', 'screen'] as const;
export const WIDGET_KINDS = [...PICTURE_KINDS, ...OVERLAY_KINDS] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];
export type OverlayKind = (typeof OVERLAY_KINDS)[number];
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/** A widget on the screen: its first section (column and row from 0, top left) and how many it spans. */
export interface ScreenWidget {
  kind: WidgetKind;
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export interface ScreenPattern {
  widgets: ScreenWidget[];
}

/** `patterns[n - 1]` is the screen for n guests. */
export interface GuestScreen {
  patterns: ScreenPattern[];
}

export interface WidgetSize {
  cols: number;
  rows: number;
  /** As the station says it: rows by columns. */
  name: string;
}

export interface WidgetSpec {
  layer: 'picture' | 'overlay';
  title: string;
  /** What it is on the guest's phone, for the designer's balloon. */
  about: string;
  /** The sizes it comes in, the usual one first. */
  sizes: readonly WidgetSize[];
  /** Cannot be taken off the screen. */
  required: boolean;
}

const ONE: WidgetSize = { cols: 1, rows: 1, name: '1×1' };

export const WIDGET_SPECS: Readonly<Record<WidgetKind, WidgetSpec>> = {
  studio: {
    layer: 'picture',
    title: 'Studio feed',
    about: 'What the producer lets the guest see: the studio return, the producer, or nothing. Full screen it lies under the other pictures.',
    sizes: [{ cols: 2, rows: 2, name: '2×2' }, ONE, { cols: 3, rows: 3, name: 'full' }],
    required: false,
  },
  self: { layer: 'picture', title: 'Self camera', about: "The guest's own camera, mirrored.", sizes: [ONE], required: false },
  mv: {
    layer: 'picture',
    title: 'Multiview',
    about: 'The guests ticked MV in one wide picture, the guest included. Empty while the guest is alone.',
    sizes: [{ cols: 3, rows: 1, name: '1×3' }],
    required: false,
  },
  status: { layer: 'overlay', title: 'Tally', about: 'Where the guest is, STAND BY and ON AIR, and a word when the connection is in trouble. Always on the screen.', sizes: [ONE], required: true },
  cue: {
    layer: 'overlay',
    title: 'Cue banner',
    about: "The producer's cue. It shows only while there is one, over whatever is under it; a touch puts it away.",
    sizes: [{ cols: 3, rows: 1, name: '1×3' }, { cols: 2, rows: 1, name: '1×2' }, ONE],
    required: false,
  },
  mic: { layer: 'overlay', title: 'Mute', about: 'Switches the guest’s microphone off and on. Red while muted.', sizes: [ONE], required: false },
  hand: { layer: 'overlay', title: 'Raise hand', about: 'Shows a raised hand on the producer’s desk.', sizes: [ONE], required: false },
  help: { layer: 'overlay', title: 'Help', about: 'Calls the producer and the engineer.', sizes: [ONE], required: false },
  screen: { layer: 'overlay', title: 'Full screen', about: 'Leaves and enters full screen. Hidden on phones that cannot do it.', sizes: [ONE], required: false },
};

export const isPicture = (kind: WidgetKind): boolean => WIDGET_SPECS[kind].layer === 'picture';
/** The whole screen: only the studio feed comes this large, and then it lies under everything. */
export const isFullScreen = (w: Pick<ScreenWidget, 'cols' | 'rows'>): boolean => w.cols === SCREEN_COLS && w.rows === SCREEN_ROWS;

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const overlap = (a: ScreenWidget, b: ScreenWidget) => a.col < b.col + b.cols && b.col < a.col + a.cols && a.row < b.row + b.rows && b.row < a.row + a.rows;
const ORDER = new Map<string, number>(WIDGET_KINDS.map((k, i) => [k, i]));
const sorted = (widgets: ScreenWidget[]) => [...widgets].sort((a, b) => (ORDER.get(a.kind) ?? 0) - (ORDER.get(b.kind) ?? 0));

/**
 * Why this widget cannot go there, in a few words, or null when it can. The same widget already on
 * the screen does not count: placing it again moves it.
 */
export function placementProblem(pattern: ScreenPattern, w: ScreenWidget): string | null {
  const spec = (WIDGET_SPECS as Record<string, WidgetSpec | undefined>)[w.kind];
  if (!spec) return 'not a widget';
  if (!spec.sizes.some((s) => s.cols === w.cols && s.rows === w.rows)) return 'not a size it comes in';
  if (!isInt(w.col) || !isInt(w.row) || w.col < 0 || w.row < 0 || w.col + w.cols > SCREEN_COLS || w.row + w.rows > SCREEN_ROWS) return 'outside the screen';
  if (spec.layer === 'picture' && !isFullScreen(w)) {
    const under = pattern.widgets.find((o) => o.kind !== w.kind && isPicture(o.kind) && !isFullScreen(o) && overlap(o, w));
    if (under) return `the ${WIDGET_SPECS[under.kind].title.toLowerCase()} is there`;
  }
  return null;
}

/** The pattern with this widget placed (or moved); the caller checked `placementProblem`. */
export function placeWidget(pattern: ScreenPattern, w: ScreenWidget): ScreenPattern {
  return { widgets: sorted([...pattern.widgets.filter((o) => o.kind !== w.kind), { kind: w.kind, col: w.col, row: w.row, cols: w.cols, rows: w.rows }]) };
}

/** The pattern without this widget; a required one stays. */
export function removeWidget(pattern: ScreenPattern, kind: WidgetKind): ScreenPattern {
  if (WIDGET_SPECS[kind].required) return pattern;
  return { widgets: pattern.widgets.filter((o) => o.kind !== kind) };
}

/** The first free place for a widget of this size, reading the screen like a page; null when there is none. */
export function firstPlace(pattern: ScreenPattern, kind: WidgetKind, size: Pick<WidgetSize, 'cols' | 'rows'>): ScreenWidget | null {
  for (let row = 0; row + size.rows <= SCREEN_ROWS; row++)
    for (let col = 0; col + size.cols <= SCREEN_COLS; col++) {
      const w: ScreenWidget = { kind, col, row, cols: size.cols, rows: size.rows };
      if (placementProblem(pattern, w) === null) return w;
    }
  return null;
}

/**
 * The station's own patterns. Alone: the studio feed full screen, the guest's own camera bottom left,
 * the buttons bottom right. In a group: the studio feed large at the top left, the own camera top
 * right, the buttons under it, the multiview along the bottom. The cue banner never covers the tally
 * or the buttons.
 */
export function defaultPattern(guests: number): ScreenPattern {
  const at = (kind: WidgetKind, col: number, row: number, cols = 1, rows = 1): ScreenWidget => ({ kind, col, row, cols, rows });
  if (guests <= 1) {
    return {
      widgets: sorted([at('studio', 0, 0, 3, 3), at('self', 0, 2), at('status', 0, 0), at('cue', 1, 0, 2), at('mic', 2, 2), at('hand', 2, 2), at('help', 2, 2), at('screen', 2, 2)]),
    };
  }
  return {
    widgets: sorted([at('studio', 0, 0, 2, 2), at('self', 2, 0), at('mv', 0, 2, 3), at('status', 0, 0), at('cue', 0, 1, 2), at('mic', 2, 1), at('hand', 2, 1), at('help', 2, 1), at('screen', 2, 1)]),
  };
}

export function defaultScreen(): GuestScreen {
  return { patterns: Array.from({ length: SCREEN_GUESTS }, (_, i) => defaultPattern(i + 1)) };
}

/**
 * A pattern as stored or sent, made safe: unknown or repeated widgets, wrong sizes, places outside
 * the screen and pictures on top of each other are dropped, and the tally is put back. Something
 * that is no pattern at all gives the station's own.
 */
export function normalizePattern(input: unknown, guests: number): ScreenPattern {
  const list = (input as { widgets?: unknown } | null | undefined)?.widgets;
  if (!Array.isArray(list)) return defaultPattern(guests);
  let out: ScreenPattern = { widgets: [] };
  for (const raw of list as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const kind = r['kind'];
    if (typeof kind !== 'string' || !(WIDGET_KINDS as readonly string[]).includes(kind)) continue;
    if (out.widgets.some((o) => o.kind === kind)) continue;
    const w = { kind: kind as WidgetKind, col: r['col'] as number, row: r['row'] as number, cols: r['cols'] as number, rows: r['rows'] as number };
    if (placementProblem(out, w) === null) out = placeWidget(out, w);
  }
  for (const kind of WIDGET_KINDS) {
    if (WIDGET_SPECS[kind].required && !out.widgets.some((o) => o.kind === kind)) out = placeWidget(out, { kind, col: 0, row: 0, cols: 1, rows: 1 });
  }
  return out;
}

/** Always eight patterns, each safe; anything missing is the station's own. */
export function normalizeScreen(input: unknown): GuestScreen {
  const patterns = (input as { patterns?: unknown } | null | undefined)?.patterns;
  const list = Array.isArray(patterns) ? (patterns as unknown[]) : [];
  return { patterns: Array.from({ length: SCREEN_GUESTS }, (_, i) => normalizePattern(list[i], i + 1)) };
}

/** The pattern for this many guests on the screen. */
export function patternFor(screen: GuestScreen, guests: number): ScreenPattern {
  const n = Math.min(SCREEN_GUESTS, Math.max(1, Math.floor(Number.isFinite(guests) ? guests : 1)));
  return screen.patterns[n - 1] ?? defaultPattern(n);
}

export function samePattern(a: ScreenPattern, b: ScreenPattern): boolean {
  return JSON.stringify(sorted(a.widgets)) === JSON.stringify(sorted(b.widgets));
}

/** Where an overlay sits inside its section: against the nearest edges of the screen; a wide one fills its width. */
export function dockOf(w: Pick<ScreenWidget, 'col' | 'row' | 'cols' | 'rows'>): { x: 'start' | 'center' | 'end' | 'stretch'; y: 'start' | 'center' | 'end' } {
  const side = (first: number, span: number, total: number): 'start' | 'center' | 'end' => {
    const mid = first + span / 2;
    return mid < total / 2 - 0.25 ? 'start' : mid > total / 2 + 0.25 ? 'end' : 'center';
  };
  return { x: w.cols > 1 ? 'stretch' : side(w.col, w.cols, SCREEN_COLS), y: side(w.row, w.rows, SCREEN_ROWS) };
}

/** Overlays docked in the same section stand side by side, in the order of `OVERLAY_KINDS`. */
export function overlayGroups(pattern: ScreenPattern): { col: number; row: number; cols: number; rows: number; widgets: ScreenWidget[] }[] {
  const groups = new Map<string, { col: number; row: number; cols: number; rows: number; widgets: ScreenWidget[] }>();
  for (const w of sorted(pattern.widgets)) {
    if (isPicture(w.kind)) continue;
    const key = `${w.col}:${w.row}:${w.cols}:${w.rows}`;
    const g = groups.get(key) ?? { col: w.col, row: w.row, cols: w.cols, rows: w.rows, widgets: [] };
    g.widgets.push(w);
    groups.set(key, g);
  }
  return [...groups.values()];
}

// ---- the multiview strip -------------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** More pictures than this would be too small to recognise on a phone. */
export const MAX_TILES = SCREEN_GUESTS;

/** The strip is never made wider than this: its pictures come from the guests' small copies. */
export const STRIP_MAX_WIDTH = 1280;

/**
 * The size of the multiview strip for a return picture of this size: the shape of its widget, three
 * sections wide and one high (16:3), as wide as the return but no wider than `STRIP_MAX_WIDTH`.
 * Even numbers.
 */
export function stripSize(width: number, height: number): { width: number; height: number } {
  // The screen is 16:9 whatever the return is: a row of three sections is 16 wide and 3 high.
  const fromHeight = Math.round((height * 16) / 9);
  const w = Math.max(96, Math.min(STRIP_MAX_WIDTH, Math.round(width), fromHeight > 0 ? fromHeight : Number.POSITIVE_INFINITY)) & ~1;
  return { width: w, height: Math.round((w * 3) / 16) & ~1 };
}

/**
 * Where one to eight 16:9 pictures go inside the panel: the grid that makes them largest, the whole
 * block centred, a shorter last row centred too. Even numbers throughout.
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
