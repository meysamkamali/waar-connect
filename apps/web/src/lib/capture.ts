// What the phone asks its camera for, and the check of what the camera answers.
// The station's picture is 16:9. A camera is asked for a number of lines in that shape, but the sizes
// a browser is given are wishes: a camera without a 16:9 mode at the size asked answers with its
// nearest other one (a phone asked for 1080p sent a 4:3 picture, seen 2026-11-13). So the shape is
// asked for by name as well, the answer is looked at, and a picture that is not 16:9 is put right:
// first the same size cut to 16:9, then the next smaller sizes until the camera has a 16:9 one.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

export const WIDE = 16 / 9;

/** The picture heights a phone can be asked for. */
export const CAPTURE_HEIGHTS = [360, 540, 720, 1080] as const;

type Dict = Record<string, unknown>;

/** What is asked of the camera: wishes for size, rate and shape, and sets the camera must meet where it can. */
export interface CaptureConstraints {
  width: number;
  height: number;
  frameRate: number;
  aspectRatio: number;
  advanced?: Dict[];
}

/** `height` lines in 16:9 at `fps`, as wishes. */
export function captureSize(height: number, fps: number): CaptureConstraints {
  return { width: Math.round(height * WIDE), height, frameRate: fps, aspectRatio: WIDE };
}

/** Is a picture 16:9, lying or upright? (A phone held upright sends 9:16; that is the same camera picture.) */
export function isWide(width: number | undefined, height: number | undefined): boolean {
  if (!width || !height) return false;
  return Math.abs(Math.max(width, height) / Math.min(width, height) - WIDE) < 0.05;
}

/**
 * What to try, in order, when the camera's picture is not 16:9: the size asked with the shape as a
 * set the camera must meet (a browser that can cut the camera's picture then cuts it), then each
 * smaller size the same way.
 */
export function wideAttempts(height: number, fps: number): CaptureConstraints[] {
  const lower = CAPTURE_HEIGHTS.filter((h) => h < height).sort((a, b) => b - a);
  return [height, ...lower].map((h) => ({ ...captureSize(h, fps), advanced: [{ aspectRatio: WIDE }] }));
}

/** The part of a camera track this needs: what it gives now, and a new set of constraints for it. */
export interface CameraTrack {
  getSettings(): { width?: number; height?: number };
  applyConstraints(constraints: Dict): Promise<void>;
}

export interface Kept {
  /** The constraints that hold on the track now; later changes (the lens settings) must carry them along. */
  constraints: CaptureConstraints;
  /** For the producer, when the camera does not give what was asked. */
  note: string | undefined;
}

const size = (s: { width?: number; height?: number }) => `${s.width}×${s.height}`;

/**
 * Looks at what the camera gives after it was asked for `height` lines, and makes the picture 16:9
 * when it is not. A camera that already gives 16:9 is left alone.
 */
export async function keepWide(track: CameraTrack, height: number, fps: number): Promise<Kept> {
  const asked = captureSize(height, fps);
  const first = track.getSettings();
  // no size known (the browser does not say): nothing to judge
  if (!first.width || !first.height) return { constraints: asked, note: undefined };
  if (isWide(first.width, first.height)) {
    // 16:9, but fewer lines than asked: the camera's largest 16:9 picture. Nothing to put right; the producer should know.
    const lines = Math.min(first.width, first.height);
    return { constraints: asked, note: lines < height - 16 ? `This camera has no ${height}p in 16:9: it sends ${size(first)}.` : undefined };
  }
  for (const attempt of wideAttempts(height, fps)) {
    try {
      await track.applyConstraints(attempt as unknown as Dict);
    } catch {
      continue;
    }
    const now = track.getSettings();
    if (isWide(now.width, now.height)) return { constraints: attempt, note: `This camera has no ${height}p in 16:9 (it gave ${size(first)}): it sends ${size(now)}.` };
  }
  return { constraints: asked, note: `This camera gives ${size(track.getSettings())}: it has no 16:9 picture.` };
}
