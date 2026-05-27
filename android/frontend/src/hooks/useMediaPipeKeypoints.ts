// jetson `src/hooks/useMediaPipeKeypoints.ts` RN 변환.
// 시그니처는 동일 — 향후 라이브러리 swap (vision-camera + JSI 등) 시 호출처(SignerInputScreen) 변경 X.
//
// 모바일 가드 (react_native_mediapipe_guide.md §5):
//   - faceLandmarker disable (수어 인식에 face 불필요, 데이터 ~85% 감소)
//   - 15fps target (jetson 30fps의 절반, 메모리·CPU 절약)
//   - 녹화 길이 5~10초 강제 자동 종료 (startExtraction maxDurationSec)
//   - stop 시 explicit dispose
//
// 카메라 frame 추출은 expo-camera 통합 시점에 plumbing.
import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import type { CameraView } from 'expo-camera';
import type { MutableRefObject, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { SignerFrame } from '@/lib/api/types';

// MediaPipe Tasks 모델 자산 — Google CDN. 로컬 번들 X (앱 크기 절약).
// wasm 버전은 package.json의 설치 버전과 맞춤 — 향후 메이저 업데이트로 호환성 깨짐 방지.
const TASKS_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

// 15fps target (jetson 30fps의 절반)
const TARGET_FPS = 15;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
// 안전망 — maxDurationSec와 무관 강제 cap. 20초 @ 15fps.
// maxDurationSec setTimeout이 어떤 이유(백그라운드 진입 등)로 실행되지 않아도 메모리 누수 방지.
const MAX_FRAMES = 300;

// 안전한 high-resolution timer (Hermes/WebView 모두 호환)
const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

type UseMediaPipeResult = {
  isReady: boolean;
  isDetecting: boolean;
  isExtracting: boolean;
  errorMessage: string | null;
  // 검출(rAF + landmark inference) — latestFrameRef 업데이트만, 프레임 누적/타이머 없음
  startDetection: () => void;
  stopDetection: () => void;
  // 녹화(extraction) — 프레임 누적 + maxDurationSec 타이머. 검출이 꺼진 상태면 자동으로 켬
  startExtraction: (maxDurationSec?: number) => void;
  stopExtraction: () => SignerFrame[];
  cancelExtraction: () => void;
  // 리렌더 없이 최신 프레임/누적 카운트 읽기 — 실시간 검출 상태 UI에서 사용
  latestFrameRef: MutableRefObject<SignerFrame | null>;
  framesCountRef: MutableRefObject<number>;
};

export const useMediaPipeKeypoints = (
  cameraRef: RefObject<CameraView | null>,
): UseMediaPipeResult => {
  const [isReady, setIsReady] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const poseRef = useRef<PoseLandmarker | null>(null);
  const handRef = useRef<HandLandmarker | null>(null);
  const framesRef = useRef<SignerFrame[]>([]);
  const latestFrameRef = useRef<SignerFrame | null>(null);
  const framesCountRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectionRef = useRef(false);
  const extractingRef = useRef(false);

  // 마운트 시 pose / hand landmarker 초기화 (face 제외 — 모바일 가드)
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(TASKS_WASM_BASE);

        const [pose, hand] = await Promise.all([
          PoseLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: POSE_MODEL,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
          }),
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: HAND_MODEL,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.3,
            minHandPresenceConfidence: 0.3,
          }),
        ]);

        if (mounted) {
          poseRef.current = pose;
          handRef.current = hand;
          setIsReady(true);
        } else {
          // 언마운트 후 비동기 init이 완료된 경우, 즉시 정리
          pose.close();
          hand.close();
        }
      } catch (err) {
        console.error('[useMediaPipeKeypoints] 초기화 실패:', err);
        if (mounted) {
          setErrorMessage('수어 인식 준비에 실패했습니다. 다시 시도해주세요.');
        }
      }
    };

    void init();

    return () => {
      mounted = false;
      detectionRef.current = false;
      extractingRef.current = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (stopTimerRef.current !== null) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      poseRef.current?.close();
      handRef.current?.close();
      poseRef.current = null;
      handRef.current = null;
    };
  }, [cameraRef]);

  // 1프레임 추론: pose + hand landmarker 동기 detectForVideo → SignerFrame 어댑터.
  // latestFrameRef는 항상 갱신, framesRef는 extraction 중일 때만 누적.
  // 카메라 frame 추출은 expo-camera 통합 시점(Phase 5)에 plumbing — 현재는 빈 frame stub.
  const captureFrame = useCallback(
    (_timestamp: number) => {
      const camera = cameraRef.current;
      const pose = poseRef.current;
      const hand = handRef.current;
      if (!camera || !pose || !hand) return;

      // TODO(Phase 5 카메라 통합):
      //   1. expo-camera에서 현재 frame을 ImageBitmap/HTMLCanvasElement 형태로 추출
      //   2. pose.detectForVideo(frameSource, timestamp) / hand.detectForVideo(...)
      //   3. 결과를 SignerFrame 형태로 매핑 (jetson 패턴 — handedness로 좌우 분류)
      // 현재는 모양만 — 실 frame이 없어 빈 SignerFrame 반환.
      const frame: SignerFrame = {
        poseLandmarks: [],
        leftHandLandmarks: [],
        rightHandLandmarks: [],
        faceLandmarks: [], // 모바일 가드 — disable
      };

      latestFrameRef.current = frame;

      if (extractingRef.current) {
        // 안전망 — MAX_FRAMES 초과 시 extraction 자동 stop.
        if (framesRef.current.length >= MAX_FRAMES) {
          extractingRef.current = false;
          setIsExtracting(false);
          if (stopTimerRef.current !== null) {
            clearTimeout(stopTimerRef.current);
            stopTimerRef.current = null;
          }
          return;
        }
        framesRef.current.push(frame);
        framesCountRef.current = framesRef.current.length;
      }
    },
    [cameraRef],
  );

  const tick = useCallback(() => {
    if (!detectionRef.current) return;

    const t = nowMs();
    if (t - lastFrameTimeRef.current >= FRAME_INTERVAL_MS) {
      lastFrameTimeRef.current = t;
      try {
        captureFrame(t);
      } catch (err) {
        console.error('[useMediaPipeKeypoints] detect 실패:', err);
      }
    }

    if (detectionRef.current) {
      rafIdRef.current = requestAnimationFrame(tick);
    }
  }, [captureFrame]);

  const startDetection = useCallback(() => {
    if (detectionRef.current) return;
    if (!poseRef.current || !handRef.current) {
      console.warn('[useMediaPipeKeypoints] 아직 초기화 안 됨');
      return;
    }
    detectionRef.current = true;
    setIsDetecting(true);
    lastFrameTimeRef.current = 0;
    latestFrameRef.current = null;
    rafIdRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const stopDetection = useCallback(() => {
    detectionRef.current = false;
    setIsDetecting(false);
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    latestFrameRef.current = null;
    // extraction이 진행 중이었다면 같이 정리 (메모리 누수 방지)
    if (extractingRef.current) {
      extractingRef.current = false;
      setIsExtracting(false);
      if (stopTimerRef.current !== null) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      framesRef.current = [];
      framesCountRef.current = 0;
    }
  }, []);

  const startExtraction = useCallback(
    (maxDurationSec?: number) => {
      // 검출이 꺼진 상태에서 호출되면 자동으로 켬 (jetson 미러)
      if (!detectionRef.current) {
        if (!poseRef.current || !handRef.current) {
          console.warn('[useMediaPipeKeypoints] 아직 초기화 안 됨');
          return;
        }
        detectionRef.current = true;
        setIsDetecting(true);
        lastFrameTimeRef.current = 0;
        rafIdRef.current = requestAnimationFrame(tick);
      }
      framesRef.current = [];
      framesCountRef.current = 0;
      extractingRef.current = true;
      setIsExtracting(true);

      if (maxDurationSec && maxDurationSec > 0) {
        stopTimerRef.current = setTimeout(() => {
          extractingRef.current = false;
          setIsExtracting(false);
          stopTimerRef.current = null;
        }, maxDurationSec * 1000);
      }
    },
    [tick],
  );

  const stopExtraction = useCallback((): SignerFrame[] => {
    extractingRef.current = false;
    setIsExtracting(false);
    if (stopTimerRef.current !== null) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    // 호출자가 사본을 받자마자 framesRef는 즉시 비움 — 누적 메모리 즉시 회수.
    const result = [...framesRef.current];
    framesRef.current = [];
    framesCountRef.current = 0;
    return result;
  }, []);

  const cancelExtraction = useCallback(() => {
    extractingRef.current = false;
    setIsExtracting(false);
    if (stopTimerRef.current !== null) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    framesRef.current = [];
    framesCountRef.current = 0;
  }, []);

  return {
    isReady,
    isDetecting,
    isExtracting,
    errorMessage,
    startDetection,
    stopDetection,
    startExtraction,
    stopExtraction,
    cancelExtraction,
    latestFrameRef,
    framesCountRef,
  };
};

// 디버깅용 — 추출된 frames 요약 콘솔 출력. 좌표 정합성·landmark 수 빠른 확인 용도.
// 호출처(SignerInputScreen 등)가 stopExtraction 결과 받자마자 호출하면
// `SignerFrame` 타입(`lib/api/types.ts`)대로 채워졌는지 검증 가능.
export const debugLogFrames = (frames: readonly SignerFrame[]): void => {
  if (!__DEV__) return;
  if (frames.length === 0) {
    console.log('[mediapipe] frames 없음');
    return;
  }
  const first = frames[0];
  console.log('[mediapipe] frames 추출 완료', {
    count: frames.length,
    poseCount: first.poseLandmarks.length,
    leftHandCount: first.leftHandLandmarks.length,
    rightHandCount: first.rightHandLandmarks.length,
    faceCount: first.faceLandmarks.length,
    videoWidth: first.videoWidth,
    videoHeight: first.videoHeight,
  });
};
