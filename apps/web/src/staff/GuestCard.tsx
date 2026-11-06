// One guest in the producer's or engineer's view: picture, state, and the controls for their place.
import type { GuestState } from '@waar-connect/shared';
import { useState } from 'preact/hooks';
import type { GuestRecord, RoomAction } from '../api.ts';
import { VideoView } from '../components/media.tsx';
import { formatSummary } from '../lib/stats.ts';
import type { StaffTile } from './session.ts';

export interface GuestCardProps {
  state: GuestState;
  record: GuestRecord | undefined;
  tile: StaffTile | undefined;
  connected: boolean;
  engineer: boolean;
  slots: number;
  ifbAllowed: boolean;
  ifb: boolean;
  talkingTo: boolean;
  facing: boolean;
  hand: boolean;
  help: boolean;
  onAction: (action: RoomAction) => void;
  onTalk: (on: boolean) => void;
  onFace: (on: boolean) => void;
  onClearHelp: () => void;
}

const QUICK_CUES = ['30 seconds', 'Wrap up', 'Look at the camera', 'Speak louder', 'You are next'];

export function GuestCard(p: GuestCardProps) {
  const g = p.state;
  const [table, setTable] = useState(g.table ?? '');
  const [cue, setCue] = useState('');
  const name = p.record?.displayName ?? g.identity.replace(/^guest:/, '');
  const inLobby = g.place === 'lobby';
  const inGreen = g.place === 'green';
  const inStudio = g.place === 'studio';

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
          {g.slot !== null && <span class="slot">slot {g.slot}</span>}
          {g.ready && <span class="ok">ready</span>}
        </div>
      </div>

      {p.engineer && p.tile && (
        <pre class="stats">
          {formatSummary('IN', p.tile.stats)}
          {'\n'}quality {p.tile.quality}
        </pre>
      )}

      <div class="guest-controls">
        {inLobby && (
          <button class="btn" onClick={() => p.onAction({ type: 'admit', guest: g.identity })}>
            Admit
          </button>
        )}

        {(inGreen || inStudio) && (
          <>
            <button class={`btn ${p.talkingTo ? 'live' : 'secondary'}`} onClick={() => p.onTalk(!p.talkingTo)} disabled={inStudio && !p.ifb}>
              {p.talkingTo ? 'Talking' : 'Talk'}
            </button>
            {inGreen && (
              <button class={`btn ${p.facing ? 'live' : 'secondary'}`} onClick={() => p.onFace(!p.facing)}>
                {p.facing ? 'Face on' : 'Face'}
              </button>
            )}
          </>
        )}

        {inGreen && (
          <>
            <label class="inline">
              <input type="checkbox" checked={g.studioSound} onChange={(e) => p.onAction({ type: 'studioSound', guest: g.identity, on: (e.currentTarget as HTMLInputElement).checked })} /> studio sound
            </label>
            <label class="inline">
              <input type="checkbox" checked={g.program} onChange={(e) => p.onAction({ type: 'program', guest: g.identity, on: (e.currentTarget as HTMLInputElement).checked })} /> program
            </label>
            <label class="inline">
              table
              <input
                class="short"
                value={table}
                placeholder="—"
                onInput={(e) => setTable((e.currentTarget as HTMLInputElement).value)}
                onBlur={() => p.onAction({ type: 'table', guest: g.identity, table: table.trim() || null })}
              />
            </label>
            <label class="inline">
              slot
              <select value={g.slot ?? ''} onChange={(e) => p.onAction({ type: 'slot', guest: g.identity, slot: (e.currentTarget as HTMLSelectElement).value ? Number((e.currentTarget as HTMLSelectElement).value) : null })}>
                <option value="">—</option>
                {Array.from({ length: p.slots }, (_, i) => i + 1).map((n) => (
                  <option value={n}>{n}</option>
                ))}
              </select>
            </label>
            {p.engineer && (
              <label class="inline">
                <input type="checkbox" checked={g.ready} onChange={(e) => p.onAction({ type: 'ready', guest: g.identity, on: (e.currentTarget as HTMLInputElement).checked })} /> ready
              </label>
            )}
            <button class="btn" onClick={() => p.onAction({ type: 'handoff', guest: g.identity })} disabled={g.slot === null}>
              Hand off →
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
            {p.engineer && p.ifbAllowed && (
              <label class="inline">
                <input type="checkbox" checked={p.ifb} onChange={(e) => p.onAction({ type: 'ifb', guest: g.identity, on: (e.currentTarget as HTMLInputElement).checked })} /> IFB
              </label>
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

        {p.engineer && p.connected && (
          <div class="row">
            {(['720p', '540p', '360p'] as const).map((q) => (
              <button class="chip" key={q} onClick={() => p.onAction({ type: 'command', guest: g.identity, command: { quality: q } })}>
                {q}
              </button>
            ))}
            <button class="chip" onClick={() => p.onAction({ type: 'command', guest: g.identity, command: { mute: true } })}>
              mute mic
            </button>
            <button class="chip" onClick={() => p.onAction({ type: 'command', guest: g.identity, command: { reload: true } })}>
              reload page
            </button>
          </div>
        )}

        <div class="row muted small">
          {p.record?.invites[0] && (
            <button class="link" onClick={() => void navigator.clipboard?.writeText(p.record!.invites[0]!.url)}>
              copy link
            </button>
          )}
          <button class="link bad" onClick={() => p.onAction({ type: 'kick', guest: g.identity })}>
            remove
          </button>
        </div>
      </div>
    </article>
  );
}
