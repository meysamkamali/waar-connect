// The technical side of one guest's phone, as it opens beside the producer's room and on the
// engineer's page: what the phone sends and what arrives here, side by side; the bandwidth test; and
// every setting that can be pushed to the phone, in groups (picture, connection, camera and sound,
// the phone's page). Each change goes to the phone as a command and the phone reports back at once.
// The numbers as one block of text stay at the bottom, for a report to copy.
// Copyright (C) 2026 WAAR Media. AGPL-3.0-only; see LICENSE.

import type { ComponentChildren } from 'preact';
import { Icon, Info } from '../components/ui.tsx';
import { evLabel, type CameraControls, type CameraState } from '../lib/camera.ts';
import { CODEC_LABELS, CODECS, describeCodecs, SUPPORT_LABELS, type CodecName } from '../lib/codecs.ts';
import { mainKbps } from '../lib/quality.ts';
import { DEGRADE_DEFAULT, describeReport, phoneModel, recommendedCap, SWEEP_STEPS, type Degrade, type GuestReport } from '../lib/report.ts';
import { formatSummary, type StatsSummary } from '../lib/stats.ts';
import { BUILD } from '../lib/version.ts';
import type { StaffTile } from './session.ts';

type Cmd = (command: Record<string, unknown>) => void;
type Tone = 'warn' | 'bad' | undefined;

const SIZES = [1080, 720, 540, 360] as const;
const RATES = [25, 50] as const;
const KEEPS: readonly { key: Degrade; label: string; title: string }[] = [
  { key: 'resolution', label: 'Size', title: 'Keeps the picture size and drops frames first' },
  { key: 'framerate', label: 'Frame rate', title: 'Keeps the motion and shrinks the picture first' },
  { key: 'balanced', label: 'Balanced', title: 'Lets the browser decide' },
];
const HELD: Readonly<Record<string, string>> = { bandwidth: 'by the network', cpu: "by the phone's processor" };

// ---- small pieces --------------------------------------------------------------------------------------

function Row({ label, info, children }: { label: string; info?: string; children: ComponentChildren }) {
  return (
    <div class="pp-row">
      <span class="pp-label">
        {label}
        {info && <Info side="start" text={info} />}
      </span>
      <div class="pp-ctl">{children}</div>
    </div>
  );
}

interface Choice<T> {
  key: T;
  label: string;
  title?: string | undefined;
  off?: boolean | undefined;
}

/** One of several: the one in force is lit. */
function Seg<T extends string | number | boolean>({ choices, value, onPick }: { choices: readonly Choice<T>[]; value: T | undefined; onPick: (key: T) => void }) {
  return (
    <span class="seg">
      {choices.map((c) => (
        <button key={String(c.key)} class={value === c.key ? 'on' : ''} aria-pressed={value === c.key} disabled={c.off} title={c.title} onClick={() => onPick(c.key)}>
          {c.label}
        </button>
      ))}
    </span>
  );
}

function Readout({ title, rows }: { title: string; rows: readonly (readonly [string, string | undefined, Tone?])[] }) {
  const shown = rows.filter((r): r is readonly [string, string, Tone?] => r[1] !== undefined);
  return (
    <div class="pp-col">
      <h4>{title}</h4>
      {shown.length === 0 ? (
        <span class="pp-none">no numbers</span>
      ) : (
        <dl>
          {shown.map(([k, v, tone]) => (
            <>
              <dt>{k}</dt>
              <dd class={tone ?? ''}>{v}</dd>
            </>
          ))}
        </dl>
      )}
    </div>
  );
}

const picture = (w: number | undefined, h: number | undefined, fps: number | undefined) => (w && h ? `${w}×${h}${fps ? ` · ${Math.round(fps)} fps` : ''}` : undefined);
const lossTone = (pct: number): Tone => (pct >= 2 ? 'bad' : pct >= 0.5 ? 'warn' : undefined);
const delayTone = (ms: number | undefined): Tone => (ms === undefined ? undefined : ms >= 400 ? 'bad' : ms >= 150 ? 'warn' : undefined);

function sendRows(r: GuestReport): (readonly [string, string | undefined, Tone?])[] {
  const up: StatsSummary | undefined = r.up;
  const codec = (r.wire ?? r.codec) as CodecName;
  const support = r.codecs?.[codec];
  const asked = r.wire && r.wire !== r.codec ? ` (asked ${CODEC_LABELS[r.codec as CodecName] ?? r.codec})` : '';
  const copies = up?.layers && up.layers.length > 1 ? up.layers.map((l) => `${l.height ? `${l.height}p` : (l.rid ?? '?')} ${l.kbps > 0 ? l.kbps : 'off'}`).join(' · ') : undefined;
  return [
    ['Bitrate', up ? `${mainKbps(up)} of ${r.kbps} kbit/s` : `cap ${r.kbps} kbit/s`, up?.limited ? 'warn' : undefined],
    ['Held back', up?.limited ? (HELD[up.limited] ?? up.limited) : undefined, 'warn'],
    ['Picture', picture(up?.width, up?.height, up?.fps)],
    ['Camera', picture(r.width ?? (r.height ? Math.round((r.height * 16) / 9) : undefined), r.height, r.fps)],
    ['Codec', `${CODEC_LABELS[codec] ?? codec}${support && support !== 'unknown' ? ` · ${SUPPORT_LABELS[support]}` : ''}${asked}`],
    ['Copies', copies ?? (r.small === false ? 'full size only' : undefined)],
    ['Packet loss', up ? `${up.lossPct} %` : undefined, up ? lossTone(up.lossPct) : undefined],
    ['Round trip', up?.rttMs !== undefined ? `${up.rttMs} ms` : undefined, delayTone(up?.rttMs)],
    ['Path', up ? `${up.path}${r.relay ? ' (relay only)' : ''}` : r.relay ? 'relay only' : undefined],
  ];
}

function arriveRows(s: StatsSummary | undefined): (readonly [string, string | undefined, Tone?])[] {
  if (!s) return [];
  return [
    ['Bitrate', `${s.kbps} kbit/s`],
    ['Picture', picture(s.width, s.height, s.fps)],
    ['Codec', s.codec ? (CODEC_LABELS[s.codec as CodecName] ?? s.codec) : undefined],
    ['Packet loss', `${s.lossPct} %`, lossTone(s.lossPct)],
    ['Jitter', s.jitterMs !== undefined ? `${s.jitterMs} ms` : undefined],
    ['Buffer', s.bufferMs !== undefined ? `${s.bufferMs} ms` : undefined, delayTone(s.bufferMs)],
    ['Path', s.path],
  ];
}

/**
 * The camera controls this phone said it offers (Android Chrome: most of them; iPhone: usually none).
 * The locks are the useful part live: a phone's automatic exposure and white balance hunt when the
 * guest moves.
 */
function Lens({ can, now, cmd }: { can: CameraControls; now: CameraState; cmd: Cmd }) {
  const ec = can.exposureCompensation;
  const zoom = can.zoom;
  const ev = now.exposureCompensation ?? 0;
  const z = now.zoom ?? zoom?.min ?? 1;
  const slider = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
  const locks = can.exposureLock || can.whiteBalanceLock || can.focusLock;
  return (
    <>
      {ec && (
        <Row label="Exposure" info="Brighter or darker than the camera's own choice.">
          <input type="range" aria-label="Exposure" min={ec.min} max={ec.max} step={ec.step || 0.1} value={ev} onChange={(e) => cmd({ cam: { exposureCompensation: slider(e) } })} />
          <span class="pp-value">{evLabel(ev)}</span>
        </Row>
      )}
      {locks && (
        <Row label="Hold" info="Holds a setting where it is now, so the picture does not pump or change colour when the guest moves.">
          {can.exposureLock && (
            <button class={`chip ${now.exposureLocked ? 'on' : ''}`} aria-pressed={now.exposureLocked === true} onClick={() => cmd({ cam: { exposureLock: !now.exposureLocked } })}>
              Exposure
            </button>
          )}
          {can.whiteBalanceLock && (
            <button class={`chip ${now.whiteBalanceLocked ? 'on' : ''}`} aria-pressed={now.whiteBalanceLocked === true} onClick={() => cmd({ cam: { whiteBalanceLock: !now.whiteBalanceLocked } })}>
              White balance
            </button>
          )}
          {can.focusLock && (
            <button class={`chip ${now.focusLocked ? 'on' : ''}`} aria-pressed={now.focusLocked === true} onClick={() => cmd({ cam: { focusLock: !now.focusLocked } })}>
              Focus
            </button>
          )}
        </Row>
      )}
      {zoom && (
        <Row label="Zoom">
          <input type="range" aria-label="Zoom" min={zoom.min} max={zoom.max} step={zoom.step || 0.1} value={z} onChange={(e) => cmd({ cam: { zoom: slider(e) } })} />
          <span class="pp-value">{z.toFixed(1)}×</span>
        </Row>
      )}
      <Row label="Lens">
        {can.torch && (
          <button class={`chip ${now.torch ? 'on' : ''}`} aria-pressed={now.torch === true} title="The phone's LED as a fill light (back camera)" onClick={() => cmd({ cam: { torch: !now.torch } })}>
            Light
          </button>
        )}
        <button class="chip" title="Everything back to the camera's automatic behaviour" onClick={() => cmd({ cam: { auto: true } })}>
          <Icon name="undo" /> Automatic
        </button>
      </Row>
    </>
  );
}

// ---- the panel -----------------------------------------------------------------------------------------

export function PhonePanel({ tile, report: r, cmd }: { tile: StaffTile | undefined; report: GuestReport | undefined; cmd: Cmd }) {
  const processing = r ? r.audio.ec || r.audio.ns || r.audio.agc : true;
  const sweep = r?.test;
  const recommended = recommendedCap(sweep);
  const stale = r !== undefined && r.build !== BUILD;
  const asked = r?.fpsAsked ?? (r?.fps ? Math.round(r.fps) : undefined);
  const cameraGives = r?.fps !== undefined && r.fpsAsked !== undefined && Math.abs(r.fps - r.fpsAsked) > 2 ? Math.round(r.fps) : undefined;
  const caps = r && !SWEEP_STEPS.includes(r.kbps) ? [...SWEEP_STEPS, r.kbps].sort((a, b) => a - b) : SWEEP_STEPS;
  const age = r ? Math.max(0, Math.round((Date.now() - r.at) / 1000)) : undefined;
  const facts = r
    ? [phoneModel(r.ua), r.camera, r.net, r.battery !== undefined ? `battery ${r.battery} %` : undefined, r.micOn ? undefined : 'microphone muted'].filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];

  return (
    <div class="pp">
      {stale && (
        <div class="pp-alert">
          <span>The phone runs an older page</span>
          <Info side="start" text={`The phone's page is build ${r.build ?? 'unknown'}; this desk is ${BUILD}. Newer buttons do nothing on the phone until its page reloads.`} />
          <button class="btn warn small" onClick={() => cmd({ reload: true })}>
            <Icon name="refresh" /> Reload it
          </button>
        </div>
      )}
      {r?.error && <div class="pp-alert bad">{r.error}</div>}

      {facts.length > 0 && (
        <div class="pp-facts">
          {facts.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      )}

      <div class="pp-cols">
        <Readout title="Phone sends" rows={r ? sendRows(r) : []} />
        <Readout title="Arrives here" rows={arriveRows(tile?.stats)} />
      </div>
      <div class="pp-bar">
        <button class="chip" onClick={() => cmd({ check: true })}>
          <Icon name="refresh" /> Check now
        </button>
        <span class="pp-age">{age === undefined ? 'no report from the phone yet' : `report ${age} s ago`}</span>
      </div>

      <section class="pp-group">
        <h4>
          Bandwidth test
          <Info
            side="start"
            text={`Steps the phone's bitrate cap from ${SWEEP_STEPS[0]} to ${SWEEP_STEPS[SWEEP_STEPS.length - 1]} kbit/s, eight seconds a step, and measures what really goes out. A step passes with loss under 2 %, a round trip under 400 ms and at least 70 % of the cap sent. The picture quality changes while it runs.`}
          />
        </h4>
        <div class="pp-bar">
          <button class="btn small" onClick={() => cmd({ test: { steps: SWEEP_STEPS, seconds: 8 } })} disabled={sweep?.running === true}>
            {sweep?.running ? `Testing: step ${sweep.step + 1} of ${sweep.steps.length}` : 'Run the test'}
          </button>
          {!sweep?.running && <span class="pp-age">about {SWEEP_STEPS.length * 8} s</span>}
        </div>
        {sweep?.running && (
          <div class="pp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={sweep.steps.length} aria-valuenow={sweep.step}>
            <i style={{ width: `${Math.round(((sweep.step + 0.5) / sweep.steps.length) * 100)}%` }} />
          </div>
        )}
        {sweep && sweep.results.length > 0 && (
          <div class="adm-table-wrap">
            <table class="adm-table pp-table">
              <thead>
                <tr>
                  <th>Cap</th>
                  <th>Sent</th>
                  <th>Round trip</th>
                  <th>Loss</th>
                  <th>Fps</th>
                  <th>Held by</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sweep.results.map((s) => (
                  <tr key={s.target} class={s.ok ? 'ok' : 'bad'}>
                    <td>{s.target}</td>
                    <td>{s.kbps}</td>
                    <td>{s.rttMs !== undefined ? `${s.rttMs} ms${s.rttMaxMs !== undefined && s.rttMaxMs > s.rttMs ? ` (max ${s.rttMaxMs})` : ''}` : '—'}</td>
                    <td>{s.lossPct} %</td>
                    <td>{s.fps ?? '—'}</td>
                    <td>{s.limited ?? '—'}</td>
                    <td class="pp-mark" aria-label={s.ok ? 'passed' : 'failed'}>
                      <Icon name={s.ok ? 'check' : 'close'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sweep && !sweep.running && sweep.results.length > 0 &&
          (recommended !== undefined ? (
            <div class="pp-bar">
              <span class="pp-result">Recommended cap {recommended} kbit/s</span>
              <button class={`chip ${r?.kbps === recommended ? 'on' : ''}`} onClick={() => cmd({ kbps: recommended })}>
                <Icon name="check" /> {r?.kbps === recommended ? 'In use' : 'Use it'}
              </button>
            </div>
          ) : (
            <div class="pp-alert bad">
              <span>Even {sweep.steps[0]} kbit/s did not pass</span>
              <Info side="start" text="Try “Relay only” under Connection: some networks let only the relay's port through. Otherwise the guest needs a better network." />
            </div>
          ))}
      </section>

      <section class="pp-group">
        <h4>Picture</h4>
        <Row label="Size">
          <Seg choices={SIZES.map((h) => ({ key: h, label: `${h}p` }))} value={r?.height} onPick={(h) => cmd({ res: h })} />
        </Row>
        <Row label="Frame rate">
          <Seg
            choices={RATES.map((f) => {
              // A phone camera runs at 30 or 60, rarely a true 50: the choice shows what was asked, the readout what arrives.
              const short = f === 50 && r?.fpsMax !== undefined && r.fpsMax < 50;
              return {
                key: f,
                label: String(f),
                title:
                  f === 25
                    ? "The station's own rate: each frame is shown twice"
                    : short
                      ? `This camera says it does at most ${Math.round(r!.fpsMax!)} fps: the phone sends what it can`
                      : 'Twice the frames: needs about one and a half times the bitrate, and a camera that can do it',
              };
            })}
            value={asked}
            onPick={(f) => cmd({ fps: f })}
          />
          {cameraGives !== undefined && <span class="pp-value">camera gives {cameraGives}</span>}
        </Row>
        <Row label="Keeps" info="What the phone holds on to when the network or its processor is short: the picture size (it drops frames), the frame rate (it shrinks the picture), or a balance of both.">
          <Seg choices={KEEPS} value={r ? (r.degrade ?? DEGRADE_DEFAULT) : undefined} onPick={(d) => cmd({ degrade: d })} />
        </Row>
        <Row label="Bitrate cap" info="The most the full-size picture may use, in kbit/s.">
          <Seg choices={caps.map((k) => ({ key: k, label: String(k) }))} value={r?.kbps} onPick={(k) => cmd({ kbps: k })} />
        </Row>
        <Row label="Copies" info="With small copies the phone also sends 360p and 180p: small pictures and weak viewers take one of those. Full size only is for a phone whose encoder ignores the small copies' caps.">
          <Seg
            choices={[
              { key: true, label: 'Full + small' },
              { key: false, label: 'Full only' },
            ]}
            value={r ? r.small !== false : undefined}
            onPick={(small) => cmd({ small })}
          />
        </Row>
      </section>

      <section class="pp-group">
        <h4>
          Connection
          <span class="pp-note tip" data-tip="A change here makes the phone connect again: the picture and sound drop for a few seconds.">
            reconnects
          </span>
        </h4>
        <Row label="Codec">
          {CODECS.map((c) => {
            const support = r?.codecs?.[c] ?? 'unknown';
            const off = support === 'no' || support === 'failed';
            return (
              <button class={`chip ${r?.codec === c ? 'on' : ''} ${off ? 'off' : ''}`} key={c} disabled={off} aria-pressed={r?.codec === c} title={`${CODEC_LABELS[c]}: ${SUPPORT_LABELS[support]} encoder on this phone`} onClick={() => cmd({ codec: c })}>
                {CODEC_LABELS[c]}
                {support === 'hw' || support === 'sw' ? <small>{support === 'hw' ? 'hardware' : 'software'}</small> : null}
              </button>
            );
          })}
        </Row>
        <Row label="Path" info="Direct: UDP straight to the media server, TCP as a fallback; the normal way. Relay only is a test tool: everything through the station's relay (UDP 3478). If the relay cannot be reached from the phone's network, the phone goes back to direct by itself.">
          <Seg
            choices={[
              { key: false, label: 'Direct' },
              { key: true, label: 'Relay only' },
            ]}
            value={r?.relay}
            onPick={(relay) => cmd({ relay })}
          />
        </Row>
      </section>

      <section class="pp-group">
        <h4>Camera and sound</h4>
        <Row label="Camera">
          <Seg
            choices={[
              { key: 'user', label: 'Front' },
              { key: 'environment', label: 'Back' },
            ]}
            value={r?.facing}
            onPick={(facing) => cmd({ facing })}
          />
        </Row>
        {r?.cam && <Lens can={r.cam.can} now={r.cam.now} cmd={cmd} />}
        <Row label="Microphone">
          <Seg
            choices={[
              { key: true, label: 'On' },
              { key: false, label: 'Muted' },
            ]}
            value={r?.micOn}
            onPick={(on) => cmd({ mute: !on })}
          />
        </Row>
        <Row label="Voice" info="The phone's echo canceller, noise suppression and automatic gain. Off for music or a studio microphone.">
          <Seg
            choices={[
              { key: true, label: 'Processed' },
              { key: false, label: 'As it is' },
            ]}
            value={r ? processing : undefined}
            onPick={(on) => cmd({ audio: { ec: on, ns: on, agc: on } })}
          />
        </Row>
      </section>

      <section class="pp-group">
        <h4>The phone's page</h4>
        <div class="pp-bar">
          <button class="chip" onClick={() => cmd({ reload: true })}>
            <Icon name="refresh" /> Reload
          </button>
          <button class="chip tip" data-tip="Forgets what was pushed to this phone for picture, bitrate and codec, and connects again with the studio's preferences." onClick={() => cmd({ defaults: true })}>
            <Icon name="undo" /> Studio preferences
          </button>
        </div>
      </section>

      <details class="pp-raw">
        <summary>All numbers</summary>
        <pre class="stats">
          {formatSummary('IN ', tile?.stats)}
          {'\n'}
          {r ? `${formatSummary('UP ', r.up)}\nphone: ${describeReport(r)}\n${describeCodecs(r.codecs)}\n${phoneModel(r.ua)}${r.camera ? ` · ${r.camera}` : ''}${r.error ? `\nlast error: ${r.error}` : ''}` : 'phone: no report yet'}
        </pre>
      </details>
    </div>
  );
}
