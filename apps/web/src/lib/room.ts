// Room creation with the waar Connect publish defaults, and manual subscription management.
// Every page subscribes only to what it needs; nothing is automatic.

import {
  AudioPresets,
  ConnectionQuality,
  ConnectionState,
  Room,
  RoomEvent,
  VideoPreset,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RoomOptions,
  type TrackPublishOptions,
  type VideoCodec,
} from 'livekit-client';
import { isCodecName } from './codecs.ts';

export interface PublishProfile {
  height: number;
  fps: number;
  maxKbps: number;
  codec: VideoCodec;
}

const HEIGHTS = [360, 540, 720, 1080];
const RATES = [25, 50];

/** `?res=720&fps=25&kbps=2500&codec=h264`; defaults suit a 50 Hz station and a phone uplink. Frame rates: 25 or 50. */
export function profileFromParams(p: URLSearchParams): PublishProfile {
  const res = Number(p.get('res'));
  const height = HEIGHTS.includes(res) ? res : 720;
  const rate = Number(p.get('fps'));
  const fps = RATES.includes(rate) ? rate : 25;
  const kbps = Number(p.get('kbps'));
  const defaultKbps = height >= 1080 ? 4000 : height >= 720 ? 2500 : height >= 540 ? 1500 : 800;
  return {
    height,
    fps,
    maxKbps: Number.isFinite(kbps) && kbps >= 400 ? kbps : defaultKbps,
    codec: isCodecName(p.get('codec')) ? (p.get('codec') as VideoCodec) : 'h264',
  };
}

/** Codec, bitrate cap and the two small simulcast copies for one profile. */
export function videoPublishOptions(profile: PublishProfile): TrackPublishOptions {
  return {
    simulcast: true,
    videoCodec: profile.codec,
    videoEncoding: { maxBitrate: profile.maxKbps * 1000, maxFramerate: profile.fps },
    videoSimulcastLayers: [new VideoPreset(320, 180, 150_000, profile.fps), new VideoPreset(640, 360, 500_000, profile.fps)],
    // VP9, AV1 and H.265 are sent as one layered stream; a viewer that cannot decode them gets an
    // H.264 copy the phone adds on demand (LiveKit's backup codec).
    backupCodec: profile.codec === 'h264' ? true : { codec: 'h264' },
  };
}

export function createRoom(profile: PublishProfile): Room {
  const width = Math.round((profile.height * 16) / 9);
  const options: RoomOptions = {
    // The SFU decides layers from what each receiver asks for; pages ask explicitly.
    adaptiveStream: false,
    dynacast: true,
    videoCaptureDefaults: {
      resolution: { width, height: profile.height, frameRate: profile.fps },
      facingMode: 'user',
    },
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
    publishDefaults: {
      ...videoPublishOptions(profile),
      audioPreset: AudioPresets.music,
      dtx: false,
      red: true,
      stopMicTrackOnMute: false,
    },
  };
  return new Room(options);
}

/**
 * Connects; `relay` allows only TURN relay candidates (a test tool). The engine keeps the last rtcConfig,
 * so the policy is always stated, also when going back to 'all' after a failed relay attempt, and a
 * relay-only attempt gives up sooner: once the relay leg does not answer there is nothing to wait for.
 */
export async function connectRoom(room: Room, url: string, token: string, relay: boolean): Promise<void> {
  await room.connect(url, token, {
    autoSubscribe: false,
    rtcConfig: { iceTransportPolicy: relay ? 'relay' : 'all' },
    peerConnectionTimeout: relay ? 10_000 : 15_000,
  });
}

export type PubFilter = (participant: RemoteParticipant, pub: RemoteTrackPublication) => boolean;

/**
 * Keeps subscriptions equal to what `filter` says, now and for every later publication.
 * Returns a function that re-evaluates everything (call it when the filter's inputs change).
 */
export function manageSubscriptions(room: Room, filter: PubFilter): () => void {
  const wanted = new Map<string, boolean>();
  const consider = (pub: RemoteTrackPublication, participant: RemoteParticipant) => {
    const want = filter(participant, pub);
    if (wanted.get(pub.trackSid) === want) return;
    wanted.set(pub.trackSid, want);
    pub.setSubscribed(want);
  };
  const scan = () => {
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) consider(pub, participant);
    }
  };
  room
    .on(RoomEvent.TrackPublished, consider)
    .on(RoomEvent.TrackUnpublished, (pub) => wanted.delete(pub.trackSid))
    .on(RoomEvent.ParticipantConnected, scan)
    .on(RoomEvent.Connected, scan)
    .on(RoomEvent.Reconnected, scan);
  scan();
  return scan;
}

export function qualityLabel(q: ConnectionQuality): string {
  switch (q) {
    case ConnectionQuality.Excellent:
      return 'excellent';
    case ConnectionQuality.Good:
      return 'good';
    case ConnectionQuality.Poor:
      return 'poor';
    case ConnectionQuality.Lost:
      return 'lost';
    default:
      return 'unknown';
  }
}

export function stateLabel(state: ConnectionState): string {
  switch (state) {
    case ConnectionState.Connected:
      return 'connected';
    case ConnectionState.Connecting:
      return 'connecting';
    case ConnectionState.Reconnecting:
      return 'reconnecting';
    case ConnectionState.SignalReconnecting:
      return 'reconnecting (signal)';
    default:
      return 'disconnected';
  }
}

/** Common slug for identities; must match the server's identityFor(). */
export function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}
