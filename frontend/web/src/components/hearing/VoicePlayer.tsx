// 결과 음성 플레이어. jetson 원본에서 WS base URL 헬퍼 → REST API 헬퍼(absoluteAudioUrl)로 교체.
import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { absoluteAudioUrl } from '@/lib/api/translation';

// SignToSpeechResult.audio 의 비-null 형태.
export type AudioPayload = {
  format: string;
  content_type: string;
  url: string;
};

type VoicePlayerProps = {
  audio: AudioPayload | null;
  playbackSpeed?: number;
  autoPlay?: boolean;
  replayNonce?: number;
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export const VoicePlayer = ({
  audio,
  playbackSpeed = 1,
  autoPlay = false,
  replayNonce,
}: VoicePlayerProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // 정적 파일 URL을 audio element src로 직접 할당
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl || !audio) return;

    audioEl.src = absoluteAudioUrl(audio.url);

    return () => {
      audioEl.removeAttribute('src');
      audioEl.load();
    };
  }, [audio]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl || !audio || !autoPlay) return;
    void audioEl.play().catch(() => {});
  }, [audio, autoPlay]);

  const replayInitializedRef = useRef(false);
  useEffect(() => {
    if (!replayInitializedRef.current) {
      replayInitializedRef.current = true;
      return;
    }
    const audioEl = audioRef.current;
    if (!audioEl) return;
    audioEl.currentTime = 0;
    void audioEl.play().catch(() => {});
  }, [replayNonce]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(audioEl.currentTime);
    const handleLoadedMetadata = () => setDuration(audioEl.duration);
    const handleEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };

    audioEl.addEventListener('play', handlePlay);
    audioEl.addEventListener('pause', handlePause);
    audioEl.addEventListener('timeupdate', handleTimeUpdate);
    audioEl.addEventListener('loadedmetadata', handleLoadedMetadata);
    audioEl.addEventListener('ended', handleEnded);

    return () => {
      audioEl.removeEventListener('play', handlePlay);
      audioEl.removeEventListener('pause', handlePause);
      audioEl.removeEventListener('timeupdate', handleTimeUpdate);
      audioEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audioEl.removeEventListener('ended', handleEnded);
    };
  }, []);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    audioEl.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const disabled = !audio;

  const togglePlay = () => {
    const audioEl = audioRef.current;
    if (!audioEl || !audio) return;
    if (playing) {
      audioEl.pause();
    } else {
      void audioEl.play();
    }
  };

  return (
    <div className="border-border-light bg-surface-screen flex items-center gap-5 rounded-2xl border px-6 py-6 shadow-[0_8px_24px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.04)]">
      <audio ref={audioRef} preload="auto" />

      <button
        type="button"
        onClick={togglePlay}
        disabled={disabled}
        aria-label={playing ? '일시정지' : '재생'}
        className="bg-hearing-action hover:bg-hearing-action-hover flex size-16 flex-shrink-0 items-center justify-center rounded-full shadow-[0_6px_16px_rgba(181,174,229,0.45)] transition-transform active:scale-[0.96] disabled:opacity-50 disabled:active:scale-100"
      >
        {playing ? (
          <Pause size={28} fill="white" stroke="white" strokeWidth={1.5} />
        ) : (
          <Play
            size={28}
            fill="white"
            stroke="white"
            strokeWidth={1.5}
            className="translate-x-[1px]"
          />
        )}
      </button>

      <div className="flex flex-1 flex-col gap-3">
        <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-200">
          <div
            className="bg-hearing-action h-full rounded-full transition-[width] duration-150"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="text-text-secondary flex justify-between text-2xl tabular-nums">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
};
