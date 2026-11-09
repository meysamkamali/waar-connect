import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TrackSource } from 'livekit-server-sdk';
import { RoomController } from './controller.ts';
import type { LiveKitControl, ParticipantSnapshot, TrackSnapshot } from './livekit-control.ts';

class FakeControl implements LiveKitControl {
  participants: ParticipantSnapshot[] = [];
  attrs = new Map<string, Record<string, string>>();
  subs = new Map<string, Set<string>>();
  calls: string[] = [];
  data: { to: string[] | null; topic: string; payload: unknown }[] = [];
  removed: string[] = [];

  async listParticipants(): Promise<ParticipantSnapshot[]> {
    return this.participants;
  }
  async updateAttributes(_room: string, identity: string, attributes: Record<string, string>): Promise<void> {
    this.calls.push(`attrs ${identity}`);
    this.attrs.set(identity, { ...(this.attrs.get(identity) ?? {}), ...attributes });
  }
  async updateSubscriptions(_room: string, identity: string, sids: string[], subscribe: boolean): Promise<void> {
    this.calls.push(`${subscribe ? 'sub' : 'unsub'} ${identity} ${[...sids].sort().join(',')}`);
    const set = this.subs.get(identity) ?? new Set<string>();
    for (const s of sids) subscribe ? set.add(s) : set.delete(s);
    this.subs.set(identity, set);
  }
  async sendData(_room: string, to: string[] | null, topic: string, payload: unknown): Promise<void> {
    this.data.push({ to, topic, payload });
  }
  async removeParticipant(_room: string, identity: string): Promise<void> {
    this.removed.push(identity);
  }
  subsOf(identity: string): string[] {
    return [...(this.subs.get(identity) ?? [])].sort();
  }
  /** LiveKit drops subscriptions itself when a publisher's tracks disappear; the fake must be told. */
  forget(sids: string[]): void {
    for (const set of this.subs.values()) for (const sid of sids) set.delete(sid);
  }
}

const track = (sid: string, source: TrackSource, name = ''): TrackSnapshot => ({ sid, name, source, muted: false });
const join = (identity: string, tracks: TrackSnapshot[] = [], attributes: Record<string, string> = {}): ParticipantSnapshot => ({ identity, name: identity, attributes, tracks });

const A = 'guest:a';
const B = 'guest:b';
const PROD = 'producer:p';
const ENG = 'engineer:e';
const OUT1 = 'out:slot-1';

async function roomWithEveryone(settings = { slots: 4, ifbAllowed: true }) {
  const fake = new FakeControl();
  const c = new RoomController('ep-1', fake, settings);
  await c.load();
  await c.onParticipantJoined(join(A, [track('a-cam', TrackSource.CAMERA), track('a-mic', TrackSource.MICROPHONE)]));
  await c.onParticipantJoined(join(B, [track('b-cam', TrackSource.CAMERA), track('b-mic', TrackSource.MICROPHONE)]));
  await c.onParticipantJoined(join(PROD, [track('p-talk', TrackSource.MICROPHONE), track('p-cam', TrackSource.CAMERA)]));
  await c.onParticipantJoined(join(ENG, [track('e-talk', TrackSource.MICROPHONE)]));
  await c.onParticipantJoined(join(OUT1));
  await c.onParticipantJoined(join('studio', [track('pgm-v', TrackSource.CAMERA), track('pgm-a', TrackSource.MICROPHONE)]));
  return { fake, c };
}

describe('room controller', () => {
  it('new guests land in the lobby with attributes pushed and nothing subscribed', async () => {
    const { fake, c } = await roomWithEveryone();
    assert.equal(fake.attrs.get(A)?.['wc.place'], 'lobby');
    assert.deepEqual(fake.subsOf(A), []);
    assert.deepEqual(fake.subsOf(OUT1), []);
    // staff see every guest in every place, and the program picture (its sound is on the PCR's monitors)
    assert.deepEqual(fake.subsOf(PROD), ['a-cam', 'a-mic', 'b-cam', 'b-mic', 'pgm-v']);
    assert.deepEqual(c.snapshot().guests.map((g) => g.place), ['lobby', 'lobby']);
  });

  it('admit, talk, table, hand-off and bring back move subscriptions as the matrix says', async () => {
    const { fake, c } = await roomWithEveryone();
    await c.act({ type: 'admit', guest: A }, PROD);
    await c.act({ type: 'admit', guest: B }, PROD);
    assert.equal(fake.attrs.get(A)?.['wc.place'], 'green');
    assert.deepEqual(fake.subsOf(A), []);

    await c.act({ type: 'talk', staff: PROD, to: 'all' }, PROD);
    assert.deepEqual(fake.subsOf(A), ['p-talk']);
    assert.deepEqual(fake.subsOf(B), ['p-talk']);
    assert.equal(fake.attrs.get(PROD)?.['wc.talk_allowed'], `${A},${B}`);

    await c.act({ type: 'table', guest: A, table: 't1' }, PROD);
    await c.act({ type: 'table', guest: B, table: 't1' }, PROD);
    assert.deepEqual(fake.subsOf(A), ['b-cam', 'b-mic', 'p-talk']);

    await c.act({ type: 'slot', guest: A, slot: 1 }, PROD);
    await c.act({ type: 'ready', guest: A, on: true }, ENG);
    await c.act({ type: 'handoff', guest: A }, PROD);

    const a = c.snapshot().guests.find((g) => g.identity === A)!;
    assert.equal(a.place, 'studio');
    assert.equal(a.tally, 'standby');
    assert.equal(a.table, null);
    assert.deepEqual(fake.subsOf(A), ['pgm-a', 'pgm-v']); // no more producer, no more table
    assert.deepEqual(fake.subsOf(OUT1), ['a-cam', 'a-mic']);
    assert.deepEqual(fake.subsOf(B), ['p-talk']); // B lost A when A left the table
    assert.equal(fake.attrs.get(A)?.['wc.tally'], 'standby');

    await c.act({ type: 'tally', guest: A, tally: 'onair' }, PROD);
    assert.equal(fake.attrs.get(A)?.['wc.tally'], 'onair');

    await c.act({ type: 'bringBack', guest: A }, PROD);
    assert.deepEqual(fake.subsOf(OUT1), []);
    assert.deepEqual(fake.subsOf(A), ['p-talk']);
    assert.equal(fake.attrs.get(A)?.['wc.place'], 'green');
    assert.equal(fake.attrs.get(A)?.['wc.tally'], 'off');
  });

  it('IFB override lets only the engineer reach a studio guest, and only when allowed', async () => {
    const { fake, c } = await roomWithEveryone();
    await c.act({ type: 'admit', guest: A }, PROD);
    await c.act({ type: 'slot', guest: A, slot: 2 }, PROD);
    await c.act({ type: 'ready', guest: A, on: true }, ENG);
    await c.act({ type: 'handoff', guest: A }, PROD);
    await c.act({ type: 'talk', staff: ENG, to: 'all' }, ENG);
    await c.act({ type: 'talk', staff: PROD, to: 'all' }, PROD);
    assert.deepEqual(fake.subsOf(A), ['pgm-a', 'pgm-v']);
    await c.act({ type: 'ifb', guest: A, on: true }, ENG);
    assert.deepEqual(fake.subsOf(A), ['e-talk', 'pgm-a', 'pgm-v']);
    assert.equal(fake.attrs.get(A)?.['wc.ifb'], '1');
    await c.act({ type: 'ifb', guest: A, on: false }, ENG);
    assert.deepEqual(fake.subsOf(A), ['pgm-a', 'pgm-v']);

    const strict = await roomWithEveryone({ slots: 4, ifbAllowed: false });
    await strict.c.act({ type: 'admit', guest: A }, PROD);
    await strict.c.act({ type: 'slot', guest: A, slot: 1 }, PROD);
    await strict.c.act({ type: 'handoff', guest: A }, PROD);
    await assert.rejects(strict.c.act({ type: 'ifb', guest: A, on: true }, ENG), /switched off/);
  });

  it('a guest who drops keeps place, slot and tally for a reconnect', async () => {
    const { fake, c } = await roomWithEveryone();
    await c.act({ type: 'admit', guest: A }, PROD);
    await c.act({ type: 'slot', guest: A, slot: 1 }, PROD);
    await c.act({ type: 'ready', guest: A, on: true }, ENG);
    await c.act({ type: 'handoff', guest: A }, PROD);
    await c.act({ type: 'tally', guest: A, tally: 'onair' }, PROD);
    await c.onParticipantLeft(A);
    fake.forget(['a-cam', 'a-mic']);
    assert.deepEqual(fake.subsOf(OUT1), []);
    assert.equal(c.snapshot().guests.length, 1);
    assert.ok(!c.snapshot().tracks.some((t) => t.publisher === A));
    await c.onParticipantJoined(join(A, [track('a-cam2', TrackSource.CAMERA), track('a-mic2', TrackSource.MICROPHONE)]));
    const a = c.snapshot().guests.find((g) => g.identity === A)!;
    assert.equal(a.place, 'studio');
    assert.equal(a.slot, 1);
    assert.equal(a.tally, 'onair');
    assert.deepEqual(fake.subsOf(OUT1), ['a-cam2', 'a-mic2']);
  });

  it('a returning guest whose slot was given away waits in the green room', async () => {
    const { c } = await roomWithEveryone();
    await c.act({ type: 'admit', guest: A }, PROD);
    await c.act({ type: 'handoff', guest: A }, PROD); // first free slot: 1
    await c.onParticipantLeft(A);
    await c.act({ type: 'admit', guest: B }, PROD);
    await c.act({ type: 'handoff', guest: B }, PROD); // slot 1 is free while A is away
    assert.equal(c.snapshot().guests.find((g) => g.identity === B)?.slot, 1);
    await c.onParticipantJoined(join(A, [track('a-cam2', TrackSource.CAMERA), track('a-mic2', TrackSource.MICROPHONE)]));
    const a = c.snapshot().guests.find((g) => g.identity === A)!;
    assert.equal(a.place, 'green');
    assert.equal(a.slot, null);
    assert.equal(c.snapshot().guests.find((g) => g.identity === B)?.slot, 1);
  });

  it('rebuilds from attributes after a restart', async () => {
    const fake = new FakeControl();
    fake.participants = [
      join(A, [track('a-cam', TrackSource.CAMERA)], { 'wc.place': 'studio', 'wc.tally': 'onair', 'wc.slot': '3', 'wc.table': '', 'wc.studio_sound': '0', 'wc.program': '0', 'wc.ready': '1', 'wc.ifb': '1' }),
      join(PROD, [track('p-talk', TrackSource.MICROPHONE)], { 'wc.role': 'producer', 'wc.talk_to': 'all', 'wc.face_to': '', 'wc.talk_allowed': '' }),
      join('out:slot-3'),
    ];
    const c = new RoomController('ep-1', fake, { slots: 4, ifbAllowed: true });
    await c.load();
    const snap = c.snapshot();
    assert.equal(snap.guests[0]?.place, 'studio');
    assert.equal(snap.guests[0]?.slot, 3);
    assert.deepEqual(snap.ifbOverride, [A]);
    assert.equal(snap.staff[0]?.talkTo, 'all');
    assert.deepEqual(fake.subsOf('out:slot-3'), ['a-cam']);
  });

  it('slots are exclusive, bounded and locked while on the studio side', async () => {
    const { c } = await roomWithEveryone({ slots: 2, ifbAllowed: false });
    await c.act({ type: 'admit', guest: A }, PROD);
    await c.act({ type: 'admit', guest: B }, PROD);
    await assert.rejects(c.act({ type: 'slot', guest: A, slot: 3 }, PROD), /1 to 2/);
    await c.act({ type: 'slot', guest: A, slot: 1 }, PROD);
    await c.act({ type: 'slot', guest: B, slot: 1 }, PROD); // takes it over
    assert.equal(c.snapshot().guests.find((g) => g.identity === A)?.slot, null);
    await c.act({ type: 'handoff', guest: B }, PROD);
    await assert.rejects(c.act({ type: 'slot', guest: A, slot: 1 }, PROD), /studio side/);
    await assert.rejects(c.act({ type: 'slot', guest: B, slot: 2 }, PROD), /Bring the guest back/);
  });

  it('cues and commands go to the right identities; kick removes the participant', async () => {
    const { fake, c } = await roomWithEveryone();
    await c.act({ type: 'admit', guest: A }, PROD);
    await c.act({ type: 'cue', to: A, text: ' 30 seconds ' }, PROD);
    await c.act({ type: 'cue', to: 'all', text: 'Wrap' }, PROD);
    await c.act({ type: 'command', guest: B, command: { quality: '540p' } }, ENG);
    assert.deepEqual(fake.data[0], { to: [A], topic: 'wc.cue', payload: { text: '30 seconds', from: PROD, at: (fake.data[0]!.payload as { at: number }).at } });
    assert.deepEqual(fake.data[1]!.to!.sort(), [A, B]);
    assert.equal(fake.data[2]!.topic, 'wc.cmd');
    await assert.rejects(c.act({ type: 'cue', to: A, text: '  ' }, PROD), /needs text/);
    await c.act({ type: 'kick', guest: B }, PROD);
    assert.deepEqual(fake.removed, [B]);
    assert.equal(c.snapshot().guests.length, 1);
  });

  it('talkback never reaches outputs, the studio return or monitors whatever happens', async () => {
    const { fake, c } = await roomWithEveryone();
    await c.onParticipantJoined(join('monitor:m'));
    await c.act({ type: 'admit', guest: A }, PROD);
    await c.act({ type: 'talk', staff: PROD, to: 'all' }, PROD);
    await c.act({ type: 'talk', staff: ENG, to: [A] }, ENG);
    await c.act({ type: 'slot', guest: A, slot: 1 }, PROD);
    await c.act({ type: 'ready', guest: A, on: true }, ENG);
    await c.act({ type: 'handoff', guest: A }, PROD);
    await c.act({ type: 'ifb', guest: A, on: true }, ENG);
    for (const id of [OUT1, 'studio', 'monitor:m']) for (const sid of fake.subsOf(id)) assert.ok(!sid.endsWith('talk'), `${id} got ${sid}`);
    assert.deepEqual(fake.subsOf('studio'), []);
  });
  it('send to studio takes the first free slot and bring back frees it', async () => {
    const { fake, c } = await roomWithEveryone({ slots: 2, ifbAllowed: false });
    await c.act({ type: 'admit', guest: A }, PROD);
    await c.act({ type: 'admit', guest: B }, PROD);
    await c.act({ type: 'handoff', guest: A }, PROD);
    assert.equal(c.snapshot().guests.find((g) => g.identity === A)?.slot, 1);
    assert.deepEqual(fake.subsOf(OUT1), ['a-cam', 'a-mic']);
    await c.act({ type: 'handoff', guest: B }, PROD);
    assert.equal(c.snapshot().guests.find((g) => g.identity === B)?.slot, 2);
    await c.act({ type: 'bringBack', guest: A }, PROD);
    assert.equal(c.snapshot().guests.find((g) => g.identity === A)?.slot, null);
    await c.onParticipantJoined(join('guest:c', [track('c-cam', TrackSource.CAMERA)]));
    await c.act({ type: 'admit', guest: 'guest:c' }, PROD);
    await c.act({ type: 'handoff', guest: 'guest:c' }, PROD);
    assert.equal(c.snapshot().guests.find((g) => g.identity === 'guest:c')?.slot, 1);
    await assert.rejects(c.act({ type: 'handoff', guest: A }, PROD), /slots are taken/);
  });
});
