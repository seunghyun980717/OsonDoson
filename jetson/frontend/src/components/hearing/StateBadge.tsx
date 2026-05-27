import type { HearingState } from '../../hooks/useHearingFlow';
import { Badge } from '../feedback/Badge';

const stateConfig: Record<HearingState, { variant: 'idle' | 'hearing' | 'done'; label: string }> = {
  idle: { variant: 'idle', label: '대기 중' },
  speaking: { variant: 'hearing', label: '음성 입력 중' },
  loading: { variant: 'hearing', label: '전달 중' },
  delivered: { variant: 'done', label: '전달 완료' },
  result: { variant: 'hearing', label: '수어 인식 완료' },
};

type StateBadgeProps = {
    state: HearingState;
};

export const StateBadge = ({ state } : StateBadgeProps) => {
    const { variant, label } = stateConfig[state];
    return <Badge variant={variant}>{label}</Badge>
};