// The producer's or engineer's LiveKit session: a muted talk track and a muted face camera that the
// actions unmute, every guest's picture and sound as tiles, hand and help signals, and the third
// lock: track permissions so only the guests the server names can ever subscribe to the talk track.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { signal } from '@preact/signals';
import { roleOf, STAFF_ATTR } from '@waar-connect/shared';
import {
  ConnectionState,
  createLocalAudioTrack,
  createLocalVideoTrack,
  RoomEvent,
  Track,
  VideoQuality,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type ParticipantTrackPermission,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
  type Room,
} from 'livekit-client';
import type { StaffJoin } from '../api.ts';
import type { GuestReport } from '../lib/report.ts';
import { connectRoom, createRoom, profileFromParams, qualityLabel } from '../lib/room.ts';
import { loadStation, resolveDeviceId } from '../lib/station.ts';
import { TrackStats, type StatsSummary } from '../lib/stats.ts';

export interface StaffTile {
  identity: string;
  name: string;
  video: RemoteVideoTrack | null;
  audio: RemoteAudioTrack | null;
  quality: string;
  stats: StatsSummary | undefined;
}

const decoder = new TextDecoder();

export class StaffSession {
  readonly room: Room;
  readonly status = signal<'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('idle');
  readonly error = signal<string | null>(null);
  readonly tiles = signal<StaffTile[]>([]);
  readonly hands = signal<Record<string, boolean>>({});
  readonly helps = signal<Record<string, number>>({});
  /** What each guest's phone last said about itself (wc.report). */
  readonly reports = signal<Record<string, GuestReport>>({});
  readonly talking = signal(false);
  readonly facing = signal(false);
  readonly listening = signal(true);
  readonly talkAllowed = signal<string[]>([]);
  readonly localVideo = signal<LocalVideoTrack | null>(null);
  identity = '';

  #talk: LocalAudioTrack | null = null;
  #cam: LocalVideoTrack | null = null;
  #trackers = new Map<string, TrackStats>();
  #timer: number | undefined;

  constructor() {
    this.room = createRoom(profileFromParams(new URLSearchParams(location.search)));
    this.room
      .on(RoomEvent.ConnectionStateChanged, (s) => {
        if (s === ConnectionState.Connected) this.status.value = 'connected';
        else if (s === ConnectionState.Connecting) this.status.value = 'connecting';
        else if (s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting) this.status.value = 'reconnecting';
        else if (s === ConnectionState.Disconnected) this.status.value = 'disconnected';
      })
      .on(RoomEvent.ParticipantAttributesChanged, (_c, p) => {
        if (p.isLocal) this.#readAllowed();
      })
      .on(RoomEvent.ParticipantConnected, (p) => {
        this.#ensureTile(p);
        void this.#applyPermissions();
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        this.tiles.value = this.tiles.value.filter((t) => t.identity !== p.identity);
        this.#trackers.delete(p.identity);
        void this.#applyPermissions();
      })
      .on(RoomEvent.TrackSubscribed, (track, pub, p) => this.#onTrack(track, pub, p))
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => this.#offTrack(track, p))
      .on(RoomEvent.ConnectionQualityChanged, (q, p) => {
        if (!p.isLocal) this.#patch(p.identity, { quality: qualityLabel(q) });
      })
      .on(RoomEvent.DataReceived, (payload, p, _k, topic) => {
        if (!p) return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(decoder.decode(payload)) as Record<string, unknown>;
        } catch {
          return;
        }
        if (topic === 'wc.hand') this.hands.value = { ...this.hands.value, [p.identity]: msg['on'] === true };
        if (topic === 'wc.help') this.helps.value = { ...this.helps.value, [p.identity]: Date.now() };
        if (topic === 'wc.report') this.reports.value = { ...this.reports.value, [p.identity]: msg as unknown as GuestReport };
      });
  }

  async connect(join: StaffJoin): Promise<void> {
    this.identity = join.identity;
    this.status.value = 'connecting';
    await connectRoom(this.room, join.url, join.token, false);
    for (const p of this.room.remoteParticipants.values()) this.#ensureTile(p);
    // Devices come from the admin's station lock on this PC; the producer has no picker.
    const station = loadStation();
    const micId = await resolveDeviceId('audioinput', station?.mic ?? null);
    const camId = await resolveDeviceId('videoinput', station?.camera ?? null);
    // Talk track: published muted; "talk" unmutes it. The server names who may subscribe.
    this.#talk = await createLocalAudioTrack({ ...(micId ? { deviceId: micId } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    await this.#talk.mute();
    await this.room.localParticipant.publishTrack(this.#talk, { name: 'talkback', source: Track.Source.Microphone, dtx: false, red: true });
    // Face camera: published muted; "face to face" unmutes it for one guest.
    try {
      this.#cam = await createLocalVideoTrack({ ...(camId ? { deviceId: camId } : { facingMode: 'user' }), resolution: { width: 640, height: 360, frameRate: 25 } });
      await this.#cam.mute();
      await this.room.localParticipant.publishTrack(this.#cam, { name: 'face', source: Track.Source.Camera, simulcast: false, videoEncoding: { maxBitrate: 600_000, maxFramerate: 25 } });
      this.localVideo.value = this.#cam;
    } catch (err) {
      this.error.value = `No camera for face-to-face: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.#readAllowed();
    await this.#applyPermissions();
    await this.room.startAudio().catch(() => undefined);
    this.#timer = window.setInterval(() => void this.#sample(), 2000);
  }

  async setTalking(on: boolean): Promise<void> {
    if (!this.#talk) return;
    if (on) await this.#talk.unmute();
    else await this.#talk.mute();
    this.talking.value = on;
  }

  async setFacing(on: boolean): Promise<void> {
    if (!this.#cam) return;
    if (on) await this.#cam.unmute();
    else await this.#cam.mute();
    this.facing.value = on;
  }

  setListening(on: boolean): void {
    this.listening.value = on;
  }

  clearHelp(identity: string): void {
    const { [identity]: _gone, ...rest } = this.helps.value;
    this.helps.value = rest;
  }

  async leave(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    await this.room.disconnect();
  }

  #readAllowed(): void {
    const raw = this.room.localParticipant.attributes[STAFF_ATTR.talkAllowed] ?? '';
    this.talkAllowed.value = raw ? raw.split(',') : [];
    void this.#applyPermissions();
  }

  /** Third lock: only the guests the server lists may subscribe to the talk track; nobody else ever. */
  async #applyPermissions(): Promise<void> {
    const talkSid = this.#talk?.sid;
    const camSid = this.#cam?.sid;
    const allowed = new Set(this.talkAllowed.value);
    const perms: ParticipantTrackPermission[] = [];
    for (const p of this.room.remoteParticipants.values()) {
      const sids: string[] = [];
      if (camSid) sids.push(camSid);
      if (talkSid && roleOf(p.identity) === 'guest' && allowed.has(p.identity)) sids.push(talkSid);
      perms.push({ participantIdentity: p.identity, allowedTrackSids: sids });
    }
    this.room.localParticipant.setTrackSubscriptionPermissions(false, perms);
  }

  #ensureTile(p: RemoteParticipant): void {
    if (roleOf(p.identity) !== 'guest' && p.identity !== 'studio') return;
    if (this.tiles.value.some((t) => t.identity === p.identity)) return;
    this.tiles.value = [...this.tiles.value, { identity: p.identity, name: p.name || p.identity, video: null, audio: null, quality: 'unknown', stats: undefined }];
  }

  #patch(identity: string, patch: Partial<StaffTile>): void {
    this.tiles.value = this.tiles.value.map((t) => (t.identity === identity ? { ...t, ...patch } : t));
  }

  #onTrack(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant): void {
    this.#ensureTile(p);
    if (track.kind === Track.Kind.Video) {
      pub.setVideoQuality(VideoQuality.MEDIUM);
      this.#patch(p.identity, { video: track as RemoteVideoTrack });
      this.#trackers.set(p.identity, new TrackStats(track as RemoteVideoTrack, 'recv'));
    } else if (track.kind === Track.Kind.Audio) {
      this.#patch(p.identity, { audio: track as RemoteAudioTrack });
    }
  }

  #offTrack(track: RemoteTrack, p: RemoteParticipant): void {
    const tile = this.tiles.value.find((t) => t.identity === p.identity);
    if (!tile) return;
    if (tile.video?.sid === track.sid) {
      this.#patch(p.identity, { video: null, stats: undefined });
      this.#trackers.delete(p.identity);
    }
    if (tile.audio?.sid === track.sid) this.#patch(p.identity, { audio: null });
  }

  async #sample(): Promise<void> {
    if (this.room.state !== ConnectionState.Connected) return;
    for (const [identity, tracker] of this.#trackers) {
      try {
        this.#patch(identity, { stats: await tracker.sample() });
      } catch {
        // tile may have gone
      }
    }
  }
}
