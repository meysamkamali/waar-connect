// One studio slot's NDI output in a process of its own. The gateway starts one of these per slot
// (OutProcess in feed-process.ts) and talks to it over the process channel.
//
// Why a process: fitting a guest's picture into a fixed size runs on JavaScript's one thread, most of
// a core for 1080p at 25 a second; four slots in one process would share it. It also keeps a fault to
// itself: an NDI call that hangs ends this process alone, and the gateway starts it again.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { dispose } from '@livekit/rtc-node';
import type { OutputFeedStatus } from '@waar-connect/shared';
import { loadConfig } from './config.ts';
import type { FromWorker, ToWorker } from './feed-process.ts';
import { log } from './log.ts';
import { Ndi } from './ndi.ts';
import { OutFeed, type OutTarget } from './out-feed.ts';

const cfg = loadConfig();
const ndi = Ndi.load(cfg.NDI_LIB);

let feed: OutFeed | undefined;
let stopping = false;

function send(message: FromWorker<OutputFeedStatus>): void {
  if (process.connected) process.send?.(message);
}

const reporting = setInterval(() => {
  if (feed) send({ type: 'status', status: feed.status() });
}, 1000);

async function stop(why: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(reporting);
  log('info', 'NDI output process stopping', { out: feed?.target.name ?? null, why });
  await feed?.stop().catch(() => undefined);
  await dispose().catch(() => undefined);
  process.exit(0);
}

process.on('message', (raw) => {
  const message = raw as ToWorker<OutTarget>;
  switch (message.type) {
    case 'start':
      if (feed || stopping) return;
      feed = new OutFeed(ndi, cfg, message.target);
      feed.start();
      log('info', 'NDI output process started', { pcr: message.target.pcrName, slot: message.target.slot, name: message.target.name, pid: process.pid });
      break;
    case 'update':
      feed?.update(message.target);
      break;
    case 'discovery':
      break; // a sender looks for nobody
    case 'stop':
      void stop('asked by the gateway');
      break;
  }
});

// The gateway went away without a word (crashed, killed): do not live on as an orphan holding the NDI name.
process.on('disconnect', () => void stop('the gateway is gone'));
process.on('SIGTERM', () => void stop('SIGTERM'));
// Ctrl-C in a terminal reaches the whole group; the gateway tells this process to stop.
process.on('SIGINT', () => undefined);
