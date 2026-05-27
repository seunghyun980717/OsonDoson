/**
 * 농인 수어 녹화 화면의 코너 브래킷 가이드.
 * 권장 위치 영역의 4개 코너 마커 — CSS border만으로 구성, 베지어 곡선 없음.
 * 카메라 풀스크린 위에 absolute로 오버레이.
 */
export const SignerGuideFrame = () => {
  const cornerBase = 'absolute h-12 w-12 border-signer-border opacity-85';
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className={`${cornerBase} top-[8%] left-[22%] rounded-tl-xl border-t-[3px] border-l-[3px]`}
      />
      <div
        className={`${cornerBase} top-[8%] right-[22%] rounded-tr-xl border-t-[3px] border-r-[3px]`}
      />
      <div
        className={`${cornerBase} bottom-[8%] left-[22%] rounded-bl-xl border-b-[3px] border-l-[3px]`}
      />
      <div
        className={`${cornerBase} bottom-[8%] right-[22%] rounded-br-xl border-b-[3px] border-r-[3px]`}
      />
    </div>
  );
};
