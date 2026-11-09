// The guest phone's camera controls: what the browser exposes on the camera track (exposure offset and
// lock, white balance lock, focus lock, zoom, torch), how the phone reports them, and how a producer's
// command becomes constraints. Pure functions, tested; the DOM calls stay in guest/session.ts.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

export interface CameraRange {
  min: number;
  max: number;
  /** 0 when the camera gave no step. */
  step: number;
}

/** What this camera can be told to do, from MediaStreamTrack.getCapabilities(). A missing key: not offered. */
export interface CameraControls {
  /** Exposure offset, in the camera's EV steps. */
  exposureCompensation?: CameraRange | undefined;
  /** The exposure can be held where it is (mode list has 'manual' and 'continuous'). */
  exposureLock?: boolean | undefined;
  whiteBalanceLock?: boolean | undefined;
  focusLock?: boolean | undefined;
  zoom?: CameraRange | undefined;
  torch?: boolean | undefined;
}

/** Where the camera stands, from getSettings(). */
export interface CameraState {
  exposureCompensation?: number | undefined;
  exposureLocked?: boolean | undefined;
  whiteBalanceLocked?: boolean | undefined;
  focusLocked?: boolean | undefined;
  zoom?: number | undefined;
  torch?: boolean | undefined;
}

/** A producer's `cam` command; also what the phone keeps across reloads. */
export interface CameraRequest {
  exposureCompensation?: number | undefined;
  exposureLock?: boolean | undefined;
  whiteBalanceLock?: boolean | undefined;
  focusLock?: boolean | undefined;
  zoom?: number | undefined;
  torch?: boolean | undefined;
  /** Everything back to the camera's own automatic behaviour. */
  auto?: boolean | undefined;
}

type Dict = Record<string, unknown>;
const NUMBER_KEYS = ['exposureCompensation', 'zoom'] as const;
const FLAG_KEYS = ['exposureLock', 'whiteBalanceLock', 'focusLock', 'torch'] as const;

function range(v: unknown): CameraRange | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { min, max, step } = v as Dict;
  if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return undefined;
  return { min, max, step: typeof step === 'number' && step > 0 ? step : 0 };
}
const lockable = (modes: unknown): boolean => Array.isArray(modes) && modes.includes('manual') && modes.includes('continuous');
/** Chrome reports torch as a boolean; older builds as a list of the values it accepts. */
const offered = (v: unknown): boolean => v === true || (Array.isArray(v) && v.includes(true));

/** The camera's controls and their state, or undefined when this browser or camera offers none. */
export function readCamera(capabilities: unknown, settings: unknown): { can: CameraControls; now: CameraState } | undefined {
  const c = (capabilities ?? {}) as Dict;
  const s = (settings ?? {}) as Dict;
  const can: CameraControls = {};
  const ec = range(c['exposureCompensation']);
  if (ec) can.exposureCompensation = ec;
  if (lockable(c['exposureMode'])) can.exposureLock = true;
  if (lockable(c['whiteBalanceMode'])) can.whiteBalanceLock = true;
  if (lockable(c['focusMode'])) can.focusLock = true;
  const zoom = range(c['zoom']);
  if (zoom) can.zoom = zoom;
  if (offered(c['torch'])) can.torch = true;
  if (Object.keys(can).length === 0) return undefined;
  const now: CameraState = {};
  if (typeof s['exposureCompensation'] === 'number') now.exposureCompensation = s['exposureCompensation'];
  if (typeof s['exposureMode'] === 'string') now.exposureLocked = s['exposureMode'] === 'manual';
  if (typeof s['whiteBalanceMode'] === 'string') now.whiteBalanceLocked = s['whiteBalanceMode'] === 'manual';
  if (typeof s['focusMode'] === 'string') now.focusLocked = s['focusMode'] === 'manual';
  if (typeof s['zoom'] === 'number') now.zoom = s['zoom'];
  if (typeof s['torch'] === 'boolean') now.torch = s['torch'];
  return { can, now };
}

/** Inside the range, on the camera's step (counted from 0 when the range spans it, as EV steps are). */
export function clampTo(v: number, r: CameraRange): number {
  let x = Math.min(r.max, Math.max(r.min, v));
  if (r.step > 0) {
    const base = r.min <= 0 && 0 <= r.max ? 0 : r.min;
    x = base + Math.round((x - base) / r.step) * r.step;
  }
  x = Number(x.toFixed(4));
  return Math.min(r.max, Math.max(r.min, x));
}

/** A command payload as a CameraRequest; anything else in it is ignored. */
export function parseCameraRequest(v: unknown): CameraRequest | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Dict;
  const req: CameraRequest = {};
  if (o['auto'] === true) req.auto = true;
  for (const k of NUMBER_KEYS) if (typeof o[k] === 'number' && Number.isFinite(o[k])) req[k] = o[k] as number;
  for (const k of FLAG_KEYS) if (typeof o[k] === 'boolean') req[k] = o[k] as boolean;
  return Object.keys(req).length ? req : undefined;
}

/** What the phone keeps: the new command over the earlier ones; `auto` forgets them all. */
export function mergeCameraRequest(previous: CameraRequest | undefined, cmd: CameraRequest): CameraRequest | undefined {
  if (cmd.auto) return undefined;
  const next: CameraRequest = { ...(previous ?? {}) };
  for (const k of NUMBER_KEYS) if (cmd[k] !== undefined) next[k] = cmd[k];
  for (const k of FLAG_KEYS) if (cmd[k] !== undefined) next[k] = cmd[k];
  delete next.auto;
  return Object.keys(next).length ? next : undefined;
}

/**
 * Constraint sets for track.applyConstraints({ advanced }): one per setting, so a value the camera
 * refuses does not take the others down with it. Only settings this camera offers are included.
 */
export function cameraConstraints(req: CameraRequest, can: CameraControls): Dict[] {
  const sets: Dict[] = [];
  if (req.auto) {
    if (can.exposureLock) sets.push({ exposureMode: 'continuous' });
    if (can.whiteBalanceLock) sets.push({ whiteBalanceMode: 'continuous' });
    if (can.focusLock) sets.push({ focusMode: 'continuous' });
    if (can.exposureCompensation) sets.push({ exposureCompensation: clampTo(0, can.exposureCompensation) });
    if (can.zoom) sets.push({ zoom: can.zoom.min });
    if (can.torch) sets.push({ torch: false });
    return sets;
  }
  if (req.exposureLock !== undefined && can.exposureLock) sets.push({ exposureMode: req.exposureLock ? 'manual' : 'continuous' });
  if (req.whiteBalanceLock !== undefined && can.whiteBalanceLock) sets.push({ whiteBalanceMode: req.whiteBalanceLock ? 'manual' : 'continuous' });
  if (req.focusLock !== undefined && can.focusLock) sets.push({ focusMode: req.focusLock ? 'manual' : 'continuous' });
  if (req.exposureCompensation !== undefined && can.exposureCompensation) sets.push({ exposureCompensation: clampTo(req.exposureCompensation, can.exposureCompensation) });
  if (req.zoom !== undefined && can.zoom) sets.push({ zoom: clampTo(req.zoom, can.zoom) });
  if (req.torch !== undefined && can.torch) sets.push({ torch: req.torch });
  return sets;
}

/** "+0.7 EV", "−1 EV", "0 EV". */
export function evLabel(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return '0 EV';
  const text = Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(1);
  return `${r > 0 ? '+' : '−'}${text} EV`;
}
