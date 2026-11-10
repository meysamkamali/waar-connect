// Full-screen view of one guest on the producer's monitor: the picture as large as the screen allows,
// and beside it only what the producer does with this guest: whose sound is in the headphones, what
// the guest sees and hears, the move to the studio (or tally and bring back), and cues.
// The connection and phone settings are not here: they are on the guest's card in the room and on the
// engineer's page. Esc or the close button returns to the room.
import { useEffect, useRef, useState } from 'preact/hooks';
import { CueBox, GuestVideo, guestName, HearsSwitch, PeersSwitch, SeesSwitch, type GuestCardProps } from './GuestCard.tsx';

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
  const inLobby = g.place === 'lobby';
  const inGreen = g.place === 'green';
  const inStudio = g.place === 'studio';
  const place = inLobby ? 'at the door' : inGreen ? 'in the green room' : inStudio ? 'in the studio' : 'left';

  return (
    <div class="focus" ref={ref}>
      <GuestVideo {...p} onFocus={undefined} className="focus-video" />
      <aside class="focus-panel">
        <header class="focus-head">
          <div>
            <h2 class="focus-name">{guestName(p)}</h2>
            <div class="focus-place">
              <span class={`dot ${p.connected ? 'ok' : ''}`} />
              {place}
              {!p.connected && ' · not connected'}
              {inStudio && g.tally !== 'off' && <span class={`tally ${g.tally}`}>{g.tally === 'onair' ? 'ON AIR' : 'STAND BY'}</span>}
            </div>
          </div>
          <div class="focus-tools">
            <button class="btn secondary small" onClick={toggleFullscreen}>
              {fullscreen ? 'Leave full screen' : 'Monitor full screen'}
            </button>
            <button class="btn secondary small" onClick={p.onClose} title="Esc">
              Close ✕
            </button>
          </div>
        </header>

        <section class="focus-block">
          <h3>My headphones</h3>
          <span class="seg wide">
            <button class={p.solo ? 'on' : ''} onClick={() => p.onSolo(true)}>
              this guest only
            </button>
            <button class={p.solo ? '' : 'on'} onClick={() => p.onSolo(false)}>
              all guests
            </button>
          </span>
        </section>

        {inLobby && (
          <button class="btn focus-main" onClick={() => p.onAction({ type: 'admit', guest: g.identity })}>
            Receive into green room
          </button>
        )}

        {inGreen && (
          <>
            <section class="focus-block">
              <h3>Guest sees</h3>
              <SeesSwitch p={p} wide />
            </section>
            <section class="focus-block">
              <h3>Guest hears</h3>
              <HearsSwitch p={p} wide />
            </section>
            {p.others.length > 0 && (
              <section class="focus-block">
                <h3>Guest sees and hears these guests</h3>
                <PeersSwitch p={p} chips />
              </section>
            )}
            <button class="btn focus-main" onClick={() => p.onAction({ type: 'handoff', guest: g.identity })} disabled={!p.connected}>
              Send to studio →
            </button>
          </>
        )}

        {inStudio && (
          <>
            <section class="focus-block">
              <h3>Tally on the guest's screen</h3>
              <div class="focus-pair">
                <button class={`btn ${g.tally === 'standby' ? 'warn' : 'secondary'}`} onClick={() => p.onAction({ type: 'tally', guest: g.identity, tally: 'standby' })}>
                  Stand by
                </button>
                <button class={`btn ${g.tally === 'onair' ? 'danger' : 'secondary'}`} onClick={() => p.onAction({ type: 'tally', guest: g.identity, tally: 'onair' })}>
                  On air
                </button>
              </div>
            </section>
            {p.ifbAllowed && (
              <section class="focus-block">
                <h3>Talk to this guest on air (IFB)</h3>
                <div class="focus-pair">
                  <button class={`btn ${p.ifb ? 'warn' : 'secondary'}`} onClick={() => p.onAction({ type: 'ifb', guest: g.identity, on: !p.ifb })}>
                    {p.ifb ? 'IFB open' : 'Open IFB'}
                  </button>
                  <button class={`btn ${p.ifb && p.hearsMe ? 'live' : 'secondary'}`} disabled={!p.ifb} onClick={() => p.onHearMe(!p.hearsMe)}>
                    {p.ifb && p.hearsMe ? 'Talking' : 'Talk'}
                  </button>
                </div>
              </section>
            )}
            <button class="btn secondary focus-main" onClick={() => p.onAction({ type: 'bringBack', guest: g.identity })}>
              ← Bring back to the green room
            </button>
          </>
        )}

        {(inGreen || inStudio) && (
          <section class="focus-block">
            <h3>Cue on the guest's screen</h3>
            <CueBox p={p} />
          </section>
        )}
      </aside>
    </div>
  );
}
