// Top bar of the staff pages: where you are, who you are, the other pages.
import { logout, type User } from '../api.ts';
import type { StaffPage } from './StaffApp.tsx';

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
        {link('/app/contacts', 'Contacts', page === 'contacts')}
        {link('/app/admin', 'Admin', page === 'admin')}
        {link('/app/admin/station', 'This station', page === 'station')}
      </nav>
      <div class="row" style={{ alignItems: 'center' }}>
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
