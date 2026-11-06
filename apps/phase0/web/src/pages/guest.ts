// Guest page: publishes camera and microphone, plays the studio return, shows live numbers.
import '../style.css';
import {
  DisconnectReason,
  RoomEvent,
  Track,
  VideoQuality,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
} from 'livekit-client';
import { getToken, resolvePin } from '../lib/api.ts';
import { $, backToLauncher, params, setStatus, toneForState } from '../lib/dom.ts';
import { connectRoom, createRoom, manageSubscriptions, profileFromParams, qualityLabel, stateLabel } from '../lib/room.ts';
import { TrackStats, formatSummary, type StatsSummary } from '../lib/stats.ts';

const q = params();
const roomName = q.get('room') ?? backToLauncher();
const name = q.get('name') ?? backToLauncher();
const pin = (await resolvePin()) ?? backToLauncher();

const main = $<HTMLVideoElement>('#main');
const audio = $<HTMLAudioElement>('#audio');
const self = $<HTMLVideoElement>('#self');
const slate = $('#slate');
const slateText = $('#slate-text');
const statsEl = $<HTMLPreElement>('#stats');
const tap = $('#tap');
const muteBtn = $<HTMLButtonElement>('#mute');

$('#who').textContent = `${name} · ${roomName}`;

const profile = profileFromParams(q);
const room = createRoom(profile);
let upStats: TrackStats | undefined;
let downStats: TrackStats | undefined;
let lastUp: StatsSummary | undefined;
let lastDown: StatsSummary | undefined;
let connectedAt = 0;
let quality = 'unknown';
let leaving = false;

let statsError = '';

/**
 * The status pill tells the truth about media, not only about signaling.
 * The server's connection quality (excellent/good/poor) is computed from what it actually receives,
 * so it counts as proof of flow even when the browser's own sender statistics are missing.
 */
function refreshStatus(): void {
  if (room.state !== 'connected') return;
  const serverSeesMedia = quality === 'excellent' || quality === 'good' || quality === 'poor';
  const localSeesMedia = lastUp !== undefined && lastUp.kbps > 0;
  if (serverSeesMedia || localSeesMedia) {
    const path = lastUp?.path ?? 'path ?';
    const rate = lastUp ? `${lastUp.kbps} kbps` : 'sending';
    setStatus(`connected · ${path} · ${rate} · ${quality}`, path === 'relay' || quality === 'poor' ? 'warn' : 'ok');
  } else if (connectedAt && Date.now() - connectedAt > 8000) {
    setStatus('connected, but no media is flowing', 'bad');
  } else {
    setStatus('connected · starting media…', 'warn');
  }
}

manageSubscriptions(room, (participant) => participant.identity === 'studio');

room
  .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication) => {
    if (track.kind === Track.Kind.Video) {
      track.attach(main);
      pub.setVideoQuality(VideoQuality.HIGH);
      downStats = new TrackStats(track as RemoteVideoTrack, 'recv');
      slate.classList.add('hidden');
    } else if (track.kind === Track.Kind.Audio) {
      track.attach(audio);
    }
  })
  .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
    track.detach();
    if (track.kind === Track.Kind.Video) {
      downStats = undefined;
      slateText.textContent = 'Studio picture stopped.';
      slate.classList.remove('hidden');
    }
  })
  .on(RoomEvent.ConnectionStateChanged, (state) => {
    const label = stateLabel(state);
    if (label === 'connected') {
      connectedAt = Date.now();
      refreshStatus();
    } else {
      connectedAt = 0;
      setStatus(label, toneForState(label));
    }
  })
  .on(RoomEvent.ConnectionQualityChanged, (q, participant) => {
    if (participant.isLocal) {
      quality = qualityLabel(q);
      refreshStatus();
    }
  })
  .on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!room.canPlaybackAudio) {
      tap.classList.remove('hidden');
      $('#join').textContent = 'Tap for sound';
    }
  })
  .on(RoomEvent.Disconnected, (reason) => {
    if (leaving) return;
    setStatus(`disconnected (${reason === undefined ? 'unknown' : DisconnectReason[reason]})`, 'bad');
    slateText.textContent = 'Disconnected. Reload the page to try again.';
    slate.classList.remove('hidden');
  })
  .on(RoomEvent.MediaDevicesError, (err) => {
    setStatus(`device error: ${err.message}`, 'bad');
  });

$('#join').addEventListener('click', () => {
  tap.classList.add('hidden');
  if (room.state === 'disconnected') void start();
  else void room.startAudio();
});

async function start(): Promise<void> {
  try {
    setStatus('connecting…', 'warn');
    const { token, url } = await getToken('guest', roomName, name, pin);
    await connectRoom(room, url, token, q.get('relay') === '1');
    await room.localParticipant.enableCameraAndMicrophone();
    const cam = room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (cam) {
      cam.attach(self);
      upStats = new TrackStats(cam, 'send');
    }
    await room.startAudio();
    refreshStatus();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), 'bad');
    slateText.textContent = 'Could not join. Check the PIN and the network, then reload.';
  }
}

muteBtn.addEventListener('click', () => {
  const enabled = room.localParticipant.isMicrophoneEnabled;
  void room.localParticipant.setMicrophoneEnabled(!enabled).then(() => {
    muteBtn.textContent = enabled ? 'Unmute' : 'Mute';
    muteBtn.classList.toggle('danger', enabled);
  });
});

$('#toggle-stats').addEventListener('click', () => statsEl.classList.toggle('hidden'));

$('#leave').addEventListener('click', () => {
  leaving = true;
  void room.disconnect().then(() => location.replace('/'));
});

window.addEventListener('pagehide', () => {
  leaving = true;
  void room.disconnect();
});

setInterval(() => {
  if (room.state !== 'connected') return;
  void Promise.allSettled([upStats?.sample(), downStats?.sample()]).then(([up, down]) => {
    lastUp = up.status === 'fulfilled' ? up.value : undefined;
    lastDown = down.status === 'fulfilled' ? down.value : undefined;
    statsError = [up, down]
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason))
      .join('; ');
    refreshStatus();
    if (statsEl.classList.contains('hidden')) return;
    statsEl.textContent = [
      formatSummary('UP', lastUp),
      formatSummary('DOWN', lastDown),
      `server quality: ${quality}${upStats ? '' : ' · no camera track yet'}${statsError ? ` · stats error: ${statsError}` : ''}`,
      `target ${profile.height}p${profile.fps} ${profile.codec} ≤${profile.maxKbps} kbps${q.get('relay') === '1' ? ' · forced relay' : ''}`,
    ].join('\n');
  });
}, 1000);

setStatus('ready', 'muted');
