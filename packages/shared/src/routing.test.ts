import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultGuestState, outputIdentity, STUDIO_IDENTITY, type GuestState, type PublishedTrack, type RoomState, type StaffState } from './model.ts';
import { allowedTracks, canReceive, subscriptionPlan, talkbackSubscribers } from './routing.ts';

// ---- fixtures ------------------------------------------------------------------------------------

const A = 'guest:ali';
const B = 'guest:bahar';
const C = 'guest:ciwan';
const PROD = 'producer:dilan';
const ENG = 'engineer:hemin';
const OUT1 = outputIdentity(1);
const OUT2 = outputIdentity(2);
const MON = 'monitor:x1';

function guest(identity: string, over: Partial<GuestState> = {}): GuestState {
  return { ...defaultGuestState(identity), ...over };
}

function staff(identity: string, role: StaffState['role'], over: Partial<StaffState> = {}): StaffState {
  return { identity, role, talkTo: 'none', faceTo: null, ...over };
}

const tracks: PublishedTrack[] = [
  { sid: 'a-cam', publisher: A, source: 'camera' },
  { sid: 'a-mic', publisher: A, source: 'microphone' },
  { sid: 'b-cam', publisher: B, source: 'camera' },
  { sid: 'b-mic', publisher: B, source: 'microphone' },
  { sid: 'c-cam', publisher: C, source: 'camera' },
  { sid: 'c-mic', publisher: C, source: 'microphone' },
  { sid: 'prod-talk', publisher: PROD, source: 'talkback' },
  { sid: 'prod-cam', publisher: PROD, source: 'camera' },
  { sid: 'eng-talk', publisher: ENG, source: 'talkback' },
  { sid: 'pgm-v', publisher: STUDIO_IDENTITY, source: 'program-video' },
  { sid: 'pgm-a', publisher: STUDIO_IDENTITY, source: 'program-audio' },
];

function state(over: Partial<RoomState> = {}): RoomState {
  return {
    guests: [guest(A, { place: 'green' }), guest(B, { place: 'green' }), guest(C, { place: 'lobby' })],
    staff: [staff(PROD, 'producer'), staff(ENG, 'engineer')],
    outputs: [
      { identity: OUT1, slot: 1 },
      { identity: OUT2, slot: 2 },
    ],
    ifbOverride: [],
    ...over,
  };
}

const sids = (subscriber: string, s: RoomState) => allowedTracks(subscriber, tracks, s).map((t) => t.sid).sort();

// ---- the matrix ----------------------------------------------------------------------------------

describe('lobby', () => {
  it('a guest in the lobby receives nothing', () => {
    assert.deepEqual(sids(C, state()), []);
  });
  it('a guest who left receives nothing', () => {
    assert.deepEqual(sids(C, state({ guests: [guest(C, { place: 'left' })] })), []);
  });
});

describe('green room', () => {
  it('hears a producer who talks to them, and nothing else by default', () => {
    const s = state({ staff: [staff(PROD, 'producer', { talkTo: [A] }), staff(ENG, 'engineer')] });
    assert.deepEqual(sids(A, s), ['prod-talk']);
    assert.deepEqual(sids(B, s), []);
  });
  it('hears producer and engineer at once when both talk', () => {
    const s = state({ staff: [staff(PROD, 'producer', { talkTo: 'all' }), staff(ENG, 'engineer', { talkTo: [A] })] });
    assert.deepEqual(sids(A, s), ['eng-talk', 'prod-talk']);
    assert.deepEqual(sids(B, s), ['prod-talk']);
  });
  it('studio sound and program picture are separate switches', () => {
    const s = state({ guests: [guest(A, { place: 'green', studioSound: true }), guest(B, { place: 'green', program: true })] });
    assert.deepEqual(sids(A, s), ['pgm-a']);
    assert.deepEqual(sids(B, s), ['pgm-v']);
  });
  it('a guest sees and hears the green-room guests the producer picked for them, one way', () => {
    const s = state({
      guests: [
        guest(A, { place: 'green', peers: [B] }),
        guest(B, { place: 'green', peers: [A, C] }),
        guest(C, { place: 'green' }),
      ],
    });
    assert.deepEqual(sids(A, s), ['b-cam', 'b-mic']);
    assert.deepEqual(sids(B, s), ['a-cam', 'a-mic', 'c-cam', 'c-mic']);
    assert.deepEqual(sids(C, s), []);
  });
  it('a picked guest is received while both are in the green room only', () => {
    const s = state({ guests: [guest(A, { place: 'green', peers: [B] }), guest(B, { place: 'studio', peers: [A], slot: 1 })] });
    assert.deepEqual(sids(A, s), []);
    assert.deepEqual(sids(B, s), ['pgm-a', 'pgm-v']);
  });
  it('face to face sends the producer camera to that guest only', () => {
    const s = state({ staff: [staff(PROD, 'producer', { faceTo: A, talkTo: [A] }), staff(ENG, 'engineer')] });
    assert.deepEqual(sids(A, s), ['prod-cam', 'prod-talk']);
    assert.deepEqual(sids(B, s), []);
  });
});

describe('studio', () => {
  const inStudio = () =>
    state({
      guests: [guest(A, { place: 'studio', slot: 1, tally: 'onair' }), guest(B, { place: 'studio', slot: 2 }), guest(C, { place: 'green' })],
      staff: [staff(PROD, 'producer', { talkTo: 'all', faceTo: A }), staff(ENG, 'engineer', { talkTo: 'all' })],
    });
  it('hears the program and the other studio guests, never producer or engineer', () => {
    assert.deepEqual(sids(A, inStudio()), ['b-cam', 'b-mic', 'pgm-a', 'pgm-v']);
  });
  it('does not hear green-room guests', () => {
    assert.ok(!sids(A, inStudio()).includes('c-mic'));
  });
  it('IFB override lets only the engineer through', () => {
    const s = { ...inStudio(), ifbOverride: [A] };
    assert.ok(sids(A, s).includes('eng-talk'));
    assert.ok(!sids(A, s).includes('prod-talk'));
    assert.ok(!sids(B, s).includes('eng-talk'));
  });
});

describe('outputs', () => {
  it('receive only the camera and microphone of the studio guest on their slot', () => {
    const s = state({
      guests: [guest(A, { place: 'studio', slot: 1 }), guest(B, { place: 'green', slot: 2 }), guest(C, { place: 'studio', slot: 3 })],
      staff: [staff(PROD, 'producer', { talkTo: 'all' }), staff(ENG, 'engineer', { talkTo: 'all' })],
    });
    assert.deepEqual(sids(OUT1, s), ['a-cam', 'a-mic']);
    assert.deepEqual(sids(OUT2, s), []); // slot 2 guest is still in the green room: slate
  });
  it('never receive talkback or program', () => {
    const s = state({ guests: [guest(A, { place: 'studio', slot: 1 })], staff: [staff(ENG, 'engineer', { talkTo: 'all' })], ifbOverride: [A] });
    for (const sid of sids(OUT1, s)) assert.ok(!sid.includes('talk') && !sid.startsWith('pgm'));
  });
});

describe('staff, monitor, studio return', () => {
  it('producer and engineer see every guest in every place and the program picture, never talkback or the program sound', () => {
    const s = state({ staff: [staff(PROD, 'producer', { talkTo: 'all' }), staff(ENG, 'engineer', { talkTo: 'all' })] });
    assert.deepEqual(sids(PROD, s), ['a-cam', 'a-mic', 'b-cam', 'b-mic', 'c-cam', 'c-mic', 'pgm-v']);
    assert.deepEqual(sids(ENG, s), sids(PROD, s));
  });
  it('a monitor sees everything except talkback', () => {
    const s = state({ staff: [staff(PROD, 'producer', { talkTo: 'all' })] });
    assert.ok(!sids(MON, s).includes('prod-talk'));
    assert.ok(sids(MON, s).includes('c-cam'));
  });
  it('the studio return receives nothing', () => {
    assert.deepEqual(sids(STUDIO_IDENTITY, state()), []);
  });
  it('an unknown identity receives nothing', () => {
    assert.deepEqual(sids('hacker:1', state()), []);
    assert.equal(canReceive('guest:unknown', tracks[0]!, state()), false);
  });
});

describe('invariants over many states', () => {
  const places = ['lobby', 'green', 'studio', 'left'] as const;
  const states: RoomState[] = [];
  for (const pa of places) {
    for (const pb of places) {
      for (const ifb of [[], [A]]) {
        states.push(
          state({
            guests: [guest(A, { place: pa, slot: 1, peers: [B] }), guest(B, { place: pb, slot: 2, peers: [A] })],
            staff: [staff(PROD, 'producer', { talkTo: 'all', faceTo: A }), staff(ENG, 'engineer', { talkTo: 'all' })],
            ifbOverride: ifb,
          }),
        );
      }
    }
  }
  it('talkback never reaches an output, the studio return or a monitor', () => {
    for (const s of states) {
      for (const sub of [OUT1, OUT2, STUDIO_IDENTITY, MON]) {
        for (const sid of sids(sub, s)) assert.ok(!sid.endsWith('-talk'), `${sub} got ${sid}`);
      }
    }
  });
  it('nobody receives their own track', () => {
    for (const s of states) {
      for (const t of tracks) assert.equal(canReceive(t.publisher, t, s), false);
    }
  });
  it('a studio guest never hears the producer', () => {
    for (const s of states) {
      for (const g of s.guests) if (g.place === 'studio') assert.ok(!sids(g.identity, s).includes('prod-talk'));
    }
  });
  it('the plan agrees with canReceive for every participant', () => {
    for (const s of states) {
      const plan = subscriptionPlan(s, tracks);
      for (const [sub, list] of plan) assert.deepEqual([...list].sort(), sids(sub, s));
    }
  });
});

describe('talkback permissions', () => {
  it('list the green-room guests addressed, plus IFB guests for an engineer', () => {
    const s = state({
      guests: [guest(A, { place: 'green' }), guest(B, { place: 'studio', slot: 1 }), guest(C, { place: 'lobby' })],
      staff: [staff(PROD, 'producer', { talkTo: 'all' }), staff(ENG, 'engineer', { talkTo: 'all' })],
      ifbOverride: [B],
    });
    assert.deepEqual(talkbackSubscribers(s.staff[0]!, s), [A]);
    assert.deepEqual(talkbackSubscribers(s.staff[1]!, s).sort(), [A, B]);
  });
});
