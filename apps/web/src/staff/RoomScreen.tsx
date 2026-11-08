// /app/producer/:id — one PCR: the door, the green room, the studio slots, and the guests seated
// here with their links (from the contact book or a bare name).
import type { GuestState } from '@waar-connect/shared';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import {
  act,
  ApiError,
  createInvite,
  deleteGuest,
  getPcr,
  getRoom,
  joinPcr,
  listContacts,
  seatGuest,
  type Contact,
  type PcrView,
  type RoomAction,
  type RoomSnapshot,
  type User,
} from '../api.ts';
import { AudioSinks, VideoView } from '../components/media.tsx';
import { describeStation, loadStation } from '../lib/station.ts';
import { LANGUAGES } from './Contacts.tsx';
import { GuestCard, type GuestCardProps, type Sees } from './GuestCard.tsx';
import { GuestFocus } from './GuestFocus.tsx';
import { StaffSession } from './session.ts';

export function RoomScreen({ id, user }: { id: string; user: User }) {
  const { route } = useLocation();
  const session = useMemo(() => new StaffSession(), []);
  const [view, setView] = useState<PcrView | null>(null);
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Contact[]>([]);
  const [newGuest, setNewGuest] = useState('');
  const [newLang, setNewLang] = useState('ku');
  const [focused, setFocused] = useState<string | null>(null);
  const [solo, setSolo] = useState(true);
  const myIdentity = useRef('');
  const station = useMemo(() => describeStation(loadStation()), []);

  async function refresh(): Promise<void> {
    try {
      setView(await getPcr(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server not reachable.');
    }
  }

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => {
      getRoom(id)
        .then((r) => setSnap(r.snapshot))
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 409) setError(err.message);
        });
    }, 2000);
    return () => clearInterval(poll);
  }, [id]);

  useEffect(() => {
    if (!query.trim()) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => void listContacts(query.trim()).then((r) => setFound(r.contacts)).catch(() => setFound([])), 200);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => () => void session.leave(), [session]);
  useEffect(() => session.setFocus(focused), [focused, session]);

  async function join(): Promise<void> {
    try {
      const j = await joinPcr(id);
      myIdentity.current = j.identity;
      setJoined(true);
      await session.connect(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function doAction(action: RoomAction): void {
    act(id, action)
      .then((r) => setSnap(r.snapshot))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : String(err)));
  }

  const me = snap?.staff.find((s) => s.identity === myIdentity.current);
  const talkTo = me?.talkTo ?? 'none';
  const talkList = talkTo === 'all' ? null : talkTo === 'none' ? [] : [...talkTo];

  function hearMe(guest: string, on: boolean): void {
    let next: 'none' | 'all' | string[];
    if (talkList === null) next = on ? 'all' : 'none';
    else next = on ? [...talkList, guest] : talkList.filter((x) => x !== guest);
    doAction({ type: 'talk', to: Array.isArray(next) && next.length === 0 ? 'none' : next });
    void session.setTalking(next !== 'none' && (next === 'all' || next.length > 0));
  }

  function talkAll(on: boolean): void {
    doAction({ type: 'talk', to: on ? 'all' : 'none' });
    void session.setTalking(on);
  }

  /** What the guest sees in the green room: nothing, the producer's camera, or the studio return. */
  function see(g: GuestState, mode: Sees): void {
    const facing = me?.faceTo === g.identity;
    if (mode === 'me') {
      doAction({ type: 'face', guest: g.identity });
      void session.setFacing(true);
      if (g.program) doAction({ type: 'program', guest: g.identity, on: false });
      return;
    }
    if (facing) {
      doAction({ type: 'face', guest: null });
      void session.setFacing(false);
    }
    if ((mode === 'studio') !== g.program) doAction({ type: 'program', guest: g.identity, on: mode === 'studio' });
  }

  function seat(body: { contactId: string } | { displayName: string; language: string }): void {
    seatGuest(id, body)
      .then(({ guest }) => (guest.invites?.length ? undefined : createInvite(guest.id)))
      .then(() => {
        setQuery('');
        setNewGuest('');
        return refresh();
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : String(err)));
  }

  if (!view) return <div class="screen center">{error ? <p class="help bad">{error}</p> : <p>Loading…</p>}</div>;

  const settings = view.pcr.settings;
  const guestsByPlace = (place: GuestState['place']) => (snap?.guests ?? []).filter((g) => g.place === place);
  const recordFor = (identity: string) => view.guests.find((g) => g.identity === identity);
  const tileFor = (identity: string) => session.tiles.value.find((t) => t.identity === identity);
  const audible = session.listening.value
    ? session.tiles.value
        .filter((t) => !(focused && solo) || t.identity === focused)
        .map((t) => t.audio)
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : [];
  const focusedGuest = focused ? (snap?.guests ?? []).find((g) => g.identity === focused) : undefined;
  const seatedIds = new Set(view.guests.map((g) => g.contactId).filter((c): c is string => c !== null));

  const cardProps = (g: GuestState): GuestCardProps => ({
    state: g,
    record: recordFor(g.identity),
    tile: tileFor(g.identity),
    report: session.reports.value[g.identity],
    connected: snap?.connected.includes(g.identity) ?? false,
    outputNames: settings.outputNames,
    ifbAllowed: settings.ifbAllowed,
    ifb: snap?.ifbOverride.includes(g.identity) ?? false,
    hearsMe: talkList === null || talkList.includes(g.identity),
    sees: me?.faceTo === g.identity ? 'me' : g.program ? 'studio' : 'none',
    hand: session.hands.value[g.identity] === true,
    help: session.helps.value[g.identity] !== undefined,
    onAction: doAction,
    onHearMe: (on) => hearMe(g.identity, on),
    onSee: (mode) => see(g, mode),
    onClearHelp: () => session.clearHelp(g.identity),
    onFocus: () => setFocused(g.identity),
  });
  const card = (g: GuestState) => <GuestCard key={g.identity} {...cardProps(g)} />;

  return (
    <div class="screen page staff">
      <header class="row between">
        <div class="row" style={{ alignItems: 'center', gap: '12px' }}>
          <button class="link" onClick={() => route('/app/producer')}>
            ← studios
          </button>
          <h1>{view.pcr.name}</h1>
          <span class="muted small">{view.pcr.livekitRoom}</span>
          <span class={`badge ${snap?.studioConnected ? 'live' : ''}`}>{snap?.studioConnected ? 'return feed on' : 'no return feed'}</span>
        </div>
        <div class="row" style={{ alignItems: 'center' }}>
          {!joined ? (
            <button class="btn" onClick={() => void join()}>
              Join as producer
            </button>
          ) : (
            <>
              <span class={`status ${session.status.value === 'connected' ? 'ok' : 'warn'}`}>{session.status.value}</span>
              <button class={`btn ${talkList === null ? 'live' : 'secondary'} small`} onClick={() => talkAll(talkList !== null)}>
                {talkList === null ? 'Talking to all' : 'Talk to all'}
              </button>
              <button class="btn secondary small" onClick={() => session.setListening(!session.listening.value)}>
                {session.listening.value ? 'Sound on' : 'Sound off'}
              </button>
            </>
          )}
        </div>
      </header>
      {error && (
        <p class="help bad" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {session.error.value && <p class="help">{session.error.value}</p>}
      {!joined && <p class="help">Join first: without joining you see the states but no pictures, and the guest cannot hear you.</p>}

      <section>
        <h2>Studio</h2>
        <div class="slots">
          {Array.from({ length: settings.slots }, (_, i) => i + 1).map((n) => {
            const g = (snap?.guests ?? []).find((x) => x.slot === n && x.place === 'studio');
            const out = snap?.outputs.find((o) => o.slot === n);
            return (
              <div class={`slot-box ${g ? g.tally : 'empty'}`} key={n}>
                <div class="slot-head">
                  slot {n} · {settings.outputNames[n - 1]} {out ? <span class="ok">· output page connected</span> : <span class="muted">· no output page</span>}
                </div>
                {g ? card(g) : <div class="slate-mini">slate</div>}
              </div>
            );
          })}
          {guestsByPlace('studio')
            .filter((g) => g.slot === null)
            .map((g) => card(g))}
        </div>
      </section>

      <section>
        <h2>Green room</h2>
        <div class="cards">{guestsByPlace('green').map((g) => card(g))}</div>
        {guestsByPlace('green').length === 0 && <p class="muted">Nobody in the green room.</p>}
      </section>

      <section>
        <h2>Door</h2>
        <div class="cards">{guestsByPlace('lobby').map((g) => card(g))}</div>
        {guestsByPlace('lobby').length === 0 && <p class="muted">Nobody waiting.</p>}
      </section>

      <section>
        <h2>Guests and links</h2>
        <ul class="list">
          {view.guests.map((g) => (
            <li key={g.id}>
              <strong>{g.displayName}</strong> <span class="muted small">{g.language}</span>{' '}
              {g.invites[0] ? (
                <>
                  <code class="small">{g.invites[0].url}</code>{' '}
                  <button class="link" onClick={() => void navigator.clipboard?.writeText(g.invites[0]!.url)}>
                    copy
                  </button>
                </>
              ) : (
                <button class="link" onClick={() => void createInvite(g.id).then(refresh)}>
                  make link
                </button>
              )}
              {snap?.connected.includes(g.identity) ? <span class="ok"> · online</span> : <span class="muted"> · offline</span>}
              <button
                class="link bad"
                onClick={() => {
                  if (confirm(`Remove ${g.displayName} and their link from this studio?`)) void deleteGuest(g.id).then(refresh);
                }}
              >
                remove
              </button>
            </li>
          ))}
          {view.guests.length === 0 && <li class="muted">No guest seated yet.</li>}
        </ul>

        <h3 style={{ margin: '16px 0 6px' }}>Invite from the contact book</h3>
        <div class="row">
          <input placeholder="Search a contact…" value={query} onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
          <a class="btn secondary small" href="/app/contacts">
            Open contact book
          </a>
        </div>
        {found.length > 0 && (
          <ul class="list results">
            {found.map((c) => (
              <li key={c.id}>
                <strong>{c.displayName}</strong>
                <span class="muted small">
                  {[c.phone, c.whatsapp && `WhatsApp ${c.whatsapp}`, c.telegram && `Telegram ${c.telegram}`, c.skype && `Skype ${c.skype}`].filter(Boolean).join(' · ') || 'no contact details'}
                </span>
                {seatedIds.has(c.id) ? (
                  <span class="ok">already seated</span>
                ) : (
                  <button class="btn secondary small" onClick={() => seat({ contactId: c.id })}>
                    Seat and make link
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <h3 style={{ margin: '16px 0 6px' }}>Or a one-off guest</h3>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (newGuest.trim()) seat({ displayName: newGuest.trim(), language: newLang });
          }}
        >
          <input placeholder="Guest name" value={newGuest} onInput={(e) => setNewGuest((e.currentTarget as HTMLInputElement).value)} />
          <select value={newLang} onChange={(e) => setNewLang((e.currentTarget as HTMLSelectElement).value)}>
            {LANGUAGES.map(([code, label]) => (
              <option value={code} key={code}>
                {label}
              </option>
            ))}
          </select>
          <button class="btn secondary" type="submit">
            Seat and make link
          </button>
        </form>
      </section>

      <p class="muted small">
        {user.name}: this PC uses {station}. Output pages for this studio run on the studio PC; the admin has the links.
      </p>

      {focusedGuest && <GuestFocus {...cardProps(focusedGuest)} solo={solo} onSolo={setSolo} onClose={() => setFocused(null)} />}
      {session.localVideo.value && <VideoView track={session.localVideo.value} className="pip" mirror />}
      <AudioSinks tracks={audible} />
    </div>
  );
}
