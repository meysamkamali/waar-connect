// The PCRs (studios) a producer or engineer can sit in. The admin builds them on /app/admin.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { ApiError, listPcrs, type Pcr, type User } from '../api.ts';
import { describeStation, loadStation } from '../lib/station.ts';

export function Pcrs({ user, nav }: { user: User; nav: ComponentChildren }) {
  const { route } = useLocation();
  const [pcrs, setPcrs] = useState<Pcr[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPcrs()
      .then((r) => setPcrs(r.pcrs))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Server not reachable.'));
  }, []);

  return (
    <div class="screen page">
      {nav}
      {error && <p class="help bad">{error}</p>}
      <section>
        <h2>Studios</h2>
        {pcrs === null && <p class="muted">Loading…</p>}
        {pcrs?.length === 0 && (
          <p class="muted">
            No studio yet. {user.role === 'admin' ? <a href="/app/admin">Build one</a> : 'Ask the admin to build one.'}
          </p>
        )}
        <div class="cards">
          {pcrs?.map((p) => (
            <article class="card" key={p.id}>
              <h3 style={{ margin: '0 0 6px' }}>{p.name}</h3>
              <div class="muted small">
                {p.settings.slots} output slots · {p.settings.outputNames.join(', ')}
              </div>
              <div class="muted small">
                IFB {p.settings.ifbAllowed ? 'allowed' : 'off'} · room {p.livekitRoom}
              </div>
              <p>
                <button class="btn" onClick={() => route(`/app/producer/${p.id}`)}>
                  Sit here as producer
                </button>
              </p>
            </article>
          ))}
        </div>
      </section>
      <p class="muted small">This PC: {describeStation(loadStation())}.</p>
    </div>
  );
}
