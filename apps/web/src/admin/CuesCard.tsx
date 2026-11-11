// Admin: the producer's ready-made cues, for the whole station. One row per cue, one text per
// language; a guest gets the cue in the language of their page. Rows can be added, removed and moved
// (their order is the order on the producer's desk).
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { cueLabel, defaultCues, LANGUAGES, MAX_CUE_LENGTH, MAX_CUES, normalizeCues, type Cue } from '@waar-connect/shared';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, listCues, saveCues } from '../api.ts';
import { Icon, Info } from '../components/ui.tsx';

const message = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
const same = (a: Cue[], b: Cue[]) => JSON.stringify(a) === JSON.stringify(b);

export function CuesCard({ onError }: { onError: (m: string) => void }) {
  const [saved, setSaved] = useState<Cue[] | null>(null);
  const [draft, setDraft] = useState<Cue[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listCues()
      .then((r) => setSaved(r.cues))
      .catch((err: unknown) => onError(message(err)));
  }, []);

  if (!saved) return null;
  const cues = draft ?? saved;
  // what Save would store: empty rows are dropped there, so they do not count as a change by themselves
  const dirty = draft !== null && !same(normalizeCues(draft), saved);

  const setText = (i: number, code: string, value: string) => setDraft(cues.map((c, j) => (j === i ? { ...c, text: { ...c.text, [code]: value } } : c)));
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= cues.length) return;
    const next = [...cues];
    [next[i], next[j]] = [next[j] as Cue, next[i] as Cue];
    setDraft(next);
  };
  const add = () => setDraft([...cues, { id: `c-${Date.now().toString(36)}`, text: {} }]);

  const save = () => {
    setBusy(true);
    saveCues(normalizeCues(cues))
      .then((r) => {
        setSaved(r.cues);
        setDraft(null);
      })
      .catch((err: unknown) => onError(message(err)))
      .finally(() => setBusy(false));
  };

  return (
    <section class="adm-card">
      <header class="adm-card-head">
        <div class="adm-card-title">
          <h2>Cues</h2>
          <span class="ct-count">{cues.length}</span>
          <Info
            side="start"
            text="The producer's ready-made cues for a guest's screen, in the order they stand on the producer's desk. A guest gets a cue in the language of their page; where a cue has no text in that language, its English text goes out. The desk names each cue by its English text."
          />
        </div>
        <div class="adm-actions">
          <button class="btn secondary small" disabled={draft === null || busy} onClick={() => setDraft(null)}>
            <Icon name="undo" />
            Undo
          </button>
          <button class="btn small" disabled={!dirty || busy} onClick={save}>
            <Icon name="check" />
            Save
          </button>
        </div>
      </header>

      <div class="cue-grid" role="table" aria-label="Cues">
        <div class="cue-row cue-head" role="row">
          <span />
          {LANGUAGES.map((l) => (
            <span key={l.code} role="columnheader">
              {l.name}
              {l.native !== l.name && <small dir="rtl">{l.native}</small>}
            </span>
          ))}
          <span />
        </div>
        {cues.map((c, i) => (
          <div class="cue-row" role="row" key={c.id}>
            <span class="cue-move">
              <button class="chip" aria-label={`Move “${cueLabel(c) || 'new cue'}” up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <Icon name="up" />
              </button>
              <button class="chip" aria-label={`Move “${cueLabel(c) || 'new cue'}” down`} disabled={i === cues.length - 1} onClick={() => move(i, 1)}>
                <Icon name="down" />
              </button>
            </span>
            {LANGUAGES.map((l) => (
              <input
                key={l.code}
                role="cell"
                aria-label={`${l.name} text`}
                placeholder={l.name}
                lang={l.code}
                dir={l.rtl ? 'rtl' : 'ltr'}
                maxLength={MAX_CUE_LENGTH}
                value={c.text[l.code] ?? ''}
                onInput={(e) => setText(i, l.code, (e.currentTarget as HTMLInputElement).value)}
              />
            ))}
            <button class="chip cue-remove" aria-label={`Remove “${cueLabel(c) || 'new cue'}”`} title="Remove" onClick={() => setDraft(cues.filter((_, j) => j !== i))}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
        {cues.length === 0 && <div class="room-empty">No cue</div>}
      </div>

      <footer class="adm-foot">
        <button class="chip" disabled={cues.length >= MAX_CUES} onClick={add}>
          <Icon name="plus" /> Add a cue
        </button>
        <button class="chip tip tip-end" data-tip="Puts the station's own five cues back, in every language. Nothing changes until you save." disabled={same(cues, defaultCues())} onClick={() => setDraft(defaultCues())}>
          <Icon name="undo" /> Station cues
        </button>
      </footer>
    </section>
  );
}
