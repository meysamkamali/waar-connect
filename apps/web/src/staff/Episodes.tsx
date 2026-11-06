// Programs and episodes: pick one to open its room, or create the next one.
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { ApiError, createEpisode, createProgram, getProgram, listPrograms, logout, type Episode, type Program, type User } from '../api.ts';

export function Episodes({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { route } = useLocation();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [episodes, setEpisodes] = useState<Record<string, Episode[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [newProgram, setNewProgram] = useState('');
  const [newTitle, setNewTitle] = useState<Record<string, string>>({});

  async function load(): Promise<void> {
    try {
      const { programs } = await listPrograms();
      setPrograms(programs);
      const all: Record<string, Episode[]> = {};
      for (const p of programs) all[p.id] = (await getProgram(p.id)).episodes;
      setEpisodes(all);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server not reachable.');
    }
  }
  useEffect(() => void load(), []);

  const canCreate = user.role !== 'engineer';

  return (
    <div class="screen page">
      <header class="row between">
        <div class="row" style={{ alignItems: 'center', gap: '12px' }}>
          <img class="logo" src="/app/logo.svg" alt="" />
          <h1>Programmes</h1>
        </div>
        <div class="row" style={{ alignItems: 'center' }}>
          <span class="muted">
            {user.name} · {user.role}
          </span>
          <button
            class="btn secondary small"
            onClick={() => {
              void logout().finally(onLogout);
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      {error && <p class="help bad">{error}</p>}

      <div class="grid">
        {programs.map((p) => (
          <section class="card" key={p.id}>
            <h2>{p.name}</h2>
            <div class="muted small">
              {p.settings.slots} slots · ready mark {p.settings.readyRequired ? 'required' : 'optional'} · IFB {p.settings.ifbAllowed ? 'allowed' : 'off'}
            </div>
            <ul class="list">
              {(episodes[p.id] ?? []).map((e) => (
                <li key={e.id}>
                  <button class="link" onClick={() => route(`/app/${user.role === 'engineer' ? 'engineer' : 'producer'}/${e.id}`)}>
                    {e.title}
                  </button>
                  <span class={`badge ${e.status}`}>{e.status}</span>
                  <span class="muted small">{e.livekitRoom}</span>
                </li>
              ))}
              {(episodes[p.id] ?? []).length === 0 && <li class="muted">No episodes yet.</li>}
            </ul>
            {canCreate && (
              <form
                class="row"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const title = (newTitle[p.id] ?? '').trim();
                  if (!title) return;
                  void createEpisode(p.id, title)
                    .then(() => {
                      setNewTitle({ ...newTitle, [p.id]: '' });
                      return load();
                    })
                    .catch((err: unknown) => setError(err instanceof ApiError ? err.message : String(err)));
                }}
              >
                <input placeholder="New episode title" value={newTitle[p.id] ?? ''} onInput={(e) => setNewTitle({ ...newTitle, [p.id]: (e.currentTarget as HTMLInputElement).value })} />
                <button class="btn secondary" type="submit">
                  Add episode
                </button>
              </form>
            )}
          </section>
        ))}
      </div>

      {canCreate && (
        <form
          class="row"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!newProgram.trim()) return;
            void createProgram(newProgram.trim())
              .then(() => {
                setNewProgram('');
                return load();
              })
              .catch((err: unknown) => setError(err instanceof ApiError ? err.message : String(err)));
          }}
        >
          <input placeholder="New programme name" value={newProgram} onInput={(e) => setNewProgram((e.currentTarget as HTMLInputElement).value)} />
          <button class="btn secondary" type="submit">
            Add programme
          </button>
        </form>
      )}
    </div>
  );
}
