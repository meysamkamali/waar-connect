// Small media components: a video element bound to a track, and hidden audio sinks.
import type { LocalVideoTrack, RemoteAudioTrack, RemoteVideoTrack } from 'livekit-client';
import { useEffect, useRef } from 'preact/hooks';

export function VideoView({ track, className, mirror = false }: { track: LocalVideoTrack | RemoteVideoTrack | null; className?: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} class={className} autoplay playsInline muted={true} style={mirror ? { transform: 'scaleX(-1)' } : undefined} />;
}

function AudioSink({ track }: { track: RemoteAudioTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <audio ref={ref} autoplay />;
}

export function AudioSinks({ tracks }: { tracks: RemoteAudioTrack[] }) {
  return (
    <div class="hidden-audio">
      {tracks.map((t) => (
        <AudioSink key={t.sid} track={t} />
      ))}
    </div>
  );
}
