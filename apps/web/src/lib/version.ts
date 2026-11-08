// Which build this page is, and whether the server has a newer one.
// A phone that stays open across a deploy keeps old code; the producer's new buttons then do nothing
// on it. Pages poll /app/version.json and act: a guest at the door reloads itself, everyone else
// shows a notice.

export const BUILD: string = typeof __WC_BUILD__ === 'string' ? __WC_BUILD__ : 'dev';

export async function serverBuild(): Promise<string | undefined> {
  try {
    const res = await fetch('/app/version.json', { cache: 'no-store' });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { build?: unknown };
    return typeof data.build === 'string' ? data.build : undefined;
  } catch {
    return undefined;
  }
}

/** Calls `onNewer` (once per newer build seen) while the page lives. Returns the stop function. */
export function watchBuild(onNewer: (build: string) => void, everyMs = 60_000): () => void {
  let last: string | undefined;
  const check = async () => {
    const b = await serverBuild();
    if (b && b !== BUILD && b !== last) {
      last = b;
      onNewer(b);
    }
  };
  void check();
  const timer = window.setInterval(() => void check(), everyMs);
  const onVisible = () => {
    if (document.visibilityState === 'visible') void check();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
