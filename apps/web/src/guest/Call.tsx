// The one layout for lobby, green room and studio: big picture, self view, tally, cue, three buttons.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JoinInfo } from '../api.ts';
import { AudioSinks, VideoView } from '../components/media.tsx';
import { t } from '../i18n/index.ts';
import { canFullscreen, enterFullscreen, exitFullscreen, isFullscreen, onFullscreenChange } from '../lib/fullscreen.ts';
import { formatSummary } from '../lib/stats.ts';
import type { GuestSession } from './session.ts';

export function Call({ session, info }: { session: GuestSession; info: JoinInfo }) {
  const state = session.state.value;
  const status = session.status.value;
  const main = session.mainVideo.value;
  const cue = session.cue.value;
  const [showInfo, setShowInfo] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(true);
  const [full, setFull] = useState(isFullscreen());
  // No browser lets a page go full screen by itself: it takes a touch, or the phone being turned. So
  // the page asks at once (in case the browser allows it), again when the phone is turned, and on any
  // touch, and says so in a line until it has it. Once the guest leaves full screen on purpose (the
  // button, or the phone's back gesture) it is not taken back; the button brings it back.
  const [declined, setDeclined] = useState(false);
  const declinedRef = useRef(false);
  declinedRef.current = declined;

  useEffect(() => {
    let was = isFullscreen();
    const wanted = () => !declinedRef.current && !isFullscreen();
    void enterFullscreen();
    const off = onFullscreenChange(() => {
      const now = isFullscreen();
      if (was && !now) setDeclined(true);
      was = now;
      setFull(now);
    });
    const onTurn = () => {
      if (wanted()) void enterFullscreen();
    };
    screen.orientation?.addEventListener?.('change', onTurn);
    window.addEventListener('orientationchange', onTurn);
    return () => {
      off();
      screen.orientation?.removeEventListener?.('change', onTurn);
      window.removeEventListener('orientationchange', onTurn);
    };
  }, []);

  const onTouch = () => {
    void session.unlockAudio();
    if (!declinedRef.current && !isFullscreen()) void enterFullscreen();
  };

  useEffect(() => {
    const check = () => setAudioUnlocked(session.room.canPlaybackAudio);
    check();
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, [session]);

  const inStudio = state.place === 'studio';
  const inLobby = state.place === 'lobby';
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
    <div class="screen stage" onClick={onTouch}>
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

      <div class="topbar">
        <span class="place">{placeLabel}</span>
        {inStudio && <span class={tallyClass}>{state.tally === 'onair' ? t('onair') : t('standby')}</span>}
        {statusText && <span class={`status ${statusTone}`}>{statusText}</span>}
      </div>

      {canFullscreen() && !full && !declined && <div class="fs-hint">{t('tapFullScreen')}</div>}

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
        {canFullscreen() && (
          <button
            class="btn secondary small"
            title={full ? t('exitFullScreen') : t('fullScreen')}
            aria-label={full ? t('exitFullScreen') : t('fullScreen')}
            onClick={(e) => {
              e.stopPropagation();
              setDeclined(full);
              void (full ? exitFullscreen() : enterFullscreen());
            }}
          >
            {full ? '⤡' : '⛶'}
          </button>
        )}
        <button class="btn secondary small" onClick={() => setShowInfo(!showInfo)}>
          {t('info')}
        </button>
      </div>
    </div>
  );
}
