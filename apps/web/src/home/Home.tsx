// /app — the first page: what the station is doing right now, and the way to each desk.
// The numbers come from the same API the desks use (open in the test phase); when it does not answer,
// the page still leads to the desks and says the status is not available.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { gatewayStatus, getRoom, listPcrs, me, type GatewayView, type Pcr, type RoomSnapshot } from '../api.ts';
import { BUILD } from '../lib/version.ts';

/** One stroke icon; the paths are Lucide's (ISC licence), drawn on a 24 grid. */
function Icon({ children }: { children: ComponentChildren }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const headphones = <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />;
const sliders = (
  <>
    <line x1="21" x2="14" y1="4" y2="4" />
    <line x1="10" x2="3" y1="4" y2="4" />
    <line x1="21" x2="12" y1="12" y2="12" />
    <line x1="8" x2="3" y1="12" y2="12" />
    <line x1="21" x2="16" y1="20" y2="20" />
    <line x1="12" x2="3" y1="20" y2="20" />
    <line x1="14" x2="14" y1="2" y2="6" />
    <line x1="8" x2="8" y1="10" y2="14" />
    <line x1="16" x2="16" y1="18" y2="22" />
  </>
);
const users = (
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>
);
const dashboard = (
  <>
    <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />
  </>
);
const monitor = (
  <>
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <line x1="8" x2="16" y1="21" y2="21" />
    <line x1="12" x2="12" y1="17" y2="21" />
  </>
);
const arrow = (
  <>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </>
);

const DESKS: { href: string; title: string; text: string; icon: ComponentChildren; primary?: true }[] = [
  { href: '/app/producer', title: 'Producer', text: 'Receive guests at the door, talk to them in the green room, send them to the studio.', icon: headphones, primary: true },
  { href: '/app/engineer', title: 'Engineer', text: 'Every connection in every studio: pictures, sound, phone settings and the codec order.', icon: sliders },
  { href: '/app/contacts', title: 'Contacts', text: 'The guest phone book. Seat a contact in a studio and send them the link.', icon: users },
  { href: '/app/admin', title: 'Admin', text: 'Build studios, name the output slots, pick NDI sources, lock the devices of this PC.', icon: dashboard },
];

interface Studio {
  pcr: Pcr;
  /** null: the room did not answer. */
  room: RoomSnapshot | null;
}

function Stat({ value, label, tone }: { value: number | null; label: string; tone?: 'onair' | undefined }) {
  return (
    <div class={`home-stat ${tone && value ? tone : ''}`}>
      <div class="n">{value ?? '–'}</div>
      <div class="l">{label}</div>
    </div>
  );
}

function StudioRow({ studio }: { studio: Studio }) {
  const { pcr, room } = studio;
  const online = room ? room.guests.filter((g) => room.connected.includes(g.identity)) : [];
  const at = (place: string) => online.filter((g) => g.place === place).length;
  const onAir = online.filter((g) => g.place === 'studio' && g.tally === 'onair').length;
  const producer = room?.staff.some((s) => s.role === 'producer' && room.connected.includes(s.identity)) ?? false;
  return (
    <li class="studio-row">
      <Icon>{monitor}</Icon>
      <span class="name">{pcr.name}</span>
      {room ? (
        <span class="pills">
          {onAir > 0 && (
            <span class="pill onair">
              <span class="dot" />
              ON AIR
            </span>
          )}
          <span class={`pill ${room.studioConnected ? 'ok' : 'quiet'}`}>
            <span class="dot" />
            {room.studioConnected ? 'return feed on' : 'no return feed'}
          </span>
          <span class={`pill ${producer ? 'ok' : 'quiet'}`}>
            <span class="dot" />
            {producer ? 'producer at the desk' : 'no producer'}
          </span>
          <span class={`pill ${at('lobby') ? '' : 'quiet'}`}>at the door {at('lobby')}</span>
          <span class={`pill ${at('green') ? '' : 'quiet'}`}>green room {at('green')}</span>
          <span class={`pill ${at('studio') ? '' : 'quiet'}`}>
            studio {at('studio')} of {pcr.settings.slots}
          </span>
        </span>
      ) : (
        <span class="pills">
          <span class="pill quiet">no answer from this studio</span>
        </span>
      )}
      <a class="studio-go" href={`/app/producer/${pcr.id}`}>
        Producer desk
        <Icon>{arrow}</Icon>
      </a>
    </li>
  );
}

export function Home() {
  const [studios, setStudios] = useState<Studio[] | null>(null);
  const [gateway, setGateway] = useState<GatewayView | null>(null);
  const [open, setOpen] = useState(false);
  const [down, setDown] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { pcrs } = await listPcrs();
        const rooms = await Promise.all(pcrs.map((p) => getRoom(p.id).then((r) => r.snapshot).catch(() => null)));
        if (!alive) return;
        setStudios(pcrs.map((pcr, i) => ({ pcr, room: rooms[i] ?? null })));
        setDown(false);
      } catch {
        if (alive) setDown(true);
      }
      gatewayStatus()
        .then((g) => alive && setGateway(g))
        .catch(() => undefined);
    };
    void load();
    me()
      .then((r) => alive && setOpen(r.open === true))
      .catch(() => undefined);
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const all = studios ?? [];
  const online = all.flatMap((s) => (s.room ? s.room.guests.filter((g) => s.room!.connected.includes(g.identity)) : []));
  const count = (n: number) => (studios ? n : null);
  const gatewayLine = !gateway ? '' : !gateway.configured ? 'no NDI gateway set up' : gateway.status ? `NDI gateway online, ${gateway.status.sources.length} sources seen` : 'NDI gateway offline';

  return (
    <div class="home">
      <header class="home-hero">
        <div class="home-wrap">
          <img class="home-logo" src="/app/logo.svg" alt="waar Connect" width="150" height="75" />
          <h1 class="home-title">Remote guests into the studio, live.</h1>
          <p class="home-tag">A guest opens a link on their phone. The producer receives them, the engineer watches the line, the studio takes them on a slot.</p>
          <div class="home-stats" aria-live="polite">
            <Stat value={count(all.length)} label={all.length === 1 ? 'studio' : 'studios'} />
            <Stat value={count(online.length)} label={online.length === 1 ? 'guest connected' : 'guests connected'} />
            <Stat value={count(online.filter((g) => g.place === 'studio' && g.tally === 'onair').length)} label="on air" tone="onair" />
            <Stat value={count(all.filter((s) => s.room?.studioConnected).length)} label={`return feeds on, of ${all.length}`} />
          </div>
          {down && <p class="home-note">The station status is not available right now. The desks below still open.</p>}
        </div>
      </header>

      <main class="home-wrap">
        <section class="home-section">
          <h2>Desks</h2>
          <div class="desks">
            {DESKS.map((d) => (
              <a class={`desk ${d.primary ? 'primary' : ''}`} href={d.href} key={d.href}>
                <Icon>{d.icon}</Icon>
                <h3>{d.title}</h3>
                <p>{d.text}</p>
                <span class="go">
                  Open
                  <Icon>{arrow}</Icon>
                </span>
              </a>
            ))}
          </div>
        </section>

        <section class="home-section">
          <h2>Studios now</h2>
          {studios === null && !down && <p class="muted">Loading…</p>}
          {studios?.length === 0 && (
            <p class="muted">
              No studio built yet. <a href="/app/admin">Build one in Admin.</a>
            </p>
          )}
          <ul class="studios">
            {all.map((s) => (
              <StudioRow key={s.pcr.id} studio={s} />
            ))}
          </ul>
          {gatewayLine && <p class="muted small">{gatewayLine}</p>}
        </section>

        <footer class="home-foot">
          <span>build {BUILD}</span>
          {open && <span>test phase: no sign-in</span>}
          <a href="/app/admin/station">This station</a>
          <a href="https://github.com/meysamkamali/waar-connect" rel="noopener" target="_blank">
            Source code (AGPL-3.0)
          </a>
        </footer>
      </main>
    </div>
  );
}
