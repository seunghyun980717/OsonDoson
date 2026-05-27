// 농인 화면 상단 상태 뱃지. 글로스 톤 라벨.
import type { FlowState } from '@/contexts/FlowMachine';

import { Badge } from '../feedback/Badge';

const stateConfig: Record<FlowState, { variant: 'idle' | 'signer' | 'done'; label: string }> = {
  signer_idle: { variant: 'idle', label: '대기' },
  signer_recording: { variant: 'signer', label: '수어 입력' },
  signer_loading: { variant: 'signer', label: '전달' },
  signer_result: { variant: 'signer', label: '청인 응답' },
  // 청인 phase에는 농인 뱃지가 보이지 않지만 타입 충족용
  hearing_idle: { variant: 'idle', label: '대기' },
  hearing_speaking: { variant: 'signer', label: '대기' },
  hearing_loading: { variant: 'signer', label: '전달' },
  hearing_result: { variant: 'done', label: '전달 완료' },
};

type SignerStateBadgeProps = {
  state: FlowState;
};

export const SignerStateBadge = ({ state }: SignerStateBadgeProps) => {
  const { variant, label } = stateConfig[state];
  return <Badge variant={variant}>{label}</Badge>;
};
