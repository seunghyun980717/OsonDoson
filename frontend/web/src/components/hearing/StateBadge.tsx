// 청인 화면 상단 상태 뱃지. 웹 턴제 flow state 기준으로 라벨 매핑.
import type { FlowState } from '@/contexts/FlowMachine';

import { Badge } from '../feedback/Badge';

const stateConfig: Record<FlowState, { variant: 'idle' | 'hearing' | 'done'; label: string }> = {
  hearing_idle: { variant: 'idle', label: '대기 중' },
  hearing_speaking: { variant: 'hearing', label: '음성 입력 중' },
  hearing_loading: { variant: 'hearing', label: '전달 중' },
  hearing_result: { variant: 'hearing', label: '수어 인식 완료' },
  // 농인 phase에는 청인 뱃지가 보이지 않지만 타입 충족용
  signer_idle: { variant: 'idle', label: '대기 중' },
  signer_recording: { variant: 'hearing', label: '대기 중' },
  signer_loading: { variant: 'hearing', label: '전달 중' },
  signer_result: { variant: 'done', label: '전달 완료' },
};

type StateBadgeProps = {
  state: FlowState;
};

export const StateBadge = ({ state }: StateBadgeProps) => {
  const { variant, label } = stateConfig[state];
  return <Badge variant={variant}>{label}</Badge>;
};
