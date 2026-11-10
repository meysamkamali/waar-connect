// Full screen for the guest's page. Browsers only allow it from a touch or click, and an iPhone's
// Safari does not offer it to pages at all (only to a video element), so every call here may do
// nothing; the page must work the same without it.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

type FsDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = (): FsDocument => document as FsDocument;
const root = (): FsElement => document.documentElement as FsElement;

/** Can this browser put a page full screen at all? False on an iPhone. */
export function canFullscreen(): boolean {
  const d = doc();
  const allowed = d.fullscreenEnabled ?? d.webkitFullscreenEnabled ?? false;
  return allowed && typeof (root().requestFullscreen ?? root().webkitRequestFullscreen) === 'function';
}

export function isFullscreen(): boolean {
  const d = doc();
  return (d.fullscreenElement ?? d.webkitFullscreenElement ?? null) !== null;
}

/** Asks for full screen; false when the browser refuses (no touch yet, not supported). */
export async function enterFullscreen(): Promise<boolean> {
  if (!canFullscreen() || isFullscreen()) return isFullscreen();
  const el = root();
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else await el.webkitRequestFullscreen?.();
  } catch {
    return false;
  }
  return isFullscreen();
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  const d = doc();
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else await d.webkitExitFullscreen?.();
  } catch {
    // already out
  }
}

/** Calls back on every change, whoever caused it (our button, the phone's back gesture). */
export function onFullscreenChange(cb: () => void): () => void {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
  return () => {
    document.removeEventListener('fullscreenchange', cb);
    document.removeEventListener('webkitfullscreenchange', cb);
  };
}
