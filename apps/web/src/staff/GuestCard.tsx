// One guest in the producer's view: the picture, what stands on it (name, tally, hand, help), the
// guest's marks (approved, MV, slot, line), the controls for their place, the cues, and the tools
// (copy the link, the phone's settings, show out).
// In the green room the producer chooses what the guest sees (Black, the PCR, the Studio return),
// hears (the producer, the studio mix-minus) and whether they are in the multiview group (MV), then
// sends them to the studio; the server takes the first free slot. The full-screen view (GuestFocus)
// lays out the same switches on their own.
// The phone's technical side (PhonePanel.tsx) opens beside the room, and on the engineer's page.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.
import { cueLabel, cueText, type Cue, type GuestState } from '@waar-connect/shared';
import { useState } from 'preact/hooks';
import type { GuestRecord, RoomAction } from '../api.ts';
import { VideoView } from '../components/media.tsx';
import { ArmButton, CopyButton, Icon, Switch, Tip } from '../components/ui.tsx';
import type { GuestReport } from '../lib/report.ts';
import type { StaffTile } from './session.ts';

export type Sees = 'none' | 'me' | 'studio';

export interface GuestCardProps {
  state: GuestState;
  record: GuestRecord | undefined;
  tile: StaffTile | undefined;
  report: GuestReport | undefined;
  connected: boolean;
  outputNames: string[];
  /** The station's ready-made cues; each goes to the guest in the language of their page. */
  cues: Cue[];
  ifbAllowed: boolean;
  /** This studio sends a guest to air only with the engineer's approval (`state.ready`). */
  needsApproval: boolean;
  ifb: boolean;
  /** The producer's voice is routed to this guest. */
  hearsMe: boolean;
  sees: Sees;
  /** Names of the other guests in the multiview group, when this guest is in it. */
  mvWith: string[];
  hand: boolean;
  help: boolean;
  onAction: (action: RoomAction) => void;
  onHearMe: (on: boolean) => void;
  onSee: (mode: Sees) => void;
  onClearHelp: () => void;
  /** Opens the full-screen view of this guest. */
  onFocus?: () => void;
  /** This desk has joined the room; until then no pictures arrive. Absent: joined. */
  joined?: boolean;
}

export function guestName(p: Pick<GuestCardProps, 'record' | 'state'>): string {
  return p.record?.displayName ?? p.state.identity.replace(/^guest:/, '');
}

/** The guest's marks: approved for air or not, in the multiview, the slot, the line as the server judges it. */
export function GuestTags({ p }: { p: GuestCardProps }) {
  const g = p.state;
  const slotName = (n: number) => p.outputNames[n - 1] ?? `Guest ${n}`;
  return (
    <>
      {p.needsApproval && g.place !== 'left' && (
        <span class={`slot approval ${g.ready ? 'yes' : 'no'}`} title={g.ready ? 'The engineer approved this guest for air' : 'The engineer has not approved this guest yet: they cannot go to the studio'}>
          {g.ready ? 'approved' : 'not approved'}
        </span>
      )}
      {g.place === 'green' && g.mv && (
        <span class="slot mv" title={p.mvWith.length ? `In the multiview with ${p.mvWith.join(', ')}` : 'In the multiview, alone so far'}>
          MV
        </span>
      )}
      {g.slot !== null && (
        <span class="slot">
          slot {g.slot} · {slotName(g.slot)}
        </span>
      )}
      {p.tile && <span class={`slot quality-${p.tile.quality}`}>{p.tile.quality}</span>}
    </>
  );
}

/**
 * The picture with the name and the tally on it, a raised hand, a call for help, and the way to the
 * full-screen view. `tags` also puts the guest's marks on the picture (the full-screen view); the
 * room's card shows them under it.
 */
export function GuestVideo(p: GuestCardProps & { className?: string; tags?: boolean }) {
  const g = p.state;
  return (
    <div class={`guest-video ${p.className ?? ''}`}>
      <VideoView track={p.tile?.video ?? null} />
      {!p.tile?.video && <div class="guest-novideo">{!p.connected ? 'not connected' : p.joined === false ? 'join to see the picture' : 'no picture yet'}</div>}
      <div class="guest-overlay">
        <span class="name">{guestName(p)}</span>
        {g.place === 'studio' && <span class={`tally ${g.tally}`}>{g.tally === 'onair' ? 'ON AIR' : 'STAND BY'}</span>}
        {p.tags !== false && <GuestTags p={p} />}
        {p.hand && (
          <span class="flag">
            <Icon name="hand" /> hand
          </span>
        )}
        {p.help && (
          <button class="flag bad" title="Asked for help. Press when it is dealt with." onClick={p.onClearHelp}>
            <Icon name="help" /> help
          </button>
        )}
        {p.onFocus && (
          <button class="flag focus-btn" aria-label="Full screen" title="Full screen" onClick={p.onFocus}>
            <Icon name="expand" />
          </button>
        )}
      </div>
    </div>
  );
}

// The producer's switches for one guest, each on its own, so the card (one line each, compact) and
// the full-screen view (stacked, full width) can lay them out differently. `wide` fills the row.

/** What fills the guest's screen in the green room: black (the waiting card), the PCR (the producer's camera), or the studio return. */
export function SeesSwitch({ p, wide = false }: { p: GuestCardProps; wide?: boolean }) {
  return (
    <span class={`seg ${wide ? 'wide' : ''}`}>
      <button class={p.sees === 'none' ? 'on' : ''} title="No picture: the guest sees the waiting card" onClick={() => p.onSee('none')}>
        Black
      </button>
      <button class={p.sees === 'me' ? 'on' : ''} title="The producer's camera, from the PCR" onClick={() => p.onSee('me')}>
        PCR
      </button>
      <button class={p.sees === 'studio' ? 'on' : ''} title="The studio return: the program picture" onClick={() => p.onSee('studio')}>
        Studio
      </button>
    </span>
  );
}

/**
 * The multiview tick. The guests ticked MV are one group in the green room: each sees the others in
 * the multiview on their screen, they hear each other, and all of them hear the producer when one of
 * them is talked to. `big` is the full-screen view's button.
 */
export function MvTick({ p, big = false }: { p: GuestCardProps; big?: boolean }) {
  const g = p.state;
  const title = 'Multiview: the guests ticked MV see each other on their screens, hear each other, and all hear you when you talk to one of them';
  const toggle = () => p.onAction({ type: 'mv', guest: g.identity, on: !g.mv });
  return big ? (
    <button class={`btn mv-toggle ${g.mv ? 'live' : 'secondary'}`} title={title} aria-pressed={g.mv} onClick={toggle}>
      {g.mv ? 'MV ✓' : 'MV'}
    </button>
  ) : (
    <button class={`chip mv-chip ${g.mv ? 'on' : ''}`} title={title} aria-pressed={g.mv} onClick={toggle}>
      MV
    </button>
  );
}

/** What the guest hears in the green room: the producer, the studio mix-minus, both or neither. */
export function HearsSwitch({ p, wide = false }: { p: GuestCardProps; wide?: boolean }) {
  const g = p.state;
  return (
    <span class={`seg ${wide ? 'wide' : ''}`}>
      <button class={p.hearsMe ? 'on' : ''} aria-pressed={p.hearsMe} title="Your voice goes to this guest" onClick={() => p.onHearMe(!p.hearsMe)}>
        Me
      </button>
      <button class={g.studioSound ? 'on' : ''} aria-pressed={g.studioSound} title="The studio's sound without the guest's own voice (mix-minus)" onClick={() => p.onAction({ type: 'studioSound', guest: g.identity, on: !g.studioSound })}>
        Studio
      </button>
    </span>
  );
}

/** The tally on the guest's screen while they are in the studio: stand by, or on air. */
export function TallySwitch({ p }: { p: GuestCardProps }) {
  const g = p.state;
  const held = p.needsApproval && !g.ready && g.tally !== 'onair';
  return (
    <span class="seg tally-seg">
      <button class={g.tally === 'standby' ? 'on standby' : ''} aria-pressed={g.tally === 'standby'} onClick={() => p.onAction({ type: 'tally', guest: g.identity, tally: 'standby' })}>
        Stand by
      </button>
      <button
        class={g.tally === 'onair' ? 'on onair' : ''}
        aria-pressed={g.tally === 'onair'}
        disabled={held}
        title={held ? 'The engineer withdrew the approval' : undefined}
        onClick={() => p.onAction({ type: 'tally', guest: g.identity, tally: 'onair' })}
      >
        On air
      </button>
    </span>
  );
}

/**
 * Text cues for the guest's screen: the station's ready-made ones and a line to type. A ready-made cue
 * stands here by its English text and goes to the guest in the language of their page.
 */
export function CueBox({ p }: { p: GuestCardProps }) {
  const g = p.state;
  const [cue, setCue] = useState('');
  const language = p.record?.language;
  return (
    <div class="cues">
      {p.cues.map((c) => {
        const text = cueText(c, language);
        return (
          <button class="chip" key={c.id} title={text !== cueLabel(c) ? `The guest reads: ${text}` : undefined} onClick={() => p.onAction({ type: 'cue', to: g.identity, text })}>
            {cueLabel(c)}
          </button>
        );
      })}
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (cue.trim()) p.onAction({ type: 'cue', to: g.identity, text: cue.trim() });
          setCue('');
        }}
      >
        <input placeholder="Cue" aria-label="A cue for the guest's screen" value={cue} onInput={(e) => setCue((e.currentTarget as HTMLInputElement).value)} />
        <button class="btn secondary small" type="submit" disabled={!cue.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

/** What the room's card adds to a guest: where their phone's settings open. */
export interface GuestCardExtras {
  /** Opens the phone's settings beside the room. */
  onPhone?: (() => void) | undefined;
  phoneOpen?: boolean | undefined;
}

/** Everything the producer does with this guest on its card in the room. */
export function GuestControls(p: GuestCardProps & GuestCardExtras) {
  const g = p.state;
  const inLobby = g.place === 'lobby';
  const inGreen = g.place === 'green';
  const inStudio = g.place === 'studio';
  const waits = p.needsApproval && !g.ready;
  const link = p.record?.invites[0]?.url;

  return (
    <div class="gc-body">
      <div class="gc-tags">
        <GuestTags p={p} />
      </div>

      {inLobby && (
        <button class="btn gc-main" onClick={() => p.onAction({ type: 'admit', guest: g.identity })}>
          Receive into green room <Icon name="forward" />
        </button>
      )}

      {inGreen && (
        <>
          <div class="gc-line">
            <span class="gc-label">Sees</span>
            <SeesSwitch p={p} />
            <MvTick p={p} />
          </div>
          <div class="gc-line">
            <span class="gc-label">Hears</span>
            <HearsSwitch p={p} />
          </div>
          <Tip class="gc-wrap" text={waits ? 'Waiting for the engineer to approve this guest for air.' : !p.connected ? 'This guest is not connected.' : undefined}>
            <button class="btn gc-main" onClick={() => p.onAction({ type: 'handoff', guest: g.identity })} disabled={!p.connected || waits}>
              Send to studio <Icon name="forward" />
            </button>
          </Tip>
        </>
      )}

      {inStudio && (
        <>
          <div class="gc-line">
            <span class="gc-label">Tally</span>
            <TallySwitch p={p} />
          </div>
          {p.ifbAllowed && (
            <div class="gc-line">
              <span class="gc-label" title="Talk to this guest while they are in the studio">
                IFB
              </span>
              <Switch on={p.ifb} label={p.ifb ? 'open' : 'closed'} onChange={(on) => p.onAction({ type: 'ifb', guest: g.identity, on })} />
              {p.ifb && (
                <button class={`btn small ${p.hearsMe ? 'live' : 'secondary'}`} aria-pressed={p.hearsMe} onClick={() => p.onHearMe(!p.hearsMe)}>
                  <Icon name="mic" /> {p.hearsMe ? 'Talking' : 'Talk'}
                </button>
              )}
            </div>
          )}
          <button class="btn secondary gc-main" onClick={() => p.onAction({ type: 'bringBack', guest: g.identity })}>
            <Icon name="back" /> Bring back
          </button>
        </>
      )}

      {(inGreen || inStudio) && <CueBox p={p} />}

      <div class="gc-tools">
        {link && <CopyButton text={link} label="Link" />}
        {p.connected && p.onPhone && (
          <button class={`chip ${p.phoneOpen ? 'on' : ''}`} aria-pressed={p.phoneOpen === true} onClick={p.onPhone}>
            <Icon name="sliders" /> Phone
          </button>
        )}
        <span class="gc-spacer" />
        <ArmButton label="Show out" ask="Show out?" icon="exit" onConfirm={() => p.onAction({ type: 'kick', guest: g.identity })} />
      </div>
    </div>
  );
}

export function GuestCard(p: GuestCardProps & GuestCardExtras) {
  return (
    <article class={`gc ${p.state.place} ${p.connected ? '' : 'offline'} ${p.help ? 'help' : p.hand ? 'hand' : ''}`}>
      <GuestVideo {...p} tags={false} />
      <GuestControls {...p} />
    </article>
  );
}
