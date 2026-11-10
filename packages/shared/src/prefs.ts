// Connection preferences the engineer sets per PCR: how a guest's phone should connect (which codec
// to try first, picture, bitrate) and how the producer's face camera is sent. Pure data and pure
// functions, shared by the API (validation, defaults) and the pages (applying them).
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

export const CODEC_NAMES = ['h264', 'vp8', 'vp9', 'av1', 'h265'] as const;
export type CodecName = (typeof CODEC_NAMES)[number];

export const CODEC_TITLES: Readonly<Record<CodecName, string>> = {
  h264: 'H.264',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  h265: 'H.265',
};

/**
 * What a device says about sending one codec: a hardware encoder, a software one, cannot send it,
 * said yes and then dropped it after publishing, or can send it but does not say how.
 */
export type CodecSupport = 'hw' | 'sw' | 'no' | 'failed' | 'unknown';

/** Which encoder a preference line accepts: hardware only, software only, or whichever the phone has. */
export const ENCODER_KINDS = ['hw', 'sw', 'any'] as const;
export type EncoderKind = (typeof ENCODER_KINDS)[number];

export const ENCODER_TITLES: Readonly<Record<EncoderKind, string>> = {
  hw: 'hardware',
  sw: 'software',
  any: 'any encoder',
};

export interface CodecChoice {
  codec: CodecName;
  encoder: EncoderKind;
}

export const DEGRADE_MODES = ['resolution', 'framerate', 'balanced'] as const;
/** When short: keep the picture size (drop frames), keep the frame rate (shrink), or let WebRTC balance. */
export type DegradeMode = (typeof DEGRADE_MODES)[number];

export const GUEST_HEIGHTS = [360, 540, 720, 1080] as const;
export const GUEST_RATES = [25, 30] as const;
export const GUEST_KBPS = { min: 400, max: 8000 } as const;
export const MAX_CODEC_CHOICES = 12;

/** How a guest's phone connects when the producer or engineer has pushed nothing else to it. */
export interface GuestPrefs {
  /** Tried from the top: the first line this phone can do is the codec it sends. */
  codecs: CodecChoice[];
  height: number;
  fps: number;
  /** Bitrate cap of the full-size picture, kbit/s. */
  kbps: number;
  degrade: DegradeMode;
}

/** The behaviour before preferences existed: H.264, with the hardware encoder when the phone has one. */
export const DEFAULT_GUEST_PREFS: Readonly<GuestPrefs> = {
  codecs: [
    { codec: 'h264', encoder: 'hw' },
    { codec: 'h264', encoder: 'any' },
  ],
  height: 720,
  fps: 25,
  kbps: 2500,
  degrade: 'resolution',
};

export const FACE_HEIGHTS = [180, 360, 540, 720] as const;
export const FACE_RATES = [15, 25, 30] as const;
export const FACE_KBPS = { min: 150, max: 4000 } as const;

/** The producer's face camera, the picture a guest sees in "face to face". */
export interface FacePrefs {
  height: number;
  fps: number;
  kbps: number;
}

export const DEFAULT_FACE_PREFS: Readonly<FacePrefs> = { height: 360, fps: 25, kbps: 600 };

function oneOf<T extends number>(allowed: readonly T[], value: unknown, fallback: number): number {
  return typeof value === 'number' && (allowed as readonly number[]).includes(value) ? value : fallback;
}

function within(range: { min: number; max: number }, value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, Math.round(value))) : fallback;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** A stored or posted value as valid preferences: bad lines dropped, repeats dropped, gaps filled with the defaults. */
export function normalizeGuestPrefs(input: unknown): GuestPrefs {
  const d = DEFAULT_GUEST_PREFS;
  const raw = isRecord(input) ? input : {};
  const seen = new Set<string>();
  const codecs: CodecChoice[] = [];
  for (const line of Array.isArray(raw['codecs']) ? raw['codecs'] : []) {
    if (!isRecord(line)) continue;
    const codec = line['codec'];
    const encoder = line['encoder'];
    if (!(CODEC_NAMES as readonly unknown[]).includes(codec) || !(ENCODER_KINDS as readonly unknown[]).includes(encoder)) continue;
    const key = `${String(codec)}/${String(encoder)}`;
    if (seen.has(key) || codecs.length >= MAX_CODEC_CHOICES) continue;
    seen.add(key);
    codecs.push({ codec: codec as CodecName, encoder: encoder as EncoderKind });
  }
  return {
    codecs: codecs.length ? codecs : d.codecs.map((c) => ({ ...c })),
    height: oneOf(GUEST_HEIGHTS, raw['height'], d.height),
    fps: oneOf(GUEST_RATES, raw['fps'], d.fps),
    kbps: within(GUEST_KBPS, raw['kbps'], d.kbps),
    degrade: (DEGRADE_MODES as readonly unknown[]).includes(raw['degrade']) ? (raw['degrade'] as DegradeMode) : d.degrade,
  };
}

export function normalizeFacePrefs(input: unknown): FacePrefs {
  const d = DEFAULT_FACE_PREFS;
  const raw = isRecord(input) ? input : {};
  return {
    height: oneOf(FACE_HEIGHTS, raw['height'], d.height),
    fps: oneOf(FACE_RATES, raw['fps'], d.fps),
    kbps: within(FACE_KBPS, raw['kbps'], d.kbps),
  };
}

/** Does this phone's answer for a codec satisfy a preference line? */
export function choiceMatches(choice: CodecChoice, support: CodecSupport | undefined): boolean {
  const s = support ?? 'unknown';
  if (s === 'no' || s === 'failed') return false;
  if (choice.encoder === 'hw') return s === 'hw';
  if (choice.encoder === 'sw') return s === 'sw';
  return true; // any: hardware, software, or a browser that can send it without saying how
}

/**
 * The codec a phone sends: the first preference line it can do, skipping codecs that already failed
 * in this tab. With nothing left, H.264 (every phone has it), or VP8 when even H.264 failed.
 * A line asking for hardware or software only matches a phone that says which one it has.
 */
export function pickCodec(
  codecs: readonly CodecChoice[],
  support: Readonly<Partial<Record<CodecName, CodecSupport>>> | undefined,
  failed: readonly CodecName[] = [],
): CodecName {
  const line = pickCodecLine(codecs, support, failed);
  if (line >= 0) return codecs[line]!.codec;
  const usable = (c: CodecName) => !failed.includes(c) && support?.[c] !== 'no' && support?.[c] !== 'failed';
  return usable('h264') ? 'h264' : usable('vp8') ? 'vp8' : 'h264';
}

/** Index of the preference line pickCodec takes, or -1 when none fits and the fallback is used. */
export function pickCodecLine(
  codecs: readonly CodecChoice[],
  support: Readonly<Partial<Record<CodecName, CodecSupport>>> | undefined,
  failed: readonly CodecName[] = [],
): number {
  return codecs.findIndex((choice) => !failed.includes(choice.codec) && choiceMatches(choice, support?.[choice.codec]));
}

export function describeChoice(c: CodecChoice): string {
  return `${CODEC_TITLES[c.codec]} ${ENCODER_TITLES[c.encoder]}`;
}
