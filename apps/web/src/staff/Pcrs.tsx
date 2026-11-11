// The studios (PCRs) a producer can sit in. The admin builds them on /app/admin.
// The engineer has no list: /app/engineer shows every studio at once.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { ApiError, listPcrs, type Pcr, type User } from '../api.ts';
import { Icon } from '../components/ui.tsx';
import { describeStation, loadStation } from '../lib/station.ts';

export function Pcrs({ user, nav }: { user: User; nav: ComponentChildren }) {
  const { route } = useLocation();
  const [pcrs, setPcrs] = useState<Pcr[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const station = loadStation();

  useEffect(() => {
    listPcrs()
      .then((r) => setPcrs(r.pcrs))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Server not reachable.'));
  }, []);

  return (
    <div class="screen page studios">
      {nav}
      <header class="adm-top">
        <div class="adm-top-title">
          <h1>Studios</h1>
          {pcrs !== null && <span class="ct-count">{pcrs.length}</span>}
        </div>
        <span class="adm-pill tip tip-end tip-below" data-tip={`This PC: ${describeStation(station)}. The admin sets it under “This station”.`}>
          {station?.name || 'this desk'}
        </span>
      </header>
      {error && <p class="help bad">{error}</p>}

      {pcrs?.length === 0 && (
        <div class="eng-empty">
          No studio yet. {user.role === 'admin' ? <a href="/app/admin">Build one</a> : 'The admin builds them.'}
        </div>
      )}

      <div class="pcr-grid">
        {pcrs?.map((p) => (
          <button class="pcr-card" key={p.id} onClick={() => route(`/app/producer/${p.id}`)}>
            <span class="pcr-name">{p.name}</span>
            <span class="pcr-slots">
              {p.settings.outputNames.map((n, i) => (
                <span class="eng-tag" key={i}>
                  {n}
                </span>
              ))}
            </span>
            <span class="pcr-go">
              Sit here <Icon name="forward" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
