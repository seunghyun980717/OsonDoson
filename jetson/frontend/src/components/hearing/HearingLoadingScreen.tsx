// 와이어프레임 h_loading: 자동 전환되는 화면이라 액션 버튼 없음.
export const HearingLoadingScreen = () => {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
      <div className="rounded-pill border-hearing-bg border-t-hearing-action size-14 animate-spin border-[3px]" />
      <div className="text-text-primary text-4xl font-semibold">고객에게 전달하고 있어요</div>
      <div className="text-text-muted text-2xl leading-relaxed">
        수어 아바타로 변환하고 있어요...
      </div>
    </div>
  );
};
