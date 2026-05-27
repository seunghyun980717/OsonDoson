// FastAPI(AI 처리 서버) 다운 시 하단에 떠 있는 큰 카드 배너.
// 일반 네트워크 에러용 NetworkErrorToast(상단·자동 dismiss)와 분리 — 사용자가 직접 닫을 때까지 유지.
// 시각 언어는 jetson `RecognitionErrorModal`(SVG 아이콘 + surface-screen 카드 + modal shadow) 미러.

const CONTACT_EMAIL = 'whitesnake.e104@gmail.com';

type FastApiUnavailableBannerProps = {
  visible: boolean;
  onDismiss: () => void;
};

export const FastApiUnavailableBanner = ({ visible, onDismiss }: FastApiUnavailableBannerProps) => {
  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-6"
      role="alert"
      aria-live="assertive"
      aria-labelledby="fastapi-unavailable-title"
    >
      <div className="bg-surface-screen pointer-events-auto flex w-full max-w-[560px] gap-5 rounded-2xl px-8 pt-8 pb-6 shadow-[0_24px_48px_rgba(0,0,0,0.22),0_4px_12px_rgba(0,0,0,0.08)]">
        <div className="flex flex-shrink-0 items-start">
          <svg width={52} height={52} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="11" className="fill-red-500" />
            <path
              d="M12 7v5.5M12 16v.5"
              className="stroke-neutral-0"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <p
            id="fastapi-unavailable-title"
            className="text-text-primary text-2xl leading-relaxed tracking-tight"
          >
            현재 연결된 AI 처리 서버 자원이 일시적으로 회수되어 잠시 수어 분석 기능이 원활하지
            않습니다.
          </p>
          <p className="text-text-secondary text-2xl leading-relaxed">
            이는 서비스 오류가 아닌 외부 연산 환경 종료 상태입니다.
          </p>
          <p className="text-text-secondary text-2xl leading-relaxed">
            자세한 사항은{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-text-primary hover:text-text-primary/80 underline underline-offset-4 transition-colors"
            >
              {CONTACT_EMAIL}
            </a>
            으로 문의해 주세요.
          </p>
        </div>
        <button
          type="button"
          aria-label="닫기"
          onClick={onDismiss}
          className="text-text-secondary hover:text-text-primary flex-shrink-0 self-start text-3xl leading-none transition-colors"
        >
          ×
        </button>
      </div>
    </div>
  );
};
