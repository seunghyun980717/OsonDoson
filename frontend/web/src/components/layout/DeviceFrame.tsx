// 풀스크린 컨테이너. 데스크톱 와이드까지 그대로 viewport 100% 사용 — letterbox 없음.
// jetson 의 3:2 letterbox 동작은 의도적으로 폐기 (웹 배포 요구: 화면 비율 따라 풀폭).
import type { ReactNode } from 'react';

type DeviceFrameProps = {
  children: ReactNode;
};

export const DeviceFrame = ({ children }: DeviceFrameProps) => {
  return (
    <div className="bg-surface-page fixed inset-0 h-screen w-screen overflow-hidden">
      {children}
    </div>
  );
};
