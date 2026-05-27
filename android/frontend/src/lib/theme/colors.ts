// jetson/frontend/src/styles/global.css의 색 토큰을 RN으로 미러링.
// 의미 그룹(surface/text/border/hearing/signer/status)은 jetson @theme 블록을 따른다.

const scale = {
  // Neutral (공통 배경 & 텍스트)
  neutral0: '#ffffff',
  neutralBg: '#faf9f6',
  neutral100: '#f5f2f2',
  neutral200: '#ede3e3',
  neutral400: '#b7b0ae',
  neutral600: '#7a6e6b',
  neutral900: '#3d3533',

  // Green — 청인 / Hearing (sage)
  green50: '#f5fbf6',
  green100: '#e6f4e8',
  green300: '#d4ebd6',
  green500: '#a8d9ad',
  green600: '#94cc99',
  green700: '#5ca866',

  // Peach — 농인 / Signer (살구)
  peach50: '#fff8f3',
  peach100: '#fff0e8',
  peach300: '#ffd9c4',
  peach500: '#ffb89a',
  peach600: '#f5a585',
  peach700: '#e88a5f',

  // Red — 에러 전용
  red100: '#fce4e6',
  red500: '#d9525e',
  red700: '#a83441',

  // Status
  statusOnline: '#14b8a6', // teal — hearing 그린과 색상 거리 확보
  statusErrorBorder: '#f2c5ca',
} as const;

export const colors = {
  surface: {
    page: scale.neutralBg,
    screen: scale.neutral0,
    card: scale.neutral0,
  },

  text: {
    primary: scale.neutral900,
    secondary: scale.neutral600,
    muted: scale.neutral400,
    onAccent: scale.neutral0,
  },

  border: {
    light: scale.neutral100,
    default: scale.neutral200,
  },

  // 청인 (Hearing / sage green)
  // actionFg는 흰색 대신 text.primary 사용 — WCAG AA 8:1 통과 (jetson 코멘트 참조)
  hearing: {
    bg: scale.green100,
    border: scale.green300,
    action: scale.green500,
    actionHover: scale.green600,
    actionFg: scale.neutral900,
    dot: scale.green500,
    focusRing: scale.green700,
  },

  // 농인 (Signer / peach)
  // actionFg는 흰색 대신 text.primary 사용 — WCAG AA 7:1 통과
  signer: {
    bg: scale.peach100,
    border: scale.peach300,
    action: scale.peach500,
    actionHover: scale.peach600,
    actionFg: scale.neutral900,
    dot: scale.peach500,
    focusRing: scale.peach700,
  },

  status: {
    online: scale.statusOnline,
    info: {
      bg: scale.neutral100,
      text: scale.neutral900,
      dot: scale.neutral600,
    },
    error: {
      bg: scale.red100,
      text: scale.red700,
      dot: scale.red500,
      border: scale.statusErrorBorder,
    },
  },

  // 카메라/영상 stage — 어두운 배경 위에 인디케이터/오버레이를 쌓을 때 사용.
  // 모바일 한손 수어 모집·녹화 흐름에서만 사용 (페이지 영역과는 다른 어두운 톤 세트).
  stage: {
    bg: '#1a1a18',                       // 카메라/비디오 stage 기본 배경
    fg: '#f1efe8',                       // stage 위 텍스트 (REC 라벨 등)
    dim: 'rgba(0,0,0,0.4)',              // 대기 상태 darkening
    scrim: 'rgba(0,0,0,0.55)',           // 상태 pill 배경
    overlay: 'rgba(0,0,0,0.7)',          // REC indicator 같은 강조 오버레이
    wash: 'rgba(0,0,0,0.6)',             // finalize 풀스크린 오버레이
    subtleBorder: 'rgba(255,255,255,0.4)',
    mutedText: 'rgba(255,255,255,0.85)',
  },
} as const;
