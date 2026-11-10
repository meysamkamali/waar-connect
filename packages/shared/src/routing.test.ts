import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultGuestState, outputIdentity, STUDIO_IDENTITY, type GuestState, type PublishedTrack, type RoomState, type StaffState } from './model.ts';
import { allowedTracks, canReceive, subscriptionPlan, talkbackSubscribers, wantsBurnIn } from './routing.ts';

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
  it('multiview: the guests ticked MV see and hear each other; the rest of the green room is outside', () => {
    const s = state({ guests: [guest(A, { place: 'green', mv: true }), guest(B, { place: 'green', mv: true }), guest(C, { place: 'green' })] });
    assert.deepEqual(sids(A, s), ['b-cam', 'b-mic']);
    assert.deepEqual(sids(B, s), ['a-cam', 'a-mic']);
    assert.deepEqual(sids(C, s), [], 'not ticked: sees nobody');
    const alone = state({ guests: [guest(A, { place: 'green', mv: true }), guest(B, { place: 'green' })] });
    assert.deepEqual(sids(A, alone), [], 'a group of one');
  });
  it('multiview counts in the green room only', () => {
    const s = state({ guests: [guest(A, { place: 'green', mv: true }), guest(B, { place: 'studio', mv: true, slot: 1 })] });
    assert.deepEqual(sids(A, s), []);
    assert.deepEqual(sids(B, s), ['pgm-a', 'pgm-v']);
  });
  it('talking to one multiview guest is talking to the whole group, and to nobody outside it', () => {
    const guests = [guest(A, { place: 'green', mv: true }), guest(B, { place: 'green', mv: true }), guest(C, { place: 'green' })];
    const s = state({ guests, staff: [staff(PROD, 'producer', { talkTo: [A] }), staff(ENG, 'engineer')] });
    assert.ok(sids(A, s).includes('prod-talk'));
    assert.ok(sids(B, s).includes('prod-talk'), 'B is in the group with A');
    assert.ok(!sids(C, s).includes('prod-talk'));
    assert.deepEqual(talkbackSubscribers(s.staff[0]!, s).sort(), [A, B], 'the talk track lets the whole group in');
    // talking to a guest outside the group stays with that guest
    const outside = state({ guests, staff: [staff(PROD, 'producer', { talkTo: [C] }), staff(ENG, 'engineer')] });
    assert.ok(!sids(A, outside).includes('prod-talk'));
    assert.ok(sids(C, outside).includes('prod-talk'));
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
  it('the producer sees every guest in every place and the program picture, never talkback or the program sound', () => {
    const s = state({ staff: [staff(PROD, 'producer', { talkTo: 'all' }), staff(ENG, 'engineer', { talkTo: 'all' })] });
    assert.deepEqual(sids(PROD, s), ['a-cam', 'a-mic', 'b-cam', 'b-mic', 'c-cam', 'c-mic', 'pgm-v']);
  });
  it('the engineer gets the same, plus the producer\'s talk and face camera, and still no program sound', () => {
    const s = state({ staff: [staff(PROD, 'producer', { talkTo: 'all' }), staff(ENG, 'engineer', { talkTo: 'all' })] });
    assert.deepEqual(sids(ENG, s), ['a-cam', 'a-mic', 'b-cam', 'b-mic', 'c-cam', 'c-mic', 'pgm-v', 'prod-cam', 'prod-talk']);
    // a second producer hears and sees nothing of the first, and an engineer nothing of another engineer
    const two = state({ staff: [staff(PROD, 'producer'), staff('producer:second', 'producer'), staff(ENG, 'engineer'), staff('engineer:second', 'engineer')] });
    assert.ok(!sids('producer:second', two).some((sid) => sid.startsWith('prod-')));
    assert.ok(!sids('engineer:second', two).includes('eng-talk'));
  });
  it('a monitor sees everything except talkback', () => {
    const s = state({ staff: [staff(PROD, 'producer', { talkTo: 'all' })] });
    assert.ok(!sids(MON, s).includes('prod-talk'));
    assert.ok(sids(MON, s).includes('c-cam'));
  });
  it('the studio return receives nothing in a room without a multiview', () => {
    assert.deepEqual(sids(STUDIO_IDENTITY, state()), []);
  });
  it('an unknown identity receives nothing', () => {
    assert.deepEqual(sids('hacker:1', state()), []);
    assert.equal(canReceive('guest:unknown', tracks[0]!, state()), false);
  });
});

describe('multiview burned into the return', () => {
  const D = 'guest:dara';
  const burned: PublishedTrack[] = [...tracks, { sid: 'pgm-mv', publisher: STUDIO_IDENTITY, source: 'program-mv' }];
  const got = (subscriber: string, list: readonly PublishedTrack[], s: RoomState) => allowedTracks(subscriber, list, s).map((t) => t.sid).sort();
  // A and B are in the multiview, A watches Studio, B is on Black; C is in the green room outside the group.
  const room = (over: Partial<RoomState> = {}) =>
    state({ guests: [guest(A, { place: 'green', mv: true, program: true }), guest(B, { place: 'green', mv: true }), guest(C, { place: 'green', program: true })], ...over });

  it('is wanted only with two or more multiview guests, one of them watching Studio', () => {
    assert.equal(wantsBurnIn(room()), true);
    assert.equal(wantsBurnIn(state({ guests: [guest(A, { place: 'green', mv: true, program: true }), guest(B, { place: 'green' })] })), false, 'a group of one');
    assert.equal(wantsBurnIn(state({ guests: [guest(A, { place: 'green', mv: true }), guest(B, { place: 'green', mv: true })] })), false, 'nobody watches Studio');
    assert.equal(wantsBurnIn(state({ guests: [guest(A, { place: 'studio', mv: true, program: true, slot: 1 }), guest(B, { place: 'green', mv: true })] })), false, 'the studio is not the green room');
  });
  it('the return feed receives the cameras of the group, nothing else, and only while it is wanted', () => {
    assert.deepEqual(got(STUDIO_IDENTITY, tracks, room()), ['a-cam', 'b-cam']);
    assert.deepEqual(got(STUDIO_IDENTITY, burned, room()), ['a-cam', 'b-cam']);
    assert.deepEqual(got(STUDIO_IDENTITY, tracks, state({ guests: [guest(A, { place: 'green', mv: true }), guest(B, { place: 'green', mv: true })] })), []);
    assert.deepEqual(got(STUDIO_IDENTITY, tracks, state()), []);
  });
  it('before the burned-in copy exists, the group gets each other directly as before', () => {
    assert.deepEqual(got(A, tracks, room()), ['b-cam', 'b-mic', 'pgm-v']);
    assert.deepEqual(got(B, tracks, room()), ['a-cam', 'a-mic']);
  });
  it('once it exists, a multiview guest on Studio gets that one picture: no clean return, no cameras, the sound still direct', () => {
    assert.deepEqual(got(A, burned, room()), ['b-mic', 'pgm-mv']);
  });
  it('a multiview guest on Black keeps the small pictures: there is no return to burn into', () => {
    assert.deepEqual(got(B, burned, room()), ['a-cam', 'a-mic']);
  });
  it('nobody else ever gets the burned-in copy', () => {
    const s = room({ guests: [...room().guests, guest(D, { place: 'studio', slot: 1, mv: true, program: true })], outputs: [{ identity: OUT1, slot: 1 }] });
    assert.deepEqual(got(C, burned, s), ['pgm-v'], 'a green-room guest outside the group gets the clean return');
    assert.ok(got(D, burned, s).includes('pgm-v') && !got(D, burned, s).includes('pgm-mv'), 'a guest in the studio gets the clean return');
    for (const sub of [PROD, ENG, MON, OUT1]) assert.ok(!got(sub, burned, s).includes('pgm-mv'), `${sub} must not get it`);
    assert.ok(got(PROD, burned, s).includes('pgm-v'));
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
            guests: [guest(A, { place: pa, slot: 1, mv: true }), guest(B, { place: pb, slot: 2, mv: true })],
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
