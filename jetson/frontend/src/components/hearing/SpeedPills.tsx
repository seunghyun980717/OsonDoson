import type { PlaybackSpeed } from '@/contexts/HearingContext';
import { useHearing } from '@/hooks/useHearing';

const SPEEDS: readonly PlaybackSpeed[] = [0.5, 1, 1.5];

export const SpeedPills = () => {
  const { playbackSpeed, setPlaybackSpeed } = useHearing();

  return (
    <div className="flex items-center gap-2">
      {SPEEDS.map((speed) => {
        const active = speed === playbackSpeed;
        return (
          <button
            key={speed}
            type="button"
            onClick={() => setPlaybackSpeed(speed)}
            aria-pressed={active}
            className={`rounded-pill px-5 py-2 text-xl transition-all duration-150 active:scale-[0.97] ${
              active
                ? 'bg-hearing-action text-hearing-action-fg font-semibold'
                : 'border-border-default text-text-secondary hover:bg-neutral-200 border bg-neutral-100'
            }`}
          >
            {speed}x
          </button>
        );
      })}
    </div>
  );
};
