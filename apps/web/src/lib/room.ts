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
} from 'livekit-client';

export interface PublishProfile {
  height: number;
  fps: number;
  maxKbps: number;
  codec: 'h264' | 'vp8';
}

const HEIGHTS = [360, 540, 720, 1080];
const RATES = [25, 30, 50];

/** `?res=720&fps=25&kbps=2500&codec=h264`; defaults suit a 50 Hz station and a phone uplink. */
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
    maxKbps: Number.isFinite(kbps) && kbps >= 200 ? kbps : defaultKbps,
    codec: p.get('codec') === 'vp8' ? 'vp8' : 'h264',
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
      simulcast: true,
      videoCodec: profile.codec,
      videoEncoding: { maxBitrate: profile.maxKbps * 1000, maxFramerate: profile.fps },
      videoSimulcastLayers: [
        new VideoPreset(320, 180, 150_000, profile.fps),
        new VideoPreset(640, 360, 500_000, profile.fps),
      ],
      audioPreset: AudioPresets.music,
      dtx: false,
      red: true,
      stopMicTrackOnMute: false,
    },
  };
  return new Room(options);
}

export async function connectRoom(room: Room, url: string, token: string, relay: boolean): Promise<void> {
  await room.connect(
    url,
    token,
    relay ? { autoSubscribe: false, rtcConfig: { iceTransportPolicy: 'relay' } } : { autoSubscribe: false },
  );
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
