import * as THREE from 'three';

import type { ViewerFrame } from './avatarTypes';

export type ArmCorrectionSide = 'left' | 'right';

export type ArmCorrectionMetrics = {
  locals: {
    palm: {
      up: number;
    };
    wrist: {
      forward: number;
      up: number;
    };
  };
  shoulderWidth: number;
  torsoFrame: {
    correctionForwardRaw?: THREE.Vector3;
    forward: THREE.Vector3;
  };
  torsoRisk: number;
};

export type ArmCorrectionResult = {
  elbowForwardNorm: number;
  wristForwardNorm: number;
};

export const computeArmCorrectionFeaturesFromFrame = (
  frameData: ViewerFrame,
  handSide: ArmCorrectionSide,
): ArmCorrectionMetrics | null => {
  void frameData;
  void handSide;

  return null;
};

export const evaluateCorrectionProfile = (
  correctionProfile: unknown,
  metrics: ArmCorrectionMetrics,
  correctionMode: unknown,
): ArmCorrectionResult => {
  void correctionProfile;
  void metrics;
  void correctionMode;

  return {
    elbowForwardNorm: 0,
    wristForwardNorm: 0,
  };
};
