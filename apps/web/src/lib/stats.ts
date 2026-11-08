// Reads WebRTC statistics for one track into a short summary the pages can print.
// Works for a sending track (guest camera, studio return) and a receiving track (out page, monitor).

import type { LocalTrack, RemoteTrack } from 'livekit-client';

export type Path = 'direct' | 'relay' | 'tcp' | 'unknown';

/** One simulcast copy on the send side. */
export interface LayerStats {
  rid: string | undefined;
  width: number | undefined;
  height: number | undefined;
  fps: number | undefined;
  kbps: number;
  codec: string | undefined;
  /** VP9 and AV1 send one layered stream (SVC); this names its layer structure, e.g. L3T3_KEY. */
  mode: string | undefined;
}

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
  /** Send side only: every copy the encoder sends, biggest first; kbps 0 means that copy is paused. */
  layers?: LayerStats[] | undefined;
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
  #prevLayers = new Map<string, { ts: number; bytes: number }>();

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
      // Simulcast publishes several copies. Each gets its own bitrate; the biggest copy that is flowing
      // stands for the track (the busiest one so far on the first sample, before any rate is known).
      const rows = outs
        .map((s) => {
          const id = String(s['ssrc'] ?? s['id']);
          const bytes = num(s, 'bytesSent') ?? 0;
          const p = this.#prevLayers.get(id);
          this.#prevLayers.set(id, { ts: now, bytes });
          const kbps = p && now > p.ts ? Math.max(0, Math.round(((bytes - p.bytes) * 8) / (now - p.ts))) : 0;
          const layer: LayerStats = { rid: str(s, 'rid'), width: num(s, 'frameWidth'), height: num(s, 'frameHeight'), fps: num(s, 'framesPerSecond'), kbps, codec: codecName(byId.get(String(s['codecId']))), mode: str(s, 'scalabilityMode') };
          return { s, layer };
        })
        .sort((a, b) => (b.layer.height ?? 0) - (a.layer.height ?? 0));
      const mainRow =
        rows.find((r) => r.layer.kbps > 0) ??
        rows.reduce<(typeof rows)[number] | undefined>((best, r) => (!best || (num(r.s, 'bytesSent') ?? 0) > (num(best.s, 'bytesSent') ?? 0) ? r : best), undefined);
      const main = mainRow?.s;
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
        layers: rows.map((r) => r.layer),
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

const RID_NAMES: Record<string, string> = { f: 'full', h: 'half', q: 'quarter' };

function describeLayer(l: LayerStats): string {
  const name = l.height ? `${l.height}p` : l.rid ? (RID_NAMES[l.rid] ?? l.rid) : '?';
  return `${name} ${l.kbps > 0 ? l.kbps : 'off'}`;
}

export function formatSummary(label: string, s: StatsSummary | undefined): string {
  if (!s) return `${label.padEnd(5)} —`;
  const parts: string[] = [];
  if (s.width && s.height) parts.push(`${s.width}x${s.height}${s.fps ? `@${Math.round(s.fps)}` : ''}`);
  if (s.codec) parts.push(s.codec);
  const one = s.layers?.length === 1 ? s.layers[0] : undefined;
  parts.push(
    s.layers && s.layers.length > 1
      ? `${s.kbps} kbps (${s.layers.map(describeLayer).join(' · ')})`
      : one?.mode && one.mode !== 'L1T1'
        ? `${s.kbps} kbps (one layered stream ${one.mode}: the sizes are inside it)`
        : `${s.kbps} kbps`,
  );
  parts.push(`loss ${s.lossPct}%`);
  if (s.rttMs !== undefined) parts.push(`rtt ${s.rttMs} ms`);
  if (s.jitterMs !== undefined) parts.push(`jitter ${s.jitterMs} ms`);
  if (s.bufferMs !== undefined) parts.push(`buffer ${s.bufferMs} ms`);
  parts.push(s.path);
  if (s.limited) parts.push(`limited: ${s.limited}`);
  return `${label.padEnd(5)} ${parts.join('  ')}`;
}
