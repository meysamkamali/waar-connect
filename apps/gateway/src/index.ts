// waar Connect gateway: the studio's NDI program return into each PCR's room. Later: each studio
// slot out as its own NDI source. Headless; configured from the admin page through the API.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { readFileSync } from 'node:fs';
import { dispose } from '@livekit/rtc-node';
import { ApiClient } from './api.ts';
import { loadConfig } from './config.ts';
import { log } from './log.ts';
import { Ndi } from './ndi.ts';
import { describeSource } from './network.ts';
import { ReturnFeed } from './return-feed.ts';

const cfg = loadConfig();
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const version = process.env['WC_COMMIT'] ? `${pkg.version}+${process.env['WC_COMMIT']}` : pkg.version;

const ndi = Ndi.load(cfg.NDI_LIB);
log('info', 'gateway starting', { version, host: cfg.GATEWAY_NAME, ndi: ndi.version(), lib: ndi.path, api: cfg.API_URL, extraIps: cfg.extraIps });
let discoveryIps: string[] = [...new Set(cfg.extraIps)];
ndi.startDiscovery(discoveryIps);

/** Discovery asks mDNS plus these addresses; a changed list (admin page or .env) needs a new NDI finder. */
async function setDiscovery(next: string[]): Promise<void> {
  if (next.join(',') === discoveryIps.join(',')) return;
  discoveryIps = next;
  await ndi.stopDiscovery();
  ndi.startDiscovery(next);
  log('info', 'NDI discovery restarted', { extraIps: next });
}

const api = new ApiClient(cfg.API_URL, cfg.GATEWAY_TOKEN);
const feeds = new Map<string, ReturnFeed>();
let reconciling = false;
let apiDown = false;

/** Starts, stops or re-targets feeds so they match what the admin set in the API. */
async function reconcile(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    const { targets, extraIps } = await api.poll();
    if (apiDown) log('info', 'API reachable again');
    apiDown = false;
    await setDiscovery([...new Set([...cfg.extraIps, ...extraIps])]);
    const wanted = new Map(targets.map((t) => [t.pcrId, t]));
    for (const [id, feed] of feeds) {
      const t = wanted.get(id);
      if (t && t.source === feed.target.source && t.height === feed.target.height && t.kbps === feed.target.kbps) {
        feed.update(t);
        continue;
      }
      const why = !t ? 'no longer wanted' : t.source !== feed.target.source ? 'source changed' : 'picture size or bitrate changed';
      log('info', 'return feed stopping', { pcr: feed.target.pcrName, source: feed.target.source, why });
      feeds.delete(id);
      await feed.stop().catch((err: unknown) => log('warn', 'feed stop failed', { err }));
    }
    for (const t of targets) {
      if (feeds.has(t.pcrId)) continue;
      const feed = new ReturnFeed(ndi, cfg, t);
      feeds.set(t.pcrId, feed);
      feed.start();
      log('info', 'return feed starting', { pcr: t.pcrName, source: t.source, room: t.room });
    }
  } catch (err) {
    if (!apiDown) log('warn', 'API not reachable; feeds keep running', { err });
    apiDown = true;
  } finally {
    reconciling = false;
  }
}

async function report(): Promise<void> {
  try {
    await api.report({
      version,
      host: cfg.GATEWAY_NAME,
      sources: ndi.sources().map((s) => describeSource(s)),
      extraIps: discoveryIps,
      defaults: { height: cfg.RETURN_HEIGHT || null, kbps: cfg.RETURN_MAX_KBPS, fps: cfg.RETURN_MAX_FPS },
      returns: [...feeds.values()].map((f) => f.status()),
    });
  } catch (err) {
    if (!apiDown) log('warn', 'report failed', { err });
  }
}

await reconcile();
await report();
const polling = setInterval(() => void reconcile(), cfg.POLL_SECONDS * 1000);
const reporting = setInterval(() => void report(), cfg.REPORT_SECONDS * 1000);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log('info', 'stopping', { signal });
  clearInterval(polling);
  clearInterval(reporting);
  await Promise.all([...feeds.values()].map((f) => f.stop().catch(() => undefined)));
  await ndi.stopDiscovery().catch(() => undefined);
  await dispose().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
