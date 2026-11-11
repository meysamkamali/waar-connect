// /app/admin/station — on this PC, the admin picks which camera, microphone and capture inputs the
// pages use. Saved in this browser; the producer and the return page read it and show no device picker.
// Each choice shows what it gives: the camera's picture, the microphone's level. So the right input is
// picked by looking and listening, not by its name.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon, Info } from '../components/ui.tsx';
import { clearStation, loadStation, saveStation, type Station as StationLock, type StationDevice } from '../lib/station.ts';

interface Devices {
  video: MediaDeviceInfo[];
  audio: MediaDeviceInfo[];
}

const stop = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

/** The picture this input gives, live. `ready` holds it back until the browser has given its permission. */
function Picture({ deviceId, ready }: { deviceId: string; ready: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'wait' | 'live' | 'none'>('wait');
  useEffect(() => {
    if (!ready) return;
    let stream: MediaStream | null = null;
    let gone = false;
    setState('wait');
    navigator.mediaDevices
      .getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true })
      .then((s) => {
        if (gone) return stop(s);
        stream = s;
        if (ref.current) ref.current.srcObject = s;
        setState('live');
      })
      .catch(() => {
        if (!gone) setState('none');
      });
    return () => {
      gone = true;
      stop(stream);
      if (ref.current) ref.current.srcObject = null;
    };
  }, [deviceId, ready]);
  return (
    <div class="st-picture">
      <video ref={ref} autoPlay muted playsInline />
      {state !== 'live' && <span>{state === 'none' ? 'no picture' : '…'}</span>}
    </div>
  );
}

/** The level this input gives, live, as a bar. */
function Level({ deviceId, ready }: { deviceId: string; ready: boolean }) {
  const [level, setLevel] = useState(0);
  const [none, setNone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: number | undefined;
    let gone = false;
    setNone(false);
    setLevel(0);
    navigator.mediaDevices
      // as it comes in: no echo canceller or gain riding on a line input
      .getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((s) => {
        if (gone) return stop(s);
        stream = s;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        timer = window.setInterval(() => {
          // a page that was not touched yet keeps its audio clock stopped; it starts on the first click
          if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, peak / 100));
        }, 100);
      })
      .catch(() => {
        if (!gone) setNone(true);
      });
    return () => {
      gone = true;
      if (timer !== undefined) clearInterval(timer);
      stop(stream);
      void ctx?.close().catch(() => undefined);
    };
  }, [deviceId, ready]);
  const pct = Math.round(level * 100);
  return (
    <div class={`st-level ${none ? 'none' : ''}`} role="meter" aria-label="Sound level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div class="st-level-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Station({ nav }: { nav: ComponentChildren }) {
  const [devices, setDevices] = useState<Devices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<StationLock | null>(() => loadStation());
  const [name, setName] = useState(current?.name ?? '');
  const [camera, setCamera] = useState(current?.camera?.id ?? '');
  const [mic, setMic] = useState(current?.mic?.id ?? '');
  const [returnVideo, setReturnVideo] = useState(current?.returnVideo?.id ?? '');
  const [returnAudio, setReturnAudio] = useState(current?.returnAudio?.id ?? '');

  async function scan(): Promise<void> {
    setError(null);
    try {
      // Labels only appear after a permission; the stream is stopped at once.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
      stop(stream);
    } catch (err) {
      setError(`No permission for camera or microphone: ${err instanceof Error ? err.message : String(err)}`);
    }
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices({ video: all.filter((d) => d.kind === 'videoinput'), audio: all.filter((d) => d.kind === 'audioinput') });
  }

  useEffect(() => {
    void scan();
  }, []);

  const pick = (list: MediaDeviceInfo[] | undefined, id: string, kept: StationDevice | null | undefined): StationDevice | null => {
    const d = list?.find((x) => x.deviceId === id);
    if (d) return { id: d.deviceId, label: d.label || d.deviceId.slice(0, 8) };
    return id && kept?.id === id ? kept : null; // unplugged right now: the lock keeps it
  };

  const save = () => {
    const lock: StationLock = {
      name: name.trim(),
      camera: pick(devices?.video, camera, current?.camera),
      mic: pick(devices?.audio, mic, current?.mic),
      returnVideo: pick(devices?.video, returnVideo, current?.returnVideo),
      returnAudio: pick(devices?.audio, returnAudio, current?.returnAudio),
      lockedAt: new Date().toISOString(),
    };
    saveStation(lock);
    setCurrent(lock);
  };

  const dirty =
    !current || name.trim() !== current.name || camera !== (current.camera?.id ?? '') || mic !== (current.mic?.id ?? '') || returnVideo !== (current.returnVideo?.id ?? '') || returnAudio !== (current.returnAudio?.id ?? '');

  const select = (label: string, list: MediaDeviceInfo[] | undefined, value: string, kept: StationDevice | null | undefined, onChange: (v: string) => void) => (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}>
        <option value="">browser default</option>
        {value && kept?.id === value && !list?.some((d) => d.deviceId === value) ? <option value={value}>{kept.label} · not connected</option> : null}
        {list?.map((d, i) => (
          <option value={d.deviceId} key={d.deviceId}>
            {d.label || `${d.kind === 'videoinput' ? 'Camera' : 'Input'} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );

  const ready = devices !== null;
  const locked = current
    ? `${current.name || 'Unnamed station'} · camera ${current.camera?.label ?? 'default'} · microphone ${current.mic?.label ?? 'default'} · return picture ${current.returnVideo?.label ?? 'default'} · return sound ${current.returnAudio?.label ?? 'default'}`
    : 'Nothing is locked on this PC: the pages use the browser defaults.';

  return (
    <div class="screen page station">
      {nav}
      <header class="adm-top">
        <div class="adm-top-title">
          <h1>This station</h1>
          <Info
            side="start"
            below
            text="These choices are for this PC and this browser only. The producer's and engineer's screens use the camera and microphone for face to face and talkback; the return feed page uses the capture inputs. Nobody at the desk can change them."
          />
        </div>
        <span class={`adm-pill ${current ? 'ok' : ''} tip tip-end tip-below`} data-tip={locked}>
          {current ? `Locked ${new Date(current.lockedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'Browser defaults'}
        </span>
      </header>
      {error && (
        <p class="help bad" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <section class="adm-card">
        <header class="adm-card-head">
          <div class="adm-fields st-name">
            <label>
              Station name
              <input placeholder="PCR 1 producer desk" value={name} maxLength={80} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
            </label>
          </div>
          <div class="adm-actions">
            <button class="btn secondary small" onClick={() => void scan()}>
              <Icon name="refresh" />
              Rescan
            </button>
            <button class="btn small" disabled={!dirty || !ready} onClick={save}>
              <Icon name="lock" />
              Lock devices
            </button>
          </div>
        </header>

        <div class="st-grid">
          <div class="st-desk">
            <h3>Producer desk</h3>
            <Picture deviceId={camera} ready={ready} />
            <div class="adm-fields">{select('Camera', devices?.video, camera, current?.camera, setCamera)}</div>
            <div class="adm-fields">{select('Microphone', devices?.audio, mic, current?.mic, setMic)}</div>
            <Level deviceId={mic} ready={ready} />
          </div>
          <div class="st-desk">
            <h3>
              Return feed
              <Info text="Used by the return feed page on the studio PC, when the return does not come from NDI: the capture input with the programme picture, and the input with the mix-minus." />
            </h3>
            <Picture deviceId={returnVideo} ready={ready} />
            <div class="adm-fields">{select('Picture · capture input', devices?.video, returnVideo, current?.returnVideo, setReturnVideo)}</div>
            <div class="adm-fields">{select('Sound · mix-minus input', devices?.audio, returnAudio, current?.returnAudio, setReturnAudio)}</div>
            <Level deviceId={returnAudio} ready={ready} />
          </div>
        </div>

        <footer class="adm-foot">
          <button
            class="btn ghost-danger small"
            disabled={!current}
            onClick={() => {
              clearStation();
              setCurrent(null);
            }}
          >
            <Icon name="trash" />
            Clear the lock
          </button>
        </footer>
      </section>
    </div>
  );
}
