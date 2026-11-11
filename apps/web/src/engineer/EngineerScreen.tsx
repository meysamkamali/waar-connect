// /app/engineer — the engineer's view of the whole station. There is no studio to sit in first:
// every PCR is on the page (/app/engineer/:id shows one alone).
// Per studio: its two own sources (the return feed and the producer) and one row per guest, from the
// moment they open their link. A guest's row keeps the line and picture meters in view as bars, and
// carries the approval for air: where the studio asks for it, the producer cannot send a guest to
// the studio or put them on air before the engineer approved them here.
// Sound is on demand, per guest; listening to a guest also lets through the producer's voice while
// the producer talks to that guest. Settings (a guest's phone, the producer's camera, the return
// feed, how phones connect) open in the side panel.
// The engineer only receives: no microphone, no camera, so the page joins by itself.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { CODEC_TITLES, normalizeGuestPrefs, roleOf, STUDIO_IDENTITY, talksTo, type CodecName, type CodecSupport, type GuestState, type StaffState } from '@waar-connect/shared';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { act, ApiError, gatewayStatus, getPcr, getRoom, joinPcr, listPcrs, updatePcr, type GatewayView, type Pcr, type PcrView, type RoomSnapshot } from '../api.ts';
import { AudioSinks, VideoView } from '../components/media.tsx';
import { Icon, Info } from '../components/ui.tsx';
import { assess, type Quality } from '../lib/quality.ts';
import { phoneModel, type GuestReport } from '../lib/report.ts';
import { PhonePanel } from '../staff/PhonePanel.tsx';
import { StaffSession, type StaffTile } from '../staff/session.ts';
import { FaceEditor, GuestPrefsEditor, prefsLine, ReturnEditor, type Save } from './editors.tsx';
import { GuestRow } from './GuestRow.tsx';

/** Stands for the producer's seat while nobody sits there, so the face camera settings stay reachable. */
const NO_PRODUCER = 'producer:';

/** What one studio adds to the station's numbers at the top of the page. */
interface DeskSummary {
  guests: number;
  waiting: number;
  problems: number;
  onAir: number;
}

const message = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));

function encoderMark(support: CodecSupport | undefined): string {
  return support === 'hw' ? ' (hardware)' : support === 'sw' ? ' (software)' : '';
}

/** The phone in a few words: codec on the wire, model, network, battery. */
function guestFacts(r: GuestReport | undefined): string {
  if (!r) return '';
  const codec = (r.wire ?? r.codec) as CodecName;
  const parts = [`${CODEC_TITLES[codec] ?? codec}${encoderMark(r.codecs?.[codec])}`, phoneModel(r.ua)];
  if (r.net) parts.push(r.net);
  if (r.relay) parts.push('relay');
  if (r.battery !== undefined) parts.push(`battery ${r.battery} %`);
  return parts.join(' · ');
}

/** Studio first (on air, then stand by), then the green room, then the door. */
function placeRank(g: GuestState): number {
  if (g.place === 'studio') return g.tally === 'onair' ? 0 : g.tally === 'standby' ? 1 : 2;
  return g.place === 'green' ? 3 : 4;
}

function Count({ n, label, tone }: { n: number; label: string; tone?: 'warn' | 'bad' | 'air' }) {
  return (
    <span class={`eng-count ${n > 0 ? (tone ?? '') : 'zero'}`}>
      <b>{n}</b>
      {label}
    </span>
  );
}

function Counts({ s, approval }: { s: DeskSummary; approval: boolean }) {
  return (
    <>
      <Count n={s.guests} label={s.guests === 1 ? 'guest' : 'guests'} />
      {approval && <Count n={s.waiting} label="to approve" tone="warn" />}
      <Count n={s.problems} label={s.problems === 1 ? 'problem' : 'problems'} tone="bad" />
      {s.onAir > 0 && <Count n={s.onAir} label="on air" tone="air" />}
    </>
  );
}

/** The return feed or the producer: a small picture, its state in a line, and its settings on a click. */
function SourceTile(p: { name: string; sub: string; tile: StaffTile | undefined; connected: boolean; empty: string; selected: boolean; level?: number | undefined; listening?: boolean | undefined; onSelect: () => void; onListen?: (() => void) | undefined }) {
  const video = p.tile && !p.tile.videoMuted ? p.tile.video : null;
  return (
    <div
      class={`eng-source ${p.selected ? 'selected' : ''} ${p.connected ? '' : 'offline'}`}
      role="button"
      tabIndex={0}
      aria-pressed={p.selected}
      onClick={p.onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          p.onSelect();
        }
      }}
    >
      <div class="guest-video">
        <VideoView track={video} />
        {!video && <div class="guest-novideo">{p.empty}</div>}
      </div>
      <div class="eng-source-body">
        <div class="eng-source-name">
          {p.name}
          {p.onListen && (
            <button
              class={`chip ${p.listening ? 'on' : ''}`}
              aria-pressed={p.listening}
              aria-label={p.listening ? 'Listening' : 'Listen'}
              onClick={(e) => {
                e.stopPropagation();
                p.onListen?.();
              }}
            >
              <Icon name={p.listening ? 'sound' : 'silent'} />
            </button>
          )}
        </div>
        <div class="eng-source-sub">{p.sub}</div>
        {p.level !== undefined && (
          <div class="eng-sound-track">
            <div class="eng-sound-fill" style={{ width: `${Math.round(Math.min(1, p.level * 2.5) * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One studio on the engineer's page: its own connection to that studio's room (receive only), its
 * sources and guests, and the settings of whatever is selected.
 */
function PcrDesk({
  pcrId,
  gateway,
  selected,
  onSelect,
  onError,
  reloadKey,
  saveAll,
  onSummary,
}: {
  pcrId: string;
  gateway: GatewayView | null;
  /** What is selected when it belongs to this studio, else null. */
  selected: string | null;
  onSelect: (identity: string | null) => void;
  onError: (text: string) => void;
  /** Changes when a save in another studio wrote to this one too: read the settings again. */
  reloadKey: number;
  /** Saves a setting to every studio on the page; absent when this is the only one. */
  saveAll: Save | undefined;
  onSummary: (pcrId: string, summary: (DeskSummary & { approval: boolean }) | null) => void;
}) {
  const session = useMemo(() => new StaffSession(), []);
  const [view, setView] = useState<PcrView | null>(null);
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [listening, setListening] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const refresh = () =>
    getPcr(pcrId)
      .then(setView)
      .catch((err: unknown) => onError(message(err)));

  useEffect(() => {
    void refresh();
  }, [pcrId, reloadKey]);

  useEffect(() => {
    const pollRoom = () =>
      void getRoom(pcrId)
        .then((r) => setSnap(r.snapshot))
        .catch(() => undefined);
    pollRoom();
    const room = setInterval(pollRoom, 2000);
    const clock = setInterval(() => setNow(Date.now()), 1000); // numbers that stop coming turn grey
    // Nothing to ask the browser for (no microphone, no camera): join at once.
    joinPcr(pcrId)
      .then((j) => session.connect(j))
      .catch((err: unknown) => onError(message(err)));
    return () => {
      clearInterval(room);
      clearInterval(clock);
      void session.leave();
      onSummary(pcrId, null);
    };
  }, [pcrId, session]);

  useEffect(() => session.setFocus(selected), [selected, session]);

  const pcr = view?.pcr;
  const needsApproval = pcr ? pcr.settings.approval !== false : true;
  const prefs = normalizeGuestPrefs(pcr?.settings.guest);
  const staff = snap?.staff ?? [];
  const connected = new Set(snap?.connected ?? []);
  const tileFor = (identity: string) => session.tiles.value.find((t) => t.identity === identity);
  const reportFor = (identity: string) => session.reports.value[identity];
  const nameOf = (identity: string) => view?.guests.find((g) => g.identity === identity)?.displayName ?? tileFor(identity)?.name ?? identity.replace(/^guest:/, '');

  const qualityOf = (g: GuestState): Quality => {
    if (!connected.has(g.identity)) return assess({});
    const tile = tileFor(g.identity);
    const report = reportFor(g.identity);
    const live = session.live.value[g.identity];
    const camera = report?.width && report.height ? Math.min(report.width, report.height) : report?.height;
    return assess({
      line: tile && tile.quality !== 'unknown' ? tile.quality : (live?.quality ?? report?.quality),
      up: live?.up ?? report?.up,
      capKbps: report?.kbps ?? prefs.kbps,
      cameraHeight: camera ?? prefs.height,
      askedFps: report?.fpsAsked ?? prefs.fps,
      recv: tile?.stats,
      ageMs: live ? now - live.seenAt : undefined,
    });
  };

  const guests = (snap?.guests ?? []).filter((g) => g.place !== 'left');
  const rows = guests
    .map((g, i) => ({ g, i, on: connected.has(g.identity), q: qualityOf(g) }))
    .sort((a, b) => placeRank(a.g) - placeRank(b.g) || a.i - b.i);
  const summary: DeskSummary = {
    guests: rows.filter((r) => r.on).length,
    waiting: needsApproval ? rows.filter((r) => r.on && !r.g.ready).length : 0,
    problems: rows.filter((r) => r.on && r.q.tone === 'bad').length,
    onAir: rows.filter((r) => r.g.place === 'studio' && r.g.tally === 'onair').length,
  };
  const summaryKey = `${summary.guests}/${summary.waiting}/${summary.problems}/${summary.onAir}/${needsApproval}`;
  useEffect(() => {
    if (pcr) onSummary(pcrId, { ...summary, approval: needsApproval });
  }, [summaryKey, pcr === undefined]);

  if (!view || !pcr) {
    return (
      <section class="eng-pcr">
        <p class="muted">Loading…</p>
      </section>
    );
  }

  const producers = staff.filter((s) => s.role === 'producer' && connected.has(s.identity));
  const producerLine = (p: StaffState): string => {
    const talk = p.talkTo === 'none' ? 'not talking' : p.talkTo === 'all' ? 'talking to the green room' : `talking to ${p.talkTo.map(nameOf).join(', ')}`;
    return p.faceTo ? `${talk} · face to face with ${nameOf(p.faceTo)}` : talk;
  };
  const studioTile = tileFor(STUDIO_IDENTITY);

  // Sound: the guests the engineer chose, and a producer's talk when chosen itself or while it goes to a chosen guest.
  const guestIds = new Set(guests.map((g) => g.identity));
  const producerHeard = (p: StaffState) => listening.includes(p.identity) || listening.some((gid) => guestIds.has(gid) && talksTo(p, gid));
  const audible = session.tiles.value
    .filter((t) => {
      const role = roleOf(t.identity);
      if (role === 'guest') return listening.includes(t.identity);
      if (role !== 'producer') return false;
      const p = staff.find((s) => s.identity === t.identity);
      return p ? producerHeard(p) : listening.includes(t.identity);
    })
    .map((t) => t.audio)
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const toggleListen = (identity: string) => {
    void session.room.startAudio().catch(() => undefined); // a click is what lets the browser play sound
    setListening((prev) => (prev.includes(identity) ? prev.filter((x) => x !== identity) : [...prev, identity]));
  };
  const listenAll = () => {
    void session.room.startAudio().catch(() => undefined);
    setListening(guests.map((g) => g.identity));
  };

  const save: Save = (patch) =>
    updatePcr(pcrId, { settings: patch })
      .then(() => refresh())
      .catch((err: unknown) => {
        onError(message(err));
        throw err;
      });

  const approve = (identity: string, on: boolean) =>
    void act(pcrId, { type: 'ready', guest: identity, on })
      .then((r) => setSnap(r.snapshot))
      .catch((err: unknown) => onError(message(err)));

  const toggle = (identity: string) => onSelect(selected === identity ? null : identity);
  const selGuest = rows.find((r) => r.g.identity === selected);
  const selProducer = selected !== null && (selected === NO_PRODUCER || producers.some((p) => p.identity === selected));
  const selStudio = selected === STUDIO_IDENTITY;
  const open = selGuest !== undefined || selProducer || selStudio;
  const phones = guests.filter((g) => reportFor(g.identity)?.codecs).map((g) => ({ name: nameOf(g.identity), codecs: reportFor(g.identity)!.codecs }));
  const close = (
    <button class="chip" onClick={() => onSelect(null)} aria-label="Close">
      <Icon name="close" />
    </button>
  );

  return (
    <section class="eng-pcr">
      <header class="eng-pcr-head">
        <div class="eng-pcr-title">
          <h2 class="eng-pcr-name">{pcr.name}</h2>
          <span class={`eng-pill ${snap?.studioConnected ? 'on' : 'off'}`}>return feed</span>
          <span class={`eng-pill ${producers.length ? 'on' : ''}`}>producer</span>
          {session.status.value !== 'connected' && <span class="status warn">{session.status.value}</span>}
        </div>
        <div class="eng-counts">
          <Counts s={summary} approval={needsApproval} />
          <button class="btn secondary small" onClick={listening.length ? () => setListening([]) : listenAll} disabled={guests.length === 0}>
            <Icon name={listening.length ? 'silent' : 'sound'} /> {listening.length ? 'Silence' : 'Listen to all'}
          </button>
        </div>
      </header>

      <div class={`eng-layout ${open ? '' : 'solo'}`}>
        <div class="eng-main">
          <div class="eng-sources">
            <SourceTile
              name="Studio return"
              sub={`${pcr.settings.returnSource ?? 'from the return feed page'}${studioTile?.stats ? ` · ${studioTile.stats.kbps} kbit/s` : ''}`}
              tile={studioTile}
              connected={snap?.studioConnected ?? false}
              empty={snap?.studioConnected ? 'no picture yet' : 'not connected'}
              selected={selStudio}
              onSelect={() => toggle(STUDIO_IDENTITY)}
            />
            {producers.length ? (
              producers.map((p) => (
                <SourceTile
                  key={p.identity}
                  name={tileFor(p.identity)?.name ?? 'Producer'}
                  sub={producerLine(p)}
                  tile={tileFor(p.identity)}
                  connected
                  empty="face camera off"
                  selected={selected === p.identity}
                  level={session.levels.value[p.identity] ?? 0}
                  listening={listening.includes(p.identity)}
                  onSelect={() => toggle(p.identity)}
                  onListen={() => toggleListen(p.identity)}
                />
              ))
            ) : (
              <SourceTile name="Producer" sub="nobody at the desk" tile={undefined} connected={false} empty="not connected" selected={selected === NO_PRODUCER} onSelect={() => toggle(NO_PRODUCER)} />
            )}
          </div>

          <div class="eng-guests">
            {rows.length === 0 && <div class="eng-empty">No guest in {pcr.name}</div>}
            {rows.map(({ g, on, q }) => (
              <GuestRow
                key={g.identity}
                name={nameOf(g.identity)}
                state={g}
                connected={on}
                video={tileFor(g.identity)?.video ?? null}
                level={session.levels.value[g.identity] ?? 0}
                quality={q}
                facts={guestFacts(reportFor(g.identity))}
                needsApproval={needsApproval}
                listening={listening.includes(g.identity)}
                selected={selected === g.identity}
                onApprove={(yes) => approve(g.identity, yes)}
                onListen={() => toggleListen(g.identity)}
                onSettings={() => toggle(g.identity)}
              />
            ))}
          </div>

          <details class="eng-fold">
            <summary>How phones connect · {prefsLine(prefs)}</summary>
            <GuestPrefsEditor key={JSON.stringify(pcr.settings.guest ?? null)} pcr={pcr} phones={phones} onSave={save} onSaveAll={saveAll} />
          </details>
        </div>

        {open && (
          <aside class="eng-side">
            {selGuest && (
              <>
                <div class="row between">
                  <h3 class="eng-side-title">{nameOf(selGuest.g.identity)}</h3>
                  {close}
                </div>
                {selGuest.on ? (
                  <PhonePanel
                    tile={tileFor(selGuest.g.identity)}
                    report={reportFor(selGuest.g.identity)}
                    cmd={(command) => void act(pcrId, { type: 'command', guest: selGuest.g.identity, command }).catch((err: unknown) => onError(message(err)))}
                  />
                ) : (
                  <p class="muted">Not connected.</p>
                )}
              </>
            )}
            {selProducer && (
              <>
                <div class="row between">
                  <h3 class="eng-side-title">Producer camera</h3>
                  {close}
                </div>
                <FaceEditor key={`${pcr.settings.face?.height}-${pcr.settings.face?.fps}-${pcr.settings.face?.kbps}`} pcr={pcr} tile={selected ? tileFor(selected) : undefined} onSave={save} />
              </>
            )}
            {selStudio && (
              <>
                <div class="row between">
                  <h3 class="eng-side-title">Studio return</h3>
                  {close}
                </div>
                <ReturnEditor key={`${pcr.settings.returnSource}-${pcr.settings.returnHeight}-${pcr.settings.returnKbps}`} pcr={pcr} gateway={gateway} tile={studioTile} onSave={save} />
              </>
            )}
          </aside>
        )}
      </div>

      <AudioSinks tracks={audible} />
    </section>
  );
}

/**
 * The engineer's page. No studio to sit in first: every studio is on the page, each with its own
 * receive-only connection, so every guest of the station shows the moment they open their link.
 * With an id in the address only that studio is shown.
 */
export function EngineerScreen({ id, nav }: { id?: string | undefined; nav: ComponentChildren }) {
  const [pcrs, setPcrs] = useState<Pcr[] | null>(null);
  const [gateway, setGateway] = useState<GatewayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ pcr: string; identity: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sums, setSums] = useState<Record<string, DeskSummary & { approval: boolean }>>({});

  useEffect(() => {
    const load = () =>
      void listPcrs()
        .then((r) => setPcrs(r.pcrs))
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Server not reachable.'));
    const pollGateway = () => void gatewayStatus().then(setGateway).catch(() => undefined);
    load();
    pollGateway();
    const list = setInterval(load, 15_000); // a studio the admin just built or closed
    const gw = setInterval(pollGateway, 5000);
    return () => {
      clearInterval(list);
      clearInterval(gw);
    };
  }, []);

  const shown = (pcrs ?? []).filter((p) => !id || p.id === id);
  const saveAll: Save | undefined =
    shown.length > 1
      ? (patch) =>
          Promise.all(shown.map((p) => updatePcr(p.id, { settings: patch })))
            .then(() => setReloadKey((k) => k + 1))
            .catch((err: unknown) => {
              setError(message(err));
              throw err;
            })
      : undefined;

  const onSummary = (pcrId: string, s: (DeskSummary & { approval: boolean }) | null) =>
    setSums((prev) => {
      const next = { ...prev };
      if (s) next[pcrId] = s;
      else delete next[pcrId];
      return next;
    });
  const station = shown
    .map((p) => sums[p.id])
    .filter((s): s is DeskSummary & { approval: boolean } => s !== undefined)
    .reduce((a, s) => ({ guests: a.guests + s.guests, waiting: a.waiting + s.waiting, problems: a.problems + s.problems, onAir: a.onAir + s.onAir, approval: a.approval || s.approval }), {
      guests: 0,
      waiting: 0,
      problems: 0,
      onAir: 0,
      approval: false,
    });

  return (
    <div class="screen page staff engineer">
      {nav}
      <header class="eng-top">
        <div class="eng-top-title">
          <h1>Engineer</h1>
          <Info
            side="start"
            below
            text="Each bar is green when fit for air, amber when it needs watching and red when it is not fit; the marks on a bar are its limits. Phones send their numbers every two seconds; grey means no fresh numbers. Sound plays only where you press Listen. This page only receives: it never uses a microphone or a camera."
          />
          {id && (
            <a class="link" href="/app/engineer">
              every studio
            </a>
          )}
        </div>
        {shown.length > 1 && (
          <div class="eng-counts">
            <Counts s={station} approval={station.approval} />
          </div>
        )}
      </header>
      {error && (
        <p class="help bad" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {pcrs !== null && shown.length === 0 && <div class="eng-empty">{id ? 'This studio does not exist or is closed' : 'No studio built yet'}</div>}

      {shown.map((p) => (
        <PcrDesk
          key={p.id}
          pcrId={p.id}
          gateway={gateway}
          selected={selected?.pcr === p.id ? selected.identity : null}
          onSelect={(identity) => setSelected(identity === null ? null : { pcr: p.id, identity })}
          onError={setError}
          reloadKey={reloadKey}
          saveAll={saveAll}
          onSummary={onSummary}
        />
      ))}
    </div>
  );
}
