// One return feed in a process of its own. The gateway starts one of these per PCR (feed-process.ts)
// and talks to it over the process channel.
//
// Why a process: a feed's scaling and frame copies run on JavaScript's one thread, about 0.9 of it for
// a 1080p25 source. Two feeds in one process shared that thread and each sent 10 to 19 frames a second
// (seen 2026-11-10). In processes of their own each has a core. It also keeps a fault to itself: an
// NDI receive that hangs ends this process alone, and the gateway starts it again.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { dispose } from '@livekit/rtc-node';
import { loadConfig } from './config.ts';
import type { FromWorker, ToWorker } from './feed-process.ts';
import { log } from './log.ts';
import { Ndi } from './ndi.ts';
import { ReturnFeed } from './return-feed.ts';

const cfg = loadConfig();
const ndi = Ndi.load(cfg.NDI_LIB);

let feed: ReturnFeed | undefined;
let discoveryIps: string[] | undefined;
let stopping = false;

/** This process finds its NDI source itself: mDNS plus the addresses the gateway passes on. */
async function setDiscovery(next: string[]): Promise<void> {
  if (discoveryIps && discoveryIps.join(',') === next.join(',')) return;
  if (discoveryIps) await ndi.stopDiscovery();
  discoveryIps = next;
  ndi.startDiscovery(next);
}

function send(message: FromWorker): void {
  if (process.connected) process.send?.(message);
}

const reporting = setInterval(() => {
  if (feed) send({ type: 'status', status: feed.status() });
}, 1000);

async function stop(why: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(reporting);
  log('info', 'return feed process stopping', { pcr: feed?.target.pcrName ?? null, why });
  await feed?.stop().catch(() => undefined);
  await ndi.stopDiscovery().catch(() => undefined);
  await dispose().catch(() => undefined);
  process.exit(0);
}

process.on('message', (raw) => {
  const message = raw as ToWorker;
  switch (message.type) {
    case 'start':
      void setDiscovery(message.extraIps).then(() => {
        if (feed || stopping) return;
        feed = new ReturnFeed(ndi, cfg, message.target);
        feed.start();
        log('info', 'return feed process started', { pcr: message.target.pcrName, source: message.target.source, pid: process.pid });
      });
      break;
    case 'update':
      feed?.update(message.target);
      break;
    case 'discovery':
      void setDiscovery(message.extraIps);
      break;
    case 'stop':
      void stop('asked by the gateway');
      break;
  }
});

// The gateway went away without a word (crashed, killed): do not live on as an orphan holding the room.
process.on('disconnect', () => void stop('the gateway is gone'));
process.on('SIGTERM', () => void stop('SIGTERM'));
// Ctrl-C in a terminal reaches the whole group; the gateway tells this process to stop.
process.on('SIGINT', () => undefined);
