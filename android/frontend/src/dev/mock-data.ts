// Stage 4 화면 prototype용 mock 응답.
// `src/lib/api/types.ts`의 응답 타입을 그대로 채우므로 Stage 5에서 실 API로 swap할 때 화면 코드 수정이 필요 없다.
// Loading 화면이 frames/file 없이 진입했을 때(에러 복귀 등)의 fallback에도 사용.

import type { SignToSpeechResult, SpeechToSignResult } from '@/lib/api/types';

const MOCK_RESPONSE_DELAY_MS = 1500;

export type MockScenario = {
  id: string;
  label: string;
  hearingToSigner: SpeechToSignResult;
  signerToHearing: SignToSpeechResult;
};

export const mockScenarios: readonly MockScenario[] = [
  {
    id: 'greeting',
    label: '인사',
    hearingToSigner: {
      type: 'speech_to_sign_result',
      source: 'hearing',
      korean: '안녕하세요. 만나서 반갑습니다.',
      glosses: ['안녕', '만나다', '반갑다'],
      gloss_str: '안녕 만나다 반갑다',
      keypoint_url: '/static/json/mock_greeting.json',
      keypoint_path: null,
      keypoint_payload: {
        version: 'sign-sentence-keypoints/v1',
        // 더미 frames — AvatarVideoPlayer가 frame 모양 안 봄 (길이/타이밍만 사용).
        // 60 frames @ fps 30 = 2초 분량. placeholder 동작 검증용.
        frames: Array.from({ length: 60 }, (_, i) => ({
          frame_index: i,
          pose: [],
          left_hand: [],
          right_hand: [],
        })),
      },
      resolved_glosses: ['안녕', '만나다', '반갑다'],
      missing_glosses: [],
      coverage: 1.0,
      timings: { stt: 0.52, korean_to_gloss: 0.12 },
    },
    signerToHearing: {
      type: 'sign_to_speech_result',
      source: 'signer',
      glosses: ['안녕', '잘', '부탁'],
      korean: '안녕하세요. 잘 부탁드립니다.',
      audio_url: '/api/assets/audio/mock_greeting.mp3',
      audio: {
        format: 'mp3',
        content_type: 'audio/mpeg',
        url: '/api/assets/audio/mock_greeting.mp3',
      },
    },
  },
  {
    id: 'directions',
    label: '길 안내',
    hearingToSigner: {
      type: 'speech_to_sign_result',
      source: 'hearing',
      korean: '어디로 가고 싶으세요?',
      glosses: ['어디', '가다', '싶다'],
      gloss_str: '어디 가다 싶다',
      keypoint_url: '/static/json/mock_directions.json',
      keypoint_path: null,
      keypoint_payload: {
        version: 'sign-sentence-keypoints/v1',
        // 더미 frames — AvatarVideoPlayer가 frame 모양 안 봄 (길이/타이밍만 사용).
        // 60 frames @ fps 30 = 2초 분량. placeholder 동작 검증용.
        frames: Array.from({ length: 60 }, (_, i) => ({
          frame_index: i,
          pose: [],
          left_hand: [],
          right_hand: [],
        })),
      },
      resolved_glosses: ['어디', '가다', '싶다'],
      missing_glosses: [],
      coverage: 1.0,
      timings: { stt: 0.48, korean_to_gloss: 0.1 },
    },
    signerToHearing: {
      type: 'sign_to_speech_result',
      source: 'signer',
      glosses: ['병원', '가다'],
      korean: '병원에 가고 싶어요.',
      audio_url: '/api/assets/audio/mock_directions.mp3',
      audio: {
        format: 'mp3',
        content_type: 'audio/mpeg',
        url: '/api/assets/audio/mock_directions.mp3',
      },
    },
  },
  {
    id: 'help',
    label: '도움 요청',
    hearingToSigner: {
      type: 'speech_to_sign_result',
      source: 'hearing',
      korean: '도와드릴까요?',
      glosses: ['돕다', '드리다'],
      gloss_str: '돕다 드리다',
      keypoint_url: '/static/json/mock_help.json',
      keypoint_path: null,
      keypoint_payload: {
        version: 'sign-sentence-keypoints/v1',
        // 더미 frames — AvatarVideoPlayer가 frame 모양 안 봄 (길이/타이밍만 사용).
        // 60 frames @ fps 30 = 2초 분량. placeholder 동작 검증용.
        frames: Array.from({ length: 60 }, (_, i) => ({
          frame_index: i,
          pose: [],
          left_hand: [],
          right_hand: [],
        })),
      },
      resolved_glosses: ['돕다', '드리다'],
      missing_glosses: [],
      coverage: 1.0,
      timings: { stt: 0.45, korean_to_gloss: 0.09 },
    },
    signerToHearing: {
      type: 'sign_to_speech_result',
      source: 'signer',
      glosses: ['도움', '감사'],
      korean: '도와주셔서 감사합니다.',
      audio_url: '/api/assets/audio/mock_help.mp3',
      audio: {
        format: 'mp3',
        content_type: 'audio/mpeg',
        url: '/api/assets/audio/mock_help.mp3',
      },
    },
  },
];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const pickScenario = (index: number): MockScenario =>
  mockScenarios[index] ?? mockScenarios[0];

export const fetchMockSpeechToSign = async (
  scenarioIndex = 0,
): Promise<SpeechToSignResult> => {
  await wait(MOCK_RESPONSE_DELAY_MS);
  return pickScenario(scenarioIndex).hearingToSigner;
};

export const fetchMockSignToSpeech = async (
  scenarioIndex = 0,
): Promise<SignToSpeechResult> => {
  await wait(MOCK_RESPONSE_DELAY_MS);
  return pickScenario(scenarioIndex).signerToHearing;
};

// 추천 화면 mock — BE `/api/glosses/categories` 호출 실패 시 fallback.
// BE 가 살아있을 땐 클라이언트가 서버 응답을 우선 사용.
export const recommendCategories: readonly string[] = [
  '병원',
  '은행',
  '관공서',
  '교통',
  '기타',
];

const candidatesByCategory: Record<string, readonly string[]> = {
  병원: ['아프다', '가다', '도움', '부탁', '감사', '질문', '주사', '약'],
  은행: ['입금', '출금', '통장', '카드', '송금', '도움', '부탁', '감사'],
  관공서: ['신청', '서류', '확인', '도움', '부탁', '감사', '질문', '주민'],
  교통: ['가다', '오다', '버스', '지하철', '도착', '출발', '느리다', '빠르다'],
  기타: ['도움', '부탁', '감사', '질문', '알다', '모르다', '좋다', '싫다'],
};

export const fetchMockRecommendations = async (
  category: string,
  sequence: string[],
): Promise<string[]> => {
  await wait(200);
  const all = candidatesByCategory[category] ?? [];
  return all.filter((g) => !sequence.includes(g));
};

export const fetchMockGlossesToSpeech = async (
  glosses: string[],
): Promise<{ korean: string; audio_url: string }> => {
  await wait(800);
  return {
    korean: glosses.join(' ') + '입니다.',
    audio_url: '/api/assets/audio/mock_recommend.mp3',
  };
};
