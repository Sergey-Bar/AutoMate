import { useRef, useState, useEffect } from 'react';
import type { Step } from '@/lib/types';
import { formatDuration } from '@/lib/formatters';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VideoPlayerProps {
  path: string;
  steps?: Step[];
  totalDurationMs?: number;
}

export function VideoPlayer({ path, steps = [], totalDurationMs = 0 }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const url = `/artifacts/${path}`;

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const onMeta = () => setDuration(vid.duration * 1000);
    const onTime = () => setCurrentTime(vid.currentTime * 1000);
    const onEnd = () => setPlaying(false);
    vid.addEventListener('loadedmetadata', onMeta);
    vid.addEventListener('timeupdate', onTime);
    vid.addEventListener('ended', onEnd);
    return () => {
      vid.removeEventListener('loadedmetadata', onMeta);
      vid.removeEventListener('timeupdate', onTime);
      vid.removeEventListener('ended', onEnd);
    };
  }, []);

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (playing) {
      vid.pause();
    } else {
      vid.play().catch(console.error);
    }
    setPlaying(!playing);
  };

  const seekTo = (ms: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = ms / 1000;
    setCurrentTime(ms);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex flex-col gap-2 rounded-xl overflow-hidden border border-border-subtle">
      {/* Video */}
      <video
        ref={videoRef}
        src={url}
        muted={muted}
        className="w-full max-h-120 object-contain bg-black"
        onClick={togglePlay}
      />

      {/* Scrubber with step markers */}
      <div className="px-3 pb-1">
        <div
          className="relative h-2 rounded-full cursor-pointer bg-bg-elevated"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            seekTo(pct * duration);
          }}
        >
          {/* Progress fill */}
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width] bg-border-focus"
            style={{ width: `${progress}%` }}
          />

          {/* Step markers */}
          {totalDurationMs > 0 &&
            steps.map((step, i) => {
              const pct = ((step.startTime ?? 0) / totalDurationMs) * 100;
              return (
                <div
                  key={i}
                  className={cn(
                    'absolute top-0 w-0.5 h-full rounded-full opacity-40 hover:opacity-100',
                    step.error ? 'bg-fail' : 'bg-pass',
                  )}
                  style={{
                    left: `${pct}%`,
                  }}
                  title={step.title}
                  onClick={(e) => {
                    e.stopPropagation();
                    seekTo((step.startTime ?? 0) * (duration / totalDurationMs));
                  }}
                />
              );
            })}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 mt-2">
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={togglePlay}
            className="rounded-full p-1 text-text-secondary transition-colors hover:bg-bg-elevated"
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>

          <button
            type="button"
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => setMuted(!muted)}
            className="rounded-full p-1 text-text-secondary transition-colors hover:bg-bg-elevated"
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>

          <span className="text-[11px] tabular ml-auto text-text-tertiary">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
