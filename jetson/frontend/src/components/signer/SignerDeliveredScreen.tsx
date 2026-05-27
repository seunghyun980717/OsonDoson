import type { SignerDispatch } from '../../hooks/useSignerFlow';
import { ActionBar } from '../action/ActionBar';
import { ActionButton } from '../action/ActionButton';

// 농인 가독성을 위해 UI 카피는 글로스 형태로 작성.
// 평문 원본 ↔ 글로스 매핑:
//   - 메인: '직원에게 전달되었습니다' → '직원 전달 완료'
//   - 서브: '직원 답변을 기다리는 중...' → '답변 기다림'
//   - 버튼: '처음으로' → '처음'

type Props = { dispatch: SignerDispatch };

export const SignerDeliveredScreen = ({ dispatch }: Props) => (
  <div className="flex h-full flex-col">
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-6 text-center">
      <div className="bg-signer-action flex size-[56px] items-center justify-center rounded-full shadow-[0_6px_16px_rgba(245,174,188,0.45)]">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="white"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="text-text-primary text-4xl font-semibold">직원 전달 완료</div>
      <div className="text-text-muted text-2xl leading-relaxed">답변 기다림</div>
    </div>

    <ActionBar layout="single">
      <ActionButton
        variant="neutral"
        className="w-full"
        onClick={() => dispatch({ type: 'RESET' })}
      >
        처음
      </ActionButton>
    </ActionBar>
  </div>
);
