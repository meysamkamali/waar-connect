// The pieces of the guest's screen, drawn the same on the phone and in the admin's designer: where a
// widget sits on the three-by-three screen, and the overlays themselves (tally, cue banner, buttons).
// Every size follows the screen's width (--fw on the frame), so the designer's small screen is the
// phone's screen to scale.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import { dockOf, type ScreenWidget } from '@waar-connect/shared';
import { Icon, type IconName } from '../components/ui.tsx';

type Cells = Pick<ScreenWidget, 'col' | 'row' | 'cols' | 'rows'>;

/** The widget's sections as a place in the screen's grid. */
export const cellStyle = (w: Cells) => ({ gridColumn: `${w.col + 1} / span ${w.cols}`, gridRow: `${w.row + 1} / span ${w.rows}` });

/** Overlays dock against the nearest edges of the screen. */
export function dockClass(w: Cells): string {
  const d = dockOf(w);
  return `gs-dock x-${d.x} y-${d.y}`;
}

export function TallyChip({ place, tally, tallyText, note, noteTone }: { place: string; tally: 'off' | 'standby' | 'onair'; tallyText: string; note?: string | undefined; noteTone?: string | undefined }) {
  return (
    <div class="gs-status">
      <span class="gs-place">{place}</span>
      {tally !== 'off' && <span class={`gs-tally ${tally}`}>{tallyText}</span>}
      {note && <span class={`gs-note ${noteTone ?? ''}`}>{note}</span>}
    </div>
  );
}

export function CueBanner({ from, text, onClick }: { from: string; text: string; onClick?: (() => void) | undefined }) {
  return (
    <button type="button" class="gs-cue" dir="auto" onClick={onClick}>
      <span class="gs-cue-from">{from}</span>
      <span class="gs-cue-text">{text}</span>
    </button>
  );
}

export function RoundButton({ icon, label, tone, onClick }: { icon: IconName; label: string; tone?: 'danger' | 'on' | 'done' | undefined; onClick?: ((e: MouseEvent) => void) | undefined }) {
  return (
    <button type="button" class={`gs-btn ${tone ?? ''}`} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}
