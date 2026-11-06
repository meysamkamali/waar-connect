"""waar Connect - logo generator.

Builds every lockup from three ingredients:
  * the official WAAR wordmark   (src/waar-logo-original.svg, silver gradient facets, 546.6 x 157.51)
  * an infinity ribbon computed here (a lemniscate, woven over/under at the crossing)
  * the word CONNECT set in Barlow ExtraBold (src/Barlow-ExtraBold.ttf), converted to outlines,
    so the SVGs need no font - the same face/treatment the WAAR Articles logo uses.

    python tools/make_logo.py            # writes ../*.svg, ../png/*.png and ../design-sheet.html/.png
    python tools/make_logo.py --svg-only
"""
import math, os, sys
import numpy as np
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

HERE  = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.dirname(HERE)
SRC   = os.path.join(BRAND, 'src')
PNG   = os.path.join(BRAND, 'png')
os.makedirs(PNG, exist_ok=True)

def fmt(v):
    s = '%.2f' % v
    s = s.rstrip('0').rstrip('.') if '.' in s else s
    return '0' if s in ('-0', '') else s

# ----------------------------------------------------------------------------- WAAR wordmark
WAAR_W, WAAR_H = 546.6, 157.51
_WAAR_GRADS = [  # id, x1, y1, x2, y2, stops - from the official file (hrefs resolved)
    ('a', 270.02, 78.76, 338.18, 78.76,  [(0, '#e6e6e5'), (.27, '#dfdfde'), (.64, '#cccccc'), (1, '#b4b4b4')]),
    ('b', 373.16, 42.68, 373.16, 150.52, [(0, '#e6e6e5'), (1, '#b4b4b4')]),
    ('c', 48.42,  43.07, 116.74, 153.91, [(0, '#e6e6e5'), (.76, '#b4b4b4')]),
    ('d', 99.97,  78.76, 188.08, 78.76,  [(0, '#e6e6e5'), (.27, '#dfdfde'), (.64, '#cccccc'), (1, '#b4b4b4')]),
    ('e', 230.52, 79.05, 230.52, 151.72, [(0, '#e6e6e5'), (1, '#b4b4b4')]),
    ('f', 451.72, 23.66, 480.09, 68.24,  [(0, '#e6e6e5'), (1, '#b4b4b4')]),
    ('g', 549.06, 61.04, 444.09, 120.27, [(0, '#f3f3f3'), (1, '#b4b4b4')]),
]
_WAAR_PATHS = [  # (gradient, d) in the official paint order
    ('a', 'M242.77,157.51L329.73,6.88c5.29-9.16,18.51-9.17,23.81-.02l24.02,41.47-63,109.18h-71.79Z'),
    ('b', 'M368.45,157.51l-62.94-108.67,24.22-41.97c5.29-9.16,18.51-9.17,23.81-.02l87.26,150.66h-72.34Z'),
    ('c', 'M81.27,157.51h70.38L74.19,23.77C66.39,10.3,52.01,2.02,36.45,2.02H12C2.77,2.02-3,12.02,1.63,20.01l79.64,137.5Z'),
    ('d', 'M100.19,157.51L187.09,6.88c5.29-9.16,18.51-9.17,23.81-.02l24.02,41.47-63,109.18h-71.74Z'),
    ('e', 'M225.82,157.51l-62.94-108.67,24.22-41.97c5.29-9.16,18.51-9.17,23.81-.02l87.26,150.66h-72.34Z'),
    ('f', 'M505.57,4.21c-4.96-1.43-10.17-2.2-15.55-2.2h-123.35s15.95,27.54,15.95,27.54c4.69,8.1,13.34,13.08,22.7,13.08h67.43c8.31,0,15.33,6.51,15.56,14.82.22,8.14-5.94,14.89-13.85,15.61,49.65-1.83,72.79-42.31,31.11-68.86Z'),
    ('g', 'M546.6,58.09c.04-25.47-17.54-47.11-41.03-53.88,41.68,26.55,18.54,67.03-31.11,68.86-.46.04-.92.07-1.39.07h-65.2l40.61,70.12c5.11,8.82,14.53,14.25,24.73,14.25h49.08l-25.38-43.82h0l-.03-.05c27.94-3.11,49.68-26.79,49.72-55.55Z'),
]
# darker "steel" mapping of the same gradient for light backgrounds (official silver vanishes on white)
STEEL = {'#e6e6e5': '#c6cbd2', '#dfdfde': '#bcc1c9', '#cccccc': '#a6acb5', '#b4b4b4': '#7c838d', '#f3f3f3': '#d4d8de'}

def waar(x, y, scale=1.0, uid='w', light=False, mono=None):
    """The official WAAR wordmark with its box top-left at (x, y). Returns (defs, body)."""
    defs, body = [], []
    for g, d in _WAAR_PATHS:
        body.append('<path fill="%s" d="%s"/>' % (mono if mono else 'url(#%s%s)' % (uid, g), d))
    if not mono:
        for g, x1, y1, x2, y2, stops in _WAAR_GRADS:
            st = ''.join('<stop offset="%s" stop-color="%s"/>' % (o, STEEL[c] if light else c) for o, c in stops)
            defs.append('<linearGradient id="%s%s" gradientUnits="userSpaceOnUse" x1="%s" y1="%s" x2="%s" y2="%s">%s</linearGradient>'
                        % (uid, g, x1, y1, x2, y2, st))
    return ''.join(defs), '<g transform="translate(%s %s) scale(%s)">%s</g>' % (fmt(x), fmt(y), fmt(scale), ''.join(body))

# ----------------------------------------------------------------------------- infinity ribbon
K_SHAPE = 0.5      # 0 = Gerono (round, blunt lobes) ... 1 = Bernoulli (pointed lobes)
RIBBON  = 0.32     # ribbon thickness as a fraction of the lobe size a

def _lem(t, a, k):
    s, c = np.sin(t), np.cos(t)
    d = 1 + k * s * s
    dd = 2 * k * s * c
    x = a * c / d
    y = a * s * c / d
    xp = a * (-s * d - c * dd) / d ** 2
    yp = a * (np.cos(2 * t) * d - s * c * dd) / d ** 2
    return x, y, xp, yp

def inf_height_factor(k=K_SHAPE):
    t = np.linspace(0, 2 * np.pi, 2000)
    return 2 * _lem(t, 1.0, k)[1].max()        # centre-line height for a = 1

def inf_size(a, w, k=K_SHAPE):
    return 2 * a + w, a * inf_height_factor(k) + w   # outer width, outer height

def a_for_height(h, wr=RIBBON, k=K_SHAPE):
    return h / (inf_height_factor(k) + wr)

def _smooth(pts):
    """Catmull-Rom spline through pts as cubic Beziers (current point must be pts[0])."""
    out, n = [], len(pts)
    for i in range(n - 1):
        p0 = pts[i - 1] if i > 0 else pts[i]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[i + 2] if i + 2 < n else pts[i + 1]
        c1 = p1 + (p2 - p0) / 6
        c2 = p2 - (p3 - p1) / 6
        out.append('C%s %s %s %s %s %s' % tuple(fmt(v) for v in (c1[0], c1[1], c2[0], c2[1], p2[0], p2[1])))
    return ''.join(out)

def ribbon_path(t0, t1, a, w, k=K_SHAPE, n=64):
    """Closed outline of the ribbon of width w around the curve for t in [t0, t1] (butt ends)."""
    t = np.linspace(t0, t1, n)
    x, y, xp, yp = _lem(t, a, k)
    L = np.hypot(xp, yp)
    nx, ny = -yp / L, xp / L
    left = np.c_[x + nx * w / 2, y + ny * w / 2]
    right = np.c_[x - nx * w / 2, y - ny * w / 2][::-1]
    return ('M%s %s' % (fmt(left[0, 0]), fmt(left[0, 1])) + _smooth(left) +
            'L%s %s' % (fmt(right[0, 0]), fmt(right[0, 1])) + _smooth(right) + 'Z')

DUO_DARK  = [(0, '#f6f6f6'), (.30, '#d8d8d8'), (.44, '#b7bbc2'), (.56, '#3d93e3'), (.74, '#0169bb'), (1, '#5a1fc4')]
DUO_LIGHT = [(0, '#d9dde3'), (.30, '#b3b9c2'), (.44, '#8f98a5'), (.56, '#2b82d2'), (.74, '#0b5fae'), (1, '#4c1aa8')]
SIL_DARK  = [(0, '#f6f6f6'), (.5, '#cbcbcb'), (1, '#a6a6a6')]
SIL_LIGHT = [(0, '#d2d6dc'), (.5, '#a7adb6'), (1, '#737a84')]

def infinity(cx, cy, a, w, uid='i', style='duo', light=False, k=K_SHAPE):
    """Infinity ribbon centred on (cx, cy). style: 'duo' (silver -> connect blue), 'silver', or a flat colour."""
    e = 0.03
    P  = ribbon_path(-e, math.pi + e, a, w, k)                       # strand that passes under
    Q  = ribbon_path(math.pi - e, 2 * math.pi + e, a, w, k)          # strand that passes over
    Qc = ribbon_path(1.5 * math.pi - 0.55, 1.5 * math.pi + 0.55, a, w, k, n=24)   # crossing piece (shadow)
    W, H = inf_size(a, w, k)
    xm, ym = W / 2, H / 2
    tr = '<g transform="translate(%s %s)">' % (fmt(cx), fmt(cy))
    defs, body = [], []
    if style in ('duo', 'silver'):
        stops = (DUO_LIGHT if light else DUO_DARK) if style == 'duo' else (SIL_LIGHT if light else SIL_DARK)
        defs.append('<linearGradient id="%sc" gradientUnits="userSpaceOnUse" x1="%s" y1="0" x2="%s" y2="0">%s</linearGradient>'
                    % (uid, fmt(-xm), fmt(xm), ''.join('<stop offset="%s" stop-color="%s"/>' % s for s in stops)))
        defs.append('<linearGradient id="%sv" gradientUnits="userSpaceOnUse" x1="0" y1="%s" x2="0" y2="%s">'
                    '<stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".48" stop-color="#fff" stop-opacity="0"/>'
                    '<stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>'
                    % (uid, fmt(-ym), fmt(ym)))
        defs.append('<clipPath id="%sp"><path transform="translate(%s %s)" d="%s"/></clipPath>' % (uid, fmt(cx), fmt(cy), P))
        defs.append('<filter id="%sb" x="-40%%" y="-40%%" width="180%%" height="180%%"><feGaussianBlur stdDeviation="%s"/></filter>' % (uid, fmt(w * 0.13)))
        body.append(tr + '<path fill="url(#%sc)" d="%s"/><path fill="url(#%sv)" d="%s"/></g>' % (uid, P, uid, P))
        body.append('<g clip-path="url(#%sp)"><path transform="translate(%s %s)" filter="url(#%sb)" fill="#000" fill-opacity=".55" d="%s"/></g>'
                    % (uid, fmt(cx), fmt(cy), uid, Qc))
        body.append(tr + '<path fill="url(#%sc)" d="%s"/><path fill="url(#%sv)" d="%s"/></g>' % (uid, Q, uid, Q))
    else:   # flat colour: knock a gap out of the under-strand so the weave still reads
        g = w * 0.20
        Qg = ribbon_path(1.5 * math.pi - 0.7, 1.5 * math.pi + 0.7, a, w + 2 * g, k, n=24)
        defs.append('<mask id="%sm"><rect x="%s" y="%s" width="%s" height="%s" fill="#fff"/><path transform="translate(%s %s)" fill="#000" d="%s"/></mask>'
                    % (uid, fmt(cx - xm - 10), fmt(cy - ym - 10), fmt(W + 20), fmt(H + 20), fmt(cx), fmt(cy), Qg))
        body.append('<g mask="url(#%sm)">%s<path fill="%s" d="%s"/></g></g>' % (uid, tr, style, P))
        body.append(tr + '<path fill="%s" d="%s"/></g>' % (style, Q))
    return ''.join(defs), ''.join(body), (W, H)

# ----------------------------------------------------------------------------- CONNECT (Barlow ExtraBold outlines)
_font = TTFont(os.path.join(SRC, 'Barlow-ExtraBold.ttf'))
_gs, _cmap = _font.getGlyphSet(), _font.getBestCmap()
CAP = 0.700   # cap height / em

def glyph(ch, size, x, y):
    g = _gs[_cmap[ord(ch)]]
    s = size / 1000.0
    pen = SVGPathPen(_gs, ntos=lambda v: fmt(v))
    g.draw(TransformPen(pen, (s, 0, 0, -s, x, y)))
    bp = BoundsPen(_gs); g.draw(bp)
    b = bp.bounds
    return pen.getCommands(), g.width * s, (x + b[0] * s, x + b[2] * s)

def word(text, size, tracking, x=0.0, y=0.0, slot=None):
    """Set text left->right from baseline origin (x, y). `slot` = (index, width): leave a gap of that
    width in place of the character at index (used for the infinity inside C-oo-NNECT).
    Returns (paths, ink_x0, ink_x1, slot_centre_x)."""
    ds, cx, x0, x1, sc = [], x, None, None, None
    for i, ch in enumerate(text):
        if slot and i == slot[0]:
            sc = cx + slot[1] / 2
            cx += slot[1] + tracking
            continue
        d, adv, (ix0, ix1) = glyph(ch, size, cx, y)
        ds.append(d)
        x0 = ix0 if x0 is None else min(x0, ix0)
        x1 = ix1 if x1 is None else max(x1, ix1)
        cx += adv + tracking
    return ds, x0, x1, sc

def fit_tracking(text, size, width, slot=None):
    """Tracking so the word's ink spans `width`."""
    _, x0, x1, _ = word(text, size, 0, slot=slot)
    gaps = len(text) - 1
    return (width - (x1 - x0)) / gaps

def styled_word(ds, uid, bbox, light=False, mono=None, hatch=True):
    """Silver facets like the WAAR Articles logo: diagonal gradient + vertical sheen + 60-degree hatch."""
    x0, y0, x1, y1 = bbox
    paths = ''.join('<path d="%s"/>' % d for d in ds)
    if mono:
        return '', '<g fill="%s">%s</g>' % (mono, paths)
    stops = [(0, '#cfd4da'), (.5, '#a9b0b9'), (1, '#6f7781')] if light else [(0, '#f4f4f4'), (.5, '#d9d9d9'), (1, '#a3a3a3')]
    defs = ('<linearGradient id="%sm" gradientUnits="userSpaceOnUse" x1="%s" y1="%s" x2="%s" y2="%s">%s</linearGradient>'
            % (uid, fmt(x0), fmt(y0), fmt(x1), fmt(y1), ''.join('<stop offset="%s" stop-color="%s"/>' % s for s in stops)))
    defs += ('<linearGradient id="%sv" gradientUnits="userSpaceOnUse" x1="0" y1="%s" x2="0" y2="%s">'
             '<stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/>'
             '<stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>' % (uid, fmt(y0), fmt(y1)))
    body = '<g fill="url(#%sm)">%s</g><g fill="url(#%sv)">%s</g>' % (uid, paths, uid, paths)
    if hatch:
        defs += '<clipPath id="%sk">%s</clipPath>' % (uid, paths)
        h = y1 - y0
        step, sw, dx = h * 1.9, h * 0.55, h / math.tan(math.radians(60))
        polys, xs = [], x0 - h
        while xs < x1 + h:
            polys.append('<polygon points="%s,%s %s,%s %s,%s %s,%s"/>' % (fmt(xs), fmt(y1), fmt(xs + sw), fmt(y1), fmt(xs + sw + dx), fmt(y0), fmt(xs + dx), fmt(y0)))
            xs += step
        body += '<g clip-path="url(#%sk)" fill="#000" fill-opacity=".12">%s</g>' % (uid, ''.join(polys))
    return defs, body

# ----------------------------------------------------------------------------- lockups
def svg_doc(w, h, defs, body, pad=0, bg=None):
    bgr = '<rect x="%s" y="%s" width="%s" height="%s" fill="%s"/>' % (fmt(-pad), fmt(-pad), fmt(w + 2 * pad), fmt(h + 2 * pad), bg) if bg else ''
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" width="%s" height="%s" role="img" aria-label="waar Connect">'
            '<title>waar Connect</title><defs>%s</defs>%s%s</svg>'
            % (fmt(-pad), fmt(-pad), fmt(w + 2 * pad), fmt(h + 2 * pad), fmt(w + 2 * pad), fmt(h + 2 * pad), defs, bgr, body))

GAP   = 34.0      # WAAR -> CONNECT gap
CSIZE = 96.0      # CONNECT font size (cap height 67.2 = 43% of the WAAR height)

def text_block(uid, light=False, mono=None):
    """WAAR over CONNECT, both 546.6 wide. Returns (defs, body, height)."""
    d1, b1 = waar(0, 0, uid=uid + 'w', light=light, mono=mono)
    base = WAAR_H + GAP + CAP * CSIZE
    tr = fit_tracking('CONNECT', CSIZE, WAAR_W)
    ds, x0, x1, _ = word('CONNECT', CSIZE, tr, 0, base)
    ds, x0, x1, _ = word('CONNECT', CSIZE, tr, -x0, base)        # left ink edge on x = 0
    d2, b2 = styled_word(ds, uid + 't', (0, base - CAP * CSIZE, WAAR_W, base), light=light, mono=mono)
    return d1 + d2, b1 + b2, base

def lockup_horizontal(uid='h', style='duo', light=False, mono=None, emblem=0.86, gap=58.0):
    """[infinity]  WAAR / CONNECT"""
    dT, bT, hT = text_block(uid, light, mono)
    a = a_for_height(hT * emblem); w = a * RIBBON
    W, H = inf_size(a, w)
    dI, bI, _ = infinity(W / 2, hT / 2, a, w, uid=uid + 'i', style=(mono or style), light=light)
    tw = W + gap
    body = bI + '<g transform="translate(%s 0)">%s</g>' % (fmt(tw), bT)
    return svg_doc(tw + WAAR_W, hT, dI + dT, body, pad=24), (tw + WAAR_W, hT)

def lockup_stacked(uid='s', style='duo', light=False, mono=None, emblem_h=104.0):
    """WAAR / infinity / CONNECT, centred."""
    d1, b1 = waar(0, 0, uid=uid + 'w', light=light, mono=mono)
    a = a_for_height(emblem_h); w = a * RIBBON
    W, H = inf_size(a, w)
    cy = WAAR_H + GAP + H / 2
    dI, bI, _ = infinity(WAAR_W / 2, cy, a, w, uid=uid + 'i', style=(mono or style), light=light)
    base = WAAR_H + GAP + H + GAP + CAP * CSIZE
    tr = fit_tracking('CONNECT', CSIZE, WAAR_W)
    ds, x0, x1, _ = word('CONNECT', CSIZE, tr, 0, base)
    ds, x0, x1, _ = word('CONNECT', CSIZE, tr, -x0, base)
    d2, b2 = styled_word(ds, uid + 't', (0, base - CAP * CSIZE, WAAR_W, base), light=light, mono=mono)
    line = mono or ('#7c838d' if light else '#cfcfcf')
    rule = ('<rect x="0" y="%s" width="%s" height="1.6" fill="%s" fill-opacity=".45"/><rect x="%s" y="%s" width="%s" height="1.6" fill="%s" fill-opacity=".45"/>'
            % (fmt(cy - 0.8), fmt(WAAR_W / 2 - W / 2 - 26), line, fmt(WAAR_W / 2 + W / 2 + 26), fmt(cy - 0.8), fmt(WAAR_W / 2 - W / 2 - 26), line))
    return svg_doc(WAAR_W, base, d1 + dI + d2, b1 + rule + bI + b2, pad=24), (WAAR_W, base)

def lockup_compact(uid='c', style='duo', light=False, mono=None):
    """WAAR / [infinity] CONNECT : the emblem leads the word on one line, the whole line as wide as WAAR.
    (An earlier try put the infinity in place of the O - it read as COONNECT, so the emblem stays a mark.)"""
    d1, b1 = waar(0, 0, uid=uid + 'w', light=light, mono=mono)
    size = 82.0
    cap = CAP * size
    a = a_for_height(cap * 1.18); w = a * RIBBON
    W, H = inf_size(a, w)
    gap = 24.0
    base = WAAR_H + GAP + cap
    tr = fit_tracking('CONNECT', size, WAAR_W - W - gap)
    ds, x0, x1, _ = word('CONNECT', size, tr, 0, base)
    ds, x0, x1, _ = word('CONNECT', size, tr, W + gap - x0, base)      # word starts after the emblem
    d2, b2 = styled_word(ds, uid + 't', (W + gap, base - cap, WAAR_W, base), light=light, mono=mono)
    dI, bI, _ = infinity(W / 2, base - cap / 2, a, w, uid=uid + 'i', style=(mono or style), light=light)
    return svg_doc(WAAR_W, base, d1 + d2 + dI, b1 + b2 + bI, pad=24), (WAAR_W, base)

def emblem_only(uid='e', style='duo', light=False, mono=None, size=400.0):
    a = a_for_height(size * 0.52); w = a * RIBBON
    W, H = inf_size(a, w)
    dI, bI, _ = infinity(W / 2, H / 2, a, w, uid=uid + 'i', style=(mono or style), light=light)
    return svg_doc(W, H, dI, bI, pad=16), (W, H)

def app_icon(uid='k', size=512.0):
    r = size * 0.22
    a = a_for_height(size * 0.36); w = a * RIBBON
    W, H = inf_size(a, w)
    dI, bI, _ = infinity(size / 2, size / 2, a, w, uid=uid + 'i', style='duo')
    defs = ('<linearGradient id="%sbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#28334a"/><stop offset="1" stop-color="#0f1319"/></linearGradient>'
            '<radialGradient id="%sgl" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#3d93e3" stop-opacity=".35"/><stop offset="1" stop-color="#3d93e3" stop-opacity="0"/></radialGradient>' % (uid, uid))
    body = ('<rect width="%s" height="%s" rx="%s" fill="url(#%sbg)"/><ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="url(#%sgl)"/>'
            % (fmt(size), fmt(size), fmt(r), uid, fmt(size * 0.58), fmt(size * 0.56), fmt(size * 0.42), fmt(size * 0.30), uid))
    return svg_doc(size, size, defs + dI, body + bI), (size, size)

# ----------------------------------------------------------------------------- build
FILES = {
    # name: (builder, kwargs, background the variant is meant for)
    'waar-connect-horizontal':        (lockup_horizontal, dict(style='duo'),                 'dark'),
    'waar-connect-horizontal-silver': (lockup_horizontal, dict(style='silver'),              'dark'),
    'waar-connect-horizontal-light':  (lockup_horizontal, dict(style='duo', light=True),     'light'),
    'waar-connect-horizontal-white':  (lockup_horizontal, dict(mono='#ffffff'),              'dark'),
    'waar-connect-horizontal-black':  (lockup_horizontal, dict(mono='#1b1b1b'),              'light'),
    'waar-connect-stacked':           (lockup_stacked,    dict(style='duo'),                 'dark'),
    'waar-connect-stacked-light':     (lockup_stacked,    dict(style='duo', light=True),     'light'),
    'waar-connect-compact':           (lockup_compact,    dict(style='duo'),                 'dark'),
    'waar-connect-compact-light':     (lockup_compact,    dict(style='duo', light=True),     'light'),
    'waar-connect-compact-white':     (lockup_compact,    dict(mono='#ffffff'),              'dark'),
    'waar-connect-infinity':          (emblem_only,       dict(style='duo'),                 'dark'),
    'waar-connect-infinity-white':    (emblem_only,       dict(mono='#ffffff'),              'dark'),
    'waar-connect-icon':              (app_icon,          dict(),                            'dark'),
}

def build():
    out = {}
    for name, (fn, kw, bg) in FILES.items():
        svg, size = fn(uid=name.replace('waar-connect-', '').replace('-', '') + '_', **kw)
        path = os.path.join(BRAND, name + '.svg')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(svg)
        out[name] = (svg, size, bg)
        print('%-36s %6.0f x %-5.0f %6d bytes' % (name + '.svg', size[0], size[1], len(svg)))
    return out

def export_png(out, widths=(2400,), icon_sizes=(1024, 512, 256, 128, 64, 32)):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, (svg, (w, h), bg) in out.items():
            path = 'file:///' + os.path.join(BRAND, name + '.svg').replace('\\', '/')
            icon = name == 'waar-connect-icon'
            pad = 0 if icon else (32 if 'infinity' in name else 48)
            vw, vh = w + pad, h + pad
            sizes = [(s, s / vw) for s in icon_sizes] if icon else [(W, W / vw) for W in widths]
            for px, scale in sizes:
                pg = b.new_page(viewport={'width': int(round(vw)), 'height': int(round(vh))}, device_scale_factor=scale)
                pg.goto(path)
                pg.screenshot(path=os.path.join(PNG, '%s-%d.png' % (name, px)), omit_background=True)
                pg.close()
        b.close()
    print('png exports written to', PNG)

def design_sheet(out):
    """One page with every variant on the background it is meant for, plus size tests."""
    def panel(title, name, bg, width='min(100%, 980px)', note=''):
        svg = out[name][0]
        return ('<section class="p %s"><h2>%s <span>%s.svg</span></h2><div class="art" style="width:%s">%s</div>%s</section>'
                % (bg, title, name, width, svg, '<p class="n">%s</p>' % note if note else ''))
    small = ''.join('<div class="sm" style="width:%dpx">%s</div>' % (w, out['waar-connect-horizontal'][0]) for w in (320, 200, 120))
    smallc = ''.join('<div class="sm" style="width:%dpx">%s</div>' % (w, out['waar-connect-compact'][0]) for w in (220, 140, 90))
    icons = ''.join('<div class="ic" style="width:%dpx;height:%dpx">%s</div>' % (s, s, out['waar-connect-icon'][0]) for s in (160, 96, 48, 32))
    css = '''
body{margin:0;background:#0d1117;color:#c9ced6;font:15px/1.5 Barlow,Segoe UI,sans-serif}
header{padding:36px 48px 8px}header h1{margin:0;font-size:28px;color:#fff;font-weight:600}header p{margin:6px 0 0;color:#8b93a0}
.p{margin:20px 48px;border-radius:14px;padding:28px 32px 24px}
.p.dark{background:radial-gradient(70% 85% at 50% 112%,rgba(58,88,140,.45),transparent 70%),linear-gradient(160deg,#1f283a,#141a26)}
.p.light{background:linear-gradient(160deg,#ffffff,#eef1f5);color:#3a4250}
.p h2{margin:0 0 18px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;opacity:.75}
.p h2 span{opacity:.6;font-weight:400;text-transform:none;letter-spacing:0;margin-left:10px}
.art svg{width:100%;height:auto;display:block}
.n{margin:14px 0 0;font-size:13px;opacity:.75;max-width:900px}
.row{display:flex;gap:40px;align-items:center;flex-wrap:wrap}
.sm svg{width:100%;height:auto;display:block}
.ic svg{width:100%;height:100%;display:block}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 0}
.grid .p{margin:20px 48px 20px 48px}.grid .p+.p{margin-left:0}
'''
    sections = (
        panel('A &middot; Primary horizontal lockup', 'waar-connect-horizontal', 'dark',
              note='Left lobe silver = WAAR, the studio. Right lobe connect-blue = the remote guest. One ribbon, woven once at the centre.') +
        panel('A2 &middot; Horizontal, all silver', 'waar-connect-horizontal-silver', 'dark', note='If the brand should stay single-metal like the parent logo.') +
        panel('A3 &middot; Horizontal on light backgrounds', 'waar-connect-horizontal-light', 'light', note='Same geometry, steel-toned so it holds on white (the official silver washes out).') +
        '<div class="grid">' +
        panel('A4 &middot; Flat white (overlays, video)', 'waar-connect-horizontal-white', 'dark', width='100%') +
        panel('A5 &middot; Flat black (print)', 'waar-connect-horizontal-black', 'light', width='100%') +
        '</div><div class="grid">' +
        panel('B &middot; Stacked', 'waar-connect-stacked', 'dark', width='72%') +
        panel('B2 &middot; Stacked, light', 'waar-connect-stacked-light', 'light', width='72%') +
        '</div>' +
        panel('C &middot; Compact: emblem leads the word', 'waar-connect-compact', 'dark', width='min(100%, 760px)',
              note='For headers, lower-thirds and the guest page: the same width as the WAAR wordmark alone, so it drops into any place the WAAR logo already fits.') +
        '<div class="grid">' +
        panel('C2 &middot; Compact, light', 'waar-connect-compact-light', 'light', width='100%') +
        panel('C3 &middot; Compact, flat white', 'waar-connect-compact-white', 'dark', width='100%') +
        '</div><div class="grid">' +
        panel('D &middot; Emblem alone', 'waar-connect-infinity', 'dark', width='62%') +
        panel('E &middot; App icon (512)', 'waar-connect-icon', 'dark', width='42%') +
        '</div>')
    html = ('<!doctype html><html><head><meta charset="utf-8"><title>waar Connect - logo sheet</title><style>%s</style></head><body>'
            '<header><h1>waar Connect &middot; logo options</h1><p>Official WAAR wordmark + infinity ribbon (studio &infin; guest) + CONNECT in Barlow ExtraBold, the same face as WAAR Articles.</p></header>'
            '%s'
            '<section class="p dark"><h2>Size test <span>horizontal at 320 / 200 / 120 px &middot; compact at 220 / 140 / 90 px &middot; icon at 160 / 96 / 48 / 32 px</span></h2>'
            '<div class="row">%s</div><div class="row" style="margin-top:28px">%s</div><div class="row" style="margin-top:28px">%s</div></section>'
            '</body></html>') % (css, sections, small, smallc, icons)
    path = os.path.join(BRAND, 'design-sheet.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1400, 'height': 900}, device_scale_factor=1.5)
        pg.goto('file:///' + path.replace('\\', '/'))
        pg.screenshot(path=os.path.join(BRAND, 'design-sheet.png'), full_page=True)
        b.close()
    print('design-sheet.html / design-sheet.png written')

if __name__ == '__main__':
    out = build()
    if '--svg-only' not in sys.argv:
        export_png(out)
        design_sheet(out)
