/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import * as THREE from 'three';

import type { ViewerFrame } from './avatarTypes';
import { distance2D, remapClamped } from './keypointUtils';

export const FACE_MODES = ['natural', 'faithful'] as const;
export const DEFAULT_FACE_MODE = 'natural';

export type FaceMode = (typeof FACE_MODES)[number];

export type HeadPose = {
  headPitch: number;
  headRoll: number;
  headYaw: number;
  neckPitch: number;
  neckRoll: number;
  neckYaw: number;
};

export type HeadFaceResult = {
  debug: unknown;
  headPose: HeadPose;
  morphs: Record<string, number>;
};

export type BlinkSyncMode = 'off' | 'average' | 'threshold';

export type BlinkSyncOptions = {
  mode?: BlinkSyncMode;
  threshold?: number;
};

export type HeadFaceStrategyOptions = {
  blinkSync?: BlinkSyncOptions;
  faceCalibration?: unknown;
  mode?: FaceMode;
};

export type TorsoBasis = {
  forward: THREE.Vector3;
  horizontalForward: THREE.Vector3;
  side: THREE.Vector3;
  up: THREE.Vector3;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FACE_MORPH_NAMES = [
  'mouthOpen',
  'jawOpen',
  'mouthPucker',
  'mouthFunnel',
  'mouthClose',
  'mouthPressLeft',
  'mouthPressRight',
  'mouthRollUpper',
  'mouthRollLower',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'eyeSquintLeft',
  'eyeSquintRight',
  'eyeWideLeft',
  'eyeWideRight',
  'browInnerUp',
  'browOuterUpLeft',
  'browOuterUpRight',
  'browDownLeft',
  'browDownRight',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'mouthStretchLeft',
  'mouthStretchRight',
  'mouthLeft',
  'mouthRight',
  'mouthUpperUpLeft',
  'mouthUpperUpRight',
  'mouthLowerDownLeft',
  'mouthLowerDownRight',
  'jawLeft',
  'jawRight',
  'jawForward',
] as const;

export const FACE_MORPH_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  browInnerUp: 0.08,
  browOuterUpLeft: 0.08,
  browOuterUpRight: 0.08,
  browDownLeft: 0.12,
  browDownRight: 0.12,
});

const STRATEGY_CONFIG = {
  natural: {
    head: {
      yawClamp: 0.5,
      pitchClamp: 0.38,
      rollClamp: 0.26,
      yawDeadzone: 0.025,
      pitchDeadzone: 0.014,
      rollDeadzone: 0.02,
      neckYawRatio: 0.5,
      neckPitchRatio: 0.58,
      neckRollRatio: 0.42,
      headYawScale: 0.96,
      headPitchScale: 1.12,
      headRollScale: 0.96,
    },
    morph: {
      blinkDeadzone: 0.04,
      blinkExponent: 1.65,
      blinkScale: 0.82,
      squintDeadzone: 0.14,
      squintScale: 0.35,
      wideDeadzone: 0.16,
      wideScale: 0.2,
      browDeadzone: 0.58,
      browScale: 0.34,
      browUpMax: 0.08,
      browDownMax: 0.12,
      mouthOpenDeadzone: 0.16,
      mouthOpenScale: 0.3,
      jawOpenDeadzone: 0.22,
      jawOpenScale: 0.28,
      puckerDeadzone: 0.14,
      puckerScale: 0.5,
      funnelDeadzone: 0.16,
      funnelScale: 0.28,
      closeDeadzone: 0.24,
      closeScale: 0.16,
      pressDeadzone: 0.2,
      pressScale: 0.06,
      smileDeadzone: 0.18,
      smileScale: 0.38,
      frownDeadzone: 0.28,
      frownScale: 0.12,
      stretchDeadzone: 0.18,
      stretchScale: 0.26,
      mouthSideDeadzone: 0.26,
      mouthSideScale: 0.12,
      upperLipDeadzone: 0.34,
      upperLipScale: 0.14,
      lowerLipDeadzone: 0.38,
      lowerLipScale: 0.12,
      jawSideDeadzone: 0.28,
      jawSideScale: 0.12,
      jawForwardDeadzone: 0.16,
      jawForwardScale: 0.24,
      rollDeadzone: 0.34,
      rollScale: 0.05,
    },
  },
  faithful: {
    head: {
      yawClamp: 0.8,
      pitchClamp: 0.58,
      rollClamp: 0.42,
      yawDeadzone: 0.012,
      pitchDeadzone: 0.006,
      rollDeadzone: 0.01,
      neckYawRatio: 0.6,
      neckPitchRatio: 0.68,
      neckRollRatio: 0.52,
      headYawScale: 1.04,
      headPitchScale: 1.2,
      headRollScale: 1.12,
    },
    morph: {
      blinkDeadzone: 0.02,
      blinkExponent: 1.4,
      blinkScale: 1,
      squintDeadzone: 0.08,
      squintScale: 0.62,
      wideDeadzone: 0.1,
      wideScale: 0.68,
      browDeadzone: 0.38,
      browScale: 0.48,
      browUpMax: 0.12,
      browDownMax: 0.16,
      mouthOpenDeadzone: 0.12,
      mouthOpenScale: 0.6,
      jawOpenDeadzone: 0.18,
      jawOpenScale: 0.42,
      puckerDeadzone: 0.1,
      puckerScale: 0.76,
      funnelDeadzone: 0.1,
      funnelScale: 0.5,
      closeDeadzone: 0.2,
      closeScale: 0.26,
      pressDeadzone: 0.18,
      pressScale: 0.1,
      smileDeadzone: 0.12,
      smileScale: 0.7,
      frownDeadzone: 0.22,
      frownScale: 0.22,
      stretchDeadzone: 0.12,
      stretchScale: 0.54,
      mouthSideDeadzone: 0.2,
      mouthSideScale: 0.26,
      upperLipDeadzone: 0.28,
      upperLipScale: 0.26,
      lowerLipDeadzone: 0.32,
      lowerLipScale: 0.2,
      jawSideDeadzone: 0.22,
      jawSideScale: 0.22,
      jawForwardDeadzone: 0.1,
      jawForwardScale: 0.5,
      rollDeadzone: 0.28,
      rollScale: 0.08,
    },
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function normalizeAngle(angle) {
  let value = angle;

  while (value > Math.PI) {
    value -= Math.PI * 2;
  }

  while (value < -Math.PI) {
    value += Math.PI * 2;
  }

  return value;
}

function meanAngle(values) {
  if (!values.length) {
    return 0;
  }

  const sinSum = values.reduce((sum, value) => sum + Math.sin(value), 0);
  const cosSum = values.reduce((sum, value) => sum + Math.cos(value), 0);
  return Math.atan2(sinSum, cosSum);
}

function quantile(values, q) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.floor((sorted.length - 1) * q), 0, sorted.length - 1);
  return sorted[index];
}

function applyDeadzoneMagnitude(value, deadzone) {
  const sign = Math.sign(value);
  const magnitude = Math.abs(value);

  if (magnitude <= deadzone) {
    return 0;
  }

  return sign * ((magnitude - deadzone) / Math.max(1e-6, 1 - deadzone));
}

function styleSignal(rawValue, options = {}) {
  const deadzone = options.deadzone ?? 0;
  const exponent = options.exponent ?? 1.35;
  const scale = options.scale ?? 1;

  if (rawValue <= deadzone) {
    return 0;
  }

  const normalized = (rawValue - deadzone) / Math.max(1e-6, 1 - deadzone);
  return clamp01(Math.pow(normalized, exponent) * scale);
}

function mean2D(points) {
  if (!points.length) {
    return null;
  }

  const sum = points.reduce(
    (acc, point) => ({
      x: acc.x + point.x,
      y: acc.y + point.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
}

function meanVector(points) {
  if (!points.length) {
    return null;
  }

  return points.reduce((acc, point) => acc.add(point.clone()), new THREE.Vector3())
    .multiplyScalar(1 / points.length);
}

function getFacePoint2D(face2d, index) {
  const base = index * 3;
  return {
    x: face2d[base],
    y: face2d[base + 1],
    confidence: face2d[base + 2],
  };
}

function getFacePoint3D(face3d, index) {
  const base = index * 4;
  return new THREE.Vector3(
    face3d[base],
    -face3d[base + 1],
    -face3d[base + 2],
  );
}

function getPosePoint3D(pose3d, index) {
  const base = index * 4;
  return new THREE.Vector3(
    pose3d[base],
    -pose3d[base + 1],
    -pose3d[base + 2],
  );
}

function meanFacePoints2D(face2d, indices) {
  const points = indices
    .map((index) => getFacePoint2D(face2d, index))
    .filter((point) => point.confidence > 0);

  return mean2D(points);
}

function meanFacePoints3D(face3d, indices) {
  return meanVector(indices.map((index) => getFacePoint3D(face3d, index)));
}

function computeEyeAspect(face2d, indices) {
  const p1 = getFacePoint2D(face2d, indices[0]);
  const p2 = getFacePoint2D(face2d, indices[1]);
  const p3 = getFacePoint2D(face2d, indices[2]);
  const p4 = getFacePoint2D(face2d, indices[3]);
  const p5 = getFacePoint2D(face2d, indices[4]);
  const p6 = getFacePoint2D(face2d, indices[5]);
  const horizontal = distance2D(p1, p4);
  const vertical = (distance2D(p2, p6) + distance2D(p3, p5)) * 0.5;

  return horizontal > 1e-6 ? vertical / horizontal : 0;
}

function computeFaceScale(face2d) {
  const rightEye = meanFacePoints2D(face2d, [36, 37, 38, 39, 40, 41]);
  const leftEye = meanFacePoints2D(face2d, [42, 43, 44, 45, 46, 47]);
  return Math.max(distance2D(rightEye, leftEye), 1e-6);
}

function computeBrowInnerRatio(face2d, faceScale) {
  const rightInnerBrow = getFacePoint2D(face2d, 21);
  const leftInnerBrow = getFacePoint2D(face2d, 22);
  const rightEyeInnerCorner = getFacePoint2D(face2d, 39);
  const leftEyeInnerCorner = getFacePoint2D(face2d, 42);

  return (
    (rightEyeInnerCorner.y - rightInnerBrow.y) +
    (leftEyeInnerCorner.y - leftInnerBrow.y)
  ) / (2 * faceScale);
}

export function buildTorsoBasisFromPose3D(pose3d) {
  const leftShoulder = getPosePoint3D(pose3d, 5);
  const rightShoulder = getPosePoint3D(pose3d, 2);
  const neck = getPosePoint3D(pose3d, 1);
  const midHip = getPosePoint3D(pose3d, 8);
  const shoulderCenter = leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5);
  const side = normalizeVector(
    rightShoulder.clone().sub(leftShoulder),
    new THREE.Vector3(1, 0, 0),
  );
  const torsoRoot = midHip.distanceToSquared(neck) > 1e-6 ? midHip : shoulderCenter;
  const rawUp = normalizeVector(neck.clone().sub(torsoRoot), WORLD_UP);
  let forward = normalizeVector(
    new THREE.Vector3().crossVectors(rawUp, side),
    new THREE.Vector3(0, 0, 1),
  );
  const up = normalizeVector(
    new THREE.Vector3().crossVectors(side, forward),
    rawUp,
  );
  forward = normalizeVector(
    new THREE.Vector3().crossVectors(up, side),
    forward,
  );
  const horizontalForward = projectOntoPlane(
    forward,
    up,
    new THREE.Vector3(0, 0, 1),
  );

  return {
    side,
    up,
    forward,
    horizontalForward,
  };
}

function createEyeCalibration(aspects) {
  const fullClose = quantile(aspects, 0.02);
  const blinkStart = Math.max(quantile(aspects, 0.35), fullClose + 0.045);
  const neutral = quantile(aspects, 0.6);
  const wideOpen = Math.max(quantile(aspects, 0.95), neutral + 0.025);

  return {
    fullClose,
    blinkStart,
    neutral,
    wideOpen,
  };
}

function positiveRelative(value, neutral, high, fallbackSpan = 0.05) {
  return remapClamped(value, neutral, Math.max(high, neutral + fallbackSpan));
}

function negativeRelative(value, low, neutral, fallbackSpan = 0.05) {
  return remapClamped(neutral - value, 0, Math.max(neutral - low, fallbackSpan));
}

function safeRatio(numerator, denominator, fallback = 0) {
  return Math.abs(denominator) > 1e-6 ? numerator / denominator : fallback;
}

function normalizeVector(vector, fallback) {
  if (!vector || !Number.isFinite(vector.lengthSq()) || vector.lengthSq() < 1e-6) {
    return fallback.clone();
  }

  return vector.clone().normalize();
}

function projectOntoPlane(vector, normal, fallback) {
  const projected = vector.clone().sub(normal.clone().multiplyScalar(vector.dot(normal)));
  return normalizeVector(projected, fallback);
}

function signedAngleAroundAxis(from, to, axis) {
  const cross = new THREE.Vector3().crossVectors(from, to);
  return Math.atan2(cross.dot(axis), from.dot(to));
}

function extractHeadFeatures(frameData) {
  const face2d = frameData?.people?.face_keypoints_2d;
  const face3d = frameData?.people?.face_keypoints_3d;
  const pose3d = frameData?.people?.pose_keypoints_3d;

  if (
    !Array.isArray(face2d) || face2d.length < 68 * 3 ||
    !Array.isArray(face3d) || face3d.length < 68 * 4 ||
    !Array.isArray(pose3d) || pose3d.length < 25 * 4
  ) {
    return null;
  }

  const torsoBasis = buildTorsoBasisFromPose3D(pose3d);
  const rightEye2d = meanFacePoints2D(face2d, [36, 37, 38, 39, 40, 41]);
  const leftEye2d = meanFacePoints2D(face2d, [42, 43, 44, 45, 46, 47]);
  const rightEye3d = meanFacePoints3D(face3d, [36, 37, 38, 39, 40, 41]);
  const leftEye3d = meanFacePoints3D(face3d, [42, 43, 44, 45, 46, 47]);
  const eyeMid2d = mean2D([rightEye2d, leftEye2d]);
  const eyeMid3d = meanVector([rightEye3d, leftEye3d]);
  const mouthMid2d = meanFacePoints2D(face2d, [62, 66]);
  const mouthMid3d = meanFacePoints3D(face3d, [62, 66]);
  const noseTip2d = getFacePoint2D(face2d, 30);
  const noseBase2d = getFacePoint2D(face2d, 33);
  const noseTip3d = getFacePoint3D(face3d, 30);
  const faceCenter3d = meanVector([eyeMid3d, mouthMid3d]);
  const eyeDistance2d = Math.max(distance2D(rightEye2d, leftEye2d), 1e-6);
  const eyeDistance3d = Math.max(rightEye3d.distanceTo(leftEye3d), 1e-6);
  const side3d = normalizeVector(leftEye3d.clone().sub(rightEye3d), torsoBasis.side);
  const vertical3d = normalizeVector(eyeMid3d.clone().sub(mouthMid3d), torsoBasis.up);
  const forward3d = normalizeVector(
    new THREE.Vector3().crossVectors(side3d, vertical3d),
    torsoBasis.forward,
  );
  const noseHint = normalizeVector(noseTip3d.clone().sub(faceCenter3d), torsoBasis.forward);

  if (forward3d.dot(noseHint) < 0) {
    forward3d.multiplyScalar(-1);
  }

  const horizontalForward = projectOntoPlane(
    forward3d,
    torsoBasis.up,
    torsoBasis.horizontalForward,
  );
  const yawFeature = signedAngleAroundAxis(
    torsoBasis.horizontalForward,
    horizontalForward,
    torsoBasis.up,
  );
  const noseHorizontalOffset = (noseTip2d.x - eyeMid2d.x) / Math.max(eyeDistance2d * 0.5, 1e-6);
  const yawFromNose = Math.atan(noseHorizontalOffset * 0.75);
  const yaw = yawFeature * 0.84 + yawFromNose * 0.16;

  const eyeLineTilt = Math.atan2(leftEye2d.y - rightEye2d.y, Math.max(1e-6, leftEye2d.x - rightEye2d.x));
  const rollFeature = clamp(eyeLineTilt, -1.1, 1.1);
  const roll = rollFeature;

  const noseVerticalRatio = safeRatio(
    noseBase2d.y - eyeMid2d.y,
    mouthMid2d.y - eyeMid2d.y,
    0.5,
  );
  const pitchFromRatio = (0.5 - noseVerticalRatio) * 0.95;
  const faceVerticalTilt = Math.asin(clamp(forward3d.dot(torsoBasis.up), -0.999, 0.999));
  const pitchFeature = faceVerticalTilt * 0.4 + pitchFromRatio * 0.6;
  const pitch = pitchFeature;

  return {
    yaw,
    pitch,
    roll,
    yawFeature,
    yawFromNose,
    pitchFeature,
    rollFeature,
    noseHorizontalOffset,
    noseVerticalRatio,
    faceVerticalTilt,
    faceScale3d: eyeDistance3d,
  };
}

function extractFaceFeatures(frameData) {
  const face2d = frameData?.people?.face_keypoints_2d;
  const face3d = frameData?.people?.face_keypoints_3d;

  if (!Array.isArray(face2d) || face2d.length < 68 * 3 || !Array.isArray(face3d) || face3d.length < 68 * 4) {
    return null;
  }

  const faceScale = computeFaceScale(face2d);
  const mouthRightCorner = getFacePoint2D(face2d, 48);
  const mouthLeftCorner = getFacePoint2D(face2d, 54);
  const mouthUpperInner = getFacePoint2D(face2d, 62);
  const mouthLowerInner = getFacePoint2D(face2d, 66);
  const mouthUpperOuter = getFacePoint2D(face2d, 51);
  const mouthLowerOuter = getFacePoint2D(face2d, 57);
  const mouthCenter = mean2D([mouthRightCorner, mouthLeftCorner, mouthUpperInner, mouthLowerInner]);
  const mouthCenter3d = meanVector([
    getFacePoint3D(face3d, 48),
    getFacePoint3D(face3d, 54),
    getFacePoint3D(face3d, 62),
    getFacePoint3D(face3d, 66),
  ]);
  const noseBase = getFacePoint2D(face2d, 33);
  const chin = getFacePoint2D(face2d, 8);
  const chin3d = getFacePoint3D(face3d, 8);
  const upperLipRight = getFacePoint2D(face2d, 50);
  const upperLipLeft = getFacePoint2D(face2d, 52);
  const lowerLipRight = getFacePoint2D(face2d, 58);
  const lowerLipLeft = getFacePoint2D(face2d, 56);
  const mouthLeft3d = getFacePoint3D(face3d, 54);
  const mouthRight3d = getFacePoint3D(face3d, 48);
  const mouthUpper3d = getFacePoint3D(face3d, 51);
  const mouthLower3d = getFacePoint3D(face3d, 57);
  const mouthUpperInner3d = getFacePoint3D(face3d, 62);
  const mouthLowerInner3d = getFacePoint3D(face3d, 66);
  const lipCenterDepth = (
    mouthUpper3d.z +
    mouthLower3d.z +
    mouthUpperInner3d.z +
    mouthLowerInner3d.z
  ) * 0.25;
  const lipCornerDepth = (mouthLeft3d.z + mouthRight3d.z) * 0.5;
  const mouthProtrusion = lipCornerDepth - lipCenterDepth;

  return {
    faceScale,
    leftEyeAspect: computeEyeAspect(face2d, [42, 43, 44, 45, 46, 47]),
    rightEyeAspect: computeEyeAspect(face2d, [36, 37, 38, 39, 40, 41]),
    browInnerRatio: computeBrowInnerRatio(face2d, faceScale),
    browOuterRightRatio: (getFacePoint2D(face2d, 36).y - getFacePoint2D(face2d, 17).y) / faceScale,
    browOuterLeftRatio: (getFacePoint2D(face2d, 45).y - getFacePoint2D(face2d, 26).y) / faceScale,
    lipSeparationRatio: distance2D(mouthUpperInner, mouthLowerInner) / faceScale,
    jawDropRatio: distance2D(mouthUpperOuter, mouthLowerOuter) / faceScale,
    mouthWidthRatio: distance2D(mouthRightCorner, mouthLeftCorner) / faceScale,
    mouthRoundRatio: distance2D(mouthUpperInner, mouthLowerInner) / Math.max(distance2D(mouthRightCorner, mouthLeftCorner), 1e-6),
    mouthCenterOffsetRatio: (mouthCenter.x - noseBase.x) / faceScale,
    mouthCornerLiftRightRatio: (mouthCenter.y - mouthRightCorner.y) / faceScale,
    mouthCornerLiftLeftRatio: (mouthCenter.y - mouthLeftCorner.y) / faceScale,
    upperLipRaiseRightRatio: (noseBase.y - upperLipRight.y) / faceScale,
    upperLipRaiseLeftRatio: (noseBase.y - upperLipLeft.y) / faceScale,
    lowerLipPullRightRatio: (lowerLipRight.y - mouthCenter.y) / faceScale,
    lowerLipPullLeftRatio: (lowerLipLeft.y - mouthCenter.y) / faceScale,
    jawShiftRatio: (chin.x - noseBase.x) / faceScale,
    jawForwardRatio: (chin3d.z - mouthCenter3d.z) / faceScale,
    mouthProtrusionRatio: mouthProtrusion / faceScale,
  };
}

function computeCalibrationSample(frameData) {
  const headFeatures = extractHeadFeatures(frameData);
  const faceFeatures = extractFaceFeatures(frameData);

  if (!headFeatures || !faceFeatures) {
    return null;
  }

  return {
    ...headFeatures,
    ...faceFeatures,
  };
}

export function buildSequenceFaceCalibrationFromFrames(frameDataList) {
  const samples = frameDataList
    .map((frameData) => computeCalibrationSample(frameData))
    .filter(Boolean);

  if (!samples.length) {
    return null;
  }

  const values = (key) => samples.map((sample) => sample[key]);

  return {
    head: {
      neutralYaw: meanAngle(values('yaw')),
      neutralPitch: quantile(values('pitch'), 0.5),
      neutralRoll: meanAngle(values('roll')),
    },
    leftEye: createEyeCalibration(values('leftEyeAspect')),
    rightEye: createEyeCalibration(values('rightEyeAspect')),
    browInner: {
      neutral: quantile(values('browInnerRatio'), 0.55),
      raised: Math.max(quantile(values('browInnerRatio'), 0.95), quantile(values('browInnerRatio'), 0.55) + 0.015),
    },
    browOuterLeft: {
      lowered: quantile(values('browOuterLeftRatio'), 0.12),
      neutral: quantile(values('browOuterLeftRatio'), 0.55),
      raised: quantile(values('browOuterLeftRatio'), 0.92),
    },
    browOuterRight: {
      lowered: quantile(values('browOuterRightRatio'), 0.12),
      neutral: quantile(values('browOuterRightRatio'), 0.55),
      raised: quantile(values('browOuterRightRatio'), 0.92),
    },
    mouth: {
      width: {
        narrow: quantile(values('mouthWidthRatio'), 0.1),
        neutral: quantile(values('mouthWidthRatio'), 0.5),
        wide: quantile(values('mouthWidthRatio'), 0.9),
      },
      lipSeparation: {
        neutral: quantile(values('lipSeparationRatio'), 0.2),
        medium: quantile(values('lipSeparationRatio'), 0.7),
        large: quantile(values('lipSeparationRatio'), 0.94),
      },
      jawDrop: {
        neutral: quantile(values('jawDropRatio'), 0.2),
        medium: quantile(values('jawDropRatio'), 0.72),
        large: quantile(values('jawDropRatio'), 0.94),
      },
      round: {
        neutral: quantile(values('mouthRoundRatio'), 0.5),
        high: quantile(values('mouthRoundRatio'), 0.9),
      },
      protrusion: {
        neutral: quantile(values('mouthProtrusionRatio'), 0.5),
        high: quantile(values('mouthProtrusionRatio'), 0.92),
      },
      centerOffsetNeutral: quantile(values('mouthCenterOffsetRatio'), 0.5),
      cornerLeft: {
        low: quantile(values('mouthCornerLiftLeftRatio'), 0.12),
        neutral: quantile(values('mouthCornerLiftLeftRatio'), 0.5),
        high: quantile(values('mouthCornerLiftLeftRatio'), 0.9),
      },
      cornerRight: {
        low: quantile(values('mouthCornerLiftRightRatio'), 0.12),
        neutral: quantile(values('mouthCornerLiftRightRatio'), 0.5),
        high: quantile(values('mouthCornerLiftRightRatio'), 0.9),
      },
      upperLeft: {
        neutral: quantile(values('upperLipRaiseLeftRatio'), 0.5),
        high: quantile(values('upperLipRaiseLeftRatio'), 0.9),
      },
      upperRight: {
        neutral: quantile(values('upperLipRaiseRightRatio'), 0.5),
        high: quantile(values('upperLipRaiseRightRatio'), 0.9),
      },
      lowerLeft: {
        neutral: quantile(values('lowerLipPullLeftRatio'), 0.5),
        high: quantile(values('lowerLipPullLeftRatio'), 0.9),
      },
      lowerRight: {
        neutral: quantile(values('lowerLipPullRightRatio'), 0.5),
        high: quantile(values('lowerLipPullRightRatio'), 0.9),
      },
      jawShift: {
        low: quantile(values('jawShiftRatio'), 0.1),
        neutral: quantile(values('jawShiftRatio'), 0.5),
        high: quantile(values('jawShiftRatio'), 0.9),
      },
      jawForward: {
        neutral: quantile(values('jawForwardRatio'), 0.5),
        high: quantile(values('jawForwardRatio'), 0.9),
      },
    },
  };
}

function applyHeadCalibration(features, calibration) {
  const neutral = calibration?.head;

  if (!neutral) {
    return { ...features };
  }

  return {
    ...features,
    yaw: normalizeAngle(features.yaw - neutral.neutralYaw),
    pitch: features.pitch - neutral.neutralPitch,
    roll: normalizeAngle(features.roll - neutral.neutralRoll),
  };
}

function applyFaceCalibration(features, calibration) {
  const leftEye = calibration?.leftEye;
  const rightEye = calibration?.rightEye;
  const browInner = calibration?.browInner;
  const browOuterLeft = calibration?.browOuterLeft;
  const browOuterRight = calibration?.browOuterRight;
  const mouth = calibration?.mouth;

  const blinkLeftRaw = leftEye
    ? 1 - remapClamped(features.leftEyeAspect, leftEye.fullClose, leftEye.blinkStart)
    : 1 - remapClamped(features.leftEyeAspect, 0.16, 0.3);
  const blinkRightRaw = rightEye
    ? 1 - remapClamped(features.rightEyeAspect, rightEye.fullClose, rightEye.blinkStart)
    : 1 - remapClamped(features.rightEyeAspect, 0.16, 0.3);
  const squintLeftRaw = leftEye
    ? negativeRelative(features.leftEyeAspect, leftEye.fullClose, leftEye.neutral, 0.03)
    : blinkLeftRaw;
  const squintRightRaw = rightEye
    ? negativeRelative(features.rightEyeAspect, rightEye.fullClose, rightEye.neutral, 0.03)
    : blinkRightRaw;
  const wideLeftRaw = leftEye
    ? positiveRelative(features.leftEyeAspect, leftEye.neutral, leftEye.wideOpen, 0.03)
    : remapClamped(features.leftEyeAspect, 0.26, 0.34);
  const wideRightRaw = rightEye
    ? positiveRelative(features.rightEyeAspect, rightEye.neutral, rightEye.wideOpen, 0.03)
    : remapClamped(features.rightEyeAspect, 0.26, 0.34);

  const browInnerUpRaw = browInner
    ? positiveRelative(features.browInnerRatio, browInner.neutral, browInner.raised, 0.02)
    : remapClamped(features.browInnerRatio, 0.24, 0.32);
  const browOuterUpLeftRaw = browOuterLeft
    ? positiveRelative(features.browOuterLeftRatio, browOuterLeft.neutral, browOuterLeft.raised, 0.015)
    : remapClamped(features.browOuterLeftRatio, 0.09, 0.18);
  const browOuterUpRightRaw = browOuterRight
    ? positiveRelative(features.browOuterRightRatio, browOuterRight.neutral, browOuterRight.raised, 0.015)
    : remapClamped(features.browOuterRightRatio, 0.09, 0.18);
  const browDownLeftRaw = browOuterLeft
    ? negativeRelative(features.browOuterLeftRatio, browOuterLeft.lowered, browOuterLeft.neutral, 0.015)
    : remapClamped(0.08 - features.browOuterLeftRatio, 0, 0.06);
  const browDownRightRaw = browOuterRight
    ? negativeRelative(features.browOuterRightRatio, browOuterRight.lowered, browOuterRight.neutral, 0.015)
    : remapClamped(0.08 - features.browOuterRightRatio, 0, 0.06);

  const lipSeparationRaw = mouth?.lipSeparation
    ? positiveRelative(features.lipSeparationRatio, mouth.lipSeparation.neutral, mouth.lipSeparation.large, 0.03)
    : remapClamped(features.lipSeparationRatio, 0.02, 0.1);
  const slightOpenRaw = mouth?.lipSeparation
    ? positiveRelative(features.lipSeparationRatio, mouth.lipSeparation.neutral, mouth.lipSeparation.medium, 0.02)
    : remapClamped(features.lipSeparationRatio, 0.018, 0.06);
  const jawDropRaw = mouth?.jawDrop
    ? positiveRelative(features.jawDropRatio, mouth.jawDrop.neutral, mouth.jawDrop.large, 0.03)
    : remapClamped(features.jawDropRatio, 0.18, 0.34);
  const mouthWidthWideRaw = mouth?.width
    ? positiveRelative(features.mouthWidthRatio, mouth.width.neutral, mouth.width.wide, 0.03)
    : remapClamped(features.mouthWidthRatio, 0.5, 0.7);
  const mouthWidthNarrowRaw = mouth?.width
    ? negativeRelative(features.mouthWidthRatio, mouth.width.narrow, mouth.width.neutral, 0.03)
    : remapClamped(0.58 - features.mouthWidthRatio, 0, 0.08);
  const roundRaw = mouth?.round
    ? positiveRelative(features.mouthRoundRatio, mouth.round.neutral, mouth.round.high, 0.03)
    : remapClamped(features.mouthRoundRatio, 0.04, 0.18);
  const protrusionRaw = mouth?.protrusion
    ? positiveRelative(features.mouthProtrusionRatio, mouth.protrusion.neutral, mouth.protrusion.high, 0.02)
    : remapClamped(features.mouthProtrusionRatio, 0.01, 0.06);

  const lipClosednessRaw = mouth?.lipSeparation
    ? remapClamped(
      mouth.lipSeparation.neutral + 0.005 - features.lipSeparationRatio,
      0,
      Math.max(mouth.lipSeparation.neutral + 0.005, 0.02),
    )
    : remapClamped(0.02 - features.lipSeparationRatio, 0, 0.02);
  const mouthPressRaw = lipClosednessRaw * 0.35;
  const lipRollRaw = lipClosednessRaw * 0.2;

  const smileLeftRaw = mouth?.cornerLeft
    ? positiveRelative(features.mouthCornerLiftLeftRatio, mouth.cornerLeft.neutral, mouth.cornerLeft.high, 0.02)
    : remapClamped(features.mouthCornerLiftLeftRatio, 0.02, 0.08);
  const smileRightRaw = mouth?.cornerRight
    ? positiveRelative(features.mouthCornerLiftRightRatio, mouth.cornerRight.neutral, mouth.cornerRight.high, 0.02)
    : remapClamped(features.mouthCornerLiftRightRatio, 0.02, 0.08);
  const frownLeftRaw = mouth?.cornerLeft
    ? negativeRelative(features.mouthCornerLiftLeftRatio, mouth.cornerLeft.low, mouth.cornerLeft.neutral, 0.02)
    : remapClamped(0.01 - features.mouthCornerLiftLeftRatio, 0, 0.05);
  const frownRightRaw = mouth?.cornerRight
    ? negativeRelative(features.mouthCornerLiftRightRatio, mouth.cornerRight.low, mouth.cornerRight.neutral, 0.02)
    : remapClamped(0.01 - features.mouthCornerLiftRightRatio, 0, 0.05);

  const mouthOffset = mouth
    ? features.mouthCenterOffsetRatio - mouth.centerOffsetNeutral
    : features.mouthCenterOffsetRatio;
  const mouthRightRaw = remapClamped(mouthOffset, 0.012, 0.06);
  const mouthLeftRaw = remapClamped(-mouthOffset, 0.012, 0.06);

  const upperLipRaiseLeftRaw = mouth?.upperLeft
    ? positiveRelative(features.upperLipRaiseLeftRatio, mouth.upperLeft.neutral, mouth.upperLeft.high, 0.02)
    : remapClamped(features.upperLipRaiseLeftRatio, 0.2, 0.32);
  const upperLipRaiseRightRaw = mouth?.upperRight
    ? positiveRelative(features.upperLipRaiseRightRatio, mouth.upperRight.neutral, mouth.upperRight.high, 0.02)
    : remapClamped(features.upperLipRaiseRightRatio, 0.2, 0.32);
  const lowerLipPullLeftRaw = mouth?.lowerLeft
    ? positiveRelative(features.lowerLipPullLeftRatio, mouth.lowerLeft.neutral, mouth.lowerLeft.high, 0.02)
    : remapClamped(features.lowerLipPullLeftRatio, 0.08, 0.22);
  const lowerLipPullRightRaw = mouth?.lowerRight
    ? positiveRelative(features.lowerLipPullRightRatio, mouth.lowerRight.neutral, mouth.lowerRight.high, 0.02)
    : remapClamped(features.lowerLipPullRightRatio, 0.08, 0.22);

  const jawLeftRaw = mouth?.jawShift
    ? positiveRelative(-features.jawShiftRatio, -mouth.jawShift.neutral, -mouth.jawShift.low, 0.02)
    : remapClamped(-features.jawShiftRatio, 0.02, 0.12);
  const jawRightRaw = mouth?.jawShift
    ? positiveRelative(features.jawShiftRatio, mouth.jawShift.neutral, mouth.jawShift.high, 0.02)
    : remapClamped(features.jawShiftRatio, 0.02, 0.12);
  const jawForwardRaw = mouth?.jawForward
    ? positiveRelative(features.jawForwardRatio, mouth.jawForward.neutral, mouth.jawForward.high, 0.02)
    : remapClamped(features.jawForwardRatio, 0.02, 0.12);

  const expressiveAsymmetry = Math.max(
    slightOpenRaw,
    smileLeftRaw,
    smileRightRaw,
    frownLeftRaw,
    frownRightRaw,
    Math.abs(mouthOffset) * 4.5,
  );
  const asymmetryGate = remapClamped(expressiveAsymmetry, 0.28, 0.62);
  const upperLipGate = remapClamped(jawDropRaw, 0.48, 0.9);
  const lowerLipGate = remapClamped(jawDropRaw, 0.58, 0.95);

  return {
    blinkLeftRaw: clamp01(blinkLeftRaw),
    blinkRightRaw: clamp01(blinkRightRaw),
    squintLeftRaw: clamp01(squintLeftRaw),
    squintRightRaw: clamp01(squintRightRaw),
    wideLeftRaw: clamp01(wideLeftRaw),
    wideRightRaw: clamp01(wideRightRaw),
    browInnerUpRaw: clamp01(browInnerUpRaw),
    browOuterUpLeftRaw: clamp01(browOuterUpLeftRaw),
    browOuterUpRightRaw: clamp01(browOuterUpRightRaw),
    browDownLeftRaw: clamp01(browDownLeftRaw),
    browDownRightRaw: clamp01(browDownRightRaw),
    lipSeparationRaw: clamp01(lipSeparationRaw),
    slightOpenRaw: clamp01(slightOpenRaw),
    jawDropRaw: clamp01(jawDropRaw),
    mouthWidthWideRaw: clamp01(mouthWidthWideRaw),
    mouthWidthNarrowRaw: clamp01(mouthWidthNarrowRaw),
    roundRaw: clamp01(roundRaw),
    protrusionRaw: clamp01(protrusionRaw),
    lipClosednessRaw: clamp01(lipClosednessRaw),
    mouthPressRaw: clamp01(mouthPressRaw),
    lipRollRaw: clamp01(lipRollRaw),
    smileLeftRaw: clamp01(smileLeftRaw),
    smileRightRaw: clamp01(smileRightRaw),
    frownLeftRaw: clamp01(frownLeftRaw * asymmetryGate),
    frownRightRaw: clamp01(frownRightRaw * asymmetryGate),
    mouthLeftRaw: clamp01(mouthLeftRaw * asymmetryGate),
    mouthRightRaw: clamp01(mouthRightRaw * asymmetryGate),
    upperLipRaiseLeftRaw: clamp01(upperLipRaiseLeftRaw * upperLipGate),
    upperLipRaiseRightRaw: clamp01(upperLipRaiseRightRaw * upperLipGate),
    lowerLipPullLeftRaw: clamp01(lowerLipPullLeftRaw * lowerLipGate),
    lowerLipPullRightRaw: clamp01(lowerLipPullRightRaw * lowerLipGate),
    jawLeftRaw: clamp01(jawLeftRaw * asymmetryGate),
    jawRightRaw: clamp01(jawRightRaw * asymmetryGate),
    jawForwardRaw: clamp01(jawForwardRaw),
  };
}

function solveHeadPose(headFeatures, mode) {
  const config = STRATEGY_CONFIG[mode].head;
  const yaw = clamp(applyDeadzoneMagnitude(headFeatures.yaw, config.yawDeadzone), -1, 1) * config.yawClamp;
  const pitch = clamp(applyDeadzoneMagnitude(headFeatures.pitch, config.pitchDeadzone), -1, 1) * config.pitchClamp;
  const roll = clamp(applyDeadzoneMagnitude(headFeatures.roll, config.rollDeadzone), -1, 1) * config.rollClamp;

  return {
    neckYaw: yaw * config.neckYawRatio,
    neckPitch: pitch * config.neckPitchRatio,
    neckRoll: roll * config.neckRollRatio,
    headYaw: yaw * config.headYawScale * (1 - config.neckYawRatio),
    headPitch: pitch * config.headPitchScale * (1 - config.neckPitchRatio),
    headRoll: roll * config.headRollScale * (1 - config.neckRollRatio),
  };
}

function syncBlinkMorphs(left, right, options = {}) {
  const mode = options.mode ?? 'off';

  if (mode === 'average') {
    const synced = (left + right) * 0.5;
    return { left: synced, right: synced };
  }

  if (mode === 'threshold') {
    const threshold = Number.isFinite(options.threshold) ? Math.max(0, options.threshold) : 0.12;

    if (Math.abs(left - right) > threshold) {
      const synced = (left + right) * 0.5;
      return { left: synced, right: synced };
    }
  }

  return { left, right };
}

function solveFaceMorphs(faceSignals, mode, options = {}) {
  const config = STRATEGY_CONFIG[mode].morph;
  let blinkLeft = styleSignal(faceSignals.blinkLeftRaw, {
    deadzone: config.blinkDeadzone,
    exponent: config.blinkExponent,
    scale: config.blinkScale,
  });
  let blinkRight = styleSignal(faceSignals.blinkRightRaw, {
    deadzone: config.blinkDeadzone,
    exponent: config.blinkExponent,
    scale: config.blinkScale,
  });
  const syncedBlink = syncBlinkMorphs(blinkLeft, blinkRight, options.blinkSync);
  blinkLeft = syncedBlink.left;
  blinkRight = syncedBlink.right;

  const eyeSquintLeft = Math.max(
    0,
    styleSignal(faceSignals.squintLeftRaw, {
      deadzone: config.squintDeadzone,
      exponent: 1.25,
      scale: config.squintScale,
    }) - blinkLeft * 0.65,
  );
  const eyeSquintRight = Math.max(
    0,
    styleSignal(faceSignals.squintRightRaw, {
      deadzone: config.squintDeadzone,
      exponent: 1.25,
      scale: config.squintScale,
    }) - blinkRight * 0.65,
  );
  const eyeWideLeft = Math.max(
    0,
    styleSignal(faceSignals.wideLeftRaw, {
      deadzone: config.wideDeadzone,
      exponent: 1.15,
      scale: config.wideScale,
    }) - blinkLeft * 0.8,
  );
  const eyeWideRight = Math.max(
    0,
    styleSignal(faceSignals.wideRightRaw, {
      deadzone: config.wideDeadzone,
      exponent: 1.15,
      scale: config.wideScale,
    }) - blinkRight * 0.8,
  );

  const mouthOpenRaw = clamp01(faceSignals.slightOpenRaw * 0.78 + faceSignals.lipSeparationRaw * 0.22);
  const jawOpenRaw = clamp01(faceSignals.jawDropRaw * 0.72 + faceSignals.lipSeparationRaw * 0.08);
  const openingStrength = Math.max(mouthOpenRaw, jawOpenRaw);
  const largeOpenGate = remapClamped(openingStrength, 0.48, 0.95);

  const mouthCloseRaw = clamp01(faceSignals.lipClosednessRaw * (1 - openingStrength * 0.92));
  const mouthRollRaw = clamp01(faceSignals.lipRollRaw * (1 - openingStrength * 0.96));
  const mouthPuckerRaw = clamp01(
    (faceSignals.mouthWidthNarrowRaw * 0.52 + faceSignals.protrusionRaw * 0.32 + faceSignals.roundRaw * 0.16) *
    (1 - openingStrength * 0.55),
  );
  const mouthFunnelRaw = clamp01(
    (faceSignals.roundRaw * 0.55 + faceSignals.mouthWidthNarrowRaw * 0.25 + faceSignals.lipSeparationRaw * 0.1) *
    (1 - openingStrength * 0.35),
  );
  const mouthLowerDownRawLeft = clamp01(faceSignals.lowerLipPullLeftRaw * largeOpenGate);
  const mouthLowerDownRawRight = clamp01(faceSignals.lowerLipPullRightRaw * largeOpenGate);
  const mouthUpperUpRawLeft = clamp01(faceSignals.upperLipRaiseLeftRaw * largeOpenGate);
  const mouthUpperUpRawRight = clamp01(faceSignals.upperLipRaiseRightRaw * largeOpenGate);
  const browUpMax = config.browUpMax ?? config.browScale;
  const browDownMax = config.browDownMax ?? config.browScale * 0.8;

  return {
    mouthOpen: styleSignal(mouthOpenRaw, {
      deadzone: config.mouthOpenDeadzone,
      exponent: 1.3,
      scale: config.mouthOpenScale,
    }),
    jawOpen: styleSignal(jawOpenRaw, {
      deadzone: config.jawOpenDeadzone,
      exponent: 1.32,
      scale: config.jawOpenScale,
    }),
    mouthPucker: styleSignal(mouthPuckerRaw, {
      deadzone: config.puckerDeadzone,
      exponent: 1.3,
      scale: config.puckerScale,
    }),
    mouthFunnel: styleSignal(mouthFunnelRaw, {
      deadzone: config.funnelDeadzone,
      exponent: 1.25,
      scale: config.funnelScale,
    }),
    mouthClose: styleSignal(mouthCloseRaw, {
      deadzone: config.closeDeadzone,
      exponent: 1.2,
      scale: config.closeScale,
    }),
    mouthPressLeft: styleSignal(faceSignals.mouthPressRaw, {
      deadzone: config.pressDeadzone,
      exponent: 1.15,
      scale: config.pressScale,
    }),
    mouthPressRight: styleSignal(faceSignals.mouthPressRaw, {
      deadzone: config.pressDeadzone,
      exponent: 1.15,
      scale: config.pressScale,
    }),
    mouthRollUpper: styleSignal(mouthRollRaw, {
      deadzone: config.rollDeadzone,
      exponent: 1.15,
      scale: config.rollScale,
    }),
    mouthRollLower: styleSignal(mouthRollRaw * 0.72, {
      deadzone: config.rollDeadzone,
      exponent: 1.15,
      scale: config.rollScale,
    }),
    eyeBlinkLeft: blinkLeft,
    eyeBlinkRight: blinkRight,
    eyeSquintLeft,
    eyeSquintRight,
    eyeWideLeft,
    eyeWideRight,
    browInnerUp: Math.min(browUpMax, styleSignal(faceSignals.browInnerUpRaw, {
      deadzone: config.browDeadzone,
      exponent: 1.2,
      scale: config.browScale,
    })),
    browOuterUpLeft: Math.min(browUpMax, styleSignal(faceSignals.browOuterUpLeftRaw, {
      deadzone: config.browDeadzone,
      exponent: 1.2,
      scale: config.browScale,
    })),
    browOuterUpRight: Math.min(browUpMax, styleSignal(faceSignals.browOuterUpRightRaw, {
      deadzone: config.browDeadzone,
      exponent: 1.2,
      scale: config.browScale,
    })),
    browDownLeft: Math.min(browDownMax, styleSignal(faceSignals.browDownLeftRaw, {
      deadzone: config.browDeadzone,
      exponent: 1.15,
      scale: config.browScale * 0.8,
    })),
    browDownRight: Math.min(browDownMax, styleSignal(faceSignals.browDownRightRaw, {
      deadzone: config.browDeadzone,
      exponent: 1.15,
      scale: config.browScale * 0.8,
    })),
    mouthSmileLeft: styleSignal(faceSignals.smileLeftRaw, {
      deadzone: config.smileDeadzone,
      exponent: 1.18,
      scale: config.smileScale,
    }),
    mouthSmileRight: styleSignal(faceSignals.smileRightRaw, {
      deadzone: config.smileDeadzone,
      exponent: 1.18,
      scale: config.smileScale,
    }),
    mouthFrownLeft: styleSignal(faceSignals.frownLeftRaw, {
      deadzone: config.frownDeadzone,
      exponent: 1.18,
      scale: config.frownScale,
    }),
    mouthFrownRight: styleSignal(faceSignals.frownRightRaw, {
      deadzone: config.frownDeadzone,
      exponent: 1.18,
      scale: config.frownScale,
    }),
    mouthStretchLeft: styleSignal(faceSignals.mouthWidthWideRaw, {
      deadzone: config.stretchDeadzone,
      exponent: 1.15,
      scale: config.stretchScale,
    }),
    mouthStretchRight: styleSignal(faceSignals.mouthWidthWideRaw, {
      deadzone: config.stretchDeadzone,
      exponent: 1.15,
      scale: config.stretchScale,
    }),
    mouthLeft: styleSignal(faceSignals.mouthLeftRaw, {
      deadzone: config.mouthSideDeadzone,
      exponent: 1.1,
      scale: config.mouthSideScale,
    }),
    mouthRight: styleSignal(faceSignals.mouthRightRaw, {
      deadzone: config.mouthSideDeadzone,
      exponent: 1.1,
      scale: config.mouthSideScale,
    }),
    mouthUpperUpLeft: styleSignal(mouthUpperUpRawLeft, {
      deadzone: config.upperLipDeadzone,
      exponent: 1.18,
      scale: config.upperLipScale,
    }),
    mouthUpperUpRight: styleSignal(mouthUpperUpRawRight, {
      deadzone: config.upperLipDeadzone,
      exponent: 1.18,
      scale: config.upperLipScale,
    }),
    mouthLowerDownLeft: styleSignal(mouthLowerDownRawLeft, {
      deadzone: config.lowerLipDeadzone,
      exponent: 1.18,
      scale: config.lowerLipScale,
    }),
    mouthLowerDownRight: styleSignal(mouthLowerDownRawRight, {
      deadzone: config.lowerLipDeadzone,
      exponent: 1.18,
      scale: config.lowerLipScale,
    }),
    jawLeft: styleSignal(faceSignals.jawLeftRaw, {
      deadzone: config.jawSideDeadzone,
      exponent: 1.15,
      scale: config.jawSideScale,
    }),
    jawRight: styleSignal(faceSignals.jawRightRaw, {
      deadzone: config.jawSideDeadzone,
      exponent: 1.15,
      scale: config.jawSideScale,
    }),
    jawForward: styleSignal(faceSignals.jawForwardRaw, {
      deadzone: config.jawForwardDeadzone,
      exponent: 1.15,
      scale: config.jawForwardScale,
    }),
  };
}

function zeroMorphMap() {
  return Object.fromEntries(FACE_MORPH_NAMES.map((name) => [name, 0]));
}

function clampFaceMorphs(morphs) {
  const clampedMorphs = { ...morphs };

  Object.entries(FACE_MORPH_LIMITS).forEach(([name, limit]) => {
    if (clampedMorphs[name] !== undefined) {
      clampedMorphs[name] = THREE.MathUtils.clamp(clampedMorphs[name], 0, limit);
    }
  });

  return clampedMorphs;
}

function zeroHeadPose() {
  return {
    neckYaw: 0,
    neckPitch: 0,
    neckRoll: 0,
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
  };
}

function zeroResult() {
  const morphs = zeroMorphMap();

  return {
    headPose: zeroHeadPose(),
    morphs,
    debug: null,
  };
}

export function computeHeadFaceStrategy(
  frameData: ViewerFrame,
  options: HeadFaceStrategyOptions = {},
): HeadFaceResult {
  const mode = options.mode && FACE_MODES.includes(options.mode) ? options.mode : DEFAULT_FACE_MODE;
  const headFeatures = extractHeadFeatures(frameData);
  const faceFeatures = extractFaceFeatures(frameData);

  if (!headFeatures && !faceFeatures) {
    return zeroResult();
  }

  const calibration = options.faceCalibration ?? null;
  const calibratedHead = headFeatures ? applyHeadCalibration(headFeatures, calibration) : null;
  const calibratedFace = faceFeatures ? applyFaceCalibration(faceFeatures, calibration) : null;
  const headPose = calibratedHead ? solveHeadPose(calibratedHead, mode) : zeroHeadPose();
  const morphs = clampFaceMorphs(calibratedFace ? solveFaceMorphs(calibratedFace, mode, {
    blinkSync: options.blinkSync ?? { mode: 'average' },
  }) : zeroMorphMap());

  return {
    headPose,
    morphs,
    debug: {
      mode,
      rawHeadAngles: headFeatures ? {
        yaw: headFeatures.yaw,
        pitch: headFeatures.pitch,
        roll: headFeatures.roll,
      } : null,
      calibratedHeadAngles: calibratedHead ? {
        yaw: calibratedHead.yaw,
        pitch: calibratedHead.pitch,
        roll: calibratedHead.roll,
      } : null,
      headFeatures: headFeatures ? {
        yawFeature: headFeatures.yawFeature,
        pitchFeature: headFeatures.pitchFeature,
        rollFeature: headFeatures.rollFeature,
        yawFromNose: headFeatures.yawFromNose,
        noseHorizontalOffset: headFeatures.noseHorizontalOffset,
        noseVerticalRatio: headFeatures.noseVerticalRatio,
        faceVerticalTilt: headFeatures.faceVerticalTilt,
      } : null,
      faceSignals: calibratedFace ? {
        blinkLeftRaw: calibratedFace.blinkLeftRaw,
        blinkRightRaw: calibratedFace.blinkRightRaw,
        lipSeparationRaw: calibratedFace.lipSeparationRaw,
        slightOpenRaw: calibratedFace.slightOpenRaw,
        jawDropRaw: calibratedFace.jawDropRaw,
        lipClosednessRaw: calibratedFace.lipClosednessRaw,
        mouthPressRaw: calibratedFace.mouthPressRaw,
        mouthWidthNarrowRaw: calibratedFace.mouthWidthNarrowRaw,
        mouthWidthWideRaw: calibratedFace.mouthWidthWideRaw,
        roundRaw: calibratedFace.roundRaw,
        protrusionRaw: calibratedFace.protrusionRaw,
      } : null,
    },
  };
}
