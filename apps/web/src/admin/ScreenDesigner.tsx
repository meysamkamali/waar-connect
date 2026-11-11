// Admin: the guest screen designer. The guest's screen is nine sections, three by three; the admin
// fills it with widgets, dragged from the palette onto the screen and moved about on it. Pictures
// (studio feed, self camera, multiview) take whole sections; overlays (tally, cue banner, the guest's
// buttons) float over them, docked in a section. There is one design per number of guests on the
// screen, one to eight, and one set of designs per studio. The small screen here is drawn with the
// phone's own styles, to scale.
// Dragging is done with pointer events, so it works with a mouse, a pen and a finger; every widget
// can also be placed, moved (arrow keys) and removed (Delete) from the keyboard.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import {
  defaultPattern,
  firstPlace,
  isFullScreen,
  isPicture,
  layoutTiles,
  normalizeScreen,
  overlayGroups,
  OVERLAY_KINDS,
  PICTURE_KINDS,
  placementProblem,
  placeWidget,
  removeWidget,
  samePattern,
  SCREEN_COLS,
  SCREEN_GUESTS,
  SCREEN_ROWS,
  WIDGET_SPECS,
  type GuestScreen,
  type ScreenPattern,
  type ScreenWidget,
  type WidgetKind,
} from '@waar-connect/shared';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiError, updatePcr, type Pcr } from '../api.ts';
import { Icon, Info, type IconName } from '../components/ui.tsx';
import { cellStyle, dockClass, TallyChip } from '../guest/screen.tsx';

const ICONS: Readonly<Record<WidgetKind, IconName>> = { studio: 'monitor', self: 'user', mv: 'grid', status: 'tally', cue: 'message', mic: 'mic', hand: 'hand', help: 'help', screen: 'expand' };
const STRIP = { x: 0, y: 0, width: 960, height: 180 } as const;
const COUNTS = Array.from({ length: SCREEN_GUESTS }, (_, i) => i + 1);

type Size = { cols: number; rows: number };

interface Drag {
  kind: WidgetKind;
  cols: number;
  rows: number;
  /** Which section of the widget is under the pointer. */
  offCol: number;
  offRow: number;
  fromCanvas: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  target: ScreenWidget | null;
  problem: string | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const sameSize = (a: Size, b: Size) => a.cols === b.cols && a.rows === b.rows;

/** Where a widget goes when it is added without being dragged: its place in the station design, else the first free one. */
function homeFor(p: ScreenPattern, kind: WidgetKind, size: Size, guests: number): ScreenWidget | null {
  const station = defaultPattern(guests).widgets.find((w) => w.kind === kind) ?? defaultPattern(SCREEN_GUESTS).widgets.find((w) => w.kind === kind);
  if (station && sameSize(station, size) && placementProblem(p, station) === null) return station;
  return firstPlace(p, kind, size);
}

/** A widget as it looks on the phone, with sample content. */
function Sample({ kind, guests }: { kind: WidgetKind; guests: number }) {
  switch (kind) {
    case 'studio':
    case 'self':
      return (
        <>
          <Icon name={ICONS[kind]} />
          <span>{WIDGET_SPECS[kind].title}</span>
        </>
      );
    case 'mv': {
      const tiles = guests > 1 ? layoutTiles(guests, STRIP) : [];
      return (
        <>
          {tiles.map((r, i) => (
            <span
              key={i}
              class={`sd-mv-tile ${i === 0 ? 'me' : ''}`}
              style={{ left: `${(r.x / STRIP.width) * 100}%`, top: `${(r.y / STRIP.height) * 100}%`, width: `${(r.width / STRIP.width) * 100}%`, height: `${(r.height / STRIP.height) * 100}%` }}
            >
              <Icon name="user" />
            </span>
          ))}
          {tiles.length === 0 && <span class="sd-mv-label">Multiview</span>}
        </>
      );
    }
    case 'status':
      return <TallyChip place="Green room" tally="onair" tallyText="ON AIR" />;
    case 'cue':
      return (
        <span class="gs-cue">
          <span class="gs-cue-from">Producer</span>
          <span class="gs-cue-text">30 seconds</span>
        </span>
      );
    default:
      return (
        <span class="gs-btn">
          <Icon name={ICONS[kind]} />
        </span>
      );
  }
}

export function ScreenDesigner({ pcrs, onSaved, onError }: { pcrs: Pcr[]; onSaved: () => void; onError: (m: string) => void }) {
  const [pcrId, setPcrId] = useState(pcrs[0]?.id ?? '');
  const pcr = pcrs.find((p) => p.id === pcrId) ?? pcrs[0];
  const [drafts, setDrafts] = useState<Record<string, GuestScreen>>({});
  const [guests, setGuests] = useState(1);
  const [selected, setSelected] = useState<WidgetKind | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [fw, setFw] = useState(640);
  const canvas = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  const savedKey = JSON.stringify(pcr?.settings.screen ?? null);
  const saved = useMemo(() => normalizeScreen(pcr?.settings.screen), [savedKey]);
  const screen = (pcr && drafts[pcr.id]) || saved;
  const pattern = screen.patterns[guests - 1] ?? defaultPattern(guests);
  const dirty = JSON.stringify(screen) !== JSON.stringify(saved);

  // What the pointer handlers work on: always the latest, whichever render registered them.
  const now = useRef({ id: pcr?.id ?? '', guests, saved, pattern });
  now.current = { id: pcr?.id ?? '', guests, saved, pattern };

  const apply = (fn: (p: ScreenPattern) => ScreenPattern) =>
    setDrafts((d) => {
      const { id, guests: n, saved: base } = now.current;
      const from = d[id] ?? base;
      return { ...d, [id]: { patterns: from.patterns.map((p, i) => (i === n - 1 ? fn(p) : p)) } };
    });

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const measure = () => setFw(el.getBoundingClientRect().width || 640);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(id);
  }, [note]);

  useEffect(() => setSelected(null), [guests, pcr?.id]);

  /** Places a widget without dragging, or gives the one on the screen another size. */
  const add = (kind: WidgetKind, size: Size) => {
    const p = now.current.pattern;
    const placed = p.widgets.find((w) => w.kind === kind);
    let next: ScreenWidget | null;
    if (placed && sameSize(placed, size)) next = placed;
    else if (placed) {
      const here: ScreenWidget = { kind, col: Math.min(placed.col, SCREEN_COLS - size.cols), row: Math.min(placed.row, SCREEN_ROWS - size.rows), cols: size.cols, rows: size.rows };
      next = placementProblem(p, here) === null ? here : firstPlace(p, kind, size);
    } else next = homeFor(p, kind, size, now.current.guests);
    if (!next) {
      setNote(`No free place for the ${WIDGET_SPECS[kind].title.toLowerCase()}`);
      return;
    }
    const w = next;
    apply((q) => placeWidget(q, w));
    setSelected(kind);
  };

  const remove = (kind: WidgetKind) => {
    if (WIDGET_SPECS[kind].required) return;
    apply((q) => removeWidget(q, kind));
    setSelected(null);
  };

  // ---- dragging ---------------------------------------------------------------------------------------
  const onMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5;
    const rect = canvas.current?.getBoundingClientRect();
    let target: ScreenWidget | null = null;
    let problem: string | null = null;
    if (rect && moved && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
      const col = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * SCREEN_COLS) - d.offCol, 0, SCREEN_COLS - d.cols);
      const row = clamp(Math.floor(((e.clientY - rect.top) / rect.height) * SCREEN_ROWS) - d.offRow, 0, SCREEN_ROWS - d.rows);
      target = { kind: d.kind, col, row, cols: d.cols, rows: d.rows };
      problem = placementProblem(now.current.pattern, target);
    }
    const next: Drag = { ...d, x: e.clientX, y: e.clientY, moved, target, problem };
    dragRef.current = next;
    setDrag(next);
  };
  const stop = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
    dragRef.current = null;
    setDrag(null);
  };
  const onUp = () => {
    const d = dragRef.current;
    stop();
    if (!d) return;
    if (!d.moved) {
      // a click: on the screen it selects, in the palette it places
      if (d.fromCanvas) setSelected(d.kind);
      else add(d.kind, d);
      return;
    }
    if (d.target && !d.problem) {
      const w = d.target;
      apply((q) => placeWidget(q, w));
      setSelected(d.kind);
    } else if (!d.target && d.fromCanvas) remove(d.kind); // dragged off the screen
  };
  const onCancel = () => stop();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') stop();
  };
  useEffect(() => stop, []);

  const begin = (e: PointerEvent, kind: WidgetKind, size: Size, fromCanvas: boolean) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dragRef.current) return;
    e.preventDefault();
    let offCol = Math.floor((size.cols - 1) / 2);
    let offRow = Math.floor((size.rows - 1) / 2);
    const placed = now.current.pattern.widgets.find((w) => w.kind === kind);
    const rect = canvas.current?.getBoundingClientRect();
    if (fromCanvas && placed && rect && isPicture(kind)) {
      // keep hold of the section that was grabbed
      offCol = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * SCREEN_COLS) - placed.col, 0, size.cols - 1);
      offRow = clamp(Math.floor(((e.clientY - rect.top) / rect.height) * SCREEN_ROWS) - placed.row, 0, size.rows - 1);
    }
    const d: Drag = { kind, cols: size.cols, rows: size.rows, offCol, offRow, fromCanvas, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moved: false, target: null, problem: null };
    dragRef.current = d;
    setDrag(d);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
  };

  const onItemKey = (e: KeyboardEvent, w: ScreenWidget) => {
    const step = e.key === 'ArrowLeft' ? [-1, 0] : e.key === 'ArrowRight' ? [1, 0] : e.key === 'ArrowUp' ? [0, -1] : e.key === 'ArrowDown' ? [0, 1] : null;
    if (step) {
      e.preventDefault();
      const next: ScreenWidget = { ...w, col: w.col + (step[0] ?? 0), row: w.row + (step[1] ?? 0) };
      if (placementProblem(pattern, next) === null) apply((q) => placeWidget(q, next));
      setSelected(w.kind);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(w.kind);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelected(w.kind);
    }
  };
  const onPress = (e: KeyboardEvent, act: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      act();
    }
  };

  // ---- saving -------------------------------------------------------------------------------------------
  const save = (everywhere: boolean) => {
    if (!pcr) return;
    setBusy(true);
    const targets = everywhere ? pcrs : [pcr];
    Promise.all(targets.map((p) => updatePcr(p.id, { settings: { screen } })))
      .then(() => {
        setDrafts((d) => (everywhere ? {} : Object.fromEntries(Object.entries(d).filter(([id]) => id !== pcr.id))));
        onSaved();
      })
      .catch((err: unknown) => onError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  if (!pcr) return null;

  const sel = selected ? pattern.widgets.find((w) => w.kind === selected) : undefined;
  const selSpec = sel ? WIDGET_SPECS[sel.kind] : undefined;
  const others = pcrs.some((p) => p.id !== pcr.id && JSON.stringify(normalizeScreen(p.settings.screen)) !== JSON.stringify(screen));

  const paletteRow = (kind: WidgetKind) => {
    const spec = WIDGET_SPECS[kind];
    const placed = pattern.widgets.find((w) => w.kind === kind);
    const size: Size = placed ?? (spec.sizes[0] as Size);
    return (
      <div
        key={kind}
        class={`sd-chip tip tip-start ${placed ? 'placed' : ''}`}
        data-tip={spec.about}
        role="button"
        tabIndex={0}
        aria-label={`${spec.title}${placed ? ', on the screen' : ''}`}
        onPointerDown={(e) => begin(e, kind, { cols: size.cols, rows: size.rows }, false)}
        onKeyDown={(e) => onPress(e, () => add(kind, size))}
      >
        <span class="sd-chip-icon">
          <Icon name={placed ? 'check' : ICONS[kind]} />
        </span>
        <span>{spec.title}</span>
        {spec.sizes.length > 1 && (
          <span class="sd-sizes">
            {spec.sizes.map((s) => (
              <span
                key={s.name}
                class={`sd-size ${placed && sameSize(placed, s) ? 'on' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`${spec.title} ${s.name}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  begin(e, kind, { cols: s.cols, rows: s.rows }, false);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  onPress(e, () => add(kind, s));
                }}
              >
                {s.name}
              </span>
            ))}
          </span>
        )}
      </div>
    );
  };

  return (
    <section class="sd">
      <header class="sd-head">
        <div class="sd-title">
          <h2>Guest screen</h2>
          <Info
            side="start"
            text="The guest's phone screen is nine sections, three by three. Drag a widget onto the screen, drag it again to move it, drag it off to remove it. Pictures take whole sections; the tally, the cue banner and the buttons float over them. Phones that are connected take a saved design at once."
          />
          {pcrs.length > 1 && (
            <span class="seg">
              {pcrs.map((p) => (
                <button key={p.id} class={p.id === pcr.id ? 'on' : ''} onClick={() => setPcrId(p.id)}>
                  {p.name}
                </button>
              ))}
            </span>
          )}
        </div>
        <div class="sd-actions">
          <button class="btn secondary small" disabled={!dirty || busy} onClick={() => setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => id !== pcr.id)))}>
            <Icon name="undo" />
            Undo
          </button>
          <button class="btn small" disabled={!dirty || busy} onClick={() => save(false)}>
            <Icon name="check" />
            Save
          </button>
          {pcrs.length > 1 && (
            <button class="btn secondary small" disabled={busy || (!dirty && !others)} onClick={() => save(true)}>
              Save for every studio
            </button>
          )}
        </div>
      </header>

      <div class="sd-body">
        <div class="sd-palette">
          <h3>Pictures</h3>
          {PICTURE_KINDS.map(paletteRow)}
          <h3>Over the picture</h3>
          {OVERLAY_KINDS.map(paletteRow)}
        </div>

        <div class="sd-work">
          <div class="sd-bar">
            <div class="sd-counts">
              <span>Guests</span>
              <span class="seg" role="tablist" aria-label="Guests on the screen">
                {COUNTS.map((n) => (
                  <button key={n} role="tab" aria-selected={n === guests} class={`${n === guests ? 'on' : ''} ${samePattern(screen.patterns[n - 1] ?? defaultPattern(n), defaultPattern(n)) ? '' : 'own'}`} onClick={() => setGuests(n)}>
                    {n}
                  </button>
                ))}
              </span>
              <Info text="One design for each number of guests on the screen: 1 is a guest alone, 2 to 8 is a multiview group of that size. A dot marks a design that differs from the station's own." />
            </div>
            <div class="sd-actions">
              <button
                class="chip tip tip-end"
                data-tip="Uses this design for every number of guests."
                onClick={() => setDrafts((d) => ({ ...d, [pcr.id]: { patterns: screen.patterns.map(() => ({ widgets: pattern.widgets.map((w) => ({ ...w })) })) } }))}
              >
                <Icon name="copy" />
                Copy to all
              </button>
              <button class="chip tip tip-end" data-tip="Puts the station's own design back for this number of guests." disabled={samePattern(pattern, defaultPattern(guests))} onClick={() => apply(() => defaultPattern(guests))}>
                <Icon name="undo" />
                Station design
              </button>
            </div>
          </div>

          <div class="sd-phone">
            <div class={`sd-canvas ${drag?.moved ? 'dragging' : ''}`} ref={canvas} style={{ '--fw': `${fw}px` }} onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
              {Array.from({ length: SCREEN_COLS * SCREEN_ROWS }, (_, i) => (
                <div key={`cell-${i}`} class="sd-cell" style={{ gridColumn: `${(i % SCREEN_COLS) + 1}`, gridRow: `${Math.floor(i / SCREEN_COLS) + 1}` }} />
              ))}
              {pattern.widgets
                .filter((w) => isPicture(w.kind))
                .map((w) => (
                  <div
                    key={w.kind}
                    class={`sd-item sd-pic sd-${w.kind} ${isFullScreen(w) ? 'gs-under' : ''} ${selected === w.kind ? 'selected' : ''}`}
                    style={cellStyle(w)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${WIDGET_SPECS[w.kind].title}, column ${w.col + 1}, row ${w.row + 1}`}
                    onPointerDown={(e) => begin(e, w.kind, w, true)}
                    onKeyDown={(e) => onItemKey(e, w)}
                  >
                    <Sample kind={w.kind} guests={guests} />
                  </div>
                ))}
              {overlayGroups(pattern).map((g) => (
                <div key={`${g.col}:${g.row}:${g.cols}`} class={dockClass(g)} style={cellStyle(g)}>
                  {g.widgets.map((w) => (
                    <div
                      key={w.kind}
                      class={`sd-item sd-over ${w.cols > 1 || w.kind === 'cue' ? 'sd-wide' : ''} ${w.kind === 'status' || w.kind === 'cue' ? '' : 'sd-round'} ${selected === w.kind ? 'selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${WIDGET_SPECS[w.kind].title}, column ${w.col + 1}, row ${w.row + 1}`}
                      onPointerDown={(e) => begin(e, w.kind, w, true)}
                      onKeyDown={(e) => onItemKey(e, w)}
                    >
                      <Sample kind={w.kind} guests={guests} />
                    </div>
                  ))}
                </div>
              ))}
              {drag?.target && <div class={`sd-drop ${drag.problem ? 'bad' : ''}`} style={cellStyle(drag.target)} />}
            </div>
          </div>

          <div class="sd-foot">
            {sel && selSpec ? (
              <div class="sd-selected">
                <strong>
                  <Icon name={ICONS[sel.kind]} />
                  {selSpec.title}
                </strong>
                {selSpec.sizes.length > 1 && (
                  <span class="sd-sizes">
                    {selSpec.sizes.map((s) => (
                      <button key={s.name} class={`sd-size ${sameSize(sel, s) ? 'on' : ''}`} onClick={() => add(sel.kind, s)}>
                        {s.name}
                      </button>
                    ))}
                  </span>
                )}
                {!selSpec.required && (
                  <button class="chip" onClick={() => remove(sel.kind)}>
                    <Icon name="trash" />
                    Remove
                  </button>
                )}
              </div>
            ) : (
              <span />
            )}
            {note && <span class="small bad">{note}</span>}
          </div>
        </div>
      </div>

      {drag?.moved && (
        <div class={`sd-ghost ${drag.problem ? 'bad' : !drag.target && drag.fromCanvas && !WIDGET_SPECS[drag.kind].required ? 'out' : ''}`} style={{ left: `${drag.x + 14}px`, top: `${drag.y + 16}px` }}>
          <Icon name={ICONS[drag.kind]} />
          {WIDGET_SPECS[drag.kind].title}
          {drag.problem ? ` · ${drag.problem}` : !drag.target && drag.fromCanvas && !WIDGET_SPECS[drag.kind].required ? ' · remove' : ''}
        </div>
      )}
    </section>
  );
}
