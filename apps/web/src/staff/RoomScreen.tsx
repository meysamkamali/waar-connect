// /app/producer/:id — one studio as the producer works it. The guest's way runs from left to right:
// the door (with the list of everyone seated here and their links), the green room, the studio's
// slots. A guest's card carries what is done with them in that place; their phone's settings open in
// a drawer beside the room, and one guest can fill the screen (GuestFocus).
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { normalizeFacePrefs, normalizeNdiOut, roleOf, type Cue, type FacePrefs, type GuestState } from '@waar-connect/shared';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { act, ApiError, getPcr, getRoom, joinPcr, listCues, type PcrView, type RoomAction, type RoomSnapshot, type User } from '../api.ts';
import { AudioSinks, VideoView } from '../components/media.tsx';
import { Icon, Tip } from '../components/ui.tsx';
import { describeStation, loadStation } from '../lib/station.ts';
import { GuestCard, guestName, type GuestCardProps, type Sees } from './GuestCard.tsx';
import { GuestFocus } from './GuestFocus.tsx';
import { GuestList } from './GuestList.tsx';
import { PhonePanel } from './PhonePanel.tsx';
import { StaffSession } from './session.ts';

function Count({ n, label, tone }: { n: number; label: string; tone?: 'warn' | 'air' }) {
  return (
    <span class={`eng-count ${n > 0 ? (tone ?? '') : 'zero'}`}>
      <b>{n}</b>
      {label}
    </span>
  );
}

export function RoomScreen({ id }: { id: string; user: User }) {
  const { route } = useLocation();
  const session = useMemo(() => new StaffSession(), []);
  const [view, setView] = useState<PcrView | null>(null);
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [solo, setSolo] = useState(true);
  /** The guest whose phone settings are open in the drawer. */
  const [phone, setPhone] = useState<string | null>(null);
  /** The station's ready-made cues; read again every minute, so the admin's change arrives without a reload. */
  const [cues, setCues] = useState<Cue[]>([]);
  /** How the face camera is sent, from the room poll: the engineer can change it while we sit here. */
  const [face, setFace] = useState<FacePrefs | null>(null);
  const myIdentity = useRef('');
  const station = useMemo(() => loadStation(), []);

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
        .then((r) => {
          setSnap(r.snapshot);
          const next = r.face;
          if (next) setFace((prev) => (prev && prev.height === next.height && prev.fps === next.fps && prev.kbps === next.kbps ? prev : next));
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 409) setError(err.message);
        });
    }, 2000);
    return () => clearInterval(poll);
  }, [id]);

  useEffect(() => {
    const load = () => void listCues().then((r) => setCues(r.cues)).catch(() => undefined);
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => void session.leave(), [session]);
  useEffect(() => session.setFocus(focused), [focused, session]);
  useEffect(() => {
    if (joined && face) void session.applyFace(face);
  }, [face, joined, session]);

  async function join(): Promise<void> {
    try {
      const j = await joinPcr(id);
      myIdentity.current = j.identity;
      setJoined(true);
      await session.connect(j, face ?? normalizeFacePrefs(view?.pcr.settings.face));
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

  /** The multiview group is one conversation: talk on one of its guests reaches all, and switching it off takes it off all. */
  const mvIds = (snap?.guests ?? []).filter((x) => x.place === 'green' && x.mv).map((x) => x.identity);
  const mvTalk = talkList !== null && mvIds.some((x) => talkList.includes(x));

  function hearMe(guest: string, on: boolean): void {
    const group = mvIds.includes(guest) ? mvIds : [guest];
    let next: 'none' | 'all' | string[];
    if (talkList === null) next = on ? 'all' : 'none';
    else next = on ? [...talkList.filter((x) => x !== guest), guest] : talkList.filter((x) => !group.includes(x));
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

  if (!view) return <div class="screen center">{error ? <p class="help bad">{error}</p> : <p>Loading…</p>}</div>;

  const settings = view.pcr.settings;
  const all = snap?.guests ?? [];
  const guestsByPlace = (place: GuestState['place']) => all.filter((g) => g.place === place);
  const recordFor = (identity: string) => view.guests.find((g) => g.identity === identity);
  const tileFor = (identity: string) => session.tiles.value.find((t) => t.identity === identity);
  // Only the guests are played here. The studio's sound is never attached: the console sits in the PCR,
  // where the programme is on the monitors already (the server does not send it to staff either).
  const audible = session.listening.value
    ? session.tiles.value
        .filter((t) => roleOf(t.identity) === 'guest')
        .filter((t) => !(focused && solo) || t.identity === focused)
        .map((t) => t.audio)
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : [];
  const focusedGuest = focused ? all.find((g) => g.identity === focused) : undefined;
  const phoneGuest = phone ? all.find((g) => g.identity === phone) : undefined;

  const cardProps = (g: GuestState): GuestCardProps => ({
    state: g,
    record: recordFor(g.identity),
    tile: tileFor(g.identity),
    report: session.reports.value[g.identity],
    connected: snap?.connected.includes(g.identity) ?? false,
    outputNames: settings.outputNames,
    cues,
    ifbAllowed: settings.ifbAllowed,
    needsApproval: settings.approval !== false,
    ifb: snap?.ifbOverride.includes(g.identity) ?? false,
    hearsMe: talkList === null || talkList.includes(g.identity) || (mvTalk && mvIds.includes(g.identity)),
    sees: me?.faceTo === g.identity ? 'me' : g.program ? 'studio' : 'none',
    mvWith: g.mv
      ? guestsByPlace('green')
          .filter((o) => o.mv && o.identity !== g.identity)
          .map((o) => guestName({ record: recordFor(o.identity), state: o }))
      : [],
    hand: session.hands.value[g.identity] === true,
    help: session.helps.value[g.identity] !== undefined,
    onAction: doAction,
    onHearMe: (on) => hearMe(g.identity, on),
    onSee: (mode) => see(g, mode),
    onClearHelp: () => session.clearHelp(g.identity),
    onFocus: () => setFocused(g.identity),
    joined,
  });
  const card = (g: GuestState) => <GuestCard key={g.identity} {...cardProps(g)} onPhone={() => setPhone(phone === g.identity ? null : g.identity)} phoneOpen={phone === g.identity} />;

  const door = guestsByPlace('lobby');
  const green = guestsByPlace('green');
  const studio = guestsByPlace('studio');
  const onAir = studio.filter((g) => g.tally === 'onair').length;
  const talkingToAll = talkList === null;

  return (
    <div class="screen page staff room">
      <header class="room-top">
        <div class="room-title">
          <button class="chip" aria-label="Back to the studios" title="Back to the studios" onClick={() => route('/app/producer')}>
            <Icon name="back" />
          </button>
          <h1>{view.pcr.name}</h1>
          <span class={`adm-pill ${snap?.studioConnected ? 'ok' : 'bad'} tip tip-below`} data-tip={snap?.studioConnected ? 'The studio return is in the room: guests can see and hear the studio.' : 'No studio return in the room: guests sent to the studio see and hear nothing from it.'}>
            return feed
          </span>
          <span class="adm-pill tip tip-below" data-tip={`This PC: ${describeStation(station)}. The admin sets it under “This station”.`}>
            {station?.name || 'this desk'}
          </span>
        </div>
        <div class="eng-counts">
          <Count n={door.length} label="at the door" tone="warn" />
          <Count n={green.length} label="green room" />
          <Count n={studio.length} label="studio" />
          {onAir > 0 && <Count n={onAir} label="on air" tone="air" />}
        </div>
        <div class="adm-actions">
          {!joined ? (
            <Tip side="end" below text="Until you join you see where everyone is, but no pictures, and the guests cannot hear you.">
              <button class="btn" onClick={() => void join()}>
                <Icon name="mic" /> Join as producer
              </button>
            </Tip>
          ) : (
            <>
              {session.status.value !== 'connected' && <span class="status warn">{session.status.value}</span>}
              <button class={`btn ${talkingToAll ? 'live' : 'secondary'}`} aria-pressed={talkingToAll} title="Your voice to every guest in the green room" onClick={() => talkAll(!talkingToAll)}>
                <Icon name="mic" /> {talkingToAll ? 'Talking to all' : 'Talk to all'}
              </button>
              <button class="btn secondary" aria-pressed={session.listening.value} title="The guests' sound on this desk" onClick={() => session.setListening(!session.listening.value)}>
                <Icon name={session.listening.value ? 'sound' : 'silent'} /> {session.listening.value ? 'Sound on' : 'Sound off'}
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
      {session.error.value && <p class="help bad">{session.error.value}</p>}

      <div class="room-board">
        <section class="room-lane door">
          <h2>
            Door <span class="lane-count">{door.length}</span>
          </h2>
          {door.map((g) => card(g))}
          {door.length === 0 && <div class="room-empty">Nobody at the door</div>}
          <GuestList pcrId={id} guests={view.guests} snapshot={snap} onChanged={refresh} onError={setError} />
        </section>

        <section class="room-lane green">
          <h2>
            Green room <span class="lane-count">{green.length}</span>
          </h2>
          {green.length > 0 ? <div class="room-cards">{green.map((g) => card(g))}</div> : <div class="room-empty">Nobody in the green room</div>}
        </section>

        <section class="room-lane studio">
          <h2>
            Studio <span class="lane-count">{studio.length}</span>
          </h2>
          {Array.from({ length: settings.slots }, (_, i) => i + 1).map((n) => {
            const g = all.find((x) => x.slot === n && x.place === 'studio');
            // the slot's ways out to the studio: the gateway's NDI source, and the output page on the studio PC
            const outs = (snap?.outputs ?? []).filter((o) => o.slot === n);
            const ndi = outs.some((o) => o.identity.endsWith(':ndi'));
            const page = outs.some((o) => !o.identity.endsWith(':ndi'));
            // NDI sources come up with the guests: an empty slot without one is as it should be
            const ndiOn = normalizeNdiOut(settings.ndiOut).on;
            const missing = !ndi && !page && Boolean(g);
            const outTip =
              ndi && page
                ? 'This slot goes out as an NDI source, and its output page is open on the studio PC.'
                : ndi
                  ? 'This slot goes out as an NDI source.'
                  : page
                    ? 'The output page for this slot is open on the studio PC.'
                    : !ndiOn
                      ? 'Nothing takes this slot: no NDI source and no output page. The studio does not get this guest.'
                      : g
                        ? 'The NDI source of this slot is not up. It follows a guest within seconds; if it stays away, look at the gateway in Admin.'
                        : 'The NDI source of this slot comes up when a guest enters the green room.';
            return (
              <div class={`room-slot ${g ? g.tally : 'empty'}`} key={n}>
                <div class="room-slot-head">
                  <span class="room-slot-n">{n}</span>
                  <span>{settings.outputNames[n - 1]}</span>
                  <i class={`adm-dot ${ndi || page ? 'ok' : missing ? 'warn' : ''} tip tip-end`} data-tip={outTip} />
                </div>
                {g && card(g)}
              </div>
            );
          })}
          {studio.filter((g) => g.slot === null).map((g) => card(g))}
        </section>
      </div>

      {phoneGuest && (
        <aside class="eng-side room-drawer">
          <div class="row between">
            <h3 class="eng-side-title">{guestName({ record: recordFor(phoneGuest.identity), state: phoneGuest })}</h3>
            <button class="chip" aria-label="Close" onClick={() => setPhone(null)}>
              <Icon name="close" />
            </button>
          </div>
          <PhonePanel tile={tileFor(phoneGuest.identity)} report={session.reports.value[phoneGuest.identity]} cmd={(command) => doAction({ type: 'command', guest: phoneGuest.identity, command })} />
        </aside>
      )}

      {focusedGuest && <GuestFocus {...cardProps(focusedGuest)} solo={solo} onSolo={setSolo} onClose={() => setFocused(null)} />}
      {session.localVideo.value && <VideoView track={session.localVideo.value} className="pip" mirror />}
      <AudioSinks tracks={audible} />
    </div>
  );
}
