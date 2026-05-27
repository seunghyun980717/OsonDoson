import * as THREE from 'three';
import {
  computeArmCorrectionFeaturesFromFrame,
  evaluateCorrectionProfile,
} from '../lib/sen-correction.js';
import { buildTorsoBasisFromPose3D } from '../lib/head-face-strategies.js';
import {
  blendDirections,
  createBasis,
  datasetToWorld,
  getKeypoint3D,
  getKeypoint3DConfidence,
  pointDirection,
  remapClamped,
} from './keypoint-utils.js';

export {
  blendDirections,
  createBasis,
  datasetToWorld,
  getKeypoint3D,
  getKeypoint3DConfidence,
  pointDirection,
  remapClamped,
};

export const HAND_FINGER_CHAINS = Object.freeze([
  Object.freeze(['Thumb', [1, 2, 3, 4]]),
  Object.freeze(['Index', [5, 6, 7, 8]]),
  Object.freeze(['Middle', [9, 10, 11, 12]]),
  Object.freeze(['Ring', [13, 14, 15, 16]]),
  Object.freeze(['Pinky', [17, 18, 19, 20]]),
]);

export function computeSharedTorsoMotion(pose3d, options = {}) {
  const buildTorsoBasis = options.buildTorsoBasisFromPose3D ?? buildTorsoBasisFromPose3D;
  const torsoBasis = buildTorsoBasis(pose3d);
  const neck = getKeypoint3D(pose3d, 1);
  const leftShoulder = getKeypoint3D(pose3d, 5);
  const rightShoulder = getKeypoint3D(pose3d, 2);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const rawSpineDirection = torsoBasis.up.clone().normalize();
  const spineHorizontalTilt = new THREE.Vector3(rawSpineDirection.x, 0, rawSpineDirection.z);
  const sideTiltComponent = spineHorizontalTilt.dot(torsoBasis.side);
  const forwardTiltComponent = spineHorizontalTilt.dot(torsoBasis.forward);
  const controlledHorizontalTilt = torsoBasis.side
    .clone()
    .multiplyScalar(sideTiltComponent * 1.05)
    .add(torsoBasis.forward.clone().multiplyScalar(forwardTiltComponent * 0.18));
  const spineDirection = worldUp
    .clone()
    .add(controlledHorizontalTilt)
    .normalize();
  const torsoTiltAmount = Math.hypot(torsoBasis.up.x, torsoBasis.up.z);
  const tiltStrength = remapClamped(torsoTiltAmount, 0.001, 0.02);
  const spine1Direction = worldUp
    .clone()
    .add(controlledHorizontalTilt.clone().multiplyScalar(THREE.MathUtils.lerp(0.72, 1.14, tiltStrength)))
    .normalize();
  const spine2Direction = worldUp
    .clone()
    .add(controlledHorizontalTilt.clone().multiplyScalar(THREE.MathUtils.lerp(0.92, 1.44, tiltStrength)))
    .normalize();
  const spine1BindBlend = THREE.MathUtils.lerp(0.68, 0.08, tiltStrength);
  const spine2BindBlend = THREE.MathUtils.lerp(0.42, 0.0, tiltStrength);
  const leftShoulderRawDirection = pointDirection(neck, leftShoulder);
  const rightShoulderRawDirection = pointDirection(neck, rightShoulder);
  const leftShoulderBaseDirection = torsoBasis.side
    .clone()
    .multiplyScalar(-1)
    .add(controlledHorizontalTilt.clone().multiplyScalar(0.12))
    .normalize();
  const rightShoulderBaseDirection = torsoBasis.side
    .clone()
    .add(controlledHorizontalTilt.clone().multiplyScalar(0.12))
    .normalize();
  const shoulderTargetWeight = THREE.MathUtils.lerp(0.82, 1.0, tiltStrength);
  const shoulderBindBlend = THREE.MathUtils.lerp(0.52, 0.0, tiltStrength);

  return {
    torsoBasis,
    spineDirection,
    rawSpineDirection,
    controlledHorizontalTilt,
    spine1Direction,
    spine2Direction,
    torsoTiltAmount,
    tiltStrength,
    spine1BindBlend,
    spine2BindBlend,
    leftShoulderDirection: blendDirections(
      leftShoulderBaseDirection,
      leftShoulderRawDirection,
      shoulderTargetWeight,
    ),
    rightShoulderDirection: blendDirections(
      rightShoulderBaseDirection,
      rightShoulderRawDirection,
      shoulderTargetWeight,
    ),
    shoulderBindBlend,
  };
}

export function applyNormalizedForwardCorrection(point, metrics, normalizedAmount = 0) {
  if (!normalizedAmount) {
    return point.clone();
  }

  return point.clone().add(
    new THREE.Vector3(
      metrics.torsoFrame.correctionForwardRaw?.x ?? metrics.torsoFrame.forward.x,
      metrics.torsoFrame.correctionForwardRaw?.y ?? metrics.torsoFrame.forward.y,
      metrics.torsoFrame.correctionForwardRaw?.z ?? metrics.torsoFrame.forward.z,
    ).multiplyScalar(metrics.shoulderWidth * normalizedAmount),
  );
}

export function computeRestPoseSetback(metrics, correction) {
  const activeCorrection = Math.max(
    correction?.wristForwardNorm ?? 0,
    correction?.elbowForwardNorm ?? 0,
  );

  if (activeCorrection > 0 || metrics.torsoRisk > 0) {
    return {
      wristForwardNorm: 0,
      elbowForwardNorm: 0,
    };
  }

  const lowPalm = remapClamped(-metrics.locals.palm.up, 0.95, 1.65);
  const lowWrist = remapClamped(-metrics.locals.wrist.up, 0.75, 1.45);
  const forwardExcess = remapClamped(metrics.locals.wrist.forward, 0.14, 0.42);
  const restWeight = lowPalm * 0.6 + lowWrist * 0.4;
  const wristSetback = 0.08 * restWeight * forwardExcess;

  return {
    wristForwardNorm: wristSetback > 0 ? -wristSetback : 0,
    elbowForwardNorm: wristSetback > 0 ? -wristSetback * 0.55 : 0,
  };
}

export function computeCorrectedArmPoints(frameData, handSide, elbowPoint, wristPoint, options = {}) {
  const {
    sequence,
    correctionProfile,
    correctionMode,
    computeFeatures = computeArmCorrectionFeaturesFromFrame,
    evaluateProfile = evaluateCorrectionProfile,
  } = options;

  if (!sequence || sequence.category !== 'SEN' || !correctionProfile || correctionProfile === false) {
    return {
      elbow: elbowPoint.clone(),
      wrist: wristPoint.clone(),
    };
  }

  const metrics = computeFeatures(frameData, handSide);

  if (!metrics) {
    return {
      elbow: elbowPoint.clone(),
      wrist: wristPoint.clone(),
    };
  }

  const correction = evaluateProfile(
    correctionProfile,
    metrics,
    correctionMode,
  );
  const restSetback = computeRestPoseSetback(metrics, correction);
  const elbowForwardNorm = correction.elbowForwardNorm > 0
    ? correction.elbowForwardNorm
    : restSetback.elbowForwardNorm;
  const wristForwardNorm = correction.wristForwardNorm > 0
    ? correction.wristForwardNorm
    : restSetback.wristForwardNorm;

  return {
    elbow: applyNormalizedForwardCorrection(elbowPoint, metrics, elbowForwardNorm),
    wrist: applyNormalizedForwardCorrection(wristPoint, metrics, wristForwardNorm),
  };
}

export function createHandRigAppliers({
  avatarState,
  scene,
  applyBoneQuaternion,
  setBoneTowardDirection,
  setBoneTowardDirectionFromParentSpace,
}) {
  function getLocalChildDirection(parentBoneName, childBoneName) {
    const parentBone = avatarState.bones.get(parentBoneName);
    const childBone = avatarState.bones.get(childBoneName);

    if (!parentBone || !childBone) {
      return null;
    }

    return childBone.position.clone().normalize();
  }

  function setHandOrientationFromFrame(sidePrefix, wristPoint, indexBasePoint, middleBasePoint, ringBasePoint, options = {}) {
    const smoothing = options.smoothing ?? 1;
    const boneName = `${sidePrefix}Hand`;
    const bindRotation = avatarState.bindRotations.get(boneName);
    const bone = avatarState.bones.get(boneName);

    if (!bone || !bindRotation) {
      return;
    }

    const bindForward = getLocalChildDirection(boneName, `${sidePrefix}HandMiddle1`);
    const bindIndex = avatarState.bones.get(`${sidePrefix}HandIndex1`)?.position.clone();
    const bindRing = avatarState.bones.get(`${sidePrefix}HandRing1`)?.position.clone();

    if (!bindForward || !bindIndex || !bindRing) {
      return;
    }

    const bindSide = bindRing.sub(bindIndex).normalize();
    const bindFrame = createBasis(bindForward, bindSide);

    const targetForward = pointDirection(wristPoint, middleBasePoint);
    const targetSide = datasetToWorld(ringBasePoint.clone().sub(indexBasePoint)).normalize();
    const targetFrame = createBasis(targetForward, targetSide);

    const parentWorldQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const targetParentFrame = parentWorldQuaternion.invert().multiply(targetFrame);
    const offset = targetParentFrame.multiply(bindFrame.invert());

    const targetQuaternion = offset.multiply(bindRotation.clone());
    applyBoneQuaternion(boneName, targetQuaternion, smoothing);
  }

  function applyFingerChainFromFrame(sidePrefix, fingerName, handPoints, indices, options = {}) {
    const smoothing = options.smoothing ?? 1;
    const minConfidence = options.minConfidence ?? 0.05;
    const bone1 = `${sidePrefix}Hand${fingerName}1`;
    const bone2 = `${sidePrefix}Hand${fingerName}2`;
    const bone3 = `${sidePrefix}Hand${fingerName}3`;

    if (indices.some((index) => getKeypoint3DConfidence(handPoints, index) < minConfidence)) {
      return;
    }

    const p0 = getKeypoint3D(handPoints, indices[0]);
    const p1 = getKeypoint3D(handPoints, indices[1]);
    const p2 = getKeypoint3D(handPoints, indices[2]);
    const p3 = getKeypoint3D(handPoints, indices[3]);

    if (
      p0.distanceToSquared(p1) < 1e-8 ||
      p1.distanceToSquared(p2) < 1e-8 ||
      p2.distanceToSquared(p3) < 1e-8
    ) {
      return;
    }

    setBoneTowardDirection(bone1, bone2, pointDirection(p0, p1), { smoothing });
    scene.updateMatrixWorld(true);

    setBoneTowardDirection(bone2, bone3, pointDirection(p1, p2), { smoothing });
    scene.updateMatrixWorld(true);

    const terminalBone = avatarState.bones.get(bone3);

    if (terminalBone) {
      setBoneTowardDirectionFromParentSpace(
        bone3,
        terminalBone.position.clone().normalize(),
        pointDirection(p2, p3),
        { smoothing },
      );
    }
  }

  function applyFingerChainsFromFrame(sidePrefix, handPoints, options = {}) {
    HAND_FINGER_CHAINS.forEach(([fingerName, indices]) => {
      applyFingerChainFromFrame(sidePrefix, fingerName, handPoints, indices, options);
    });
  }

  return {
    applyFingerChainFromFrame,
    applyFingerChainsFromFrame,
    setHandOrientationFromFrame,
  };
}
