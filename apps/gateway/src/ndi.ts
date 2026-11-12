// The NDI runtime through koffi (plain TypeScript, no compile step). Receive side: discovery, one
// receiver per source, frames copied out of NDI memory into our own buffers. Send side: one sender
// per studio slot, I420 pictures and float sound handed to the SDK, which compresses and sends them.
// The NDI SDK (libndi.so.6 on Linux, Processing.NDI.Lib.x64.dll on Windows) is installed separately;
// see deploy/vm/install-gateway.sh. NDI® is a registered trademark of Vizrt NDI AB.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import koffi from 'koffi';
import { log } from './log.ts';

/** A sender as discovery lists it. The report adds network and ownership (see network.ts). */
export interface NdiSource {
  /** Name as NDI shows it, e.g. "MIXER (Program)". */
  name: string;
  /** host:port the gateway connects to, when known. */
  url: string | null;
}

function fourcc(s: string): number {
  return (s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24)) >>> 0;
}

export const FOURCC = {
  BGRA: fourcc('BGRA'),
  BGRX: fourcc('BGRX'),
  /** 32-bit float, planar: the only audio layout the v3 receive API hands out. */
  FLTP: fourcc('FLTp'),
  /** Planar 4:2:0: the Y plane, then U, then V. What the video decoder gives, so a guest's picture goes out without a conversion. */
  I420: fourcc('I420'),
} as const;

// NDIlib_frame_type_e
const FRAME_NONE = 0;
const FRAME_VIDEO = 1;
const FRAME_AUDIO = 2;
const FRAME_METADATA = 3;
const FRAME_ERROR = 4;
const FRAME_STATUS_CHANGE = 100;

// NDIlib_recv_color_format_e / NDIlib_recv_bandwidth_e / NDIlib_frame_format_type_e
const COLOR_BGRX_BGRA = 0;
const BANDWIDTH_HIGHEST = 100;
/** The sender's own low-bandwidth proxy stream, about 640x360: enough for a 360p return and cheaper to decode. */
const BANDWIDTH_LOWEST = 0;
const FORMAT_PROGRESSIVE = 1;
/** Both fields in one frame, the upper one first. */
const FORMAT_INTERLEAVED = 0;
/** Lets the SDK stamp frames with its own clock (NDIlib_send_timecode_synthesize). */
const TIMECODE_SYNTHESIZE = 0x7fffffffffffffffn;

export interface VideoFrameIn {
  kind: 'video';
  width: number;
  height: number;
  fourcc: number;
  fpsN: number;
  fpsD: number;
  progressive: boolean;
  /**
   * Tightly packed rows, 4 bytes per pixel (BGRA or BGRX), in one of the receiver's three buffers in
   * turn: use it before the next captures (scale it, or hand it to the encoder, which copies), never keep it.
   */
  data: Uint8Array;
}

export interface AudioFrameIn {
  kind: 'audio';
  sampleRate: number;
  channels: number;
  samples: number;
  /** One Float32Array per channel, our own copies. */
  planes: Float32Array[];
}

export type Captured = VideoFrameIn | AudioFrameIn | { kind: 'none' | 'metadata' | 'status' | 'error' };

interface RawSource {
  p_ndi_name: string | null;
  p_url_address: string | null;
}

interface RawVideo {
  xres: number;
  yres: number;
  FourCC: number;
  frame_rate_N: number;
  frame_rate_D: number;
  frame_format_type: number;
  p_data: unknown;
  line_stride_in_bytes: number;
}

interface RawAudio {
  sample_rate: number;
  no_channels: number;
  no_samples: number;
  FourCC: number;
  p_data: unknown;
  channel_stride_in_bytes: number;
}

type Fn = ((...args: unknown[]) => unknown) & { async: (...args: unknown[]) => void };

function asyncCall<T>(fn: Fn, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    fn.async(...args, (err: unknown, res: T) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(res)));
  });
}

/** Where the runtime usually is; NDI_LIB in the environment wins. */
export function libraryCandidates(explicit?: string): string[] {
  if (explicit) return [explicit];
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const dir = process.env['NDI_RUNTIME_DIR_V6'];
    return [
      ...(dir ? [join(dir, 'Processing.NDI.Lib.x64.dll')] : []),
      join(pf, 'NDI', 'NDI 6 Runtime', 'v6', 'Processing.NDI.Lib.x64.dll'),
      join(pf, 'NDI', 'NDI 6 Tools', 'Runtime', 'Processing.NDI.Lib.x64.dll'),
    ];
  }
  return ['/usr/local/lib/libndi.so.6', '/usr/lib/libndi.so.6', '/usr/lib/x86_64-linux-gnu/libndi.so.6', 'libndi.so.6'];
}

/**
 * One NDI source this machine sends: "MACHINE (name)". Pictures are I420; with `clocked`, a call to
 * `video` returns when the frame's time has come, so a loop that calls it runs at the stated rate.
 */
export class Sender {
  readonly name: string;
  readonly clocked: boolean;
  #inst: unknown;
  readonly #ndi: Ndi;
  #busy = false;
  /** Kept until the SDK has taken the picture: the call runs on another thread. */
  #held: Uint8Array | undefined;

  /** @internal */
  constructor(ndi: Ndi, inst: unknown, name: string, clocked: boolean) {
    this.#ndi = ndi;
    this.#inst = inst;
    this.name = name;
    this.clocked = clocked;
  }

  /** A send is in flight; another must wait for it. */
  get busy(): boolean {
    return this.#busy;
  }

  /** Sends one picture. `interlaced`: the frame holds two fields, the upper one first. */
  async video(data: Uint8Array, width: number, height: number, fpsN: number, fpsD: number, interlaced: boolean): Promise<void> {
    const inst = this.#inst;
    if (!inst) return;
    if (this.#busy) throw new Error('a picture is already being sent');
    this.#busy = true;
    this.#held = data;
    try {
      await asyncCall<void>(this.#ndi.f.sendVideo, inst, {
        xres: width,
        yres: height,
        FourCC: FOURCC.I420,
        frame_rate_N: fpsN,
        frame_rate_D: fpsD,
        picture_aspect_ratio: width / height,
        frame_format_type: interlaced ? FORMAT_INTERLEAVED : FORMAT_PROGRESSIVE,
        timecode: TIMECODE_SYNTHESIZE,
        p_data: data,
        line_stride_in_bytes: width,
        p_metadata: null,
        timestamp: 0n,
      });
    } finally {
      this.#held = undefined;
      this.#busy = false;
    }
  }

  /** Sends sound: 32-bit float, one plane of `samples` per channel, one after the other in `planes`. */
  audio(planes: Float32Array, channels: number, samples: number, sampleRate: number): void {
    if (!this.#inst) return;
    this.#ndi.f.sendAudio(this.#inst, {
      sample_rate: sampleRate,
      no_channels: channels,
      no_samples: samples,
      timecode: TIMECODE_SYNTHESIZE,
      FourCC: FOURCC.FLTP,
      p_data: planes,
      channel_stride_in_bytes: samples * 4,
      p_metadata: null,
      timestamp: 0n,
    });
  }

  /** How many receivers are connected to this source right now. */
  receivers(): number {
    return this.#inst ? Number(this.#ndi.f.sendConnections(this.#inst, 0)) : 0;
  }

  /** Call only when no send is in flight. */
  destroy(): void {
    if (!this.#inst) return;
    if (this.#busy) throw new Error('destroy while a picture is being sent');
    this.#ndi.f.sendDestroy(this.#inst);
    this.#inst = undefined;
    void this.#held;
  }
}

export class Receiver {
  readonly #pool = new FramePool(3);
  #inst: unknown;
  readonly #ndi: Ndi;
  #busy = false;

  /** @internal */
  constructor(ndi: Ndi, inst: unknown) {
    this.#ndi = ndi;
    this.#inst = inst;
  }

  /** Waits up to timeoutMs for the next frame; copies it out of NDI memory and frees NDI's copy. */
  async capture(timeoutMs: number): Promise<Captured> {
    const inst = this.#inst;
    if (!inst) return { kind: 'none' };
    if (this.#busy) throw new Error('capture already in flight');
    this.#busy = true;
    const f = this.#ndi.f;
    const v: Partial<RawVideo> = {};
    const a: Partial<RawAudio> = {};
    const m = {};
    try {
      const type = await asyncCall<number>(f.recvCapture, inst, v, a, m, timeoutMs);
      switch (type) {
        case FRAME_VIDEO: {
          const raw = v as RawVideo;
          try {
            return copyVideo(raw, this.#pool);
          } finally {
            f.recvFreeVideo(inst, raw);
          }
        }
        case FRAME_AUDIO: {
          const raw = a as RawAudio;
          try {
            return copyAudio(raw);
          } finally {
            f.recvFreeAudio(inst, raw);
          }
        }
        case FRAME_METADATA:
          f.recvFreeMeta(inst, m);
          return { kind: 'metadata' };
        case FRAME_STATUS_CHANGE:
          return { kind: 'status' };
        case FRAME_ERROR:
          return { kind: 'error' };
        case FRAME_NONE:
        default:
          return { kind: 'none' };
      }
    } finally {
      this.#busy = false;
    }
  }

  /** How many senders this receiver is connected to (0 or 1). */
  connections(): number {
    return this.#inst ? Number(this.#ndi.f.recvConnections(this.#inst)) : 0;
  }

  destroy(): void {
    if (!this.#inst) return;
    if (this.#busy) throw new Error('destroy while a capture is in flight');
    this.#ndi.f.recvDestroy(this.#inst);
    this.#inst = undefined;
  }
}

/**
 * Frame buffers handed out in turn, so a 1080p frame (8 MB) is not allocated 25 times a second: that
 * kept V8's garbage collector threads busy for most of a core.
 */
export class FramePool {
  readonly #count: number;
  #bufs: Uint8Array[] = [];
  #next = 0;

  constructor(count: number) {
    this.#count = count;
  }

  take(bytes: number): Uint8Array {
    if (this.#bufs.length !== this.#count || (this.#bufs[0] as Uint8Array).length !== bytes) {
      this.#bufs = Array.from({ length: this.#count }, () => new Uint8Array(bytes));
      this.#next = 0;
    }
    const buf = this.#bufs[this.#next] as Uint8Array;
    this.#next = (this.#next + 1) % this.#count;
    return buf;
  }
}

function copyVideo(raw: RawVideo, pool: FramePool): VideoFrameIn {
  const width = raw.xres;
  const height = raw.yres;
  const stride = raw.line_stride_in_bytes;
  const tight = width * 4;
  const view = new Uint8Array(koffi.view(raw.p_data, stride * height));
  const data = pool.take(tight * height);
  if (stride === tight) {
    data.set(view);
  } else {
    for (let y = 0; y < height; y++) data.set(view.subarray(y * stride, y * stride + tight), y * tight);
  }
  return {
    kind: 'video',
    width,
    height,
    fourcc: raw.FourCC >>> 0,
    fpsN: raw.frame_rate_N,
    fpsD: raw.frame_rate_D,
    progressive: raw.frame_format_type === FORMAT_PROGRESSIVE,
    data,
  };
}

function copyAudio(raw: RawAudio): AudioFrameIn {
  const channels = raw.no_channels;
  const samples = raw.no_samples;
  const stride = raw.channel_stride_in_bytes;
  const buffer = koffi.view(raw.p_data, stride * channels);
  const planes: Float32Array[] = [];
  for (let c = 0; c < channels; c++) planes.push(new Float32Array(buffer, c * stride, samples).slice());
  return { kind: 'audio', sampleRate: raw.sample_rate, channels, samples, planes };
}

export class Ndi {
  /** @internal bound C functions */
  readonly f: Record<
    | 'initialize'
    | 'version'
    | 'findCreate'
    | 'findDestroy'
    | 'findWait'
    | 'findSources'
    | 'recvCreate'
    | 'recvDestroy'
    | 'recvConnect'
    | 'recvCapture'
    | 'recvFreeVideo'
    | 'recvFreeAudio'
    | 'recvFreeMeta'
    | 'recvConnections'
    | 'sendCreate'
    | 'sendDestroy'
    | 'sendVideo'
    | 'sendAudio'
    | 'sendConnections',
    Fn
  >;
  readonly path: string;
  readonly #Source: unknown;
  #finder: unknown;
  #sources: NdiSource[] = [];
  #discovering = false;
  #discoveryLoop: Promise<void> | undefined;

  private constructor(path: string) {
    this.path = path;
    const lib = koffi.load(path);
    const Source = koffi.struct('NDIlib_source_t', { p_ndi_name: 'const char *', p_url_address: 'const char *' });
    koffi.struct('NDIlib_find_create_t', { show_local_sources: 'bool', p_groups: 'const char *', p_extra_ips: 'const char *' });
    koffi.struct('NDIlib_recv_create_v3_t', {
      source_to_connect_to: Source,
      color_format: 'int',
      bandwidth: 'int',
      allow_video_fields: 'bool',
      p_ndi_recv_name: 'const char *',
    });
    koffi.struct('NDIlib_video_frame_v2_t', {
      xres: 'int',
      yres: 'int',
      FourCC: 'uint32_t',
      frame_rate_N: 'int',
      frame_rate_D: 'int',
      picture_aspect_ratio: 'float',
      frame_format_type: 'int',
      timecode: 'int64_t',
      p_data: 'void *',
      line_stride_in_bytes: 'int',
      p_metadata: 'const char *',
      timestamp: 'int64_t',
    });
    koffi.struct('NDIlib_audio_frame_v3_t', {
      sample_rate: 'int',
      no_channels: 'int',
      no_samples: 'int',
      timecode: 'int64_t',
      FourCC: 'uint32_t',
      p_data: 'void *',
      channel_stride_in_bytes: 'int',
      p_metadata: 'const char *',
      timestamp: 'int64_t',
    });
    koffi.struct('NDIlib_metadata_frame_t', { length: 'int', timecode: 'int64_t', p_data: 'void *' });
    koffi.struct('NDIlib_send_create_t', { p_ndi_name: 'const char *', p_groups: 'const char *', clock_video: 'bool', clock_audio: 'bool' });
    this.#Source = Source;
    const fn = (proto: string): Fn => lib.func(proto) as unknown as Fn;
    this.f = {
      initialize: fn('bool NDIlib_initialize()'),
      version: fn('const char *NDIlib_version()'),
      findCreate: fn('void *NDIlib_find_create_v2(const NDIlib_find_create_t *settings)'),
      findDestroy: fn('void NDIlib_find_destroy(void *inst)'),
      findWait: fn('bool NDIlib_find_wait_for_sources(void *inst, uint32_t timeout_ms)'),
      findSources: fn('const NDIlib_source_t *NDIlib_find_get_current_sources(void *inst, _Out_ uint32_t *count)'),
      recvCreate: fn('void *NDIlib_recv_create_v3(const NDIlib_recv_create_v3_t *settings)'),
      recvDestroy: fn('void NDIlib_recv_destroy(void *inst)'),
      recvConnect: fn('void NDIlib_recv_connect(void *inst, const NDIlib_source_t *src)'),
      recvCapture: fn(
        'int NDIlib_recv_capture_v3(void *inst, _Out_ NDIlib_video_frame_v2_t *v, _Out_ NDIlib_audio_frame_v3_t *a, _Out_ NDIlib_metadata_frame_t *m, uint32_t timeout_ms)',
      ),
      recvFreeVideo: fn('void NDIlib_recv_free_video_v2(void *inst, const NDIlib_video_frame_v2_t *v)'),
      recvFreeAudio: fn('void NDIlib_recv_free_audio_v3(void *inst, const NDIlib_audio_frame_v3_t *a)'),
      recvFreeMeta: fn('void NDIlib_recv_free_metadata(void *inst, const NDIlib_metadata_frame_t *m)'),
      recvConnections: fn('int NDIlib_recv_get_no_connections(void *inst)'),
      sendCreate: fn('void *NDIlib_send_create(const NDIlib_send_create_t *settings)'),
      sendDestroy: fn('void NDIlib_send_destroy(void *inst)'),
      sendVideo: fn('void NDIlib_send_send_video_v2(void *inst, const NDIlib_video_frame_v2_t *v)'),
      sendAudio: fn('void NDIlib_send_send_audio_v3(void *inst, const NDIlib_audio_frame_v3_t *a)'),
      sendConnections: fn('int NDIlib_send_get_no_connections(void *inst, uint32_t timeout_ms)'),
    };
  }

  /** Loads the runtime from NDI_LIB or the usual places and initialises it. Throws with help when absent. */
  static load(explicit?: string): Ndi {
    const tried: string[] = [];
    for (const candidate of libraryCandidates(explicit)) {
      if (candidate.includes('/') || candidate.includes('\\')) {
        if (!existsSync(candidate)) {
          tried.push(candidate);
          continue;
        }
      }
      try {
        const ndi = new Ndi(candidate);
        if (!ndi.f.initialize()) throw new Error('NDIlib_initialize returned false (unsupported CPU?)');
        return ndi;
      } catch (err) {
        tried.push(`${candidate} (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    throw new Error(
      `NDI runtime not found. Tried: ${tried.join(', ')}. Install the NDI SDK runtime (deploy/vm/install-gateway.sh on the VM, NDI Tools on Windows) or set NDI_LIB.`,
    );
  }

  version(): string {
    return String(this.f.version());
  }

  /** Every source seen on the network, refreshed by the discovery loop. */
  sources(): NdiSource[] {
    return this.#sources;
  }

  /** Finds a source by its NDI name; exact first, then case-insensitive. */
  source(name: string): NdiSource | undefined {
    const exact = this.#sources.find((s) => s.name === name);
    if (exact) return exact;
    const lower = name.toLowerCase();
    return this.#sources.find((s) => s.name.toLowerCase() === lower);
  }

  /** Starts mDNS discovery (plus the given sender IPs for other subnets) and keeps sources() fresh. */
  startDiscovery(extraIps: readonly string[]): void {
    if (this.#discovering) return;
    this.#finder = this.f.findCreate({ show_local_sources: true, p_groups: null, p_extra_ips: extraIps.length ? extraIps.join(',') : null });
    if (!this.#finder) throw new Error('NDIlib_find_create_v2 failed');
    this.#discovering = true;
    this.#discoveryLoop = this.#discover();
  }

  async stopDiscovery(): Promise<void> {
    this.#discovering = false;
    await this.#discoveryLoop;
    if (this.#finder) this.f.findDestroy(this.#finder);
    this.#finder = undefined;
  }

  async #discover(): Promise<void> {
    while (this.#discovering) {
      try {
        // Blocks in a worker thread until the list changes or the timeout passes; then read the list.
        await asyncCall<boolean>(this.f.findWait, this.#finder, 1000);
        const count = [0];
        const ptr = this.f.findSources(this.#finder, count);
        const n = Number(count[0] ?? 0);
        const list = ptr && n > 0 ? (koffi.decode(ptr, this.#Source as never, n) as RawSource[]) : [];
        // A sender found both by mDNS and through NDI_EXTRA_IPS is listed twice by the SDK; keep one.
        const seen = new Set<string>();
        const next = list
          .map((s) => ({ name: s.p_ndi_name ?? '?', url: s.p_url_address }))
          .filter((s) => {
            const key = `${s.name}|${s.url ?? ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((x, y) => x.name.localeCompare(y.name));
        if (JSON.stringify(next) !== JSON.stringify(this.#sources)) {
          this.#sources = next;
          log('info', 'NDI sources', { count: next.length, names: next.map((s) => s.name) });
        }
      } catch (err) {
        log('warn', 'NDI discovery failed', { err });
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  /**
   * A source of this machine's own, shown on the network as "MACHINE (name)". `clocked`: the SDK
   * paces the pictures at the rate each frame states.
   */
  createSender(name: string, clocked: boolean): Sender {
    const inst = this.f.sendCreate({ p_ndi_name: name, p_groups: null, clock_video: clocked, clock_audio: false });
    if (!inst) throw new Error(`NDIlib_send_create failed for "${name}" (is the name taken on this machine?)`);
    return new Sender(this, inst, name, clocked);
  }

  /** A receiver connected to one source, BGRA/BGRX, progressive frames only; full bandwidth or the sender's proxy stream. */
  createReceiver(source: NdiSource, receiverName: string, opts: { lowBandwidth?: boolean } = {}): Receiver {
    const inst = this.f.recvCreate({
      source_to_connect_to: { p_ndi_name: source.name, p_url_address: source.url },
      color_format: COLOR_BGRX_BGRA,
      bandwidth: opts.lowBandwidth ? BANDWIDTH_LOWEST : BANDWIDTH_HIGHEST,
      allow_video_fields: false,
      p_ndi_recv_name: receiverName,
    });
    if (!inst) throw new Error(`NDIlib_recv_create_v3 failed for ${source.name}`);
    return new Receiver(this, inst);
  }
}
