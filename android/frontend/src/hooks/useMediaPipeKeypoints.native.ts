// Native(iOS/Android) — vision-camera v4 + react-native-mediapipe (Pose + Hand patch).
// Hand는 patches/react-native-mediapipe+0.6.0.patch로 cdiddy77 v0.6.0에 추가한 detection.
// 두 detection의 결과를 jetson SignerFrame 형식으로 매핑한다.
//
// caller(SignerInputScreen)는 frameProcessor를 vision-camera <Camera>에 전달해야 한다.
// jetson(web) 변형(useMediaPipeKeypoints.ts)과 시그니처가 다름 — cameraRef 인자 X, frameProcessor O.

import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeEventEmitter, NativeModules } from 'react-native';
import {
  Delegate,
  type PoseLandmarkerResult,
  RunningMode,
} from 'react-native-mediapipe';

// react-native-mediapipe의 lib/typescript build 산출물엔 handDetection 타입이 없어 (우리가 patch로 src만 추가)
// 호환 시그니처를 hook 안에서 직접 정의한다.
type HandednessCategory = {
  categoryName: 'Left' | 'Right' | string;
  displayName: string;
  score: number;
  index: number;
};
type Landmark = { x: number; y: number; z: number };
type HandLandmarkerResult = {
  landmarks: Landmark[][];
  worldLandmarks: Landmark[][];
  handedness: HandednessCategory[][];
};
import {
  type Frame,
  useFrameProcessor,
  VisionCameraProxy,
} from 'react-native-vision-camera';

import type { SignerFrame } from '@/lib/api/types';

const TARGET_FPS = 15;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
const MAX_FRAMES = 450; // 30s @ 15fps 안전망

const POSE_MODEL = 'pose_landmarker_lite.task';
const HAND_MODEL = 'hand_landmarker.task';

const posePlugin = VisionCameraProxy.initFrameProcessorPlugin('poseDetection', {});
const handPlugin = VisionCameraProxy.initFrameProcessorPlugin('handDetection', {});

const { PoseDetection, HandDetection } = NativeModules;
const poseEmitter = new NativeEventEmitter(PoseDetection);
const handEmitter = new NativeEventEmitter(HandDetection);

type UseMediaPipeResult = {
  isReady: boolean;
  isDetecting: boolean;
  isExtracting: boolean;
  errorMessage: string | null;
  frameProcessor: ReturnType<typeof useFrameProcessor> | undefined;
  startDetection: () => void;
  stopDetection: () => void;
  startExtraction: (
    maxDurationSec?: number,
    onAutoStop?: (frames: SignerFrame[]) => void,
  ) => void;
  stopExtraction: () => SignerFrame[];
  cancelExtraction: () => void;
  latestFrameRef: MutableRefObject<SignerFrame | null>;
  framesCountRef: MutableRefObject<number>;
};

const emptyLandmarkArray: SignerFrame['poseLandmarks'] = [];

export const useMediaPipeKeypoints = (): UseMediaPipeResult => {
  const [isReady, setIsReady] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [poseHandle, setPoseHandle] = useState<number | null>(null);
  const [handHandle, setHandHandle] = useState<number | null>(null);

  const latestPoseRef = useRef<PoseLandmarkerResult | null>(null);
  const latestHandRef = useRef<HandLandmarkerResult | null>(null);

  const framesRef = useRef<SignerFrame[]>([]);
  const latestFrameRef = useRef<SignerFrame | null>(null);
  const framesCountRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extractingRef = useRef(false);

  // detector 생성/해제 — mount 시 1회.
  useEffect(() => {
    let cancelled = false;
    let createdPose: number | undefined;
    let createdHand: number | undefined;

    const init = async () => {
      try {
        createdPose = await PoseDetection.createDetector(
          1,
          0.5,
          0.5,
          0.5,
          false,
          POSE_MODEL,
          Delegate.GPU,
          RunningMode.LIVE_STREAM,
        );
        createdHand = await HandDetection.createDetector(
          2,
          0.5,
          0.5,
          0.5,
          HAND_MODEL,
          Delegate.GPU,
          RunningMode.LIVE_STREAM,
        );
        if (cancelled) {
          if (createdPose !== undefined) PoseDetection.releaseDetector(createdPose);
          if (createdHand !== undefined) HandDetection.releaseDetector(createdHand);
          return;
        }
        setPoseHandle(createdPose ?? null);
        setHandHandle(createdHand ?? null);
        setIsReady(true);
      } catch (err) {
        console.error('[useMediaPipeKeypoints] detector 생성 실패:', err);
        if (!cancelled) {
          setErrorMessage('수어 인식 준비에 실패했습니다. 다시 시도해주세요.');
        }
      }
    };
    void init();

    return () => {
      cancelled = true;
      if (createdPose !== undefined) PoseDetection.releaseDetector(createdPose);
      if (createdHand !== undefined) HandDetection.releaseDetector(createdHand);
    };
  }, []);

  // detection 결과 listener — pose + hand 별개 callback.
  // 매 callback마다 latest 갱신 + extraction 중이면 SignerFrame push (15fps throttle).
  useEffect(() => {
    const pushFrame = (videoWidth: number, videoHeight: number) => {
      if (!extractingRef.current) return;
      const now = Date.now();
      if (now - lastFrameTimeRef.current < FRAME_INTERVAL_MS) return;
      lastFrameTimeRef.current = now;

      if (framesRef.current.length >= MAX_FRAMES) {
        extractingRef.current = false;
        setIsExtracting(false);
        if (stopTimerRef.current !== null) {
          clearTimeout(stopTimerRef.current);
          stopTimerRef.current = null;
        }
        return;
      }

      const pose = latestPoseRef.current;
      const hand = latestHandRef.current;

      const poseLandmarks = pose?.landmarks?.[0] ?? emptyLandmarkArray;

      // handedness로 좌/우 분류 (handednesses[i][0].categoryName === 'Left' | 'Right')
      let leftHand: SignerFrame['leftHandLandmarks'] = emptyLandmarkArray;
      let rightHand: SignerFrame['rightHandLandmarks'] = emptyLandmarkArray;
      if (hand?.landmarks && hand.handedness) {
        hand.handedness.forEach((cats: HandednessCategory[], i: number) => {
          const name = cats[0]?.categoryName;
          const lm = hand.landmarks[i];
          if (!lm) return;
          if (name === 'Left') leftHand = lm;
          else if (name === 'Right') rightHand = lm;
        });
      }

      const frame: SignerFrame = {
        poseLandmarks,
        leftHandLandmarks: leftHand,
        rightHandLandmarks: rightHand,
        faceLandmarks: [], // 모바일 가드 — disable
        videoWidth,
        videoHeight,
      };

      latestFrameRef.current = frame;
      framesRef.current.push(frame);
      framesCountRef.current = framesRef.current.length;
    };

    const poseSub = poseEmitter.addListener('onResults', (args: { results: PoseLandmarkerResult[]; inputImageWidth: number; inputImageHeight: number }) => {
      if (args.results?.[0]) {
        latestPoseRef.current = args.results[0];
      }
      pushFrame(args.inputImageWidth, args.inputImageHeight);
    });

    const handSub = handEmitter.addListener('onHandResults', (args: { results: HandLandmarkerResult[]; inputImageWidth: number; inputImageHeight: number }) => {
      if (args.results?.[0]) {
        latestHandRef.current = args.results[0];
      }
      pushFrame(args.inputImageWidth, args.inputImageHeight);
    });

    const errSub = poseEmitter.addListener('onError', (args: { message: string }) => {
      console.error('[mediapipe pose] error:', args.message);
    });
    const handErrSub = handEmitter.addListener('onHandError', (args: { message: string }) => {
      console.error('[mediapipe hand] error:', args.message);
    });

    return () => {
      poseSub.remove();
      handSub.remove();
      errSub.remove();
      handErrSub.remove();
    };
  }, []);

  // vision-camera frame processor — 두 plugin 호출.
  // worklet 안에서 JS useRef 접근은 안전하지 않아 항상 plugin call하고,
  // detection 활성/비활성은 poseHandle/handHandle이 null인지로 제어한다.
  // extraction 중 SignerFrame push 여부는 JS 측 listener의 extractingRef로 결정.
  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';
      const orientation = 'portrait';
      if (poseHandle != null) {
        posePlugin?.call(frame, { detectorHandle: poseHandle, orientation });
      }
      if (handHandle != null) {
        handPlugin?.call(frame, { detectorHandle: handHandle, orientation });
      }
    },
    [poseHandle, handHandle],
  );

  const startDetection = useCallback(() => {
    if (poseHandle == null || handHandle == null) {
      console.warn('[useMediaPipeKeypoints] 아직 초기화 안 됨');
      return;
    }
    setIsDetecting(true);
    lastFrameTimeRef.current = 0;
    latestFrameRef.current = null;
    latestPoseRef.current = null;
    latestHandRef.current = null;
  }, [poseHandle, handHandle]);

  const stopDetection = useCallback(() => {
    setIsDetecting(false);
    latestFrameRef.current = null;
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
    (maxDurationSec?: number, onAutoStop?: (frames: SignerFrame[]) => void) => {
      if (poseHandle == null || handHandle == null) {
        console.warn('[useMediaPipeKeypoints] 아직 초기화 안 됨');
        return;
      }
      setIsDetecting(true);
      lastFrameTimeRef.current = 0;
      framesRef.current = [];
      framesCountRef.current = 0;
      extractingRef.current = true;
      setIsExtracting(true);

      if (maxDurationSec && maxDurationSec > 0) {
        stopTimerRef.current = setTimeout(() => {
          const frames = [...framesRef.current];
          framesRef.current = [];
          framesCountRef.current = 0;
          extractingRef.current = false;
          setIsExtracting(false);
          stopTimerRef.current = null;
          onAutoStop?.(frames);
        }, maxDurationSec * 1000);
      }
    },
    [poseHandle, handHandle],
  );

  const stopExtraction = useCallback((): SignerFrame[] => {
    extractingRef.current = false;
    setIsExtracting(false);
    if (stopTimerRef.current !== null) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
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
    frameProcessor,
    startDetection,
    stopDetection,
    startExtraction,
    stopExtraction,
    cancelExtraction,
    latestFrameRef,
    framesCountRef,
  };
};

export const debugLogFrames = (frames: readonly SignerFrame[]): void => {
  if (!__DEV__) return;
  if (frames.length === 0) {
    console.log('[mediapipe] frames 없음');
    return;
  }
  const first = frames[0];
  const last = frames[frames.length - 1];
  console.log('[mediapipe] frames 추출 완료', {
    count: frames.length,
    firstPoseCount: first.poseLandmarks.length,
    firstLeftHandCount: first.leftHandLandmarks.length,
    firstRightHandCount: first.rightHandLandmarks.length,
    lastPoseCount: last.poseLandmarks.length,
    lastLeftHandCount: last.leftHandLandmarks.length,
    lastRightHandCount: last.rightHandLandmarks.length,
    videoWidth: first.videoWidth,
    videoHeight: first.videoHeight,
  });
};
