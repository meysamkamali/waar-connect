# waar Connect — system plan: places, roles and flow

Version 0.1 · 2026-11-05 · companion to APPROACH.md · status: design, no code yet

The system is built around **virtual places**. A guest walks through them the way a real guest walks
through a station: in at the door, into the green room with the producer and the engineer, into the
studio when it is their turn, back to the green room afterwards, and out.

```
                 ┌──────────┐    admit     ┌─────────────────┐   hand off    ┌──────────────────┐
  link tapped ──►│  LOBBY   │─────────────►│   GREEN ROOM    │──────────────►│      STUDIO      │
                 │ (door)   │              │ producer + eng  │◄──────────────│ standby → ON AIR │
                 └──────────┘              └─────────────────┘  bring back   └──────────────────┘
                                                   │                                  │
                                                   └──────────── leave ───────────────┘
```

While a guest is in the Studio they are cut off from the green room: no producer or engineer voice,
only the studio sound, the program picture, the tally and text cues. When the segment ends the producer
brings them back and the green room opens again.

## Roles

| Role | Where they are | What they can do |
|---|---|---|
| **Guest** | one place at a time | Send camera and microphone. Receive program picture, studio mix-minus, tally, text cues, and in the green room the voices and faces of producer and engineer. Mute self, raise hand, ask for help. Nothing else: all settings are done for them. |
| **Producer** | sits in a PCR (green room, with a window on the studio) | Keep the guest contact book (phone, WhatsApp, Telegram, Skype, email), seat a contact in the PCR and make their link, see who is at the door, receive them into the green room, choose what the guest sees (nothing, the producer's camera, the studio return) and hears (the producer, the studio mix-minus), let chosen guests talk to each other, assign a studio slot, send to the studio, bring back, send cues. Cannot change which camera or microphone the PC uses. |
| **Engineer** | green room, with a window on the studio | Everything the producer sees, plus the connection detail of every guest, test tools, remote settings on the guest's device, and a separate talk button that works at the same time as the producer's. Marks a guest **ready**; the hand-off needs that mark. |
| **Studio** (vision mixer operator) | studio | Sees each studio slot on its own SDI or NDI input plus the multiview. Sets ON AIR tally (manual in phase 1, from the mixer in phase 2). Does not talk to guests. |
| **Admin** | — | Builds the PCRs (studios) with their output slots and names, locks the hardware of every PC (which camera, microphone and capture inputs each station uses), users and roles, CasparCG and mixer settings later. |

Producer and engineer are two roles, not two people by necessity. A small show can run with one person
holding both, and the hand-off rule "engineer must mark ready" is a per-PCR setting.

**Decided 2026-11-08:** there are no programmes or episodes. The admin builds **PCRs** (production
control rooms, "studios"); each is a standing place with its own door, green room, studio slots and
LiveKit room. A producer sits in a PCR and brings guests to it. Guests live in a **contact book** the
producer edits; seating a contact in a PCR makes the invite link. The studio return (program picture
with the mix-minus on it) is published by the **gateway** (`apps/gateway`, since 2026-11-08) from the
NDI program source the admin names on the PCR, or, with no NDI source named, from the studio PC by the
**return feed page**; each slot has an **output page** on the studio PC for now, NDI output later from
the gateway.

**Decided 2026-11-08 (later the same day):** no engineer screen and no engineer approval for now;
the producer does it all, including the connection check and the settings of the guest's phone
(picture size, frame rate, bitrate cap, codec, relay, front/back camera, voice processing, mute,
reload). No tables in the green room: since 2026-11-09 the producer picks, per guest, which other
green-room guests they see and hear. No slot choice: "send to studio" takes the first free slot,
"bring back" frees it. The engineer role stays in the API for a later phase.

**Decided 2026-11-10:** the engineer has a page of their own, `/app/engineer`. There is no studio to
sit in first: every PCR is on the page, each with its own receive-only connection
(`/app/engineer/<pcr>` shows one alone). For each PCR it shows every
feed as a tile: the studio return, the producer, and every guest from the moment they open
their link. The engineer only receives (no microphone, no camera), listens to any feed on demand, and
hears the producer's voice while it goes to a guest they listen to. Selecting a feed opens its
technical side: a guest's phone settings (the same panel the producer has), the producer's face camera
(picture, frame rate, bitrate), the return feed (NDI source, picture, bitrate). The engineer also sets
how a guest's phone connects by default, per PCR: a **codec order** tried from the top (each line a
codec with "hardware", "software" or "any encoder", for example H.265 hardware, H.264 hardware,
H.264 software, AV1 hardware), picture, frame rate, bitrate cap and what gives way on a short line.
A phone takes the first line it can do; a codec that fails on a phone is skipped there and the next
line is taken; with no line left it sends H.264. A setting pushed to one phone wins on that phone
until "studio preferences" is pressed in its panel. The engineer may change these technical settings
of a PCR; everything else about a PCR stays with the admin.

**Decided 2026-11-11:** the **engineer's approval** is back, as a per-PCR setting that is on by
default (`settings.approval`). The engineer approves each guest on the engineer page after checking
line and picture (`GuestState.ready`); without it the server refuses "send to studio" and "on air".
An approval withdrawn while the guest is on air does not cut them: it stops the next "on air". Only
the engineer (or the admin) may give it; the producer sees "approved" or "not approved" on the guest.
The engineer page was redrawn around this: per studio its two sources (return feed, producer) and one
row per guest whose meters are always in view as bars with their limits marked, in two groups.
**Line**: the media server's verdict, packet loss, network delay (round trip) and the delay at the
engineer's desk. **Picture**: bitrate against its cap, resolution against the camera's, frame rate
against what was asked. Green is fit for air, amber to be watched, red not fit; the worst meter
decides the guest's verdict (`apps/web/src/lib/quality.ts`, limits in `LIMITS`). The phone sends
its numbers every two seconds (data topic `wc.live`); numbers older than eight seconds turn grey and
are not judged. From this date the pages carry **no guide text**: what only explains opens in a
balloon. Where a phone sends several copies of its picture (the full-size one and the two small
ones beside it), the row lists every copy under the picture's meters: its size, its bitrate and a
bar against what it may send (the cap for the full-size copy, its own ceiling for a small one;
`apps/web/src/lib/copies.ts`), "paused" for a copy nobody takes.

**Decided 2026-11-11 (the guest's screen):** the admin designs the guest's screen in Admin under
"Guest screen" (per studio at first; since the evening of the same day one design for the whole
station, see below). The screen is **nine sections, three by three**. Widgets fill it, by
drag and drop:

- **Pictures** take whole sections and do not lie on top of each other: the studio feed (2×2, 1×1,
  or full screen, when it lies under the others), the guest's own camera (1×1) and the multiview
  (one section high, three wide).
- **Overlays** float over the pictures, docked in a section against the nearest edges of the screen:
  the tally (where the guest is, STAND BY, ON AIR; it cannot be removed), the producer's cue banner
  (one to three sections wide, shown only while there is a cue) and the guest's buttons: mute, raise
  hand, help, full screen. Overlays in one section stand side by side.

There is **one design per number of guests on the screen**, one to eight: a guest alone, or a
multiview group of that size (the server tells each phone the number, attribute `wc.guests`). The
station's own designs: alone, the studio feed full screen with the own camera bottom left and the
buttons bottom right; in a group, the studio feed 2×2 top left, the own camera top right, the
buttons under it and the multiview along the bottom. A saved design goes to the connected phones
at once (data topic `wc.screen`) and to the others with their link. The model and its rules are
`packages/shared/src/screen.ts`; the phone draws it in `apps/web/src/guest/Call.tsx`, and the
designer's small screen uses the phone's own styles, to scale. The multiview strip now has the
shape of its widget (three sections by one, 960x180 for a 540p return, never wider than 1280), which
replaces the fixed place described below. The old bottom bar with text buttons and the "info"
panel are gone from the guest's screen: the engineer has the numbers.

The same day the **Admin page** was redrawn to the same standard: one studio is in hand at a time,
picked from tabs at the top (a dot shows its return feed's state, a mark shows unsaved changes; "New
studio" is the last tab). Below: the studio's card (name, output slots and their names, the two
rules as switches, the return feed's source, picture and bitrate, the invite languages; one Save,
Undo, and "Close studio"), the studio PC's page addresses with copy buttons, and the guest screen
designer for that studio. The NDI gateway, which serves every studio, has its own card last: its
state, the senders it sees as a table, and the senders on other networks.

**This station** and the **contact book** followed. This station: two desks side by side, the
producer's (camera, microphone) and the return feed's (capture input, mix-minus input); each
choice shows what it gives, the camera's live picture and the input's live level, so the right
input is picked by looking and listening. A device that is unplugged stays in the lock, marked
"not connected". Contacts: a card per guest with a round mark, the language, the name on screen,
and each way to reach them as a chip that opens its own app where the value allows it (a phone
number dials, an international WhatsApp number opens wa.me, a Telegram user name opens t.me,
Skype and email open theirs; `apps/web/src/lib/contact.ts`); search and "Add contact" at the top,
editing in place.

**The producer's room** was redrawn last. The guest's way runs from left to right in three lanes:
the **door** (with the list of everyone seated in the studio: where each is right now, their link
to copy, and one line that adds a guest, either a contact from the book or a name of their own),
the **green room**, and the **studio** with its slots (an empty slot is one slim line; a slot on
stand by is ringed amber, on air red; a dot says whether its output page is open). On a narrow
screen the lanes stack, the studio first. The top of the page counts who is where and holds Join,
Talk to all and Sound. Every guest has the same card: the picture with name, tally, a raised hand
and a call for help on it; under it the guest's marks (approved, MV, slot, line) and what is done
with them in that place (sees and hears in the green room, tally and IFB in the studio, the move
on or back), the cues, and the tools. The phone's settings open in a drawer beside the room.
"Show out" and "remove" take two presses (the first arms the button for three seconds) instead of
a dialog. The full-screen view of one guest is as it was.

**The phone's panel** (`apps/web/src/staff/PhonePanel.tsx`, beside the producer's room and on the
engineer's page) shows what the phone sends and what arrives at the desk side by side (bitrate
against its cap and what holds it back, picture, codec and encoder, the small copies, loss, round
trip, jitter, buffer, path), values out of range in amber or red. Under it the bandwidth test with
its progress, its steps as a table and the cap it recommends; then the settings in groups, each
choice a row with the one in force lit: picture (size, frame rate, what the phone keeps when short,
bitrate cap, copies), connection (codec, path; marked "reconnects"), camera and sound (front or
back, exposure, holds, zoom, light, microphone, voice processing), and the phone's page (reload,
studio preferences). The commands sent to the phone are the same as before. The numbers as one
block of text stay under "All numbers".

**The top bar, the return feed page and the output page** closed the round. The top bar: the logo
leads home, the pages are tabs with the current one marked, the server's load is a small meter
(test phase), and the person is a round mark with the rest in a balloon; once sign-in exists the
admin's pages show only to the admin. The return feed page shows what goes out: the picture, the
level of the mix-minus, the stream's numbers as tiles, the locked sources and who is in the room.
The output page keeps a **clean frame**: while a guest is on, nothing lies over the picture; the
page's state shows on the slate, and for three seconds when the mouse moves (or always with
`?stats=1`).

**Decided 2026-11-11 (evening): languages, cues, and one guest screen for the station.**

- **Languages**, in the station's order: English, Bahdini, Sorani, Arabic
  (`packages/shared/src/languages.ts`). Bahdini is the code `ku`, written in Arabic letters, right
  to left; until this day the same code was Kurmanji in Latin letters, which is no longer offered,
  as Turkish is not (it never had a page). A guest seated without a choice gets Bahdini.
- **Cues** are the station's, edited by the admin under "Cues": one row per cue, one text per
  language, in the order they stand on the producer's desk (`packages/shared/src/cues.ts`,
  `station_settings` key `cues`, `GET`/`PUT /cues`). The desk names a cue by its English text
  and sends it in the language of the guest's page; without a text in that language the English
  one goes out. The station starts with five cues in all four languages.
- **The guest's screen is one design for the whole station** (`station_settings` key
  `guest_screen`, `GET`/`PUT /screen`, `apps/api/src/routes/station.ts`). A saved design goes to
  the connected phones of every studio. Until the admin saves one, a design a studio was given
  earlier that day carries over (the first such studio by name), else the station's own.

The Kurdish and Arabic texts (the guest's page and the cues) were written by the assistant and
need a native speaker's eye.

The same day: the guest's link has **no join button**. Opening it connects at once with the front
camera and the phone's microphone; the device check appears only when that fails. The page goes
full screen on the guest's first touch or when the phone is turned (no browser lets a page do it by
itself, and an iPhone not at all); a line on the screen says so until then, and a button leaves and
returns.

Also the same day: a guest's frame rate is **25 or 50**. 30 is gone: the station runs at 50 Hz, where
25 fits exactly and 30 never does. 50 is asked of the camera and sent when the camera can; a phone
camera usually runs at 30 or 60, so the phone reports its camera's top rate and what really arrives.

The first page, `/app`, shows the station now (studios, guests connected, on air, return feeds, one
line per studio) above the way to each desk: producer, engineer, contacts, admin.

## The places

**Lobby (the door).** The guest opens the link and is connected at once (since 2026-11-10; the
check of camera, microphone and network shows only when the camera or microphone did not start).
Then they wait. They hear nothing and nobody hears them
unless the producer or engineer opens a preview. The screen says who they are waiting for and shows a
"help" button that pings the engineer.

**Green Room.** The working place. Producer and engineer see every green-room guest as a tile with live
picture, level meter and a connection light. For each guest, independently, they can:

- **Talk** (push-to-talk, latch on long press). Producer and engineer each have their own talk track;
  a guest hears both mixed when both are talking.
- **Face to face**: the producer's camera goes to that guest full-screen for a pre-interview.
- **Multiview (MV)**, since 2026-11-10, in place of the per-guest picks of the day before: tick MV on
  the guests who belong together. They are one group: each sees the others as small pictures along the
  bottom of the screen, they hear each other, and when the producer talks to one of them all of them
  hear it. A guest not ticked is outside. The tick is kept through a trip to the studio.
  **One multiview stream** (same day): where the gateway publishes the return, the guests' pictures
  are not sent to each other at all. The gateway receives the group's cameras (their smallest copy)
  and draws them into one wide picture, the multiview strip: a dark panel with one to eight pictures
  laid out to be as large as fits (two fill it, then three or four in a row, then two rows). There
  is one strip for the whole group, each guest's own picture in it too. It goes out as its own small
  stream: H.264 like the return, the shape of the multiview widget (three sections wide, one high;
  until 2026-11-11 two thirds by one third), a quarter of the return's bitrate cap (within 150 to
  500 kbit/s), about 12 frames a second.
  The phone lays the strip over whatever the guest sees, the return, the producer's camera or black.
  Its place is fixed. Think of the screen picture as nine equal parts: the bottom-left part is the
  phone's own camera, and the strip covers the bottom-centre and bottom-right parts. The return
  itself is never touched: decoded once, encoded once, the same for everyone. The sound of the group
  always goes direct. A PCR without a gateway return, and the first moment before the strip runs,
  fall back to the small direct copies (180p, at most 150 kbit/s per guest shown), which the phone
  lays to the right of the guest's own picture.
  (The first build of that day drew the pictures into a second full-size copy of the return instead.
  It was replaced the same day: a guest on Black or the PCR had to download the whole return to show
  a third of it, and the server encoded the return twice.)
- **Studio sound** on or off: lets the guest hear the studio mix-minus to get the feel of the show.
- **Program picture** on or off.
- **Cue**: a text message that appears on the guest's screen until dismissed.
- **Slot**: assign the guest to studio output slot 1..N (see below).
- **Hand off** to the studio (enabled when a slot is set and, if required, the engineer has marked ready).

The engineer's tile view has an extra panel per guest, described under "Engineer's toolkit".

**Studio.** The guest is connected to the vision mixer on their slot. They hear the studio mix-minus and
the other guests who are in the Studio, see the program picture, see the tally, and get text cues. They
do not hear the producer or engineer. The producer and engineer still see and hear the guest (monitor
only). Tally has two states: **standby** (amber, on the mixer but not on air) and **ON AIR** (red).

The optional exception is **IFB override**: an engineer-only button that forces talk to a studio guest
in an emergency. It is off by default and whether the station allows it at all is an open point below.

**Back to Green Room.** The producer presses "bring back". The output slot cuts to a slate, the routing
switches back, and the guest gets a card: "You are back with us". The producer can thank them, hold them
for another segment, or let them go.

**Exit.** A thank-you page. The producer gets the ISO recording links for the segments that were in
the Studio.

## Who hears and sees whom

| The guest… | Lobby | Green Room | Studio |
|---|---|---|---|
| hears producer voice | no | when talked to, or when one of their multiview group is | no (IFB override only) |
| hears engineer voice | no | yes | no (IFB override only) |
| hears studio mix-minus | no | if switched on | always |
| sees and hears other guests | no | the multiview group, when ticked MV | only guests in the Studio |
| sees program picture | no | if switched on | always |
| sees producer camera | no | in face-to-face | no |
| gets tally | no | no | standby / ON AIR |
| gets text cues | "please wait" only | yes | yes |
| is seen and heard by producer and engineer | on preview | always | always (monitor) |
| is on a studio output | no | no (slot shows slate) | yes, on their slot |

Two rules never bend: a talk track can never reach a studio output, and a guest can never hear
themselves. Both are enforced on the server, not only in the pages (see "How it maps to LiveKit").

The producer and the engineer see and hear every guest in every place and may see the program picture.
They never get the studio mix-minus: their console sits in the PCR, where the programme sound is on the
room's monitors already, and a second copy from the PC would come late and double it. The engineer
also gets a producer's talk track and face camera, to check what a guest is told and shown; a producer
never gets another producer's or the engineer's.

## Studio slots

Outputs are **fixed slots**, not guest names. Slot 1 is always the same SDI output and the same input
on the vision mixer, so the director's panel never changes between shows. The producer assigns a guest
to a slot in the green room; an empty slot shows a branded slate with the slot number; when a guest is
handed off, the slot cuts to that guest. The multiview page shows every slot plus small green-room tiles
so the director can see who is waiting. Phase 1 starts with 4 slots; the number is a setting.

## Hand-off, step by step

1. Engineer runs the checks and marks the guest **ready** (or the program setting skips this).
2. Producer assigns a slot and presses **hand off**.
3. The guest sees a three-second card "Going to the studio", during which the green-room audio fades
   out and the studio mix-minus fades in. No hard cut in the guest's ear.
4. The slot page cuts from the slate to the guest. Tally goes **standby**. The guest's ISO recording starts.
5. Studio (or producer, in phase 1) sets **ON AIR**. The guest sees red.
6. Segment ends. ON AIR is cleared, producer presses **bring back**. Slot returns to the slate, recording
   stops, routing returns to the green room, the producer talks to the guest.

Every step is logged with time and user, so a bad moment on air can be traced afterwards.

## Guest's screen

One layout for every place, so nothing jumps around:

- Program picture large (or the producer's face, or a holding card in the lobby).
- Self-view small in a corner; tap to hide.
- A status bar: place name, tally colour, network light, mute state.
- A cue banner that slides in with the text and stays until tapped.
- Three buttons only: mute, raise hand, help.
- Languages: Kurdish, Arabic and English with right-to-left layout from day one. The producer picks the
  guest's language when making the link.

## Producer's screen

- The list of PCRs the admin built; inside one: the door (waiting guests), the green room grid, the
  studio strip with the N slots (each named after its output), and whether the return feed is on.
- Guests and links: seat a contact from the contact book (search by name, number or handle) or a one-off
  name, copy the link, send it over WhatsApp or Telegram from the contact's details, remove the seat.
- Per-guest card in the green room: **guest sees** Black / PCR / Studio with the **MV** tick, **guest hears** me / studio,
  send to studio; in the studio: stand by, on air, bring back; cues everywhere.
- A "talk to all" button and a sound on/off for the producer's own monitoring.
- No device pickers: the admin locks the camera, microphone and capture inputs per PC ("This station").

## Engineer's toolkit

The engineer's screen is the producer's screen plus a detail panel per guest:

- **Live numbers**: round trip, jitter, packet loss up and down, bitrate, resolution and frame rate
  actually sent, codec, simulcast layer the studio is receiving, direct or relay, network type
  (Wi-Fi, 4G, 5G), device model, browser, battery. A 10-minute sparkline per number.
- **Tests**: bandwidth probe (publish at full rate for 20 s and watch loss), echo test (the guest hears
  their own voice back for 5 s to judge the microphone), lip-sync card, a "turn your phone sideways" cue.
- **Remote settings** on the guest's device: quality preset (720p30, 540p30, 360p30, audio-only),
  audio mode (voice, music), noise suppression, microphone gain, camera choice, force relay, restart
  connection. Each change is acknowledged by the guest's page and logged.
- **Talk** independent of the producer; **ready** switch; notes field that the producer sees.
- A station-wide view: media server load, TURN use, every live episode's worst guest at the top.

## How it maps to LiveKit

- **One LiveKit room per episode.** The places are states, not separate rooms, so a hand-off never
  reconnects anything: the output page is already subscribed and simply swaps the slate for the guest.
  Participant identities carry the role: `guest:<id>`, `producer:<user>`, `engineer:<user>`,
  `studio:return`, `out:slot-1`.
- **State lives in participant attributes** set only by connect-api: `place`, `tally`, `slot`, `mv`,
  `studio_sound`, `program`, `ready`. Attributes survive a reconnect, so a guest who drops on air comes
  back on air with the right tally.
- **Routing is enforced by the server.** Every client runs with automatic subscription off. On each state
  change connect-api recomputes the matrix above and tells LiveKit which tracks each participant may
  receive. Talk tracks also carry per-track subscription permissions that list only the allowed guests,
  and output participants have no permission to subscribe to talk tracks at all. Three locks, so a page
  bug cannot put a talk track on air.
- **Talk** is one microphone track per producer and per engineer, marked as talkback. A guest's browser
  mixes whatever talk tracks it is allowed to hear, so two people can talk to one guest at once.
- **Studio mix-minus and program picture** are published by the gateway as the participant `studio:return`.
  Studio guests always receive both; green-room guests receive them when switched on.
- **Tally** is an attribute; **cues** and **engineer commands** are reliable data messages with an
  acknowledgement, so the sender sees "delivered" or "not delivered".
- **Stats** are gathered by the guest's page every two seconds and sent as data messages to the engineer;
  connect-api keeps one sample per ten seconds for the log, plus LiveKit's own join, leave and quality
  webhooks.
- **Recording** is a per-guest ISO egress that connect-api starts on entering the Studio and stops on
  bring-back. The green room is not recorded unless a producer switches it on for a pre-interview.
- **Picture quality**: guests publish three simulcast layers; green-room tiles take the lowest, the slot
  pages take the highest; the slot pages set a receive buffer of around 400 ms so a bad burst on the
  guest's network is absorbed instead of freezing on air (the SRT-style cushion from the earlier note).

## Hosting and domains

- **A dedicated VM inside the station** (decided 2026-11-05, evening; the first deployment ran on the
  aaPanel server for one afternoon and was moved off it). The VM `connect` at 10.0.0.41 runs Nginx on
  TCP 8443 for `connect.waar.work` and `media.connect.waar.work`, the Node app, and LiveKit in Docker.
  Links carry the port (`https://connect.waar.work:8443/…`); the aaPanel sites answer plain 443 with a
  redirect to 8443, so a link without the port still works. See `deploy/vm/README.md`.
- **Certificates come from aaPanel.** Public ports 80 and 443 belong to the aaPanel server and
  waar.work's DNS is at GoDaddy without API access, so Let's Encrypt can only be done there. aaPanel
  issues and renews, an hourly job copies the files to the VM, and a systemd path unit reloads Nginx.
- **TURN on UDP 3478 only.** TURN over TLS on 443 is impossible on one public IP that aaPanel owns; UDP
  3478 plus the TCP 7881 fallback covers mobile, home and most office networks. The strict firewall
  that allows only TCP 443 also cannot open the page on 8443; that guest switches to mobile data. A
  cloud VPS with its own IP would remove both limits if they ever matter.
- **The station router** must forward TCP 8443, TCP 7881, UDP 7882 and UDP 3478 to 10.0.0.41, reserve
  that address in DHCP, and answer `connect.waar.work` and `media.connect.waar.work` with 10.0.0.41 for
  devices inside the station (its LAN DNS currently sends all of `*.waar.work` to the aaPanel server).
- The web pages load the media server address from configuration, so the media host can stay under
  `waar.work` whichever web domain the guest used.
- The studio gateway PC needs a wired line to the internet with priority on the station router.

## Data model (since 2026-11-08)

PCR (name, settings: slots, output names, ready required, IFB allowed, languages; LiveKit room) ·
Contact (name, on-screen name for CasparCG, language, phone, WhatsApp, Telegram, Skype, email, other,
notes) · Guest = a contact (or a bare name) seated in a PCR · Invite (token, expiry, uses) ·
Event log (who did what, when) · Stats sample · User (role). The station lock (which devices a PC
uses) lives in that PC's browser, set by the admin.

## What phase 1 builds from this plan

1. Room, attributes and the routing engine in connect-api.
2. Guest page: check, lobby, green room, studio, exit, three languages.
3. Producer page: links, door, green-room grid, slots, hand off and bring back, cues.
4. Engineer panel: numbers, tests, remote settings, independent talk, ready switch.
5. Output pages: slot pages with slates, multiview, manual tally.
6. ISO recording on studio segments.
7. Hosting on aaPanel with both domains, media server on its own VPS.

Phase 2 adds tally from the mixer, SIP phone fallback, CasparCG names, scheduled links, the station-wide
engineer view and the call-quality history.

## Open points

Decided 2026-11-06: **NDI in and out** (guests leave the gateway as NDI sources, the program return arrives as NDI). Still open from APPROACH.md: which mixer and console and whether the console gives an aux bus
without the guests; vMix or OBS; where most guests are; who operates during the show.

New from this plan:

1. Is the engineer's **IFB override** to a guest on air allowed, or is "no voice on air" absolute?
2. How many **slots** on day one, which SDI outputs, and which mixer inputs?
3. Must the engineer's **ready** mark be required for a hand-off, or optional per program?
4. Which **languages** for the guest page: Kurdish (Kurmanji, Sorani, both?), Arabic, English, Turkish?
5. Producer and engineer **login**: station email and password, or an existing station account system?
