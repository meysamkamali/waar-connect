// Small shared pieces of the staff pages: line icons and the balloon that carries an explanation.
// The pages themselves carry no guide text: what only explains opens in a balloon (styles: .tip, .info).
// Icon shapes after Feather Icons (MIT).
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import type { ComponentChildren } from 'preact';

const SHAPES = {
  sound: (
    <>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
    </>
  ),
  silent: (
    <>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M23 9l-6 6M17 9l6 6" />
    </>
  ),
  sliders: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  check: <polyline points="20 6 9 17 4 12" />,
  close: <path d="M18 6L6 18M6 6l12 12" />,
  mic: (
    <>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
    </>
  ),
  hand: <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />,
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
    </>
  ),
  camera: (
    <>
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </>
  ),
  grid: <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />,
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  trash: <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
  undo: <path d="M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />,
} as const;

export type IconName = keyof typeof SHAPES;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {SHAPES[name]}
    </svg>
  );
}

/** A small "i" that opens a balloon with the explanation, on hover or keyboard focus. */
export function Info({ text, side, below }: { text: string; side?: 'start' | 'end'; below?: boolean }) {
  return (
    <button type="button" class={`info tip ${side ? `tip-${side}` : ''} ${below ? 'tip-below' : ''}`} data-tip={text} aria-label={text}>
      i
    </button>
  );
}

/** Wraps anything so that it opens a balloon; for a control that needs a word on why it is as it is. */
export function Tip({ text, side, below, class: cls, children }: { text: string | undefined; side?: 'start' | 'end'; below?: boolean; class?: string; children: ComponentChildren }) {
  return (
    <span class={`tip ${side ? `tip-${side}` : ''} ${below ? 'tip-below' : ''} ${cls ?? ''}`} data-tip={text ?? ''}>
      {children}
    </span>
  );
}
