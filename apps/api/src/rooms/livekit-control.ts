// The slice of LiveKit's server API the room controller needs, behind an interface so tests can fake it.
import { DataPacket_Kind, RoomServiceClient, type TrackSource } from 'livekit-server-sdk';

export interface TrackSnapshot {
  sid: string;
  name: string;
  source: TrackSource;
  muted: boolean;
}

export interface ParticipantSnapshot {
  identity: string;
  name: string;
  attributes: Record<string, string>;
  tracks: TrackSnapshot[];
}

export interface LiveKitControl {
  listParticipants(room: string): Promise<ParticipantSnapshot[]>;
  updateAttributes(room: string, identity: string, attributes: Record<string, string>): Promise<void>;
  updateSubscriptions(room: string, identity: string, trackSids: string[], subscribe: boolean): Promise<void>;
  /** identities null = everyone in the room. */
  sendData(room: string, identities: string[] | null, topic: string, payload: unknown): Promise<void>;
  removeParticipant(room: string, identity: string): Promise<void>;
}

export class LiveKitRoomControl implements LiveKitControl {
  private readonly svc: RoomServiceClient;

  constructor(svc: RoomServiceClient) {
    this.svc = svc;
  }

  async listParticipants(room: string): Promise<ParticipantSnapshot[]> {
    const list = await this.svc.listParticipants(room);
    return list.map((p) => ({
      identity: p.identity,
      name: p.name,
      attributes: { ...p.attributes },
      tracks: p.tracks.map((t) => ({ sid: t.sid, name: t.name, source: t.source, muted: t.muted })),
    }));
  }

  async updateAttributes(room: string, identity: string, attributes: Record<string, string>): Promise<void> {
    await this.svc.updateParticipant(room, identity, { attributes });
  }

  async updateSubscriptions(room: string, identity: string, trackSids: string[], subscribe: boolean): Promise<void> {
    await this.svc.updateSubscriptions(room, identity, trackSids, subscribe);
  }

  async sendData(room: string, identities: string[] | null, topic: string, payload: unknown): Promise<void> {
    const data = new TextEncoder().encode(JSON.stringify(payload));
    await this.svc.sendData(room, data, DataPacket_Kind.RELIABLE, identities ? { destinationIdentities: identities, topic } : { topic });
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    await this.svc.removeParticipant(room, identity);
  }
}
