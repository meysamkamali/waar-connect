// Talks to the phase 0 token server. PIN is kept for the browser session only.

export interface AppConfig {
  livekitUrl: string;
  sourceUrl: string;
  /** false during the test phase: the pages ask for no PIN. */
  pinRequired: boolean;
}

export interface TokenResult {
  token: string;
  identity: string;
  url: string;
}

export type Role = 'guest' | 'studio' | 'out' | 'monitor';

const PIN_KEY = 'wc.pin';

export function getPin(): string | null {
  try {
    return sessionStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
}

export function setPin(pin: string): void {
  try {
    sessionStorage.setItem(PIN_KEY, pin);
  } catch {
    // private mode: the launcher will ask again
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data;
}

let configPromise: Promise<AppConfig> | undefined;

export function getConfig(): Promise<AppConfig> {
  configPromise ??= fetch('/api/config').then((res) => readJson<AppConfig>(res));
  return configPromise;
}

/** '' when the server needs no PIN, the stored PIN otherwise, or null when one is needed but missing. */
export async function resolvePin(): Promise<string | null> {
  const cfg = await getConfig();
  return cfg.pinRequired ? getPin() : '';
}

export async function getToken(role: Role, room: string, name: string, pin: string): Promise<TokenResult> {
  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, room, name, pin }),
  });
  return readJson<TokenResult>(res);
}

export async function getServerTime(): Promise<number> {
  const { now } = await readJson<{ now: number }>(await fetch('/api/time', { cache: 'no-store' }));
  return now;
}
