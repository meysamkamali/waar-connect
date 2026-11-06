// The guest's LiveKit session as signals: place and tally from the server's attributes, the tracks
// the server lets through, cues and commands over the data channel, and the local camera and mic.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { computed, signal } from '@preact/signals';
import { defaultGuestState, guestFromAttributes, roleOf, STUDIO_IDENTITY, type GuestState } from '@waar-connect/shared';
import {
  ConnectionState,
  DisconnectReason,
  RoomEvent,
  Track,
  VideoQuality,
  type LocalVideoTrack,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
  type Room,
} from 'livekit-client';
import type { JoinInfo } from '../api.ts';
import { connectRoom, createRoom, profileFromParams, qualityLabel } from '../lib/room.ts';
import { TrackStats, type StatsSummary } from '../lib/stats.ts';

export type Status = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'removed';

export interface Cue {
  text: string;
  from: string;
  at: number;
}

export interface VideoTile {
  identity: string;
  name: string;
  track: RemoteVideoTrack;
}

export interface DeviceChoice {
  videoDeviceId?: string;
  audioDeviceId?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class GuestSession {
  readonly room: Room;
  readonly state = signal<GuestState>(defaultGuestState(''));
  readonly status = signal<Status>('idle');
  readonly error = signal<string | null>(null);
  readonly quality = signal('unknown');
  readonly up = signal<StatsSummary | undefined>(undefined);
  readonly cue = signal<Cue | null>(null);
  readonly handRaised = signal(false);
  readonly micEnabled = signal(true);
  readonly localVideo = signal<LocalVideoTrack | null>(null);
  readonly programVideo = signal<RemoteVideoTrack | null>(null);
  readonly faceVideo = signal<RemoteVideoTrack | null>(null);
  readonly guestVideos = signal<VideoTile[]>([]);
  readonly audioTracks = signal<RemoteAudioTrack[]>([]);
  /** What fills the screen: the producer's face when they come face to face, otherwise the program. */
  readonly mainVideo = computed(() => this.faceVideo.value ?? this.programVideo.value);

  #upStats: TrackStats | undefined;
  #timer: number | undefined;

  constructor() {
    this.room = createRoom(profileFromParams(new URLSearchParams(location.search)));
    this.room
      .on(RoomEvent.ConnectionStateChanged, (s) => {
        if (s === ConnectionState.Connected) this.status.value = 'connected';
        else if (s === ConnectionState.Connecting) this.status.value = 'connecting';
        else if (s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting) this.status.value = 'reconnecting';
      })
      .on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
        if (participant.isLocal) this.#readState();
      })
      .on(RoomEvent.TrackSubscribed, (track, pub, participant) => this.#onTrack(track, pub, participant))
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => this.#offTrack(track, participant))
      .on(RoomEvent.ConnectionQualityChanged, (q, participant) => {
        if (participant.isLocal) this.quality.value = qualityLabel(q);
      })
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => this.#onData(payload, participant, topic))
      .on(RoomEvent.Disconnected, (reason) => {
        this.status.value = reason === DisconnectReason.PARTICIPANT_REMOVED || reason === DisconnectReason.ROOM_DELETED ? 'removed' : 'disconnected';
      })
      .on(RoomEvent.MediaDevicesError, (err) => {
        this.error.value = err.message;
      });
  }

  async connect(info: JoinInfo, devices: DeviceChoice): Promise<void> {
    this.status.value = 'connecting';
    this.state.value = defaultGuestState(info.livekit.identity);
    await connectRoom(this.room, info.livekit.url, info.livekit.token, new URLSearchParams(location.search).get('relay') === '1');
    this.#readState();
    const lp = this.room.localParticipant;
    await lp.setCameraEnabled(true, devices.videoDeviceId ? { deviceId: devices.videoDeviceId } : undefined);
    await lp.setMicrophoneEnabled(true, devices.audioDeviceId ? { deviceId: devices.audioDeviceId } : undefined);
    const cam = lp.getTrackPublication(Track.Source.Camera)?.videoTrack ?? null;
    this.localVideo.value = cam;
    this.#upStats = cam ? new TrackStats(cam, 'send') : undefined;
    await this.room.startAudio().catch(() => undefined);
    this.#timer = window.setInterval(() => void this.#sample(), 2000);
  }

  async setMic(on: boolean): Promise<void> {
    await this.room.localParticipant.setMicrophoneEnabled(on);
    this.micEnabled.value = on;
  }

  async raiseHand(on: boolean): Promise<void> {
    this.handRaised.value = on;
    await this.#send('wc.hand', { on });
  }

  async askHelp(): Promise<void> {
    await this.#send('wc.help', {});
  }

  dismissCue(): void {
    this.cue.value = null;
  }

  /** Call once from a tap: browsers only start audio after a user gesture. */
  async unlockAudio(): Promise<void> {
    await this.room.startAudio().catch(() => undefined);
  }

  async leave(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    await this.room.disconnect();
  }

  #readState(): void {
    const lp = this.room.localParticipant;
    this.state.value = guestFromAttributes(lp.identity, lp.attributes);
  }

  #onTrack(track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant): void {
    if (track.kind === Track.Kind.Audio) {
      this.audioTracks.value = [...this.audioTracks.value, track as RemoteAudioTrack];
      return;
    }
    if (track.kind !== Track.Kind.Video) return;
    const video = track as RemoteVideoTrack;
    const role = roleOf(participant.identity);
    if (participant.identity === STUDIO_IDENTITY) {
      this.programVideo.value = video;
      pub.setVideoQuality(VideoQuality.HIGH);
    } else if (role === 'producer' || role === 'engineer') {
      this.faceVideo.value = video;
      pub.setVideoQuality(VideoQuality.MEDIUM);
    } else if (role === 'guest') {
      this.guestVideos.value = [
        ...this.guestVideos.value.filter((tile) => tile.identity !== participant.identity),
        { identity: participant.identity, name: participant.name || participant.identity, track: video },
      ];
      pub.setVideoQuality(VideoQuality.LOW);
    }
  }

  #offTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    if (track.kind === Track.Kind.Audio) {
      this.audioTracks.value = this.audioTracks.value.filter((t) => t.sid !== track.sid);
      return;
    }
    if (this.programVideo.value?.sid === track.sid) this.programVideo.value = null;
    if (this.faceVideo.value?.sid === track.sid) this.faceVideo.value = null;
    this.guestVideos.value = this.guestVideos.value.filter((tile) => tile.identity !== participant.identity || tile.track.sid !== track.sid);
  }

  #onData(payload: Uint8Array, participant: RemoteParticipant | undefined, topic: string | undefined): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(decoder.decode(payload)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (topic === 'wc.cue' && typeof message['text'] === 'string') {
      this.cue.value = { text: message['text'], from: participant?.name ?? '', at: Date.now() };
    } else if (topic === 'wc.cmd') {
      void this.#command(message);
    }
  }

  async #command(cmd: Record<string, unknown>): Promise<void> {
    if (cmd['mute'] === true) await this.setMic(false);
    if (cmd['mute'] === false) await this.setMic(true);
    const quality = cmd['quality'];
    if (quality === '720p' || quality === '540p' || quality === '360p') {
      const height = Number.parseInt(quality, 10);
      await this.localVideo.value?.restartTrack({ resolution: { width: Math.round((height * 16) / 9), height, frameRate: 25 } });
    }
    if (cmd['reload'] === true) location.reload();
  }

  async #send(topic: string, data: Record<string, unknown>): Promise<void> {
    await this.room.localParticipant.publishData(encoder.encode(JSON.stringify(data)), { reliable: true, topic }).catch(() => undefined);
  }

  async #sample(): Promise<void> {
    if (this.room.state !== ConnectionState.Connected) return;
    try {
      this.up.value = await this.#upStats?.sample();
    } catch {
      this.up.value = undefined;
    }
  }
}
