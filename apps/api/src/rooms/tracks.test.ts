import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TrackSource } from 'livekit-server-sdk';
import { routedSource } from './tracks.ts';

describe('routedSource', () => {
  it('maps by publisher role', () => {
    assert.equal(routedSource('guest:a', TrackSource.CAMERA), 'camera');
    assert.equal(routedSource('guest:a', TrackSource.MICROPHONE), 'microphone');
    assert.equal(routedSource('producer:p', TrackSource.MICROPHONE), 'talkback');
    assert.equal(routedSource('engineer:e', TrackSource.CAMERA), 'camera');
    assert.equal(routedSource('studio', TrackSource.CAMERA), 'program-video');
    assert.equal(routedSource('studio', TrackSource.MICROPHONE), 'program-audio');
  });
  it('ignores screen shares, outputs and unknown identities', () => {
    assert.equal(routedSource('guest:a', TrackSource.SCREEN_SHARE), null);
    assert.equal(routedSource('out:slot-1', TrackSource.CAMERA), null);
    assert.equal(routedSource('nobody', TrackSource.CAMERA), null);
  });
});
