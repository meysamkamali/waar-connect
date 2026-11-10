// One PCR's return feed: its NDI program source in, the participant `studio` out (track `program`,
// camera source, H.264; track `mix-minus`, microphone source). The routing engine in the API sends
// both to every studio guest and to the green-room guests the producer switches to them.
//
// The multiview burn-in lives here too. While a multiview group watches Studio, the API subscribes
// this participant to the cameras of the group; their frames become small pictures drawn along the
// bottom of a second copy of the return (track `program-mv`), and the group gets that one picture
// instead of the clean return plus one small stream per guest.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import {
  AudioFrame,
  AudioResampler,
  AudioSource,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  VideoBufferType,
  VideoCodec,
  VideoFrame,
  VideoSource,
  VideoStream,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from '@livekit/rtc-node';
import ffi from '@livekit/rtc-ffi-bindings';
import { PROGRAM_MV_TRACK, type ReturnFeedStatus, type ReturnState } from '@waar-connect/shared';
import { pickChannels, planarToMonoInt16 } from './audio.ts';
import type { Config } from './config.ts';
import { log } from './log.ts';
import { Tiles, type Rotation } from './multiview.ts';
import type { NdiSource, AudioFrameIn, Ndi, Receiver, VideoFrameIn } from './ndi.ts';
import { ScaleBuffers, scaleBgraInto, sizeFor } from './scale.ts';

/** What the API hands out per PCR that wants a return feed. */
export interface ReturnTarget {
  pcrId: string;
  pcrName: string;
  room: string;
  /** NDI source name. */
  source: string;
  /** Picture height to send (1080, 720, 540, 360), or null for the gateway's default; scaled before the encode. */
  height: number | null;
  /** Bitrate cap, kbit/s, or null for the gateway's default. */
  kbps: number | null;
  /** LiveKit URL and a token for identity `studio`. */
  url: string;
  token: string;
}

const CAPTURE_WAIT_MS = 100;
/**
 * A capture call that does not come back within this time means the NDI runtime is stuck (seen
 * 2026-11-08 on Windows with a sender on the same machine: the call ignores its timeout for good).
 * Nothing in this process can free it, so the gateway exits and systemd starts it again.
 */
const CAPTURE_STUCK_MS = 10_000;
/** No video for this long: black goes out and the state says so. */
const NO_SIGNAL_MS = 2_000;
/** No video for this long: the source may have moved (sender restarted); find it again. */
const RESCAN_MS = 20_000;
const BLACK_EVERY_MS = 500;
const ROOM_RETRY_MS = 3_000;
const SOURCE_RETRY_MS = 2_000;
const OUT_SAMPLE_RATE = 48_000;
/** Nobody in the multiview for this long: the burned-in copy is unpublished, and its encoder goes with it. */
const MV_IDLE_MS = 5_000;
/** Without programme video the burned-in copy still moves: the guests' pictures on black, this often. */
const MV_BLACK_EVERY_MS = 80;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/**
 * Asks the media server for a guest's smallest copy (180p): it becomes a picture about 200 pixels
 * wide, and the small copy costs a fraction of the full one to decode. rtc-node has no call for this
 * yet, so the request goes to its bindings directly; if it fails the full copy arrives and works.
 */
function requestSmallCopy(pub: RemoteTrackPublication): boolean {
  try {
    const request = new ffi.FfiRequest({
      message: {
        case: 'setRemoteTrackPublicationQuality',
        value: new ffi.SetRemoteTrackPublicationQualityRequest({ trackPublicationHandle: pub.ffiHandle.handle, quality: ffi.VideoQuality.LOW }),
      },
    });
    ffi.FfiResponse.fromBinary(ffi.livekitFfiRequest(request.toBinary()));
    return true;
  } catch (err) {
    log('warn', 'multiview: could not ask for the small copy; the full one will be decoded', { err });
    return false;
  }
}

export class ReturnFeed {
  readonly ndi: Ndi;
  readonly cfg: Config;
  target: ReturnTarget;

  #state: ReturnState = 'starting';
  #detail: string | null = null;
  #since = Date.now();
  #stopped = false;
  #loop: Promise<void> | undefined;

  #receiver: Receiver | undefined;
  #room: Room | undefined;
  #connected = false;
  #connecting = false;
  #publishing: Promise<void> | undefined;
  #videoSource: VideoSource | undefined;
  #audioSource: AudioSource | undefined;
  #videoPub: LocalTrackPublication | undefined;
  #audioPub: LocalTrackPublication | undefined;
  #resampler: AudioResampler | undefined;

  #size: { width: number; height: number } | null = null;
  /** Size of the picture sent to the room, after scaling. */
  #outSize: { width: number; height: number } | null = null;
  readonly #scaled = new ScaleBuffers();
  #audioInfo: { channels: number; sampleRate: number } | null = null;

  // Multiview burn-in: the latest picture of each guest the API subscribed us to, and the second track.
  readonly #tiles = new Tiles();
  readonly #guestReaders = new Map<string, { sid: string; cancel: () => void }>();
  #mvSource: VideoSource | undefined;
  #mvPub: LocalTrackPublication | undefined;
  readonly #mvFrames = new ScaleBuffers();
  #mvIdleSince = 0;
  #mvBlackAt = 0;
  #blackFrame: Uint8Array | undefined;

  #lastVideoAt = 0;
  #sourceFps = 0;
  #fpsAcc = 0;
  #sent = 0;
  #fpsWindowAt = 0;
  #fps = 0;

  constructor(ndi: Ndi, cfg: Config, target: ReturnTarget) {
    this.ndi = ndi;
    this.cfg = cfg;
    this.target = target;
  }

  start(): void {
    this.#loop = this.#run().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.#set('error', message);
      log('error', 'return feed failed', { pcr: this.target.pcrName, err });
      if (message.startsWith('NDI receive stuck')) {
        // The runtime holds a thread for good; only a fresh process gets the feed back.
        log('error', 'exiting so systemd restarts the gateway', { pcr: this.target.pcrName });
        setTimeout(() => process.exit(70), 500);
      }
    });
  }

  /** A fresh token from the API; used on the next (re)connect. */
  update(target: ReturnTarget): void {
    this.target = target;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#loop;
    await this.#teardown();
  }

  status(): ReturnFeedStatus {
    return {
      pcrId: this.target.pcrId,
      pcrName: this.target.pcrName,
      source: this.target.source,
      state: this.#state,
      detail: this.#detail,
      connected: this.#connected,
      video: this.#size ? { ...this.#size, fps: this.#fps } : null,
      audio: this.#audioInfo,
      // The mime type is empty until the server has confirmed the publication; H.264 is what we ask for.
      publish: this.#videoPub
        ? {
            codec: this.#videoPub.mimeType?.replace(/^video\//i, '').toLowerCase() || 'h264',
            maxKbps: this.#kbps(),
            maxFps: this.#targetFps(),
            width: this.#outSize?.width ?? 0,
            height: this.#outSize?.height ?? 0,
          }
        : null,
      mv: this.#mvPub ? { tiles: this.#tiles.count(Date.now()) } : null,
      since: this.#since,
    };
  }

  #set(state: ReturnState, detail: string | null = null): void {
    if (state === this.#state && detail === this.#detail) return;
    log(state === 'error' ? 'error' : 'info', `return feed ${state}`, { pcr: this.target.pcrName, source: this.target.source, detail });
    this.#state = state;
    this.#detail = detail;
    this.#since = Date.now();
  }

  #targetFps(): number {
    return Math.min(this.cfg.RETURN_MAX_FPS, this.#sourceFps || this.cfg.RETURN_MAX_FPS);
  }

  /** Bitrate cap: the PCR's own, else the gateway's. */
  #kbps(): number {
    return this.target.kbps ?? this.cfg.RETURN_MAX_KBPS;
  }

  /** Picture height to send: the PCR's own, else the gateway's; null = the source's size. */
  #outHeight(): number | null {
    return this.target.height ?? (this.cfg.RETURN_HEIGHT || null);
  }

  async #run(): Promise<void> {
    while (!this.#stopped) {
      const source = await this.#findSource();
      if (!source) return;
      // At 360p the sender's own low-bandwidth proxy stream (about 640x360) is enough, and cheaper to decode.
      const lowBandwidth = (this.#outHeight() ?? Infinity) <= 360;
      this.#receiver = this.ndi.createReceiver(source, `waar Connect return · ${this.target.pcrName}`, { lowBandwidth });
      this.#set('no-signal', `connected to ${source.name}${source.url ? ` at ${source.url}` : ''}, waiting for the first frame`);
      void this.#connectRoom();
      try {
        await this.#captureLoop();
      } finally {
        this.#receiver.destroy();
        this.#receiver = undefined;
      }
    }
  }

  async #findSource(): Promise<NdiSource | undefined> {
    let waited = 0;
    while (!this.#stopped) {
      const found = this.ndi.source(this.target.source);
      if (found) return found;
      if (waited === 0 || waited % 30_000 === 0) {
        const seen = this.ndi.sources().map((s) => s.name);
        this.#set('waiting-source', `"${this.target.source}" is not on the network${seen.length ? `; seen: ${seen.join(', ')}` : ''}`);
      }
      await sleep(SOURCE_RETRY_MS);
      waited += SOURCE_RETRY_MS;
    }
    return undefined;
  }

  async #captureLoop(): Promise<void> {
    const receiver = this.#receiver;
    if (!receiver) return;
    const startedAt = Date.now();
    this.#lastVideoAt = 0;
    let lastBlackAt = 0;
    while (!this.#stopped) {
      let stuck: ReturnType<typeof setTimeout> | undefined;
      const got = await Promise.race([
        receiver.capture(CAPTURE_WAIT_MS),
        new Promise<never>((_, reject) => {
          stuck = setTimeout(() => reject(new Error(`NDI receive stuck for ${CAPTURE_STUCK_MS / 1000} s`)), CAPTURE_STUCK_MS);
        }),
      ]).finally(() => clearTimeout(stuck));
      const now = Date.now();
      if (got.kind === 'video') {
        this.#lastVideoAt = now;
        this.#onVideo(got);
      } else if (got.kind === 'audio') {
        await this.#onAudio(got);
      } else if (got.kind === 'error') {
        log('warn', 'NDI receive error', { pcr: this.target.pcrName });
      }

      const silentFor = now - (this.#lastVideoAt || startedAt);
      if (this.#lastVideoAt && silentFor > NO_SIGNAL_MS && this.#state !== 'no-signal') {
        this.#set('no-signal', `no video from ${this.target.source}; sending black`);
      }
      if (this.#state === 'no-signal' && this.#videoSource && this.#size && now - lastBlackAt > BLACK_EVERY_MS) {
        this.#sendBlack();
        lastBlackAt = now;
      }
      // Without programme video the multiview guests still see each other: their pictures on black.
      if (this.#state === 'no-signal' && this.#outSize && (this.#mvPub || this.#tiles.count(now) > 0) && now - this.#mvBlackAt > MV_BLACK_EVERY_MS) {
        this.#multiview(this.#black(this.#outSize), this.#outSize);
        this.#mvBlackAt = now;
      }
      if (silentFor > RESCAN_MS) {
        this.#set('waiting-source', `${this.target.source} went quiet for ${Math.round(silentFor / 1000)} s; looking for it again`);
        return;
      }
    }
  }

  #onVideo(frame: VideoFrameIn): void {
    const srcFps = frame.fpsD > 0 ? frame.fpsN / frame.fpsD : 25;
    this.#sourceFps = srcFps;
    if (!this.#size || this.#size.width !== frame.width || this.#size.height !== frame.height) {
      log('info', this.#size ? 'program video size changed' : 'program video', {
        pcr: this.target.pcrName,
        width: frame.width,
        height: frame.height,
        fps: srcFps,
        fourcc: frame.fourcc.toString(16),
        progressive: frame.progressive,
      });
      this.#size = { width: frame.width, height: frame.height };
    }
    // 50 fps in, 25 out: pass every second frame. Below the cap every frame goes through. Dropped
    // frames are never scaled.
    const target = Math.min(this.cfg.RETURN_MAX_FPS, srcFps);
    this.#fpsAcc += target / srcFps;
    if (this.#fpsAcc < 1 - 1e-6) return;
    this.#fpsAcc -= 1;

    const wantHeight = this.#outHeight();
    const out = wantHeight !== null && frame.height > wantHeight ? sizeFor(frame.width, frame.height, wantHeight) : { width: frame.width, height: frame.height };
    if (!this.#outSize || this.#outSize.width !== out.width || this.#outSize.height !== out.height) {
      this.#outSize = out;
      log('info', 'return picture', { pcr: this.target.pcrName, source: `${frame.width}x${frame.height}`, sent: `${out.width}x${out.height}`, maxKbps: this.#kbps() });
    }
    if (!this.#videoSource) {
      this.#videoSource = new VideoSource(out.width, out.height);
      void this.#publish();
    }
    // captureFrame copies the pixels before it returns, so the scale buffers can be reused in turn.
    const data = scaleBgraInto(frame.data, frame.width, frame.height, out, out.width === frame.width && out.height === frame.height ? frame.data : this.#scaled.take(out));
    this.#videoSource.captureFrame(new VideoFrame(data, out.width, out.height, VideoBufferType.BGRA));
    this.#multiview(data, out);
    this.#countFrame();
    const state: ReturnState = this.#connected && this.#videoPub ? 'publishing' : 'receiving';
    if (this.#state !== state) this.#set(state, state === 'receiving' ? 'frames arrive; the room is not connected yet' : null);
  }

  #countFrame(): void {
    const now = Date.now();
    this.#sent++;
    if (this.#fpsWindowAt === 0) this.#fpsWindowAt = now;
    const span = now - this.#fpsWindowAt;
    if (span >= 1000) {
      this.#fps = Math.round((this.#sent * 1000) / span);
      this.#sent = 0;
      this.#fpsWindowAt = now;
    }
  }

  #sendBlack(): void {
    if (!this.#videoSource || !this.#outSize) return;
    const { width, height } = this.#outSize;
    this.#videoSource.captureFrame(new VideoFrame(new Uint8Array(width * height * 4), width, height, VideoBufferType.BGRA));
  }

  #black(size: { width: number; height: number }): Uint8Array {
    const bytes = size.width * size.height * 4;
    if (this.#blackFrame?.length !== bytes) this.#blackFrame = new Uint8Array(bytes);
    return this.#blackFrame;
  }

  /**
   * The burned-in copy: the frame that just went out, with the multiview guests' pictures drawn along
   * its bottom, sent as a second track. It runs only while frames arrive from at least one guest's
   * camera (the API subscribes this feed to the multiview group); a few seconds after the last
   * picture went quiet, the track is unpublished.
   */
  #multiview(frame: Uint8Array, size: { width: number; height: number }): void {
    const now = Date.now();
    if (this.#tiles.count(now) === 0) {
      if (!this.#mvPub && !this.#mvSource) return;
      if (!this.#mvIdleSince) this.#mvIdleSince = now;
      else if (now - this.#mvIdleSince > MV_IDLE_MS) {
        this.#mvIdleSince = 0;
        void this.#unpublishMultiview();
      }
      return;
    }
    this.#mvIdleSince = 0;
    if (!this.#mvSource) {
      this.#mvSource = new VideoSource(size.width, size.height);
      void this.#publish();
    }
    // captureFrame copies the pixels before it returns, so two buffers in turn are enough.
    const picture = this.#mvFrames.take(size);
    picture.set(frame.length === picture.length ? frame : frame.subarray(0, picture.length));
    this.#tiles.compose(picture, size.width, size.height, now);
    this.#mvSource.captureFrame(new VideoFrame(picture, size.width, size.height, VideoBufferType.BGRA));
  }

  /** The API subscribed this feed to a camera: a guest of the multiview group. Their frames become a small picture. */
  #onGuestTrack(track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant): void {
    const identity = participant.identity;
    if (track.kind !== TrackKind.KIND_VIDEO || !identity.startsWith('guest:')) return;
    this.#dropGuest(identity);
    const small = requestSmallCopy(pub);
    this.#tiles.add(identity);
    const reader = new VideoStream(track).getReader();
    let cancelled = false;
    this.#guestReaders.set(identity, {
      sid: track.sid ?? pub.sid ?? '',
      cancel: () => {
        cancelled = true;
        void reader.cancel().catch(() => undefined);
      },
    });
    log('info', 'multiview: camera subscribed', {
      pcr: this.target.pcrName,
      guest: identity,
      smallCopyAsked: small,
      simulcast: pub.simulcasted ?? null,
      published: pub.width && pub.height ? `${pub.width}x${pub.height}` : null,
    });
    void (async () => {
      let seen = '';
      try {
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          // A subscription the server ended leaves the track here, sending nothing or 8x8 placeholders: not a picture.
          if (value.frame.width < 16 || value.frame.height < 16) continue;
          const now = Date.now();
          if (!this.#tiles.due(identity, now)) continue; // thumbnails: about half the frames are enough
          const frame = value.frame.type === VideoBufferType.I420 ? value.frame : value.frame.convert(VideoBufferType.I420);
          const rotation = ROTATIONS[value.rotation] ?? 0;
          const size = `${frame.width}x${frame.height}/${rotation}`;
          if (size !== seen) {
            seen = size;
            log('info', 'multiview: guest picture', { pcr: this.target.pcrName, guest: identity, size: `${frame.width}x${frame.height}`, rotation });
          }
          this.#tiles.update(identity, frame.data, frame.width, frame.height, rotation, now);
        }
      } catch (err) {
        if (!cancelled) log('warn', 'multiview: reading a guest stopped', { pcr: this.target.pcrName, guest: identity, err });
      }
    })();
  }

  /** A guest left the multiview (unsubscribed, or gone). With `sid`, only if that is the track we read. */
  #dropGuest(identity: string, sid?: string): void {
    const reading = this.#guestReaders.get(identity);
    if (!reading || (sid !== undefined && reading.sid !== sid)) return;
    reading.cancel();
    this.#guestReaders.delete(identity);
    this.#tiles.remove(identity);
    log('info', 'multiview: camera gone', { pcr: this.target.pcrName, guest: identity });
  }

  #dropAllGuests(): void {
    for (const reading of this.#guestReaders.values()) reading.cancel();
    this.#guestReaders.clear();
    this.#tiles.clear();
  }

  /** Takes the burned-in track down, in line with any publish that is under way. */
  #unpublishMultiview(): Promise<void> {
    const run = async () => {
      if (this.#tiles.count(Date.now()) > 0) return; // someone joined the multiview meanwhile
      const pub = this.#mvPub;
      const source = this.#mvSource;
      if (!pub && !source) return;
      this.#mvPub = undefined;
      this.#mvSource = undefined;
      const me = this.#room?.localParticipant;
      if (pub?.sid && me) await me.unpublishTrack(pub.sid).catch(() => undefined);
      if (source) await source.close().catch(() => undefined);
      log('info', 'multiview: burned-in return stopped', { pcr: this.target.pcrName });
    };
    const next = (this.#publishing ?? Promise.resolve()).then(run).catch((err: unknown) => {
      log('warn', 'multiview: stopping the burned-in return failed', { pcr: this.target.pcrName, err });
    });
    this.#publishing = next;
    return next;
  }

  async #onAudio(frame: AudioFrameIn): Promise<void> {
    if (!this.#audioSource) {
      this.#audioSource = new AudioSource(OUT_SAMPLE_RATE, 1);
      this.#audioInfo = { channels: frame.channels, sampleRate: frame.sampleRate };
      if (frame.sampleRate !== OUT_SAMPLE_RATE) this.#resampler = new AudioResampler(frame.sampleRate, OUT_SAMPLE_RATE, 1);
      log('info', 'program audio', { pcr: this.target.pcrName, channels: frame.channels, sampleRate: frame.sampleRate, use: pickChannels(this.cfg.audioChannels, frame.channels).map((c) => c + 1) });
      void this.#publish();
    } else if (this.#audioInfo && (this.#audioInfo.channels !== frame.channels || this.#audioInfo.sampleRate !== frame.sampleRate)) {
      this.#audioInfo = { channels: frame.channels, sampleRate: frame.sampleRate };
      this.#resampler = frame.sampleRate !== OUT_SAMPLE_RATE ? new AudioResampler(frame.sampleRate, OUT_SAMPLE_RATE, 1) : undefined;
    }
    const pcm = planarToMonoInt16(frame.planes, pickChannels(this.cfg.audioChannels, frame.channels), frame.samples);
    const inFrame = new AudioFrame(pcm, frame.sampleRate, 1, frame.samples);
    const frames = this.#resampler ? this.#resampler.push(inFrame) : [inFrame];
    for (const f of frames) await this.#audioSource.captureFrame(f);
  }

  async #connectRoom(): Promise<void> {
    if (this.#connecting) return;
    this.#connecting = true;
    try {
      while (!this.#stopped && !this.#room) {
        const room = new Room();
        room.on(RoomEvent.Disconnected, (reason) => this.#onRoomLost(room, String(reason)));
        room.on(RoomEvent.Reconnecting, () => {
          this.#connected = false;
        });
        room.on(RoomEvent.Reconnected, () => {
          this.#connected = true;
        });
        room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => this.#onGuestTrack(track, pub, participant));
        room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => this.#dropGuest(participant.identity, track.sid ?? undefined));
        room.on(RoomEvent.ParticipantDisconnected, (participant) => this.#dropGuest(participant.identity));
        try {
          await room.connect(this.target.url, this.target.token, { autoSubscribe: false, dynacast: false });
          this.#room = room;
          this.#connected = true;
          log('info', 'room connected', { pcr: this.target.pcrName, room: this.target.room });
          await this.#publish();
        } catch (err) {
          log('warn', 'room connect failed; retrying', { pcr: this.target.pcrName, err });
          await room.disconnect().catch(() => undefined);
          await sleep(ROOM_RETRY_MS);
        }
      }
    } finally {
      this.#connecting = false;
    }
  }

  #onRoomLost(room: Room, reason: string): void {
    if (this.#room !== room) return;
    this.#room = undefined;
    this.#connected = false;
    this.#videoPub = undefined;
    this.#audioPub = undefined;
    this.#mvPub = undefined;
    this.#dropAllGuests(); // the API subscribes us again after the reconnect
    if (this.#stopped) return;
    log('warn', 'room disconnected; reconnecting', { pcr: this.target.pcrName, reason });
    setTimeout(() => void this.#connectRoom(), ROOM_RETRY_MS);
  }

  /** Publishes whichever source exists and is not yet published in the current room. Serialised. */
  #publish(): Promise<void> {
    const run = async () => {
      const room = this.#room;
      const me = room?.localParticipant;
      if (!room || !me || !this.#connected) return;
      if (this.#videoSource && !this.#videoPub) {
        const track = LocalVideoTrack.createVideoTrack('program', this.#videoSource);
        const opts = new TrackPublishOptions({
          source: TrackSource.SOURCE_CAMERA,
          videoCodec: VideoCodec.H264,
          simulcast: false,
          videoEncoding: { maxBitrate: BigInt(this.#kbps() * 1000), maxFramerate: this.#targetFps() },
        });
        this.#videoPub = await me.publishTrack(track, opts);
        log('info', 'program video published', {
          pcr: this.target.pcrName,
          codec: this.#videoPub.mimeType,
          maxKbps: this.#kbps(),
          maxFps: this.#targetFps(),
          size: this.#outSize ? `${this.#outSize.width}x${this.#outSize.height}` : null,
        });
      }
      if (this.#audioSource && !this.#audioPub) {
        const track = LocalAudioTrack.createAudioTrack('mix-minus', this.#audioSource);
        const opts = new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE, dtx: false, red: true, audioEncoding: { maxBitrate: 96_000n } });
        this.#audioPub = await me.publishTrack(track, opts);
        log('info', 'mix-minus published', { pcr: this.target.pcrName, codec: this.#audioPub.mimeType });
      }
      if (this.#mvSource && !this.#mvPub) {
        // Same size, codec and caps as the clean return: for the guests who get it, it takes the return's place.
        const track = LocalVideoTrack.createVideoTrack(PROGRAM_MV_TRACK, this.#mvSource);
        const opts = new TrackPublishOptions({
          source: TrackSource.SOURCE_CAMERA,
          videoCodec: VideoCodec.H264,
          simulcast: false,
          videoEncoding: { maxBitrate: BigInt(this.#kbps() * 1000), maxFramerate: this.#targetFps() },
        });
        this.#mvPub = await me.publishTrack(track, opts);
        log('info', 'multiview: burned-in return published', { pcr: this.target.pcrName, codec: this.#mvPub.mimeType, guests: this.#tiles.count(Date.now()), maxKbps: this.#kbps() });
      }
    };
    const next = (this.#publishing ?? Promise.resolve()).then(run).catch((err: unknown) => {
      log('warn', 'publish failed', { pcr: this.target.pcrName, err });
    });
    this.#publishing = next;
    return next;
  }

  async #teardown(): Promise<void> {
    const room = this.#room;
    this.#room = undefined;
    this.#connected = false;
    this.#videoPub = undefined;
    this.#audioPub = undefined;
    this.#mvPub = undefined;
    this.#dropAllGuests();
    if (room) await room.disconnect().catch(() => undefined);
    if (this.#videoSource) await this.#videoSource.close().catch(() => undefined);
    if (this.#audioSource) await this.#audioSource.close().catch(() => undefined);
    if (this.#mvSource) await this.#mvSource.close().catch(() => undefined);
    this.#videoSource = undefined;
    this.#audioSource = undefined;
    this.#mvSource = undefined;
    this.#resampler?.close();
    this.#resampler = undefined;
    if (this.#receiver) {
      this.#receiver.destroy();
      this.#receiver = undefined;
    }
  }
}
