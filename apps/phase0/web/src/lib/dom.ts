// Small DOM helpers; no framework in phase 0.

import { getConfig } from './api.ts';

export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

export function params(): URLSearchParams {
  return new URLSearchParams(location.search);
}

export function paramInt(name: string, fallback: number): number {
  const v = Number(params().get(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function setStatus(text: string, tone: Tone = 'muted'): void {
  const el = document.querySelector<HTMLElement>('[data-status]');
  if (!el) return;
  el.textContent = text;
  el.dataset['tone'] = tone;
}

/** Every page carries the source link (AGPL section 13) and the phase label. */
export async function mountFooter(): Promise<void> {
  const footer = document.querySelector<HTMLElement>('footer[data-footer]');
  if (!footer) return;
  try {
    const cfg = await getConfig();
    footer.innerHTML = `waar Connect · phase 0 · <a href="${cfg.sourceUrl}" rel="noopener" target="_blank">Source code</a>`;
  } catch {
    footer.textContent = 'waar Connect · phase 0';
  }
}

class RedirectError extends Error {
  constructor() {
    super('redirecting to the launcher');
    this.name = 'RedirectError';
  }
}

// The redirect throws to stop the page script at module level; keep that out of the console.
window.addEventListener('error', (event) => {
  if (event.error instanceof RedirectError) event.preventDefault();
});

/** Send the user to the launcher, remembering where they wanted to go. */
export function backToLauncher(): never {
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/?next=${next}`);
  throw new RedirectError();
}

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

/** Status colour for a connection state label from stateLabel(). */
export function toneForState(label: string): Tone {
  if (label === 'connected') return 'ok';
  if (label === 'connecting' || label.startsWith('reconnecting')) return 'warn';
  return 'bad';
}
