// Monitor page: everyone in the room as a tile with picture, sound and receive numbers.
import '../style.css';
import {
  RoomEvent,
  Track,
  VideoQuality,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
} from 'livekit-client';
import { getToken, resolvePin } from '../lib/api.ts';
import { $, backToLauncher, mountFooter, params, setStatus, toneForState } from '../lib/dom.ts';
import { connectRoom, createRoom, manageSubscriptions, profileFromParams, qualityLabel, stateLabel } from '../lib/room.ts';
import { TrackStats, formatSummary } from '../lib/stats.ts';

const q = params();
const roomName = q.get('room') ?? backToLauncher();
const pin = (await resolvePin()) ?? backToLauncher();

const grid = $('#grid');
const empty = $('#empty');

interface Tile {
  root: HTMLElement;
  video: HTMLVideoElement;
  audio: HTMLAudioElement;
  name: HTMLElement;
  stats: HTMLElement;
  tracker: TrackStats | undefined;
  quality: string;
}

const tiles = new Map<string, Tile>();
const room = createRoom(profileFromParams(q));

manageSubscriptions(room, () => true);

function tileFor(participant: Participant): Tile {
  let tile = tiles.get(participant.identity);
  if (tile) return tile;
  const root = document.createElement('div');
  root.className = 'tile';
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  const audio = document.createElement('audio');
  audio.autoplay = true;
  const name = document.createElement('div');
  name.className = 'name';
  const stats = document.createElement('pre');
  stats.className = 'stats';
  stats.textContent = '—';
  root.append(video, audio, name, stats);
  grid.append(root);
  tile = { root, video, audio, name, stats, tracker: undefined, quality: 'unknown' };
  tiles.set(participant.identity, tile);
  label(participant);
  empty.classList.add('hidden');
  return tile;
}

function label(participant: Participant): void {
  const tile = tiles.get(participant.identity);
  if (tile) tile.name.textContent = `${participant.name || participant.identity} · ${tile.quality}`;
}

function removeTile(participant: Participant): void {
  const tile = tiles.get(participant.identity);
  if (!tile) return;
  tile.root.remove();
  tiles.delete(participant.identity);
  if (tiles.size === 0) empty.classList.remove('hidden');
}

room
  .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => tileFor(p))
  .on(RoomEvent.ParticipantDisconnected, removeTile)
  .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
    const tile = tileFor(participant);
    if (track.kind === Track.Kind.Video) {
      track.attach(tile.video);
      pub.setVideoQuality(VideoQuality.MEDIUM);
      tile.tracker = new TrackStats(track as RemoteVideoTrack, 'recv');
    } else if (track.kind === Track.Kind.Audio) {
      track.attach(tile.audio);
    }
  })
  .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
    track.detach();
    const tile = tiles.get(participant.identity);
    if (tile && track.kind === Track.Kind.Video) {
      tile.tracker = undefined;
      tile.stats.textContent = 'no video';
    }
  })
  .on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
    const tile = tiles.get(participant.identity);
    if (tile) {
      tile.quality = qualityLabel(quality);
      label(participant);
    }
  })
  .on(RoomEvent.Connected, () => {
    for (const p of room.remoteParticipants.values()) tileFor(p);
  })
  .on(RoomEvent.ConnectionStateChanged, (state) => {
    const label = stateLabel(state);
    setStatus(label, toneForState(label));
  })
  .on(RoomEvent.Disconnected, () => {
    setStatus('disconnected, retrying…', 'bad');
    retryLater();
  });

$('#sound').addEventListener('click', () => void room.startAudio());

let retryMs = 3000;
function retryLater(): void {
  setTimeout(() => void connect(), retryMs);
  retryMs = Math.min(retryMs * 2, 60_000);
}

async function connect(): Promise<void> {
  try {
    setStatus('connecting…', 'warn');
    const { token, url } = await getToken('monitor', roomName, 'monitor', pin);
    await connectRoom(room, url, token, false);
    retryMs = 3000;
  } catch (err) {
    setStatus(`${err instanceof Error ? err.message : String(err)} — retrying`, 'bad');
    retryLater();
  }
}

setInterval(() => {
  for (const tile of tiles.values()) {
    void tile.tracker?.sample().then((s) => {
      tile.stats.textContent = formatSummary('IN', s);
    });
  }
}, 2000);

window.addEventListener('pagehide', () => void room.disconnect());

void connect();
void mountFooter();
