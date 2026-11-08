// Staff entry: session check, login (final phase), then the page: PCR list, a PCR's room, the contact
// book, or the admin pages (PCRs and the station lock).
import { useEffect, useState } from 'preact/hooks';
import { me, type User } from '../api.ts';
import { Admin } from '../admin/Admin.tsx';
import { Station } from '../admin/Station.tsx';
import { Contacts } from './Contacts.tsx';
import { Login } from './Login.tsx';
import { Nav } from './Nav.tsx';
import { Pcrs } from './Pcrs.tsx';
import { RoomScreen } from './RoomScreen.tsx';

export type StaffPage = 'pcrs' | 'contacts' | 'admin' | 'station';

export function StaffApp({ id, page = 'pcrs' }: { id?: string; page?: StaffPage }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [open, setOpen] = useState(false); // test phase: served without a password

  useEffect(() => {
    me()
      .then((r) => {
        setOpen(r.open === true);
        setUser(r.user);
      })
      .catch(() => setUser(null));
  }, [page]);

  if (user === undefined) return <div class="screen center">Loading…</div>;
  if (user === null) return <Login onLogin={setUser} />;

  if (page === 'pcrs' && id) return <RoomScreen id={id} user={user} />;

  const nav = <Nav user={user} open={open} page={page} onLogout={() => setUser(null)} />;
  if (page === 'contacts') return <Contacts user={user} nav={nav} />;
  if (page === 'admin' || page === 'station') {
    if (user.role !== 'admin') {
      return (
        <div class="screen page">
          {nav}
          <p class="help bad">Admin only.</p>
        </div>
      );
    }
    return page === 'admin' ? <Admin nav={nav} /> : <Station nav={nav} />;
  }
  return <Pcrs user={user} nav={nav} />;
}
