// Out page: one guest, full frame, for an OBS browser source or a vMix web input.
// Starts by itself, reconnects by itself, and holds a receive buffer so a bad burst does not freeze on air.
import '../style.css';
import {
  RoomEvent,
  Track,
  VideoQuality,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
} from 'livekit-client';
import { getToken, resolvePin } from '../lib/api.ts';
import { runClock, syncClock } from '../lib/clock.ts';
import { $, backToLauncher, paramInt, params, setStatus } from '../lib/dom.ts';
import { connectRoom, createRoom, manageSubscriptions, profileFromParams, stateLabel } from '../lib/room.ts';
import { TrackStats, formatSummary } from '../lib/stats.ts';

const q = params();
const roomName = q.get('room') ?? backToLauncher();
const pin = (await resolvePin()) ?? backToLauncher();

const guestSlug = q.get('guest');
const wantedIdentity = guestSlug ? `guest:${guestSlug}` : undefined;
const bufferMs = paramInt('buffer', 400);

const main = $<HTMLVideoElement>('#main');
const audio = $<HTMLAudioElement>('#audio');
const slate = $('#slate');
const statsEl = $<HTMLPreElement>('#stats');
const tap = $('#tap');

$('#slate-title').textContent = guestSlug ?? 'any guest';
document.title = `waar Connect · out · ${guestSlug ?? 'any'}`;

if (q.get('stats') === '1') statsEl.classList.remove('hidden');
if (q.get('clock') === '1') {
  const clockEl = $('#clock');
  clockEl.classList.remove('hidden');
  void syncClock().then((sync) => runClock(clockEl, sync));
}

const room = createRoom(profileFromParams(q));
let current: RemoteParticipant | undefined;
let videoStats: TrackStats | undefined;

// Without ?guest=, follow the first guest who publishes and stay with them until they leave.
const rescan = manageSubscriptions(room, (participant) => {
  if (wantedIdentity) return participant.identity === wantedIdentity;
  if (!current && participant.identity.startsWith('guest:')) current = participant;
  return participant === current;
});

function applyBuffer(track: RemoteTrack): void {
  const receiver = track.receiver as (RTCRtpReceiver & { jitterBufferTarget?: number | null }) | undefined;
  if (receiver && 'jitterBufferTarget' in receiver) receiver.jitterBufferTarget = bufferMs;
}

room
  .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication) => {
    applyBuffer(track);
    if (track.kind === Track.Kind.Video) {
      track.attach(main);
      pub.setVideoQuality(VideoQuality.HIGH);
      videoStats = new TrackStats(track as RemoteVideoTrack, 'recv');
      slate.classList.add('hidden');
    } else if (track.kind === Track.Kind.Audio) {
      track.attach(audio);
    }
  })
  .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
    track.detach();
    if (track.kind === Track.Kind.Video) {
      videoStats = undefined;
      slate.classList.remove('hidden');
      setStatus('guest picture stopped', 'warn');
    }
  })
  .on(RoomEvent.ParticipantDisconnected, (participant) => {
    if (participant === current) {
      current = undefined;
      rescan();
    }
    if (participant.identity === wantedIdentity) setStatus('guest left', 'warn');
  })
  .on(RoomEvent.ConnectionStateChanged, (state) => {
    const label = stateLabel(state);
    setStatus(label === 'connected' ? 'waiting for the guest' : label, label === 'connected' ? 'muted' : 'warn');
  })
  .on(RoomEvent.AudioPlaybackStatusChanged, () => {
    // OBS allows autoplay; a desktop browser may not until a click.
    tap.classList.toggle('hidden', room.canPlaybackAudio);
  })
  .on(RoomEvent.Disconnected, () => {
    setStatus('disconnected, retrying…', 'bad');
    slate.classList.remove('hidden');
    retryLater();
  });

$('#sound').addEventListener('click', () => {
  tap.classList.add('hidden');
  void room.startAudio();
});

let retryMs = 3000;
function retryLater(): void {
  setTimeout(() => void connect(), retryMs);
  retryMs = Math.min(retryMs * 2, 60_000);
}

async function connect(): Promise<void> {
  try {
    setStatus('connecting…', 'warn');
    const { token, url } = await getToken('out', roomName, guestSlug ?? 'any', pin);
    await connectRoom(room, url, token, false);
    retryMs = 3000;
    await room.startAudio();
  } catch (err) {
    setStatus(`${err instanceof Error ? err.message : String(err)} — retrying`, 'bad');
    retryLater();
  }
}

setInterval(() => {
  if (statsEl.classList.contains('hidden')) return;
  void videoStats?.sample().then((s) => {
    statsEl.textContent = `${formatSummary('IN', s)}\nbuffer target ${bufferMs} ms · ${current?.identity ?? wantedIdentity ?? '—'}`;
  });
}, 1000);

void connect();
