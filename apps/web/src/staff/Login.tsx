import { useState } from 'preact/hooks';
import { ApiError, login, type User } from '../api.ts';

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await login(email.trim(), password);
      onLogin(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server not reachable.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="screen center">
      <form class="card" onSubmit={(e) => void submit(e)}>
        <img class="logo" src="/app/logo.svg" alt="waar Connect" />
        <h1>Sign in</h1>
        <label>
          Email
          <input type="email" value={email} onInput={(e) => setEmail((e.currentTarget as HTMLInputElement).value)} required autocomplete="username" />
        </label>
        <label>
          Password
          <input type="password" value={password} onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)} required autocomplete="current-password" />
        </label>
        {error && <p class="help bad">{error}</p>}
        <button class="btn" type="submit" disabled={busy}>
          Sign in
        </button>
      </form>
    </div>
  );
}
