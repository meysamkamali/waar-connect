// Temporary, test phase: the VM's CPU and memory for the top bar of the staff pages (GET /system),
// so the cost of the gateway and the rooms can be watched while testing. Remove when no longer needed.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';

export interface CpuTimes {
  busy: number;
  total: number;
}

export interface SystemLoad {
  at: number;
  /** Whole machine, all cores, over the last sampling interval. */
  cpuPct: number;
  cores: number;
  load1: number;
  memUsedMb: number;
  memTotalMb: number;
}

/** The summary "cpu" line of /proc/stat as busy and total jiffies (idle and iowait count as idle). */
export function parseProcStat(text: string): CpuTimes | undefined {
  const line = text.split('\n').find((l) => l.startsWith('cpu '));
  if (!line) return undefined;
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  if (n.length < 4 || n.some((x) => !Number.isFinite(x))) return undefined;
  const idle = (n[3] ?? 0) + (n[4] ?? 0);
  const total = n.reduce((a, b) => a + b, 0);
  return { busy: total - idle, total };
}

export function cpuPercent(prev: CpuTimes, next: CpuTimes): number {
  const dt = next.total - prev.total;
  if (dt <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((next.busy - prev.busy) / dt) * 100)));
}

/** MemTotal and MemAvailable from /proc/meminfo, in MB. */
export function parseMeminfo(text: string): { totalMb: number; availableMb: number } | undefined {
  const get = (key: string): number | undefined => {
    const m = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text);
    return m ? Number(m[1]) / 1024 : undefined;
  };
  const totalMb = get('MemTotal');
  const availableMb = get('MemAvailable');
  if (totalMb === undefined || availableMb === undefined) return undefined;
  return { totalMb, availableMb };
}

function cpuTimesFromOs(): CpuTimes {
  let busy = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    const all = t.user + t.nice + t.sys + t.idle + t.irq;
    total += all;
    busy += all - t.idle;
  }
  return { busy, total };
}

/** Samples /proc/stat every few seconds (os.cpus() where there is no /proc) and answers from the last two samples. */
export class SystemSampler {
  #prev: CpuTimes | undefined;
  #cpuPct = 0;
  #timer: NodeJS.Timeout | undefined;

  start(everyMs = 2000): void {
    void this.#tick();
    this.#timer = setInterval(() => void this.#tick(), everyMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #tick(): Promise<void> {
    const now = (await readFile('/proc/stat', 'utf8').then(parseProcStat).catch(() => undefined)) ?? cpuTimesFromOs();
    if (this.#prev) this.#cpuPct = cpuPercent(this.#prev, now);
    this.#prev = now;
  }

  async read(): Promise<SystemLoad> {
    const mem = (await readFile('/proc/meminfo', 'utf8').then(parseMeminfo).catch(() => undefined)) ?? {
      totalMb: os.totalmem() / 1048576,
      availableMb: os.freemem() / 1048576,
    };
    return {
      at: Date.now(),
      cpuPct: this.#cpuPct,
      cores: os.cpus().length,
      load1: os.loadavg()[0] ?? 0,
      memUsedMb: Math.round(mem.totalMb - mem.availableMb),
      memTotalMb: Math.round(mem.totalMb),
    };
  }
}

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  const staff = app.requireRole('admin', 'producer', 'engineer');
  const sampler = new SystemSampler();
  sampler.start();
  app.addHook('onClose', async () => sampler.stop());
  app.get('/system', { preHandler: staff }, () => sampler.read());
}
