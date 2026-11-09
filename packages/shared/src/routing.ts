// The routing engine: who may receive which track, from the table in SYSTEM-PLAN.md.
// Pure functions over RoomState. The API applies the result with UpdateSubscriptions; the pages run
// the same code locally with auto-subscribe off; talk tracks add per-track permissions. Three locks.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import {
  roleOf,
  slotOfOutput,
  STUDIO_IDENTITY,
  type GuestState,
  type PublishedTrack,
  type RoomState,
  type StaffState,
} from './model.ts';

function guestById(state: RoomState, identity: string): GuestState | undefined {
  return state.guests.find((g) => g.identity === identity);
}

function staffById(state: RoomState, identity: string): StaffState | undefined {
  return state.staff.find((s) => s.identity === identity);
}

/** Does this staff member's talk track currently address this guest? */
export function talksTo(staff: StaffState, guestIdentity: string): boolean {
  if (staff.talkTo === 'none') return false;
  if (staff.talkTo === 'all') return true;
  return staff.talkTo.includes(guestIdentity);
}

function guestMayReceive(guest: GuestState, track: PublishedTrack, state: RoomState): boolean {
  if (track.publisher === guest.identity) return false; // never yourself

  switch (guest.place) {
    case 'lobby':
    case 'left':
      return false;

    case 'green': {
      switch (track.source) {
        case 'talkback': {
          const staff = staffById(state, track.publisher);
          return staff !== undefined && talksTo(staff, guest.identity);
        }
        case 'program-video':
          return guest.program;
        case 'program-audio':
          return guest.studioSound;
        case 'camera':
        case 'microphone': {
          const staff = staffById(state, track.publisher);
          if (staff) return track.source === 'camera' && staff.faceTo === guest.identity;
          const other = guestById(state, track.publisher);
          return (
            other !== undefined &&
            other.place === 'green' &&
            guest.table !== null &&
            other.table === guest.table
          );
        }
      }
      return false;
    }

    case 'studio': {
      switch (track.source) {
        case 'talkback': {
          const staff = staffById(state, track.publisher);
          return (
            staff !== undefined &&
            staff.role === 'engineer' &&
            state.ifbOverride.includes(guest.identity) &&
            talksTo(staff, guest.identity)
          );
        }
        case 'program-video':
        case 'program-audio':
          return true;
        case 'camera':
        case 'microphone': {
          const other = guestById(state, track.publisher);
          return other !== undefined && other.place === 'studio';
        }
      }
      return false;
    }
  }
}

function staffMayReceive(staff: StaffState, track: PublishedTrack, state: RoomState): boolean {
  if (track.publisher === staff.identity) return false;
  switch (track.source) {
    case 'talkback':
      return false; // producer and engineer do not hear each other's talk; they have the room
    case 'program-video':
      return true;
    case 'program-audio':
      return false; // the console sits in the PCR, where the programme sound is on the monitors already
    case 'camera':
    case 'microphone':
      // every guest, in every place: the door needs a preview, the studio needs monitoring
      return guestById(state, track.publisher) !== undefined;
  }
}

function outputMayReceive(slot: number, track: PublishedTrack, state: RoomState): boolean {
  if (track.source !== 'camera' && track.source !== 'microphone') return false;
  const guest = guestById(state, track.publisher);
  return guest !== undefined && guest.place === 'studio' && guest.slot === slot;
}

/** The single rule: may `subscriber` receive `track` given the room state? */
export function canReceive(subscriber: string, track: PublishedTrack, state: RoomState): boolean {
  if (subscriber === track.publisher) return false;
  const role = roleOf(subscriber);
  switch (role) {
    case 'guest': {
      const guest = guestById(state, subscriber);
      return guest !== undefined && guestMayReceive(guest, track, state);
    }
    case 'producer':
    case 'engineer': {
      const staff = staffById(state, subscriber);
      return staff !== undefined && staffMayReceive(staff, track, state);
    }
    case 'out': {
      const slot = slotOfOutput(subscriber);
      return slot !== null && outputMayReceive(slot, track, state);
    }
    case 'monitor':
      return track.source !== 'talkback';
    case 'studio':
      return false; // the return feed publishes; it receives nothing
    default:
      return false;
  }
}

export function allowedTracks(subscriber: string, tracks: readonly PublishedTrack[], state: RoomState): PublishedTrack[] {
  return tracks.filter((t) => canReceive(subscriber, t, state));
}

/** Every known participant mapped to the track sids they may receive right now. */
export function subscriptionPlan(state: RoomState, tracks: readonly PublishedTrack[]): Map<string, string[]> {
  const plan = new Map<string, string[]>();
  const subscribers = [
    ...state.guests.map((g) => g.identity),
    ...state.staff.map((s) => s.identity),
    ...state.outputs.map((o) => o.identity),
    STUDIO_IDENTITY,
  ];
  for (const subscriber of subscribers) {
    plan.set(
      subscriber,
      allowedTracks(subscriber, tracks, state).map((t) => t.sid),
    );
  }
  return plan;
}

/**
 * Guests who may subscribe to this staff member's talk track right now, for the publisher-side
 * track subscription permissions. Green-room guests they talk to, plus studio guests under IFB override
 * when the staff member is an engineer.
 */
export function talkbackSubscribers(staff: StaffState, state: RoomState): string[] {
  const probe: PublishedTrack = { sid: 'talkback', publisher: staff.identity, source: 'talkback' };
  return state.guests.filter((g) => guestMayReceive(g, probe, state)).map((g) => g.identity);
}
