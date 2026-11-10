// The producer's or engineer's LiveKit session. The producer publishes a muted talk track and a muted
// face camera that the actions unmute; the engineer publishes nothing and only receives. Both get
// every guest's picture and sound as tiles (the engineer also the producer's), hand and help signals.
// The third lock lives here: track permissions, so only the guests the server names, and the
// engineer, can ever subscribe to the producer's talk track.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { signal } from '@preact/signals';
import { DEFAULT_FACE_PREFS, roleOf, STAFF_ATTR, type FacePrefs } from '@waar-connect/shared';
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
  /** The publisher switched its camera off (the producer's face camera outside face to face): no frames arrive. */
  videoMuted: boolean;
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
  /** The guest shown full screen: their picture is asked for in the highest layer, the rest medium. */
  readonly focus = signal<string | null>(null);
  readonly localVideo = signal<LocalVideoTrack | null>(null);
  /** Who is making sound right now, 0 to 1, as the server hears it. */
  readonly levels = signal<Record<string, number>>({});
  identity = '';
  role: 'producer' | 'engineer' = 'producer';

  #talk: LocalAudioTrack | null = null;
  #cam: LocalVideoTrack | null = null;
  #face: FacePrefs = { ...DEFAULT_FACE_PREFS };
  #faceBusy = false;
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
      .on(RoomEvent.TrackMuted, (pub, p) => {
        if (!p.isLocal && pub.kind === Track.Kind.Video) this.#patch(p.identity, { videoMuted: true });
      })
      .on(RoomEvent.TrackUnmuted, (pub, p) => {
        if (!p.isLocal && pub.kind === Track.Kind.Video) this.#patch(p.identity, { videoMuted: false });
      })
      .on(RoomEvent.ConnectionQualityChanged, (q, p) => {
        if (!p.isLocal) this.#patch(p.identity, { quality: qualityLabel(q) });
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const next: Record<string, number> = {};
        for (const s of speakers) next[s.identity] = s.audioLevel;
        this.levels.value = next;
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

  async connect(join: StaffJoin, face: FacePrefs = DEFAULT_FACE_PREFS): Promise<void> {
    this.identity = join.identity;
    this.role = join.role;
    this.status.value = 'connecting';
    await connectRoom(this.room, join.url, join.token, false);
    for (const p of this.room.remoteParticipants.values()) this.#ensureTile(p);
    if (this.role === 'engineer') {
      // Receive only: no talk track, no camera, so this PC is never asked for a microphone.
      await this.room.startAudio().catch(() => undefined);
      this.#timer = window.setInterval(() => void this.#sample(), 2000);
      return;
    }
    // Devices come from the admin's station lock on this PC; the producer has no picker.
    const station = loadStation();
    const micId = await resolveDeviceId('audioinput', station?.mic ?? null);
    // Talk track: published muted; "talk" unmutes it. The server names who may subscribe.
    this.#talk = await createLocalAudioTrack({ ...(micId ? { deviceId: micId } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    await this.#talk.mute();
    await this.room.localParticipant.publishTrack(this.#talk, { name: 'talkback', source: Track.Source.Microphone, dtx: false, red: true });
    // Face camera: published muted; "face to face" unmutes it for one guest.
    await this.#publishFace(face);
    this.#readAllowed();
    await this.#applyPermissions();
    await this.room.startAudio().catch(() => undefined);
    this.#timer = window.setInterval(() => void this.#sample(), 2000);
  }

  /** Publishes the face camera with the picture size, frame rate and bitrate the engineer set for this PCR. */
  async #publishFace(face: FacePrefs): Promise<void> {
    this.#face = { ...face };
    try {
      const camId = await resolveDeviceId('videoinput', loadStation()?.camera ?? null);
      const cam = await createLocalVideoTrack({
        ...(camId ? { deviceId: camId } : { facingMode: 'user' }),
        resolution: { width: Math.round((face.height * 16) / 9), height: face.height, frameRate: face.fps },
      });
      if (!this.facing.value) await cam.mute();
      await this.room.localParticipant.publishTrack(cam, { name: 'face', source: Track.Source.Camera, simulcast: false, videoEncoding: { maxBitrate: face.kbps * 1000, maxFramerate: face.fps } });
      this.#cam = cam;
      this.localVideo.value = cam;
      this.error.value = null;
    } catch (err) {
      this.#cam = null;
      this.localVideo.value = null;
      this.error.value = `No camera for face-to-face: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * The engineer changed how the face camera is sent. A muted camera is a stopped camera, so its
   * settings cannot be changed in place: the track is published again, muted or not as it was.
   */
  async applyFace(face: FacePrefs): Promise<void> {
    if (this.role !== 'producer' || this.room.state !== ConnectionState.Connected || this.#faceBusy) return;
    if (face.height === this.#face.height && face.fps === this.#face.fps && face.kbps === this.#face.kbps) return;
    this.#faceBusy = true;
    try {
      if (this.#cam) await this.room.localParticipant.unpublishTrack(this.#cam, true);
      await this.#publishFace(face);
      await this.#applyPermissions();
    } finally {
      this.#faceBusy = false;
    }
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

  setFocus(identity: string | null): void {
    this.focus.value = identity;
    for (const p of this.room.remoteParticipants.values()) {
      for (const pub of p.videoTrackPublications.values()) pub.setVideoQuality(p.identity === identity ? VideoQuality.HIGH : VideoQuality.MEDIUM);
    }
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

  /**
   * Third lock: only the guests the server lists may subscribe to the talk track, and the engineer,
   * who checks what a guest is told. Outputs, monitors, the return feed and other producers never.
   */
  async #applyPermissions(): Promise<void> {
    if (this.role === 'engineer') return; // publishes nothing
    const talkSid = this.#talk?.sid;
    const camSid = this.#cam?.sid;
    const allowed = new Set(this.talkAllowed.value);
    const perms: ParticipantTrackPermission[] = [];
    for (const p of this.room.remoteParticipants.values()) {
      const sids: string[] = [];
      if (camSid) sids.push(camSid);
      const role = roleOf(p.identity);
      if (talkSid && ((role === 'guest' && allowed.has(p.identity)) || role === 'engineer')) sids.push(talkSid);
      perms.push({ participantIdentity: p.identity, allowedTrackSids: sids });
    }
    this.room.localParticipant.setTrackSubscriptionPermissions(false, perms);
  }

  #ensureTile(p: RemoteParticipant): void {
    const role = roleOf(p.identity);
    const wanted = role === 'guest' || role === 'studio' || (this.role === 'engineer' && role === 'producer');
    if (!wanted) return;
    if (this.tiles.value.some((t) => t.identity === p.identity)) return;
    this.tiles.value = [...this.tiles.value, { identity: p.identity, name: p.name || p.identity, video: null, videoMuted: false, audio: null, quality: 'unknown', stats: undefined }];
  }

  #patch(identity: string, patch: Partial<StaffTile>): void {
    this.tiles.value = this.tiles.value.map((t) => (t.identity === identity ? { ...t, ...patch } : t));
  }

  #onTrack(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant): void {
    this.#ensureTile(p);
    if (track.kind === Track.Kind.Video) {
      pub.setVideoQuality(p.identity === this.focus.value ? VideoQuality.HIGH : VideoQuality.MEDIUM);
      this.#patch(p.identity, { video: track as RemoteVideoTrack, videoMuted: pub.isMuted });
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
