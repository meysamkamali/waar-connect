# Phase 0 test sheet

Goal of phase 0: prove that a phone on a local mobile network reaches the studio as a usable SDI picture
with sound, measure how long it takes and how it behaves, and decide where the media server lives.
Two weeks. No product features.

## Setup

| Piece | What |
|---|---|
| Media server | `deploy/media` on a VPS. Test two locations: Frankfurt and Istanbul (or Bahrain). |
| Web | `apps/phase0` on the aaPanel server at `https://connect.waar.work`. |
| Gateway PC | Studio PC with OBS 30 or newer and a Decklink. Browser sources for `/out.html`, Decklink output to the mixer. |
| Guests | One iPhone, one mid-range Android, each on a SIM card with Wi-Fi off, plus one laptop on home Wi-Fi. |
| Clock | `/clock.html` open on a second screen or a tablet, used to photograph latency. |

### Pages

| Page | Who opens it | Purpose |
|---|---|---|
| `/` | everyone | Launcher: PIN, room name, role. |
| `/guest.html?room=R&name=N` | the phone | Publishes camera and microphone, plays the studio return, shows live stats. |
| `/out.html?room=R&guest=N` | OBS browser source on the gateway | Full-frame picture and sound of one guest. Receive buffer `&buffer=400` (ms), clock overlay `&clock=1`, stats overlay `&stats=1`. |
| `/studio.html?room=R` | the gateway PC | Publishes the program return (a capture device or the OBS virtual camera) as participant `studio`. |
| `/monitor.html?room=R` | engineer's laptop | Everyone in the room, small, with per-participant stats. |
| `/clock.html` | any screen | Big millisecond clock synced to the server, for latency photographs. |

### OBS on the gateway

- Canvas 1920×1080, 25 fps (50 Hz station). Browser source `/out.html?...` at 1920×1080, "Control audio via OBS" on, "Shutdown source when not visible" off.
- Decklink output: 1080i50 or 1080p25 as the mixer expects. Audio from the browser source only.
- One scene per guest slot; the return feed comes from the Decklink input or the OBS virtual camera into `/studio.html`.

## Measurements

Fill one row per test. Ten minutes per row minimum.

| # | Date | Device | Network (operator, 4G/5G/Wi-Fi) | Place | VPS | Direct or relay | RTT ms | Loss % up / down | Bitrate up kbps | Received res / fps | Glass-to-glass guest→studio ms | Return guest ms | Dropouts in 10 min | Notes (echo, sync, sound) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | | | | | |
| 2 | | | | | | | | | | | | | | |

RTT, loss, bitrate, resolution and direct/relay are shown on the guest page and the out page overlay.

### How to measure glass-to-glass

1. Open `/clock.html` on a laptop in front of the guest's phone. The phone camera films the clock.
2. On the gateway, open the out page with `&clock=1`: the same synced clock is drawn beside the video.
3. Photograph the gateway's screen. Clock beside the video minus the clock inside the video is the
   guest-to-studio delay, including the phone camera and the browser decode but not the Decklink or
   the mixer. Add about 40 ms for the SDI chain.

### How to measure the return

1. Put `/clock.html` into the program return (a browser window captured by OBS into the return feed).
2. Photograph the guest's phone next to a tablet showing `/clock.html`.

### Things to try on purpose

- Walk from Wi-Fi to mobile data during the call. Note how long the picture is gone.
- Put the phone in a pocket for 30 s (screen off). Note whether the call survives.
- Second phone joins the same room; both should appear on `/monitor.html`.
- Force relay on the guest page (`&relay=1`) to see the TURN path and its added delay.
- Switch the guest page to `&fps=30` and compare motion on the SDI output against 25 fps.

## Decisions to come out of phase 0

1. VPS location (lower RTT for the real guests wins).
2. 25 or 30 fps on the guest side for a 50 Hz station.
3. Receive buffer on the out pages (start at 400 ms, try 250 and 600).
4. Whether OBS browser sources are good enough or vMix web inputs are needed.
5. Whether the station firewall needs rules for UDP 7882 and 3478 from the gateway PC.
