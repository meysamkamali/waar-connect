// The guest's LiveKit session as signals: place and tally from the server's attributes, the tracks
// the server lets through, cues and commands over the data channel, and the local camera and mic.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { computed, signal } from '@preact/signals';
import {
  DEFAULT_GUEST_PREFS,
  defaultGuestState,
  defaultScreen,
  describeChoice,
  GUEST_COUNT_ATTR,
  guestFromAttributes,
  MV_STRIP_TRACK,
  normalizeGuestPrefs,
  normalizeScreen,
  pickCodec,
  pickCodecLine,
  roleOf,
  STUDIO_IDENTITY,
  type GuestPrefs,
  type GuestScreen,
  type GuestState,
} from '@waar-connect/shared';
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
import { CODEC_LABELS, isCodecName, probeCodecs, type CodecName, type CodecSupport } from '../lib/codecs.ts';
import { SWEEP_STEPS, type Degrade, type GuestReport, type SweepResult, type TestStep } from '../lib/report.ts';
import { connectRoom, createRoom, profileFromParams, qualityLabel, videoPublishOptions, type PublishProfile } from '../lib/room.ts';
import { TrackStats, type StatsSummary } from '../lib/stats.ts';
import { BUILD } from '../lib/version.ts';

import { cameraConstraints, mergeCameraRequest, parseCameraRequest, readCamera, type CameraRequest } from '../lib/camera.ts';

// Settings the producer pushed to this phone; they survive a reload of the same tab.
const OVERRIDE_KEY = 'wc.guest.override';
export interface GuestOverride {
  res?: number | undefined;
  fps?: number | undefined;
  kbps?: number | undefined;
  codec?: CodecName | undefined;
  relay?: boolean;
  facing?: 'user' | 'environment';
  audio?: { ec: boolean; ns: boolean; agc: boolean };
  degrade?: Degrade | undefined;
  /** Codecs the browser accepted and then dropped after publishing; never offered again in this tab. */
  failedCodecs?: CodecName[];
  /** False: send only the full-size copy (no 360p / 180p simulcast copies). */
  small?: boolean | undefined;
  /** Camera settings the producer pushed (exposure, locks, zoom, torch); put back after a reload or a camera restart. */
  cam?: CameraRequest | undefined;
}

// Ceilings of the small simulcast copies (see lib/room.ts) and their share of the cap at low caps.
const SMALL_COPIES: Record<string, { own: number; share: number }> = {
  q: { own: 150_000, share: 0.12 },
  h: { own: 500_000, share: 0.35 },
};
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
const RATES = [25, 50]; // the station is 50 Hz; 30 was removed on 2026-11-10

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
  /** The multiview: one wide picture of the guests ticked MV, made by the server, to lay over whatever fills the screen. */
  readonly mvStrip = signal<RemoteVideoTrack | null>(null);
  /** The screen as the admin designed it for this studio; a new design arrives live (wc.screen). */
  readonly screen = signal<GuestScreen>(defaultScreen());
  /** How many guests are on this screen: the multiview group, or one. Picks the screen's pattern. */
  readonly guests = signal(1);
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
  /** The page address with the pushed settings laid over it: what is set there wins over the studio's preferences. */
  #params: URLSearchParams;
  #prefs: GuestPrefs = normalizeGuestPrefs(DEFAULT_GUEST_PREFS);
  #why: string | undefined;
  #mismatch = 0;
  #connectedAt = 0;
  #over = 0;

  constructor() {
    const params = new URLSearchParams(location.search);
    this.#override = loadOverride();
    const o = this.#override;
    if (o.res) params.set('res', String(o.res));
    if (o.fps) params.set('fps', String(o.fps));
    if (o.kbps) params.set('kbps', String(o.kbps));
    if (o.codec) params.set('codec', o.codec);
    if (o.relay !== undefined) params.set('relay', o.relay ? '1' : '0');
    this.#params = params;
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

  /**
   * What to send with: a setting pushed to this phone (or written in the page address) wins, the rest
   * comes from the studio's preferences. The codec is the first line of the studio's order this phone
   * can do, leaving out codecs that already failed in this tab.
   */
  #resolveProfile(): PublishProfile {
    const p = this.#params;
    const fromAddress = profileFromParams(p);
    const prefs = this.#prefs;
    const failed = this.#override.failedCodecs ?? [];
    let codec: CodecName;
    if (isCodecName(p.get('codec'))) {
      codec = fromAddress.codec;
      this.#why = this.#override.codec ? 'pushed to this phone' : 'from the page address';
    } else {
      codec = pickCodec(prefs.codecs, this.#codecs, failed);
      const line = pickCodecLine(prefs.codecs, this.#codecs, failed);
      this.#why = line >= 0 ? `studio preference ${line + 1} of ${prefs.codecs.length}: ${describeChoice(prefs.codecs[line]!)}` : 'no studio preference fits this phone';
    }
    return {
      height: p.has('res') ? fromAddress.height : prefs.height,
      fps: p.has('fps') ? fromAddress.fps : prefs.fps,
      maxKbps: p.has('kbps') ? fromAddress.maxKbps : prefs.kbps,
      codec,
    };
  }

  async connect(info: JoinInfo, devices: DeviceChoice): Promise<void> {
    this.status.value = 'connecting';
    this.state.value = defaultGuestState(info.livekit.identity);
    this.screen.value = normalizeScreen(info.screen);
    this.#prefs = normalizeGuestPrefs(info.prefs);
    const probe = probeCodecs().catch(() => undefined); // what this phone can send, asked while the connection comes up
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
    this.#connectedAt = Date.now();
    this.#readState();
    const lp = this.room.localParticipant;
    const o = this.#override;
    this.#codecs = await probe;
    this.#profile = this.#resolveProfile();
    const pr = this.#profile;
    await lp.setCameraEnabled(
      true,
      {
        resolution: { width: Math.round((pr.height * 16) / 9), height: pr.height, frameRate: pr.fps },
        ...(devices.videoDeviceId && !o.facing ? { deviceId: devices.videoDeviceId } : {}),
        ...(o.facing ? { facingMode: o.facing } : {}),
      },
      videoPublishOptions(pr),
    );
    const a = o.audio ?? { ec: true, ns: true, agc: true };
    await lp.setMicrophoneEnabled(true, { ...(devices.audioDeviceId ? { deviceId: devices.audioDeviceId } : {}), echoCancellation: a.ec, noiseSuppression: a.ns, autoGainControl: a.agc });
    const cam = lp.getTrackPublication(Track.Source.Camera)?.videoTrack ?? null;
    this.localVideo.value = cam;
    this.#upStats = cam ? new TrackStats(cam, 'send') : undefined;
    await this.#setMaxBitrate(pr.maxKbps).catch(() => undefined); // also gives the small copies their share at a low cap
    if (o.small === false) await this.#setSmallCopies(false).catch(() => undefined);
    await cam?.setDegradationPreference(toPreference(o.degrade ?? this.#prefs.degrade)).catch(() => undefined);
    if (o.cam) await this.#applyCamera(o.cam).catch(() => undefined);
    await this.room.startAudio().catch(() => undefined);
    this.#timer = window.setInterval(() => void this.#sample(), 2000);
    this.#reportTimer = window.setInterval(() => void this.#report(), 10_000);
    void this.#report();
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
    this.guests.value = Math.max(1, Number(lp.attributes[GUEST_COUNT_ATTR]) || 1);
  }

  #onTrack(track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant): void {
    if (track.kind === Track.Kind.Audio) {
      this.audioTracks.value = [...this.audioTracks.value, track as RemoteAudioTrack];
      return;
    }
    if (track.kind !== Track.Kind.Video) return;
    const video = track as RemoteVideoTrack;
    const role = roleOf(participant.identity);
    if (participant.identity === STUDIO_IDENTITY && pub.trackName === MV_STRIP_TRACK) {
      this.mvStrip.value = video;
    } else if (participant.identity === STUDIO_IDENTITY) {
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
    if (this.mvStrip.value?.sid === track.sid) this.mvStrip.value = null;
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
    } else if (topic === 'wc.screen' && participant === undefined) {
      // the admin saved a new design; only the server sends this
      this.screen.value = normalizeScreen(message);
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
        await this.#setMaxFramerate(rate);
        await this.#reapplyCamera();
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
      if (cmd['defaults'] === true) {
        // Back to the studio's preferences: forget what was pushed for picture, bitrate and codec, and connect again.
        saveOverride({ res: undefined, fps: undefined, kbps: undefined, codec: undefined, degrade: undefined, small: undefined });
        location.reload();
        return;
      }
      if (typeof cmd['relay'] === 'boolean') {
        saveOverride({ relay: cmd['relay'] });
        location.reload();
        return;
      }
      if (typeof cmd['small'] === 'boolean') {
        this.#override = saveOverride({ small: cmd['small'] });
        this.#over = 0;
        await this.#setSmallCopies(cmd['small']);
      }
      if (cmd['facing'] === 'user' || cmd['facing'] === 'environment') {
        this.#override = saveOverride({ facing: cmd['facing'] });
        await this.localVideo.value?.restartTrack({ facingMode: cmd['facing'] });
        await this.#reapplyCamera();
      }
      const camera = parseCameraRequest(cmd['cam']);
      if (camera) {
        this.#override = saveOverride({ cam: mergeCameraRequest(this.#override.cam, camera) });
        await this.#applyCamera(camera);
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
    if (cmd['check'] === true || cmd['cam'] !== undefined || this.#lastError) await this.#report();
  }

  /**
   * Pushes camera settings (exposure offset and lock, white balance lock, focus lock, zoom, torch) to
   * the camera track, each as its own constraint set and only those this camera offers.
   */
  async #applyCamera(req: CameraRequest): Promise<void> {
    const track = this.localVideo.value?.mediaStreamTrack;
    if (!track) return;
    const info = readCamera(track.getCapabilities?.(), track.getSettings());
    if (!info) return;
    const advanced = cameraConstraints(req, info.can);
    if (advanced.length === 0) return;
    await track.applyConstraints({ advanced: advanced as unknown as MediaTrackConstraintSet[] });
  }

  /** A restarted camera track starts from the camera's own defaults; put the producer's settings back. */
  async #reapplyCamera(): Promise<void> {
    if (this.#override.cam) await this.#applyCamera(this.#override.cam).catch(() => undefined);
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
  /**
   * The cap is for the full-size copy. The small copies keep their own ceilings, but never more than a
   * share of the cap: at 400 kbit/s the old scaling left the 360p copy the biggest sender.
   */
  async #setMaxBitrate(kbps: number): Promise<void> {
    const sender = this.localVideo.value?.sender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    for (const e of params.encodings) {
      const small = e.rid ? SMALL_COPIES[e.rid] : undefined;
      e.maxBitrate = small ? Math.round(Math.min(small.own, kbps * 1000 * small.share)) : kbps * 1000;
    }
    await sender.setParameters(params);
  }

  /**
   * The encoder's own frame rate ceiling, on every copy. It is set when the camera is published; without
   * raising it here a camera restarted at 50 would still be sent at 25.
   */
  async #setMaxFramerate(fps: number): Promise<void> {
    const sender = this.localVideo.value?.sender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    for (const e of params.encodings) e.maxFramerate = fps;
    await sender.setParameters(params);
  }

  /** Switches the 360p and 180p copies on or off; viewers that asked for a small copy then get the full one. */
  async #setSmallCopies(on: boolean): Promise<void> {
    const sender = this.localVideo.value?.sender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    for (const e of params.encodings) if (e.rid && SMALL_COPIES[e.rid]) e.active = on;
    await sender.setParameters(params);
  }

  /**
   * Some hardware encoders ignore the caps of the small copies (seen 2026-11-08: an Android H.265
   * encoder sent the 360p copy at 3.7 Mbit/s against a 500 kbit/s cap, more than the 1080p copy). When a
   * small copy runs far above its cap for three samples in a row, switch the small copies off and say so.
   */
  async #checkCopies(up: StatsSummary | undefined): Promise<void> {
    if (this.#override.small === false || !up?.layers) return;
    const sender = this.localVideo.value?.sender;
    const caps = new Map((sender?.getParameters().encodings ?? []).map((e) => [e.rid, e.maxBitrate]));
    const hot = up.layers.find((l) => {
      const cap = l.rid ? caps.get(l.rid) : undefined;
      return l.rid !== undefined && SMALL_COPIES[l.rid] !== undefined && cap !== undefined && l.kbps * 1000 > Math.max(2 * cap, cap + 300_000);
    });
    if (!hot) {
      this.#over = 0;
      return;
    }
    if (++this.#over < 3) return;
    const cap = Math.round((caps.get(hot.rid) ?? 0) / 1000);
    this.#override = saveOverride({ small: false });
    this.#lastError = `small copies switched off: this encoder ignores their caps (${hot.height ?? hot.rid}p sent ${hot.kbps} kbit/s against ${cap})`;
    await this.#setSmallCopies(false).catch(() => undefined);
    await this.#report();
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
      width: settings?.width,
      height: settings?.height,
      fps: settings?.frameRate,
      fpsAsked: this.#profile.fps,
      fpsMax: cam?.mediaStreamTrack.getCapabilities?.().frameRate?.max,
      codec: this.#profile.codec,
      why: this.#why,
      wire: this.up.value?.codec,
      kbps: this.#profile.maxKbps,
      relay: this.#relay,
      small: this.#override.small ?? true,
      facing: settings?.facingMode,
      camera: cam?.mediaStreamTrack.label,
      cam: cam ? readCamera(cam.mediaStreamTrack.getCapabilities?.(), settings) : undefined,
      mic: mic?.mediaStreamTrack.label,
      micOn: this.micEnabled.value,
      audio: this.#override.audio ?? { ec: true, ns: true, agc: true },
      degrade: this.#override.degrade ?? this.#prefs.degrade,
      codecs: this.#codecsWithFailures(),
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
    // The engineer's meters: what goes out right now, every two seconds. The full report stays at ten.
    if (this.up.value) void this.#send('wc.live', { quality: this.quality.value, up: this.up.value });
    await this.#checkCodec(this.up.value?.codec);
    await this.#checkCopies(this.up.value).catch(() => undefined);
  }

  /**
   * The browser can change codec on its own after publishing. Seen 2026-11-08: a phone that advertised a
   * hardware H.265 encoder switched to VP8 seven seconds in; the server then moved every viewer to the
   * H.264 backup copy and the phone was uploading twice. When the codec on the wire is not the one asked
   * for, remember that this codec fails here and move on to the next line of the studio's order this
   * phone can do (H.264 when none is left): with a reload while the call is young (it just connected or
   * the codec was just changed), otherwise only from the next reload, so a live picture is not cut.
   */
  async #checkCodec(wire: string | undefined): Promise<void> {
    const asked = this.#profile.codec;
    if (!wire || wire === asked) {
      this.#mismatch = 0;
      return;
    }
    if (++this.#mismatch < 2) return; // two samples in a row, four seconds
    const failed = this.#override.failedCodecs ?? [];
    if (failed.includes(asked)) return;
    const young = Date.now() - this.#connectedAt < 60_000;
    const nowFailed = [...failed, asked];
    // A pushed codec that failed is forgotten, so the studio's order decides again.
    this.#override = saveOverride({ failedCodecs: nowFailed, ...(this.#override.codec === asked ? { codec: undefined } : {}) });
    const next = pickCodec(this.#prefs.codecs, this.#codecs, nowFailed);
    // A codec written in the page address is asked again after a reload; nothing to move to then.
    const pinned = isCodecName(new URLSearchParams(location.search).get('codec'));
    const moves = next !== asked && !pinned;
    const tail = !moves ? '' : young ? `; reconnecting with ${CODEC_LABELS[next]}` : `; ${CODEC_LABELS[next]} from the next reload`;
    this.#lastError = `${CODEC_LABELS[asked]} failed on this phone (the browser switched to ${wire.toUpperCase()})${tail}`;
    await this.#report();
    if (moves && young) location.reload();
  }

  #codecsWithFailures(): Partial<Record<CodecName, CodecSupport>> | undefined {
    const failed = this.#override.failedCodecs ?? [];
    if (failed.length === 0) return this.#codecs;
    const out: Partial<Record<CodecName, CodecSupport>> = { ...this.#codecs };
    for (const c of failed) out[c] = 'failed';
    return out;
  }
}
