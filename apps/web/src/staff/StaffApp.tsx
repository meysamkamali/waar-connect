// Staff entry: session check, login (final phase), then the page: PCR list, a PCR's room, the contact
// book, or the admin pages (PCRs and the station lock).
import { useEffect, useState } from 'preact/hooks';
import { me, type User } from '../api.ts';
import { BUILD, watchBuild } from '../lib/version.ts';
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
  const [newer, setNewer] = useState<string | null>(null);
  useEffect(() => watchBuild(setNewer), []);
  const banner = newer ? (
    <div class="build-banner">
      A newer version is on the server (build {newer}; this screen is {BUILD}).{' '}
      <button class="link" onClick={() => location.reload()}>
        Reload now
      </button>
    </div>
  ) : null;

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

  const nav = <Nav user={user} open={open} page={page} onLogout={() => setUser(null)} />;
  let body;
  if (page === 'pcrs' && id) body = <RoomScreen id={id} user={user} />;
  else if (page === 'contacts') body = <Contacts user={user} nav={nav} />;
  else if (page === 'admin' || page === 'station') {
    if (user.role !== 'admin') {
      body = (
        <div class="screen page">
          {nav}
          <p class="help bad">Admin only.</p>
        </div>
      );
    } else body = page === 'admin' ? <Admin nav={nav} /> : <Station nav={nav} />;
  } else body = <Pcrs user={user} nav={nav} />;
  return (
    <>
      {banner}
      {body}
    </>
  );
}
