// Android RN은 fontFamily 한 개 + fontWeight prop만으로 weight 매핑을 해주지 않아서
// weight마다 다른 fontFamily 명을 직접 지정해야 시스템 글꼴 폴백이 안 된다.
// (`useAppFonts.ts`에서 weight별 정적 .otf를 등록함)
export const fontFamily = {
  pretendard: 'Pretendard-Regular',
  pretendardMedium: 'Pretendard-Medium',
  pretendardSemibold: 'Pretendard-SemiBold',
  pretendardBold: 'Pretendard-Bold',
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

// 폰 화면 기준 가독성 베이스라인. 토스/파파고 톤 — 큰 글씨 + 충분한 위계 차.
export const fontSize = {
  xs: 13,
  sm: 15,
  base: 17,
  lg: 20,
  xl: 22,
  '2xl': 28,
  '3xl': 34,
  '4xl': 42,
} as const;

export const lineHeight = {
  xs: 18,
  sm: 22,
  base: 26,
  lg: 28,
  xl: 32,
  '2xl': 36,
  '3xl': 42,
  '4xl': 50,
} as const;
