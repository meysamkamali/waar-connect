// /app/admin/station — on this PC, the admin picks which camera, microphone and capture inputs the
// pages use. Saved in this browser; the producer and the return page read it and show no device picker.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { clearStation, loadStation, saveStation, type Station as StationLock, type StationDevice } from '../lib/station.ts';

interface Devices {
  video: MediaDeviceInfo[];
  audio: MediaDeviceInfo[];
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
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      setError(`No permission for camera or microphone: ${err instanceof Error ? err.message : String(err)}`);
    }
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices({ video: all.filter((d) => d.kind === 'videoinput'), audio: all.filter((d) => d.kind === 'audioinput') });
  }

  useEffect(() => {
    void scan();
  }, []);

  const pick = (list: MediaDeviceInfo[] | undefined, id: string): StationDevice | null => {
    const d = list?.find((x) => x.deviceId === id);
    return d ? { id: d.deviceId, label: d.label || d.deviceId.slice(0, 8) } : null;
  };

  const save = () => {
    const lock: StationLock = {
      name: name.trim(),
      camera: pick(devices?.video, camera),
      mic: pick(devices?.audio, mic),
      returnVideo: pick(devices?.video, returnVideo),
      returnAudio: pick(devices?.audio, returnAudio),
      lockedAt: new Date().toISOString(),
    };
    saveStation(lock);
    setCurrent(lock);
  };

  const select = (list: MediaDeviceInfo[] | undefined, value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}>
      <option value="">browser default</option>
      {list?.map((d, i) => (
        <option value={d.deviceId} key={d.deviceId}>
          {d.label || `${d.kind} ${i + 1}`}
        </option>
      ))}
    </select>
  );

  return (
    <div class="screen page">
      {nav}
      {error && <p class="help bad">{error}</p>}
      <section>
        <h2>This station</h2>
        <p class="muted small">
          Choices here apply to this PC and this browser only. The producer and engineer screens use the camera and microphone below for face-to-face and talkback; the return feed page uses the
          capture inputs. Producers cannot change them.
        </p>
        {current ? (
          <p class="help">
            Locked {new Date(current.lockedAt).toLocaleString()}: {current.name || 'unnamed station'} · camera {current.camera?.label ?? 'default'} · mic {current.mic?.label ?? 'default'} · return picture{' '}
            {current.returnVideo?.label ?? 'default'} · return sound {current.returnAudio?.label ?? 'default'}
          </p>
        ) : (
          <p class="help">Not set yet; the pages use the browser defaults.</p>
        )}
        <div class="card form-grid">
          <label>
            Station name
            <input placeholder="e.g. PCR 1 producer desk" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label>
            Producer camera
            {select(devices?.video, camera, setCamera)}
          </label>
          <label>
            Producer microphone
            {select(devices?.audio, mic, setMic)}
          </label>
          <label>
            Return feed picture (capture input)
            {select(devices?.video, returnVideo, setReturnVideo)}
          </label>
          <label>
            Return feed sound (mix-minus input)
            {select(devices?.audio, returnAudio, setReturnAudio)}
          </label>
        </div>
        <div class="row" style={{ marginTop: '10px' }}>
          <button class="btn" onClick={save}>
            Lock these devices
          </button>
          <button class="btn secondary" onClick={() => void scan()}>
            Rescan devices
          </button>
          <button
            class="btn danger small"
            onClick={() => {
              clearStation();
              setCurrent(null);
            }}
          >
            Clear
          </button>
        </div>
      </section>
    </div>
  );
}
