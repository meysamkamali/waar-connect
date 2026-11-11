// The guest's screen in the lobby, the green room and the studio. It is drawn from the pattern the
// admin designed for this studio (packages/shared screen.ts): nine sections, three by three, filled
// with pictures (the studio feed, the guest's own camera, the multiview) and overlays docked over
// them (the tally, the producer's cue, the guest's buttons). There is one pattern per number of
// guests on the screen; the server says how many that is.
import { isFullScreen, isPicture, overlayGroups, patternFor, type ScreenWidget } from '@waar-connect/shared';
import { useEffect, useState } from 'preact/hooks';
import type { JoinInfo } from '../api.ts';
import { AudioSinks, VideoView } from '../components/media.tsx';
import { t } from '../i18n/index.ts';
import type { AutoFullscreen } from '../lib/fullscreen.ts';
import { cellStyle, CueBanner, dockClass, RoundButton, TallyChip } from './screen.tsx';
import type { GuestSession } from './session.ts';

export function Call({ session, info, fullscreen: fs }: { session: GuestSession; info: JoinInfo; fullscreen: AutoFullscreen }) {
  const state = session.state.value;
  const status = session.status.value;
  const main = session.mainVideo.value;
  const cue = session.cue.value;
  const strip = session.mvStrip.value;
  const others = session.guestVideos.value;
  const mic = session.micEnabled.value;
  const hand = session.handRaised.value;
  const [audioUnlocked, setAudioUnlocked] = useState(true);
  const [helpSent, setHelpSent] = useState(false);
  // Full screen itself is the guest page's business (lib/fullscreen.ts takes it on the first touch
  // anywhere); this screen shows the line that says so, and the button to leave and come back.

  useEffect(() => {
    const check = () => setAudioUnlocked(session.room.canPlaybackAudio);
    check();
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => {
    if (!helpSent) return;
    const id = setTimeout(() => setHelpSent(false), 2500);
    return () => clearTimeout(id);
  }, [helpSent]);

  const inStudio = state.place === 'studio';
  const inLobby = state.place === 'lobby';
  const placeLabel = inLobby ? t('lobbyTitle') : inStudio ? t('studioTitle') : t('greenTitle');

  let statusText = '';
  let statusTone = '';
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

  const pattern = patternFor(session.screen.value, session.guests.value);

  const picture = (w: ScreenWidget) => {
    if (w.kind === 'studio') {
      if (main) return <VideoView track={main} />;
      return (
        <div class="gs-slate">
          <img src="/app/logo.svg" alt="" />
          <div class="gs-slate-title">{placeLabel}</div>
          <div class="gs-slate-text">{inLobby ? t('lobbyText') : inStudio ? info.pcr.name : t('greenText')}</div>
        </div>
      );
    }
    if (w.kind === 'self') return <VideoView track={session.localVideo.value} mirror />;
    // The multiview: the one wide picture the return feed makes; without a return feed, the other
    // guests' own small pictures side by side.
    if (strip) return <VideoView track={strip} />;
    if (others.length === 0) return null;
    return (
      <div class="gs-tiles">
        {others.map((tile) => (
          <div class="gs-tile" key={tile.identity}>
            <VideoView track={tile.track} />
          </div>
        ))}
      </div>
    );
  };

  const overlay = (w: ScreenWidget) => {
    switch (w.kind) {
      case 'status':
        return <TallyChip key="status" place={placeLabel} tally={inStudio ? (state.tally === 'onair' ? 'onair' : 'standby') : 'off'} tallyText={state.tally === 'onair' ? t('onair') : t('standby')} note={statusText} noteTone={statusTone} />;
      case 'cue':
        return cue ? <CueBanner key="cue" from={cue.from || t('producer')} text={cue.text} onClick={() => session.dismissCue()} /> : null;
      case 'mic':
        return <RoundButton key="mic" icon={mic ? 'mic' : 'micOff'} tone={mic ? undefined : 'danger'} label={mic ? t('mute') : t('unmute')} onClick={() => void session.setMic(!mic)} />;
      case 'hand':
        return <RoundButton key="hand" icon="hand" tone={hand ? 'on' : undefined} label={hand ? t('handRaised') : t('raiseHand')} onClick={() => void session.raiseHand(!hand)} />;
      case 'help':
        return (
          <RoundButton
            key="help"
            icon={helpSent ? 'check' : 'help'}
            tone={helpSent ? 'done' : undefined}
            label={t('help')}
            onClick={() => {
              void session.askHelp();
              setHelpSent(true);
            }}
          />
        );
      case 'screen':
        return fs.can ? (
          <RoundButton
            key="screen"
            icon={fs.full ? 'shrink' : 'expand'}
            label={fs.full ? t('exitFullScreen') : t('fullScreen')}
            onClick={(e) => {
              e.stopPropagation();
              fs.toggle();
            }}
          />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <div class="screen stage" onClick={() => void session.unlockAudio()}>
      <div class="gs-frame">
        {pattern.widgets
          .filter((w) => isPicture(w.kind))
          .map((w) => (
            <div key={w.kind} class={`gs-pic gs-${w.kind} ${isFullScreen(w) ? 'gs-under' : ''}`} style={cellStyle(w)}>
              {picture(w)}
            </div>
          ))}
        {overlayGroups(pattern).map((g) => (
          <div key={`${g.col}:${g.row}:${g.cols}`} class={`${dockClass(g)} ${g.widgets.some((w) => w.kind === 'cue') ? 'gs-top' : ''}`} style={cellStyle(g)}>
            {g.widgets.map(overlay)}
          </div>
        ))}
      </div>

      {fs.can && !fs.full && !fs.declined && <div class="fs-hint">{t('tapFullScreen')}</div>}

      {!audioUnlocked && (
        <div class="overlay-tap">
          <button class="btn big" onClick={() => void session.unlockAudio()}>
            ▶
          </button>
        </div>
      )}

      <AudioSinks tracks={session.audioTracks.value} />
    </div>
  );
}
