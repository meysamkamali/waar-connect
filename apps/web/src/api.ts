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

// Test phase without passwords: the API serves the screen by the role in this header, taken from the path.
export function roleFromPath(path: string = location.pathname): 'producer' | 'engineer' | 'admin' {
  if (path.startsWith('/app/engineer')) return 'engineer';
  if (path.startsWith('/app/admin')) return 'admin';
  return 'producer';
}

function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  return fetch(`/api/v1${path}`, {
    method,
    headers: { 'x-wc-role': roleFromPath(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => readJson<T>(r));
}

// ---- guest side -------------------------------------------------------------------------------

export interface JoinInfo {
  guest: { id: string; displayName: string; language: string };
  pcr: { id: string; name: string };
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

export interface PcrSettings {
  slots: number;
  ifbAllowed: boolean;
  languages: string[];
  outputNames: string[];
}
export interface Pcr {
  id: string;
  name: string;
  settings: PcrSettings;
  livekitRoom: string;
  archivedAt: string | null;
  createdAt: string;
}
export interface Contact {
  id: string;
  displayName: string;
  casparName: string | null;
  language: string;
  phone: string | null;
  whatsapp: string | null;
  telegram: string | null;
  skype: string | null;
  email: string | null;
  other: string | null;
  notes: string | null;
  updatedAt: string;
  createdAt: string;
}
export type ContactInput = Partial<Omit<Contact, 'id' | 'updatedAt' | 'createdAt'>> & { displayName: string };
export interface Invite {
  token: string;
  url: string;
  expiresAt: string;
  uses: number;
  maxUses: number;
}
export interface GuestRecord {
  id: string;
  pcrId: string;
  contactId: string | null;
  identity: string;
  displayName: string;
  language: string;
  invites: Invite[];
}
export interface PcrView {
  pcr: Pcr;
  guests: GuestRecord[];
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
export interface KioskToken {
  url: string;
  token: string;
  identity: string;
  room: string;
  pcrName: string;
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

export const listPcrs = () => call<{ pcrs: Pcr[] }>('GET', '/pcrs');
export const getPcr = (id: string) => call<PcrView>('GET', `/pcrs/${id}`);
export const createPcr = (name: string, settings?: Partial<PcrSettings>) => call<{ pcr: Pcr }>('POST', '/pcrs', { name, settings });
export const updatePcr = (id: string, patch: { name?: string; settings?: Partial<PcrSettings> }) => call<{ pcr: Pcr }>('PATCH', `/pcrs/${id}`, patch);
export const archivePcr = (id: string) => call<{ pcr: Pcr }>('POST', `/pcrs/${id}/archive`);

export const listContacts = (q = '') => call<{ contacts: Contact[] }>('GET', `/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`);
export const createContact = (input: ContactInput) => call<{ contact: Contact }>('POST', '/contacts', input);
export const updateContact = (id: string, patch: Partial<ContactInput>) => call<{ contact: Contact }>('PATCH', `/contacts/${id}`, patch);
export const deleteContact = (id: string) => call<{ ok: true }>('DELETE', `/contacts/${id}`);

export const seatGuest = (pcrId: string, body: { contactId: string } | { displayName: string; language: string }) =>
  call<{ guest: GuestRecord; existing: boolean }>('POST', `/pcrs/${pcrId}/guests`, body);
export const deleteGuest = (guestId: string) => call<{ ok: true }>('DELETE', `/guests/${guestId}`);
export const createInvite = (guestId: string) => call<Invite>('POST', `/guests/${guestId}/invite`, {});
export const revokeInvite = (token: string) => call<{ ok: true }>('POST', `/invites/${encodeURIComponent(token)}/revoke`);

export const joinPcr = (id: string) => call<StaffJoin>('POST', `/pcrs/${id}/join`);
export const getRoom = (id: string) => call<{ snapshot: RoomSnapshot }>('GET', `/pcrs/${id}/room`);
export const act = (id: string, action: RoomAction) => call<{ snapshot: RoomSnapshot }>('POST', `/pcrs/${id}/room/actions`, action);
export const outputToken = (id: string, slot: number) => call<KioskToken & { slot: number; name: string }>('POST', `/pcrs/${id}/outputs/${slot}/token`);
export const studioToken = (id: string) => call<KioskToken>('POST', `/pcrs/${id}/studio-token`);
