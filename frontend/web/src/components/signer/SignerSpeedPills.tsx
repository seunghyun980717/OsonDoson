// 농인 결과 아바타 재생 속도 컨트롤. controlled component.
export type SignerPlaybackSpeed = 0.5 | 1 | 1.5;

const SPEEDS: readonly SignerPlaybackSpeed[] = [0.5, 1, 1.5];

type SignerSpeedPillsProps = {
  value: SignerPlaybackSpeed;
  onChange: (speed: SignerPlaybackSpeed) => void;
};

export const SignerSpeedPills = ({ value, onChange }: SignerSpeedPillsProps) => {
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
                ? 'bg-signer-action text-signer-action-fg font-semibold'
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
