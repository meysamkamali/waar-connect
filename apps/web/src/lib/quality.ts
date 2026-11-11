// How a guest's line and picture are doing, as the engineer needs it: a handful of meters, each a
// bar with a number and a colour, and one verdict for the guest. Pure functions over the numbers the
// phone measures on its way out (lib/stats.ts, sent every two seconds) and the numbers this desk
// measures on the way in. The thresholds are the ones the bandwidth test already uses: loss under 2 %
// and a round trip under 400 ms pass.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { smallCopyCeiling } from './copies.ts';
import type { StatsSummary } from './stats.ts';

/** ok: fine · warn: watch it · bad: not fit for air · none: no number to judge. */
export type Tone = 'ok' | 'warn' | 'bad' | 'none';

export type MeterKey = 'line' | 'bitrate' | 'size' | 'frames' | 'loss' | 'rtt' | 'delay';

export interface Meter {
  key: MeterKey;
  label: string;
  /** How much of the bar is filled, 0 to 1. */
  fill: number;
  tone: Tone;
  /** The number in words, e.g. "1850 of 2500 kbit/s". */
  text: string;
  /** What the meter means and where its number comes from. */
  hint: string;
  /** What holds the number back, in a few words, when something does. */
  note?: string | undefined;
  /** One word for the meter's flag instead of "watch" or "bad", e.g. the cause. */
  flag?: string | undefined;
  /** Where the limits sit on the bar, 0 to 1. */
  marks?: readonly number[] | undefined;
}

/** The meters as the engineer reads them: the line first, then the picture. */
export const METER_GROUPS: readonly { key: 'line' | 'picture'; label: string; meters: readonly MeterKey[] }[] = [
  { key: 'line', label: 'Line', meters: ['line', 'loss', 'rtt', 'delay'] },
  { key: 'picture', label: 'Picture', meters: ['bitrate', 'size', 'frames'] },
];

export interface QualityInput {
  /** LiveKit's own word on the phone's connection: excellent, good, poor, lost. */
  line?: string | undefined;
  /** What the phone sends, measured on the phone. */
  up?: StatsSummary | undefined;
  /** Bitrate cap of the full-size picture, kbit/s. */
  capKbps?: number | undefined;
  /** Picture height the camera delivers; the encoder shrinking below it shows trouble. */
  cameraHeight?: number | undefined;
  /** Frame rate asked of the phone. */
  askedFps?: number | undefined;
  /** What arrives at this desk for the guest's picture. */
  recv?: StatsSummary | undefined;
  /** How old the phone's numbers are, in ms. Old numbers are shown but not judged. */
  ageMs?: number | undefined;
}

/** One copy the phone sends of its picture: the full-size one, or a small one beside it. */
export interface Copy {
  /** The copy by its size, "1080p" (the short side); its name on the wire while it has no size. */
  name: string;
  /** What it sends right now, kbit/s; 0 while it is paused. */
  kbps: number;
  /** The most it may send, kbit/s: the cap for the full-size copy, its own ceiling for a small one. */
  ceilingKbps: number | undefined;
  /** How much of the bar is filled, 0 to 1: what it sends of what it may. */
  fill: number;
  fps: number | undefined;
  /** The full-size copy. */
  full: boolean;
  /** Paused: nobody takes this copy, or the line is too short for it. */
  paused: boolean;
}

export interface Quality {
  /** Every copy the phone sends, largest first, when it sends more than one. */
  copies: Copy[];
  meters: Meter[];
  /** The worst meter decides. */
  tone: Tone;
  /** What is wrong, worst first, in a few words each. Empty when all is well. */
  reasons: string[];
  /** The phone has not sent numbers lately. */
  stale: boolean;
}

export const LIMITS = {
  /** Uplink packet loss, percent. */
  loss: { warn: 0.5, bad: 2, full: 5 },
  /** Round trip phone to media server, ms. */
  rtt: { warn: 150, bad: 400, full: 500 },
  /** Picture delay to this desk (half the round trip plus the receive buffer here), ms. */
  delay: { warn: 300, bad: 600, full: 800 },
  /** Share of the camera's height that is sent. */
  size: { warn: 0.99, bad: 0.6 },
  /** Share of the asked frame rate that is sent. */
  frames: { warn: 0.85, bad: 0.6 },
  /** Bitrate held back by the network: under this share of the cap it is bad. */
  bitrateBad: 0.4,
  /** Numbers older than this are not judged. */
  staleMs: 8000,
} as const;

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const RANK: Record<Tone, number> = { none: 0, ok: 1, warn: 2, bad: 3 };
const worst = (a: Tone, b: Tone): Tone => (RANK[b] > RANK[a] ? b : a);

/** Lower is better: under `warn` fine, under `bad` to be watched. */
function rising(value: number, limit: { warn: number; bad: number }): Tone {
  return value < limit.warn ? 'ok' : value < limit.bad ? 'warn' : 'bad';
}
/** Higher is better: from `warn` up fine, from `bad` up to be watched. */
function falling(value: number, limit: { warn: number; bad: number }): Tone {
  return value >= limit.warn ? 'ok' : value >= limit.bad ? 'warn' : 'bad';
}

const none = (key: MeterKey, label: string, hint: string): Meter => ({ key, label, fill: 0, tone: 'none', text: 'no number', hint });

/** The full-size copy's own bitrate: with simulcast the total also counts the small copies. */
export function mainKbps(up: StatsSummary): number {
  const flowing = up.layers?.find((l) => l.kbps > 0);
  return flowing ? flowing.kbps : up.kbps;
}

export function assess(input: QualityInput): Quality {
  const { up, recv } = input;
  const stale = up === undefined || (input.ageMs !== undefined && input.ageMs > LIMITS.staleMs);
  const meters: Meter[] = [];
  const reasons: { tone: Tone; text: string }[] = [];
  const add = (m: Meter, reason?: string) => {
    // numbers that are no longer fresh are shown, greyed, and not judged
    const shown = stale && m.key !== 'delay' ? { ...m, tone: 'none' as Tone } : m;
    meters.push(shown);
    if (reason && (shown.tone === 'warn' || shown.tone === 'bad')) reasons.push({ tone: shown.tone, text: reason });
  };

  // Line: the media server's own verdict on the connection.
  const lineHint = "The media server's own verdict on this phone's connection";
  const line = input.line;
  if (line === 'excellent' || line === 'good' || line === 'poor' || line === 'lost') {
    const tone: Tone = line === 'poor' ? 'warn' : line === 'lost' ? 'bad' : 'ok';
    add({ key: 'line', label: 'Connection', fill: line === 'excellent' ? 1 : line === 'good' ? 0.66 : line === 'poor' ? 0.33 : 0.04, tone, text: line, hint: lineHint }, `line ${line}`);
  } else add(none('line', 'Connection', lineHint));

  // Bitrate: what the full-size picture really sends, against its cap. Low alone is not a fault (a still
  // picture needs little); low because the network or the phone holds it back is.
  const bitrateHint = 'What the full-size picture sends, against its cap. Low is only a fault when the network or the phone holds it back';
  if (up && input.capKbps) {
    const sent = mainKbps(up);
    const share = sent / input.capKbps;
    const held = up.limited === 'bandwidth' ? 'the network' : up.limited === 'cpu' ? "the phone's processor" : null;
    const tone: Tone = !held ? 'ok' : up.limited === 'bandwidth' && share < LIMITS.bitrateBad ? 'bad' : 'warn';
    add(
      {
        key: 'bitrate',
        label: 'Bitrate',
        fill: clamp01(share),
        tone,
        text: `${sent} of ${input.capKbps} kbit/s`,
        hint: bitrateHint,
        note: held ? `held back by ${held}` : undefined,
        flag: up.limited === 'bandwidth' ? 'network' : up.limited === 'cpu' ? 'phone' : undefined,
      },
      held ? `bitrate held back by ${held}` : undefined,
    );
  } else if (up) add({ key: 'bitrate', label: 'Bitrate', fill: 0, tone: 'none', text: `${mainKbps(up)} kbit/s`, hint: bitrateHint });
  else add(none('bitrate', 'Bitrate', bitrateHint));

  // Picture size: the encoder shrinks the picture when it cannot keep up.
  const sizeHint = 'The picture size sent, against what the camera delivers. The encoder shrinks it when the line or the phone cannot keep up';
  // The short side names a picture (720p), whichever way the phone is held.
  const sentSize = up?.height ? (up.width ? Math.min(up.width, up.height) : up.height) : undefined;
  if (sentSize && input.cameraHeight) {
    const share = sentSize / input.cameraHeight;
    add(
      { key: 'size', label: 'Resolution', fill: clamp01(share), tone: falling(share, LIMITS.size), text: `${sentSize}p of ${input.cameraHeight}p`, hint: sizeHint, marks: [LIMITS.size.bad] },
      `picture shrunk to ${sentSize}p`,
    );
  } else if (sentSize) add({ key: 'size', label: 'Resolution', fill: 1, tone: 'none', text: `${sentSize}p`, hint: sizeHint });
  else add(none('size', 'Resolution', sizeHint));

  // Frame rate.
  const framesHint = 'Frames a second sent, against what was asked of the phone';
  if (up?.fps !== undefined && input.askedFps) {
    const fps = Math.round(up.fps);
    const share = up.fps / input.askedFps;
    add(
      { key: 'frames', label: 'Frame rate', fill: clamp01(share), tone: falling(share, LIMITS.frames), text: `${fps} of ${input.askedFps} fps`, hint: framesHint, marks: [LIMITS.frames.bad, LIMITS.frames.warn] },
      `only ${fps} frames a second`,
    );
  } else add(none('frames', 'Frame rate', framesHint));

  // Packet loss on the way up.
  const lossHint = 'Packets lost between the phone and the media server. Under 0.5 % is clean, from 2 % the picture breaks';
  if (up) {
    add(
      {
        key: 'loss',
        label: 'Packet loss',
        fill: clamp01(up.lossPct / LIMITS.loss.full),
        tone: rising(up.lossPct, LIMITS.loss),
        text: `${up.lossPct.toFixed(1)} %`,
        hint: lossHint,
        marks: [LIMITS.loss.warn / LIMITS.loss.full, LIMITS.loss.bad / LIMITS.loss.full],
      },
      `packet loss ${up.lossPct.toFixed(1)} %`,
    );
  } else add(none('loss', 'Packet loss', lossHint));

  // Network delay: the round trip between the phone and the media server.
  const rttHint = 'Round trip between the phone and the media server. Under 150 ms is good, from 400 ms a conversation suffers';
  if (up?.rttMs !== undefined) {
    add(
      {
        key: 'rtt',
        label: 'Network delay',
        fill: clamp01(up.rttMs / LIMITS.rtt.full),
        tone: rising(up.rttMs, LIMITS.rtt),
        text: `${up.rttMs} ms`,
        hint: rttHint,
        marks: [LIMITS.rtt.warn / LIMITS.rtt.full, LIMITS.rtt.bad / LIMITS.rtt.full],
      },
      `network delay ${up.rttMs} ms`,
    );
  } else add(none('rtt', 'Network delay', rttHint));

  // Delay to this desk: the phone's one-way trip plus the time frames wait in the receive buffer here.
  const delayHint = "About how late the picture is at this desk: half the phone's round trip plus the receive buffer here. Capture, encode and decode come on top";
  if (recv?.bufferMs !== undefined) {
    const oneWay = up?.rttMs !== undefined ? up.rttMs / 2 : 0;
    const delay = Math.round(oneWay + recv.bufferMs);
    add(
      {
        key: 'delay',
        label: 'Delay here',
        fill: clamp01(delay / LIMITS.delay.full),
        tone: rising(delay, LIMITS.delay),
        text: `about ${delay} ms`,
        hint: delayHint,
        marks: [LIMITS.delay.warn / LIMITS.delay.full, LIMITS.delay.bad / LIMITS.delay.full],
      },
      `delay here about ${delay} ms`,
    );
  } else add(none('delay', 'Delay here', delayHint));

  reasons.sort((a, b) => RANK[b.tone] - RANK[a.tone]);
  return { copies: copiesOf(up, input.capKbps), meters, tone: toneOf(meters), reasons: reasons.map((r) => r.text), stale };
}

const WIRE_NAMES: Readonly<Record<string, string>> = { f: 'full', h: 'half', q: 'quarter' };

/**
 * The copies the phone sends of its picture, largest first, each with its bitrate against what it may
 * send. Empty when there is one stream only: the meters say everything about that one.
 */
export function copiesOf(up: StatsSummary | undefined, capKbps: number | undefined): Copy[] {
  const layers = up?.layers;
  if (!layers || layers.length < 2) return [];
  return layers.map((l, i) => {
    const short = l.width && l.height ? Math.min(l.width, l.height) : l.height;
    const small = i > 0 && l.rid && capKbps ? smallCopyCeiling(l.rid, capKbps) : undefined;
    const ceilingKbps = i === 0 ? capKbps : small !== undefined ? Math.round(small / 1000) : undefined;
    return {
      name: short ? `${short}p` : l.rid ? (WIRE_NAMES[l.rid] ?? l.rid) : 'copy',
      kbps: l.kbps,
      ceilingKbps,
      fill: ceilingKbps ? clamp01(l.kbps / ceilingKbps) : 0,
      fps: l.fps,
      full: i === 0,
      paused: l.kbps === 0,
    };
  });
}

/** The worst meter of a set decides its colour. */
export function toneOf(meters: readonly Meter[]): Tone {
  return meters.reduce<Tone>((t, m) => worst(t, m.tone), 'none');
}

/** One word for the verdict, for the row's badge. */
export function verdictWord(q: Quality): string {
  if (q.stale) return 'No fresh numbers';
  return q.tone === 'bad' ? 'Problem' : q.tone === 'warn' ? 'Watch' : q.tone === 'ok' ? 'Good' : 'No numbers yet';
}
