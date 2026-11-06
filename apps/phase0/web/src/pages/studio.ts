// Studio return page: publishes the program picture and the studio mix-minus as participant `studio`.
import '../style.css';
import {
  AudioPresets,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  createLocalVideoTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from 'livekit-client';
import { getToken, resolvePin } from '../lib/api.ts';
import { $, backToLauncher, mountFooter, params, setStatus, toneForState } from '../lib/dom.ts';
import { connectRoom, createRoom, profileFromParams, stateLabel } from '../lib/room.ts';
import { TrackStats, formatSummary } from '../lib/stats.ts';

const q = params();
const roomName = q.get('room') ?? backToLauncher();
const pin = (await resolvePin()) ?? backToLauncher();

const videoSel = $<HTMLSelectElement>('#video');
const audioSel = $<HTMLSelectElement>('#audio');
const resSel = $<HTMLSelectElement>('#res');
const fpsSel = $<HTMLSelectElement>('#fps');
const kbpsInput = $<HTMLInputElement>('#kbps');
const startBtn = $<HTMLButtonElement>('#start');
const stopBtn = $<HTMLButtonElement>('#stop');
const preview = $<HTMLVideoElement>('#preview');
const statsEl = $('#stats');
const message = $('#message');
const present = $('#present');

const room = createRoom(profileFromParams(q));
let videoTrack: LocalVideoTrack | undefined;
let audioTrack: LocalAudioTrack | undefined;
let stats: TrackStats | undefined;

const DEVICE_KEY = 'wc.studio.devices';

async function listDevices(): Promise<void> {
  const remembered = readRemembered();
  const fill = async (select: HTMLSelectElement, kind: MediaDeviceKind, chosen: string | undefined) => {
    const devices = await Room.getLocalDevices(kind, true);
    select.replaceChildren(
      ...devices.map((d, i) => {
        const option = document.createElement('option');
        option.value = d.deviceId;
        option.textContent = d.label || `${kind} ${i + 1}`;
        option.selected = d.deviceId === chosen;
        return option;
      }),
    );
  };
  await fill(videoSel, 'videoinput', remembered.video);
  await fill(audioSel, 'audioinput', remembered.audio);
}

function readRemembered(): { video?: string; audio?: string } {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_KEY) ?? '{}') as { video?: string; audio?: string };
  } catch {
    return {};
  }
}

function remember(): void {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ video: videoSel.value, audio: audioSel.value }));
  } catch {
    // fine without
  }
}

function updatePresent(): void {
  const names = [...room.remoteParticipants.values()].map((p) => p.name || p.identity);
  present.textContent = names.length ? names.join(', ') : 'nobody yet';
}

room
  .on(RoomEvent.ParticipantConnected, updatePresent)
  .on(RoomEvent.ParticipantDisconnected, updatePresent)
  .on(RoomEvent.Connected, updatePresent)
  .on(RoomEvent.ConnectionStateChanged, (state) => {
    const label = stateLabel(state);
    setStatus(label, toneForState(label));
  });

$('#form').addEventListener('submit', (event) => {
  event.preventDefault();
  void start();
});
stopBtn.addEventListener('click', () => void stop());
$('#refresh').addEventListener('click', () => void listDevices());

async function start(): Promise<void> {
  startBtn.disabled = true;
  message.textContent = '';
  remember();
  const height = Number(resSel.value);
  const fps = Number(fpsSel.value);
  const kbps = Math.min(8000, Math.max(500, Number(kbpsInput.value) || 2000));
  try {
    videoTrack = await createLocalVideoTrack({
      deviceId: videoSel.value,
      resolution: { width: Math.round((height * 16) / 9), height, frameRate: fps },
    });
    audioTrack = await createLocalAudioTrack({
      deviceId: audioSel.value,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    });
    videoTrack.attach(preview);

    if (room.state === 'disconnected') {
      setStatus('connecting…', 'warn');
      const { token, url } = await getToken('studio', roomName, 'studio', pin);
      await connectRoom(room, url, token, false);
    }
    await room.localParticipant.publishTrack(videoTrack, {
      name: 'program',
      source: Track.Source.Camera,
      simulcast: false,
      videoEncoding: { maxBitrate: kbps * 1000, maxFramerate: fps },
    });
    await room.localParticipant.publishTrack(audioTrack, {
      name: 'mix-minus',
      source: Track.Source.Microphone,
      audioPreset: AudioPresets.musicHighQuality,
      dtx: false,
      red: true,
    });
    stats = new TrackStats(videoTrack, 'send');
    stopBtn.disabled = false;
    setStatus('publishing', 'ok');
  } catch (err) {
    message.textContent = err instanceof Error ? err.message : String(err);
    setStatus('failed', 'bad');
    startBtn.disabled = false;
    await releaseTracks();
  }
}

async function releaseTracks(): Promise<void> {
  if (videoTrack) {
    await room.localParticipant.unpublishTrack(videoTrack).catch(() => undefined);
    videoTrack.stop();
    videoTrack.detach();
  }
  if (audioTrack) {
    await room.localParticipant.unpublishTrack(audioTrack).catch(() => undefined);
    audioTrack.stop();
  }
  videoTrack = undefined;
  audioTrack = undefined;
  stats = undefined;
}

async function stop(): Promise<void> {
  stopBtn.disabled = true;
  await releaseTracks();
  statsEl.textContent = '—';
  startBtn.disabled = false;
  setStatus('connected, not publishing', 'warn');
}

setInterval(() => {
  void stats?.sample().then((s) => {
    statsEl.textContent = formatSummary('OUT', s);
  });
}, 1000);

window.addEventListener('pagehide', () => void room.disconnect());

void listDevices().catch((err: unknown) => {
  message.textContent = `Devices: ${err instanceof Error ? err.message : String(err)}`;
});
void mountFooter();
