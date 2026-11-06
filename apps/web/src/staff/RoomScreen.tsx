// /app/producer/:id and /app/engineer/:id — the door, the green room, the studio strip.
import type { GuestState } from '@waar-connect/shared';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { act, addGuest, ApiError, createInvite, endEpisode, getEpisode, getRoom, joinEpisode, startEpisode, type EpisodeView, type RoomAction, type RoomSnapshot, type User } from '../api.ts';
import { AudioSinks, VideoView } from '../components/media.tsx';
import { GuestCard } from './GuestCard.tsx';
import { StaffSession } from './session.ts';

export function RoomScreen({ id, user, engineer }: { id?: string; user: User; engineer: boolean }) {
  const { route } = useLocation();
  const session = useMemo(() => new StaffSession(), []);
  const [view, setView] = useState<EpisodeView | null>(null);
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [newGuest, setNewGuest] = useState('');
  const [newLang, setNewLang] = useState('ku');
  const myIdentity = useRef('');

  const episodeId = id ?? '';

  async function refresh(): Promise<void> {
    try {
      setView(await getEpisode(episodeId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server not reachable.');
    }
  }

  useEffect(() => {
    if (!episodeId) return;
    void refresh();
    const poll = setInterval(() => {
      getRoom(episodeId)
        .then((r) => setSnap(r.snapshot))
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 409) setError(err.message);
        });
    }, 2000);
    return () => clearInterval(poll);
  }, [episodeId]);

  useEffect(() => () => void session.leave(), [session]);

  async function join(): Promise<void> {
    try {
      const j = await joinEpisode(episodeId);
      myIdentity.current = j.identity;
      setJoined(true);
      await session.connect(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function doAction(action: RoomAction): void {
    act(episodeId, action)
      .then((r) => setSnap(r.snapshot))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : String(err)));
  }

  const me = snap?.staff.find((s) => s.identity === myIdentity.current);
  const talkTo = me?.talkTo ?? 'none';
  const talkList = talkTo === 'all' ? null : talkTo === 'none' ? [] : [...talkTo];

  function talk(guest: string, on: boolean): void {
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

  function face(guest: string, on: boolean): void {
    doAction({ type: 'face', guest: on ? guest : null });
    void session.setFacing(on);
  }

  if (!episodeId) return <p>No episode.</p>;
  if (!view) return <div class="screen center">{error ? <p class="help bad">{error}</p> : <p>Loading…</p>}</div>;

  const guestsByPlace = (place: GuestState['place']) => (snap?.guests ?? []).filter((g) => g.place === place);
  const recordFor = (identity: string) => view.guests.find((g) => g.identity === identity);
  const tileFor = (identity: string) => session.tiles.value.find((t) => t.identity === identity);
  const slotsCount = view.settings?.slots ?? 4;
  const audible = session.listening.value ? session.tiles.value.map((t) => t.audio).filter((a): a is NonNullable<typeof a> => a !== null) : [];

  const card = (g: GuestState) => (
    <GuestCard
      key={g.identity}
      state={g}
      record={recordFor(g.identity)}
      tile={tileFor(g.identity)}
      connected={snap?.connected.includes(g.identity) ?? false}
      engineer={engineer || user.role === 'admin'}
      slots={slotsCount}
      ifbAllowed={view.settings?.ifbAllowed ?? false}
      ifb={snap?.ifbOverride.includes(g.identity) ?? false}
      talkingTo={talkList === null || talkList.includes(g.identity)}
      facing={me?.faceTo === g.identity}
      hand={session.hands.value[g.identity] === true}
      help={session.helps.value[g.identity] !== undefined}
      onAction={doAction}
      onTalk={(on) => talk(g.identity, on)}
      onFace={(on) => face(g.identity, on)}
      onClearHelp={() => session.clearHelp(g.identity)}
    />
  );

  return (
    <div class="screen page staff">
      <header class="row between">
        <div class="row" style={{ alignItems: 'center', gap: '12px' }}>
          <button class="link" onClick={() => route('/app/producer')}>
            ← programmes
          </button>
          <h1>{view.episode.title}</h1>
          <span class={`badge ${view.episode.status}`}>{view.episode.status}</span>
          <span class="muted small">{view.episode.livekitRoom}</span>
        </div>
        <div class="row" style={{ alignItems: 'center' }}>
          {view.episode.status === 'planned' && (
            <button class="btn secondary small" onClick={() => void startEpisode(episodeId).then(refresh)}>
              Start episode
            </button>
          )}
          {view.episode.status === 'live' && (
            <button class="btn danger small" onClick={() => void endEpisode(episodeId).then(refresh)}>
              End episode
            </button>
          )}
          {!joined ? (
            <button class="btn" onClick={() => void join()}>
              Join room as {engineer ? 'engineer' : 'producer'}
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

      <section>
        <h2>Studio</h2>
        <div class="slots">
          {Array.from({ length: slotsCount }, (_, i) => i + 1).map((n) => {
            const g = (snap?.guests ?? []).find((x) => x.slot === n && x.place === 'studio');
            const out = snap?.outputs.find((o) => o.slot === n);
            return (
              <div class={`slot-box ${g ? g.tally : 'empty'}`} key={n}>
                <div class="slot-head">
                  slot {n} {out ? <span class="ok">· output connected</span> : <span class="muted">· no output page</span>}
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
        <h2>Guest list and links</h2>
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
            </li>
          ))}
        </ul>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newGuest.trim()) return;
            void addGuest(episodeId, newGuest.trim(), newLang)
              .then(({ guest }) => createInvite(guest.id))
              .then(() => {
                setNewGuest('');
                return refresh();
              })
              .catch((err: unknown) => setError(err instanceof ApiError ? err.message : String(err)));
          }}
        >
          <input placeholder="Guest name" value={newGuest} onInput={(e) => setNewGuest((e.currentTarget as HTMLInputElement).value)} />
          <select value={newLang} onChange={(e) => setNewLang((e.currentTarget as HTMLSelectElement).value)}>
            <option value="ku">Kurdî (Kurmancî)</option>
            <option value="ckb">کوردی (سۆرانی)</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
          <button class="btn secondary" type="submit">
            Add guest and link
          </button>
        </form>
      </section>

      {session.localVideo.value && <VideoView track={session.localVideo.value} className="pip" mirror />}
      <AudioSinks tracks={audible} />
    </div>
  );
}
