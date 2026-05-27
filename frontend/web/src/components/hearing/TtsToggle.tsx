// 청인 결과 화면 TTS 자동 재생 토글. MVP에서는 결과 화면이 자동 재생을 기본으로 하므로 미사용.
// 향후 옵션화 대비 stub. controlled component — 사용 시 부모에서 상태 보유.
import { Volume2, VolumeX } from 'lucide-react';

type TtsToggleProps = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

export const TtsToggle = ({ enabled, onChange }: TtsToggleProps) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="음성 듣기 토글"
      onClick={() => onChange(!enabled)}
      className="rounded-pill bg-hearing-bg text-text-secondary inline-flex select-none items-center gap-3 px-4 py-2 text-base transition-transform active:scale-[0.98]"
    >
      {enabled ? (
        <Volume2 size={18} strokeWidth={2} aria-hidden="true" />
      ) : (
        <VolumeX size={18} strokeWidth={2} aria-hidden="true" />
      )}
      <span>음성 듣기</span>
      <span
        aria-hidden="true"
        className={`rounded-pill relative h-5 w-9 flex-shrink-0 transition-colors ${
          enabled ? 'bg-hearing-action' : 'bg-neutral-200'
        }`}
      >
        <span
          className={`rounded-pill bg-neutral-0 shadow-card absolute top-0.5 left-0.5 h-4 w-4 transition-transform ${
            enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
};
