// Full screen for the guest's page. Browsers only allow it from a touch or click, and an iPhone's
// Safari does not offer it to pages at all (only to a video element), so every call here may do
// nothing; the page must work the same without it.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { useEffect, useRef, useState } from 'preact/hooks';

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

export interface AutoFullscreen {
  /** This browser can put a page full screen at all (false on an iPhone). */
  can: boolean;
  full: boolean;
  /** The guest left full screen on purpose; it is not taken back until they press the button. */
  declined: boolean;
  /** The button: leave, or come back. */
  toggle: () => void;
}

// Remembered for the tab, so a page reload pushed by the producer does not undo the guest's choice.
const DECLINED_KEY = 'wc.fs.declined';
function loadDeclined(): boolean {
  try {
    return sessionStorage.getItem(DECLINED_KEY) === '1';
  } catch {
    return false;
  }
}
function saveDeclined(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(DECLINED_KEY, '1');
    else sessionStorage.removeItem(DECLINED_KEY);
  } catch {
    // fine without
  }
}

/**
 * Full screen the moment the browser allows it. No browser lets a page take it by itself, so the
 * page asks at once (in case it may), then on every touch or click anywhere on the page and when the
 * phone is turned, until it has it. The listeners sit on the document from the first render, so the
 * very first touch counts, also while the page is still loading or asking for the camera.
 * Leaving full screen on purpose (the button, or the phone's back gesture) is respected: it is not
 * taken back until the guest presses the button. `active` false (the guest was shown out) lets go.
 */
export function useAutoFullscreen(active: boolean): AutoFullscreen {
  const [full, setFull] = useState(isFullscreen());
  const [declined, setDeclinedState] = useState(loadDeclined);
  const declinedRef = useRef(declined);
  const activeRef = useRef(active);
  activeRef.current = active;
  const setDeclined = (on: boolean) => {
    declinedRef.current = on;
    saveDeclined(on);
    setDeclinedState(on);
  };

  useEffect(() => {
    if (!canFullscreen()) return;
    let was = isFullscreen();
    const ask = () => {
      if (activeRef.current && !declinedRef.current && !isFullscreen()) void enterFullscreen();
    };
    ask();
    const off = onFullscreenChange(() => {
      const now = isFullscreen();
      if (was && !now && activeRef.current) setDeclined(true);
      was = now;
      setFull(now);
    });
    const early = { capture: true, passive: true } as const; // before any button's own handler, never blocking a scroll
    document.addEventListener('click', ask, early);
    document.addEventListener('touchend', ask, early);
    screen.orientation?.addEventListener?.('change', ask);
    window.addEventListener('orientationchange', ask);
    return () => {
      off();
      document.removeEventListener('click', ask, early);
      document.removeEventListener('touchend', ask, early);
      screen.orientation?.removeEventListener?.('change', ask);
      window.removeEventListener('orientationchange', ask);
    };
  }, []);

  useEffect(() => {
    if (!active) void exitFullscreen();
  }, [active]);

  const toggle = () => {
    if (isFullscreen()) {
      setDeclined(true);
      void exitFullscreen();
    } else {
      setDeclined(false);
      void enterFullscreen();
    }
  };
  return { can: canFullscreen(), full, declined, toggle };
}
