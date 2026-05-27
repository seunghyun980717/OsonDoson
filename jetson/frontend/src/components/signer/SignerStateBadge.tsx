import type { SignerState } from "@/hooks/useSignerFlow";

import { Badge } from "../feedback/Badge";

// 농인 가독성을 위해 헤더 배지 라벨은 글로스 형태로 작성.
// 평문 원본 ↔ 글로스 매핑:
//   - idle: '대기 중' → '대기'
//   - recording: '수어 입력 중' → '수어 입력'
//   - loading: '전달 중' → '전달'
//   - delivered: '전달 완료' (그대로)
//   - result: '청인 응답 수신' → '청인 응답'
const stateConfig: Record<SignerState, { variant: 'idle' | 'signer' | 'done'; label: string }> = {
    idle: { variant: 'idle', label: '대기' },
    recording: { variant: 'signer', label: '수어 입력' },
    loading: { variant: 'signer', label: '전달' },
    delivered: { variant: 'done', label: '전달 완료' },
    result: { variant: 'signer', label: '청인 응답' },
};

type SignerStateBadgeProps = {
    state: SignerState;
}

export const SignerStateBadge = ({ state }: SignerStateBadgeProps) => {
    const { variant, label } = stateConfig[state];
  return (
    <Badge variant={variant}>{label}</Badge>
  )
}
