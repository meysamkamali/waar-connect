// One guest on the engineer's page: the picture and its sound, the line and picture meters as bars
// that are always in view, and the approval for air. It only draws what it is given.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import type { GuestState } from '@waar-connect/shared';
import type { RemoteVideoTrack } from 'livekit-client';
import { VideoView } from '../components/media.tsx';
import { Icon, Tip } from '../components/ui.tsx';
import { LIMITS, METER_GROUPS, toneOf, verdictWord, type Copy, type Meter, type Quality, type Tone } from '../lib/quality.ts';

export interface GuestRowProps {
  name: string;
  state: GuestState;
  connected: boolean;
  video: RemoteVideoTrack | null;
  /** Sound level as the server hears it, 0 to 1. */
  level: number;
  quality: Quality;
  /** The phone in a few words: codec, model, network, battery. */
  facts: string;
  /** This studio sends a guest to air only with the engineer's approval. */
  needsApproval: boolean;
  listening: boolean;
  selected: boolean;
  onApprove: (on: boolean) => void;
  onListen: () => void;
  onSettings: () => void;
}

const TONE_WORD: Readonly<Record<Tone, string>> = { ok: 'good', warn: 'watch', bad: 'problem', none: 'no numbers' };

function placeTag(g: GuestState): { text: string; cls: '' | 'onair' | 'standby' } {
  if (g.place === 'studio') return g.tally === 'onair' ? { text: 'ON AIR', cls: 'onair' } : g.tally === 'standby' ? { text: 'STAND BY', cls: 'standby' } : { text: 'studio', cls: '' };
  return { text: g.place === 'green' ? 'green room' : g.place === 'lobby' ? 'at the door' : 'left', cls: '' };
}

export function MeterBar({ m }: { m: Meter }) {
  const pct = Math.round(m.fill * 100);
  const flagged = m.tone === 'warn' || m.tone === 'bad';
  return (
    <div class={`qm tone-${m.tone} tip`} data-tip={m.note ? `${m.hint}. Now ${m.note}.` : m.hint}>
      <div class="qm-label">
        <span>{m.label}</span>
        {flagged && <span class="qm-flag">{m.flag ?? (m.tone === 'bad' ? 'bad' : 'watch')}</span>}
      </div>
      <div class="qm-value">{m.text}</div>
      <div class="qm-track" role="meter" aria-label={m.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={m.text}>
        <div class="qm-fill" style={{ width: `${pct}%` }} />
        {m.marks?.map((x) => (
          <i key={x} class="qm-mark" style={{ left: `${x * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

/** One copy of the picture as the phone sends it: its size, its bitrate, and a bar against what it may send. */
export function CopyBar({ c, stale }: { c: Copy; stale: boolean }) {
  const pct = Math.round(c.fill * 100);
  const text = c.paused ? 'paused' : c.ceilingKbps ? `${c.kbps} of ${c.ceilingKbps} kbit/s` : `${c.kbps} kbit/s`;
  const hint = c.full
    ? 'The full-size copy: what the studio gets. Its bitrate against the cap.'
    : 'A small copy beside the full-size one: small pictures and weak viewers take it. Its bitrate against its own ceiling. Paused while nobody takes it or the line is short.';
  return (
    <div class={`qm copy ${c.paused || stale ? 'tone-none' : 'tone-info'} tip`} data-tip={`${hint}${c.fps && !c.paused ? ` ${Math.round(c.fps)} frames a second.` : ''}`}>
      <div class="qm-label">
        <span>{c.name} copy</span>
      </div>
      <div class="qm-value">{text}</div>
      <div class="qm-track" role="meter" aria-label={`${c.name} copy`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={text}>
        <div class="qm-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Approval({ p }: { p: GuestRowProps }) {
  const g = p.state;
  if (!p.needsApproval) {
    return (
      <Tip class="eng-free" side="end" text="This studio does not ask for an approval: the producer sends guests to the studio directly. The admin sets this per studio.">
        no approval asked
      </Tip>
    );
  }
  if (g.ready) {
    return (
      <div class="eng-approved">
        <span>
          <Icon name="check" /> Approved for air
        </span>
        <Tip side="end" text={g.tally === 'onair' ? 'The guest stays on air. The approval is asked again the next time.' : 'Without the approval the producer cannot send this guest to the studio or put them on air.'}>
          <button class="link" onClick={() => p.onApprove(false)}>
            withdraw
          </button>
        </Tip>
      </div>
    );
  }
  const bad = p.quality.tone === 'bad';
  const why = !p.connected
    ? 'This guest is not connected.'
    : bad
      ? `Not fit for air right now: ${p.quality.reasons.join(', ')}. You can approve all the same.`
      : 'Until you approve, the producer cannot send this guest to the studio or put them on air.';
  return (
    <Tip side="end" text={why}>
      <button class={`btn approve ${bad ? 'warn' : 'live'}`} disabled={!p.connected} onClick={() => p.onApprove(true)}>
        <Icon name="check" /> {bad ? 'Approve anyway' : 'Approve for air'}
      </button>
    </Tip>
  );
}

export function GuestRow(p: GuestRowProps) {
  const g = p.state;
  const q = p.quality;
  const tag = placeTag(g);
  const tone: Tone = p.connected ? q.tone : 'none';
  const by = new Map(q.meters.map((m) => [m.key, m]));
  const verdict = !p.connected ? 'Not connected' : verdictWord(q);
  const verdictWhy = !p.connected
    ? 'This guest is not connected right now.'
    : q.stale
      ? `The phone has sent no numbers for ${Math.round(LIMITS.staleMs / 1000)} seconds.`
      : q.reasons.length
        ? q.reasons.join(' · ')
        : q.tone === 'ok'
          ? 'Line and picture are fit for air.'
          : 'Waiting for the first numbers from the phone.';

  return (
    <article class={`eng-guest tone-${tone} ${tag.cls} ${p.connected ? '' : 'offline'} ${p.selected ? 'selected' : ''}`}>
      <div class="eng-guest-pic">
        <div class="guest-video">
          <VideoView track={p.video} />
          {!p.video && <div class="guest-novideo">{p.connected ? 'no picture yet' : 'not connected'}</div>}
        </div>
        <div class="eng-sound tip tip-start" data-tip="The guest's sound level as the media server hears it.">
          <span>Sound</span>
          <div class="eng-sound-track" role="meter" aria-label="Sound level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, p.level * 2.5) * 100)}>
            <div class="eng-sound-fill" style={{ width: `${Math.round(Math.min(1, p.level * 2.5) * 100)}%` }} />
          </div>
        </div>
      </div>

      <div class="eng-guest-body">
        <header class="eng-guest-head">
          <h3 class="eng-guest-name">{p.name}</h3>
          <span class={`eng-tag ${tag.cls}`}>{tag.text}</span>
          {g.place === 'studio' && g.slot !== null && <span class="eng-tag">slot {g.slot}</span>}
          {g.place === 'green' && g.mv && <span class="eng-tag">MV</span>}
          {p.facts && <span class="eng-facts">{p.facts}</span>}
        </header>
        <div class="eng-meters">
          {METER_GROUPS.map((group) => {
            const meters = group.meters.map((k) => by.get(k)).filter((m): m is Meter => m !== undefined);
            const t: Tone = p.connected ? toneOf(meters) : 'none';
            return (
              <section key={group.key} class={`eng-group ${group.key} tone-${t}`}>
                <h4 class="eng-group-title">
                  <i />
                  {group.label}
                  <em>{TONE_WORD[t]}</em>
                </h4>
                <div class="eng-group-meters">
                  {meters.map((m) => (
                    <MeterBar key={m.key} m={m} />
                  ))}
                </div>
                {group.key === 'picture' && p.connected && q.copies.length > 1 && (
                  <div class="eng-group-meters eng-copies">
                    {q.copies.map((c, i) => (
                      <CopyBar key={i} c={c} stale={q.stale} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <aside class="eng-guest-air">
        <div class={`eng-verdict tone-${tone} tip tip-end`} data-tip={verdictWhy}>
          {verdict}
        </div>
        <Approval p={p} />
        <div class="eng-air-tools">
          <button class={`chip ${p.listening ? 'on' : ''}`} onClick={p.onListen} aria-pressed={p.listening}>
            <Icon name={p.listening ? 'sound' : 'silent'} /> {p.listening ? 'Listening' : 'Listen'}
          </button>
          <button class={`chip ${p.selected ? 'on' : ''}`} onClick={p.onSettings} aria-pressed={p.selected}>
            <Icon name="sliders" /> Settings
          </button>
        </div>
      </aside>
    </article>
  );
}
