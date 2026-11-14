// /app/admin — the admin builds studios (PCRs) and sets them up. One studio is in hand at a time,
// picked at the top; below it everything about that studio: its settings and return feed and the
// pages for the studio PC. Under "Every studio" comes what the whole station shares: the guest's
// screen, the producer's cues, and the NDI gateway.
// The page carries no guide text: what only explains opens in a balloon.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { describeNdiOut, ndiOutNames, normalizeNdiOut, OUT_HEIGHTS, RETURN_HEIGHTS, RETURN_KBPS_CHOICES, type NdiOutSettings, type NdiSourceInfo, type OutputFeedStatus, type OutRate } from '@waar-connect/shared';
import { ApiError, archivePcr, createPcr, gatewayStatus, listPcrs, setDiscovery, updatePcr, type GatewayView, type Pcr, type PcrSettings } from '../api.ts';
import { CopyButton, Icon, Info, Switch, Tip } from '../components/ui.tsx';
import { LANGUAGES } from '../staff/Contacts.tsx';
import { CuesCard } from './CuesCard.tsx';
import { ScreenDesigner } from './ScreenDesigner.tsx';

type Tone = 'ok' | 'warn' | 'bad' | 'none';

const message = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));

/** One line on where this studio's return feed stands, from the gateway's last report. */
export function returnLine(pcr: Pcr, gateway: GatewayView | null): string {
  if (!pcr.settings.returnSource) return 'No NDI source: the return feed page on the studio PC publishes the return.';
  if (!gateway) return 'gateway: …';
  if (!gateway.configured) return 'No gateway is set up on the server (GATEWAY_TOKEN); the source is saved but nothing picks it up.';
  if (!gateway.status) return 'Gateway offline: no report in the last 20 s.';
  const r = gateway.status.returns.find((x) => x.pcrId === pcr.id);
  if (!r) return 'Gateway online; it picks this studio up within 15 s.';
  const video = r.video ? `${r.video.width}x${r.video.height} ${r.video.fps} fps` : '';
  const sent = r.publish && r.publish.width && r.publish.height ? `${r.publish.width}x${r.publish.height} ` : '';
  const out = r.publish ? `sends ${sent}${r.publish.codec} up to ${r.publish.maxKbps} kbit/s` : '';
  const mv = r.mv ? ` · multiview strip with ${r.mv.tiles} guests` : '';
  return `gateway ${r.state}${r.detail ? `: ${r.detail}` : ''}${video ? ` · ${video}` : ''}${out ? ` · ${out}` : ''}${mv}`;
}

/** The return feed of a studio in one word and a colour; the whole line goes in the balloon. */
function returnState(pcr: Pcr, gateway: GatewayView | null): { tone: Tone; word: string } {
  if (!pcr.settings.returnSource) return { tone: 'none', word: 'studio PC page' };
  if (!gateway) return { tone: 'none', word: '…' };
  if (!gateway.configured) return { tone: 'bad', word: 'no gateway' };
  if (!gateway.status) return { tone: 'bad', word: 'gateway offline' };
  const r = gateway.status.returns.find((x) => x.pcrId === pcr.id);
  if (!r) return { tone: 'warn', word: 'starting' };
  return { tone: r.state === 'publishing' ? 'ok' : r.state === 'error' ? 'bad' : 'warn', word: r.state === 'publishing' ? 'live' : r.state };
}

function gatewayState(gateway: GatewayView | null): { tone: Tone; word: string; detail: string } {
  if (!gateway) return { tone: 'none', word: 'Gateway …', detail: 'Waiting for the server.' };
  if (!gateway.configured) return { tone: 'none', word: 'No gateway', detail: 'No gateway is set up on the server. Return feeds come from the page on the studio PC.' };
  if (!gateway.status) return { tone: 'bad', word: 'Gateway offline', detail: 'No report in the last 20 seconds.' };
  const n = gateway.status.sources.length;
  return { tone: 'ok', word: 'Gateway online', detail: `${gateway.status.host} (${gateway.status.version}) · ${n === 0 ? 'no NDI sources seen' : n === 1 ? '1 NDI source seen' : `${n} NDI sources seen`}` };
}

/** Where a sender sits as seen from the gateway: on one of the VM's own networks, or behind a router. */
function networkLabel(src: NdiSourceInfo): string {
  return src.network ? `on ${src.network}` : 'via router';
}

const TYPE_A_NAME = '#type-a-name'; // never an NDI name, those are 'MACHINE (source)'

/**
 * The return source for one studio: a list of every sender the gateway sees (its own outputs left out,
 * a return must never be one of them), the saved name marked when its sender is off right now, and a
 * typed name for a sender that is not on yet.
 */
export function SourcePicker({ value, gateway, onChange }: { value: string | null; gateway: GatewayView | null; onChange: (v: string | null) => void }) {
  const [typing, setTyping] = useState(false);
  const sources = (gateway?.status?.sources ?? []).filter((s) => !s.own);
  const seen = value !== null && sources.some((s) => s.name === value);
  return (
    <>
      <select
        value={typing ? TYPE_A_NAME : (value ?? '')}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          if (v === TYPE_A_NAME) {
            setTyping(true);
            return;
          }
          setTyping(false);
          onChange(v || null);
        }}
      >
        <option value="">none: the return feed page on the studio PC</option>
        {value && !seen && !typing ? <option value={value}>{value} · not seen now</option> : null}
        {sources.map((s) => (
          <option key={`${s.name}|${s.url ?? ''}`} value={s.name}>
            {s.name} · {s.url ?? 'address unknown'} · {networkLabel(s)}
          </option>
        ))}
        <option value={TYPE_A_NAME}>type a name…</option>
      </select>
      {typing ? (
        <input
          style={{ marginTop: '6px' }}
          placeholder="MACHINE (source), as NDI shows it"
          value={value ?? ''}
          onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value || null)}
        />
      ) : null}
    </>
  );
}

// ---- small pieces ----------------------------------------------------------------------------------------

function Pill({ tone, text, tip, side }: { tone: Tone; text: string; tip?: string | undefined; side?: 'start' | 'end' }) {
  return (
    <span class={`adm-pill ${tone} ${tip ? `tip ${side ? `tip-${side}` : ''}` : ''}`} data-tip={tip}>
      {text}
    </span>
  );
}

function Stepper({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, Math.round(n) || min)));
  return (
    <div class="adm-stepper">
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => set(value - 1)}>
        −
      </button>
      <input type="number" aria-label={label} min={min} max={max} value={value} onInput={(e) => set(Number((e.currentTarget as HTMLInputElement).value))} />
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => set(value + 1)}>
        +
      </button>
    </div>
  );
}

// ---- one studio --------------------------------------------------------------------------------------------

/** What this page edits of a studio. The connection preferences are the engineer's, the guest screen has its designer. */
type StudioDraft = { name: string; ndiOut: NdiOutSettings } & Pick<PcrSettings, 'slots' | 'ifbAllowed' | 'approval' | 'languages' | 'outputNames' | 'returnSource' | 'returnHeight' | 'returnKbps'>;

const RATE_LABELS: Readonly<Record<OutRate, string>> = { '25p': '25 progressive', '50p': '50 progressive', '50i': '50 interlaced (50i)' };

function draftOf(pcr: Pcr): StudioDraft {
  const s = pcr.settings;
  return {
    name: pcr.name,
    slots: s.slots,
    ifbAllowed: s.ifbAllowed,
    approval: s.approval !== false,
    languages: [...s.languages],
    outputNames: [...s.outputNames],
    returnSource: s.returnSource ?? null,
    returnHeight: s.returnHeight ?? null,
    returnKbps: s.returnKbps ?? null,
    ndiOut: normalizeNdiOut(s.ndiOut),
  };
}

function StudioCard({
  pcr,
  gateway,
  draft,
  onDraft,
  onSaved,
  onClosed,
  onError,
}: {
  pcr: Pcr;
  gateway: GatewayView | null;
  draft: StudioDraft | undefined;
  onDraft: (d: StudioDraft | undefined) => void;
  onSaved: () => void;
  onClosed: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const saved = draftOf(pcr);
  const d = draft ?? saved;
  const dirty = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<StudioDraft>) => onDraft({ ...d, ...patch });
  const defaults = gateway?.status?.defaults;
  const state = returnState(pcr, gateway);

  const setSlots = (slots: number) => set({ slots, outputNames: Array.from({ length: slots }, (_, i) => d.outputNames[i] ?? `Guest ${i + 1}`) });

  const save = () => {
    setBusy(true);
    const { name, ...settings } = d;
    updatePcr(pcr.id, { name: name.trim() || pcr.name, settings })
      .then(() => {
        onDraft(undefined);
        onSaved();
      })
      .catch((err: unknown) => onError(message(err)))
      .finally(() => setBusy(false));
  };

  return (
    <section class="adm-card">
      <header class="adm-card-head">
        <div class="adm-card-title">
          <h2>{pcr.name}</h2>
          <Pill tone={state.tone} text={`return ${state.word}`} tip={returnLine(pcr, gateway)} side="start" />
        </div>
        <div class="adm-actions">
          <button class="btn secondary small" disabled={!dirty || busy} onClick={() => onDraft(undefined)}>
            <Icon name="undo" />
            Undo
          </button>
          <button class="btn small" disabled={!dirty || busy} onClick={save}>
            <Icon name="check" />
            Save
          </button>
        </div>
      </header>

      <div class="adm-group">
        <h3>Studio</h3>
        <div class="adm-fields">
          <label class="span-2">
            Name
            <input value={d.name} maxLength={80} onInput={(e) => set({ name: (e.currentTarget as HTMLInputElement).value })} />
          </label>
          <div class="adm-field">
            <span>Output slots</span>
            <Stepper value={d.slots} min={1} max={16} label="output slots" onChange={setSlots} />
          </div>
        </div>
        <div class="adm-switches">
          <Switch on={d.ifbAllowed} label="Producer may talk to a guest on air" onChange={(ifbAllowed) => set({ ifbAllowed })} />
          <span class="adm-inline">
            <Switch on={d.approval} label="Engineer approves before air" onChange={(approval) => set({ approval })} />
            <Info text="The engineer approves each guest on the Engineer page after checking line and picture. Without it the producer cannot send the guest to the studio or put them on air." />
          </span>
        </div>
      </div>

      <div class="adm-group">
        <h3>Output names</h3>
        <div class="adm-fields narrow">
          {d.outputNames.map((n, i) => (
            <label key={i}>
              Slot {i + 1}
              <input
                value={n}
                maxLength={40}
                onInput={(e) => {
                  const outputNames = [...d.outputNames];
                  outputNames[i] = (e.currentTarget as HTMLInputElement).value;
                  set({ outputNames });
                }}
              />
            </label>
          ))}
        </div>
      </div>

      <div class="adm-group">
        <h3>
          Return feed
          <Info side="start" text="What the guests see and hear from the studio. With an NDI source the gateway takes it from the network; without one, the return feed page on the studio PC sends it. The guests watch on a phone, and a smaller picture costs the server less: 540p is about a quarter of 1080p to encode." />
        </h3>
        <div class="adm-fields">
          <label class="span-2">
            NDI source
            <SourcePicker value={d.returnSource} gateway={gateway} onChange={(returnSource) => set({ returnSource })} />
          </label>
          <label>
            Picture
            <select value={d.returnHeight ?? ''} onChange={(e) => set({ returnHeight: Number((e.currentTarget as HTMLSelectElement).value) || null })}>
              <option value="">gateway default{defaults ? ` (${defaults.height ? `${defaults.height}p` : 'source size'})` : ''}</option>
              {RETURN_HEIGHTS.map((h) => (
                <option key={h} value={h}>
                  {h}p
                </option>
              ))}
            </select>
          </label>
          <label>
            Bitrate
            <select value={d.returnKbps ?? ''} onChange={(e) => set({ returnKbps: Number((e.currentTarget as HTMLSelectElement).value) || null })}>
              <option value="">gateway default{defaults ? ` (${defaults.kbps} kbit/s)` : ''}</option>
              {RETURN_KBPS_CHOICES.map((k) => (
                <option key={k} value={k}>
                  {k} kbit/s
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div class="adm-group">
        <h3>
          NDI output
          <Info
            side="start"
            text="Each slot of the studio goes out as an NDI source on the station's network, named after the studio and the slot. A source comes up when a guest enters the green room, so it is there before the guest goes over, and sends black until then; it goes two minutes after its guest has left. A fixed picture and frame rate keep the vision mixer's input in one format whatever a phone sends; “as the guest sends” passes the picture on untouched, which costs the server least. 50i is interlaced: 25 frames a second of two fields each."
          />
        </h3>
        <div class="adm-switches">
          <Switch on={d.ndiOut.on} label="Send each slot as an NDI source" onChange={(on) => set({ ndiOut: { ...d.ndiOut, on } })} />
        </div>
        <div class="adm-fields">
          <label>
            Picture
            <select disabled={!d.ndiOut.on} value={d.ndiOut.height ?? ''} onChange={(e) => set({ ndiOut: { ...d.ndiOut, height: (Number((e.currentTarget as HTMLSelectElement).value) || null) as NdiOutSettings['height'] } })}>
              <option value="">as the guest sends</option>
              {OUT_HEIGHTS.map((h) => (
                <option key={h} value={h}>
                  {h}p
                </option>
              ))}
            </select>
          </label>
          <label>
            Frame rate
            <select disabled={!d.ndiOut.on} value={d.ndiOut.rate ?? ''} onChange={(e) => set({ ndiOut: { ...d.ndiOut, rate: ((e.currentTarget as HTMLSelectElement).value || null) as NdiOutSettings['rate'] } })}>
              <option value="">as the guest sends</option>
              {(Object.keys(RATE_LABELS) as OutRate[]).map((r) => (
                <option key={r} value={r}>
                  {RATE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <div class="adm-field">
            <span>Goes out as</span>
            <span class="adm-format">{describeNdiOut(d.ndiOut)}</span>
          </div>
        </div>
      </div>

      <div class="adm-group">
        <h3>Invite languages</h3>
        <div class="adm-chips">
          {LANGUAGES.map(([code, label]) => {
            const on = d.languages.includes(code);
            return (
              <button
                key={code}
                type="button"
                class={`chip ${on ? 'on' : ''}`}
                aria-pressed={on}
                onClick={() => {
                  const languages = on ? d.languages.filter((l) => l !== code) : [...d.languages, code];
                  if (languages.length) set({ languages });
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <footer class="adm-foot">
        <button
          class="btn ghost-danger small"
          onClick={() => {
            if (confirm(`Close ${pcr.name}? Its guests and links stop working.`)) void archivePcr(pcr.id).then(onClosed).catch((err: unknown) => onError(message(err)));
          }}
        >
          <Icon name="trash" />
          Close studio
        </button>
      </footer>
    </section>
  );
}

function outputPill(o: OutputFeedStatus | undefined, gateway: GatewayView | null): { tone: Tone; text: string; tip: string } {
  if (!gateway?.status) return { tone: gateway && !gateway.configured ? 'none' : 'bad', text: gateway && !gateway.configured ? 'no gateway' : 'gateway offline', tip: 'The gateway makes the NDI sources. It is not reporting.' };
  if (!o) return { tone: 'none', text: 'waits for a guest', tip: 'This source comes up when a guest enters the green room, and goes two minutes after its guest has left.' };
  if (o.announced === false) return { tone: 'bad', text: 'not on the network', tip: 'The source runs, but discovery on the server does not list it, so no receiver can find it. The server restarts its discovery service by itself within two minutes; if this stays, the service (avahi-daemon) needs a look.' };
  const format = o.out?.format ?? '';
  const seen = o.receivers === 1 ? '1 receiver' : `${o.receivers} receivers`;
  if (o.state === 'sending') return { tone: 'ok', text: `guest out · ${format}`, tip: `A guest goes out${o.in ? `, arriving as ${o.in.width}×${o.in.height} at ${o.in.fps} frames a second` : ''}. ${seen} connected.` };
  if (o.state === 'slate') return { tone: 'none', text: `black · ${format}`, tip: `A guest is in the green room: the source is up and sends black until they go over. ${seen} connected.` };
  if (o.state === 'error') return { tone: 'bad', text: 'fault', tip: o.detail ?? 'The output has a fault.' };
  return { tone: 'warn', text: 'starting', tip: o.detail ?? 'The output is coming up.' };
}

/**
 * What leaves the studio's slots: the NDI source of each slot (when NDI out is on) with its state, and
 * the addresses the studio PC opens: the return feed page (when no NDI source is set) and one output
 * page per slot.
 */
function StudioPages({ pcr, gateway }: { pcr: Pcr; gateway: GatewayView | null }) {
  const origin = location.origin;
  const s = pcr.settings;
  const ndiOut = normalizeNdiOut(s.ndiOut);
  const names = ndiOutNames(pcr.name, s.outputNames);
  const machine = (gateway?.status?.host ?? 'server').split('.')[0]?.toUpperCase() ?? 'SERVER';
  /** The name as the network shows it: from the gateway's own list when it is there. */
  const onNetwork = (name: string) => gateway?.status?.sources.find((src) => src.own && src.name.endsWith(`(${name})`))?.name ?? `${machine} (${name})`;
  return (
    <section class="adm-card">
      <header class="adm-card-head">
        <div class="adm-card-title">
          <h2>Studio outputs</h2>
        </div>
      </header>
      {ndiOut.on && (
        <div class="adm-group">
          <h3>NDI sources · {describeNdiOut(ndiOut)}</h3>
          <div class="adm-links">
            {names.map((name, i) => {
              const pill = outputPill(gateway?.status?.outputs?.find((o) => o.pcrId === pcr.id && o.slot === i + 1), gateway);
              return (
                <div class="adm-link" key={i}>
                  <span>
                    Slot {i + 1} · {s.outputNames[i]}
                  </span>
                  <code>{onNetwork(name)}</code>
                  <span class="adm-inline">
                    <Pill tone={pill.tone} text={pill.text} tip={pill.tip} side="end" />
                    <CopyButton text={onNetwork(name)} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div class="adm-group">
        <h3>
          Pages for the studio PC
          <Info
            side="start"
            text={`Open each address in a browser on the studio PC: one output page per slot, and the return feed page when the return does not come from NDI. Capture devices for that PC are set under “This station”. LiveKit room ${pcr.livekitRoom}.`}
          />
        </h3>
        <div class="adm-links">
        <div class="adm-link">
          <span>Return feed in</span>
          {s.returnSource ? (
            <span class="adm-link-note">from NDI · {s.returnSource}</span>
          ) : (
            <>
              <code>
                {origin}/app/return/{pcr.id}
              </code>
              <CopyButton text={`${origin}/app/return/${pcr.id}`} />
            </>
          )}
        </div>
        {s.outputNames.map((n, i) => (
          <div class="adm-link" key={i}>
            <span>
              Slot {i + 1} · {n}
            </span>
            <code>
              {origin}/app/out/{pcr.id}/{i + 1}
            </code>
            <CopyButton text={`${origin}/app/out/${pcr.id}/${i + 1}`} />
          </div>
        ))}
        </div>
      </div>
    </section>
  );
}

function NewStudio({ onBuilt, onCancel, onError }: { onBuilt: (pcr: Pcr) => void; onCancel: (() => void) | undefined; onError: (m: string) => void }) {
  const [name, setName] = useState('');
  const [slots, setSlots] = useState(4);
  const [busy, setBusy] = useState(false);
  return (
    <form
      class="adm-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        createPcr(name.trim(), { slots })
          .then((r) => onBuilt(r.pcr))
          .catch((err: unknown) => onError(message(err)))
          .finally(() => setBusy(false));
      }}
    >
      <header class="adm-card-head">
        <div class="adm-card-title">
          <h2>New studio</h2>
          <Info side="start" text="A studio (PCR) is a standing place with its own door, green room and output slots. Producers sit in one and bring guests to it." />
        </div>
      </header>
      <div class="adm-fields">
        <label>
          Name
          <input placeholder="PCR 1" value={name} maxLength={80} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <div class="adm-field">
          <span>Output slots</span>
          <Stepper value={slots} min={1} max={16} label="output slots" onChange={setSlots} />
        </div>
        <div class="adm-actions">
          <button class="btn" type="submit" disabled={busy || !name.trim()}>
            Build studio
          </button>
          {onCancel && (
            <button class="btn secondary" type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

// ---- the NDI gateway -----------------------------------------------------------------------------------

/**
 * The gateway serves every studio: it takes return feeds from NDI. Here: whether it reports, every
 * sender it sees, and the addresses it asks beyond mDNS (senders on networks the VM is not on).
 */
function GatewayCard({ gateway, onSaved, onError }: { gateway: GatewayView | null; onSaved: () => void; onError: (m: string) => void }) {
  const state = gatewayState(gateway);
  const sources = gateway?.status?.sources ?? [];
  const saved = gateway?.extraIps ?? [];
  const inUse = gateway?.status?.extraIps ?? [];
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = text ?? saved.join(', ');
  return (
    <section class="adm-card">
      <header class="adm-card-head">
        <div class="adm-card-title">
          <h2>NDI gateway</h2>
          <Pill tone={state.tone} text={state.word.replace(/^Gateway /, '')} tip={state.detail} side="start" />
        </div>
        {gateway?.status && <span class="adm-link-note">{gateway.status.host}</span>}
      </header>

      {sources.length > 0 && (
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Address</th>
                <th>Network</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((src) => (
                <tr key={`${src.name}|${src.url ?? ''}`}>
                  <td>
                    {src.name}
                    {src.own && <span class="adm-tag">this gateway</span>}
                  </td>
                  <td>{src.url ?? '—'}</td>
                  <td>{networkLabel(src)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {gateway?.status && sources.length === 0 && <div class="eng-empty">No NDI source seen</div>}

      <form
        class="adm-group"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setDiscovery(value.split(/[\s,;]+/).filter(Boolean))
            .then(() => {
              setText(null);
              onSaved();
            })
            .catch((err: unknown) => onError(message(err)))
            .finally(() => setBusy(false));
        }}
      >
        <h3>
          Senders on other networks
          <Info side="start" text="IPv4 addresses or host names of NDI senders on networks the server has no leg on, separated by commas. mDNS does not reach them, so discovery asks these addresses too. The gateway takes a change within its next poll." />
        </h3>
        <div class="adm-inline">
          <input class="adm-grow" placeholder="10.1.1.107, 10.100.2.102" value={value} onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)} />
          <button class="btn secondary small" type="submit" disabled={busy || text === null}>
            Save
          </button>
          {gateway?.status && (
            <Tip text="What the gateway asks right now, from its last report." side="end">
              <span class="adm-link-note">{inUse.length ? `asking ${inUse.join(', ')}` : 'mDNS only'}</span>
            </Tip>
          )}
        </div>
      </form>
    </section>
  );
}

// ---- the page ------------------------------------------------------------------------------------------------

export function Admin({ nav }: { nav: ComponentChildren }) {
  const [pcrs, setPcrs] = useState<Pcr[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gateway, setGateway] = useState<GatewayView | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, StudioDraft>>({});

  const load = () =>
    listPcrs()
      .then((r) => setPcrs(r.pcrs))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Server not reachable.'));
  useEffect(() => void load(), []);

  // The gateway reports every 5 s; the page follows at the same pace.
  const pollGateway = () => void gatewayStatus().then(setGateway).catch(() => undefined);
  useEffect(() => {
    pollGateway();
    const timer = setInterval(pollGateway, 5000);
    return () => clearInterval(timer);
  }, []);

  const list = pcrs ?? [];
  const pcr = list.find((p) => p.id === picked) ?? list[0];
  const gw = gatewayState(gateway);
  const setDraft = (id: string, d: StudioDraft | undefined) =>
    setDrafts((prev) => {
      const next = { ...prev };
      if (d) next[id] = d;
      else delete next[id];
      return next;
    });

  return (
    <div class="screen page admin">
      {nav}
      <header class="adm-top">
        <div class="adm-top-title">
          <h1>Admin</h1>
          <Info
            side="start"
            below
            text="Pick a studio to set it up: its slots and rules, its return feed and the pages for the studio PC. Under “Every studio”: the guest's screen, the cues and the NDI gateway. How phones connect is the engineer's; hardware for each PC is under “This station”."
          />
        </div>
        <Pill tone={gw.tone} text={gw.word} tip={gw.detail} side="end" />
      </header>
      {error && (
        <p class="help bad" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <nav class="adm-tabs" aria-label="Studios">
        {list.map((p) => {
          const state = returnState(p, gateway);
          const unsaved = drafts[p.id] !== undefined && JSON.stringify(drafts[p.id]) !== JSON.stringify(draftOf(p));
          return (
            <button
              key={p.id}
              class={`adm-tab ${!adding && p.id === pcr?.id ? 'on' : ''}`}
              aria-current={!adding && p.id === pcr?.id}
              onClick={() => {
                setPicked(p.id);
                setAdding(false);
              }}
            >
              <i class={`adm-dot ${state.tone}`} />
              {p.name}
              <small>
                {p.settings.slots} {p.settings.slots === 1 ? 'slot' : 'slots'}
              </small>
              {unsaved && <i class="adm-unsaved" title="Changes not saved" />}
            </button>
          );
        })}
        {pcrs !== null && list.length > 0 && (
          <button class={`adm-tab new ${adding ? 'on' : ''}`} onClick={() => setAdding(true)}>
            + New studio
          </button>
        )}
      </nav>

      {pcrs !== null && (adding || list.length === 0) && (
        <NewStudio
          onBuilt={(built) => {
            setAdding(false);
            setPicked(built.id);
            void load();
          }}
          onCancel={list.length > 0 ? () => setAdding(false) : undefined}
          onError={setError}
        />
      )}

      {pcr && !adding && (
        <>
          <StudioCard
            key={pcr.id}
            pcr={pcr}
            gateway={gateway}
            draft={drafts[pcr.id]}
            onDraft={(d) => setDraft(pcr.id, d)}
            onSaved={() => void load()}
            onClosed={() => {
              setDraft(pcr.id, undefined);
              setPicked(null);
              void load();
            }}
            onError={setError}
          />
          <StudioPages pcr={pcr} gateway={gateway} />
        </>
      )}

      <h2 class="adm-divider">Every studio</h2>
      <ScreenDesigner onError={setError} />
      <CuesCard onError={setError} />
      <GatewayCard gateway={gateway} onSaved={pollGateway} onError={setError} />
    </div>
  );
}
