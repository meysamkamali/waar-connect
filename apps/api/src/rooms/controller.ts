// The room controller: live state of one episode's room, the green-room actions, and after every
// change the push of attributes and subscriptions so the routing matrix holds on the wire.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import {
  allowedTracks,
  defaultGuestState,
  GUEST_IFB_ATTR,
  GUEST_COUNT_ATTR,
  guestAttributes,
  guestsOnScreen,
  guestFromAttributes,
  roleOf,
  slotOfOutput,
  staffAttributes,
  staffFromAttributes,
  STUDIO_IDENTITY,
  talkbackSubscribers,
  type GuestState,
  type OutputState,
  type Place,
  type PublishedTrack,
  type RoomState,
  type StaffRole,
  type StaffState,
  type Tally,
} from '@waar-connect/shared';
import type { LiveKitControl, ParticipantSnapshot, TrackSnapshot } from './livekit-control.ts';
import { routedSource } from './tracks.ts';

export interface RoomSettings {
  slots: number;
  ifbAllowed: boolean;
  /** A guest goes to the studio, and on air, only after the engineer approved them. */
  approval: boolean;
}

export type RoomAction =
  | { type: 'admit'; guest: string }
  | { type: 'mv'; guest: string; on: boolean }
  | { type: 'studioSound'; guest: string; on: boolean }
  | { type: 'program'; guest: string; on: boolean }
  | { type: 'slot'; guest: string; slot: number | null }
  | { type: 'ready'; guest: string; on: boolean }
  | { type: 'handoff'; guest: string }
  | { type: 'tally'; guest: string; tally: Exclude<Tally, 'off'> }
  | { type: 'bringBack'; guest: string }
  | { type: 'kick'; guest: string }
  | { type: 'ifb'; guest: string; on: boolean }
  | { type: 'talk'; staff: string; to: 'none' | 'all' | string[] }
  | { type: 'face'; staff: string; guest: string | null }
  | { type: 'cue'; to: string | 'all'; text: string }
  | { type: 'command'; guest: string; command: Record<string, unknown> };

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

export class ActionError extends Error {}

/** How long a guest who dropped keeps their place, slot and tally for a reconnect. */
const DEPARTED_GRACE_MS = 15 * 60_000;

export type EventSink = (type: string, actor: string, payload: Record<string, unknown>) => void;

export class RoomController {
  readonly #guests = new Map<string, GuestState>();
  readonly #staff = new Map<string, StaffState>();
  readonly #outputs = new Map<string, OutputState>();
  readonly #monitors = new Set<string>();
  readonly #connected = new Set<string>();
  readonly #tracks = new Map<string, PublishedTrack>();
  readonly #ifb = new Set<string>();
  readonly #departed = new Map<string, { state: GuestState; ifb: boolean; at: number }>();
  readonly #applied = new Map<string, Set<string>>();
  readonly #pushedAttrs = new Map<string, string>();
  #chain: Promise<void> = Promise.resolve();
  readonly room: string;
  private readonly control: LiveKitControl;
  private settings: RoomSettings;
  private readonly emit: EventSink;

  constructor(room: string, control: LiveKitControl, settings: RoomSettings, emit: EventSink = () => undefined) {
    this.room = room;
    this.control = control;
    this.settings = settings;
    this.emit = emit;
  }

  updateSettings(settings: RoomSettings): void {
    this.settings = settings;
  }

  /** Rebuilds state from the participants currently in the room (after a restart). */
  async load(): Promise<void> {
    const participants = await this.control.listParticipants(this.room);
    for (const p of participants) this.#ingest(p);
    await this.#apply();
  }

  // ---- webhooks -------------------------------------------------------------------------------

  onParticipantJoined(p: ParticipantSnapshot): Promise<void> {
    return this.#serial(async () => {
      this.#ingest(p);
      await this.#apply();
    });
  }

  onParticipantLeft(identity: string): Promise<void> {
    return this.#serial(async () => {
      const guest = this.#guests.get(identity);
      if (guest) {
        this.#departed.set(identity, { state: guest, ifb: this.#ifb.has(identity), at: Date.now() });
        this.#guests.delete(identity);
        this.#ifb.delete(identity);
      }
      this.#outputs.delete(identity);
      this.#monitors.delete(identity);
      this.#connected.delete(identity);
      this.#applied.delete(identity);
      this.#pushedAttrs.delete(identity);
      for (const [sid, t] of this.#tracks) if (t.publisher === identity) this.#tracks.delete(sid);
      await this.#apply();
    });
  }

  onTrackPublished(publisher: string, track: TrackSnapshot): Promise<void> {
    return this.#serial(async () => {
      this.#addTrack(publisher, track);
      await this.#apply();
    });
  }

  onTrackUnpublished(sid: string): Promise<void> {
    return this.#serial(async () => {
      this.#tracks.delete(sid);
      await this.#apply();
    });
  }

  // ---- actions --------------------------------------------------------------------------------

  act(action: RoomAction, actor: string): Promise<RoomSnapshot> {
    return this.#serial(async () => {
      await this.#perform(action, actor);
      this.emit(`room.${action.type}`, actor, { ...action });
      await this.#apply();
      return this.snapshot();
    });
  }

  snapshot(): RoomSnapshot {
    return {
      room: this.room,
      guests: [...this.#guests.values()],
      staff: [...this.#staff.values()],
      outputs: [...this.#outputs.values()],
      monitors: [...this.#monitors],
      connected: [...this.#connected],
      studioConnected: this.#connected.has(STUDIO_IDENTITY),
      ifbOverride: [...this.#ifb],
      tracks: [...this.#tracks.values()],
    };
  }

  // ---- internals ------------------------------------------------------------------------------

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(fn, fn);
    this.#chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #state(): RoomState {
    return { guests: [...this.#guests.values()], staff: [...this.#staff.values()], outputs: [...this.#outputs.values()], ifbOverride: [...this.#ifb] };
  }

  #ingest(p: ParticipantSnapshot): void {
    const role = roleOf(p.identity);
    this.#connected.add(p.identity);
    switch (role) {
      case 'guest': {
        const departed = this.#departed.get(p.identity);
        this.#departed.delete(p.identity);
        const hasAttrs = Object.keys(p.attributes).some((k) => k.startsWith('wc.'));
        let state: GuestState;
        if (hasAttrs) state = guestFromAttributes(p.identity, p.attributes);
        else if (departed && Date.now() - departed.at < DEPARTED_GRACE_MS) {
          state = departed.state;
          // Their slot may have gone to someone else while they were away: then they wait in the green room.
          if (state.place === 'studio' && [...this.#guests.values()].some((o) => o.slot === state.slot)) {
            state = { ...state, place: 'green', slot: null, tally: 'off' };
          }
        }
        else state = defaultGuestState(p.identity);
        this.#guests.set(p.identity, state);
        if (departed?.ifb || p.attributes[GUEST_IFB_ATTR] === '1') this.#ifb.add(p.identity);
        break;
      }
      case 'producer':
      case 'engineer': {
        const existing = this.#staff.get(p.identity);
        this.#staff.set(p.identity, existing ?? staffFromAttributes(p.identity, role, p.attributes));
        break;
      }
      case 'out': {
        const slot = slotOfOutput(p.identity);
        if (slot !== null) this.#outputs.set(p.identity, { identity: p.identity, slot });
        break;
      }
      case 'monitor':
        this.#monitors.add(p.identity);
        break;
      default:
        break;
    }
    for (const t of p.tracks) this.#addTrack(p.identity, t);
  }

  #addTrack(publisher: string, t: TrackSnapshot): void {
    const source = routedSource(publisher, t.source, t.name);
    if (source) this.#tracks.set(t.sid, { sid: t.sid, publisher, source });
  }

  #guest(identity: string): GuestState {
    const g = this.#guests.get(identity);
    if (!g) throw new ActionError('That guest is not in the room.');
    return g;
  }

  #staffState(identity: string): StaffState {
    let s = this.#staff.get(identity);
    if (!s) {
      const role = roleOf(identity);
      if (role !== 'producer' && role !== 'engineer') throw new ActionError('Only a producer or engineer can do that.');
      s = { identity, role: role as StaffRole, talkTo: 'none', faceTo: null };
      this.#staff.set(identity, s);
    }
    return s;
  }

  #move(g: GuestState, from: Place[], to: Place, what: string): void {
    if (!from.includes(g.place)) throw new ActionError(`${what} needs the guest in the ${from.join(' or ')}; they are in the ${g.place}.`);
    g.place = to;
  }

  async #perform(action: RoomAction, actor: string): Promise<void> {
    switch (action.type) {
      case 'admit': {
        const g = this.#guest(action.guest);
        this.#move(g, ['lobby'], 'green', 'Admit');
        return;
      }
      case 'mv': {
        // In or out of the multiview group; the routing engine does the rest.
        this.#guest(action.guest).mv = action.on;
        return;
      }
      case 'studioSound': {
        this.#guest(action.guest).studioSound = action.on;
        return;
      }
      case 'program': {
        this.#guest(action.guest).program = action.on;
        return;
      }
      case 'slot': {
        const g = this.#guest(action.guest);
        if (action.slot !== null && (action.slot < 1 || action.slot > this.settings.slots)) throw new ActionError(`Slots go from 1 to ${this.settings.slots}.`);
        if (g.place === 'studio') throw new ActionError('Bring the guest back before changing their slot.');
        if (action.slot !== null) {
          for (const other of this.#guests.values()) {
            if (other !== g && other.slot === action.slot) {
              if (other.place === 'studio') throw new ActionError(`Slot ${action.slot} is on the studio side with ${other.identity}.`);
              other.slot = null;
            }
          }
        }
        g.slot = action.slot;
        return;
      }
      case 'ready': {
        this.#guest(action.guest).ready = action.on;
        return;
      }
      case 'handoff': {
        const g = this.#guest(action.guest);
        if (g.place !== 'green') throw new ActionError('Only a guest in the green room can be sent to the studio.');
        if (this.settings.approval && !g.ready) throw new ActionError('The engineer has not approved this guest for air yet.');
        if (g.slot === null) {
          // No slot chosen (the normal case): the first one no guest holds.
          const taken = new Set([...this.#guests.values()].filter((o) => o !== g).map((o) => o.slot));
          const free = Array.from({ length: this.settings.slots }, (_, i) => i + 1).find((n) => !taken.has(n));
          if (free === undefined) throw new ActionError(`All ${this.settings.slots} slots are taken.`);
          g.slot = free;
        }
        for (const other of this.#guests.values()) {
          if (other !== g && other.place === 'studio' && other.slot === g.slot) throw new ActionError(`Slot ${g.slot} is still occupied by ${other.identity}.`);
        }
        g.place = 'studio';
        g.tally = 'standby';
        // the MV tick is kept: it counts in the green room only, and applies again when the guest comes back
        return;
      }
      case 'tally': {
        const g = this.#guest(action.guest);
        if (g.place !== 'studio') throw new ActionError('Tally applies to guests in the studio.');
        // An approval the engineer withdrew keeps a guest off air; one who is on air already is not cut.
        if (action.tally === 'onair' && this.settings.approval && !g.ready) throw new ActionError('The engineer withdrew the approval: this guest cannot go on air.');
        g.tally = action.tally;
        return;
      }
      case 'bringBack': {
        const g = this.#guest(action.guest);
        this.#move(g, ['studio'], 'green', 'Bring back');
        g.tally = 'off';
        g.slot = null; // the slot is free for the next guest; sending again picks the first free one
        this.#ifb.delete(g.identity);
        return;
      }
      case 'kick': {
        const g = this.#guest(action.guest);
        g.place = 'left';
        this.#departed.delete(g.identity);
        await this.control.removeParticipant(this.room, g.identity).catch(() => undefined);
        this.#guests.delete(g.identity);
        this.#ifb.delete(g.identity);
        return;
      }
      case 'ifb': {
        if (!this.settings.ifbAllowed) throw new ActionError('IFB override is switched off for this program.');
        const g = this.#guest(action.guest);
        if (g.place !== 'studio') throw new ActionError('IFB override is for guests in the studio.');
        if (action.on) this.#ifb.add(g.identity);
        else this.#ifb.delete(g.identity);
        return;
      }
      case 'talk': {
        const s = this.#staffState(action.staff);
        s.talkTo = Array.isArray(action.to) ? [...new Set(action.to)] : action.to;
        return;
      }
      case 'face': {
        const s = this.#staffState(action.staff);
        if (action.guest !== null) this.#guest(action.guest);
        s.faceTo = action.guest;
        return;
      }
      case 'cue': {
        const text = action.text.trim();
        if (!text) throw new ActionError('A cue needs text.');
        const to = action.to === 'all' ? [...this.#guests.keys()].filter((id) => this.#connected.has(id)) : [this.#guest(action.to).identity];
        if (to.length) await this.control.sendData(this.room, to, 'wc.cue', { text, from: actor, at: Date.now() });
        return;
      }
      case 'command': {
        const g = this.#guest(action.guest);
        await this.control.sendData(this.room, [g.identity], 'wc.cmd', { ...action.command, from: actor, at: Date.now() });
        return;
      }
    }
  }

  /** Pushes attributes and subscriptions so the wire matches the matrix. Tolerates participants that just left. */
  async #apply(): Promise<void> {
    const state = this.#state();
    const tracks = [...this.#tracks.values()];

    for (const g of this.#guests.values()) {
      if (!this.#connected.has(g.identity)) continue;
      await this.#pushAttributes(g.identity, { ...guestAttributes(g), [GUEST_IFB_ATTR]: this.#ifb.has(g.identity) ? '1' : '0', [GUEST_COUNT_ATTR]: String(guestsOnScreen(g, state)) });
    }
    for (const s of this.#staff.values()) {
      if (!this.#connected.has(s.identity)) continue;
      await this.#pushAttributes(s.identity, staffAttributes(s, talkbackSubscribers(s, state)));
    }

    for (const identity of this.#connected) {
      const allowed = new Set(allowedTracks(identity, tracks, state).map((t) => t.sid));
      const current = this.#applied.get(identity) ?? new Set<string>();
      const toUnsubscribe = [...current].filter((sid) => !allowed.has(sid) && this.#tracks.has(sid));
      const toSubscribe = [...allowed].filter((sid) => !current.has(sid));
      if (toUnsubscribe.length) await this.control.updateSubscriptions(this.room, identity, toUnsubscribe, false).catch(() => undefined);
      if (toSubscribe.length) await this.control.updateSubscriptions(this.room, identity, toSubscribe, true).catch(() => undefined);
      this.#applied.set(identity, allowed);
    }
  }

  async #pushAttributes(identity: string, attrs: Record<string, string>): Promise<void> {
    const key = JSON.stringify(attrs);
    if (this.#pushedAttrs.get(identity) === key) return;
    await this.control.updateAttributes(this.room, identity, attrs).catch(() => undefined);
    this.#pushedAttrs.set(identity, key);
  }
}

/** One controller per live room, created on first use from the episode's program settings. */
export class RoomRegistry {
  readonly #rooms = new Map<string, Promise<RoomController | null>>();
  private readonly control: LiveKitControl;
  private readonly settingsFor: (room: string) => Promise<RoomSettings | null>;
  private readonly sinkFor: (room: string) => EventSink;

  constructor(control: LiveKitControl, settingsFor: (room: string) => Promise<RoomSettings | null>, sinkFor: (room: string) => EventSink) {
    this.control = control;
    this.settingsFor = settingsFor;
    this.sinkFor = sinkFor;
  }

  get(room: string): Promise<RoomController | null> {
    let pending = this.#rooms.get(room);
    if (!pending) {
      pending = (async () => {
        const settings = await this.settingsFor(room);
        if (!settings) return null;
        const controller = new RoomController(room, this.control, settings, this.sinkFor(room));
        await controller.load();
        return controller;
      })();
      this.#rooms.set(room, pending);
      pending.then((c) => {
        if (!c) this.#rooms.delete(room);
      }, () => this.#rooms.delete(room));
    }
    return pending;
  }

  drop(room: string): void {
    this.#rooms.delete(room);
  }

  /** Sends a message to everybody in a room (a setting the pages take live). Fails when nobody is there. */
  tell(room: string, topic: string, payload: unknown): Promise<void> {
    return this.control.sendData(room, null, topic, payload);
  }
}
