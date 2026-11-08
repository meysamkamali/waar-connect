// /app/g/:token — the guest's whole journey: link, device check, lobby, green room, studio, exit.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiError, resolveInvite, type JoinInfo } from '../api.ts';
import { setLanguage, t } from '../i18n/index.ts';
import { Call } from './Call.tsx';
import { DeviceCheck } from './DeviceCheck.tsx';
import { GuestSession, type DeviceChoice } from './session.ts';
import { watchBuild } from '../lib/version.ts';

// A guest who joined once stays joined across a reload of the same tab (a codec change pushed by the
// producer, a refresh, a newer build): the page connects again with the same devices instead of
// showing the device check, and the server gives back the same place and slot (rooms/controller.ts
// keeps them for a dropped guest for 15 minutes).
const JOIN_KEY = 'wc.guest.joined';
const JOIN_TTL_MS = 15 * 60_000;

interface SavedJoin {
  token: string;
  devices: DeviceChoice;
  at: number;
}

function loadJoin(token: string): DeviceChoice | undefined {
  try {
    const j = JSON.parse(sessionStorage.getItem(JOIN_KEY) ?? 'null') as SavedJoin | null;
    return j && j.token === token && Date.now() - j.at < JOIN_TTL_MS ? j.devices : undefined;
  } catch {
    return undefined;
  }
}

function saveJoin(token: string, devices: DeviceChoice): void {
  try {
    sessionStorage.setItem(JOIN_KEY, JSON.stringify({ token, devices, at: Date.now() } satisfies SavedJoin));
  } catch {
    // fine without: the guest sees the device check again after a reload
  }
}

function clearJoin(): void {
  try {
    sessionStorage.removeItem(JOIN_KEY);
  } catch {
    // nothing to clear
  }
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div class="screen center">
      <div class="card">
        <img class="logo" src="/app/logo.svg" alt="" />
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}

export function GuestPage({ token }: { token?: string }) {
  const session = useMemo(() => new GuestSession(), []);
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const joinedRef = useRef(false);
  joinedRef.current = joined;
  const devicesRef = useRef<DeviceChoice | null>(null);

  /** Connects. An automatic rejoin that fails (camera gone, permission lost) falls back to the device check. */
  const start = (i: JoinInfo, devices: DeviceChoice, automatic: boolean) => {
    if (!token) return;
    devicesRef.current = devices;
    saveJoin(token, devices);
    session.error.value = null;
    setJoined(true);
    session.connect(i, devices).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!automatic) {
        session.error.value = message;
        return;
      }
      console.warn('automatic rejoin failed, back to the device check:', message);
      clearJoin();
      devicesRef.current = null;
      void session.leave();
      setJoined(false);
    });
  };

  // A newer page on the server: reload while nothing is lost (not joined yet, or still at the door).
  useEffect(
    () =>
      watchBuild(() => {
        if (!joinedRef.current || session.state.value.place === 'lobby') location.reload();
      }),
    [session],
  );

  useEffect(() => {
    setLanguage(navigator.language.startsWith('ar') ? 'ar' : 'en');
    if (!token) {
      setError(t('invalidLink'));
      return;
    }
    resolveInvite(token)
      .then((i) => {
        setLanguage(i.guest.language);
        setInfo(i);
        const saved = loadJoin(token);
        if (saved) start(i, saved, true);
      })
      .catch((err: unknown) => setError(err instanceof ApiError && err.status !== 404 ? err.message : t('invalidLink')));
  }, [token]);

  useEffect(() => {
    const bye = () => {
      // A fresh timestamp: the rejoin window counts from the moment the page went away.
      if (token && joinedRef.current && devicesRef.current) saveJoin(token, devicesRef.current);
      void session.leave();
    };
    window.addEventListener('pagehide', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      bye();
    };
  }, [session, token]);

  const status = session.status.value;
  const place = session.state.value.place;
  const over = status === 'removed' || place === 'left';
  useEffect(() => {
    if (over) clearJoin(); // sent out or removed: a reload shows the device check, not a silent return
  }, [over]);

  if (error) return <Message title={t('appName')} text={error} />;
  if (!info) return <Message title={t('appName')} text={t('loading')} />;
  if (over) return <Message title={t('exitTitle')} text={t('exitText')} />;
  if (!joined) return <DeviceCheck info={info} onJoin={(devices) => start(info, devices, false)} />;
  return <Call session={session} info={info} />;
}
