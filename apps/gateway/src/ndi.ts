// The NDI runtime through koffi (plain TypeScript, no compile step). Receive side only for now:
// discovery, one receiver per source, frames copied out of NDI memory into our own buffers.
// The NDI SDK (libndi.so.6 on Linux, Processing.NDI.Lib.x64.dll on Windows) is installed separately;
// see deploy/vm/install-gateway.sh. NDI® is a registered trademark of Vizrt NDI AB.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import koffi from 'koffi';
import type { NdiSourceInfo } from '@waar-connect/shared';
import { log } from './log.ts';

function fourcc(s: string): number {
  return (s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24)) >>> 0;
}

export const FOURCC = {
  BGRA: fourcc('BGRA'),
  BGRX: fourcc('BGRX'),
  /** 32-bit float, planar: the only audio layout the v3 receive API hands out. */
  FLTP: fourcc('FLTp'),
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
const FORMAT_PROGRESSIVE = 1;

export interface VideoFrameIn {
  kind: 'video';
  width: number;
  height: number;
  fourcc: number;
  fpsN: number;
  fpsD: number;
  progressive: boolean;
  /** Tightly packed rows, 4 bytes per pixel (BGRA or BGRX), our own copy. */
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

export class Receiver {
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
            return copyVideo(raw);
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

function copyVideo(raw: RawVideo): VideoFrameIn {
  const width = raw.xres;
  const height = raw.yres;
  const stride = raw.line_stride_in_bytes;
  const tight = width * 4;
  const view = new Uint8Array(koffi.view(raw.p_data, stride * height));
  let data: Uint8Array;
  if (stride === tight) {
    data = view.slice();
  } else {
    data = new Uint8Array(tight * height);
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
  readonly f: Record<'initialize' | 'version' | 'findCreate' | 'findDestroy' | 'findWait' | 'findSources' | 'recvCreate' | 'recvDestroy' | 'recvConnect' | 'recvCapture' | 'recvFreeVideo' | 'recvFreeAudio' | 'recvFreeMeta' | 'recvConnections', Fn>;
  readonly path: string;
  readonly #Source: unknown;
  #finder: unknown;
  #sources: NdiSourceInfo[] = [];
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
  sources(): NdiSourceInfo[] {
    return this.#sources;
  }

  /** Finds a source by its NDI name; exact first, then case-insensitive. */
  source(name: string): NdiSourceInfo | undefined {
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
        const next = list.map((s) => ({ name: s.p_ndi_name ?? '?', url: s.p_url_address })).sort((x, y) => x.name.localeCompare(y.name));
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

  /** A receiver connected to one source, BGRA/BGRX at full bandwidth, progressive frames only. */
  createReceiver(source: NdiSourceInfo, receiverName: string): Receiver {
    const inst = this.f.recvCreate({
      source_to_connect_to: { p_ndi_name: source.name, p_url_address: source.url },
      color_format: COLOR_BGRX_BGRA,
      bandwidth: BANDWIDTH_HIGHEST,
      allow_video_fields: false,
      p_ndi_recv_name: receiverName,
    });
    if (!inst) throw new Error(`NDIlib_recv_create_v3 failed for ${source.name}`);
    return new Receiver(this, inst);
  }
}
