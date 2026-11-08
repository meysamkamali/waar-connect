// One guest in the producer's view: picture, state, the controls for their place, and the connection
// panel with the phone's own report and the settings the producer can push to it.
// In the green room the producer chooses what the guest sees (nothing, the producer, the studio
// return) and hears (the producer, the studio mix-minus), then sends them to the studio; the server
// takes the first free slot.
import type { GuestState } from '@waar-connect/shared';
import { useState } from 'preact/hooks';
import type { GuestRecord, RoomAction } from '../api.ts';
import { VideoView } from '../components/media.tsx';
import { describeReport, phoneModel, type GuestReport } from '../lib/report.ts';
import { formatSummary } from '../lib/stats.ts';
import type { StaffTile } from './session.ts';

export type Sees = 'none' | 'me' | 'studio';

export interface GuestCardProps {
  state: GuestState;
  record: GuestRecord | undefined;
  tile: StaffTile | undefined;
  report: GuestReport | undefined;
  connected: boolean;
  outputNames: string[];
  ifbAllowed: boolean;
  ifb: boolean;
  /** The producer's voice is routed to this guest. */
  hearsMe: boolean;
  sees: Sees;
  hand: boolean;
  help: boolean;
  onAction: (action: RoomAction) => void;
  onHearMe: (on: boolean) => void;
  onSee: (mode: Sees) => void;
  onClearHelp: () => void;
}

const QUICK_CUES = ['30 seconds', 'Wrap up', 'Look at the camera', 'Speak louder', 'You are next'];

export function GuestCard(p: GuestCardProps) {
  const g = p.state;
  const [cue, setCue] = useState('');
  const name = p.record?.displayName ?? g.identity.replace(/^guest:/, '');
  const inLobby = g.place === 'lobby';
  const inGreen = g.place === 'green';
  const inStudio = g.place === 'studio';
  const slotName = (n: number) => p.outputNames[n - 1] ?? `Guest ${n}`;
  const cmd = (command: Record<string, unknown>) => p.onAction({ type: 'command', guest: g.identity, command });
  const r = p.report;
  const processing = r ? r.audio.ec || r.audio.ns || r.audio.agc : true;

  return (
    <article class={`guest-card ${g.place} ${p.connected ? '' : 'offline'}`}>
      <div class="guest-video">
        <VideoView track={p.tile?.video ?? null} />
        {!p.tile?.video && <div class="guest-novideo">{p.connected ? 'no picture yet' : 'not connected'}</div>}
        <div class="guest-overlay">
          <span class="name">{name}</span>
          {inStudio && <span class={`tally ${g.tally}`}>{g.tally === 'onair' ? 'ON AIR' : 'STAND BY'}</span>}
          {p.hand && <span class="flag">✋ hand</span>}
          {p.help && (
            <button class="flag bad" onClick={p.onClearHelp}>
              help!
            </button>
          )}
          {g.slot !== null && (
            <span class="slot">
              slot {g.slot} · {slotName(g.slot)}
            </span>
          )}
          {p.tile && <span class={`slot quality-${p.tile.quality}`}>{p.tile.quality}</span>}
        </div>
      </div>

      <div class="guest-controls">
        {inLobby && (
          <button class="btn" onClick={() => p.onAction({ type: 'admit', guest: g.identity })}>
            Receive into green room
          </button>
        )}

        {inGreen && (
          <>
            <div class="inline">
              guest sees
              <span class="seg">
                <button class={p.sees === 'none' ? 'on' : ''} onClick={() => p.onSee('none')}>
                  nothing
                </button>
                <button class={p.sees === 'me' ? 'on' : ''} onClick={() => p.onSee('me')}>
                  me
                </button>
                <button class={p.sees === 'studio' ? 'on' : ''} onClick={() => p.onSee('studio')}>
                  studio
                </button>
              </span>
            </div>
            <div class="inline">
              guest hears
              <span class="seg">
                <button class={p.hearsMe ? 'on' : ''} onClick={() => p.onHearMe(!p.hearsMe)}>
                  {p.hearsMe ? 'me ●' : 'me'}
                </button>
                <button class={g.studioSound ? 'on' : ''} onClick={() => p.onAction({ type: 'studioSound', guest: g.identity, on: !g.studioSound })}>
                  {g.studioSound ? 'studio ●' : 'studio'}
                </button>
              </span>
            </div>
            <button class="btn" onClick={() => p.onAction({ type: 'handoff', guest: g.identity })} disabled={!p.connected}>
              Send to studio →
            </button>
          </>
        )}

        {inStudio && (
          <>
            <button class={`btn ${g.tally === 'standby' ? 'warn' : 'secondary'}`} onClick={() => p.onAction({ type: 'tally', guest: g.identity, tally: 'standby' })}>
              Stand by
            </button>
            <button class={`btn ${g.tally === 'onair' ? 'danger' : 'secondary'}`} onClick={() => p.onAction({ type: 'tally', guest: g.identity, tally: 'onair' })}>
              On air
            </button>
            {p.ifbAllowed && (
              <label class="inline">
                <input type="checkbox" checked={p.ifb} onChange={(e) => p.onAction({ type: 'ifb', guest: g.identity, on: (e.currentTarget as HTMLInputElement).checked })} /> IFB
              </label>
            )}
            {p.ifb && (
              <button class={`btn ${p.hearsMe ? 'live' : 'secondary'}`} onClick={() => p.onHearMe(!p.hearsMe)}>
                {p.hearsMe ? 'Talking (IFB)' : 'Talk (IFB)'}
              </button>
            )}
            <button class="btn secondary" onClick={() => p.onAction({ type: 'bringBack', guest: g.identity })}>
              ← Bring back
            </button>
          </>
        )}

        {(inGreen || inStudio) && (
          <div class="cues">
            {QUICK_CUES.map((text) => (
              <button class="chip" key={text} onClick={() => p.onAction({ type: 'cue', to: g.identity, text })}>
                {text}
              </button>
            ))}
            <form
              class="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (cue.trim()) p.onAction({ type: 'cue', to: g.identity, text: cue.trim() });
                setCue('');
              }}
            >
              <input placeholder="Cue text…" value={cue} onInput={(e) => setCue((e.currentTarget as HTMLInputElement).value)} />
              <button class="btn secondary small" type="submit">
                Send
              </button>
            </form>
          </div>
        )}

        {p.connected && (
          <details class="conn">
            <summary>
              Connection and phone settings
              {p.tile?.stats && (
                <span class="muted small">
                  {' '}
                  · in {p.tile.stats.kbps} kbit/s · loss {p.tile.stats.lossPct}% {p.tile.stats.rttMs !== undefined && `· rtt ${p.tile.stats.rttMs} ms`}
                </span>
              )}
            </summary>
            <pre class="stats">
              {formatSummary('IN ', p.tile?.stats)}
              {'\n'}
              {r ? `${formatSummary('UP ', r.up)}\nphone: ${describeReport(r)}\n${phoneModel(r.ua)}${r.camera ? ` · ${r.camera}` : ''}${r.error ? `\nlast error: ${r.error}` : ''}` : 'phone: no report yet'}
            </pre>
            <div class="row">
              <button class="btn secondary small" onClick={() => cmd({ check: true })}>
                Check now
              </button>
              <span class="muted small">{r ? `report ${Math.round((Date.now() - r.at) / 1000)} s ago` : ''}</span>
            </div>
            <div class="row settings">
              <span class="muted small">picture</span>
              {[1080, 720, 540, 360].map((h) => (
                <button class={`chip ${r?.height === h ? 'on' : ''}`} key={h} onClick={() => cmd({ res: h })}>
                  {h}p
                </button>
              ))}
              {[25, 30].map((f) => (
                <button class={`chip ${r?.fps && Math.round(r.fps) === f ? 'on' : ''}`} key={f} onClick={() => cmd({ fps: f })}>
                  {f} fps
                </button>
              ))}
            </div>
            <div class="row settings">
              <span class="muted small">bitrate cap</span>
              {[800, 1500, 2500, 4000].map((k) => (
                <button class={`chip ${r?.kbps === k ? 'on' : ''}`} key={k} onClick={() => cmd({ kbps: k })}>
                  {k} kbit/s
                </button>
              ))}
            </div>
            <div class="row settings">
              <span class="muted small">codec</span>
              {(['h264', 'vp8'] as const).map((c) => (
                <button class={`chip ${r?.codec === c ? 'on' : ''}`} key={c} onClick={() => cmd({ codec: c })}>
                  {c} (reconnects)
                </button>
              ))}
              <span class="muted small">path</span>
              <button class={`chip ${r && !r.relay ? 'on' : ''}`} onClick={() => cmd({ relay: false })}>
                direct if possible
              </button>
              <button class={`chip ${r?.relay ? 'on' : ''}`} onClick={() => cmd({ relay: true })}>
                force relay (reconnects)
              </button>
            </div>
            <div class="row settings">
              <span class="muted small">camera</span>
              <button class={`chip ${r?.facing === 'user' ? 'on' : ''}`} onClick={() => cmd({ facing: 'user' })}>
                front
              </button>
              <button class={`chip ${r?.facing === 'environment' ? 'on' : ''}`} onClick={() => cmd({ facing: 'environment' })}>
                back
              </button>
              <span class="muted small">voice processing</span>
              <button class={`chip ${processing ? 'on' : ''}`} onClick={() => cmd({ audio: { ec: true, ns: true, agc: true } })}>
                on
              </button>
              <button class={`chip ${!processing ? 'on' : ''}`} onClick={() => cmd({ audio: { ec: false, ns: false, agc: false } })}>
                off (music, studio mic)
              </button>
            </div>
            <div class="row settings">
              <button class="chip" onClick={() => cmd({ mute: !(r?.micOn ?? true) })}>
                {r?.micOn === false ? 'unmute mic' : 'mute mic'}
              </button>
              <button class="chip" onClick={() => cmd({ reload: true })}>
                reload the phone page
              </button>
            </div>
          </details>
        )}

        <div class="row muted small">
          {p.record?.invites[0] && (
            <button class="link" onClick={() => void navigator.clipboard?.writeText(p.record!.invites[0]!.url)}>
              copy link
            </button>
          )}
          <button class="link bad" onClick={() => p.onAction({ type: 'kick', guest: g.identity })}>
            show out
          </button>
        </div>
      </div>
    </article>
  );
}
