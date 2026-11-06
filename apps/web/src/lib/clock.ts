// Millisecond clock synced to the server, for latency photographs.
// Offset = server time minus local time, taken from the sample with the shortest round trip.

import { getServerTime } from '../api.ts';

export interface ClockSync {
  offsetMs: number;
  rttMs: number;
}

export async function syncClock(samples = 6): Promise<ClockSync> {
  let best: ClockSync = { offsetMs: 0, rttMs: Number.POSITIVE_INFINITY };
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    const sent = Date.now();
    const server = await getServerTime();
    const rtt = performance.now() - t0;
    // The server stamped its time half a round trip after we sent the request.
    if (rtt < best.rttMs) best = { offsetMs: server - (sent + rtt / 2), rttMs: rtt };
  }
  return { offsetMs: Math.round(best.offsetMs), rttMs: Math.round(best.rttMs) };
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => n.toString().padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Draws the synced time into `el` every animation frame until the returned function is called. */
export function runClock(el: HTMLElement, sync: ClockSync): () => void {
  let frame = 0;
  const tick = () => {
    el.textContent = formatClock(Date.now() + sync.offsetMs);
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(frame);
}
