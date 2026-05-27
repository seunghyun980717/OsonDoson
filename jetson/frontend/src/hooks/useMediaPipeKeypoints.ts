import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import type { MutableRefObject, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { SignerFrame } from '@/types/ws';

const TASKS_BASE_PATH = '/mediapipe-tasks';
const TARGET_FPS = 30;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

// Jetson L4T Chromium 등 WebGL이 blocklist에 걸려 비활성된 환경에서는 GPU delegate 초기화 실패
// → WebGL 가용 여부를 feature-detect해 GPU/CPU 자동 선택
const MEDIAPIPE_DELEGATE: 'GPU' | 'CPU' = (() => {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    return gl ? 'GPU' : 'CPU';
  } catch {
    return 'CPU';
  }
})();

type LandmarkerBundle = {
  pose: PoseLandmarker;
  hand: HandLandmarker;
};

// Jetson 브라우저에서 wasm + landmarker 2개(pose/hand) 초기 로딩이 길어
// /signer 페이지 진입 즉시 모델을 백그라운드로 띄워두고 녹화 화면 진입 시 즉시 사용한다.
// 모듈 레벨 promise 캐시라 한 번 로드되면 탭이 살아있는 동안 재사용. landmarker 인스턴스는
// 의도적으로 close()하지 않는다 (재진입 시 재로딩 방지).
let cachedLandmarkersPromise: Promise<LandmarkerBundle> | null = null;

const loadLandmarkers = (): Promise<LandmarkerBundle> => {
  if (cachedLandmarkersPromise) return cachedLandmarkersPromise;
  cachedLandmarkersPromise = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(`${TASKS_BASE_PATH}/wasm`);
    const [pose, hand] = await Promise.all([
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: `${TASKS_BASE_PATH}/models/pose_landmarker_lite.task`,
          delegate: MEDIAPIPE_DELEGATE,
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      }),
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: `${TASKS_BASE_PATH}/models/hand_landmarker.task`,
          delegate: MEDIAPIPE_DELEGATE,
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.3,
        minHandPresenceConfidence: 0.3,
      }),
    ]);
    return { pose, hand };
  })().catch((err) => {
    // 실패 시 캐시를 비워 다음 진입 때 재시도할 수 있게 함
    cachedLandmarkersPromise = null;
    throw err;
  });
  return cachedLandmarkersPromise;
};

// /signer 페이지 진입 시점에 호출. idle 화면에서 사용자가 안내를 보는 동안
// 모델 로딩을 백그라운드에서 진행해 녹화 화면 진입 시 즉시 검출 가능하게 한다.
export const preloadMediaPipeKeypoints = (): void => {
  loadLandmarkers().catch((err) => {
    console.warn('[useMediaPipeKeypoints] preload 실패:', err);
  });
};

type UseMediaPipeResult = {
  isReady: boolean;
  isDetecting: boolean;
  isExtracting: boolean;
  errorMessage: string | null;
  // 검출(rAF + landmark inference) — latestFrameRef 업데이트만, 프레임 누적/타이머 없음
  startDetection: () => void;
  stopDetection: () => void;
  // 녹화(extraction) — 프레임 누적 + maxDurationSec 타이머. 검출이 켜져 있어야 동작
  startExtraction: (maxDurationSec?: number) => void;
  stopExtraction: () => SignerFrame[];
  cancelExtraction: () => void;
  // 리렌더 없이 최신 프레임/누적 카운트 읽기 — 실시간 검출 상태 UI에서 사용
  latestFrameRef: MutableRefObject<SignerFrame | null>;
  framesCountRef: MutableRefObject<number>;
};

export const useMediaPipeKeypoints = (
  videoRef: RefObject<HTMLVideoElement | null>,
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
  const stopTimerRef = useRef<number | null>(null);
  const detectionRef = useRef(false);
  const extractingRef = useRef(false);

  // 모듈 레벨 캐시에서 landmarker 가져오기. /signer 진입 시 preloadMediaPipeKeypoints가
  // 미리 호출돼 있으면 이미 로드 완료 상태라 즉시 isReady 진입.
  // close()는 호출하지 않음 — 캐시 살려두어 페이지 재진입 시 재로딩 방지.
  useEffect(() => {
    let mounted = true;

    loadLandmarkers().then(
      ({ pose, hand }) => {
        if (!mounted) return;
        poseRef.current = pose;
        handRef.current = hand;
        setIsReady(true);
      },
      (err) => {
        // raw 에러는 디버깅용으로 콘솔에만 — 사용자에게는 친화적 문구만 노출
        console.error('[useMediaPipeKeypoints] 초기화 실패:', err);
        if (mounted) {
          setErrorMessage('수어 인식 준비에 실패했습니다. 페이지를 새로고침해주세요.');
        }
      },
    );

    return () => {
      mounted = false;
      detectionRef.current = false;
      extractingRef.current = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      poseRef.current = null;
      handRef.current = null;
    };
  }, [videoRef]);

  // 1프레임 추론: 2 landmarker 동기 detectForVideo → SignerFrame 어댑터.
  // latestFrameRef는 항상 갱신, framesRef는 extraction 중일 때만 누적.
  const captureFrame = useCallback(
    (timestamp: number) => {
      const video = videoRef.current;
      const pose = poseRef.current;
      const hand = handRef.current;
      if (!video || !pose || !hand) return;

      const poseResult = pose.detectForVideo(video, timestamp);
      const handResult = hand.detectForVideo(video, timestamp);

      const poseLandmarks = (poseResult.landmarks?.[0] ?? []).map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z,
        visibility: p.visibility ?? 0,
      }));

      // hand: handedness(categoryName: "Left"/"Right")로 좌우 분류
      let leftHandLandmarks: SignerFrame['leftHandLandmarks'] = [];
      let rightHandLandmarks: SignerFrame['rightHandLandmarks'] = [];
      handResult.landmarks?.forEach((handLm, i) => {
        const handedness = handResult.handedness?.[i]?.[0]?.categoryName;
        const mapped = handLm.map((p) => ({
          x: p.x,
          y: p.y,
          z: p.z,
          visibility: 0,
        }));
        if (handedness === 'Left') {
          leftHandLandmarks = mapped;
        } else if (handedness === 'Right') {
          rightHandLandmarks = mapped;
        }
      });

      const frame: SignerFrame = {
        poseLandmarks,
        leftHandLandmarks,
        rightHandLandmarks,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      };

      latestFrameRef.current = frame;

      if (extractingRef.current) {
        framesRef.current.push(frame);
        framesCountRef.current = framesRef.current.length;
      }
    },
    [videoRef],
  );

  const tick = useCallback(
    function tick() {
      if (!detectionRef.current) return;
      const video = videoRef.current;

      if (video && video.readyState >= 2) {
        const now = performance.now();
        if (now - lastFrameTimeRef.current >= FRAME_INTERVAL_MS) {
          lastFrameTimeRef.current = now;
          try {
            captureFrame(now);
          } catch (err) {
            console.error('[useMediaPipeKeypoints] detect 실패:', err);
          }
        }
      }

      if (detectionRef.current) {
        rafIdRef.current = requestAnimationFrame(tick);
      }
    },
    [videoRef, captureFrame],
  );

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
  }, []);

  const startExtraction = useCallback(
    (maxDurationSec?: number) => {
      if (!detectionRef.current) {
        // 검출이 꺼진 상태에서 호출되면 자동으로 켬
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
        stopTimerRef.current = window.setTimeout(() => {
          extractingRef.current = false;
          setIsExtracting(false);
        }, maxDurationSec * 1000);
      }
    },
    [tick],
  );

  const stopExtraction = useCallback((): SignerFrame[] => {
    extractingRef.current = false;
    setIsExtracting(false);
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    return [...framesRef.current];
  }, []);

  const cancelExtraction = useCallback(() => {
    stopExtraction();
    framesRef.current = [];
    framesCountRef.current = 0;
  }, [stopExtraction]);

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
