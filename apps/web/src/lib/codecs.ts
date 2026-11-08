// Video codecs the system carries, and what a guest's device can do with each of them.
// "hw" means the browser reports a power-efficient (hardware) encoder for 720p25; "sw" means it
// can encode but in software (hot phone, shorter battery); "no" means it cannot send that codec;
// "failed" means the browser said yes and then switched codec after publishing (guest/session.ts).
import type { VideoCodec } from 'livekit-client';

export type CodecName = VideoCodec; // 'vp8' | 'h264' | 'vp9' | 'av1' | 'h265'
export type CodecSupport = 'hw' | 'sw' | 'no' | 'failed' | 'unknown';

export const CODECS: readonly CodecName[] = ['h264', 'vp8', 'vp9', 'av1', 'h265'];

export const CODEC_LABELS: Readonly<Record<CodecName, string>> = {
  h264: 'H.264',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  h265: 'H.265',
};

const MIME: Readonly<Record<CodecName, string>> = {
  h264: 'video/H264',
  vp8: 'video/VP8',
  vp9: 'video/VP9',
  av1: 'video/AV1',
  h265: 'video/H265',
};

export function isCodecName(x: unknown): x is CodecName {
  return typeof x === 'string' && (CODECS as readonly string[]).includes(x);
}

export const SUPPORT_LABELS: Readonly<Record<CodecSupport, string>> = {
  hw: 'hardware',
  sw: 'software',
  no: 'not supported',
  failed: 'failed on this phone',
  unknown: 'unknown',
};

type EncodingInfo = { supported: boolean; smooth: boolean; powerEfficient: boolean };
type MediaCapabilitiesWithWebRTC = {
  encodingInfo?: (config: { type: 'webrtc'; video: { contentType: string; width: number; height: number; bitrate: number; framerate: number; scalabilityMode?: string } }) => Promise<EncodingInfo>;
};

/** Asks this browser what it can send. Cheap; run once per page. */
export async function probeCodecs(): Promise<Record<CodecName, CodecSupport>> {
  const out = {} as Record<CodecName, CodecSupport>;
  const sendable = new Set((RTCRtpSender.getCapabilities?.('video')?.codecs ?? []).map((c) => c.mimeType.toLowerCase()));
  const mc = (navigator as Navigator & { mediaCapabilities?: MediaCapabilitiesWithWebRTC }).mediaCapabilities;
  for (const codec of CODECS) {
    if (!sendable.has(MIME[codec].toLowerCase())) {
      out[codec] = 'no';
      continue;
    }
    out[codec] = 'unknown';
    if (!mc?.encodingInfo) continue;
    // Some browsers want the H.264 profile spelled out; try with it first, then plain.
    const variants = codec === 'h264' ? [`${MIME[codec]};profile-level-id=42e01f`, MIME[codec]] : [MIME[codec]];
    for (const contentType of variants) {
      try {
        const info = await mc.encodingInfo({ type: 'webrtc', video: { contentType, width: 1280, height: 720, bitrate: 2_500_000, framerate: 25 } });
        out[codec] = !info.supported ? 'no' : info.powerEfficient ? 'hw' : 'sw';
        break;
      } catch {
        // try the next spelling
      }
    }
  }
  return out;
}

export function describeCodecs(c: Partial<Record<CodecName, CodecSupport>> | undefined): string {
  if (!c) return 'encoders: not probed yet';
  return `encoders: ${CODECS.map((k) => `${CODEC_LABELS[k]} ${SUPPORT_LABELS[c[k] ?? 'unknown']}`).join(' · ')}`;
}
