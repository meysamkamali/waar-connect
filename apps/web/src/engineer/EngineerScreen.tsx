// /app/engineer — the engineer's view of the whole station. There is no studio to sit in first:
// every PCR is on the page (/app/engineer/:id shows one alone).
// Every feed in a room is a tile: the studio return, the producer, and every guest from the moment
// they open their link (still at the door). Sound is on demand, per feed; listening to a guest also
// lets through the producer's voice while the producer talks to that guest. Selecting a feed opens
// its technical side: a guest's phone settings, the producer's face camera, or the return feed's
// source, picture and bitrate. Below sits how a guest's phone connects by default: the codec order,
// picture and bitrate every new guest starts with.
// The engineer only receives: no microphone, no camera, so the page joins by itself.
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
  roleOf,
  STUDIO_IDENTITY,
  talksTo,
  type CodecChoice,
  type CodecName,
  type CodecSupport,
  type EncoderKind,
  type FacePrefs,
  type GuestPrefs,
  type GuestState,
  type StaffState,
} from '@waar-connect/shared';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { returnLine, SourcePicker } from '../admin/Admin.tsx';
import { act, ApiError, gatewayStatus, getPcr, getRoom, joinPcr, listPcrs, updatePcr, type GatewayView, type Pcr, type PcrSettings, type PcrView, type RoomSnapshot, type User } from '../api.ts';
import { AudioSinks, VideoView } from '../components/media.tsx';
import { DEGRADE_LABELS, phoneModel, type GuestReport } from '../lib/report.ts';
import { formatSummary } from '../lib/stats.ts';
import { PhonePanel } from '../staff/GuestCard.tsx';
import { StaffSession, type StaffTile } from '../staff/session.ts';

type FeedKind = 'studio' | 'producer' | 'guest';

interface Feed {
  identity: string;
  kind: FeedKind;
  name: string;
  badge: string;
  tone: '' | 'standby' | 'onair';
  /** One line under the picture: what this feed is doing technically. */
  sub: string;
  tile: StaffTile | undefined;
  connected: boolean;
  /** The engineer can listen to it (the studio's sound is never sent to staff). */
  hasSound: boolean;
}

/** Shown while nobody sits at the producer desk, so the face camera settings stay reachable. */
const NO_PRODUCER = 'producer:';
const PLACE_LABEL: Readonly<Record<GuestState['place'], string>> = { lobby: 'at the door', green: 'green room', studio: 'studio', left: 'left' };
const GUEST_KBPS_CHOICES = [400, 800, 1500, 2500, 4000, 6000, 8000];
const FACE_KBPS_CHOICES = [150, 300, 600, 1000, 1500, 2500, 4000];

const message = (err: unknown) => (err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
const withValue = (choices: readonly number[], value: number) => (choices.includes(value) ? [...choices] : [...choices, value].sort((a, b) => a - b));
const numberOf = (e: Event) => Number((e.currentTarget as HTMLSelectElement).value);

function encoderMark(support: CodecSupport | undefined): string {
  return support === 'hw' ? ' ⚡' : support === 'sw' ? ' (software)' : '';
}

/** One line on a guest's phone for the tile: codec, picture and cap from its own report, and what arrives here. */
function guestLine(r: GuestReport | undefined, tile: StaffTile | undefined): string {
  const parts: string[] = [];
  if (r) {
    const codec = r.codec as CodecName;
    parts.push(`${CODEC_TITLES[codec] ?? r.codec}${encoderMark(r.codecs?.[codec])}`);
    if (r.height) parts.push(`${r.height}p${r.fps ? Math.round(r.fps) : ''}`);
    parts.push(`cap ${r.kbps}`);
  }
  if (tile?.stats) parts.push(`in ${tile.stats.kbps} kbit/s`, `loss ${tile.stats.lossPct}%`);
  return parts.length ? parts.join(' · ') : 'no report yet';
}

function FeedTile({ feed, selected, level, listening, onSelect, onListen }: { feed: Feed; selected: boolean; level: number; listening: boolean; onSelect: () => void; onListen: () => void }) {
  const video = feed.tile && !feed.tile.videoMuted ? feed.tile.video : null;
  const empty = !feed.connected ? 'not connected' : feed.kind === 'producer' ? 'face camera off' : 'no picture yet';
  return (
    <article class={`feed ${selected ? 'selected' : ''} ${feed.connected ? '' : 'offline'}`} onClick={onSelect}>
      <div class="guest-video">
        <VideoView track={video} />
        {!video && <div class="guest-novideo">{empty}</div>}
        <div class="guest-overlay">
          <span class="name">{feed.name}</span>
          <span class={`slot ${feed.tone ? `tally ${feed.tone}` : ''}`}>{feed.badge}</span>
          {feed.tile && feed.kind !== 'studio' && <span class={`slot quality-${feed.tile.quality}`}>{feed.tile.quality}</span>}
        </div>
      </div>
      <div class="level" title="Sound level as the server hears it">
        <div class="level-fill" style={{ width: `${Math.round(Math.min(1, level * 2.5) * 100)}%` }} />
      </div>
      <div class="feed-foot">
        <span class="muted small">{feed.sub}</span>
        {feed.hasSound && (
          <button
            class={`chip ${listening ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onListen();
            }}
          >
            {listening ? '🔊 listening' : '🔈 listen'}
          </button>
        )}
      </div>
    </article>
  );
}

type Save = (patch: Partial<PcrSettings>) => Promise<void>;

/** The producer's face camera: picture, frame rate and bitrate, kept per PCR and followed by the producer's console. */
function FaceEditor({ pcr, tile, onSave }: { pcr: Pcr; tile: StaffTile | undefined; onSave: Save }) {
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
        <span class="muted small">The producer's console picks a change up within a few seconds and starts its camera again with it.</span>
      </div>
    </>
  );
}

/** The return feed: which NDI source, how large, how many bits. The gateway picks a change up within 15 s. */
function ReturnEditor({ pcr, gateway, tile, onSave }: { pcr: Pcr; gateway: GatewayView | null; tile: StaffTile | undefined; onSave: Save }) {
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
        <span class="muted small">The gateway takes a change within 15 seconds; the picture drops for a moment while it restarts the feed.</span>
      </div>
    </>
  );
}

/**
 * How a guest's phone connects when nothing else was pushed to it: the codec order (tried from the
 * top), picture, frame rate, bitrate cap and what gives way first on a short line.
 */
function GuestPrefsEditor({ pcr, phones, onSave, onSaveAll }: { pcr: Pcr; phones: { name: string; codecs: GuestReport['codecs'] }[]; onSave: Save; onSaveAll: Save | undefined }) {
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
          <button class="chip" disabled={p.codecs.length >= MAX_CODEC_CHOICES} onClick={add}>
            + add a line
          </button>
          <p class="muted small">
            A phone takes the first line it can do. “Hardware” and “software” match only a phone that says which encoder it has; “any encoder” matches every phone that can send the codec. When no line fits, the phone
            sends H.264. A codec that fails on a phone is skipped there and the next line is taken.
          </p>
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
        <span class="muted small">
          Used when a guest connects or reloads. A setting pushed to one phone from its own panel wins on that phone; “studio preferences” in that panel brings the phone back to these.
        </span>
      </div>
    </article>
  );
}

/** The codec order and the picture of a studio's guest preferences in one line. */
function prefsLine(p: GuestPrefs): string {
  return `${p.codecs.map(describeChoice).join(' › ')} · ${p.height}p${p.fps} · ${p.kbps} kbit/s`;
}

/**
 * One studio on the engineer's page: its own connection to that studio's room (receive only), its
 * feeds, the technical side of the selected feed, and folded away how its guests connect.
 */
function PcrDesk({
  pcrId,
  gateway,
  selected,
  onSelect,
  onError,
  reloadKey,
  saveAll,
}: {
  pcrId: string;
  gateway: GatewayView | null;
  /** The selected feed when it is one of this studio's, else null. */
  selected: string | null;
  onSelect: (identity: string | null) => void;
  onError: (text: string) => void;
  /** Changes when a save in another studio wrote to this one too: read the settings again. */
  reloadKey: number;
  /** Saves a setting to every studio on the page; absent when this is the only one. */
  saveAll: Save | undefined;
}) {
  const session = useMemo(() => new StaffSession(), []);
  const [view, setView] = useState<PcrView | null>(null);
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [listening, setListening] = useState<string[]>([]);

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
    // Nothing to ask the browser for (no microphone, no camera): join at once.
    joinPcr(pcrId)
      .then((j) => session.connect(j))
      .catch((err: unknown) => onError(message(err)));
    return () => {
      clearInterval(room);
      void session.leave();
    };
  }, [pcrId, session]);

  useEffect(() => session.setFocus(selected), [selected, session]);

  if (!view) {
    return (
      <section class="eng-pcr">
        <p class="muted">Loading…</p>
      </section>
    );
  }

  const pcr = view.pcr;
  const guests = snap?.guests ?? [];
  const staff = snap?.staff ?? [];
  const connected = new Set(snap?.connected ?? []);
  const tileFor = (identity: string) => session.tiles.value.find((t) => t.identity === identity);
  const reportFor = (identity: string) => session.reports.value[identity];
  const nameOf = (identity: string) => view.guests.find((g) => g.identity === identity)?.displayName ?? tileFor(identity)?.name ?? identity.replace(/^guest:/, '');
  const producers = staff.filter((s) => s.role === 'producer' && connected.has(s.identity));

  const producerLine = (p: StaffState): string => {
    const talk = p.talkTo === 'none' ? 'not talking' : p.talkTo === 'all' ? 'talking to every green-room guest' : `talking to ${p.talkTo.map(nameOf).join(', ')}`;
    return p.faceTo ? `${talk} · face to face with ${nameOf(p.faceTo)}` : talk;
  };
  const studioTile = tileFor(STUDIO_IDENTITY);

  const feeds: Feed[] = [
    {
      identity: STUDIO_IDENTITY,
      kind: 'studio',
      name: 'Studio return',
      badge: 'program',
      tone: '',
      sub: `${pcr.settings.returnSource ?? 'from the return feed page'}${studioTile?.stats ? ` · in ${studioTile.stats.kbps} kbit/s` : ''}`,
      tile: studioTile,
      connected: snap?.studioConnected ?? false,
      hasSound: false,
    },
    ...(producers.length
      ? producers.map(
          (p): Feed => ({ identity: p.identity, kind: 'producer', name: tileFor(p.identity)?.name ?? 'Producer', badge: 'producer', tone: '', sub: producerLine(p), tile: tileFor(p.identity), connected: true, hasSound: true }),
        )
      : [{ identity: NO_PRODUCER, kind: 'producer', name: 'Producer', badge: 'producer', tone: '', sub: 'nobody at the producer desk', tile: undefined, connected: false, hasSound: false } satisfies Feed]),
    ...guests.map(
      (g): Feed => ({
        identity: g.identity,
        kind: 'guest',
        name: nameOf(g.identity),
        badge: g.place === 'studio' ? `studio${g.slot !== null ? ` · slot ${g.slot}` : ''} · ${g.tally === 'onair' ? 'ON AIR' : 'stand by'}` : PLACE_LABEL[g.place],
        tone: g.place === 'studio' && g.tally !== 'off' ? g.tally : '',
        sub: guestLine(reportFor(g.identity), tileFor(g.identity)),
        tile: tileFor(g.identity),
        connected: connected.has(g.identity),
        hasSound: true,
      }),
    ),
  ];

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

  const sel = feeds.find((f) => f.identity === selected);
  const selReport = sel?.kind === 'guest' ? reportFor(sel.identity) : undefined;
  const phones = guests.filter((g) => reportFor(g.identity)?.codecs).map((g) => ({ name: nameOf(g.identity), codecs: reportFor(g.identity)!.codecs }));
  const online = guests.filter((g) => connected.has(g.identity)).length;
  const close = (
    <button class="link" onClick={() => onSelect(null)}>
      close ✕
    </button>
  );

  return (
    <section class="eng-pcr">
      <header class="row between eng-pcr-head">
        <div class="row" style={{ alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <h2 class="eng-pcr-name">{pcr.name}</h2>
          <span class={`badge ${snap?.studioConnected ? 'live' : ''}`}>{snap?.studioConnected ? 'return feed on' : 'no return feed'}</span>
          <span class={`status ${session.status.value === 'connected' ? 'ok' : 'warn'}`}>{session.status.value}</span>
          <span class="muted small">
            {online === 1 ? '1 guest connected' : `${online} guests connected`} · {producers.length ? 'producer at the desk' : 'no producer'}
          </span>
        </div>
        <div class="row" style={{ alignItems: 'center' }}>
          <span class="muted small">{listening.length ? `listening to ${listening.length}` : 'sound off'}</span>
          <button class="btn secondary small" onClick={listenAll} disabled={guests.length === 0}>
            Listen to all guests
          </button>
          <button class="btn secondary small" onClick={() => setListening([])} disabled={listening.length === 0}>
            Silence
          </button>
        </div>
      </header>

      <div class={`eng-layout ${sel ? '' : 'solo'}`}>
        <div class="feeds">
          {feeds.map((f) => (
            <FeedTile
              key={f.identity}
              feed={f}
              selected={selected === f.identity}
              level={session.levels.value[f.identity] ?? 0}
              listening={listening.includes(f.identity)}
              onSelect={() => onSelect(selected === f.identity ? null : f.identity)}
              onListen={() => toggleListen(f.identity)}
            />
          ))}
        </div>

        {sel && (
          <aside class="eng-side">
            {sel.kind === 'guest' && (
              <>
                <div class="row between">
                  <h3 class="eng-side-title">{sel.name}</h3>
                  {close}
                </div>
                <div class="muted small">
                  {pcr.name} · {sel.badge}
                  {selReport ? ` · ${phoneModel(selReport.ua)}` : ''}
                  {sel.connected ? '' : ' · not connected'}
                </div>
                {sel.connected ? (
                  <div class="guest-controls">
                    <PhonePanel tile={sel.tile} report={selReport} cmd={(command) => void act(pcrId, { type: 'command', guest: sel.identity, command }).catch((err: unknown) => onError(message(err)))} />
                  </div>
                ) : (
                  <p class="muted">This guest is not connected right now.</p>
                )}
              </>
            )}
            {sel.kind === 'producer' && (
              <>
                <div class="row between">
                  <h3 class="eng-side-title">Producer camera · {pcr.name}</h3>
                  {close}
                </div>
                <div class="muted small">{sel.sub}</div>
                <FaceEditor key={`${pcr.settings.face?.height}-${pcr.settings.face?.fps}-${pcr.settings.face?.kbps}`} pcr={pcr} tile={sel.tile} onSave={save} />
              </>
            )}
            {sel.kind === 'studio' && (
              <>
                <div class="row between">
                  <h3 class="eng-side-title">Studio return · {pcr.name}</h3>
                  {close}
                </div>
                <ReturnEditor key={`${pcr.settings.returnSource}-${pcr.settings.returnHeight}-${pcr.settings.returnKbps}`} pcr={pcr} gateway={gateway} tile={sel.tile} onSave={save} />
              </>
            )}
          </aside>
        )}
      </div>

      <details class="eng-fold">
        <summary>
          How a guest's phone connects in {pcr.name}
          <span class="muted small"> · {prefsLine(normalizeGuestPrefs(pcr.settings.guest))}</span>
        </summary>
        <GuestPrefsEditor key={JSON.stringify(pcr.settings.guest ?? null)} pcr={pcr} phones={phones} onSave={save} onSaveAll={saveAll} />
      </details>

      <AudioSinks tracks={audible} />
    </section>
  );
}

/**
 * The engineer's page. No studio to sit in first: every studio is on the page, each with its own
 * receive-only connection, so every guest of the station shows the moment they open their link.
 * With an id in the address only that studio is shown.
 */
export function EngineerScreen({ id, user, nav }: { id?: string | undefined; user: User; nav: ComponentChildren }) {
  const [pcrs, setPcrs] = useState<Pcr[] | null>(null);
  const [gateway, setGateway] = useState<GatewayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ pcr: string; identity: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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

  return (
    <div class="screen page staff engineer">
      {nav}
      <header class="row between">
        <div class="row" style={{ alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h1>Engineer</h1>
          <span class="muted small">
            {pcrs === null ? 'loading…' : id ? 'one studio' : shown.length === 1 ? 'every connection in 1 studio' : `every connection in ${shown.length} studios`}
          </span>
          {id && (
            <a class="link" href="/app/engineer">
              show every studio
            </a>
          )}
        </div>
        <span class="muted small">Click a feed for its technical side. Sound plays only where you press listen.</span>
      </header>
      {error && (
        <p class="help bad" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {pcrs !== null && shown.length === 0 && <p class="muted">{id ? 'This studio does not exist or is closed.' : 'No studio built yet. The admin builds them under Admin.'}</p>}

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
        />
      ))}

      <p class="muted small">{user.name}: this page only receives. It never asks for a microphone or a camera.</p>
    </div>
  );
}
