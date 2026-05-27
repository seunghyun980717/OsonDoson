// Spring 백엔드 응답/요청 타입. android/frontend/src/lib/api/types.ts 미러.
// 웹용: RNFileInput 제거 (대신 그냥 Blob/File 사용).

export type ApiResponse<T> = {
  code: string;
  message: string;
  data: T | null;
};

export type Landmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

export type SignerFrame = {
  poseLandmarks: Landmark[];
  leftHandLandmarks: Landmark[];
  rightHandLandmarks: Landmark[];
  // 웹: jetson MediaPipe hook은 face landmarker를 켜지 않음 (수어 인식에 face 불필요).
  // Spring MediaPipeFrameRequest는 null/missing 시 빈 리스트로 처리하므로 선택값으로 둠.
  faceLandmarks?: Landmark[];
  videoWidth?: number;
  videoHeight?: number;
};

export type SignToSpeechRequest = {
  type: 'signer_keypoints';
  frames: SignerFrame[];
};

export type SignToSpeechResult = {
  type: 'sign_to_speech_result';
  source: 'signer';
  glosses: string[];
  korean: string;
  audio_url: string | null;
  audio: {
    format: string;
    content_type: string;
    url: string;
  } | null;
};

export type TextToSignRequest = {
  text: string;
};

export type KeypointFrame = {
  frame_index: number;
  pose: { x: number; y: number; z: number }[];
  left_hand: { x: number; y: number; z: number }[];
  right_hand: { x: number; y: number; z: number }[];
};

export type SpeechToSignResult = {
  type: 'speech_to_sign_result';
  source: 'hearing';
  korean: string;
  glosses: string[];
  gloss_str: string;
  keypoint_url: string | null;
  keypoint_path: string | null;
  keypoint_payload: {
    version: string;
    frames: KeypointFrame[];
  };
  resolved_glosses: string[];
  missing_glosses: string[];
  coverage: number;
  timings: Record<string, number>;
};

// 한손 수어 데이터 수집 — 현재 웹 MVP에선 사용 안 함. 타입만 유지.
export type OneHandSignCreateRequest = {
  gloss: string;
  frames: SignerFrame[];
};

export type OneHandSignCreateResponse = {
  id: string;
};
