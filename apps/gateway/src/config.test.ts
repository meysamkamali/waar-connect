import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './config.ts';

const base = { GATEWAY_TOKEN: 'a-token-of-at-least-sixteen' };

test('defaults: local API, 540p at 1500 kbit/s, 30 fps, channels 1 and 2, no extra IPs', () => {
  const cfg = loadConfig(base);
  assert.equal(cfg.API_URL, 'http://127.0.0.1:8788');
  assert.equal(cfg.RETURN_MAX_KBPS, 1500);
  assert.equal(cfg.RETURN_HEIGHT, 540);
  assert.equal(cfg.RETURN_MAX_FPS, 30);
  assert.deepEqual(cfg.audioChannels, [1, 2]);
  assert.deepEqual(cfg.extraIps, []);
  assert.ok(cfg.GATEWAY_NAME.length > 0);
});

test('channels and extra IPs are parsed; spaces around IPs are fine', () => {
  const cfg = loadConfig({ ...base, RETURN_AUDIO_CHANNELS: '3,4', NDI_EXTRA_IPS: '10.1.1.101, 10.0.0.12' });
  assert.deepEqual(cfg.audioChannels, [3, 4]);
  assert.deepEqual(cfg.extraIps, ['10.1.1.101', '10.0.0.12']);
});

test('a short token or a bad channel list is refused with a readable message', () => {
  assert.throws(() => loadConfig({ GATEWAY_TOKEN: 'short' }), /GATEWAY_TOKEN/);
  assert.throws(() => loadConfig({ ...base, RETURN_AUDIO_CHANNELS: 'left,right' }), /RETURN_AUDIO_CHANNELS/);
  assert.throws(() => loadConfig({ ...base, RETURN_MAX_KBPS: '100' }), /RETURN_MAX_KBPS/);
  assert.throws(() => loadConfig({ ...base, RETURN_HEIGHT: '600' }), /RETURN_HEIGHT/);
  assert.equal(loadConfig({ ...base, RETURN_HEIGHT: '0' }).RETURN_HEIGHT, 0);
});

test('feeds run in processes of their own unless told to stay inline', () => {
  assert.equal(loadConfig(base).GATEWAY_FEEDS, 'process');
  assert.equal(loadConfig({ ...base, GATEWAY_FEEDS: 'inline' }).GATEWAY_FEEDS, 'inline');
  assert.throws(() => loadConfig({ ...base, GATEWAY_FEEDS: 'threads' }), /GATEWAY_FEEDS/);
});
