// Staff entry: session check, login, then episodes or a room.
import { useEffect, useState } from 'preact/hooks';
import { me, type User } from '../api.ts';
import { Episodes } from './Episodes.tsx';
import { Login } from './Login.tsx';
import { RoomScreen } from './RoomScreen.tsx';

export function StaffApp({ id, engineer = false }: { id?: string; engineer?: boolean }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [open, setOpen] = useState(false); // test phase: served without a password

  useEffect(() => {
    me()
      .then((r) => {
        setOpen(r.open === true);
        setUser(r.user);
      })
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div class="screen center">Loading…</div>;
  if (user === null) return <Login onLogin={setUser} />;
  if (id) return <RoomScreen id={id} user={user} engineer={engineer || user.role === 'engineer'} />;
  return <Episodes user={user} open={open} onLogout={() => setUser(null)} />;
}
