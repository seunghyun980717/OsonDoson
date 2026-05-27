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
  const forwardTiltScale = options.forwardTiltScale ?? 0.18;
  const sideTiltScale = options.sideTiltScale ?? 1.05;
  const sideTiltDeadzone = options.sideTiltDeadzone ?? 0;
  const torsoBasis = buildTorsoBasis(pose3d);
  const neck = getKeypoint3D(pose3d, 1);
  const leftShoulder = getKeypoint3D(pose3d, 5);
  const rightShoulder = getKeypoint3D(pose3d, 2);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const rawSpineDirection = torsoBasis.up.clone().normalize();
  const spineHorizontalTilt = new THREE.Vector3(rawSpineDirection.x, 0, rawSpineDirection.z);
  const sideTiltComponent = spineHorizontalTilt.dot(torsoBasis.side);
  const controlledSideTiltComponent = Math.abs(sideTiltComponent) <= sideTiltDeadzone
    ? 0
    : Math.sign(sideTiltComponent) * (Math.abs(sideTiltComponent) - sideTiltDeadzone);
  const forwardTiltComponent = spineHorizontalTilt.dot(torsoBasis.forward);
  const controlledHorizontalTilt = torsoBasis.side
    .clone()
    .multiplyScalar(controlledSideTiltComponent * sideTiltScale)
    .add(torsoBasis.forward.clone().multiplyScalar(forwardTiltComponent * forwardTiltScale));
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

function worldToDataset(vector) {
  return new THREE.Vector3(vector.x, -vector.y, -vector.z);
}

function smoothstep01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function averageKeypoints(flatArray, indices, minConfidence = 0.05) {
  const points = indices
    .filter((index) => getKeypoint3DConfidence(flatArray, index) >= minConfidence)
    .map((index) => getKeypoint3D(flatArray, index));

  if (!points.length) {
    return null;
  }

  return points
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / points.length);
}

function shoulderMetrics(pose3d) {
  const leftShoulder = getKeypoint3D(pose3d, 5);
  const rightShoulder = getKeypoint3D(pose3d, 2);
  const center = leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5);
  const width = Math.max(leftShoulder.distanceTo(rightShoulder), 1e-4);

  return { center, width };
}

export function computeCanonicalWristTarget(poseWrist, handPoints, options = {}) {
  const handRootConfidence = getKeypoint3DConfidence(handPoints, 0);
  const minConfidence = options.minConfidence ?? 0.05;

  if (handRootConfidence < minConfidence) {
    return poseWrist.clone();
  }

  const poseWeight = options.poseWeight ?? 0.35;
  const handWeight = options.handWeight ?? 0.65;
  const totalWeight = Math.max(poseWeight + handWeight, 1e-4);
  const handRoot = getKeypoint3D(handPoints, 0);

  return poseWrist
    .clone()
    .multiplyScalar(poseWeight / totalWeight)
    .add(handRoot.multiplyScalar(handWeight / totalWeight));
}

export function detectTwoHandContact(leftHandPoints, rightHandPoints, pose3d, options = {}) {
  const state = options.state;
  const { width: shoulderWidth } = shoulderMetrics(pose3d);
  const minConfidence = options.minConfidence ?? 0.05;
  const enterDistance = shoulderWidth * (options.enterDistance ?? 0.08);
  const exitDistance = shoulderWidth * (options.exitDistance ?? 0.14);
  const contactIndices = options.contactIndices ?? [4, 8, 10, 12, 14, 16, 18, 20];
  let minDistance = Infinity;

  contactIndices.forEach((leftIndex) => {
    if (getKeypoint3DConfidence(leftHandPoints, leftIndex) < minConfidence) {
      return;
    }
    const leftPoint = getKeypoint3D(leftHandPoints, leftIndex);

    contactIndices.forEach((rightIndex) => {
      if (getKeypoint3DConfidence(rightHandPoints, rightIndex) < minConfidence) {
        return;
      }
      minDistance = Math.min(minDistance, leftPoint.distanceTo(getKeypoint3D(rightHandPoints, rightIndex)));
    });
  });

  const hasDistance = Number.isFinite(minDistance);
  const wasActive = Boolean(state?.active);
  const active = hasDistance && (wasActive ? minDistance < exitDistance : minDistance < enterDistance);
  const strength = active
    ? 1 - remapClamped(minDistance, enterDistance, exitDistance)
    : 0;

  if (state) {
    state.active = active;
    state.strength = strength;
    state.minDistance = hasDistance ? minDistance : null;
  }

  return {
    active,
    minDistance: hasDistance ? minDistance : null,
    shoulderWidth,
    strength,
  };
}

export function detectFaceHandProximity(handPoints, facePoints, pose3d, options = {}) {
  const state = options.state;
  const { center: shoulderCenter, width: shoulderWidth } = shoulderMetrics(pose3d);
  const torsoBasis = options.torsoBasis ?? buildTorsoBasisFromPose3D(pose3d);
  const forward = (torsoBasis.horizontalForward ?? torsoBasis.forward).clone().normalize();
  const side = torsoBasis.side.clone().normalize();
  const up = torsoBasis.up.clone().normalize();
  const minConfidence = options.minConfidence ?? 0.05;
  const faceAnchor = averageKeypoints(
    facePoints,
    options.faceAnchorIndices ?? [27, 28, 29, 30, 31, 33, 36, 39, 42, 45, 48, 54],
    minConfidence,
  );

  if (!faceAnchor) {
    return { active: false, strength: 0, score: 0 };
  }

  const handAnchors = [
    averageKeypoints(handPoints, [0, 5, 9, 13, 17], minConfidence),
    averageKeypoints(handPoints, [4, 8, 12, 16, 20], minConfidence),
    averageKeypoints(handPoints, [8, 12], minConfidence),
  ].filter(Boolean);

  if (!handAnchors.length) {
    return { active: false, strength: 0, score: 0 };
  }

  const toLocal = (point) => {
    const world = datasetToWorld(point.clone().sub(shoulderCenter));

    return {
      forward: world.dot(forward),
      side: world.dot(side),
      up: world.dot(up),
    };
  };
  const faceLocal = toLocal(faceAnchor);
  const sideRadius = shoulderWidth * (options.sideRadius ?? 0.32);
  const upRadius = shoulderWidth * (options.upRadius ?? 0.36);
  const minForward = shoulderWidth * (options.minForward ?? 0.12);
  const fullForward = shoulderWidth * (options.fullForward ?? 0.42);
  let bestScore = 0;
  let bestForwardDelta = null;

  handAnchors.forEach((anchor) => {
    const local = toLocal(anchor);
    const sideScore = 1 - THREE.MathUtils.clamp(Math.abs(local.side - faceLocal.side) / sideRadius, 0, 1);
    const upScore = 1 - THREE.MathUtils.clamp(Math.abs(local.up - faceLocal.up) / upRadius, 0, 1);
    const forwardDelta = local.forward - faceLocal.forward;
    const forwardScore = remapClamped(forwardDelta, minForward, fullForward);
    const score = Math.min(sideScore, upScore, forwardScore);

    if (score > bestScore) {
      bestScore = score;
      bestForwardDelta = forwardDelta;
    }
  });

  const wasActive = Boolean(state?.active);
  const enterScore = options.enterScore ?? 0.18;
  const exitScore = options.exitScore ?? 0.08;
  const active = bestScore >= (wasActive ? exitScore : enterScore);
  const strength = active ? bestScore : 0;

  if (state) {
    state.active = active;
    state.forwardDelta = bestForwardDelta;
    state.strength = strength;
  }

  return {
    active,
    forwardDelta: bestForwardDelta,
    score: bestScore,
    strength,
  };
}

export function solveTwoBoneArmIkDirections(shoulderPoint, elbowPoint, wristPoint, options = {}) {
  const upperLength = options.upperLength;
  const forearmLength = options.forearmLength;
  const scale = options.scale ?? 1;

  if (
    !Number.isFinite(upperLength)
    || !Number.isFinite(forearmLength)
    || upperLength <= 1e-5
    || forearmLength <= 1e-5
  ) {
    return null;
  }

  const target = datasetToWorld(wristPoint.clone().sub(shoulderPoint)).multiplyScalar(scale);
  const pole = datasetToWorld(elbowPoint.clone().sub(shoulderPoint)).multiplyScalar(scale);

  if (target.lengthSq() < 1e-8 || pole.lengthSq() < 1e-8) {
    return null;
  }

  const maxReach = Math.max(upperLength + forearmLength - 1e-5, 1e-5);
  const minReach = Math.max(Math.abs(upperLength - forearmLength) + 1e-5, 1e-5);
  const targetDistance = THREE.MathUtils.clamp(target.length(), minReach, maxReach);
  const targetDirection = target.clone().normalize();
  let bendDirection = pole
    .clone()
    .sub(targetDirection.clone().multiplyScalar(pole.dot(targetDirection)));

  if (bendDirection.lengthSq() < 1e-8) {
    bendDirection = new THREE.Vector3(0, 1, 0)
      .sub(targetDirection.clone().multiplyScalar(targetDirection.y));
  }
  if (bendDirection.lengthSq() < 1e-8) {
    bendDirection = new THREE.Vector3(1, 0, 0)
      .sub(targetDirection.clone().multiplyScalar(targetDirection.x));
  }

  bendDirection.normalize();

  const elbowAlong = THREE.MathUtils.clamp(
    (upperLength ** 2 + targetDistance ** 2 - forearmLength ** 2) / (2 * targetDistance),
    -upperLength,
    upperLength,
  );
  const elbowHeight = Math.sqrt(Math.max(0, upperLength ** 2 - elbowAlong ** 2));
  const elbowTarget = targetDirection
    .clone()
    .multiplyScalar(elbowAlong)
    .add(bendDirection.multiplyScalar(elbowHeight));
  const wristTarget = targetDirection.clone().multiplyScalar(targetDistance);

  if (elbowTarget.lengthSq() < 1e-8 || wristTarget.distanceToSquared(elbowTarget) < 1e-8) {
    return null;
  }

  return {
    forearmDirection: wristTarget.sub(elbowTarget).normalize(),
    upperDirection: elbowTarget.normalize(),
  };
}

export function applyTorsoCollisionCorrection(pose3d, armPoints, options = {}) {
  const state = options.state;
  const { center: shoulderCenter, width: shoulderWidth } = shoulderMetrics(pose3d);
  const torsoBasis = (options.torsoBasis ?? buildTorsoBasisFromPose3D(pose3d));
  const forward = (torsoBasis.horizontalForward ?? torsoBasis.forward)
    .clone()
    .normalize();
  const side = torsoBasis.side.clone().normalize();
  const up = torsoBasis.up.clone().normalize();
  const handPoints = options.handPoints;
  const minConfidence = options.minConfidence ?? 0.05;
  const anchors = [
    armPoints.wrist.clone(),
    averageKeypoints(handPoints, [0, 5, 9, 13, 17], minConfidence),
    averageKeypoints(handPoints, [5, 9, 13, 17], minConfidence),
  ].filter(Boolean);
  const sideLimit = shoulderWidth * (options.sideLimit ?? 0.78);
  const upMin = -shoulderWidth * (options.upMin ?? 1.05);
  const upMax = shoulderWidth * (options.upMax ?? 0.55);
  const localAnchors = anchors.map((anchor) => {
    const world = datasetToWorld(anchor.clone().sub(shoulderCenter));

    return {
      depth: world.dot(forward),
      side: world.dot(side),
      up: world.dot(up),
      world,
    };
  });
  const activeAnchors = localAnchors.filter((anchor) =>
    Math.abs(anchor.side) <= sideLimit
    && anchor.up >= upMin
    && anchor.up <= upMax,
  );
  const depth = activeAnchors.length
    ? Math.min(...activeAnchors.map((anchor) => anchor.depth))
    : Infinity;
  const enterForward = shoulderWidth * (options.enterForward ?? 0.13);
  const targetForward = shoulderWidth * (options.targetForward ?? 0.16);
  const exitForward = shoulderWidth * (options.exitForward ?? 0.18);
  const maxPush = shoulderWidth * (options.maxPush ?? 0.24);
  const smoothing = options.smoothing ?? 0.28;
  const enterSmoothing = options.enterSmoothing ?? Math.max(smoothing, 0.68);
  const exitSmoothing = options.exitSmoothing ?? Math.min(smoothing, 0.18);
  const elbowRatio = options.elbowRatio ?? 0.35;
  const previousPush = state?.pushWorld ?? new THREE.Vector3();
  const wasActive = Boolean(state?.active);
  const shouldCorrect = activeAnchors.length > 0 && (wasActive ? depth < exitForward : depth < enterForward);
  const penetration = shouldCorrect ? Math.max(0, targetForward - depth) : 0;
  const targetPushLength = Math.min(maxPush, penetration);
  const targetPush = forward.clone().multiplyScalar(targetPushLength);
  const pushWorld = previousPush.clone().lerp(targetPush, shouldCorrect ? enterSmoothing : exitSmoothing);

  if (pushWorld.length() < shoulderWidth * 0.002 && !shouldCorrect) {
    pushWorld.set(0, 0, 0);
  }

  if (state) {
    state.active = shouldCorrect;
    state.pushWorld.copy(pushWorld);
  }

  if (pushWorld.lengthSq() < 1e-10) {
    return {
      elbow: armPoints.elbow.clone(),
      wrist: armPoints.wrist.clone(),
    };
  }

  const pushDataset = worldToDataset(pushWorld);

  return {
    elbow: armPoints.elbow.clone().add(pushDataset.clone().multiplyScalar(elbowRatio)),
    wrist: armPoints.wrist.clone().add(pushDataset),
  };
}

export function createHandRigAppliers({
  avatarState,
  scene,
  applyBoneQuaternion,
  setBoneTowardDirection,
  setBoneTowardDirectionFromParentSpace,
}) {
  function getBindPointInParentSpace(parentBoneName, childBoneName) {
    const parentBone = avatarState.bones.get(parentBoneName);
    const bindParentPosition = avatarState.bindWorldPositions?.get(parentBoneName);
    const bindChildPosition = avatarState.bindWorldPositions?.get(childBoneName);
    const bindParentQuaternion = avatarState.bindWorldQuaternions?.get(parentBoneName);

    if (!parentBone || !bindParentPosition || !bindChildPosition || !bindParentQuaternion) {
      return null;
    }

    return bindChildPosition
      .clone()
      .sub(bindParentPosition)
      .applyQuaternion(bindParentQuaternion.clone().invert());
  }

  function getLocalChildDirection(parentBoneName, childBoneName) {
    const parentBone = avatarState.bones.get(parentBoneName);
    const childBone = avatarState.bones.get(childBoneName);

    if (!parentBone || !childBone) {
      return null;
    }

    const bindPoint = getBindPointInParentSpace(parentBoneName, childBoneName);

    if (bindPoint && bindPoint.lengthSq() > 1e-8) {
      return bindPoint.normalize();
    }

    return childBone.position.clone().normalize();
  }

  function setHandOrientationFromFrame(sidePrefix, wristPoint, indexBasePoint, middleBasePoint, ringBasePoint, options = {}) {
    const smoothing = options.smoothing ?? 1;
    const orientationWeight = options.orientationWeight ?? 0.48;
    const boneName = `${sidePrefix}Hand`;
    const bindRotation = avatarState.bindRotations.get(boneName);
    const bone = avatarState.bones.get(boneName);

    if (!bone || !bindRotation) {
      return;
    }

    const bindForward = getLocalChildDirection(boneName, `${sidePrefix}HandMiddle1`);
    const bindIndex = getBindPointInParentSpace(boneName, `${sidePrefix}HandIndex1`)
      ?? avatarState.bones.get(`${sidePrefix}HandIndex1`)?.position.clone();
    const bindRing = getBindPointInParentSpace(boneName, `${sidePrefix}HandRing1`)
      ?? avatarState.bones.get(`${sidePrefix}HandRing1`)?.position.clone();

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
    applyBoneQuaternion(boneName, targetQuaternion, Math.min(smoothing, orientationWeight));
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
