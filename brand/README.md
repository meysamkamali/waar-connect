# waar Connect — brand files

Logo for **waar Connect**, the WAAR project that links remote guests to the studio for live programs.
It is built from the official WAAR wordmark, an infinity ribbon (studio ∞ guest, one ribbon woven once
at the centre) and the word CONNECT in Barlow ExtraBold — the same face WAAR Articles uses, so the two
sub-brands sit together.

Open `design-sheet.html` (or `design-sheet.png`) to see every variant on the background it is meant for.

## Files

| File | Use |
|---|---|
| `waar-connect-horizontal.svg` | **Primary.** Emblem left, WAAR / CONNECT right. Dark backgrounds, video, web. |
| `waar-connect-horizontal-silver.svg` | Same, all silver, if the brand must stay single-metal. |
| `waar-connect-horizontal-light.svg` | Steel-toned version for white / light backgrounds (official silver washes out on white). |
| `waar-connect-horizontal-white.svg` / `-black.svg` | Flat one-colour. Overlays, keying, print, embroidery. |
| `waar-connect-stacked.svg` / `-light.svg` | Centred stack: WAAR / emblem / CONNECT. Square-ish spaces, title cards. |
| `waar-connect-compact.svg` / `-light.svg` / `-white.svg` | WAAR over "∞ CONNECT", exactly as wide as the WAAR wordmark alone. Headers, lower-thirds, the guest page. |
| `waar-connect-infinity.svg` / `-white.svg` | Emblem alone. |
| `waar-connect-icon.svg` | App icon / favicon, 512 box, rounded 22 %. |
| `png/` | Transparent PNG exports: lockups at 2400 px wide, icon at 1024 / 512 / 256 / 128 / 64 / 32. |
| `src/` | Inputs: the official `waar-logo-original.svg` and `Barlow-ExtraBold.ttf`. |
| `tools/make_logo.py` | Generator. `python tools/make_logo.py` rebuilds every SVG, PNG and the design sheet. |

All SVGs are outlines only (no fonts, no external files), with a 24-unit safe margin built in.

## Colours

| Role | Value |
|---|---|
| WAAR silver (official) | `#e6e6e5 → #b4b4b4`, highlight `#f3f3f3` |
| Steel (light backgrounds) | `#c6cbd2 → #7c838d` |
| Connect blue | `#3d93e3 → #0169bb → #5a1fc4` (the WAAR Articles accent `#0169bb` and its violet gradient end) |
| Dark background | `#181d24`, hero gradient `#1f283a → #141a26` |

Left lobe of the infinity = silver = WAAR, the studio. Right lobe = connect blue = the remote guest.
The ribbon passes over itself once; that crossing is the "connection".

## Rules of thumb

- Minimum sizes: horizontal 120 px wide, compact 90 px wide, icon 32 px.
- Keep the emblem's over/under crossing; do not flatten it into a plain ∞ outline except in the flat one-colour files, which already carry a knock-out gap.
- Do not recolour the WAAR wordmark; only the emblem carries the blue.
