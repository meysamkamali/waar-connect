import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GATEWAY_STALE_MS } from '@waar-connect/shared';
import { newGatewayState, Report, statusOf } from './gateway.ts';

const report = {
  version: '0.1.0+abc1234',
  host: 'connect',
  sources: [{ name: 'MIXER (Program)', url: '10.0.0.12:5961', network: 'ens34', own: false }],
  returns: [
    {
      pcrId: '6f1d2c7e-0a3b-4c5d-8e9f-0a1b2c3d4e5f',
      pcrName: 'PCR 1',
      source: 'MIXER (Program)',
      state: 'publishing',
      detail: null,
      connected: true,
      video: { width: 1920, height: 1080, fps: 25 },
      audio: { channels: 2, sampleRate: 48000 },
      publish: { codec: 'h264', maxKbps: 3000, maxFps: 25 },
      since: 1_700_000_000_000,
    },
  ],
};

test('a report is accepted as the gateway sends it; an unknown state is refused', () => {
  assert.ok(Report.safeParse(report).success);
  const bad = { ...report, returns: [{ ...report.returns[0], state: 'sleeping' }] };
  assert.equal(Report.safeParse(bad).success, false);
});

test('statusOf: nothing until a report; the report with its time; gone when stale', () => {
  const state = newGatewayState();
  assert.equal(statusOf(state), null);
  state.report = Report.parse(report);
  state.seenAt = 1000;
  assert.deepEqual(statusOf(state, 1000 + GATEWAY_STALE_MS), { ...state.report, seenAt: 1000 });
  assert.equal(statusOf(state, 1001 + GATEWAY_STALE_MS), null);
});
