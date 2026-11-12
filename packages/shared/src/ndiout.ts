// NDI out: every slot of a studio as an NDI source on the station's network, made by the gateway.
// The admin sets the picture's size and frame rate per studio: each either as it arrives from the
// guest, or fixed, so that the vision mixer's input keeps its format whatever a phone sends. A fixed
// frame rate may be interlaced: 50i is 25 frames a second, each of two fields.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

/** Fixed picture heights offered, 16:9. */
export const OUT_HEIGHTS = [1080, 720, 540] as const;
export type OutHeight = (typeof OUT_HEIGHTS)[number];

/** Fixed frame rates offered: the station is 50 Hz. `50i` is interlaced. */
export const OUT_RATES = ['25p', '50p', '50i'] as const;
export type OutRate = (typeof OUT_RATES)[number];

export interface NdiOutSettings {
  /** Every slot of the studio goes out as an NDI source. */
  on: boolean;
  /** Picture height; null: as it arrives from the guest. */
  height: OutHeight | null;
  /** Frame rate; null: as it arrives from the guest. */
  rate: OutRate | null;
}

/** A studio starts with the house format of a 50 Hz station. */
export const DEFAULT_NDI_OUT: NdiOutSettings = { on: true, height: 1080, rate: '50i' };

export function normalizeNdiOut(input: unknown): NdiOutSettings {
  const i = (input ?? {}) as Partial<Record<keyof NdiOutSettings, unknown>>;
  if (input === null || typeof input !== 'object') return { ...DEFAULT_NDI_OUT };
  return {
    on: typeof i.on === 'boolean' ? i.on : DEFAULT_NDI_OUT.on,
    height: i.height === null ? null : (OUT_HEIGHTS as readonly unknown[]).includes(i.height) ? (i.height as OutHeight) : DEFAULT_NDI_OUT.height,
    rate: i.rate === null ? null : (OUT_RATES as readonly unknown[]).includes(i.rate) ? (i.rate as OutRate) : DEFAULT_NDI_OUT.rate,
  };
}

export interface OutTiming {
  /** Frames a second as NDI states it: numerator and denominator. */
  fpsN: number;
  fpsD: number;
  /** Each frame carries two fields, the upper one first. */
  interlaced: boolean;
}

export function outTiming(rate: OutRate): OutTiming {
  switch (rate) {
    case '50p':
      return { fpsN: 50, fpsD: 1, interlaced: false };
    case '50i':
      return { fpsN: 25, fpsD: 1, interlaced: true };
    default:
      return { fpsN: 25, fpsD: 1, interlaced: false };
  }
}

/** A format as a broadcaster writes it: 1080i50, 720p25. */
export function formatLabel(height: number, rate: OutRate): string {
  return rate === '50i' ? `${height}i50` : `${height}p${rate === '50p' ? 50 : 25}`;
}

/** The setting in a few words, for the admin page. */
export function describeNdiOut(s: NdiOutSettings): string {
  if (!s.on) return 'off';
  if (s.height !== null && s.rate !== null) return formatLabel(s.height, s.rate);
  if (s.height === null && s.rate === null) return 'as the guest sends';
  if (s.height !== null) return `${s.height}p, frame rate as the guest sends`;
  return `size as the guest sends, ${s.rate === '50i' ? '50i' : s.rate}`;
}

/** The output's picture size for a fixed height: 16:9, even numbers. */
export function outSize(height: number): { width: number; height: number } {
  return { width: Math.round((height * 16) / 9 / 2) * 2, height };
}

const clean = (s: string) =>
  s
    .replace(/[()[\]{}<>"'`|\\/:;,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The NDI source name of each slot: the studio's name and the slot's output name, e.g. "PCR 1 Guest 1"
 * (NDI shows it as "MACHINE (PCR 1 Guest 1)"). Slots that would share a name get their number.
 */
export function ndiOutNames(pcrName: string, outputNames: readonly string[]): string[] {
  const base = outputNames.map((n, i) => clean(`${pcrName} ${n || `Guest ${i + 1}`}`).slice(0, 60) || `Slot ${i + 1}`);
  return base.map((name, i) => (base.filter((other) => other.toLowerCase() === name.toLowerCase()).length > 1 ? `${name} ${i + 1}` : name));
}

export const OUT_STATES = ['starting', 'slate', 'sending', 'error'] as const;
/**
 * starting: the output is coming up · slate: nobody sits on the slot, black goes out · sending: the
 * guest on the slot goes out · error: see detail.
 */
export type OutState = (typeof OUT_STATES)[number];

export interface OutputFeedStatus {
  pcrId: string;
  pcrName: string;
  slot: number;
  /** The NDI source name, without the machine. */
  name: string;
  state: OutState;
  detail: string | null;
  /** The output's participant is in the room. */
  connected: boolean;
  /** Identity of the guest that goes out, while one does. */
  guest: string | null;
  /** What arrives from the guest. */
  in: { width: number; height: number; fps: number } | null;
  /** What goes out, e.g. 1920x1080 as "1080i50". */
  out: { width: number; height: number; format: string } | null;
  /** How many NDI receivers are connected to this source. */
  receivers: number;
  since: number;
}
