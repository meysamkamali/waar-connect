// Top bar of the staff pages: where you are, who you are, the other pages.
import { useEffect, useState } from 'preact/hooks';
import { logout, systemLoad, type SystemLoad, type User } from '../api.ts';
import type { StaffPage } from './StaffApp.tsx';

/** Temporary, test phase: the VM's CPU and memory, so the gateway's cost can be watched from any staff page. */
function VmLoad() {
  const [load, setLoad] = useState<SystemLoad | null>(null);
  useEffect(() => {
    const poll = () => void systemLoad().then(setLoad).catch(() => setLoad(null));
    poll();
    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, []);
  if (!load) return null;
  const hot = load.cpuPct >= 80;
  const warm = load.cpuPct >= 60;
  return (
    <span
      class={`small ${hot ? 'bad' : 'muted'}`}
      style={warm && !hot ? { color: '#e0b040' } : undefined}
      title={`${load.cores} cores · load ${load.load1.toFixed(2)} · ${load.memUsedMb} of ${load.memTotalMb} MB used`}
    >
      VM cpu {load.cpuPct}% · ram {(load.memUsedMb / 1024).toFixed(1)}/{Math.round(load.memTotalMb / 1024)} GB
    </span>
  );
}

export function Nav({ user, open, page, onLogout }: { user: User; open: boolean; page: StaffPage; onLogout: () => void }) {
  const link = (href: string, label: string, active: boolean) => (
    <a href={href} class={active ? 'active' : ''}>
      {label}
    </a>
  );
  return (
    <header class="row between">
      <nav class="topnav">
        <img class="logo" src="/app/logo.svg" alt="" />
        {link('/app/producer', 'Studios', page === 'pcrs')}
        {link('/app/engineer', 'Engineer', page === 'engineer')}
        {link('/app/contacts', 'Contacts', page === 'contacts')}
        {link('/app/admin', 'Admin', page === 'admin')}
        {link('/app/admin/station', 'This station', page === 'station')}
      </nav>
      <div class="row" style={{ alignItems: 'center' }}>
        <VmLoad />
        <span class="muted small">
          {user.name} · {user.role}
          {open && ' · test phase, no sign-in'}
        </span>
        {!open && (
          <button
            class="btn secondary small"
            onClick={() => {
              void logout().finally(onLogout);
            }}
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
