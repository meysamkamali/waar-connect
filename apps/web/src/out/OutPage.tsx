// /app/out/:id/:slot — one output slot, full frame, on the studio PC (later the NDI/SDI gateway).
// The server sends this page exactly the guest who sits on the slot in the studio; the page attaches
// what arrives, holds a receive buffer so a bad burst does not freeze on air, and shows a slate otherwise.
// While a guest is on, the frame is clean: nothing lies over the picture. The page's state shows on
// the slate, and for a few seconds when the mouse moves (or always with ?stats=1).
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { roleOf } from '@waar-connect/shared';
import { RoomEvent, Track, VideoQuality, type RemoteAudioTrack, type RemoteTrack, type RemoteTrackPublication, type RemoteVideoTrack } from 'livekit-client';
import { ApiError, outputToken } from '../api.ts';
import { Icon } from '../components/ui.tsx';
import { connectRoom, createRoom, profileFromParams, stateLabel } from '../lib/room.ts';
import { formatSummary, TrackStats, type StatsSummary } from '../lib/stats.ts';

/** The slot is empty: the slate is out. */
const WAITING = 'waiting for a guest';

export function OutPage({ id, slot }: { id?: string; slot?: string }) {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const room = useMemo(() => createRoom(profileFromParams(params)), [params]);
  const bufferMs = Math.min(2000, Math.max(0, Number(params.get('buffer')) || 400));
  const showStats = params.get('stats') === '1';
  const slotNo = Number(slot) || 1;
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState('connecting…');
  const [name, setName] = useState(`slot ${slotNo}`);
  const [pcrName, setPcrName] = useState('');
  const [hasVideo, setHasVideo] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [stats, setStats] = useState<StatsSummary | undefined>(undefined);
  /** The mouse moved: the state shows over the picture for a moment. */
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const tracker = useRef<TrackStats | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    let retryMs = 3000;
    let stopped = false;
    let timer: number | undefined;

    const applyBuffer = (track: RemoteTrack) => {
      const receiver = track.receiver as (RTCRtpReceiver & { jitterBufferTarget?: number | null }) | undefined;
      if (receiver && 'jitterBufferTarget' in receiver) receiver.jitterBufferTarget = bufferMs;
    };

    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p) => {
        // Client-side lock: an output shows guests and nothing else, whatever arrives.
        if (roleOf(p.identity) !== 'guest') {
          pub.setSubscribed(false);
          return;
        }
        applyBuffer(track);
        if (track.kind === Track.Kind.Video && videoRef.current) {
          (track as RemoteVideoTrack).attach(videoRef.current);
          pub.setVideoQuality(VideoQuality.HIGH);
          tracker.current = new TrackStats(track as RemoteVideoTrack, 'recv');
          setHasVideo(true);
          setStatus(`on: ${p.name || p.identity}`);
        } else if (track.kind === Track.Kind.Audio && audioRef.current) {
          (track as RemoteAudioTrack).attach(audioRef.current);
        }
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach();
        if (track.kind === Track.Kind.Video) {
          tracker.current = undefined;
          setHasVideo(false);
          setStats(undefined);
          setStatus(WAITING);
        }
      })
      .on(RoomEvent.ConnectionStateChanged, (s) => setStatus(stateLabel(s)))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsTap(!room.canPlaybackAudio))
      .on(RoomEvent.Disconnected, () => {
        if (stopped) return;
        setHasVideo(false);
        setStatus('disconnected, retrying…');
        timer = window.setTimeout(() => void connect(), retryMs);
        retryMs = Math.min(retryMs * 2, 60_000);
      });

    async function connect(): Promise<void> {
      try {
        setStatus('connecting…');
        const t = await outputToken(id!, slotNo);
        setName(t.name);
        setPcrName(t.pcrName);
        document.title = `waar Connect · ${t.pcrName} · ${t.name}`;
        await connectRoom(room, t.url, t.token, false);
        retryMs = 3000;
        setStatus(WAITING);
        await room.startAudio().catch(() => undefined);
      } catch (err) {
        setStatus(`${err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err)} — retrying`);
        timer = window.setTimeout(() => void connect(), retryMs);
        retryMs = Math.min(retryMs * 2, 60_000);
      }
    }

    void connect();
    const statsTimer = window.setInterval(() => {
      if (showStats) void tracker.current?.sample().then(setStats).catch(() => undefined);
    }, 1000);
    const bye = () => {
      stopped = true;
      void room.disconnect();
    };
    window.addEventListener('pagehide', bye);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (peekTimer.current) clearTimeout(peekTimer.current);
      clearInterval(statsTimer);
      window.removeEventListener('pagehide', bye);
      void room.disconnect();
    };
  }, [id, slotNo, room]);

  if (!id) return <div class="screen center">No studio.</div>;

  const showPeek = () => {
    setPeek(true);
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek(false), 3000);
  };
  const tone = hasVideo ? 'ok' : status === WAITING ? '' : /retrying|disconnected/.test(status) ? 'bad' : 'warn';

  return (
    <div class="screen stage out" onMouseMove={showPeek}>
      <video ref={videoRef} class={`main ${hasVideo ? '' : 'hidden'}`} autoplay playsInline />
      <audio ref={audioRef} autoplay />
      {!hasVideo && (
        <div class="out-slate">
          <img src="/app/logo.svg" alt="" />
          <div class="out-slot">{name}</div>
          <div class="out-pcr">{pcrName || 'waar Connect'}</div>
        </div>
      )}
      {(!hasVideo || peek || showStats) && <div class={`out-status adm-pill ${tone}`}>{status}</div>}
      {showStats && <pre class="stats stage-stats">{`${formatSummary('IN', stats)}\nbuffer target ${bufferMs} ms`}</pre>}
      {needsTap && (
        <div class="tap" onClick={() => void room.startAudio().then(() => setNeedsTap(false))}>
          <button class="btn big">
            <Icon name="sound" /> Enable sound
          </button>
        </div>
      )}
    </div>
  );
}
