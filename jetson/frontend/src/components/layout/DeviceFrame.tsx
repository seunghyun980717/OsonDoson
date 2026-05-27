import type { ReactNode } from 'react';

type DeviceFrameProps = {
  children: ReactNode;
};

/**
 * 3:2 비율 디바이스 프레임.
 *
 * 실 배포 환경(Jetson + 3:2 모니터)에선 viewport와 inner가 동일 크기라
 * 외곽 letterbox 영역은 보이지 않음. 개발 환경(16:9 등)에선 inner가
 * 3:2로 클램핑되며 상/하 또는 좌/우에 검은 여백이 생겨 실기기 미리보기가 됨.
 *
 * 계산: width  = min(100vw, 100vh × 3 / 2)
 *      height = min(100vh, 100vw × 2 / 3)
 */
export const DeviceFrame = ({ children }: DeviceFrameProps) => {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black">
      <div
        className="bg-surface-page relative overflow-hidden"
        style={{
          width: 'min(100vw, calc(100vh * 3 / 2))',
          height: 'min(100vh, calc(100vw * 2 / 3))',
        }}
      >
        {children}
      </div>
    </div>
  );
};
