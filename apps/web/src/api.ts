// Calls to the waar Connect API (same origin, /api/v1).

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data;
}

export interface JoinInfo {
  guest: { id: string; displayName: string; language: string };
  episode: { id: string; title: string; status: 'planned' | 'live' | 'ended'; program: string };
  livekit: { url: string; token: string; identity: string };
}

export function resolveInvite(token: string): Promise<JoinInfo> {
  return fetch(`/api/v1/invite/${encodeURIComponent(token)}`).then((r) => readJson<JoinInfo>(r));
}

export async function getServerTime(): Promise<number> {
  // The API has no clock endpoint yet; the Date header of a cheap request is good to the second,
  // and the phase 0 server's /api/time is used when present.
  const res = await fetch('/api/time', { cache: 'no-store' }).catch(() => null);
  if (res?.ok) {
    const { now } = (await res.json()) as { now: number };
    return now;
  }
  const head = await fetch('/api/v1/health', { cache: 'no-store' });
  const date = head.headers.get('date');
  return date ? new Date(date).getTime() : Date.now();
}

/** Round trip to the API in milliseconds, best of three. */
export async function measureRtt(): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    await fetch('/api/v1/health', { cache: 'no-store' });
    best = Math.min(best, performance.now() - t0);
  }
  return Math.round(best);
}
