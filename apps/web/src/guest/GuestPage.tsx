// /app/g/:token — the guest's whole journey: link, device check, lobby, green room, studio, exit.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ApiError, resolveInvite, type JoinInfo } from '../api.ts';
import { setLanguage, t } from '../i18n/index.ts';
import { Call } from './Call.tsx';
import { DeviceCheck } from './DeviceCheck.tsx';
import { GuestSession, type DeviceChoice } from './session.ts';

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
      })
      .catch((err: unknown) => setError(err instanceof ApiError && err.status !== 404 ? err.message : t('invalidLink')));
  }, [token]);

  useEffect(() => {
    const bye = () => void session.leave();
    window.addEventListener('pagehide', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      bye();
    };
  }, [session]);

  const status = session.status.value;
  const place = session.state.value.place;

  if (error) return <Message title={t('appName')} text={error} />;
  if (!info) return <Message title={t('appName')} text={t('loading')} />;
  if (status === 'removed' || place === 'left') return <Message title={t('exitTitle')} text={t('exitText')} />;

  if (!joined) {
    const onJoin = (devices: DeviceChoice) => {
      setJoined(true);
      session.connect(info, devices).catch((err: unknown) => {
        session.error.value = err instanceof Error ? err.message : String(err);
      });
    };
    return <DeviceCheck info={info} onJoin={onJoin} />;
  }

  return <Call session={session} info={info} />;
}
