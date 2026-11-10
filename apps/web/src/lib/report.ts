// What a guest's phone reports about itself to the producer (data topic wc.report), and how the
// producer's card shows it in one line.
import type { DegradeMode } from '@waar-connect/shared';
import type { CameraControls, CameraState } from './camera.ts';
import type { CodecName, CodecSupport } from './codecs.ts';
import type { StatsSummary } from './stats.ts';

/** When short: keep the picture size (drop frames), keep the frame rate (shrink), or let WebRTC balance. */
export type Degrade = DegradeMode;
export const DEGRADE_DEFAULT: Degrade = 'resolution';
export const DEGRADE_LABELS: Readonly<Record<Degrade, string>> = {
  resolution: 'keep picture size',
  framerate: 'keep frame rate',
  balanced: 'balanced',
};

/** One step of the bandwidth sweep, measured on the phone. */
export interface TestStep {
  /** Cap the phone was given, kbit/s. */
  target: number;
  /** What it really sent on average, kbit/s. */
  kbps: number;
  rttMs: number | undefined;
  rttMaxMs: number | undefined;
  lossPct: number;
  fps: number | undefined;
  limited: string | undefined;
  /** Loss under 2 %, round trip under 400 ms and at least 70 % of the target sent. */
  ok: boolean;
}

export interface SweepResult {
  running: boolean;
  /** Index of the step being measured while running. */
  step: number;
  steps: number[];
  results: TestStep[];
  at: number;
}

export const SWEEP_STEPS = [400, 800, 1500, 2500, 4000];

/** The highest cap that passed, as long as every lower step passed too. */
export function recommendedCap(sweep: SweepResult | undefined): number | undefined {
  if (!sweep || sweep.running || sweep.results.length === 0) return undefined;
  let best: number | undefined;
  for (const r of sweep.results) {
    if (!r.ok) break;
    best = r.target;
  }
  return best;
}

export interface GuestReport {
  at: number;
  /** Build id of the page running on the phone. */
  build?: string | undefined;
  /** The last or running bandwidth sweep. */
  test?: SweepResult | undefined;
  quality: string;
  /** Send-side numbers measured on the phone. */
  up?: StatsSummary | undefined;
  width?: number | undefined;
  height?: number | undefined;
  fps?: number | undefined;
  /** Codec the producer asked for. */
  codec: string;
  /** Where that codec came from: pushed to this phone, the page address, or a line of the studio's order. */
  why?: string | undefined;
  /** Codec actually on the wire, from the sender statistics; differs when the browser switched. */
  wire?: string | undefined;
  /** Bitrate cap in use, kbit/s. */
  kbps: number;
  relay: boolean;
  /** False when only the full-size copy is sent (small simulcast copies switched off). */
  small?: boolean | undefined;
  facing?: string | undefined;
  camera?: string | undefined;
  /** The exposure, white balance, focus, zoom and torch controls this camera offers, and where they stand. Missing: none offered. */
  cam?: { can: CameraControls; now: CameraState } | undefined;
  mic?: string | undefined;
  micOn: boolean;
  audio: { ec: boolean; ns: boolean; agc: boolean };
  /** What the encoder gives up first when the network or CPU is short. */
  degrade: Degrade;
  /** What this device can send, per codec, probed once on join. */
  codecs?: Partial<Record<CodecName, CodecSupport>> | undefined;
  net?: string | undefined;
  battery?: number | undefined;
  ua: string;
  error?: string | undefined;
}

export function describeReport(r: GuestReport): string {
  const parts = [
    r.height ? `${r.width ?? Math.round((r.height * 16) / 9)}x${r.height}@${r.fps ? Math.round(r.fps) : '?'}` : 'no camera',
    r.wire && r.wire !== r.codec ? `${r.codec} asked, ${r.wire} on the wire` : r.codec,
    r.why ? `(${r.why})` : null,
    `cap ${r.kbps} kbit/s`,
    r.relay ? 'via relay' : 'direct allowed',
    r.small === false ? 'full copy only' : null,
    r.net ? `net ${r.net}` : null,
    r.battery !== undefined ? `battery ${r.battery}%` : null,
    r.facing ? `camera ${r.facing === 'environment' ? 'back' : 'front'}` : null,
    r.micOn ? 'mic on' : 'mic muted',
    r.audio.ec || r.audio.ns || r.audio.agc ? 'voice processing on' : 'voice processing off',
  ];
  return parts.filter((p): p is string => p !== null).join(' · ');
}

export function phoneModel(ua: string): string {
  const m = ua.match(/\(([^)]+)\)/);
  if (!m?.[1]) return ua.slice(0, 40);
  const inside = m[1];
  if (/iPhone/.test(inside)) return `iPhone, iOS ${inside.match(/OS (\d+[_\d]*)/)?.[1]?.replace(/_/g, '.') ?? ''}`.trim();
  if (/Android/.test(inside)) return inside.split(';').slice(1, 3).join(',').trim();
  return inside.split(';')[0]?.trim() ?? inside;
}
