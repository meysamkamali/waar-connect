// One studio slot out as an NDI source. The feed sits in the studio's room under the slot's own
// output identity; the server sends it exactly the guest who sits on that slot (camera and
// microphone), as it does for the output page. The guest's picture is turned upright, fitted into
// the output's size when one is fixed, and handed to NDI at the output's frame rate; an interlaced
// rate weaves two pictures into one frame when the guest sends enough of them. While nobody sits on
// the slot, black goes out once a second, so the source stays on the network and in the mixer.
//
// A picture that already has the output's size goes out untouched. Fitting is libyuv's work where
// the machine has it (yuv.ts), a few milliseconds a picture; without it the JavaScript fitter takes
// most of a core for 1080p and cannot keep 25 a second on an older one. Each slot runs in a process
// of its own (out-worker.ts).
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { AudioStream, Room, RoomEvent, TrackKind, VideoBufferType, VideoStream, type RemoteParticipant, type RemoteTrack } from '@livekit/rtc-node';
import { ATTR, formatLabel, outSize, outTiming, type OutputFeedStatus, type OutRate, type OutState } from '@waar-connect/shared';
import type { Config } from './config.ts';
import { log } from './log.ts';
import { FramePool, type Ndi, type Sender } from './ndi.ts';
import { blackI420, Fitter, i420Bytes, interleavedToPlanar, nominalRate, uprightSize, weaveI420, type PictureFitter, type Rotation } from './outframe.ts';

export interface OutTarget {
  pcrId: string;
  pcrName: string;
  room: string;
  slot: number;
  /** The NDI source name, without the machine. */
  name: string;
  /** Picture height, 16:9; null: as it arrives. */
  height: number | null;
  /** Frame rate; null: as it arrives. */
  rate: OutRate | null;
  url: string;
  token: string;
}

interface SourceFrame {
  data: Uint8Array;
  width: number;
  height: number;
  rotation: Rotation;
  seq: number;
  at: number;
}

interface Picture {
  data: Uint8Array;
  width: number;
  height: number;
}

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];
const ROOM_RETRY_MS = 3_000;
const SENDER_RETRY_MS = 10_000;
/** Black for an empty slot goes out this often: the source stays alive without costing an encode per frame. */
const SLATE_EVERY_MS = 1_000;
/** A guest who still sits on the slot but whose pictures stopped keeps their last picture this long. */
const FREEZE_LIMIT_MS = 15_000;
/** Without word from the room on where the guest sits, pictures older than this mean the slot is empty. */
const STALE_MS = 2_500;
/** The size black goes out in while no size is fixed and no guest has been seen. */
const DEFAULT_SIZE = { width: 1280, height: 720 } as const;
const AUDIO_RATE = 48_000;
const AUDIO_CHANNELS = 2;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const even = (n: number) => Math.max(2, n & ~1);

export class OutFeed {
  target: OutTarget;
  readonly #ndi: Ndi;
  readonly #gain: number;
  #sender: Sender | undefined;
  #room: Room | undefined;
  #connected = false;
  #connecting = false;
  #stopped = false;
  #detail: string | null = null;
  #error = false;
  #state: OutState = 'starting';
  #since = Date.now();

  /** The guest whose tracks are read, and how to stop reading them. */
  #guest: string | null = null;
  #stopVideo: (() => void) | undefined;
  #stopAudio: (() => void) | undefined;

  #src: SourceFrame | undefined;
  #prev: SourceFrame | undefined;
  #seq = 0;
  #sentSeq = 0;
  #inFrames = 0;
  #inFps = 0;
  #fpsAt = Date.now();
  #out: { width: number; height: number; format: string } | null = null;
  #lastSlate = 0;
  #pumping = false;

  readonly #fitter: PictureFitter;
  readonly #fitPool = new FramePool(4);
  readonly #weavePool = new FramePool(2);
  #fitted: { seq: number; picture: Picture }[] = [];
  #slate: Picture | undefined;
  #audioPlanes = new Float32Array(0);
  #loop: Promise<void> | undefined;
  #idleTimer: ReturnType<typeof setInterval> | undefined;

  constructor(ndi: Ndi, cfg: Config, target: OutTarget, fitter: PictureFitter = new Fitter()) {
    this.#ndi = ndi;
    this.#fitter = fitter;
    this.target = target;
    this.#gain = 10 ** (cfg.OUT_AUDIO_GAIN_DB / 20);
  }

  start(): void {
    this.#loop = this.#run();
    void this.#connectRoom();
  }

  /** A fresh token from the API, used on the next (re)connect. */
  update(target: OutTarget): void {
    this.target = target;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearInterval(this.#idleTimer);
    this.#dropGuest();
    await this.#room?.disconnect().catch(() => undefined);
    this.#room = undefined;
    await this.#loop?.catch(() => undefined);
    // a send that was in flight has ended with the loop
    for (let i = 0; i < 20 && this.#sender?.busy; i++) await sleep(50);
    try {
      this.#sender?.destroy();
    } catch (err) {
      log('warn', 'NDI sender could not be closed', { out: this.target.name, err });
    }
    this.#sender = undefined;
  }

  status(): OutputFeedStatus {
    const now = Date.now();
    const live = this.#live(now);
    const state: OutState = this.#error ? 'error' : !this.#sender || (!this.#connected && !live) ? 'starting' : live ? 'sending' : 'slate';
    if (state !== this.#state) {
      this.#state = state;
      this.#since = now;
    }
    const s = this.#src;
    return {
      pcrId: this.target.pcrId,
      pcrName: this.target.pcrName,
      slot: this.target.slot,
      name: this.target.name,
      state,
      detail: this.#error ? this.#detail : !this.#connected ? 'the room is not connected yet' : null,
      connected: this.#connected,
      guest: live ? this.#guest : null,
      in: live && s ? { ...uprightSize(s.width, s.height, s.rotation), fps: Math.round(this.#inFps) } : null,
      out: this.#out,
      receivers: this.#sender?.receivers() ?? 0,
      since: this.#since,
    };
  }

  // ---- the NDI side ---------------------------------------------------------------------------------

  /** Makes the sender (again and again while the name is taken), then sends: paced by NDI's clock for a fixed rate, else as pictures arrive. */
  async #run(): Promise<void> {
    while (!this.#stopped && !this.#sender) {
      try {
        this.#sender = this.#ndi.createSender(this.target.name, this.target.rate !== null);
        this.#error = false;
        this.#detail = null;
        log('info', 'NDI output up', { pcr: this.target.pcrName, slot: this.target.slot, name: this.target.name, size: this.target.height ?? 'as it arrives', rate: this.target.rate ?? 'as it arrives' });
      } catch (err) {
        this.#error = true;
        this.#detail = err instanceof Error ? err.message : String(err);
        log('warn', 'NDI output could not start; trying again', { out: this.target.name, err });
        await sleep(SENDER_RETRY_MS);
      }
    }
    const sender = this.#sender;
    if (!sender) return;
    if (this.target.rate === null) {
      // as pictures arrive: the reader pushes them (see #pump); here only the black for an empty slot
      this.#idleTimer = setInterval(() => void this.#idle(), 250);
      return;
    }
    const timing = outTiming(this.target.rate);
    while (!this.#stopped) {
      try {
        const now = Date.now();
        const picture = this.#live(now) ? this.#compose(timing.interlaced) : undefined;
        if (picture) {
          this.#noteOut(picture, formatLabel(picture.height, this.target.rate));
          await sender.video(picture.data, picture.width, picture.height, timing.fpsN, timing.fpsD, timing.interlaced);
        } else if (now - this.#lastSlate >= SLATE_EVERY_MS) {
          this.#lastSlate = now;
          const black = this.#black();
          this.#noteOut(black, formatLabel(black.height, this.target.rate));
          await sender.video(black.data, black.width, black.height, timing.fpsN, timing.fpsD, timing.interlaced);
        } else await sleep(40);
      } catch (err) {
        log('warn', 'NDI output: a picture was not sent', { out: this.target.name, err });
        await sleep(500);
      }
    }
  }

  /** "As it arrives": sends the newest picture that has not gone out yet, one at a time. */
  async #pump(): Promise<void> {
    const sender = this.#sender;
    if (!sender || this.#pumping || this.target.rate !== null) return;
    this.#pumping = true;
    try {
      while (!this.#stopped) {
        const s = this.#src;
        if (!s || s.seq === this.#sentSeq) break;
        const picture = this.#fit(s);
        const rate = nominalRate(this.#inFps);
        this.#sentSeq = s.seq;
        this.#noteOut(picture, `${picture.height}p${rate}`);
        await sender.video(picture.data, picture.width, picture.height, rate, 1, false);
      }
    } catch (err) {
      log('warn', 'NDI output: a picture was not sent', { out: this.target.name, err });
    } finally {
      this.#pumping = false;
    }
  }

  /** "As it arrives", empty slot: black once a second. */
  async #idle(): Promise<void> {
    const sender = this.#sender;
    const now = Date.now();
    if (!sender || this.#stopped || this.#pumping || sender.busy || this.#live(now) || now - this.#lastSlate < SLATE_EVERY_MS) return;
    this.#lastSlate = now;
    const black = this.#black();
    this.#noteOut(black, `${black.height}p25`);
    await sender.video(black.data, black.width, black.height, 25, 1, false).catch(() => undefined);
  }

  #noteOut(p: Picture, format: string): void {
    if (!this.#out || this.#out.width !== p.width || this.#out.height !== p.height || this.#out.format !== format) this.#out = { width: p.width, height: p.height, format };
  }

  /** Is a guest on the slot, with a picture to show? */
  #live(now: number): boolean {
    const s = this.#src;
    if (!s || !this.#guest) return false;
    const p = this.#room?.remoteParticipants.get(this.#guest);
    if (!p) return false;
    const seated = p.attributes[ATTR.place] === 'studio' && p.attributes[ATTR.slot] === String(this.target.slot);
    // still on the slot: a stalled line holds the last picture for a while; otherwise the pictures' end is the guest's leaving
    return now - s.at < (seated ? FREEZE_LIMIT_MS : STALE_MS);
  }

  /** The size that goes out for this picture: the fixed one, or the picture's own, upright, in even numbers. */
  #sizeFor(s: SourceFrame): { width: number; height: number } {
    if (this.target.height !== null) return outSize(this.target.height);
    const up = uprightSize(s.width, s.height, s.rotation);
    return { width: even(up.width), height: even(up.height) };
  }

  /** The picture at the output's size, upright. One that already is goes out as the decoder gave it. */
  #fit(s: SourceFrame): Picture {
    const size = this.#sizeFor(s);
    if (s.rotation === 0 && s.width === size.width && s.height === size.height) return { data: s.data, width: s.width, height: s.height };
    const have = this.#fitted.find((f) => f.seq === s.seq && f.picture.width === size.width && f.picture.height === size.height);
    if (have) return have.picture;
    const data = this.#fitPool.take(i420Bytes(size.width, size.height));
    this.#fitter.fit(s.data, s.width, s.height, s.rotation, data, size.width, size.height);
    const picture = { data, ...size };
    this.#fitted = [{ seq: s.seq, picture }, ...this.#fitted].slice(0, 2);
    return picture;
  }

  /** The next frame for a fixed rate: the newest picture; interlaced, the two newest woven when two came since the last frame. */
  #compose(interlaced: boolean): Picture | undefined {
    const s = this.#src;
    if (!s) return undefined;
    const fresh = s.seq - this.#sentSeq;
    this.#sentSeq = s.seq;
    const cur = this.#fit(s);
    const p = this.#prev;
    if (!interlaced || fresh < 2 || !p || p.seq !== s.seq - 1) return cur;
    const first = this.#fit(p);
    if (first.width !== cur.width || first.height !== cur.height) return cur;
    const data = this.#weavePool.take(i420Bytes(cur.width, cur.height));
    weaveI420(first.data, cur.data, data, cur.width, cur.height);
    return { data, width: cur.width, height: cur.height };
  }

  #black(): Picture {
    const size = this.target.height !== null ? outSize(this.target.height) : this.#out ? { width: this.#out.width, height: this.#out.height } : DEFAULT_SIZE;
    if (!this.#slate || this.#slate.width !== size.width || this.#slate.height !== size.height) {
      const data = new Uint8Array(i420Bytes(size.width, size.height));
      blackI420(data, size.width, size.height);
      this.#slate = { data, ...size };
    }
    return this.#slate;
  }

  // ---- the room side --------------------------------------------------------------------------------

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
        room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => this.#onTrack(track, participant));
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
          if (participant.identity === this.#guest) this.#dropGuest();
        });
        try {
          await room.connect(this.target.url, this.target.token, { autoSubscribe: false, dynacast: false });
          this.#room = room;
          this.#connected = true;
          log('info', 'NDI output: room connected', { pcr: this.target.pcrName, slot: this.target.slot });
        } catch (err) {
          log('warn', 'NDI output: room connect failed; retrying', { pcr: this.target.pcrName, slot: this.target.slot, err });
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
    this.#dropGuest(); // the API subscribes us again after the reconnect
    if (this.#stopped) return;
    log('warn', 'NDI output: room disconnected; reconnecting', { pcr: this.target.pcrName, slot: this.target.slot, reason });
    setTimeout(() => void this.#connectRoom(), ROOM_RETRY_MS);
  }

  #dropGuest(): void {
    this.#stopVideo?.();
    this.#stopAudio?.();
    this.#stopVideo = undefined;
    this.#stopAudio = undefined;
    this.#guest = null;
    this.#src = undefined;
    this.#prev = undefined;
    this.#fitted = [];
  }

  /** The server subscribed this output to a track of the guest on its slot. */
  #onTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    const identity = participant.identity;
    if (!identity.startsWith('guest:')) return; // an output shows guests and nothing else, whatever arrives
    if (this.#guest !== identity) {
      this.#dropGuest();
      this.#guest = identity;
      log('info', 'NDI output: guest on the slot', { pcr: this.target.pcrName, slot: this.target.slot, guest: identity });
    }
    if (track.kind === TrackKind.KIND_VIDEO) this.#readVideo(track, identity);
    else if (track.kind === TrackKind.KIND_AUDIO) this.#readAudio(track, identity);
  }

  #readVideo(track: RemoteTrack, identity: string): void {
    this.#stopVideo?.();
    const reader = new VideoStream(track).getReader();
    let cancelled = false;
    this.#stopVideo = () => {
      cancelled = true;
      void reader.cancel().catch(() => undefined);
    };
    void (async () => {
      let seen = '';
      try {
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          // A subscription the server ended leaves the track here, sending nothing or 8x8 placeholders: not a picture.
          if (value.frame.width < 16 || value.frame.height < 16) continue;
          const frame = value.frame.type === VideoBufferType.I420 ? value.frame : value.frame.convert(VideoBufferType.I420);
          const rotation = ROTATIONS[value.rotation] ?? 0;
          const now = Date.now();
          const size = `${frame.width}x${frame.height}/${rotation}`;
          if (size !== seen) {
            seen = size;
            log('info', 'NDI output: guest picture', { pcr: this.target.pcrName, slot: this.target.slot, guest: identity, size: `${frame.width}x${frame.height}`, rotation });
          }
          this.#prev = this.#src;
          this.#src = { data: frame.data, width: frame.width, height: frame.height, rotation, seq: ++this.#seq, at: now };
          this.#inFrames++;
          if (now - this.#fpsAt >= 1000) {
            this.#inFps = (this.#inFrames * 1000) / (now - this.#fpsAt);
            this.#inFrames = 0;
            this.#fpsAt = now;
          }
          if (this.target.rate === null) void this.#pump();
        }
      } catch (err) {
        if (!cancelled) log('warn', 'NDI output: reading the picture stopped', { pcr: this.target.pcrName, slot: this.target.slot, err });
      }
    })();
  }

  #readAudio(track: RemoteTrack, identity: string): void {
    this.#stopAudio?.();
    const reader = new AudioStream(track, AUDIO_RATE, AUDIO_CHANNELS).getReader();
    let cancelled = false;
    this.#stopAudio = () => {
      cancelled = true;
      void reader.cancel().catch(() => undefined);
    };
    void (async () => {
      try {
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          const sender = this.#sender;
          // sound goes out only with the picture's guest on the slot: an empty slot is silent
          if (!sender || this.#guest !== identity || !this.#live(Date.now())) continue;
          const samples = value.samplesPerChannel;
          const channels = value.channels;
          if (this.#audioPlanes.length !== samples * channels) this.#audioPlanes = new Float32Array(samples * channels);
          interleavedToPlanar(value.data, channels, samples, this.#gain, this.#audioPlanes);
          sender.audio(this.#audioPlanes, channels, samples, value.sampleRate);
        }
      } catch (err) {
        if (!cancelled) log('warn', 'NDI output: reading the sound stopped', { pcr: this.target.pcrName, slot: this.target.slot, err });
      }
    })();
  }
}
