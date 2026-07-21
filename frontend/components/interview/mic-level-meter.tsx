'use client';

import { useEffect, useRef, useState } from 'react';
import { Room, Track } from 'livekit-client';
import { Mic, MicOff } from 'lucide-react';

const BAR_COUNT = 24;

interface MicLevelMeterProps {
  room: Room | null;
  /** Compact bars only, for overlaying on a video tile. */
  compact?: boolean;
}

/**
 * Live meter for the LOCAL microphone.
 *
 * The agent's voice already has a visualizer; this is the other half — proof
 * that your own audio is reaching the room. Without it, a muted mic and a
 * broken agent look identical.
 */
export function MicLevelMeter({ room, compact = false }: MicLevelMeterProps) {
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [hasTrack, setHasTrack] = useState(false);

  const rafRef = useRef<number | undefined>(undefined);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    if (!room) return;

    let cancelled = false;
    let stream: MediaStream | null = null;

    const teardown = () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
      analyserRef.current = null;
      // Closing the context releases the analyser graph; the mic track itself
      // belongs to LiveKit and must not be stopped here.
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
    };

    const attach = async () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const mediaTrack = pub?.track?.mediaStreamTrack;

      setHasTrack(!!mediaTrack);
      setMuted(!!pub?.isMuted);

      if (!mediaTrack || pub?.isMuted) {
        setLevel(0);
        return;
      }

      try {
        const AudioCtx = window.AudioContext
          || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        stream = new MediaStream([mediaTrack]);
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        source.connect(analyser);
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (cancelled || !analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(data);

          // RMS over the spectrum reads more like perceived loudness than a peak
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
          const rms = Math.sqrt(sum / data.length) / 255;

          setLevel(Math.min(1, rms * 2.2));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // Visualisation is non-essential; never break the session over it
        setHasTrack(false);
      }
    };

    attach();

    const onChange = () => { teardown(); attach(); };
    room.localParticipant.on('trackMuted', onChange);
    room.localParticipant.on('trackUnmuted', onChange);
    room.localParticipant.on('localTrackPublished', onChange);
    room.localParticipant.on('localTrackUnpublished', onChange);

    return () => {
      cancelled = true;
      room.localParticipant.off('trackMuted', onChange);
      room.localParticipant.off('trackUnmuted', onChange);
      room.localParticipant.off('localTrackPublished', onChange);
      room.localParticipant.off('localTrackUnpublished', onChange);
      teardown();
    };
  }, [room]);

  const activeBars = Math.round(level * BAR_COUNT);

  const bars = (
    <div className="flex items-center gap-[2px] h-6" aria-hidden>
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const active = i < activeBars;
        // Taller in the middle so it reads as a waveform, not a progress bar
        const heightPct = 25 + Math.sin((i / BAR_COUNT) * Math.PI) * 75;
        return (
          <div
            key={i}
            className={`w-[3px] rounded-full transition-all duration-75 ${
              active ? 'bg-primary' : 'bg-muted-foreground/25'
            }`}
            style={{ height: `${active ? heightPct : 18}%` }}
          />
        );
      })}
    </div>
  );

  if (compact) return bars;

  return (
    <div className="flex items-center gap-2">
      {muted || !hasTrack
        ? <MicOff className="h-4 w-4 text-muted-foreground shrink-0" />
        : <Mic className="h-4 w-4 text-primary shrink-0" />}
      {bars}
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {!hasTrack ? 'No microphone' : muted ? 'Muted' : level > 0.04 ? 'Hearing you' : 'Silent'}
      </span>
    </div>
  );
}
