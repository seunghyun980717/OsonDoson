import { Hand } from 'lucide-react';
import { useEffect } from 'react';

import { useCamera } from '../../hooks/useCamera';
import type { SignerDispatch } from '../../hooks/useSignerFlow';
import { ErrorInline } from '../feedback/ErrorInline';

// * 농인 가독성을 위해 UI 카피 문장을 글로스 형태로 작성.
// 평문 원본 ↔ 글로스 매핑:
// - 헤로: '수어로 대화를 시작해보세요' → '수어\n대화 시작'
// - 서브: '버튼을 누르고 천천히 표현해주세요' → '버튼 누름 / 천천히 수어'
// - 버튼: '수어 시작하기' → '수어 시작'

type Props = { dispatch: SignerDispatch };

export const SignerIdleScreen = ({ dispatch }: Props) => {
  const { status, errorMessage, requestStream } = useCamera();

  // Idle 진입 시 카메라 권한 미리 요청
  useEffect(() => {
    void requestStream();
  }, [requestStream]);

  const cameraReady = status === 'ready';

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-8 px-8 pt-10 pb-8">
      {errorMessage && (
        <div className="absolute top-4 right-4 left-4">
          <ErrorInline tone="signer">{errorMessage}</ErrorInline>
        </div>
      )}

      <div className="flex flex-col items-center gap-6 text-center">
        <div className="bg-signer-bg flex size-[88px] items-center justify-center rounded-full shadow-[0_8px_24px_rgba(245,174,188,0.35)]">
          <Hand
            size={40}
            strokeWidth={1.8}
            className="text-signer-action-hover"
            aria-hidden="true"
          />
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-text-primary text-5xl leading-tight font-bold tracking-[-0.02em] whitespace-pre-line">
            {'수어\n대화 시작'}
          </h1>
          <p className="text-text-secondary text-2xl leading-relaxed font-medium">
            버튼 누름
            <span className="text-signer-action-hover mx-2">/</span>
            천천히 수어
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => dispatch({ type: 'START_RECORDING' })}
        disabled={!cameraReady}
        className="bg-signer-action text-signer-action-fg hover:bg-signer-action-hover min-w-[72%] rounded-2xl px-10 py-5 text-3xl font-semibold shadow-[0_6px_14px_rgba(245,174,188,0.4)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(245,174,188,0.5)] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-signer-action disabled:hover:shadow-[0_6px_14px_rgba(245,174,188,0.4)]"
      >
        수어 시작
      </button>
    </div>
  );
};
