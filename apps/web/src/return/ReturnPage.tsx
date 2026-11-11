// /app/return/:id — the studio PC publishes the program picture and the mix-minus as participant
// `studio`. The server sends it to every guest in the studio and to green-room guests the producer
// switches to it. Devices come from the admin's station lock; nothing to choose here.
// The page shows what goes out: the picture, the sound's level, the numbers of the stream, and who is
// in the room to receive it.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

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
import { Icon, Info } from '../components/ui.tsx';
import { connectRoom, createRoom, profileFromParams, stateLabel } from '../lib/room.ts';
import { loadStation, resolveDeviceId } from '../lib/station.ts';
import { TrackStats, type StatsSummary } from '../lib/stats.ts';

const HELD: Readonly<Record<string, string>> = { bandwidth: 'the network', cpu: "this PC's processor" };

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
  const [level, setLevel] = useState(0);

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

  // the mix-minus as it goes out: its level
  useEffect(() => {
    if (!tracks) {
      setLevel(0);
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(new MediaStream([tracks.a.mediaStreamTrack])).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const timer = window.setInterval(() => {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 100));
    }, 100);
    return () => {
      clearInterval(timer);
      void ctx.close().catch(() => undefined);
    };
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

  const tone = status === 'publishing' ? 'ok' : status === 'failed' ? 'bad' : status === 'idle' ? '' : 'warn';
  const tiles: [string, string, string?][] = [
    ['Picture', stats?.width && stats.height ? `${stats.width}×${stats.height}${stats.fps ? ` · ${Math.round(stats.fps)} fps` : ''}` : `${height}p${fps}`],
    ['Bitrate', stats ? `${stats.kbps} of ${kbps} kbit/s` : `up to ${kbps} kbit/s`, stats?.limited ? 'warn' : undefined],
    ['Packet loss', stats ? `${stats.lossPct} %` : '—', stats && stats.lossPct >= 2 ? 'bad' : stats && stats.lossPct >= 0.5 ? 'warn' : undefined],
    ['Round trip', stats?.rttMs !== undefined ? `${stats.rttMs} ms` : '—', stats?.rttMs !== undefined && stats.rttMs >= 400 ? 'bad' : undefined],
    ['Path', stats?.path ?? '—'],
  ];
  if (stats?.limited) tiles.push(['Held back by', HELD[stats.limited] ?? stats.limited, 'warn']);
  const pct = Math.round(level * 100);

  return (
    <div class="screen page return">
      <header class="adm-top">
        <div class="adm-top-title">
          <a class="nav-logo" href="/app/" aria-label="waar Connect: the station">
            <img src="/app/logo.svg" alt="" />
          </a>
          <h1>Return feed</h1>
          {pcrName && <span class="eng-tag">{pcrName}</span>}
          <span class={`adm-pill ${tone}`}>{status}</span>
          <Info
            side="start"
            below
            text={`This PC sends the studio's programme picture and the mix-minus to the guests. The picture and sound inputs are the ones the admin locked under “This station”. It sends ${height}p${fps} at up to ${kbps} kbit/s, the sound untouched (no echo canceller, no gain). With ?auto=1 at the end of the address the page starts by itself, for a kiosk.`}
          />
        </div>
        <div class="adm-actions">
          {!tracks ? (
            <button class="btn" onClick={() => void start()} disabled={status === 'starting'}>
              <Icon name="camera" /> Start the return feed
            </button>
          ) : (
            <button class="btn danger" onClick={() => void stop()}>
              <Icon name="close" /> Stop
            </button>
          )}
        </div>
      </header>
      {error && (
        <p class="help bad" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <div class="ret-grid">
        <section class="adm-card">
          <div class="guest-video ret-video">
            <VideoView track={video} />
            {!video && <div class="guest-novideo">not sending</div>}
          </div>
          <div class="ret-level">
            <span>Sound</span>
            <div class={`st-level ${tracks ? '' : 'none'}`} role="meter" aria-label="Level of the mix-minus" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div class="st-level-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div class="ret-tiles">
            {tiles.map(([k, v, t]) => (
              <div class={`ret-tile ${t ?? ''}`} key={k}>
                <span>{k}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </section>

        <aside class="adm-card">
          <div class="adm-group">
            <h3>Sources</h3>
            <div class="ret-source">
              <Icon name="camera" />
              <span>{station?.returnVideo?.label ?? 'browser default'}</span>
            </div>
            <div class="ret-source">
              <Icon name="mic" />
              <span>{station?.returnAudio?.label ?? 'browser default'}</span>
            </div>
          </div>
          <div class="adm-group">
            <h3>
              In the room <span class="lane-count">{present.length}</span>
            </h3>
            {present.length ? (
              <div class="adm-chips">
                {present.map((name, i) => (
                  <span class="eng-tag" key={`${name}-${i}`}>
                    {name}
                  </span>
                ))}
              </div>
            ) : (
              <div class="room-empty">Nobody yet</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
