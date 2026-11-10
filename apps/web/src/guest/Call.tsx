// The one layout for lobby, green room and studio: big picture, self view, tally, cue, three buttons.
import { useEffect, useState } from 'preact/hooks';
import type { JoinInfo } from '../api.ts';
import { AudioSinks, VideoView } from '../components/media.tsx';
import { t } from '../i18n/index.ts';
import type { AutoFullscreen } from '../lib/fullscreen.ts';
import { formatSummary } from '../lib/stats.ts';
import type { GuestSession } from './session.ts';

export function Call({ session, info, fullscreen: fs }: { session: GuestSession; info: JoinInfo; fullscreen: AutoFullscreen }) {
  const state = session.state.value;
  const status = session.status.value;
  const main = session.mainVideo.value;
  const cue = session.cue.value;
  const [showInfo, setShowInfo] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(true);
  // Full screen itself is the guest page's business (lib/fullscreen.ts takes it on the first touch
  // anywhere); this screen shows the line that says so, and the button to leave and come back.

  useEffect(() => {
    const check = () => setAudioUnlocked(session.room.canPlaybackAudio);
    check();
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, [session]);

  const inStudio = state.place === 'studio';
  const inLobby = state.place === 'lobby';
  // The multiview stream: the studio's picture with the group's pictures drawn into its bottom-centre and
  // bottom-right ninths by the server (every guest of the group gets this same stream, their own picture
  // in it too). The bottom-left ninth is left for this phone's own camera. A guest on Studio sees the
  // whole stream; a guest on Black or on the PCR sees only its multiview part, over black or over the
  // producer's face.
  const mv = session.programIsMv.value ? session.programVideo.value : null;
  const face = session.faceVideo.value;
  const whole = mv !== null && face === null && state.program;
  const tallyClass = inStudio ? (state.tally === 'onair' ? 'tally onair' : 'tally standby') : 'tally off';
  const placeLabel = inLobby ? t('lobbyTitle') : inStudio ? t('studioTitle') : t('greenTitle');

  let statusText = '';
  let statusTone = 'ok';
  if (status === 'connecting') statusText = t('connecting');
  else if (status === 'reconnecting') {
    statusText = t('reconnecting');
    statusTone = 'warn';
  } else if (status === 'disconnected') {
    statusText = t('disconnected');
    statusTone = 'bad';
  } else if (session.error.value) {
    statusText = session.error.value;
    statusTone = 'bad';
  } else if (session.up.value && session.up.value.kbps === 0 && session.quality.value === 'unknown') {
    statusText = t('noMedia');
    statusTone = 'warn';
  }

  return (
    <div class="screen stage" onClick={() => void session.unlockAudio()}>
      {mv ? (
        <div class="mv-frame">
          {whole ? (
            <VideoView track={mv} className="mv-fill" />
          ) : face ? (
            <VideoView track={face} className="mv-fill" />
          ) : (
            <div class="slate mv-slate">
              <img class="logo" src="/app/logo.svg" alt="" />
              <div class="slate-title">{placeLabel}</div>
            </div>
          )}
          {!whole && (
            <div class="mv-panel">
              <VideoView track={mv} />
            </div>
          )}
          <VideoView track={session.localVideo.value} className="mv-self" mirror />
        </div>
      ) : (
        <>
          {main ? (
            <VideoView track={main} className="stage-video" />
          ) : (
            <div class="slate">
              <img class="logo" src="/app/logo.svg" alt="" />
              <div class="slate-title">{placeLabel}</div>
              <div class="slate-text">{inLobby ? t('lobbyText') : inStudio ? info.pcr.name : t('greenText')}</div>
            </div>
          )}

          <VideoView track={session.localVideo.value} className="pip" mirror />

          {session.guestVideos.value.length > 0 && (
            <div class="tiles">
              {session.guestVideos.value.map((tile) => (
                <div class="tile" key={tile.identity}>
                  <VideoView track={tile.track} />
                  <div class="name">{tile.name}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div class="topbar">
        <span class="place">{placeLabel}</span>
        {inStudio && <span class={tallyClass}>{state.tally === 'onair' ? t('onair') : t('standby')}</span>}
        {statusText && <span class={`status ${statusTone}`}>{statusText}</span>}
      </div>

      {fs.can && !fs.full && !fs.declined && <div class="fs-hint">{t('tapFullScreen')}</div>}

      {cue && (
        <button class="cue" onClick={() => session.dismissCue()}>
          <span class="cue-from">{cue.from || t('producer')}</span>
          <span class="cue-text">{cue.text}</span>
        </button>
      )}

      {!audioUnlocked && (
        <div class="overlay-tap">
          <button class="btn big" onClick={() => void session.unlockAudio()}>
            ▶
          </button>
        </div>
      )}

      {showInfo && (
        <pre class="panel">
          {formatSummary('UP', session.up.value)}
          {'\n'}
          {`${state.place} · ${state.tally} · slot ${state.slot ?? '-'} · ${session.quality.value}`}
        </pre>
      )}

      <AudioSinks tracks={session.audioTracks.value} />

      <div class="bar">
        <button class={`btn ${session.micEnabled.value ? 'secondary' : 'danger'}`} onClick={() => void session.setMic(!session.micEnabled.value)}>
          {session.micEnabled.value ? t('mute') : t('unmute')}
        </button>
        <button class={`btn ${session.handRaised.value ? '' : 'secondary'}`} onClick={() => void session.raiseHand(!session.handRaised.value)}>
          {session.handRaised.value ? t('handRaised') : t('raiseHand')}
        </button>
        <button class="btn secondary" onClick={() => void session.askHelp()}>
          {t('help')}
        </button>
        <span class="spacer" />
        {fs.can && (
          <button
            class="btn secondary small"
            title={fs.full ? t('exitFullScreen') : t('fullScreen')}
            aria-label={fs.full ? t('exitFullScreen') : t('fullScreen')}
            onClick={(e) => {
              e.stopPropagation();
              fs.toggle();
            }}
          >
            {fs.full ? '⤡' : '⛶'}
          </button>
        )}
        <button class="btn secondary small" onClick={() => setShowInfo(!showInfo)}>
          {t('info')}
        </button>
      </div>
    </div>
  );
}
