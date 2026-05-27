// Spring 백엔드 응답/요청 타입. 가이드의 type 명세를 그대로 미러링.

import type { KeypointPayload } from '@/types/avatarKeypoints';

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
  faceLandmarks: Landmark[];
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
  keypoint_payload: KeypointPayload;
  resolved_glosses: string[];
  missing_glosses: string[];
  coverage: number;
  timings: Record<string, number>;
};

// React Native FormData에 파일 append할 때 쓰는 형태
// (RN의 FormData append는 Web의 Blob과 다름 — uri/name/type 객체)
export type RNFileInput = {
  uri: string;
  name: string;
  type: string;
};

// 한손 수어 데이터 수집
export type OneHandSignCreateRequest = {
  gloss: string;
  frames: SignerFrame[];
};

export type OneHandSignCreateResponse = {
  id: string;
};
