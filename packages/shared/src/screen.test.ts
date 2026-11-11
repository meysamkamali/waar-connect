import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultPattern,
  defaultScreen,
  dockOf,
  firstPlace,
  isPicture,
  layoutTiles,
  MAX_TILES,
  normalizePattern,
  normalizeScreen,
  overlayGroups,
  patternFor,
  placementProblem,
  placeWidget,
  removeWidget,
  samePattern,
  SCREEN_GUESTS,
  stripSize,
  WIDGET_KINDS,
  WIDGET_SPECS,
  type ScreenPattern,
  type ScreenWidget,
  type WidgetKind,
} from './screen.ts';

const at = (kind: WidgetKind, col: number, row: number, cols = 1, rows = 1): ScreenWidget => ({ kind, col, row, cols, rows });
const empty: ScreenPattern = { widgets: [] };

test("the station's own patterns are valid: alone, and in a group", () => {
  const screen = defaultScreen();
  assert.equal(screen.patterns.length, SCREEN_GUESTS);
  for (let n = 1; n <= SCREEN_GUESTS; n++) {
    const p = patternFor(screen, n);
    let built = empty;
    for (const w of p.widgets) {
      assert.equal(placementProblem(built, w), null, `${n} guests: ${w.kind}`);
      built = placeWidget(built, w);
    }
    assert.ok(samePattern(built, p));
    assert.ok(p.widgets.some((w) => w.kind === 'status'), 'the tally is always there');
    assert.equal(p.widgets.some((w) => w.kind === 'mv'), n > 1, 'the multiview only in a group');
  }
  const alone = defaultPattern(1);
  assert.deepEqual(alone.widgets.find((w) => w.kind === 'studio'), at('studio', 0, 0, 3, 3), 'alone: the studio feed full screen');
  assert.deepEqual(alone.widgets.find((w) => w.kind === 'self'), at('self', 0, 2), 'own camera bottom left');
  const group = defaultPattern(4);
  assert.deepEqual(group.widgets.find((w) => w.kind === 'studio'), at('studio', 0, 0, 2, 2));
  assert.deepEqual(group.widgets.find((w) => w.kind === 'mv'), at('mv', 0, 2, 3, 1), 'the multiview along the bottom');
  assert.equal(patternFor(screen, 0), screen.patterns[0], 'never fewer than one');
  assert.equal(patternFor(screen, 40), screen.patterns[7], 'never more than eight');
  assert.equal(patternFor(screen, Number.NaN), screen.patterns[0]);
});

test('placing: inside the screen, in a size the widget comes in, pictures not on top of each other', () => {
  assert.equal(placementProblem(empty, at('studio', 0, 0, 2, 2)), null);
  assert.equal(placementProblem(empty, at('studio', 2, 0, 2, 2)), 'outside the screen');
  assert.equal(placementProblem(empty, at('studio', 0, 0, 3, 1)), 'not a size it comes in');
  assert.equal(placementProblem(empty, at('mv', 0, 1, 3, 1)), null, 'the multiview is one section high and three wide');
  assert.equal(placementProblem(empty, at('mv', 0, 0, 1, 3)), 'not a size it comes in');
  assert.equal(placementProblem(empty, at('self', 1, 1, 2, 1)), 'not a size it comes in');
  assert.equal(placementProblem(empty, { kind: 'clock' as WidgetKind, col: 0, row: 0, cols: 1, rows: 1 }), 'not a widget');
  assert.equal(placementProblem(empty, at('self', 0.5, 0)), 'outside the screen');

  const p = placeWidget(empty, at('studio', 0, 0, 2, 2));
  assert.equal(placementProblem(p, at('self', 1, 1)), 'the studio feed is there');
  assert.equal(placementProblem(p, at('self', 2, 1)), null);
  assert.equal(placementProblem(p, at('mv', 0, 1, 3, 1)), 'the studio feed is there');
  assert.equal(placementProblem(p, at('mv', 0, 2, 3, 1)), null);
  assert.equal(placementProblem(p, at('studio', 1, 1, 2, 2)), null, 'moving a widget: its own old place does not count');
  // overlays float: over a picture, and several in one section
  assert.equal(placementProblem(p, at('mic', 0, 0)), null);
  assert.equal(placementProblem(placeWidget(p, at('mic', 0, 0)), at('hand', 0, 0)), null);
  assert.equal(placementProblem(p, at('cue', 0, 0, 3, 1)), null);
  assert.equal(placementProblem(p, at('cue', 1, 0, 3, 1)), 'outside the screen');
});

test('the studio feed full screen lies under the other pictures', () => {
  const full = placeWidget(empty, at('studio', 0, 0, 3, 3));
  assert.equal(placementProblem(full, at('self', 0, 2)), null);
  assert.equal(placementProblem(full, at('mv', 0, 2, 3, 1)), null);
  const withSelf = placeWidget(full, at('self', 0, 2));
  assert.equal(placementProblem(withSelf, at('mv', 0, 2, 3, 1)), 'the self camera is there', 'the others still keep off each other');
  assert.equal(placementProblem(placeWidget(empty, at('self', 1, 1)), at('studio', 0, 0, 3, 3)), null, 'and it can be laid under what is there');
});

test('placing moves, removing leaves the tally', () => {
  let p = placeWidget(defaultPattern(1), at('self', 2, 0));
  assert.equal(p.widgets.filter((w) => w.kind === 'self').length, 1);
  assert.deepEqual(p.widgets.find((w) => w.kind === 'self'), at('self', 2, 0));
  p = removeWidget(p, 'self');
  assert.equal(p.widgets.some((w) => w.kind === 'self'), false);
  assert.equal(removeWidget(p, 'status'), p, 'the tally cannot be taken off');
  assert.deepEqual(p.widgets.map((w) => w.kind), WIDGET_KINDS.filter((k) => p.widgets.some((w) => w.kind === k)), 'always in the same order');
});

test('the first free place reads the screen like a page', () => {
  const p = placeWidget(empty, at('studio', 0, 0, 2, 2));
  assert.deepEqual(firstPlace(p, 'self', { cols: 1, rows: 1 }), at('self', 2, 0));
  assert.deepEqual(firstPlace(p, 'mv', { cols: 3, rows: 1 }), at('mv', 0, 2, 3, 1));
  const tight = placeWidget(placeWidget(p, at('self', 2, 0)), at('mv', 0, 2, 3, 1));
  assert.deepEqual(firstPlace(tight, 'mic', { cols: 1, rows: 1 }), at('mic', 0, 0), 'an overlay goes anywhere');
  const blocked = placeWidget(placeWidget(empty, at('self', 1, 0)), at('studio', 0, 1, 2, 2));
  assert.equal(firstPlace(blocked, 'mv', { cols: 3, rows: 1 }), null, 'no row is free');
});

test('what is stored is made safe', () => {
  assert.ok(samePattern(normalizePattern(undefined, 1), defaultPattern(1)), 'nothing stored: the station pattern');
  assert.ok(samePattern(normalizePattern({ widgets: 'x' }, 3), defaultPattern(3)));
  const messy = normalizePattern(
    {
      widgets: [
        at('studio', 0, 0, 2, 2),
        at('self', 1, 1), // on the studio feed: dropped
        at('self', 2, 2),
        at('self', 2, 0), // a second one: dropped
        { kind: 'clock', col: 0, row: 0, cols: 1, rows: 1 },
        at('mic', 5, 0),
        null,
        'mv',
        at('cue', 0, 0, 2, 1),
      ],
    },
    2,
  );
  assert.deepEqual(messy.widgets, [at('studio', 0, 0, 2, 2), at('self', 2, 2), at('status', 0, 0), at('cue', 0, 0, 2, 1)], 'and the tally is put back');
  assert.deepEqual(normalizePattern({ widgets: [] }, 1).widgets, [at('status', 0, 0)], 'an empty screen keeps only the tally');

  const screen = normalizeScreen({ patterns: [{ widgets: [at('self', 0, 0)] }] });
  assert.equal(screen.patterns.length, SCREEN_GUESTS);
  assert.deepEqual(screen.patterns[0]!.widgets, [at('self', 0, 0), at('status', 0, 0)]);
  assert.ok(samePattern(screen.patterns[5]!, defaultPattern(6)), 'patterns that were never designed are the station ones');
  assert.deepEqual(normalizeScreen(null), defaultScreen());
  assert.deepEqual(normalizeScreen(normalizeScreen(defaultScreen())), defaultScreen(), 'stable');
});

test('overlays dock against the nearest edges; those in one section stand together', () => {
  assert.deepEqual(dockOf(at('mic', 0, 0)), { x: 'start', y: 'start' });
  assert.deepEqual(dockOf(at('mic', 1, 1)), { x: 'center', y: 'center' });
  assert.deepEqual(dockOf(at('mic', 2, 2)), { x: 'end', y: 'end' });
  assert.deepEqual(dockOf(at('cue', 0, 0, 3, 1)), { x: 'stretch', y: 'start' });
  assert.deepEqual(dockOf(at('cue', 1, 2, 2, 1)), { x: 'stretch', y: 'end' });
  const groups = overlayGroups(defaultPattern(1));
  assert.deepEqual(
    groups.map((g) => `${g.col},${g.row},${g.cols}: ${g.widgets.map((w) => w.kind).join(' ')}`),
    ['0,0,1: status', '1,0,2: cue', '2,2,1: mic hand help screen'],
  );
  assert.ok(overlayGroups(defaultPattern(1)).every((g) => g.widgets.every((w) => !isPicture(w.kind))));
  assert.ok(Object.values(WIDGET_SPECS).every((s) => s.sizes.length >= 1 && s.title && s.about));
});

test('the strip has the shape of its widget: three sections wide, one high', () => {
  assert.deepEqual(stripSize(960, 540), { width: 960, height: 180 });
  assert.deepEqual(stripSize(1280, 720), { width: 1280, height: 240 });
  assert.deepEqual(stripSize(1920, 1080), { width: 1280, height: 240 }, 'no wider than its small sources are worth');
  assert.deepEqual(stripSize(640, 360), { width: 640, height: 120 });
  for (const [w, h] of [
    [960, 540],
    [1280, 720],
    [854, 480],
  ] as const) {
    const s = stripSize(w, h);
    assert.equal(s.width % 2, 0);
    assert.equal(s.height % 2, 0);
    assert.ok(Math.abs(s.width / s.height - 16 / 3) < 0.05);
  }
});

test('pictures in the strip: as large as fits, 16:9, centred, never overlapping', () => {
  for (const [w, h] of [
    [960, 540],
    [1280, 720],
    [640, 360],
  ] as const) {
    const size = stripSize(w, h);
    const panel = { x: 0, y: 0, ...size };
    for (let n = 1; n <= MAX_TILES; n++) {
      const rects = layoutTiles(n, panel);
      assert.equal(rects.length, n);
      for (const r of rects) {
        assert.equal(r.width % 2, 0);
        assert.equal(r.height % 2, 0);
        assert.equal(r.width, rects[0]!.width, 'all the same size');
        assert.ok(r.x >= 0 && r.x + r.width <= size.width && r.y >= 0 && r.y + r.height <= size.height, `${n} pictures stay inside the strip of ${size.width}x${size.height}`);
        assert.ok(Math.abs(r.width / r.height - 16 / 9) < 0.08, '16:9');
      }
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const p = rects[i]!;
          const q = rects[j]!;
          assert.ok(p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y, 'no overlap');
        }
    }
  }
  const panel = { x: 0, y: 0, ...stripSize(960, 540) };
  const rowsOf = (n: number) => {
    const rects = layoutTiles(n, panel);
    return [...new Set(rects.map((r) => r.y))].map((y) => rects.filter((r) => r.y === y).length).join('+');
  };
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(rowsOf), ['1', '2', '3', '4', '5', '6', '4+3', '4+4']);
  assert.ok(layoutTiles(3, panel)[0]!.width >= 290, 'three pictures fill the three sections, less the dark edge around them');
  assert.ok(layoutTiles(8, panel)[0]!.width >= 140, 'eight are still a seventh of the screen wide');
  assert.deepEqual(layoutTiles(0, panel), []);
  assert.equal(layoutTiles(40, panel).length, MAX_TILES, 'never more than the maximum');
});
