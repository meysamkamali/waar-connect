// /app/admin — the admin builds PCRs (studios), sets their slots and output names, and hands out the
// page links for the studio PC (return feed in, one output page per slot).
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, archivePcr, createPcr, gatewayStatus, listPcrs, updatePcr, type GatewayView, type Pcr, type PcrSettings } from '../api.ts';
import { LANGUAGES } from '../staff/Contacts.tsx';

/** One line on where this studio's return feed stands, from the gateway's last report. */
function returnLine(pcr: Pcr, gateway: GatewayView | null): string {
  if (!pcr.settings.returnSource) return 'No NDI source: the return feed page on the studio PC publishes the return.';
  if (!gateway) return 'gateway: …';
  if (!gateway.configured) return 'No gateway is set up on the server (GATEWAY_TOKEN); the source is saved but nothing picks it up.';
  if (!gateway.status) return 'Gateway offline: no report in the last 20 s.';
  const r = gateway.status.returns.find((x) => x.pcrId === pcr.id);
  if (!r) return 'Gateway online; it picks this studio up within 15 s.';
  const video = r.video ? `${r.video.width}x${r.video.height} ${r.video.fps} fps` : '';
  const out = r.publish ? `${r.publish.codec} up to ${r.publish.maxKbps} kbit/s` : '';
  return `gateway ${r.state}${r.detail ? `: ${r.detail}` : ''}${video ? ` · ${video}` : ''}${out ? ` · ${out}` : ''}`;
}

function gatewaySummary(gateway: GatewayView | null): string {
  if (!gateway) return 'Gateway: …';
  if (!gateway.configured) return 'Gateway: none set up on the server. Return feeds come from the page on the studio PC.';
  if (!gateway.status) return 'Gateway: offline (no report in the last 20 s).';
  const names = gateway.status.sources.map((s) => s.name);
  return `Gateway ${gateway.status.host} (${gateway.status.version}) online · NDI sources: ${names.length ? names.join(', ') : 'none seen'}`;
}

function PcrEditor({ pcr, gateway, onSaved, onError }: { pcr: Pcr; gateway: GatewayView | null; onSaved: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState(pcr.name);
  const [s, setS] = useState<PcrSettings>({ ...pcr.settings, outputNames: [...pcr.settings.outputNames], returnSource: pcr.settings.returnSource ?? null });
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
      <div class="form-grid" style={{ marginTop: '8px', gridTemplateColumns: 'minmax(200px, 1fr) 2fr' }}>
        <label>
          Return feed from NDI source
          <input
            list="ndi-sources"
            placeholder="none: the return feed page"
            value={s.returnSource ?? ''}
            onInput={(e) => setS({ ...s, returnSource: (e.currentTarget as HTMLInputElement).value || null })}
          />
        </label>
        <span class="muted small" style={{ alignSelf: 'end', paddingBottom: '6px' }}>
          {returnLine(pcr, gateway)}
        </span>
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
        {pcr.settings.returnSource ? (
          <span class="small">
            from the gateway, NDI source <strong>{pcr.settings.returnSource}</strong> (the page below is not needed)
          </span>
        ) : (
          <code class="small">
            {origin}/app/return/{pcr.id}
          </code>
        )}
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
      <p class="muted small">
        LiveKit room {pcr.livekitRoom}.{' '}
        {pcr.settings.returnSource ? 'The gateway takes the return from NDI; nothing to set on the studio PC for it.' : 'Set the capture devices for the return feed on the studio PC under “This station”.'}
      </p>
    </article>
  );
}

export function Admin({ nav }: { nav: ComponentChildren }) {
  const [pcrs, setPcrs] = useState<Pcr[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newSlots, setNewSlots] = useState(4);
  const [gateway, setGateway] = useState<GatewayView | null>(null);

  const load = () =>
    listPcrs()
      .then((r) => setPcrs(r.pcrs))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Server not reachable.'));
  useEffect(() => void load(), []);

  // The gateway reports every 5 s; the page follows at the same pace.
  useEffect(() => {
    const poll = () => void gatewayStatus().then(setGateway).catch(() => undefined);
    poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, []);

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
        <p class="muted small" style={{ marginTop: '10px' }}>
          {gatewaySummary(gateway)}
        </p>
        <datalist id="ndi-sources">{(gateway?.status?.sources ?? []).map((src) => <option key={src.name} value={src.name} />)}</datalist>
        <div class="list" style={{ marginTop: '12px' }}>
          {pcrs.map((p) => (
            <PcrEditor key={`${p.id}-${p.settings.slots}-${p.name}`} pcr={p} gateway={gateway} onSaved={() => void load()} onError={setError} />
          ))}
          {pcrs.length === 0 && <p class="muted">No studio built yet.</p>}
        </div>
      </section>
    </div>
  );
}
