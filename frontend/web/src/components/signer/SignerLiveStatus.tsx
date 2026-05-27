import type { SignerDetectionKind } from '@/hooks/useSignerDetectionState';

type SignerLiveStatusProps = {
  kind: SignerDetectionKind;
};

// 농인 사용자용 글로스 표현 — 한글 문장 대신 KSL 어휘 단위로 노출
const glossesByKind: Record<SignerDetectionKind, readonly string[]> = {
  preparing: ['준비'],
  'missing-hands': ['손', '들어오다'],
  good: ['인식', '좋다'],
};

// 상태 톤 — 글로스 pill 테두리/텍스트 색으로만 구분 (아이콘 없이 색만으로 빠른 시각 cue)
const toneByKind: Record<SignerDetectionKind, { border: string; text: string }> = {
  preparing: { border: 'border-white/40', text: 'text-white/85' },
  'missing-hands': { border: 'border-amber-300/55', text: 'text-amber-300' },
  good: { border: 'border-signer-border/60', text: 'text-signer-border' },
};

// 보조 기술용 — 글로스 노출은 시각적이고, 스크린리더에는 풀문장으로 전달
const ariaLabelByKind: Record<SignerDetectionKind, string> = {
  preparing: '수어 인식을 준비하고 있어요',
  'missing-hands': '손을 가이드 안에 맞춰주세요',
  good: '잘 인식되고 있어요',
};

export const SignerLiveStatus = ({ kind }: SignerLiveStatusProps) => {
  const glosses = glossesByKind[kind];
  const tone = toneByKind[kind];

  return (
    <div
      className="absolute top-4 left-1/2 z-10 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2"
      role="status"
      aria-live="polite"
      aria-label={ariaLabelByKind[kind]}
    >
      {glosses.map((gloss) => (
        <span
          key={gloss}
          className={`rounded-pill ${tone.border} ${tone.text} border bg-black/55 px-3.5 py-1.5 text-base font-medium backdrop-blur-sm`}
        >
          {gloss}
        </span>
      ))}
    </div>
  );
};
