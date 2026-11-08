// Full-screen view of one guest on the producer's monitor: the picture as large as the screen allows,
// the controls and the open connection panel beside it, the guest's sound alone if wanted, and a
// switch to take the browser itself full screen. Esc or the close button returns to the room.
import { useEffect, useRef, useState } from 'preact/hooks';
import { GuestControls, GuestVideo, guestName, type GuestCardProps } from './GuestCard.tsx';

export function GuestFocus(p: GuestCardProps & { solo: boolean; onSolo: (on: boolean) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(document.fullscreenElement !== null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) p.onClose();
    };
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void ref.current?.requestFullscreen().catch(() => undefined);
  };

  const g = p.state;
  const place = g.place === 'lobby' ? 'at the door' : g.place === 'green' ? 'in the green room' : g.place === 'studio' ? 'in the studio' : 'left';

  return (
    <div class="focus" ref={ref}>
      <GuestVideo {...p} onFocus={undefined} className="focus-video" />
      <aside class="focus-panel">
        <header class="row between">
          <div>
            <h2 style={{ margin: 0 }}>{guestName(p)}</h2>
            <div class="muted small">
              {place}
              {!p.connected && ' · not connected'}
            </div>
          </div>
          <div class="row">
            <button class="btn secondary small" onClick={toggleFullscreen}>
              {fullscreen ? 'Leave monitor full screen' : 'Monitor full screen'}
            </button>
            <button class="btn secondary small" onClick={p.onClose} title="Esc">
              Close ✕
            </button>
          </div>
        </header>
        <label class="inline">
          <input type="checkbox" checked={p.solo} onChange={(e) => p.onSolo((e.currentTarget as HTMLInputElement).checked)} /> only this guest's sound in my headphones
        </label>
        <GuestControls {...p} openConn />
      </aside>
    </div>
  );
}
