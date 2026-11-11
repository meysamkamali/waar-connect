// Top bar of the staff pages: the logo (home), the pages, the server's load, and who you are.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { useEffect, useState } from 'preact/hooks';
import { logout, systemLoad, type SystemLoad, type User } from '../api.ts';
import { Icon, type IconName } from '../components/ui.tsx';
import { initials } from '../lib/contact.ts';
import type { StaffPage } from './StaffApp.tsx';

const PAGES: readonly { page: StaffPage; href: string; label: string; icon: IconName; admin?: boolean }[] = [
  { page: 'pcrs', href: '/app/producer', label: 'Studios', icon: 'camera' },
  { page: 'engineer', href: '/app/engineer', label: 'Engineer', icon: 'sliders' },
  { page: 'contacts', href: '/app/contacts', label: 'Contacts', icon: 'user' },
  { page: 'admin', href: '/app/admin', label: 'Admin', icon: 'grid', admin: true },
  { page: 'station', href: '/app/admin/station', label: 'This station', icon: 'monitor', admin: true },
];

/** Temporary, test phase: the server's CPU and memory, so the gateway's cost can be watched from any staff page. */
function ServerLoad() {
  const [load, setLoad] = useState<SystemLoad | null>(null);
  useEffect(() => {
    const poll = () => void systemLoad().then(setLoad).catch(() => setLoad(null));
    poll();
    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, []);
  if (!load) return null;
  const tone = load.cpuPct >= 80 ? 'bad' : load.cpuPct >= 60 ? 'warn' : '';
  return (
    <span
      class={`nav-load ${tone} tip tip-end tip-below`}
      data-tip={`The server right now: ${load.cpuPct} % of ${load.cores} cores (load ${load.load1.toFixed(2)}), ${(load.memUsedMb / 1024).toFixed(1)} of ${Math.round(load.memTotalMb / 1024)} GB of memory in use. Shown during the test phase.`}
      role="meter"
      aria-label="Server CPU"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={load.cpuPct}
    >
      <span>CPU</span>
      <span class="nav-load-bar">
        <i style={{ width: `${Math.min(100, load.cpuPct)}%` }} />
      </span>
      <b>{load.cpuPct}%</b>
    </span>
  );
}

export function Nav({ user, open, page, onLogout }: { user: User; open: boolean; page: StaffPage; onLogout: () => void }) {
  // In the test phase there is no sign-in and every page is open; later the admin's pages show only to the admin.
  const pages = PAGES.filter((p) => !p.admin || open || user.role === 'admin');
  return (
    <header class="nav">
      <div class="nav-main">
        <a class="nav-logo" href="/app/" aria-label="waar Connect: the station">
          <img src="/app/logo.svg" alt="" />
        </a>
        <nav class="nav-links" aria-label="Pages">
          {pages.map((p) => (
            <a key={p.page} href={p.href} class={page === p.page ? 'active' : ''} aria-current={page === p.page ? 'page' : undefined}>
              <Icon name={p.icon} />
              {p.label}
            </a>
          ))}
        </nav>
      </div>
      <div class="nav-side">
        <ServerLoad />
        <span class="nav-user tip tip-end tip-below" data-tip={`${user.name} · ${user.role}${open ? '. Test phase: no sign-in.' : ''}`}>
          <span class="ct-avatar" aria-hidden="true">
            {initials(user.name)}
          </span>
          <span>{user.name}</span>
        </span>
        {!open && (
          <button
            class="chip"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => {
              void logout().finally(onLogout);
            }}
          >
            <Icon name="exit" />
          </button>
        )}
      </div>
    </header>
  );
}
