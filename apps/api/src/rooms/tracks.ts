// Maps a LiveKit track to the routing engine's track source, from the publisher's role.
import { roleOf, type TrackSource as WcSource } from '@waar-connect/shared';
import { TrackSource } from 'livekit-server-sdk';

/**
 * null means the track is never routed: screen shares, unknown sources, unknown roles.
 * A staff microphone is always talkback; staff have no "plain" microphone in this system.
 */
export function routedSource(publisher: string, source: TrackSource): WcSource | null {
  switch (roleOf(publisher)) {
    case 'guest':
      if (source === TrackSource.CAMERA) return 'camera';
      if (source === TrackSource.MICROPHONE) return 'microphone';
      return null;
    case 'producer':
    case 'engineer':
      if (source === TrackSource.CAMERA) return 'camera';
      if (source === TrackSource.MICROPHONE) return 'talkback';
      return null;
    case 'studio':
      if (source === TrackSource.CAMERA) return 'program-video';
      if (source === TrackSource.MICROPHONE) return 'program-audio';
      return null;
    default:
      return null;
  }
}
