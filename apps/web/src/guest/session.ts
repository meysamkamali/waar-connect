// The guest's LiveKit session as signals: place and tally from the server's attributes, the tracks
// the server lets through, cues and commands over the data channel, and the local camera and mic.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { computed, signal } from '@preact/signals';
import { defaultGuestState, guestFromAttributes, roleOf, STUDIO_IDENTITY, type GuestState } from '@waar-connect/shared';
import {
  ConnectionState,
  DisconnectReason,
  RoomEvent,
  Track,
  VideoQuality,
  type LocalVideoTrack,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
  type Room,
} from 'livekit-client';
import type { JoinInfo } from '../api.ts';
import { isCodecName, probeCodecs, type CodecName, type CodecSupport } from '../lib/codecs.ts';
import { DEGRADE_DEFAULT, SWEEP_STEPS, type Degrade, type GuestReport, type SweepResult, type TestStep } from '../lib/report.ts';
import { connectRoom, createRoom, profileFromParams, qualityLabel, type PublishProfile } from '../lib/room.ts';
import { TrackStats, type StatsSummary } from '../lib/stats.ts';
import { BUILD } from '../lib/version.ts';

// Settings the producer pushed to this phone; they survive a reload of the same tab.
const OVERRIDE_KEY = 'wc.guest.override';
export interface GuestOverride {
  res?: number;
  fps?: number;
  kbps?: number;
  codec?: CodecName;
  relay?: boolean;
  facing?: 'user' | 'environment';
  audio?: { ec: boolean; ns: boolean; agc: boolean };
  degrade?: Degrade;
}
const DEGRADES: readonly Degrade[] = ['resolution', 'framerate', 'balanced'];
const toPreference = (d: Degrade): RTCDegradationPreference => (d === 'resolution' ? 'maintain-resolution' : d === 'framerate' ? 'maintain-framerate' : 'balanced');
function loadOverride(): GuestOverride {
  try {
    return JSON.parse(sessionStorage.getItem(OVERRIDE_KEY) ?? '{}') as GuestOverride;
  } catch {
    return {};
  }
}
function saveOverride(patch: GuestOverride): GuestOverride {
  const next = { ...loadOverride(), ...patch };
  try {
    sessionStorage.setItem(OVERRIDE_KEY, JSON.stringify(next));
  } catch {
    // fine without
  }
  return next;
}
const HEIGHTS = [360, 540, 720, 1080];
const RATES = [25, 30];

function summarizeStep(target: number, samples: StatsSummary[]): TestStep {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const kbps = Math.round(avg(samples.map((s) => s.kbps)));
  const rtts = samples.map((s) => s.rttMs).filter((x): x is number => x !== undefined);
  const rttMs = rtts.length ? Math.round(avg(rtts)) : undefined;
  const rttMaxMs = rtts.length ? Math.max(...rtts) : undefined;
  const lossPct = Math.round(avg(samples.map((s) => s.lossPct)) * 10) / 10;
  const fpsList = samples.map((s) => s.fps).filter((x): x is number => x !== undefined);
  const fps = fpsList.length ? Math.round(avg(fpsList)) : undefined;
  const reasons = samples.map((s) => s.limited).filter((x): x is string => x !== undefined);
  const limited = reasons.length ? reasons.sort((a, b) => reasons.filter((r) => r === b).length - reasons.filter((r) => r === a).length)[0] : undefined;
  const ok = samples.length > 0 && lossPct < 2 && (rttMs ?? 0) < 400 && kbps >= target * 0.7;
  return { target, kbps, rttMs, rttMaxMs, lossPct, fps, limited, ok };
}

export type Status = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'removed';

export interface Cue {
  text: string;
  from: string;
  at: number;
}

export interface VideoTile {
  identity: string;
  name: string;
  track: RemoteVideoTrack;
}

export interface DeviceChoice {
  videoDeviceId?: string;
  audioDeviceId?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class GuestSession {
  readonly room: Room;
  readonly state = signal<GuestState>(defaultGuestState(''));
  readonly status = signal<Status>('idle');
  readonly error = signal<string | null>(null);
  readonly quality = signal('unknown');
  readonly up = signal<StatsSummary | undefined>(undefined);
  readonly cue = signal<Cue | null>(null);
  readonly handRaised = signal(false);
  readonly micEnabled = signal(true);
  readonly localVideo = signal<LocalVideoTrack | null>(null);
  readonly programVideo = signal<RemoteVideoTrack | null>(null);
  readonly faceVideo = signal<RemoteVideoTrack | null>(null);
  readonly guestVideos = signal<VideoTile[]>([]);
  readonly audioTracks = signal<RemoteAudioTrack[]>([]);
  /** What fills the screen: the producer's face when they come face to face, otherwise the program. */
  readonly mainVideo = computed(() => this.faceVideo.value ?? this.programVideo.value);

  #upStats: TrackStats | undefined;
  #timer: number | undefined;
  #reportTimer: number | undefined;
  #profile: PublishProfile;
  #relay: boolean;
  #override: GuestOverride;
  #lastError: string | undefined;
  #sweep: SweepResult | undefined;
  #sweeping = false;
  #codecs: Partial<Record<CodecName, CodecSupport>> | undefined;

  constructor() {
    const params = new URLSearchParams(location.search);
    this.#override = loadOverride();
    const o = this.#override;
    if (o.res) params.set('res', String(o.res));
    if (o.fps) params.set('fps', String(o.fps));
    if (o.kbps) params.set('kbps', String(o.kbps));
    if (o.codec) params.set('codec', o.codec);
    if (o.relay !== undefined) params.set('relay', o.relay ? '1' : '0');
    this.#profile = profileFromParams(params);
    this.#relay = params.get('relay') === '1';
    this.room = createRoom(this.#profile);
    this.room
      .on(RoomEvent.ConnectionStateChanged, (s) => {
        if (s === ConnectionState.Connected) this.status.value = 'connected';
        else if (s === ConnectionState.Connecting) this.status.value = 'connecting';
        else if (s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting) this.status.value = 'reconnecting';
      })
      .on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
        if (participant.isLocal) this.#readState();
      })
      .on(RoomEvent.TrackSubscribed, (track, pub, participant) => this.#onTrack(track, pub, participant))
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => this.#offTrack(track, participant))
      .on(RoomEvent.ConnectionQualityChanged, (q, participant) => {
        if (participant.isLocal) this.quality.value = qualityLabel(q);
      })
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => this.#onData(payload, participant, topic))
      .on(RoomEvent.Disconnected, (reason) => {
        this.status.value = reason === DisconnectReason.PARTICIPANT_REMOVED || reason === DisconnectReason.ROOM_DELETED ? 'removed' : 'disconnected';
      })
      .on(RoomEvent.MediaDevicesError, (err) => {
        this.error.value = err.message;
      });
  }

  async connect(info: JoinInfo, devices: DeviceChoice): Promise<void> {
    this.status.value = 'connecting';
    this.state.value = defaultGuestState(info.livekit.identity);
    try {
      await connectRoom(this.room, info.livekit.url, info.livekit.token, this.#relay);
    } catch (err) {
      if (!this.#relay) throw err;
      // "Force relay" needs the station's TURN server reachable from this network. When it is not, the
      // phone must not stay locked out of the room: drop the setting, tell the producer, connect normally.
      this.#lastError = `forced relay did not connect (${err instanceof Error ? err.message : String(err)}); went back to direct`;
      this.#relay = false;
      this.#override = saveOverride({ relay: false });
      this.status.value = 'connecting';
      await connectRoom(this.room, info.livekit.url, info.livekit.token, false);
    }
    this.#readState();
    const lp = this.room.localParticipant;
    const o = this.#override;
    await lp.setCameraEnabled(true, { ...(devices.videoDeviceId && !o.facing ? { deviceId: devices.videoDeviceId } : {}), ...(o.facing ? { facingMode: o.facing } : {}) });
    const a = o.audio ?? { ec: true, ns: true, agc: true };
    await lp.setMicrophoneEnabled(true, { ...(devices.audioDeviceId ? { deviceId: devices.audioDeviceId } : {}), echoCancellation: a.ec, noiseSuppression: a.ns, autoGainControl: a.agc });
    const cam = lp.getTrackPublication(Track.Source.Camera)?.videoTrack ?? null;
    this.localVideo.value = cam;
    this.#upStats = cam ? new TrackStats(cam, 'send') : undefined;
    if (o.kbps) await this.#setMaxBitrate(o.kbps).catch(() => undefined);
    await cam?.setDegradationPreference(toPreference(o.degrade ?? DEGRADE_DEFAULT)).catch(() => undefined);
    await this.room.startAudio().catch(() => undefined);
    this.#timer = window.setInterval(() => void this.#sample(), 2000);
    this.#reportTimer = window.setInterval(() => void this.#report(), 10_000);
    void probeCodecs().then((c) => {
      this.#codecs = c;
      return this.#report();
    });
  }

  async setMic(on: boolean): Promise<void> {
    await this.room.localParticipant.setMicrophoneEnabled(on);
    this.micEnabled.value = on;
  }

  async raiseHand(on: boolean): Promise<void> {
    this.handRaised.value = on;
    await this.#send('wc.hand', { on });
  }

  async askHelp(): Promise<void> {
    await this.#send('wc.help', {});
  }

  dismissCue(): void {
    this.cue.value = null;
  }

  /** Call once from a tap: browsers only start audio after a user gesture. */
  async unlockAudio(): Promise<void> {
    await this.room.startAudio().catch(() => undefined);
  }

  async leave(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#reportTimer) clearInterval(this.#reportTimer);
    await this.room.disconnect();
  }

  #readState(): void {
    const lp = this.room.localParticipant;
    this.state.value = guestFromAttributes(lp.identity, lp.attributes);
  }

  #onTrack(track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant): void {
    if (track.kind === Track.Kind.Audio) {
      this.audioTracks.value = [...this.audioTracks.value, track as RemoteAudioTrack];
      return;
    }
    if (track.kind !== Track.Kind.Video) return;
    const video = track as RemoteVideoTrack;
    const role = roleOf(participant.identity);
    if (participant.identity === STUDIO_IDENTITY) {
      this.programVideo.value = video;
      pub.setVideoQuality(VideoQuality.HIGH);
    } else if (role === 'producer' || role === 'engineer') {
      this.faceVideo.value = video;
      pub.setVideoQuality(VideoQuality.MEDIUM);
    } else if (role === 'guest') {
      this.guestVideos.value = [
        ...this.guestVideos.value.filter((tile) => tile.identity !== participant.identity),
        { identity: participant.identity, name: participant.name || participant.identity, track: video },
      ];
      pub.setVideoQuality(VideoQuality.LOW);
    }
  }

  #offTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    if (track.kind === Track.Kind.Audio) {
      this.audioTracks.value = this.audioTracks.value.filter((t) => t.sid !== track.sid);
      return;
    }
    if (this.programVideo.value?.sid === track.sid) this.programVideo.value = null;
    if (this.faceVideo.value?.sid === track.sid) this.faceVideo.value = null;
    this.guestVideos.value = this.guestVideos.value.filter((tile) => tile.identity !== participant.identity || tile.track.sid !== track.sid);
  }

  #onData(payload: Uint8Array, participant: RemoteParticipant | undefined, topic: string | undefined): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(decoder.decode(payload)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (topic === 'wc.cue' && typeof message['text'] === 'string') {
      this.cue.value = { text: message['text'], from: participant?.name ?? '', at: Date.now() };
    } else if (topic === 'wc.cmd') {
      void this.#command(message);
    }
  }

  /** Settings pushed by the producer. Codec and relay need a new connection, so those reload the page. */
  async #command(cmd: Record<string, unknown>): Promise<void> {
    try {
      if (cmd['mute'] === true) await this.setMic(false);
      if (cmd['mute'] === false) await this.setMic(true);
      const res = typeof cmd['res'] === 'number' ? cmd['res'] : typeof cmd['quality'] === 'string' ? Number.parseInt(cmd['quality'], 10) : undefined;
      const fps = typeof cmd['fps'] === 'number' ? cmd['fps'] : undefined;
      if ((res !== undefined && HEIGHTS.includes(res)) || (fps !== undefined && RATES.includes(fps))) {
        const height = res !== undefined && HEIGHTS.includes(res) ? res : this.#profile.height;
        const rate = fps !== undefined && RATES.includes(fps) ? fps : this.#profile.fps;
        this.#profile = { ...this.#profile, height, fps: rate };
        this.#override = saveOverride({ res: height, fps: rate });
        await this.localVideo.value?.restartTrack({ resolution: { width: Math.round((height * 16) / 9), height, frameRate: rate } });
      }
      const kbps = cmd['kbps'];
      if (typeof kbps === 'number' && kbps >= 400 && kbps <= 8000) {
        this.#profile = { ...this.#profile, maxKbps: kbps };
        this.#override = saveOverride({ kbps });
        await this.#setMaxBitrate(kbps);
      }
      if (isCodecName(cmd['codec'])) {
        saveOverride({ codec: cmd['codec'] });
        location.reload();
        return;
      }
      if (typeof cmd['relay'] === 'boolean') {
        saveOverride({ relay: cmd['relay'] });
        location.reload();
        return;
      }
      if (cmd['facing'] === 'user' || cmd['facing'] === 'environment') {
        this.#override = saveOverride({ facing: cmd['facing'] });
        await this.localVideo.value?.restartTrack({ facingMode: cmd['facing'] });
      }
      const degrade = cmd['degrade'];
      if (typeof degrade === 'string' && (DEGRADES as readonly string[]).includes(degrade)) {
        this.#override = saveOverride({ degrade: degrade as Degrade });
        await this.localVideo.value?.setDegradationPreference(toPreference(degrade as Degrade));
      }
      const audio = cmd['audio'];
      if (audio && typeof audio === 'object') {
        const want = audio as Record<string, unknown>;
        const a = { ec: want['ec'] !== false, ns: want['ns'] !== false, agc: want['agc'] !== false };
        this.#override = saveOverride({ audio: a });
        const mic = this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
        await mic?.restartTrack({ echoCancellation: a.ec, noiseSuppression: a.ns, autoGainControl: a.agc });
      }
      if (cmd['reload'] === true) {
        location.reload();
        return;
      }
      if (cmd['test'] !== undefined) {
        const spec = (cmd['test'] && typeof cmd['test'] === 'object' ? cmd['test'] : {}) as { steps?: unknown; seconds?: unknown };
        const steps = Array.isArray(spec.steps) ? spec.steps.filter((n): n is number => typeof n === 'number' && n >= 400 && n <= 8000) : SWEEP_STEPS;
        const seconds = typeof spec.seconds === 'number' ? Math.min(20, Math.max(6, spec.seconds)) : 8;
        void this.#runSweep(steps.length ? steps : SWEEP_STEPS, seconds);
      }
      this.#lastError = undefined;
    } catch (err) {
      this.#lastError = err instanceof Error ? err.message : String(err);
    }
    if (cmd['check'] === true || this.#lastError) await this.#report();
  }

  /**
   * Bandwidth sweep asked by the producer: cap the uplink at each step for `seconds`, measure what
   * really goes out, the round trip and the loss, report after every step, then restore the cap.
   */
  async #runSweep(steps: number[], seconds: number): Promise<void> {
    if (this.#sweeping || !this.#upStats) return;
    this.#sweeping = true;
    const before = this.#profile.maxKbps;
    const sweep: SweepResult = { running: true, step: 0, steps, results: [], at: Date.now() };
    this.#sweep = sweep;
    const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
    try {
      await this.#report();
      for (let i = 0; i < steps.length; i++) {
        const target = steps[i]!;
        sweep.step = i;
        await this.#setMaxBitrate(target);
        await sleep(2000); // let the encoder settle
        await this.#upStats.sample(); // fresh interval baseline
        const samples: StatsSummary[] = [];
        const until = Date.now() + Math.max(2, seconds - 2) * 1000;
        while (Date.now() < until) {
          await sleep(2000);
          const s = await this.#upStats.sample().catch(() => undefined);
          if (s && s.kbps > 0) samples.push(s);
        }
        sweep.results.push(summarizeStep(target, samples));
        await this.#report();
      }
    } catch (err) {
      this.#lastError = err instanceof Error ? err.message : String(err);
    } finally {
      await this.#setMaxBitrate(before).catch(() => undefined);
      sweep.running = false;
      sweep.at = Date.now();
      this.#sweeping = false;
      await this.#report();
    }
  }

  /** Scales every simulcast layer so the top one sends at most `kbps`. */
  async #setMaxBitrate(kbps: number): Promise<void> {
    const sender = this.localVideo.value?.sender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    const top = Math.max(...params.encodings.map((e) => e.maxBitrate ?? 0)) || kbps * 1000;
    for (const e of params.encodings) e.maxBitrate = Math.round(((e.maxBitrate ?? top) / top) * kbps * 1000);
    await sender.setParameters(params);
  }

  /** What this phone is doing, for the producer's connection check (topic wc.report). */
  async #report(): Promise<void> {
    if (this.room.state !== ConnectionState.Connected) return;
    const cam = this.localVideo.value;
    const settings = cam?.mediaStreamTrack.getSettings();
    const mic = this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    const nav = navigator as Navigator & { connection?: { effectiveType?: string }; getBattery?: () => Promise<{ level: number }> };
    let battery: number | undefined;
    try {
      battery = nav.getBattery ? Math.round((await nav.getBattery()).level * 100) : undefined;
    } catch {
      battery = undefined;
    }
    const report: GuestReport = {
      at: Date.now(),
      build: BUILD,
      test: this.#sweep,
      quality: this.quality.value,
      up: this.up.value,
      height: settings?.height,
      fps: settings?.frameRate,
      codec: this.#profile.codec,
      kbps: this.#profile.maxKbps,
      relay: this.#relay,
      facing: settings?.facingMode,
      camera: cam?.mediaStreamTrack.label,
      mic: mic?.mediaStreamTrack.label,
      micOn: this.micEnabled.value,
      audio: this.#override.audio ?? { ec: true, ns: true, agc: true },
      degrade: this.#override.degrade ?? DEGRADE_DEFAULT,
      codecs: this.#codecs,
      net: nav.connection?.effectiveType,
      battery,
      ua: navigator.userAgent,
      error: this.#lastError,
    };
    await this.#send('wc.report', report as unknown as Record<string, unknown>);
  }

  async #send(topic: string, data: Record<string, unknown>): Promise<void> {
    await this.room.localParticipant.publishData(encoder.encode(JSON.stringify(data)), { reliable: true, topic }).catch(() => undefined);
  }

  async #sample(): Promise<void> {
    if (this.room.state !== ConnectionState.Connected || this.#sweeping) return; // the sweep owns the stats meanwhile
    try {
      this.up.value = await this.#upStats?.sample();
    } catch {
      this.up.value = undefined;
    }
  }
}
