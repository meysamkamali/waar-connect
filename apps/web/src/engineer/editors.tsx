// The engineer's editors: the producer's face camera, the return feed, and how a guest's phone connects
// by default (codec order, picture, bitrate). Each edits a draft and saves it to the PCR.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import {
  CODEC_NAMES,
  CODEC_TITLES,
  DEFAULT_GUEST_PREFS,
  DEGRADE_MODES,
  describeChoice,
  ENCODER_KINDS,
  ENCODER_TITLES,
  FACE_HEIGHTS,
  FACE_RATES,
  GUEST_HEIGHTS,
  GUEST_RATES,
  MAX_CODEC_CHOICES,
  normalizeFacePrefs,
  normalizeGuestPrefs,
  pickCodecLine,
  RETURN_HEIGHTS,
  RETURN_KBPS_CHOICES,
  type CodecChoice,
  type CodecName,
  type EncoderKind,
  type FacePrefs,
  type GuestPrefs,
} from '@waar-connect/shared';
import { useState } from 'preact/hooks';
import { returnLine, SourcePicker } from '../admin/Admin.tsx';
import { Info } from '../components/ui.tsx';
import type { GatewayView, Pcr, PcrSettings } from '../api.ts';
import { DEGRADE_LABELS, type GuestReport } from '../lib/report.ts';
import { formatSummary } from '../lib/stats.ts';
import type { StaffTile } from '../staff/session.ts';

const GUEST_KBPS_CHOICES = [400, 800, 1500, 2500, 4000, 6000, 8000];
const FACE_KBPS_CHOICES = [150, 300, 600, 1000, 1500, 2500, 4000];
const withValue = (choices: readonly number[], value: number) => (choices.includes(value) ? [...choices] : [...choices, value].sort((a, b) => a - b));
const numberOf = (e: Event) => Number((e.currentTarget as HTMLSelectElement).value);

export type Save = (patch: Partial<PcrSettings>) => Promise<void>;

/** The producer's face camera: picture, frame rate and bitrate, kept per PCR and followed by the producer's console. */
export function FaceEditor({ pcr, tile, onSave }: { pcr: Pcr; tile: StaffTile | undefined; onSave: Save }) {
  const saved = normalizeFacePrefs(pcr.settings.face);
  const [draft, setDraft] = useState<FacePrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const f = draft ?? saved;
  const set = (patch: Partial<FacePrefs>) => setDraft({ ...f, ...patch });
  return (
    <>
      <pre class="stats">{tile?.video && !tile.videoMuted ? formatSummary('IN ', tile.stats) : 'The face camera is off. It runs only while the producer is face to face with a guest.'}</pre>
      <div class="form-grid">
        <label>
          Picture
          <select value={f.height} onChange={(e) => set({ height: numberOf(e) })}>
            {FACE_HEIGHTS.map((h) => (
              <option key={h} value={h}>
                {h}p
              </option>
            ))}
          </select>
        </label>
        <label>
          Frame rate
          <select value={f.fps} onChange={(e) => set({ fps: numberOf(e) })}>
            {FACE_RATES.map((r) => (
              <option key={r} value={r}>
                {r} fps
              </option>
            ))}
          </select>
        </label>
        <label>
          Bitrate cap
          <select value={f.kbps} onChange={(e) => set({ kbps: numberOf(e) })}>
            {withValue(FACE_KBPS_CHOICES, f.kbps).map((k) => (
              <option key={k} value={k}>
                {k} kbit/s
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="row">
        <button
          class="btn small"
          disabled={busy || draft === null}
          onClick={() => {
            setBusy(true);
            void onSave({ face: f })
              .then(() => setDraft(null))
              .finally(() => setBusy(false));
          }}
        >
          Save
        </button>
        <Info text="The producer's console picks a change up within a few seconds and starts its camera again with it." />
      </div>
    </>
  );
}

/** The return feed: which NDI source, how large, how many bits. The gateway picks a change up within 15 s. */
export function ReturnEditor({ pcr, gateway, tile, onSave }: { pcr: Pcr; gateway: GatewayView | null; tile: StaffTile | undefined; onSave: Save }) {
  type Draft = Pick<PcrSettings, 'returnSource' | 'returnHeight' | 'returnKbps'>;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const s = pcr.settings;
  const d: Draft = draft ?? { returnSource: s.returnSource ?? null, returnHeight: s.returnHeight ?? null, returnKbps: s.returnKbps ?? null };
  const defaults = gateway?.status?.defaults;
  return (
    <>
      <pre class="stats">
        {formatSummary('IN ', tile?.stats)}
        {'\n'}
        {returnLine(pcr, gateway)}
      </pre>
      <div class="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label>
          NDI source
          <SourcePicker value={d.returnSource} gateway={gateway} onChange={(v) => setDraft({ ...d, returnSource: v })} />
        </label>
      </div>
      <div class="form-grid">
        <label>
          Picture
          <select value={d.returnHeight ?? ''} onChange={(e) => setDraft({ ...d, returnHeight: numberOf(e) || null })}>
            <option value="">gateway default{defaults ? ` (${defaults.height ? `${defaults.height}p` : 'source size'})` : ''}</option>
            {RETURN_HEIGHTS.map((h) => (
              <option key={h} value={h}>
                {h}p
              </option>
            ))}
          </select>
        </label>
        <label>
          Bitrate cap
          <select value={d.returnKbps ?? ''} onChange={(e) => setDraft({ ...d, returnKbps: numberOf(e) || null })}>
            <option value="">gateway default{defaults ? ` (${defaults.kbps} kbit/s)` : ''}</option>
            {RETURN_KBPS_CHOICES.map((k) => (
              <option key={k} value={k}>
                {k} kbit/s
              </option>
            ))}
          </select>
        </label>
      </div>
      <div class="row">
        <button
          class="btn small"
          disabled={busy || draft === null}
          onClick={() => {
            setBusy(true);
            void onSave(d)
              .then(() => setDraft(null))
              .finally(() => setBusy(false));
          }}
        >
          Save
        </button>
        <Info text="The gateway takes a change within 15 seconds; the picture drops for a moment while it restarts the feed." />
      </div>
    </>
  );
}

/**
 * How a guest's phone connects when nothing else was pushed to it: the codec order (tried from the
 * top), picture, frame rate, bitrate cap and what gives way first on a short line.
 */
export function GuestPrefsEditor({ pcr, phones, onSave, onSaveAll }: { pcr: Pcr; phones: { name: string; codecs: GuestReport['codecs'] }[]; onSave: Save; onSaveAll: Save | undefined }) {
  const saved = normalizeGuestPrefs(pcr.settings.guest);
  const [draft, setDraft] = useState<GuestPrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const p = draft ?? saved;
  const set = (patch: Partial<GuestPrefs>) => setDraft({ ...p, ...patch });
  const setLine = (i: number, patch: Partial<CodecChoice>) => set({ codecs: p.codecs.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= p.codecs.length) return;
    const codecs = [...p.codecs];
    [codecs[i], codecs[j]] = [codecs[j]!, codecs[i]!];
    set({ codecs });
  };
  const add = () => {
    const taken = new Set(p.codecs.map((c) => `${c.codec}/${c.encoder}`));
    for (const encoder of ENCODER_KINDS) {
      for (const codec of CODEC_NAMES) {
        if (!taken.has(`${codec}/${encoder}`)) return set({ codecs: [...p.codecs, { codec, encoder }] });
      }
    }
  };
  const repeated = (i: number) => p.codecs.findIndex((c) => c.codec === p.codecs[i]!.codec && c.encoder === p.codecs[i]!.encoder) !== i;

  return (
    <article class="eng-card">
      <div class="eng-prefs">
        <div>
          <h3>Codec order</h3>
          <ol class="codec-order">
            {p.codecs.map((c, i) => (
              <li key={i} class={repeated(i) ? 'repeated' : ''}>
                <span class="muted small">{i + 1}</span>
                <select value={c.codec} onChange={(e) => setLine(i, { codec: (e.currentTarget as HTMLSelectElement).value as CodecName })}>
                  {CODEC_NAMES.map((n) => (
                    <option key={n} value={n}>
                      {CODEC_TITLES[n]}
                    </option>
                  ))}
                </select>
                <select value={c.encoder} onChange={(e) => setLine(i, { encoder: (e.currentTarget as HTMLSelectElement).value as EncoderKind })}>
                  {ENCODER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ENCODER_TITLES[k]}
                    </option>
                  ))}
                </select>
                <button class="chip" title="Try it earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button class="chip" title="Try it later" disabled={i === p.codecs.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button class="chip" title="Take this line out" disabled={p.codecs.length <= 1} onClick={() => set({ codecs: p.codecs.filter((_, j) => j !== i) })}>
                  ✕
                </button>
                {repeated(i) && <span class="muted small">same as a line above</span>}
              </li>
            ))}
          </ol>
          <div class="row" style={{ alignItems: 'center' }}>
            <button class="chip" disabled={p.codecs.length >= MAX_CODEC_CHOICES} onClick={add}>
              + add a line
            </button>
            <Info
              side="start"
              text="A phone takes the first line it can do. “Hardware” and “software” match only a phone that says which encoder it has; “any encoder” matches every phone that can send the codec. When no line fits, the phone sends H.264. A codec that fails on a phone is skipped there and the next line is taken."
            />
          </div>
        </div>
        <div>
          <h3>Picture and bitrate</h3>
          <div class="form-grid">
            <label>
              Picture
              <select value={p.height} onChange={(e) => set({ height: numberOf(e) })}>
                {GUEST_HEIGHTS.map((h) => (
                  <option key={h} value={h}>
                    {h}p
                  </option>
                ))}
              </select>
            </label>
            <label>
              Frame rate
              <select value={p.fps} onChange={(e) => set({ fps: numberOf(e) })}>
                {GUEST_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r} fps
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bitrate cap
              <select value={p.kbps} onChange={(e) => set({ kbps: numberOf(e) })}>
                {withValue(GUEST_KBPS_CHOICES, p.kbps).map((k) => (
                  <option key={k} value={k}>
                    {k} kbit/s
                  </option>
                ))}
              </select>
            </label>
            <label>
              When the line is short
              <select value={p.degrade} onChange={(e) => set({ degrade: (e.currentTarget as HTMLSelectElement).value as GuestPrefs['degrade'] })}>
                {DEGRADE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {DEGRADE_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {phones.length > 0 && (
            <>
              <h3 style={{ marginTop: '12px' }}>With this order, the phones here would send</h3>
              <ul class="list small">
                {phones.map((ph) => {
                  const line = pickCodecLine(p.codecs, ph.codecs);
                  return (
                    <li key={ph.name}>
                      <strong>{ph.name}</strong>
                      <span class="muted">{line >= 0 ? `line ${line + 1}: ${describeChoice(p.codecs[line]!)}` : 'no line fits: H.264'}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
      <div class="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          class="btn"
          disabled={busy || draft === null}
          onClick={() => {
            setBusy(true);
            void onSave({ guest: p })
              .then(() => setDraft(null))
              .finally(() => setBusy(false));
          }}
        >
          Save
        </button>
        {onSaveAll && (
          <button
            class="btn secondary small"
            title="Write this order, picture and bitrate to every studio on this page"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onSaveAll({ guest: p })
                .then(() => setDraft(null))
                .finally(() => setBusy(false));
            }}
          >
            Save for every studio
          </button>
        )}
        <button class="btn secondary small" disabled={draft === null} onClick={() => setDraft(null)}>
          Undo changes
        </button>
        <button class="btn secondary small" onClick={() => setDraft(normalizeGuestPrefs(DEFAULT_GUEST_PREFS))}>
          Station defaults
        </button>
        <Info text="Used when a guest connects or reloads. A setting pushed to one phone from its own panel wins on that phone; “studio preferences” in that panel brings the phone back to these." />
      </div>
    </article>
  );
}

/** The codec order and the picture of a studio's guest preferences in one line. */
export function prefsLine(p: GuestPrefs): string {
  return `${p.codecs.map(describeChoice).join(' › ')} · ${p.height}p${p.fps} · ${p.kbps} kbit/s`;
}
