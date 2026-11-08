// What a guest's phone reports about itself to the producer (data topic wc.report), and how the
// producer's card shows it in one line.
import type { StatsSummary } from './stats.ts';

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
  height?: number | undefined;
  fps?: number | undefined;
  codec: string;
  /** Bitrate cap in use, kbit/s. */
  kbps: number;
  relay: boolean;
  facing?: string | undefined;
  camera?: string | undefined;
  mic?: string | undefined;
  micOn: boolean;
  audio: { ec: boolean; ns: boolean; agc: boolean };
  net?: string | undefined;
  battery?: number | undefined;
  ua: string;
  error?: string | undefined;
}

export function describeReport(r: GuestReport): string {
  const parts = [
    r.height ? `${Math.round((r.height * 16) / 9)}x${r.height}@${r.fps ? Math.round(r.fps) : '?'}` : 'no camera',
    r.codec,
    `cap ${r.kbps} kbit/s`,
    r.relay ? 'via relay' : 'direct allowed',
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
