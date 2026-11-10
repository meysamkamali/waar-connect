// /app/admin — the admin builds PCRs (studios), sets their slots and output names, and hands out the
// page links for the studio PC (return feed in, one output page per slot).
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { RETURN_HEIGHTS, RETURN_KBPS_CHOICES, type NdiSourceInfo } from '@waar-connect/shared';
import { ApiError, archivePcr, createPcr, gatewayStatus, listPcrs, setDiscovery, updatePcr, type GatewayView, type Pcr, type PcrSettings } from '../api.ts';
import { LANGUAGES } from '../staff/Contacts.tsx';

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
  const mv = r.mv ? ` · multiview burned in for ${r.mv.tiles} guests` : '';
  return `gateway ${r.state}${r.detail ? `: ${r.detail}` : ''}${video ? ` · ${video}` : ''}${out ? ` · ${out}` : ''}${mv}`;
}

function gatewaySummary(gateway: GatewayView | null): string {
  if (!gateway) return 'Gateway: …';
  if (!gateway.configured) return 'Gateway: none set up on the server. Return feeds come from the page on the studio PC.';
  if (!gateway.status) return 'Gateway: offline (no report in the last 20 s).';
  const n = gateway.status.sources.length;
  return `Gateway ${gateway.status.host} (${gateway.status.version}) online · ${n === 0 ? 'no NDI sources seen' : n === 1 ? '1 NDI source seen' : `${n} NDI sources seen`}`;
}

/** Where a sender sits as seen from the gateway: on one of the VM's own networks, or behind a router. */
function networkLabel(src: NdiSourceInfo): string {
  return src.network ? `on ${src.network}` : 'via router';
}

/** Every sender the gateway sees, with address and network. */
function SourceList({ gateway }: { gateway: GatewayView | null }) {
  const sources = gateway?.status?.sources ?? [];
  if (!sources.length) return null;
  return (
    <ul class="list muted small" style={{ marginTop: '4px' }}>
      {sources.map((src) => (
        <li key={`${src.name}|${src.url ?? ''}`}>
          <strong>{src.name}</strong> · {src.url ?? 'address unknown'} · {networkLabel(src)}
          {src.own ? ' · this gateway' : ''}
        </li>
      ))}
    </ul>
  );
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

/**
 * NDI senders on networks the VM is not on: mDNS does not reach them, so discovery also asks these
 * addresses. The gateway picks a change up within its next poll and restarts discovery.
 */
function DiscoveryEditor({ gateway, onSaved, onError }: { gateway: GatewayView | null; onSaved: () => void; onError: (m: string) => void }) {
  const saved = gateway?.extraIps ?? [];
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = text ?? saved.join(', ');
  const inUse = gateway?.status?.extraIps ?? [];
  return (
    <form
      class="row"
      style={{ marginTop: '10px', flexWrap: 'wrap', alignItems: 'center' }}
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setDiscovery(value.split(/[\s,;]+/).filter(Boolean))
          .then(() => {
            setText(null);
            onSaved();
          })
          .catch((err: unknown) => onError(err instanceof ApiError ? err.message : String(err)))
          .finally(() => setBusy(false));
      }}
    >
      <span class="muted small" title="IPv4 addresses or host names of NDI senders on subnets the VM has no leg on, separated by commas">
        NDI senders on other networks
      </span>
      <input style={{ flex: '1 1 260px' }} placeholder="10.1.1.107, 10.100.2.102" value={value} onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)} />
      <button class="btn secondary small" type="submit" disabled={busy || text === null}>
        Save
      </button>
      <span class="muted small">{gateway?.status ? (inUse.length ? `gateway asks: ${inUse.join(', ')}` : 'gateway asks mDNS only') : ''}</span>
    </form>
  );
}

function PcrEditor({ pcr, gateway, onSaved, onError }: { pcr: Pcr; gateway: GatewayView | null; onSaved: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState(pcr.name);
  const [s, setS] = useState<PcrSettings>({
    ...pcr.settings,
    outputNames: [...pcr.settings.outputNames],
    returnSource: pcr.settings.returnSource ?? null,
    returnHeight: pcr.settings.returnHeight ?? null,
    returnKbps: pcr.settings.returnKbps ?? null,
  });
  const defaults = gateway?.status?.defaults;
  const [busy, setBusy] = useState(false);
  const origin = location.origin;

  const setSlots = (n: number) => {
    const slots = Math.min(16, Math.max(1, n || 1));
    setS({ ...s, slots, outputNames: Array.from({ length: slots }, (_, i) => s.outputNames[i] ?? `Guest ${i + 1}`) });
  };

  const save = () => {
    setBusy(true);
    // The connection preferences belong to the engineer's page; sending this page's older copy would undo a change made there.
    const { guest: _guest, face: _face, ...own } = s;
    updatePcr(pcr.id, { name: name.trim() || pcr.name, settings: own })
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
          <SourcePicker value={s.returnSource} gateway={gateway} onChange={(v) => setS({ ...s, returnSource: v })} />
        </label>
        <span class="muted small" style={{ alignSelf: 'end', paddingBottom: '6px' }}>
          {returnLine(pcr, gateway)}
        </span>
      </div>
      <div class="form-grid" style={{ marginTop: '8px', gridTemplateColumns: 'minmax(140px, 1fr) minmax(140px, 1fr) 2fr' }}>
        <label>
          Return picture
          <select value={s.returnHeight ?? ''} onChange={(e) => setS({ ...s, returnHeight: Number((e.currentTarget as HTMLSelectElement).value) || null })}>
            <option value="">gateway default{defaults ? ` (${defaults.height ? `${defaults.height}p` : 'source size'})` : ''}</option>
            {RETURN_HEIGHTS.map((h) => (
              <option key={h} value={h}>
                {h}p
              </option>
            ))}
          </select>
        </label>
        <label>
          Return bitrate
          <select value={s.returnKbps ?? ''} onChange={(e) => setS({ ...s, returnKbps: Number((e.currentTarget as HTMLSelectElement).value) || null })}>
            <option value="">gateway default{defaults ? ` (${defaults.kbps} kbit/s)` : ''}</option>
            {RETURN_KBPS_CHOICES.map((k) => (
              <option key={k} value={k}>
                {k} kbit/s
              </option>
            ))}
          </select>
        </label>
        <span class="muted small" style={{ alignSelf: 'end', paddingBottom: '6px' }}>
          The guests watch the return on a phone. A smaller picture costs the server less: 540p is about a quarter of 1080p to encode.
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
  const pollGateway = () => void gatewayStatus().then(setGateway).catch(() => undefined);
  useEffect(() => {
    pollGateway();
    const timer = setInterval(pollGateway, 5000);
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
        <SourceList gateway={gateway} />
        <DiscoveryEditor gateway={gateway} onSaved={pollGateway} onError={setError} />
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
