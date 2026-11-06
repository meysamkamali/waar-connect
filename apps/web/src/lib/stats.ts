// Reads WebRTC statistics for one track into a short summary the pages can print.
// Works for a sending track (guest camera, studio return) and a receiving track (out page, monitor).

import type { LocalTrack, RemoteTrack } from 'livekit-client';

export type Path = 'direct' | 'relay' | 'tcp' | 'unknown';

export interface StatsSummary {
  kbps: number;
  lossPct: number;
  rttMs: number | undefined;
  jitterMs: number | undefined;
  /** Receive side only: average time frames waited in the jitter buffer over the last interval. */
  bufferMs: number | undefined;
  width: number | undefined;
  height: number | undefined;
  fps: number | undefined;
  codec: string | undefined;
  path: Path;
  /** Send side only: why the encoder is not at its target (cpu, bandwidth). */
  limited: string | undefined;
}

type Stat = Record<string, unknown>;

interface Snapshot {
  ts: number;
  bytes: number;
  lost: number;
  received: number;
  bufferDelay: number;
  bufferCount: number;
}

function num(s: Stat | undefined, key: string): number | undefined {
  const v = s?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(s: Stat | undefined, key: string): string | undefined {
  const v = s?.[key];
  return typeof v === 'string' ? v : undefined;
}

function codecName(codec: Stat | undefined): string | undefined {
  const mime = str(codec, 'mimeType');
  return mime ? mime.replace(/^(audio|video)\//, '').toLowerCase() : undefined;
}

export class TrackStats {
  #prev: Snapshot | undefined;

  constructor(
    private readonly track: LocalTrack | RemoteTrack,
    private readonly direction: 'send' | 'recv',
  ) {}

  async sample(): Promise<StatsSummary | undefined> {
    const report = await this.track.getRTCStatsReport();
    if (!report) return undefined;

    const all: Stat[] = [];
    report.forEach((s: Stat) => all.push(s));
    const byId = new Map<string, Stat>();
    for (const s of all) byId.set(String(s['id']), s);
    const kind: string = this.track.kind;

    // Selected ICE path: transport -> candidate pair -> local / remote candidate.
    const transport = all.find((s) => s['type'] === 'transport' && typeof s['selectedCandidatePairId'] === 'string');
    const pair =
      (transport ? byId.get(String(transport['selectedCandidatePairId'])) : undefined) ??
      all.find((s) => s['type'] === 'candidate-pair' && s['nominated'] === true && s['state'] === 'succeeded');
    const local = pair ? byId.get(String(pair['localCandidateId'])) : undefined;
    const remote = pair ? byId.get(String(pair['remoteCandidateId'])) : undefined;
    let path: Path = 'unknown';
    if (local) {
      if (str(local, 'candidateType') === 'relay' || str(remote, 'candidateType') === 'relay') path = 'relay';
      else if (str(local, 'protocol') === 'tcp') path = 'tcp';
      else path = 'direct';
    }
    const pairRtt = num(pair, 'currentRoundTripTime');

    const now = performance.now();
    let snap: Snapshot;
    let summary: Omit<StatsSummary, 'kbps' | 'lossPct' | 'bufferMs'>;

    if (this.direction === 'send') {
      const outs = all.filter((s) => s['type'] === 'outbound-rtp' && s['kind'] === kind);
      // Simulcast publishes several layers; report the biggest one and the total bitrate.
      const main = outs.reduce<Stat | undefined>(
        (best, s) => (!best || (num(s, 'bytesSent') ?? 0) > (num(best, 'bytesSent') ?? 0) ? s : best),
        undefined,
      );
      const remoteIn = main ? byId.get(String(main['remoteId'])) : undefined;
      const rtt = num(remoteIn, 'roundTripTime') ?? pairRtt;
      const limited = str(main, 'qualityLimitationReason');
      snap = {
        ts: now,
        bytes: outs.reduce((a, s) => a + (num(s, 'bytesSent') ?? 0), 0),
        lost: num(remoteIn, 'packetsLost') ?? 0,
        received: outs.reduce((a, s) => a + (num(s, 'packetsSent') ?? 0), 0),
        bufferDelay: 0,
        bufferCount: 0,
      };
      summary = {
        rttMs: rtt === undefined ? undefined : Math.round(rtt * 1000),
        jitterMs: undefined,
        width: num(main, 'frameWidth'),
        height: num(main, 'frameHeight'),
        fps: num(main, 'framesPerSecond'),
        codec: codecName(byId.get(String(main?.['codecId']))),
        path,
        limited: limited && limited !== 'none' ? limited : undefined,
      };
    } else {
      const inb = all.find((s) => s['type'] === 'inbound-rtp' && s['kind'] === kind);
      const jitter = num(inb, 'jitter');
      snap = {
        ts: now,
        bytes: num(inb, 'bytesReceived') ?? 0,
        lost: num(inb, 'packetsLost') ?? 0,
        received: num(inb, 'packetsReceived') ?? 0,
        bufferDelay: num(inb, 'jitterBufferDelay') ?? 0,
        bufferCount: num(inb, 'jitterBufferEmittedCount') ?? 0,
      };
      summary = {
        rttMs: pairRtt === undefined ? undefined : Math.round(pairRtt * 1000),
        jitterMs: jitter === undefined ? undefined : Math.round(jitter * 1000),
        width: num(inb, 'frameWidth'),
        height: num(inb, 'frameHeight'),
        fps: num(inb, 'framesPerSecond'),
        codec: codecName(byId.get(String(inb?.['codecId']))),
        path,
        limited: undefined,
      };
    }

    const prev = this.#prev;
    this.#prev = snap;
    if (!prev || snap.ts <= prev.ts) return { ...summary, kbps: 0, lossPct: 0, bufferMs: undefined };

    const seconds = (snap.ts - prev.ts) / 1000;
    const kbps = Math.max(0, Math.round(((snap.bytes - prev.bytes) * 8) / 1000 / seconds));
    const dLost = Math.max(0, snap.lost - prev.lost);
    const dRecv = Math.max(0, snap.received - prev.received);
    const lossPct = dLost + dRecv > 0 ? Math.round((dLost / (dLost + dRecv)) * 1000) / 10 : 0;
    const dCount = snap.bufferCount - prev.bufferCount;
    const bufferMs = dCount > 0 ? Math.round(((snap.bufferDelay - prev.bufferDelay) / dCount) * 1000) : undefined;
    return { ...summary, kbps, lossPct, bufferMs };
  }
}

export function formatSummary(label: string, s: StatsSummary | undefined): string {
  if (!s) return `${label.padEnd(5)} —`;
  const parts: string[] = [];
  if (s.width && s.height) parts.push(`${s.width}x${s.height}${s.fps ? `@${Math.round(s.fps)}` : ''}`);
  if (s.codec) parts.push(s.codec);
  parts.push(`${s.kbps} kbps`);
  parts.push(`loss ${s.lossPct}%`);
  if (s.rttMs !== undefined) parts.push(`rtt ${s.rttMs} ms`);
  if (s.jitterMs !== undefined) parts.push(`jitter ${s.jitterMs} ms`);
  if (s.bufferMs !== undefined) parts.push(`buffer ${s.bufferMs} ms`);
  parts.push(s.path);
  if (s.limited) parts.push(`limited: ${s.limited}`);
  return `${label.padEnd(5)} ${parts.join('  ')}`;
}
