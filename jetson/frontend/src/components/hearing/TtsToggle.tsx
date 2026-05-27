import { Volume2, VolumeX } from 'lucide-react';

import { useHearing } from '@/hooks/useHearing';

export const TtsToggle = () => {
  const { ttsEnabled, toggleTts } = useHearing();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={ttsEnabled}
      aria-label="음성 듣기 토글"
      onClick={toggleTts}
      className="rounded-pill bg-hearing-bg text-text-secondary inline-flex select-none items-center gap-3 px-4 py-2 text-base transition-transform active:scale-[0.98]"
    >
      {ttsEnabled ? (
        <Volume2 size={18} strokeWidth={2} aria-hidden="true" />
      ) : (
        <VolumeX size={18} strokeWidth={2} aria-hidden="true" />
      )}
      <span>음성 듣기</span>
      <span
        aria-hidden="true"
        className={`rounded-pill relative h-5 w-9 flex-shrink-0 transition-colors ${
          ttsEnabled ? 'bg-hearing-action' : 'bg-neutral-200'
        }`}
      >
        <span
          className={`rounded-pill bg-neutral-0 shadow-card absolute top-0.5 left-0.5 h-4 w-4 transition-transform ${
            ttsEnabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
};
