// Big server-synced clock. Film it with the guest's phone; compare with the out page's clock overlay.
import '../style.css';
import { runClock, syncClock } from '../lib/clock.ts';
import { $, mountFooter } from '../lib/dom.ts';

const clockEl = $('#clock');
const info = $('#info');
let stop: (() => void) | undefined;

async function sync(): Promise<void> {
  try {
    const s = await syncClock();
    stop?.();
    stop = runClock(clockEl, s);
    info.textContent = `server offset ${s.offsetMs >= 0 ? '+' : ''}${s.offsetMs} ms · sync round trip ${s.rttMs} ms · re-syncs every minute`;
  } catch {
    info.textContent = 'server not reachable; showing local time';
    stop?.();
    stop = runClock(clockEl, { offsetMs: 0, rttMs: 0 });
  }
}

void sync();
setInterval(() => void sync(), 60_000);
void mountFooter();
