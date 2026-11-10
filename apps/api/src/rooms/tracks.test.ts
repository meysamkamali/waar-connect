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
  it('tells the burned-in return from the clean one by the track name, for the return feed only', () => {
    assert.equal(routedSource('studio', TrackSource.CAMERA, 'program'), 'program-video');
    assert.equal(routedSource('studio', TrackSource.CAMERA, 'program-mv'), 'program-mv');
    assert.equal(routedSource('guest:a', TrackSource.CAMERA, 'program-mv'), 'camera', 'a guest cannot pose as it');
  });
  it('ignores screen shares, outputs and unknown identities', () => {
    assert.equal(routedSource('guest:a', TrackSource.SCREEN_SHARE), null);
    assert.equal(routedSource('out:slot-1', TrackSource.CAMERA), null);
    assert.equal(routedSource('nobody', TrackSource.CAMERA), null);
  });
});
