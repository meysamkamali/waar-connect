// The gateway's handle on one return feed that runs in a process of its own (feed-worker.ts).
// Same surface as ReturnFeed, so index.ts treats both alike: start, a fresh token, stop, status.
// The process is started again when it ends by itself (a hung NDI receive ends it on purpose).
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { fork, type ChildProcess } from 'node:child_process';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReturnFeedStatus } from '@waar-connect/shared';
import { log } from './log.ts';
import type { ReturnTarget } from './return-feed.ts';

export type ToWorker =
  | { type: 'start'; target: ReturnTarget; extraIps: string[] }
  /** A fresh token for the next reconnect. */
  | { type: 'update'; target: ReturnTarget }
  /** The addresses NDI discovery asks beyond mDNS changed. */
  | { type: 'discovery'; extraIps: string[] }
  | { type: 'stop' };

export type FromWorker = { type: 'status'; status: ReturnFeedStatus };

// Beside this file, with this file's extension: .js when built, .ts when run from source.
const here = fileURLToPath(import.meta.url);
const WORKER = fileURLToPath(new URL(`./feed-worker${extname(here)}`, import.meta.url));

const RESTART_MS = 2_000;
/** A process told to stop gets this long before it is killed (a hung NDI receive never returns). */
const STOP_GRACE_MS = 5_000;
/** A status older than this is not shown as current. */
const STATUS_STALE_MS = 5_000;

export class FeedProcess {
  target: ReturnTarget;
  #extraIps: string[];
  #child: ChildProcess | undefined;
  #status: ReturnFeedStatus | undefined;
  #statusAt = 0;
  #since = Date.now();
  #stopping = false;
  #restart: ReturnType<typeof setTimeout> | undefined;
  #lastExit: string | null = null;
  readonly #worker: string;
  readonly #restartMs: number;

  /** `opts` is for tests: another worker script, a shorter wait before a restart. */
  constructor(target: ReturnTarget, extraIps: readonly string[], opts: { worker?: string; restartMs?: number } = {}) {
    this.target = target;
    this.#extraIps = [...extraIps];
    this.#worker = opts.worker ?? WORKER;
    this.#restartMs = opts.restartMs ?? RESTART_MS;
  }

  /** The running process's id, for logs and tests. */
  get pid(): number | undefined {
    return this.#child?.pid;
  }

  start(): void {
    this.#spawn();
  }

  /** A fresh token from the API; the process uses it on its next (re)connect. */
  update(target: ReturnTarget): void {
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
        log('warn', 'return feed process did not stop in time; killing it', { pcr: this.target.pcrName, pid: child.pid });
        child.kill('SIGKILL');
      }, STOP_GRACE_MS);
      child.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      if (child.connected) child.send({ type: 'stop' } satisfies ToWorker);
      else child.kill('SIGTERM');
    });
  }

  /** The process's own report, or, while it has none, what the gateway knows: starting, or ended and coming back. */
  status(): ReturnFeedStatus {
    if (this.#status && Date.now() - this.#statusAt < STATUS_STALE_MS) return this.#status;
    const running = this.#child !== undefined;
    return {
      pcrId: this.target.pcrId,
      pcrName: this.target.pcrName,
      source: this.target.source,
      state: running ? 'starting' : 'error',
      detail: running ? "the feed's process is starting" : `the feed's process ended (${this.#lastExit ?? 'unknown'}); starting it again`,
      connected: false,
      video: null,
      audio: null,
      publish: null,
      mv: null,
      since: this.#since,
    };
  }

  #send(message: ToWorker): void {
    if (this.#child?.connected) this.#child.send(message);
  }

  #spawn(): void {
    if (this.#stopping) return;
    // The same node flags as the gateway (its --env-file among them), the same environment, the same output.
    const child = fork(this.#worker, [], { stdio: 'inherit' });
    this.#child = child;
    this.#since = Date.now();
    child.on('message', (raw) => {
      const message = raw as FromWorker;
      if (message.type === 'status') {
        this.#status = message.status;
        this.#statusAt = Date.now();
      }
    });
    child.on('error', (err) => log('error', 'return feed process failed', { pcr: this.target.pcrName, err }));
    child.on('exit', (code, signal) => {
      if (this.#child !== child) return;
      this.#child = undefined;
      this.#status = undefined;
      this.#since = Date.now();
      if (this.#stopping) return;
      this.#lastExit = signal ? `signal ${signal}` : `exit code ${code ?? '?'}`;
      log('warn', 'return feed process ended; starting it again', { pcr: this.target.pcrName, source: this.target.source, ended: this.#lastExit, inMs: this.#restartMs });
      this.#restart = setTimeout(() => this.#spawn(), this.#restartMs);
    });
    child.send({ type: 'start', target: this.target, extraIps: this.#extraIps } satisfies ToWorker);
  }
}
