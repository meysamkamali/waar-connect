// One guest in the producer's view: picture, state, the controls for their place, and the connection
// panel with the phone's own report and the settings the producer can push to it.
// In the green room the producer chooses what the guest sees (Black, the PCR, the Studio return),
// hears (the producer, the studio mix-minus) and whether they are in the multiview group (MV), then
// sends them to the studio; the server takes the first free slot. The full-screen view (GuestFocus)
// lays out the same switches on their own, without the connection panel.
import type { GuestState } from '@waar-connect/shared';
import { useState } from 'preact/hooks';
import type { GuestRecord, RoomAction } from '../api.ts';
import { VideoView } from '../components/media.tsx';
import { evLabel, type CameraControls, type CameraState } from '../lib/camera.ts';
import { CODEC_LABELS, CODECS, describeCodecs, SUPPORT_LABELS } from '../lib/codecs.ts';
import { DEGRADE_DEFAULT, DEGRADE_LABELS, describeReport, phoneModel, recommendedCap, SWEEP_STEPS, type Degrade, type GuestReport } from '../lib/report.ts';
import { formatSummary } from '../lib/stats.ts';
import { BUILD } from '../lib/version.ts';
import type { StaffTile } from './session.ts';

export type Sees = 'none' | 'me' | 'studio';

export interface GuestCardProps {
  state: GuestState;
  record: GuestRecord | undefined;
  tile: StaffTile | undefined;
  report: GuestReport | undefined;
  connected: boolean;
  outputNames: string[];
  ifbAllowed: boolean;
  /** This studio sends a guest to air only with the engineer's approval (`state.ready`). */
  needsApproval: boolean;
  ifb: boolean;
  /** The producer's voice is routed to this guest. */
  hearsMe: boolean;
  sees: Sees;
  /** Names of the other guests in the multiview group, when this guest is in it. */
  mvWith: string[];
  hand: boolean;
  help: boolean;
  onAction: (action: RoomAction) => void;
  onHearMe: (on: boolean) => void;
  onSee: (mode: Sees) => void;
  onClearHelp: () => void;
  /** Opens the full-screen view of this guest. */
  onFocus?: () => void;
}

const QUICK_CUES = ['30 seconds', 'Wrap up', 'Look at the camera', 'Speak louder', 'You are next'];

export function guestName(p: Pick<GuestCardProps, 'record' | 'state'>): string {
  return p.record?.displayName ?? p.state.identity.replace(/^guest:/, '');
}

/** The picture with the name, tally, slot, flags and quality on top. */
export function GuestVideo(p: GuestCardProps & { className?: string }) {
  const g = p.state;
  const slotName = (n: number) => p.outputNames[n - 1] ?? `Guest ${n}`;
  return (
    <div class={`guest-video ${p.className ?? ''}`}>
      <VideoView track={p.tile?.video ?? null} />
      {!p.tile?.video && <div class="guest-novideo">{p.connected ? 'no picture yet' : 'not connected'}</div>}
      <div class="guest-overlay">
        <span class="name">{guestName(p)}</span>
        {g.place === 'studio' && <span class={`tally ${g.tally}`}>{g.tally === 'onair' ? 'ON AIR' : 'STAND BY'}</span>}
        {p.needsApproval && g.place !== 'left' && (
          <span class={`slot approval ${g.ready ? 'yes' : 'no'}`} title={g.ready ? 'The engineer approved this guest for air' : 'The engineer has not approved this guest yet: they cannot go to the studio'}>
            {g.ready ? 'approved ✓' : 'not approved'}
          </span>
        )}
        {g.place === 'green' && g.mv && (
          <span class="slot mv" title={p.mvWith.length ? `In the multiview with ${p.mvWith.join(', ')}` : 'In the multiview, alone so far'}>
            MV
          </span>
        )}
        {p.hand && <span class="flag">✋ hand</span>}
        {p.help && (
          <button class="flag bad" onClick={p.onClearHelp}>
            help!
          </button>
        )}
        {g.slot !== null && (
          <span class="slot">
            slot {g.slot} · {slotName(g.slot)}
          </span>
        )}
        {p.tile && <span class={`slot quality-${p.tile.quality}`}>{p.tile.quality}</span>}
        {p.onFocus && (
          <button class="flag focus-btn" title="Full screen" onClick={p.onFocus}>
            ⛶ full screen
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The camera controls this phone said it offers (Android Chrome: most of them; iPhone: usually none);
 * each change goes to the phone as a `cam` command and the phone reports back at once. The locks are
 * the useful part live: a phone's automatic exposure and white balance hunt when the guest moves.
 */
function CameraRow({ can, now, cmd }: { can: CameraControls; now: CameraState; cmd: (command: Record<string, unknown>) => void }) {
  const ec = can.exposureCompensation;
  const zoom = can.zoom;
  const ev = now.exposureCompensation ?? 0;
  const z = now.zoom ?? zoom?.min ?? 1;
  const slider = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
  return (
    <div class="row settings">
      <span class="muted small">lens</span>
      {ec && (
        <label class="inline" title="Exposure offset: brighter or darker than the camera's own choice">
          exposure {evLabel(ev)}
          <input type="range" min={ec.min} max={ec.max} step={ec.step || 0.1} value={ev} onChange={(e) => cmd({ cam: { exposureCompensation: slider(e) } })} />
        </label>
      )}
      {can.exposureLock && (
        <button class={`chip ${now.exposureLocked ? 'on' : ''}`} title="Hold the exposure where it is now, so the picture does not pump when the guest moves" onClick={() => cmd({ cam: { exposureLock: !now.exposureLocked } })}>
          {now.exposureLocked ? 'exposure locked' : 'lock exposure'}
        </button>
      )}
      {can.whiteBalanceLock && (
        <button class={`chip ${now.whiteBalanceLocked ? 'on' : ''}`} title="Hold the colour balance where it is now" onClick={() => cmd({ cam: { whiteBalanceLock: !now.whiteBalanceLocked } })}>
          {now.whiteBalanceLocked ? 'white balance locked' : 'lock white balance'}
        </button>
      )}
      {can.focusLock && (
        <button class={`chip ${now.focusLocked ? 'on' : ''}`} title="Hold the focus where it is now" onClick={() => cmd({ cam: { focusLock: !now.focusLocked } })}>
          {now.focusLocked ? 'focus locked' : 'lock focus'}
        </button>
      )}
      {zoom && (
        <label class="inline" title="The phone's own zoom">
          zoom {z.toFixed(1)}×
          <input type="range" min={zoom.min} max={zoom.max} step={zoom.step || 0.1} value={z} onChange={(e) => cmd({ cam: { zoom: slider(e) } })} />
        </label>
      )}
      {can.torch && (
        <button class={`chip ${now.torch ? 'on' : ''}`} title="The phone's LED as a fill light (back camera)" onClick={() => cmd({ cam: { torch: !now.torch } })}>
          {now.torch ? 'light on' : 'light'}
        </button>
      )}
      <button class="chip" title="Everything back to the camera's automatic behaviour" onClick={() => cmd({ cam: { auto: true } })}>
        auto
      </button>
    </div>
  );
}

/**
 * The technical side of one guest's phone: what arrives here, what the phone says about itself, the
 * bandwidth test, and every setting that can be pushed to it. The producer's card and the engineer's
 * page both show it.
 */
export function PhonePanel({ tile, report: r, cmd }: { tile: StaffTile | undefined; report: GuestReport | undefined; cmd: (command: Record<string, unknown>) => void }) {
  const processing = r ? r.audio.ec || r.audio.ns || r.audio.agc : true;
  const sweep = r?.test;
  const recommended = recommendedCap(sweep);
  const stale = r !== undefined && r.build !== BUILD;
  return (
    <>
    <pre class="stats">
      {formatSummary('IN ', tile?.stats)}
      {'\n'}
      {r ? `${formatSummary('UP ', r.up)}\nphone: ${describeReport(r)}\n${describeCodecs(r.codecs)}
${phoneModel(r.ua)}${r.camera ? ` · ${r.camera}` : ''}${r.error ? `\nlast error: ${r.error}` : ''}` : 'phone: no report yet'}
    </pre>
    {stale && (
      <p class="help bad" style={{ margin: '4px 0' }}>
        The phone runs an older page (build {r.build ?? 'unknown'}; this screen is {BUILD}). New buttons do nothing there until it reloads.{' '}
        <button class="link" onClick={() => cmd({ reload: true })}>
          Reload the phone page
        </button>
      </p>
    )}
    <div class="row">
      <button class="btn secondary small" onClick={() => cmd({ check: true })}>
        Check now
      </button>
      <button class="btn small" onClick={() => cmd({ test: { steps: SWEEP_STEPS, seconds: 8 } })} disabled={sweep?.running === true}>
        {sweep?.running ? `Testing… step ${sweep.step + 1} of ${sweep.steps.length}` : `Run bandwidth test (${SWEEP_STEPS[0]} → ${SWEEP_STEPS[SWEEP_STEPS.length - 1]} kbit/s, about ${SWEEP_STEPS.length * 8} s)`}
      </button>
      <span class="muted small">{r ? `report ${Math.round((Date.now() - r.at) / 1000)} s ago` : ''}</span>
    </div>
    {sweep && sweep.results.length > 0 && (
      <table class="table sweep">
        <thead>
          <tr>
            <th>cap</th>
            <th>sent</th>
            <th>rtt</th>
            <th>loss</th>
            <th>fps</th>
            <th>limit</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sweep.results.map((s) => (
            <tr key={s.target} class={s.ok ? 'ok' : 'bad'}>
              <td>{s.target}</td>
              <td>{s.kbps} kbit/s</td>
              <td>{s.rttMs !== undefined ? `${s.rttMs} ms${s.rttMaxMs !== undefined && s.rttMaxMs > s.rttMs ? ` (max ${s.rttMaxMs})` : ''}` : '—'}</td>
              <td>{s.lossPct}%</td>
              <td>{s.fps ?? '—'}</td>
              <td>{s.limited ?? '—'}</td>
              <td>{s.ok ? '✓' : '✗'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    {sweep && !sweep.running && sweep.results.length > 0 && (
      <div class="row">
        {recommended !== undefined ? (
          <>
            <span class="small">Recommended cap: {recommended} kbit/s</span>
            <button class={`chip ${r?.kbps === recommended ? 'on' : ''}`} onClick={() => cmd({ kbps: recommended })}>
              apply {recommended} kbit/s
            </button>
          </>
        ) : (
          <span class="small bad">Even {sweep.steps[0]} kbit/s did not pass: try force relay (some networks pass only the relay port), or a better network.</span>
        )}
      </div>
    )}
    <div class="row settings">
      <span class="muted small">picture</span>
      {[1080, 720, 540, 360].map((h) => (
        <button class={`chip ${r?.height === h ? 'on' : ''}`} key={h} onClick={() => cmd({ res: h })}>
          {h}p
        </button>
      ))}
      {[25, 50].map((f) => {
        // A phone camera runs at 30 or 60, rarely a true 50: the chip shows what was asked, the report what arrives.
        const asked = r?.fpsAsked ?? (r?.fps ? Math.round(r.fps) : undefined);
        const short = f === 50 && r?.fpsMax !== undefined && r.fpsMax < 50;
        const title =
          f === 25
            ? "The station's own rate: each frame is shown twice"
            : short
              ? `This camera says it does at most ${Math.round(r!.fpsMax!)} fps: the phone sends what it can`
              : 'Twice the frames: needs about one and a half times the bitrate, and a camera that can do it';
        return (
          <button class={`chip ${asked === f ? 'on' : ''}`} key={f} title={title} onClick={() => cmd({ fps: f })}>
            {f} fps{short ? ` (camera: ${Math.round(r!.fpsMax!)})` : ''}
          </button>
        );
      })}
      {r?.fps !== undefined && r.fpsAsked !== undefined && Math.abs(r.fps - r.fpsAsked) > 2 && <span class="muted small">camera gives {Math.round(r.fps)} fps</span>}
    </div>
    <div class="row settings">
      <span class="muted small">when short</span>
      {(Object.keys(DEGRADE_LABELS) as Degrade[]).map((d) => (
        <button class={`chip ${(r?.degrade ?? DEGRADE_DEFAULT) === d ? 'on' : ''}`} key={d} title={d === 'resolution' ? 'drops frames first, keeps the size' : d === 'framerate' ? 'shrinks the picture first, keeps the motion' : 'lets WebRTC decide'} onClick={() => cmd({ degrade: d })}>
          {DEGRADE_LABELS[d]}
        </button>
      ))}
    </div>
    <div class="row settings">
      <span class="muted small">bitrate cap</span>
      {SWEEP_STEPS.map((k) => (
        <button class={`chip ${r?.kbps === k ? 'on' : ''}`} key={k} onClick={() => cmd({ kbps: k })}>
          {k} kbit/s
        </button>
      ))}
    </div>
    <div class="row settings">
      <span class="muted small">codec (reconnects)</span>
      {CODECS.map((c) => {
        const support = r?.codecs?.[c] ?? 'unknown';
        const mark = support === 'hw' ? ' ⚡' : support === 'sw' ? ' · software' : support === 'no' ? ' · not supported' : support === 'failed' ? ' ⚠ failed' : '';
        const off = support === 'no' || support === 'failed';
        return (
          <button class={`chip ${r?.codec === c ? 'on' : ''} ${off ? 'off' : ''}`} key={c} disabled={off} title={`${CODEC_LABELS[c]}: ${SUPPORT_LABELS[support]} encoder on this phone`} onClick={() => cmd({ codec: c })}>
            {CODEC_LABELS[c]}
            {mark}
          </button>
        );
      })}
      <span class="muted small">path</span>
      <button class={`chip ${r && !r.relay ? 'on' : ''}`} title="UDP straight to the media server, TCP as fallback: the normal way" onClick={() => cmd({ relay: false })}>
        direct if possible
      </button>
      <button class={`chip ${r?.relay ? 'on' : ''}`} title="Test tool: only through the station's TURN relay (UDP 3478). If the relay cannot be reached from the phone's network, the phone goes back to direct by itself." onClick={() => cmd({ relay: true })}>
        force relay (reconnects)
      </button>
    </div>
    <div class="row settings">
      <span class="muted small">copies</span>
      <button class={`chip ${r && r.small !== false ? 'on' : ''}`} title="full size plus 360p and 180p copies: small tiles and weak viewers take a small copy" onClick={() => cmd({ small: true })}>
        full + small
      </button>
      <button class={`chip ${r?.small === false ? 'on' : ''}`} title="only the full-size copy: for a phone whose encoder ignores the small copies' caps" onClick={() => cmd({ small: false })}>
        full only
      </button>
    </div>
    <div class="row settings">
      <span class="muted small">camera</span>
      <button class={`chip ${r?.facing === 'user' ? 'on' : ''}`} onClick={() => cmd({ facing: 'user' })}>
        front
      </button>
      <button class={`chip ${r?.facing === 'environment' ? 'on' : ''}`} onClick={() => cmd({ facing: 'environment' })}>
        back
      </button>
      <span class="muted small">voice processing</span>
      <button class={`chip ${processing ? 'on' : ''}`} onClick={() => cmd({ audio: { ec: true, ns: true, agc: true } })}>
        on
      </button>
      <button class={`chip ${!processing ? 'on' : ''}`} onClick={() => cmd({ audio: { ec: false, ns: false, agc: false } })}>
        off (music, studio mic)
      </button>
    </div>
    {r?.cam && <CameraRow can={r.cam.can} now={r.cam.now} cmd={cmd} />}
    <div class="row settings">
      <button class="chip" onClick={() => cmd({ mute: !(r?.micOn ?? true) })}>
        {r?.micOn === false ? 'unmute mic' : 'mute mic'}
      </button>
      <button class="chip" onClick={() => cmd({ reload: true })}>
        reload the phone page
      </button>
      <button class="chip" title="Forget what was pushed to this phone for picture, bitrate and codec, and connect again with the studio's preferences" onClick={() => cmd({ defaults: true })}>
        studio preferences (reconnects)
      </button>
    </div>
    </>
  );
}

// The producer's switches for one guest, each on its own, so the card (one line each, compact) and
// the full-screen view (stacked, full width) can lay them out differently. `wide` fills the row.

/** What fills the guest's screen in the green room: black (the waiting card), the PCR (the producer's camera), or the studio return. */
export function SeesSwitch({ p, wide = false }: { p: GuestCardProps; wide?: boolean }) {
  return (
    <span class={`seg ${wide ? 'wide' : ''}`}>
      <button class={p.sees === 'none' ? 'on' : ''} title="No picture: the guest sees the waiting card" onClick={() => p.onSee('none')}>
        Black
      </button>
      <button class={p.sees === 'me' ? 'on' : ''} title="The producer's camera, from the PCR" onClick={() => p.onSee('me')}>
        PCR
      </button>
      <button class={p.sees === 'studio' ? 'on' : ''} title="The studio return: the program picture" onClick={() => p.onSee('studio')}>
        Studio
      </button>
    </span>
  );
}

/**
 * The multiview tick. The guests ticked MV are one group in the green room: each sees the others as
 * small pictures along the bottom of the screen, they hear each other, and all of them hear the
 * producer when one of them is talked to. `big` is the full-screen view's button.
 */
export function MvTick({ p, big = false }: { p: GuestCardProps; big?: boolean }) {
  const g = p.state;
  const title = 'Multiview: the guests ticked MV see each other as small pictures along the bottom, hear each other, and all hear you when you talk to one of them';
  const toggle = () => p.onAction({ type: 'mv', guest: g.identity, on: !g.mv });
  return big ? (
    <button class={`btn mv-toggle ${g.mv ? 'live' : 'secondary'}`} title={title} aria-pressed={g.mv} onClick={toggle}>
      {g.mv ? 'MV ✓' : 'MV'}
    </button>
  ) : (
    <label class="inline mv-tick" title={title}>
      <input type="checkbox" checked={g.mv} onChange={toggle} /> MV
    </label>
  );
}

/** What the guest hears in the green room: the producer, the studio mix-minus, both or neither. */
export function HearsSwitch({ p, wide = false }: { p: GuestCardProps; wide?: boolean }) {
  const g = p.state;
  return (
    <span class={`seg ${wide ? 'wide' : ''}`}>
      <button class={p.hearsMe ? 'on' : ''} onClick={() => p.onHearMe(!p.hearsMe)}>
        {p.hearsMe ? 'me ●' : 'me'}
      </button>
      <button class={g.studioSound ? 'on' : ''} onClick={() => p.onAction({ type: 'studioSound', guest: g.identity, on: !g.studioSound })}>
        {g.studioSound ? 'studio ●' : 'studio'}
      </button>
    </span>
  );
}

/** Text cues for the guest's screen: the ready-made ones and a line to type. */
export function CueBox({ p }: { p: GuestCardProps }) {
  const g = p.state;
  const [cue, setCue] = useState('');
  return (
    <div class="cues">
      {QUICK_CUES.map((text) => (
        <button class="chip" key={text} onClick={() => p.onAction({ type: 'cue', to: g.identity, text })}>
          {text}
        </button>
      ))}
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (cue.trim()) p.onAction({ type: 'cue', to: g.identity, text: cue.trim() });
          setCue('');
        }}
      >
        <input placeholder="Cue text…" value={cue} onInput={(e) => setCue((e.currentTarget as HTMLInputElement).value)} />
        <button class="btn secondary small" type="submit">
          Send
        </button>
      </form>
    </div>
  );
}

/** Everything the producer can do with this guest on its card in the room, with the connection panel folded. */
export function GuestControls(p: GuestCardProps & { openConn?: boolean }) {
  const g = p.state;
  const inLobby = g.place === 'lobby';
  const inGreen = g.place === 'green';
  const inStudio = g.place === 'studio';
  const cmd = (command: Record<string, unknown>) => p.onAction({ type: 'command', guest: g.identity, command });

  return (
    <div class="guest-controls">
      {inLobby && (
        <button class="btn" onClick={() => p.onAction({ type: 'admit', guest: g.identity })}>
          Receive into green room
        </button>
      )}

      {inGreen && (
        <>
          <div class="inline">
            guest sees
            <SeesSwitch p={p} />
            <MvTick p={p} />
          </div>
          <div class="inline">
            guest hears
            <HearsSwitch p={p} />
          </div>
          <button
            class="btn"
            onClick={() => p.onAction({ type: 'handoff', guest: g.identity })}
            disabled={!p.connected || (p.needsApproval && !g.ready)}
            title={p.needsApproval && !g.ready ? 'Waiting for the engineer to approve this guest for air' : undefined}
          >
            Send to studio →
          </button>
        </>
      )}

      {inStudio && (
        <>
          <button class={`btn ${g.tally === 'standby' ? 'warn' : 'secondary'}`} onClick={() => p.onAction({ type: 'tally', guest: g.identity, tally: 'standby' })}>
            Stand by
          </button>
          <button
            class={`btn ${g.tally === 'onair' ? 'danger' : 'secondary'}`}
            onClick={() => p.onAction({ type: 'tally', guest: g.identity, tally: 'onair' })}
            disabled={p.needsApproval && !g.ready && g.tally !== 'onair'}
            title={p.needsApproval && !g.ready ? 'The engineer withdrew the approval' : undefined}
          >
            On air
          </button>
          {p.ifbAllowed && (
            <label class="inline">
              <input type="checkbox" checked={p.ifb} onChange={(e) => p.onAction({ type: 'ifb', guest: g.identity, on: (e.currentTarget as HTMLInputElement).checked })} /> IFB
            </label>
          )}
          {p.ifb && (
            <button class={`btn ${p.hearsMe ? 'live' : 'secondary'}`} onClick={() => p.onHearMe(!p.hearsMe)}>
              {p.hearsMe ? 'Talking (IFB)' : 'Talk (IFB)'}
            </button>
          )}
          <button class="btn secondary" onClick={() => p.onAction({ type: 'bringBack', guest: g.identity })}>
            ← Bring back
          </button>
        </>
      )}

      {(inGreen || inStudio) && <CueBox p={p} />}

      {p.connected && (
        <details class="conn" open={p.openConn === true}>
          <summary>
            Connection and phone settings
            {p.tile?.stats && (
              <span class="muted small">
                {' '}
                · in {p.tile.stats.kbps} kbit/s · loss {p.tile.stats.lossPct}% {p.tile.stats.rttMs !== undefined && `· rtt ${p.tile.stats.rttMs} ms`}
              </span>
            )}
          </summary>
          <PhonePanel tile={p.tile} report={p.report} cmd={cmd} />
        </details>
      )}

      <div class="row muted small">
        {p.record?.invites[0] && (
          <button class="link" onClick={() => void navigator.clipboard?.writeText(p.record!.invites[0]!.url)}>
            copy link
          </button>
        )}
        <button class="link bad" onClick={() => p.onAction({ type: 'kick', guest: g.identity })}>
          show out
        </button>
      </div>
    </div>
  );
}

export function GuestCard(p: GuestCardProps) {
  return (
    <article class={`guest-card ${p.state.place} ${p.connected ? '' : 'offline'}`}>
      <GuestVideo {...p} />
      <GuestControls {...p} />
    </article>
  );
}
