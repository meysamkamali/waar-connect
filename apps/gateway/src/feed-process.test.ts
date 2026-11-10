import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { FeedProcess } from './feed-process.ts';
import type { ReturnTarget } from './return-feed.ts';

// A stand-in for feed-worker: speaks the same messages, without NDI or the media library. Its
// status carries what it was last told, so the test can see the messages arrive.
const dir = mkdtempSync(join(tmpdir(), 'wc-feed-'));
const worker = join(dir, 'fake-worker.mjs');
writeFileSync(
  worker,
  `let target; let ips = [];
const status = () => ({ pcrId: target.pcrId, pcrName: target.pcrName, source: target.source, state: 'publishing', detail: 'token ' + target.token + ' ips ' + ips.join('+'), connected: true, video: null, audio: null, publish: null, mv: null, since: 1 });
process.on('message', (m) => {
  if (m.type === 'start') { target = m.target; ips = m.extraIps; setInterval(() => process.send({ type: 'status', status: status() }), 40); }
  if (m.type === 'update') target = m.target;
  if (m.type === 'discovery') ips = m.extraIps;
  if (m.type === 'stop') process.exit(0);
});
process.on('disconnect', () => process.exit(0));
`,
);
after(() => rmSync(dir, { recursive: true, force: true }));

const target = (token: string): ReturnTarget => ({ pcrId: '11111111-1111-4111-8111-111111111111', pcrName: 'PCR 1', room: 'pcr-test', source: 'MIXER (Program)', height: null, kbps: null, url: 'wss://example.invalid', token });

async function until(what: string, check: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) assert.fail(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('a feed in a process of its own: starts, takes messages, comes back when it dies, stops for good', async () => {
  const feed = new FeedProcess(target('A'), ['10.0.0.1'], { worker, restartMs: 100 });
  try {
    assert.equal(feed.status().state, 'error', 'not started: no process');
    feed.start();
    assert.equal(feed.status().state, 'starting', 'started, no report yet');
    assert.equal(feed.status().pcrName, 'PCR 1');

    await until('the first report', () => feed.status().state === 'publishing');
    assert.equal(feed.status().detail, 'token A ips 10.0.0.1', 'the start message carried the target and the addresses');
    const first = feed.pid;
    assert.ok(first, 'a process is running');

    feed.update(target('B'));
    await until('the fresh token to arrive', () => feed.status().detail === 'token B ips 10.0.0.1');
    assert.equal(feed.target.token, 'B');
    feed.setDiscovery(['10.0.0.1', '10.0.0.2']);
    await until('the new address list to arrive', () => feed.status().detail === 'token B ips 10.0.0.1+10.0.0.2');

    // The process dies (as after a hung NDI receive): it is reported, then started again with the latest target and list.
    process.kill(first, 'SIGKILL');
    await until('the end to be noticed', () => feed.status().state !== 'publishing');
    assert.match(feed.status().detail ?? '', /process (ended|is starting)/);
    await until('the restart', () => feed.status().state === 'publishing' && feed.pid !== first);
    assert.equal(feed.status().detail, 'token B ips 10.0.0.1+10.0.0.2', 'the new process got what the old one had last');
    const second = feed.pid;

    await feed.stop();
    assert.equal(feed.pid, undefined, 'stopped');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(feed.pid, undefined, 'and not started again');
    assert.notEqual(second, first);
  } finally {
    await feed.stop();
  }
});
