// Calls to the waar Connect API (same origin, /api/v1). Sessions are cookies, sent automatically.
import type { GuestState, OutputState, PublishedTrack, StaffState } from '@waar-connect/shared';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data;
}

// Test phase without passwords: the API serves the screen as producer or engineer by this header.
const roleHeader = (): string => (location.pathname.startsWith('/app/engineer') ? 'engineer' : 'producer');

function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  return fetch(`/api/v1${path}`, {
    method,
    headers: { 'x-wc-role': roleHeader(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => readJson<T>(r));
}

// ---- guest side -------------------------------------------------------------------------------

export interface JoinInfo {
  guest: { id: string; displayName: string; language: string };
  episode: { id: string; title: string; status: 'planned' | 'live' | 'ended'; program: string };
  livekit: { url: string; token: string; identity: string };
}

export const resolveInvite = (token: string) => call<JoinInfo>('GET', `/invite/${encodeURIComponent(token)}`);

export async function getServerTime(): Promise<number> {
  const res = await fetch('/api/time', { cache: 'no-store' }).catch(() => null);
  if (res?.ok) return ((await res.json()) as { now: number }).now;
  const head = await fetch('/api/v1/health', { cache: 'no-store' });
  const date = head.headers.get('date');
  return date ? new Date(date).getTime() : Date.now();
}

/** Round trip to the API in milliseconds, best of three. */
export async function measureRtt(): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    await fetch('/api/v1/health', { cache: 'no-store' });
    best = Math.min(best, performance.now() - t0);
  }
  return Math.round(best);
}

// ---- staff side -------------------------------------------------------------------------------

export type UserRole = 'admin' | 'producer' | 'engineer';
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface ProgramSettings {
  slots: number;
  readyRequired: boolean;
  ifbAllowed: boolean;
  languages: string[];
}
export interface Program {
  id: string;
  name: string;
  settings: ProgramSettings;
}
export interface Episode {
  id: string;
  programId: string;
  title: string;
  status: 'planned' | 'live' | 'ended';
  livekitRoom: string;
  startsAt: string | null;
  createdAt: string;
}
export interface Invite {
  token: string;
  url: string;
  expiresAt: string;
  uses: number;
  maxUses: number;
}
export interface GuestRecord {
  id: string;
  identity: string;
  displayName: string;
  casparName: string | null;
  language: string;
  phone: string | null;
  notes: string | null;
  invites: Invite[];
}
export interface Slot {
  number: number;
  guestId: string | null;
  outputName: string | null;
}
export interface EpisodeView {
  episode: Episode;
  settings: ProgramSettings | null;
  guests: GuestRecord[];
  slots: Slot[];
}
export interface RoomSnapshot {
  room: string;
  guests: GuestState[];
  staff: StaffState[];
  outputs: OutputState[];
  monitors: string[];
  connected: string[];
  studioConnected: boolean;
  ifbOverride: string[];
  tracks: PublishedTrack[];
}
export interface StaffJoin {
  url: string;
  token: string;
  identity: string;
  room: string;
  role: 'producer' | 'engineer';
}

export type RoomAction =
  | { type: 'admit'; guest: string }
  | { type: 'table'; guest: string; table: string | null }
  | { type: 'studioSound'; guest: string; on: boolean }
  | { type: 'program'; guest: string; on: boolean }
  | { type: 'slot'; guest: string; slot: number | null }
  | { type: 'ready'; guest: string; on: boolean }
  | { type: 'handoff'; guest: string }
  | { type: 'tally'; guest: string; tally: 'standby' | 'onair' }
  | { type: 'bringBack'; guest: string }
  | { type: 'kick'; guest: string }
  | { type: 'ifb'; guest: string; on: boolean }
  | { type: 'talk'; to: 'none' | 'all' | string[] }
  | { type: 'face'; guest: string | null }
  | { type: 'cue'; to: string | 'all'; text: string }
  | { type: 'command'; guest: string; command: Record<string, unknown> };

export const login = (email: string, password: string) => call<{ user: User }>('POST', '/auth/login', { email, password });
export const logout = () => call<{ ok: true }>('POST', '/auth/logout');
export const me = () => call<{ user: User; open?: boolean }>('GET', '/me');
export const listPrograms = () => call<{ programs: Program[] }>('GET', '/programs');
export const getProgram = (id: string) => call<{ program: Program; episodes: Episode[] }>('GET', `/programs/${id}`);
export const createProgram = (name: string) => call<{ program: Program }>('POST', '/programs', { name });
export const createEpisode = (programId: string, title: string) => call<{ episode: Episode }>('POST', `/programs/${programId}/episodes`, { title });
export const getEpisode = (id: string) => call<EpisodeView>('GET', `/episodes/${id}`);
export const startEpisode = (id: string) => call<{ episode: Episode }>('POST', `/episodes/${id}/start`);
export const endEpisode = (id: string) => call<{ episode: Episode }>('POST', `/episodes/${id}/end`);
export const addGuest = (episodeId: string, displayName: string, language: string) => call<{ guest: GuestRecord }>('POST', `/episodes/${episodeId}/guests`, { displayName, language });
export const deleteGuest = (guestId: string) => call<{ ok: true }>('DELETE', `/guests/${guestId}`);
export const createInvite = (guestId: string) => call<Invite & { token: string }>('POST', `/guests/${guestId}/invite`, {});
export const joinEpisode = (id: string) => call<StaffJoin>('POST', `/episodes/${id}/join`);
export const getRoom = (id: string) => call<{ snapshot: RoomSnapshot }>('GET', `/episodes/${id}/room`);
export const act = (id: string, action: RoomAction) => call<{ snapshot: RoomSnapshot }>('POST', `/episodes/${id}/room/actions`, action);
export const outputToken = (id: string, slot: number) => call<{ url: string; token: string; identity: string; room: string; slot: number }>('POST', `/episodes/${id}/outputs/${slot}/token`);
