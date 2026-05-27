// 와이어프레임 s_loading: 자동 전환되는 화면이라 액션 버튼 없음.
//
// 농인 가독성을 위해 UI 카피는 글로스 형태로 작성.
// 평문 원본 ↔ 글로스 매핑:
//   - 메인: '직원에게 전달하고 있어요' → '직원 전달 중'
//   - 서브: '잠시만요, 답변을 기다리고 있어요...' → '답변 기다림'
export const SignerLoadingScreen = () => (
  <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
    <div className="rounded-pill border-signer-bg border-t-signer-action size-14 animate-spin border-[3px]" />
    <div className="text-text-primary text-4xl font-semibold">직원 전달 중</div>
    <div className="text-text-muted text-2xl leading-relaxed">답변 기다림</div>
  </div>
);
