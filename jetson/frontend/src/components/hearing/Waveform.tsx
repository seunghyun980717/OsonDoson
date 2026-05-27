const FALLBACK_BAR_COUNT = 80;
const MIN_HEIGHT = 6;
const MAX_HEIGHT = 64;

const PLACEHOLDER: number[] = Array.from({ length: FALLBACK_BAR_COUNT }, () => 0);

type WaveformProps = {
  data?: number[];
};

export const Waveform = ({ data }: WaveformProps) => {
  const values = data ?? PLACEHOLDER;

  return (
    <div className="flex h-20 items-center justify-between overflow-hidden">
      {values.map((v, i) => {
        const h = MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * v;
        return (
          <div
            key={i}
            className="bg-hearing-action w-[3px] flex-shrink-0 rounded-sm"
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
};
