// Before joining: camera preview, microphone level, round trip to the studio, device choice.
import { createLocalAudioTrack, createLocalVideoTrack, Room, type LocalAudioTrack, type LocalVideoTrack } from 'livekit-client';
import { useEffect, useRef, useState } from 'preact/hooks';
import { measureRtt, type JoinInfo } from '../api.ts';
import { VideoView } from '../components/media.tsx';
import { t } from '../i18n/index.ts';
import type { DeviceChoice } from './session.ts';

export function DeviceCheck({ info, onJoin }: { info: JoinInfo; onJoin: (devices: DeviceChoice) => void }) {
  const [video, setVideo] = useState<LocalVideoTrack | null>(null);
  const [audio, setAudio] = useState<LocalAudioTrack | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>('');
  const [micId, setMicId] = useState<string>('');
  const [level, setLevel] = useState(0);
  const [rtt, setRtt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const tracksRef = useRef<{ v: LocalVideoTrack | null; a: LocalAudioTrack | null }>({ v: null, a: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await createLocalVideoTrack({ facingMode: 'user', resolution: { width: 640, height: 360, frameRate: 25 } });
        const a = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true });
        if (cancelled) {
          v.stop();
          a.stop();
          return;
        }
        tracksRef.current = { v, a };
        setVideo(v);
        setAudio(a);
        setCameras(await Room.getLocalDevices('videoinput', false));
        setMics(await Room.getLocalDevices('audioinput', false));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setRtt(await measureRtt().catch(() => null));
    })();
    return () => {
      cancelled = true;
      tracksRef.current.v?.stop();
      tracksRef.current.a?.stop();
    };
  }, []);

  // microphone level meter
  useEffect(() => {
    if (!audio) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([audio.mediaStreamTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 100));
    }, 100);
    return () => {
      clearInterval(timer);
      void ctx.close();
    };
  }, [audio]);

  async function switchCamera(id: string): Promise<void> {
    setCameraId(id);
    await video?.restartTrack({ deviceId: id });
  }

  async function switchMic(id: string): Promise<void> {
    setMicId(id);
    await audio?.restartTrack({ deviceId: id });
  }

  function join(): void {
    setStarting(true);
    tracksRef.current.v?.stop();
    tracksRef.current.a?.stop();
    tracksRef.current = { v: null, a: null };
    onJoin({ videoDeviceId: cameraId || undefined, audioDeviceId: micId || undefined });
  }

  return (
    <div class="screen center">
      <div class="card wide">
        <div class="row between">
          <img class="logo" src="/app/logo.svg" alt="" />
          <div class="muted">{info.episode.program} · {info.episode.title}</div>
        </div>
        <h1>{t('checkTitle')}</h1>
        <div class="preview">
          <VideoView track={video} className="preview-video" mirror />
          {!video && !error && <div class="preview-hint">{t('permission')}</div>}
          {error && <div class="preview-hint bad">{t('deviceError')}</div>}
        </div>
        <label>
          {t('camera')}
          <select value={cameraId} onChange={(e) => void switchCamera((e.currentTarget as HTMLSelectElement).value)}>
            {cameras.map((d, i) => (
              <option value={d.deviceId}>{d.label || `${t('camera')} ${i + 1}`}</option>
            ))}
          </select>
        </label>
        <label>
          {t('microphone')}
          <select value={micId} onChange={(e) => void switchMic((e.currentTarget as HTMLSelectElement).value)}>
            {mics.map((d, i) => (
              <option value={d.deviceId}>{d.label || `${t('microphone')} ${i + 1}`}</option>
            ))}
          </select>
          <div class="meter">
            <div class="meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
        </label>
        <div class="muted">
          {t('network')}: {rtt === null ? '…' : `${rtt} ms`}
        </div>
        <button class="btn big" disabled={!video || starting} onClick={join}>
          {t('join')}
        </button>
        <div class="muted small">{info.guest.displayName}</div>
      </div>
    </div>
  );
}
