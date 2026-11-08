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
with the mix-minus on it) is published from the studio PC by the **return feed page**; each slot has an
**output page** on the studio PC for now, NDI or SDI output later from the same place.

**Decided 2026-11-08 (later the same day):** no engineer screen and no engineer approval for now;
the producer does it all, including the connection check and the settings of the guest's phone
(picture size, frame rate, bitrate cap, codec, relay, front/back camera, voice processing, mute,
reload). No tables in the green room. No slot choice: "send to studio" takes the first free slot,
"bring back" frees it. The engineer role stays in the API for a later phase.

## The places

**Lobby (the door).** The guest opens the link, confirms their name, and the page checks camera,
microphone and network for about ten seconds. Then they wait. They hear nothing and nobody hears them
unless the producer or engineer opens a preview. The screen says who they are waiting for and shows a
"help" button that pings the engineer.

**Green Room.** The working place. Producer and engineer see every green-room guest as a tile with live
picture, level meter and a connection light. For each guest, independently, they can:

- **Talk** (push-to-talk, latch on long press). Producer and engineer each have their own talk track;
  a guest hears both mixed when both are talking.
- **Face to face**: the producer's camera goes to that guest full-screen for a pre-interview.
- **Table**: put two or more guests in a group so they hear and see each other; the rest do not.
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
| hears producer voice | no | yes | no (IFB override only) |
| hears engineer voice | no | yes | no (IFB override only) |
| hears studio mix-minus | no | if switched on | always |
| hears other guests | no | only their table | only guests in the Studio |
| sees program picture | no | if switched on | always |
| sees producer camera | no | in face-to-face | no |
| gets tally | no | no | standby / ON AIR |
| gets text cues | "please wait" only | yes | yes |
| is seen and heard by producer and engineer | on preview | always | always (monitor) |
| is on a studio output | no | no (slot shows slate) | yes, on their slot |

Two rules never bend: a talk track can never reach a studio output, and a guest can never hear
themselves. Both are enforced on the server, not only in the pages (see "How it maps to LiveKit").

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
- Per-guest card in the green room: **guest sees** nothing / me / studio, **guest hears** me / studio,
  table, slot, send to studio; in the studio: stand by, on air, bring back; cues everywhere.
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
- **State lives in participant attributes** set only by connect-api: `place`, `tally`, `slot`, `table`,
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
