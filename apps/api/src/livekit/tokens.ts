// LiveKit access tokens per audience. Grants are the first lock: an output page cannot publish,
// a monitor is hidden. The studio return may subscribe since 2026-11-10: it draws the multiview
// guests into the multiview strip, and the routing engine gives it their cameras and nothing else.
import { AccessToken, TrackSource, type VideoGrant } from 'livekit-server-sdk';

export type Audience = 'guest' | 'staff' | 'studio' | 'output' | 'monitor';

export const TOKEN_TTL: Record<Audience, string> = {
  guest: '6h',
  staff: '12h',
  studio: '7d',
  output: '7d',
  monitor: '12h',
};

export interface TokenKeys {
  LIVEKIT_URL: string;
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
}

export interface MintedToken {
  url: string;
  token: string;
  identity: string;
}

export function grantFor(audience: Audience, room: string): VideoGrant {
  const base: VideoGrant = { roomJoin: true, room, canUpdateOwnMetadata: false };
  switch (audience) {
    case 'guest':
      return { ...base, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE] };
    case 'staff':
      return { ...base, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE] };
    case 'studio':
      return { ...base, canPublish: true, canSubscribe: true, canPublishData: false, canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE] };
    case 'output':
      return { ...base, canPublish: false, canSubscribe: true, canPublishData: false, hidden: true };
    case 'monitor':
      return { ...base, canPublish: false, canSubscribe: true, canPublishData: false, hidden: true };
  }
}

export async function mintToken(
  keys: TokenKeys,
  audience: Audience,
  params: { room: string; identity: string; name: string; metadata?: Record<string, unknown> },
): Promise<MintedToken> {
  const at = new AccessToken(keys.LIVEKIT_API_KEY, keys.LIVEKIT_API_SECRET, {
    identity: params.identity,
    name: params.name,
    ttl: TOKEN_TTL[audience],
  });
  at.addGrant(grantFor(audience, params.room));
  if (params.metadata) at.metadata = JSON.stringify(params.metadata);
  return { url: keys.LIVEKIT_URL, token: await at.toJwt(), identity: params.identity };
}
