// 청인 결과 오디오 재생 속도 컨트롤. controlled component — 부모가 state 보유.
export type PlaybackSpeed = 0.5 | 1 | 1.5;

const SPEEDS: readonly PlaybackSpeed[] = [0.5, 1, 1.5];

type SpeedPillsProps = {
  value: PlaybackSpeed;
  onChange: (speed: PlaybackSpeed) => void;
};

export const SpeedPills = ({ value, onChange }: SpeedPillsProps) => {
  return (
    <div className="flex items-center gap-2">
      {SPEEDS.map((speed) => {
        const active = speed === value;
        return (
          <button
            key={speed}
            type="button"
            onClick={() => onChange(speed)}
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
