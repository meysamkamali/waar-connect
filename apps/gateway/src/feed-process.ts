// The gateway's handle on a feed that runs in a process of its own: a return feed (feed-worker.ts)
// or one studio slot's NDI output (out-worker.ts). Same surface as the feed itself, so index.ts treats
// both alike: start, a fresh token, stop, status.
// The process is started again when it ends by itself (a hung NDI call ends it on purpose).
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { fork, type ChildProcess } from 'node:child_process';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OutputFeedStatus, ReturnFeedStatus } from '@waar-connect/shared';
import { log } from './log.ts';
import type { OutTarget } from './out-feed.ts';
import type { ReturnTarget } from './return-feed.ts';

export type ToWorker<T = ReturnTarget> =
  | { type: 'start'; target: T; extraIps: string[] }
  /** A fresh token for the next reconnect. */
  | { type: 'update'; target: T }
  /** The addresses NDI discovery asks beyond mDNS changed. */
  | { type: 'discovery'; extraIps: string[] }
  | { type: 'stop' };

export type FromWorker<S = ReturnFeedStatus> = { type: 'status'; status: S };

// Beside this file, with this file's extension: .js when built, .ts when run from source.
const here = fileURLToPath(import.meta.url);
const beside = (name: string) => fileURLToPath(new URL(`./${name}${extname(here)}`, import.meta.url));

const RESTART_MS = 2_000;
/** A process told to stop gets this long before it is killed (a hung NDI call never returns). */
const STOP_GRACE_MS = 5_000;
/** A status older than this is not shown as current. */
const STATUS_STALE_MS = 5_000;

interface Kind<T, S> {
  /** The worker script. */
  worker: string;
  restartMs: number;
  /** What it is, for the log: "return feed", "NDI output". */
  what: string;
  /** What the log says about a target. */
  label: (target: T) => Record<string, unknown>;
  /** The status while the process itself has reported none: starting, or ended and coming back. */
  placeholder: (target: T, running: boolean, lastExit: string | null, since: number) => S;
}

export class WorkerProcess<T, S> {
  target: T;
  #extraIps: string[];
  #child: ChildProcess | undefined;
  #status: S | undefined;
  #statusAt = 0;
  #since = Date.now();
  #stopping = false;
  #restart: ReturnType<typeof setTimeout> | undefined;
  #lastExit: string | null = null;
  readonly #kind: Kind<T, S>;

  constructor(target: T, extraIps: readonly string[], kind: Kind<T, S>) {
    this.target = target;
    this.#extraIps = [...extraIps];
    this.#kind = kind;
  }

  /** The running process's id, for logs and tests. */
  get pid(): number | undefined {
    return this.#child?.pid;
  }

  start(): void {
    this.#spawn();
  }

  /** A fresh token from the API; the process uses it on its next (re)connect. */
  update(target: T): void {
    this.target = target;
    this.#send({ type: 'update', target });
  }

  setDiscovery(extraIps: readonly string[]): void {
    this.#extraIps = [...extraIps];
    this.#send({ type: 'discovery', extraIps: this.#extraIps });
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    clearTimeout(this.#restart);
    const child = this.#child;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => {
        log('warn', `${this.#kind.what} process did not stop in time; killing it`, { ...this.#kind.label(this.target), pid: child.pid });
        child.kill('SIGKILL');
      }, STOP_GRACE_MS);
      child.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      if (child.connected) child.send({ type: 'stop' } satisfies ToWorker<T>);
      else child.kill('SIGTERM');
    });
  }

  /** The process's own report, or, while it has none, what the gateway knows: starting, or ended and coming back. */
  status(): S {
    if (this.#status && Date.now() - this.#statusAt < STATUS_STALE_MS) return this.#status;
    return this.#kind.placeholder(this.target, this.#child !== undefined, this.#lastExit, this.#since);
  }

  #send(message: ToWorker<T>): void {
    if (this.#child?.connected) this.#child.send(message);
  }

  #spawn(): void {
    if (this.#stopping) return;
    // The same node flags as the gateway (its --env-file among them), the same environment, the same output.
    const child = fork(this.#kind.worker, [], { stdio: 'inherit' });
    this.#child = child;
    this.#since = Date.now();
    child.on('message', (raw) => {
      const message = raw as FromWorker<S>;
      if (message.type === 'status') {
        this.#status = message.status;
        this.#statusAt = Date.now();
      }
    });
    child.on('error', (err) => log('error', `${this.#kind.what} process failed`, { ...this.#kind.label(this.target), err }));
    child.on('exit', (code, signal) => {
      if (this.#child !== child) return;
      this.#child = undefined;
      this.#status = undefined;
      this.#since = Date.now();
      if (this.#stopping) return;
      this.#lastExit = signal ? `signal ${signal}` : `exit code ${code ?? '?'}`;
      log('warn', `${this.#kind.what} process ended; starting it again`, { ...this.#kind.label(this.target), ended: this.#lastExit, inMs: this.#kind.restartMs });
      this.#restart = setTimeout(() => this.#spawn(), this.#kind.restartMs);
    });
    child.send({ type: 'start', target: this.target, extraIps: this.#extraIps } satisfies ToWorker<T>);
  }
}

/** One return feed in a process of its own. `opts` is for tests: another worker script, a shorter wait before a restart. */
export class FeedProcess extends WorkerProcess<ReturnTarget, ReturnFeedStatus> {
  constructor(target: ReturnTarget, extraIps: readonly string[], opts: { worker?: string; restartMs?: number } = {}) {
    super(target, extraIps, {
      worker: opts.worker ?? beside('feed-worker'),
      restartMs: opts.restartMs ?? RESTART_MS,
      what: 'return feed',
      label: (t) => ({ pcr: t.pcrName, source: t.source }),
      placeholder: (t, running, lastExit, since) => ({
        pcrId: t.pcrId,
        pcrName: t.pcrName,
        source: t.source,
        state: running ? 'starting' : 'error',
        detail: running ? "the feed's process is starting" : `the feed's process ended (${lastExit ?? 'unknown'}); starting it again`,
        connected: false,
        video: null,
        audio: null,
        publish: null,
        mv: null,
        since,
      }),
    });
  }
}

/** One studio slot's NDI output in a process of its own. */
export class OutProcess extends WorkerProcess<OutTarget, OutputFeedStatus> {
  constructor(target: OutTarget, opts: { worker?: string; restartMs?: number } = {}) {
    super(target, [], {
      worker: opts.worker ?? beside('out-worker'),
      restartMs: opts.restartMs ?? RESTART_MS,
      what: 'NDI output',
      label: (t) => ({ pcr: t.pcrName, slot: t.slot, name: t.name }),
      placeholder: (t, running, lastExit, since) => ({
        pcrId: t.pcrId,
        pcrName: t.pcrName,
        slot: t.slot,
        name: t.name,
        state: running ? 'starting' : 'error',
        detail: running ? "the output's process is starting" : `the output's process ended (${lastExit ?? 'unknown'}); starting it again`,
        connected: false,
        guest: null,
        in: null,
        out: null,
        receivers: 0,
        since,
      }),
    });
  }
}
