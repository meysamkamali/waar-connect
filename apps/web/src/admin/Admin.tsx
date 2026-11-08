// /app/admin — the admin builds PCRs (studios), sets their slots and output names, and hands out the
// page links for the studio PC (return feed in, one output page per slot).
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, archivePcr, createPcr, listPcrs, updatePcr, type Pcr, type PcrSettings } from '../api.ts';
import { LANGUAGES } from '../staff/Contacts.tsx';

function PcrEditor({ pcr, onSaved, onError }: { pcr: Pcr; onSaved: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState(pcr.name);
  const [s, setS] = useState<PcrSettings>({ ...pcr.settings, outputNames: [...pcr.settings.outputNames] });
  const [busy, setBusy] = useState(false);
  const origin = location.origin;

  const setSlots = (n: number) => {
    const slots = Math.min(16, Math.max(1, n || 1));
    setS({ ...s, slots, outputNames: Array.from({ length: slots }, (_, i) => s.outputNames[i] ?? `Guest ${i + 1}`) });
  };

  const save = () => {
    setBusy(true);
    updatePcr(pcr.id, { name: name.trim() || pcr.name, settings: s })
      .then(onSaved)
      .catch((err: unknown) => onError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <article class="card">
      <div class="form-grid">
        <label>
          Name
          <input value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label>
          Output slots
          <input type="number" min={1} max={16} value={s.slots} onInput={(e) => setSlots(Number((e.currentTarget as HTMLInputElement).value))} />
        </label>
        <label class="inline" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={s.ifbAllowed} onChange={(e) => setS({ ...s, ifbAllowed: (e.currentTarget as HTMLInputElement).checked })} /> producer may talk to a guest who is on air (IFB)
        </label>
      </div>
      <div class="form-grid" style={{ marginTop: '8px' }}>
        {s.outputNames.map((n, i) => (
          <label key={i}>
            Slot {i + 1} output name
            <input
              value={n}
              onInput={(e) => {
                const outputNames = [...s.outputNames];
                outputNames[i] = (e.currentTarget as HTMLInputElement).value;
                setS({ ...s, outputNames });
              }}
            />
          </label>
        ))}
      </div>
      <div class="row" style={{ marginTop: '8px', flexWrap: 'wrap' }}>
        <span class="muted small">Invite languages:</span>
        {LANGUAGES.map(([code, label]) => (
          <label class="inline" key={code}>
            <input
              type="checkbox"
              checked={s.languages.includes(code)}
              onChange={(e) => {
                const on = (e.currentTarget as HTMLInputElement).checked;
                const languages = on ? [...s.languages, code] : s.languages.filter((l) => l !== code);
                if (languages.length) setS({ ...s, languages });
              }}
            />{' '}
            {label}
          </label>
        ))}
      </div>
      <div class="row" style={{ marginTop: '10px' }}>
        <button class="btn" onClick={save} disabled={busy}>
          Save
        </button>
        <button
          class="btn danger small"
          onClick={() => {
            if (confirm(`Close ${pcr.name}? Its guests and links stop working.`)) void archivePcr(pcr.id).then(onSaved);
          }}
        >
          Close studio
        </button>
      </div>
      <h4 style={{ margin: '14px 0 4px' }}>Pages for the studio PC</h4>
      <div class="kv">
        <span class="muted small">return feed in</span>
        <code class="small">
          {origin}/app/return/{pcr.id}
        </code>
        {s.outputNames.map((n, i) => (
          <>
            <span class="muted small">
              slot {i + 1} · {n}
            </span>
            <code class="small">
              {origin}/app/out/{pcr.id}/{i + 1}
            </code>
          </>
        ))}
      </div>
      <p class="muted small">LiveKit room {pcr.livekitRoom}. Set the capture devices for the return feed on the studio PC under “This station”.</p>
    </article>
  );
}

export function Admin({ nav }: { nav: ComponentChildren }) {
  const [pcrs, setPcrs] = useState<Pcr[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newSlots, setNewSlots] = useState(4);

  const load = () =>
    listPcrs()
      .then((r) => setPcrs(r.pcrs))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Server not reachable.'));
  useEffect(() => void load(), []);

  return (
    <div class="screen page">
      {nav}
      {error && (
        <p class="help bad" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      <section>
        <h2>Studios (PCRs)</h2>
        <p class="muted small">
          A studio is a standing place with its own door, green room and output slots. Producers sit in one and bring guests to it. Hardware choices for each PC are made under{' '}
          <a href="/app/admin/station">This station</a>, not by the producer.
        </p>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            void createPcr(newName.trim(), { slots: newSlots })
              .then(() => {
                setNewName('');
                return load();
              })
              .catch((err: unknown) => setError(err instanceof ApiError ? err.message : String(err)));
          }}
        >
          <input placeholder="New studio name, e.g. PCR 1" value={newName} onInput={(e) => setNewName((e.currentTarget as HTMLInputElement).value)} />
          <label class="inline">
            slots
            <input class="short" type="number" min={1} max={16} value={newSlots} onInput={(e) => setNewSlots(Number((e.currentTarget as HTMLInputElement).value) || 1)} />
          </label>
          <button class="btn" type="submit">
            Build studio
          </button>
        </form>
        <div class="list" style={{ marginTop: '12px' }}>
          {pcrs.map((p) => (
            <PcrEditor key={`${p.id}-${p.settings.slots}-${p.name}`} pcr={p} onSaved={() => void load()} onError={setError} />
          ))}
          {pcrs.length === 0 && <p class="muted">No studio built yet.</p>}
        </div>
      </section>
    </div>
  );
}
