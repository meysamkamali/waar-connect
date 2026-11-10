// waar Connect domain model: places, roles, identities and participant attributes.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

export const PLACES = ['lobby', 'green', 'studio', 'left'] as const;
export type Place = (typeof PLACES)[number];

export const TALLIES = ['off', 'standby', 'onair'] as const;
export type Tally = (typeof TALLIES)[number];

export const ROLES = ['guest', 'producer', 'engineer', 'studio', 'out', 'monitor'] as const;
export type Role = (typeof ROLES)[number];

export type StaffRole = Extract<Role, 'producer' | 'engineer'>;

/**
 * mv-strip is the multiview: one wide picture holding the guests ticked MV, published by the return
 * feed beside the program while such guests exist. The phone lays it over whatever the guest sees.
 */
export const TRACK_SOURCES = ['camera', 'microphone', 'talkback', 'program-video', 'program-audio', 'mv-strip'] as const;
/** The name the return feed gives the multiview track; the API tells it from the return by this name. */
export const MV_STRIP_TRACK = 'mv-strip';
export type TrackSource = (typeof TRACK_SOURCES)[number];

/** The studio return (program picture and mix-minus) is always published under exactly this identity. */
export const STUDIO_IDENTITY = 'studio';

export interface GuestState {
  identity: string;
  place: Place;
  tally: Tally;
  /** Studio output slot, 1-based, or null while unassigned. */
  slot: number | null;
  /**
   * Green room: in the multiview group (MV). The guests of the group see each other as small pictures,
   * hear each other, and all hear the producer when one of them is talked to.
   */
  mv: boolean;
  /** Green room: hears the studio mix-minus. */
  studioSound: boolean;
  /** Green room: sees the program picture. */
  program: boolean;
  /** Engineer's mark that the connection has been checked. */
  ready: boolean;
}

export interface StaffState {
  identity: string;
  role: StaffRole;
  /** Who hears this person's talk track: nobody, every green-room guest, or the listed guests. */
  talkTo: 'none' | 'all' | readonly string[];
  /** Face-to-face: the one guest who sees this person's camera. */
  faceTo: string | null;
}

export interface OutputState {
  identity: string;
  slot: number;
}

export interface RoomState {
  guests: readonly GuestState[];
  staff: readonly StaffState[];
  outputs: readonly OutputState[];
  /** Guests an engineer may talk to although they are in the studio (emergency IFB). */
  ifbOverride: readonly string[];
}

export interface PublishedTrack {
  sid: string;
  publisher: string;
  source: TrackSource;
}

// ---- identities -------------------------------------------------------------------------------

export function identityFor(role: Role, id: string): string {
  switch (role) {
    case 'studio':
      return STUDIO_IDENTITY;
    case 'out':
      return `out:slot-${id}`;
    default:
      return `${role}:${id}`;
  }
}

export function outputIdentity(slot: number): string {
  return identityFor('out', String(slot));
}

export function roleOf(identity: string): Role | undefined {
  if (identity === STUDIO_IDENTITY) return 'studio';
  const prefix = identity.slice(0, identity.indexOf(':'));
  return (ROLES as readonly string[]).includes(prefix) ? (prefix as Role) : undefined;
}

export function slotOfOutput(identity: string): number | null {
  const m = /^out:slot-(\d+)$/.exec(identity);
  return m ? Number(m[1]) : null;
}

// ---- attributes ------------------------------------------------------------------------------

/** Participant attribute keys. Written only by the API; every page reads them. */
export const ATTR = {
  place: 'wc.place',
  tally: 'wc.tally',
  slot: 'wc.slot',
  mv: 'wc.mv',
  studioSound: 'wc.studio_sound',
  program: 'wc.program',
  ready: 'wc.ready',
} as const;

export function defaultGuestState(identity: string): GuestState {
  return {
    identity,
    place: 'lobby',
    tally: 'off',
    slot: null,
    mv: false,
    studioSound: false,
    program: false,
    ready: false,
  };
}

export function guestAttributes(g: GuestState): Record<string, string> {
  return {
    [ATTR.place]: g.place,
    [ATTR.tally]: g.tally,
    [ATTR.slot]: g.slot === null ? '' : String(g.slot),
    [ATTR.mv]: g.mv ? '1' : '0',
    [ATTR.studioSound]: g.studioSound ? '1' : '0',
    [ATTR.program]: g.program ? '1' : '0',
    [ATTR.ready]: g.ready ? '1' : '0',
  };
}

/** Set on a guest while an engineer may talk to them in the studio (IFB override). */
export const GUEST_IFB_ATTR = 'wc.ifb';

/** Staff attribute keys; `talkAllowed` is computed by the server and applied by the staff client. */
export const STAFF_ATTR = {
  role: 'wc.role',
  talkTo: 'wc.talk_to',
  faceTo: 'wc.face_to',
  talkAllowed: 'wc.talk_allowed',
} as const;

export function staffAttributes(s: StaffState, talkAllowed: readonly string[]): Record<string, string> {
  return {
    [STAFF_ATTR.role]: s.role,
    [STAFF_ATTR.talkTo]: s.talkTo === 'none' || s.talkTo === 'all' ? s.talkTo : s.talkTo.join(','),
    [STAFF_ATTR.faceTo]: s.faceTo ?? '',
    [STAFF_ATTR.talkAllowed]: talkAllowed.join(','),
  };
}

export function staffFromAttributes(identity: string, role: StaffRole, attrs: Readonly<Record<string, string>>): StaffState {
  const raw = attrs[STAFF_ATTR.talkTo] ?? 'none';
  const talkTo: StaffState['talkTo'] = raw === 'none' || raw === 'all' ? raw : raw.split(',').filter((x) => x.length > 0);
  return { identity, role, talkTo, faceTo: attrs[STAFF_ATTR.faceTo] || null };
}

export function guestFromAttributes(identity: string, attrs: Readonly<Record<string, string>>): GuestState {
  const d = defaultGuestState(identity);
  const place = attrs[ATTR.place];
  const tally = attrs[ATTR.tally];
  const slot = Number(attrs[ATTR.slot]);
  return {
    identity,
    place: (PLACES as readonly string[]).includes(place ?? '') ? (place as Place) : d.place,
    tally: (TALLIES as readonly string[]).includes(tally ?? '') ? (tally as Tally) : d.tally,
    slot: Number.isInteger(slot) && slot > 0 ? slot : null,
    mv: attrs[ATTR.mv] === '1',
    studioSound: attrs[ATTR.studioSound] === '1',
    program: attrs[ATTR.program] === '1',
    ready: attrs[ATTR.ready] === '1',
  };
}
