// /app/return/:id — the studio PC publishes the program picture and the mix-minus as participant
// `studio`. The server sends it to every guest in the studio and to green-room guests the producer
// switches to it. Devices come from the admin's station lock; nothing to choose here.
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  AudioPresets,
  ConnectionState,
  createLocalAudioTrack,
  createLocalVideoTrack,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from 'livekit-client';
import { ApiError, studioToken } from '../api.ts';
import { VideoView } from '../components/media.tsx';
import { connectRoom, createRoom, profileFromParams, stateLabel } from '../lib/room.ts';
import { loadStation, resolveDeviceId } from '../lib/station.ts';
import { formatSummary, TrackStats, type StatsSummary } from '../lib/stats.ts';

export function ReturnPage({ id }: { id?: string }) {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const room = useMemo(() => createRoom(profileFromParams(params)), [params]);
  const station = useMemo(() => loadStation(), []);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const [pcrName, setPcrName] = useState('');
  const [video, setVideo] = useState<LocalVideoTrack | null>(null);
  const [present, setPresent] = useState<string[]>([]);
  const [stats, setStats] = useState<StatsSummary | undefined>(undefined);
  const [tracks, setTracks] = useState<{ v: LocalVideoTrack; a: LocalAudioTrack; s: TrackStats } | null>(null);

  const kbps = Math.min(8000, Math.max(500, Number(params.get('kbps')) || 2500));
  const fps = Number(params.get('fps')) === 50 ? 50 : 25;
  const height = Number(params.get('res')) === 1080 ? 1080 : 720;

  useEffect(() => {
    const who = () => setPresent([...room.remoteParticipants.values()].map((p) => p.name || p.identity));
    room
      .on(RoomEvent.ParticipantConnected, who)
      .on(RoomEvent.ParticipantDisconnected, who)
      .on(RoomEvent.Connected, who)
      .on(RoomEvent.ConnectionStateChanged, (s) => setStatus(s === ConnectionState.Connected ? (tracks ? 'publishing' : 'connected') : stateLabel(s)));
    const bye = () => void room.disconnect();
    window.addEventListener('pagehide', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      bye();
    };
  }, [room]);

  useEffect(() => {
    if (!tracks) return;
    const timer = setInterval(() => void tracks.s.sample().then(setStats).catch(() => undefined), 1000);
    return () => clearInterval(timer);
  }, [tracks]);

  async function start(): Promise<void> {
    if (!id) return;
    setError(null);
    setStatus('starting');
    try {
      const videoId = await resolveDeviceId('videoinput', station?.returnVideo ?? null);
      const audioId = await resolveDeviceId('audioinput', station?.returnAudio ?? null);
      const v = await createLocalVideoTrack({ ...(videoId ? { deviceId: videoId } : {}), resolution: { width: Math.round((height * 16) / 9), height, frameRate: fps } });
      const a = await createLocalAudioTrack({ ...(audioId ? { deviceId: audioId } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 });
      setVideo(v);
      if (room.state === ConnectionState.Disconnected) {
        const t = await studioToken(id);
        setPcrName(t.pcrName);
        await connectRoom(room, t.url, t.token, false);
      }
      await room.localParticipant.publishTrack(v, { name: 'program', source: Track.Source.Camera, simulcast: false, videoEncoding: { maxBitrate: kbps * 1000, maxFramerate: fps } });
      await room.localParticipant.publishTrack(a, { name: 'mix-minus', source: Track.Source.Microphone, audioPreset: AudioPresets.musicHighQuality, dtx: false, red: true });
      setTracks({ v, a, s: new TrackStats(v, 'send') });
      setStatus('publishing');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
      setStatus('failed');
    }
  }

  async function stop(): Promise<void> {
    if (tracks) {
      await room.localParticipant.unpublishTrack(tracks.v).catch(() => undefined);
      await room.localParticipant.unpublishTrack(tracks.a).catch(() => undefined);
      tracks.v.stop();
      tracks.a.stop();
    }
    setTracks(null);
    setVideo(null);
    setStats(undefined);
    setStatus(room.state === ConnectionState.Connected ? 'connected, not publishing' : 'idle');
  }

  useEffect(() => {
    if (params.get('auto') === '1') void start();
  }, []);

  const sources = station ? `picture ${station.returnVideo?.label ?? 'default camera'} · sound ${station.returnAudio?.label ?? 'default microphone'}` : 'station not set by the admin; browser defaults';

  return (
    <div class="screen page">
      <header class="row between">
        <div class="row" style={{ alignItems: 'center', gap: '12px' }}>
          <img class="logo" src="/app/logo.svg" alt="" />
          <h1>Return feed {pcrName && `· ${pcrName}`}</h1>
          <span class={`status ${status === 'publishing' ? 'ok' : status === 'failed' ? 'bad' : 'warn'}`}>{status}</span>
        </div>
        <div class="row">
          {!tracks ? (
            <button class="btn" onClick={() => void start()} disabled={status === 'starting'}>
              Start return feed
            </button>
          ) : (
            <button class="btn danger" onClick={() => void stop()}>
              Stop
            </button>
          )}
        </div>
      </header>
      {error && <p class="help bad">{error}</p>}
      <p class="muted small">Sources ({sources}). {height}p{fps}, up to {kbps} kbit/s, sound untouched (no echo cancellation or gain). Add ?auto=1 to the address for a kiosk that starts by itself.</p>
      <div class="card" style={{ maxWidth: '960px' }}>
        <div class="guest-video">
          <VideoView track={video} />
          {!video && <div class="guest-novideo">not publishing</div>}
        </div>
        <pre class="stats" style={{ marginTop: '8px' }}>
          {formatSummary('OUT', stats)}
        </pre>
      </div>
      <p class="muted small">In the room: {present.length ? present.join(', ') : 'nobody yet'}.</p>
    </div>
  );
}
