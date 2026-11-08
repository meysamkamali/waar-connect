// JSON lines to stdout/stderr; journald keeps them. No dependency.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

export type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function isLevel(value: string | undefined): value is Level {
  return value !== undefined && value in ORDER;
}

let threshold = ORDER[isLevel(process.env['LOG_LEVEL']) ? process.env['LOG_LEVEL'] : 'info'];

export function setLevel(level: Level): void {
  threshold = ORDER[level];
}

function plain(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return { message: value.message, stack: value.stack };
  return value;
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < threshold) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }, plain);
  (level === 'warn' || level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}
