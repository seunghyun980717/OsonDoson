import { ExpoWebGLRenderingContext, GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, PixelRatio, StyleSheet } from 'react-native';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { createAvatarModelInstance } from '@/lib/avatar-renderer/avatarModelCache';
import type { ViewerFrame } from '@/lib/avatar-renderer/avatarTypes';
import { computeHeadFaceStrategy } from '@/lib/avatar-viewer/lib/head-face-strategies.js';
import {
  applyTorsoCollisionCorrection,
  blendDirections,
  computeCanonicalWristTarget,
  computeCorrectedArmPoints,
  computeSharedTorsoMotion,
  createHandRigAppliers,
  detectFaceHandProximity,
  detectTwoHandContact,
  getKeypoint3D,
  getKeypoint3DConfidence,
  pointDirection,
  remapClamped,
  solveTwoBoneArmIkDirections,
} from '@/lib/avatar-viewer/viewer/body-motion.js';
import { clampFaceMorphs } from '@/lib/avatar-viewer/viewer/face-morph-safety.js';
import { createRigController } from '@/lib/avatar-viewer/viewer/rig-controller.js';

type AvatarThreeRendererProps = {
  frame: ViewerFrame;
  frameIndex: number;
  frames?: readonly ViewerFrame[];
  onReady?: () => void;
};

type PendingFrame = {
  frame: ViewerFrame;
  frameIndex: number;
};

type RendererRuntime = {
  applyFrameData: (frame: ViewerFrame, frameIndex: number) => void;
  dispose: () => void;
  resize: (width: number, height: number) => void;
};

type MorphMesh = THREE.Mesh & {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
};

type RuntimeAvatarState = {
  bindMorphValues: Record<string, number>;
  bindPositions: Map<string, THREE.Vector3>;
  bindRotations: Map<string, THREE.Quaternion>;
  bindWorldPositions: Map<string, THREE.Vector3>;
  bindWorldQuaternions: Map<string, THREE.Quaternion>;
  boneAliases: Record<string, string>;
  bones: Map<string, THREE.Bone>;
  faceHandProximity: {
    left: { active: boolean; forwardDelta: null | number; strength: number };
    right: { active: boolean; forwardDelta: null | number; strength: number };
  };
  morphAliases: Record<string, string>;
  morphMeshes: MorphMesh[];
  morphValues: Record<string, number>;
  renderMeshes: THREE.Mesh[];
  supportedMorphNames: Set<string>;
  torsoCollision: {
    left: { active: boolean; pushWorld: THREE.Vector3 };
    right: { active: boolean; pushWorld: THREE.Vector3 };
  };
  twoHandContact: { active: boolean; minDistance: null | number; strength: number };
};

type TunableMaterial = THREE.Material & {
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  emissiveMap?: THREE.Texture | null;
  envMapIntensity?: number;
  metalness?: number;
  roughness?: number;
};

const FACE_MODE = 'faithful';
const MOTION_SETTINGS = Object.freeze({
  baseIkWeight: 1,
  contactShoulderArmTargetWeight: 1,
  faceHandIkWeight: 1,
  faceHandShoulderArmTargetWeight: 1,
  faceRelativeHandCorrection: true,
  faceRelativeHandCorrectionStrength: 0.75,
  faceRelativeHandElbowFollow: 0.45,
  faceRelativeHandMaxSideOffset: 0.34,
  faceRelativeHandMaxUpOffset: 0.42,
  handOrientationWeight: 0.95,
  headPose: false,
  playbackBoneSmoothing: 0.82,
  playbackMorphSmoothing: 0.28,
  shoulderArmTargetWeight: 1,
  shoulderPose: true,
  shoulderPoseWeight: 0.32,
  torsoCollision: false,
  torsoContactIkWeight: 0,
  torsoForwardTiltScale: 0.65,
  torsoLimits: {
    LeftShoulder: THREE.MathUtils.degToRad(38),
    RightShoulder: THREE.MathUtils.degToRad(38),
    Spine1: THREE.MathUtils.degToRad(18),
    Spine2: THREE.MathUtils.degToRad(18),
  },
  torsoPose: true,
  torsoSideTiltScale: 0.45,
  torsoTargetWeight: 0.72,
  twoHandIkWeight: 1,
});
const TORSO_COLLISION_OPTIONS = Object.freeze({
  elbowRatio: 0.35,
  enterForward: 0.13,
  exitForward: 0.18,
  maxPush: 0.24,
  pushRange: 0.12,
  smoothing: 0.28,
  targetForward: 0.16,
});
const TWO_HAND_CONTACT_OPTIONS = Object.freeze({
  enterDistance: 0.08,
  exitDistance: 0.14,
});
const FACE_HAND_PROXIMITY_OPTIONS = Object.freeze({
  enterScore: 0.18,
  exitScore: 0.08,
  fullForward: 0.42,
  minForward: 0.12,
  sideRadius: 0.32,
  upRadius: 0.36,
});
const LIGHTING_SETUP = Object.freeze({
  ambient: 1.65,
  exposure: 0.78,
  fill: 0.8,
  fillColor: 0xf2f0ee,
  fillPosition: [-3.2, 1.7, 2.5],
  groundColor: 0xe3d8d2,
  key: 0.62,
  keyColor: 0xfffbf6,
  keyPosition: [2.2, 2.8, 3.7],
  rim: 0.08,
  rimColor: 0xffffff,
  rimPosition: [-2.2, 2.1, -2.6],
  skyColor: 0xffffff,
  toneMapping: THREE.NeutralToneMapping ?? THREE.LinearToneMapping,
});
const MATERIAL_TUNING = Object.freeze({
  clothEnvIntensity: 0.12,
  clothRoughness: 0.86,
  clothShadowLift: 0.02,
  eyeEnvIntensity: 0.38,
  hairEnvIntensity: 0.18,
  hairRoughness: 0.72,
  skinEnvIntensity: 0.18,
  skinRoughness: 0.68,
});
const MAN03_BONE_ALIASES = Object.freeze({
  EyeLeft: 'master_eyeL',
  EyeRight: 'master_eyeR',
  EyeRig: 'eyes',
  EyeRigParent: 'MCH-eyes_parent',
  Head: 'DEF-spine006',
  Jaw: 'jaw',
  JawMaster: 'jaw_master',
  LeftArm: 'DEF-upper_armL',
  LeftForeArm: 'DEF-forearmL',
  LeftHand: 'DEF-handL',
  LeftHandIndex1: 'DEF-f_index01L',
  LeftHandIndex2: 'DEF-f_index02L',
  LeftHandIndex3: 'DEF-f_index03L',
  LeftHandMiddle1: 'DEF-f_middle01L',
  LeftHandMiddle2: 'DEF-f_middle02L',
  LeftHandMiddle3: 'DEF-f_middle03L',
  LeftHandPinky1: 'DEF-f_pinky01L',
  LeftHandPinky2: 'DEF-f_pinky02L',
  LeftHandPinky3: 'DEF-f_pinky03L',
  LeftHandRing1: 'DEF-f_ring01L',
  LeftHandRing2: 'DEF-f_ring02L',
  LeftHandRing3: 'DEF-f_ring03L',
  LeftHandThumb1: 'DEF-thumb01L',
  LeftHandThumb2: 'DEF-thumb02L',
  LeftHandThumb3: 'DEF-thumb03L',
  LeftShoulder: 'ORG-shoulderL',
  Neck: 'DEF-spine005',
  RightArm: 'DEF-upper_armR',
  RightForeArm: 'DEF-forearmR',
  RightHand: 'DEF-handR',
  RightHandIndex1: 'DEF-f_index01R',
  RightHandIndex2: 'DEF-f_index02R',
  RightHandIndex3: 'DEF-f_index03R',
  RightHandMiddle1: 'DEF-f_middle01R',
  RightHandMiddle2: 'DEF-f_middle02R',
  RightHandMiddle3: 'DEF-f_middle03R',
  RightHandPinky1: 'DEF-f_pinky01R',
  RightHandPinky2: 'DEF-f_pinky02R',
  RightHandPinky3: 'DEF-f_pinky03R',
  RightHandRing1: 'DEF-f_ring01R',
  RightHandRing2: 'DEF-f_ring02R',
  RightHandRing3: 'DEF-f_ring03R',
  RightHandThumb1: 'DEF-thumb01R',
  RightHandThumb2: 'DEF-thumb02R',
  RightHandThumb3: 'DEF-thumb03R',
  RightShoulder: 'ORG-shoulderR',
  Spine1: 'DEF-spine002',
  Spine2: 'DEF-spine004',
  TeethBottom: 'DEF-teethB',
  TeethTop: 'DEF-teethT',
});
const MAN03_MORPH_ALIASES = Object.freeze({
  browDownLeft: 'A02_Brow_Down_Left',
  browDownRight: 'A03_Brow_Down_Right',
  browInnerUp: 'A01_Brow_Inner_Up',
  browOuterUpLeft: 'A04_Brow_Outer_Up_Left',
  browOuterUpRight: 'A05_Brow_Outer_Up_Right',
  eyeBlinkLeft: 'A14_Eye_Blink_Left',
  eyeBlinkRight: 'A15_Eye_Blink_Right',
  eyeSquintLeft: 'A16_Eye_Squint_Left',
  eyeSquintRight: 'A17_Eye_Squint_Right',
  eyeWideLeft: 'A18_Eye_Wide_Left',
  eyeWideRight: 'A19_Eye_Wide_Right',
  jawForward: 'A26_Jaw_Forward',
  jawLeft: 'A27_Jaw_Left',
  jawOpen: 'A25_Jaw_Open',
  jawRight: 'A28_Jaw_Right',
  mouthClose: 'A37_Mouth_Close',
  mouthFrownLeft: 'A40_Mouth_Frown_Left',
  mouthFrownRight: 'A41_Mouth_Frown_Right',
  mouthFunnel: 'A29_Mouth_Funnel',
  mouthLeft: 'A31_Mouth_Left',
  mouthLowerDownLeft: 'A46_Mouth_Lower_Down_Left',
  mouthLowerDownRight: 'A47_Mouth_Lower_Down_Right',
  mouthOpen: 'Mouth_Open',
  mouthPressLeft: 'A48_Mouth_Press_Left',
  mouthPressRight: 'A49_Mouth_Press_Right',
  mouthPucker: 'A30_Mouth_Pucker',
  mouthRight: 'A32_Mouth_Right',
  mouthRollLower: 'A34_Mouth_Roll_Lower',
  mouthRollUpper: 'A33_Mouth_Roll_Upper',
  mouthSmileLeft: 'A38_Mouth_Smile_Left',
  mouthSmileRight: 'A39_Mouth_Smile_Right',
  mouthStretchLeft: 'A50_Mouth_Stretch_Left',
  mouthStretchRight: 'A51_Mouth_Stretch_Right',
  mouthUpperUpLeft: 'A44_Mouth_Upper_Up_Left',
  mouthUpperUpRight: 'A45_Mouth_Upper_Up_Right',
});

const createMorphValues = (): Record<string, number> => (
  Object.fromEntries(Object.keys(MAN03_MORPH_ALIASES).map((name) => [name, 0]))
);

const createAvatarState = (): RuntimeAvatarState => ({
  bindMorphValues: {},
  bindPositions: new Map(),
  bindRotations: new Map(),
  bindWorldPositions: new Map(),
  bindWorldQuaternions: new Map(),
  boneAliases: MAN03_BONE_ALIASES,
  bones: new Map(),
  faceHandProximity: {
    left: { active: false, forwardDelta: null, strength: 0 },
    right: { active: false, forwardDelta: null, strength: 0 },
  },
  morphAliases: MAN03_MORPH_ALIASES,
  morphMeshes: [],
  morphValues: createMorphValues(),
  renderMeshes: [],
  supportedMorphNames: new Set(),
  torsoCollision: {
    left: { active: false, pushWorld: new THREE.Vector3() },
    right: { active: false, pushWorld: new THREE.Vector3() },
  },
  twoHandContact: { active: false, minDistance: null, strength: 0 },
});

const isMorphMesh = (object: THREE.Object3D): object is MorphMesh => (
  object instanceof THREE.Mesh &&
  Boolean(object.morphTargetDictionary) &&
  Boolean(object.morphTargetInfluences)
);

const materialName = (material: TunableMaterial, mesh: THREE.Mesh) => (
  `${material.name || ''} ${mesh.name || ''}`.toLowerCase()
);

const materialKind = (material: TunableMaterial, mesh: THREE.Mesh) => {
  const name = materialName(material, mesh);

  if (name.includes('eye') || name.includes('cornea')) return 'eye';
  if (name.includes('teeth') || name.includes('tongue') || name.includes('nail') || name.includes('eyelash')) return 'detail';
  if (name.includes('skin') || name.includes('body') || name.includes('arm') || name.includes('leg')) return 'skin';
  if (name.includes('hair')) return 'hair';
  if (
    name.includes('cloth') ||
    name.includes('look') ||
    name.includes('shirt') ||
    name.includes('pants') ||
    name.includes('pant') ||
    name.includes('jeans') ||
    name.includes('shoes') ||
    name.includes('sneaker') ||
    name.includes('coverall')
  ) return 'cloth';

  return 'avatar';
};

const applyViewerMaterialSettings = (mesh: THREE.Mesh) => {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  materials.filter(Boolean).forEach((material) => {
    const tunableMaterial = material as TunableMaterial;
    const kind = materialKind(tunableMaterial, mesh);

    if (tunableMaterial.emissive && !tunableMaterial.emissiveMap) {
      const emissiveStrength = Math.max(tunableMaterial.emissive.r, tunableMaterial.emissive.g, tunableMaterial.emissive.b);
      if (emissiveStrength >= 0.5) {
        tunableMaterial.emissive.setRGB(0, 0, 0);
        tunableMaterial.emissiveIntensity = 0;
      }
    }

    if (kind === 'cloth') {
      tunableMaterial.roughness = MATERIAL_TUNING.clothRoughness;
      tunableMaterial.envMapIntensity = MATERIAL_TUNING.clothEnvIntensity;
      tunableMaterial.emissive?.setRGB(
        MATERIAL_TUNING.clothShadowLift,
        MATERIAL_TUNING.clothShadowLift,
        MATERIAL_TUNING.clothShadowLift,
      );
      tunableMaterial.emissiveIntensity = 1;
    } else if (kind === 'hair') {
      tunableMaterial.roughness = MATERIAL_TUNING.hairRoughness;
      tunableMaterial.envMapIntensity = MATERIAL_TUNING.hairEnvIntensity;
    } else if (kind === 'skin') {
      tunableMaterial.roughness = MATERIAL_TUNING.skinRoughness;
      tunableMaterial.envMapIntensity = MATERIAL_TUNING.skinEnvIntensity;
    } else if (kind === 'eye') {
      tunableMaterial.envMapIntensity = MATERIAL_TUNING.eyeEnvIntensity;
    }

    if (kind !== 'hair') {
      tunableMaterial.metalness = 0;
    }

    tunableMaterial.needsUpdate = true;
  });
};

const disposeMaterial = (material: THREE.Material | THREE.Material[]) => {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
    return;
  }

  material.dispose();
};

const disposeObjectTree = (
  object: THREE.Object3D,
  options: { disposeGeometry?: boolean } = {},
) => {
  const disposeGeometry = options.disposeGeometry ?? true;

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    if (disposeGeometry) {
      child.geometry.dispose();
    }
    disposeMaterial(child.material);
  });
};

const hasReliableHandBasis = (handPoints: readonly number[], minConfidence = 0.05) => (
  [0, 5, 9, 13].every((index) => getKeypoint3DConfidence(handPoints, index) >= minConfidence)
);

const averageDatasetKeypoints = (
  flatArray: null | readonly number[] | undefined,
  indices: readonly number[],
  minConfidence = 0.05,
) => {
  if (!flatArray) return null;

  const points = indices
    .filter((index) => getKeypoint3DConfidence(flatArray, index) >= minConfidence)
    .map((index) => getKeypoint3D(flatArray, index));

  if (!points.length) return null;

  return points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
};

const worldToDataset = (vector: THREE.Vector3) => (
  new THREE.Vector3(vector.x, -vector.y, -vector.z)
);

const localTorsoPoint = (
  point: THREE.Vector3,
  origin: THREE.Vector3,
  torsoBasis: { forward: THREE.Vector3; horizontalForward?: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3 },
) => {
  const delta = point.clone().sub(origin);
  const world = new THREE.Vector3(delta.x, -delta.y, -delta.z);
  const forward = (torsoBasis.horizontalForward ?? torsoBasis.forward).clone().normalize();
  const side = torsoBasis.side.clone().normalize();
  const up = torsoBasis.up.clone().normalize();

  return {
    forward: world.dot(forward),
    side: world.dot(side),
    up: world.dot(up),
  };
};

const datasetDeltaFromTorsoLocal = (
  delta: { forward: number; side: number; up: number },
  torsoBasis: { forward: THREE.Vector3; horizontalForward?: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3 },
) => {
  const forward = (torsoBasis.horizontalForward ?? torsoBasis.forward).clone().normalize();
  const side = torsoBasis.side.clone().normalize();
  const up = torsoBasis.up.clone().normalize();
  const worldDelta = forward
    .multiplyScalar(delta.forward)
    .add(side.multiplyScalar(delta.side))
    .add(up.multiplyScalar(delta.up));

  return worldToDataset(worldDelta);
};

const computeFaceRelativeArmCorrection = (
  armPoints: { elbow: THREE.Vector3; wrist: THREE.Vector3 },
  options: {
    face: readonly number[];
    hand: readonly number[];
    pose: readonly number[];
    proximity?: { strength?: number };
    torsoBasis: { forward: THREE.Vector3; horizontalForward?: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3 };
  },
) => {
  const leftShoulder = getKeypoint3D(options.pose, 5);
  const rightShoulder = getKeypoint3D(options.pose, 2);
  const shoulderWidth = leftShoulder.distanceTo(rightShoulder);

  if (!Number.isFinite(shoulderWidth) || shoulderWidth <= 1e-5) {
    return armPoints;
  }

  const shoulderCenter = leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5);
  const faceAnchor = averageDatasetKeypoints(options.face, [27, 28, 29, 30, 31, 33, 36, 39, 42, 45, 48, 54]);
  if (!faceAnchor) return armPoints;

  const handAnchor = averageDatasetKeypoints(options.hand, [0, 5, 9, 13, 17])
    ?? averageDatasetKeypoints(options.hand, [5, 9, 13, 17])
    ?? armPoints.wrist;
  const faceLocal = localTorsoPoint(faceAnchor, shoulderCenter, options.torsoBasis);
  const handLocal = localTorsoPoint(handAnchor, shoulderCenter, options.torsoBasis);
  const sideOffset = handLocal.side - faceLocal.side;
  const upOffset = handLocal.up - faceLocal.up;
  const forwardOffset = handLocal.forward - faceLocal.forward;
  const sideScore = 1 - THREE.MathUtils.clamp(Math.abs(sideOffset) / (shoulderWidth * 0.74), 0, 1);
  const upScore = 1 - THREE.MathUtils.clamp(Math.abs(upOffset) / (shoulderWidth * 0.82), 0, 1);
  const forwardScore = 1 - remapClamped(Math.abs(forwardOffset), shoulderWidth * 0.08, shoulderWidth * 0.72);
  const planarStrength = Math.min(sideScore, upScore) * forwardScore;
  const strength = Math.max(options.proximity?.strength ?? 0, planarStrength * 0.75);

  if (strength < 0.12) return armPoints;

  const sideLimit = shoulderWidth * MOTION_SETTINGS.faceRelativeHandMaxSideOffset;
  const upLimit = shoulderWidth * MOTION_SETTINGS.faceRelativeHandMaxUpOffset;
  const targetSideOffset = THREE.MathUtils.clamp(sideOffset, -sideLimit, sideLimit);
  const targetUpOffset = THREE.MathUtils.clamp(upOffset, -upLimit, upLimit);
  const correctionWeight = THREE.MathUtils.clamp(
    strength * MOTION_SETTINGS.faceRelativeHandCorrectionStrength,
    0,
    1,
  );
  const wristDelta = datasetDeltaFromTorsoLocal({
    forward: 0,
    side: (targetSideOffset - sideOffset) * correctionWeight,
    up: (targetUpOffset - upOffset) * correctionWeight,
  }, options.torsoBasis);

  if (wristDelta.lengthSq() < 1e-10) return armPoints;

  return {
    elbow: armPoints.elbow.clone().add(wristDelta.clone().multiplyScalar(MOTION_SETTINGS.faceRelativeHandElbowFollow)),
    wrist: armPoints.wrist.clone().add(wristDelta),
  };
};

const createThreeRuntime = (
  gl: ExpoWebGLRenderingContext,
  initialWidth: number,
  initialHeight: number,
  getFrames: () => readonly ViewerFrame[] | undefined,
  onReady?: () => void,
): RendererRuntime => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const renderer = new Renderer({ gl });
  const avatarState = createAvatarState();
  const {
    applyBoneQuaternion,
    applyMorphMap,
    captureBindPose,
    rememberBone,
    rememberMorphMesh,
    reportMissingAliases,
    resetPose,
    setBonePositionOffset,
  } = createRigController(avatarState);
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnvironmentTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

  let animationFrame: number | null = null;
  let disposed = false;
  let modelLoaded = false;
  let pendingFrame: PendingFrame | null = null;
  let lastFrameIndex: number | null = null;

  pmremGenerator.dispose();
  camera.position.set(0, 1.42, 2.28);
  renderer.setPixelRatio(Math.min(PixelRatio.get(), 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = LIGHTING_SETUP.toneMapping;
  renderer.toneMappingExposure = LIGHTING_SETUP.exposure;
  scene.environment = roomEnvironmentTexture;

  const resize = (width: number, height: number) => {
    const nextWidth = Math.max(width || gl.drawingBufferWidth || 1, 1);
    const nextHeight = Math.max(height || gl.drawingBufferHeight || 1, 1);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight);
  };
  resize(initialWidth, initialHeight);

  const ambientLight = new THREE.HemisphereLight(
    LIGHTING_SETUP.skyColor,
    LIGHTING_SETUP.groundColor,
    LIGHTING_SETUP.ambient,
  );
  const keyLight = new THREE.DirectionalLight(LIGHTING_SETUP.keyColor, LIGHTING_SETUP.key);
  keyLight.position.set(LIGHTING_SETUP.keyPosition[0], LIGHTING_SETUP.keyPosition[1], LIGHTING_SETUP.keyPosition[2]);
  const fillLight = new THREE.DirectionalLight(LIGHTING_SETUP.fillColor, LIGHTING_SETUP.fill);
  fillLight.position.set(LIGHTING_SETUP.fillPosition[0], LIGHTING_SETUP.fillPosition[1], LIGHTING_SETUP.fillPosition[2]);
  const rimLight = new THREE.DirectionalLight(LIGHTING_SETUP.rimColor, LIGHTING_SETUP.rim);
  rimLight.position.set(LIGHTING_SETUP.rimPosition[0], LIGHTING_SETUP.rimPosition[1], LIGHTING_SETUP.rimPosition[2]);
  scene.add(ambientLight, keyLight, fillLight, rimLight);

  const resetTorsoCorrectionState = () => {
    avatarState.torsoCollision.left.active = false;
    avatarState.torsoCollision.left.pushWorld.set(0, 0, 0);
    avatarState.torsoCollision.right.active = false;
    avatarState.torsoCollision.right.pushWorld.set(0, 0, 0);
    avatarState.faceHandProximity.left.active = false;
    avatarState.faceHandProximity.left.forwardDelta = null;
    avatarState.faceHandProximity.left.strength = 0;
    avatarState.faceHandProximity.right.active = false;
    avatarState.faceHandProximity.right.forwardDelta = null;
    avatarState.faceHandProximity.right.strength = 0;
    avatarState.twoHandContact.active = false;
    avatarState.twoHandContact.minDistance = null;
    avatarState.twoHandContact.strength = 0;
  };

  const getBindParentDirection = (boneName: string, childName: string) => {
    const bone = avatarState.bones.get(boneName);
    const bindBonePosition = avatarState.bindWorldPositions?.get(boneName);
    const bindChildPosition = avatarState.bindWorldPositions?.get(childName);
    if (!bone || !bindBonePosition || !bindChildPosition) return null;

    const bindWorldDirection = bindChildPosition.clone().sub(bindBonePosition);
    if (bindWorldDirection.lengthSq() < 1e-8) return null;

    const parentBindQuaternion = bone.parent
      ? avatarState.bindWorldQuaternions?.get(bone.parent.name)
      : null;
    if (parentBindQuaternion) {
      bindWorldDirection.applyQuaternion(parentBindQuaternion.clone().invert());
    }

    return bindWorldDirection.normalize();
  };

  const getBindWorldDirection = (boneName: string, childName: string) => {
    const bindBonePosition = avatarState.bindWorldPositions?.get(boneName);
    const bindChildPosition = avatarState.bindWorldPositions?.get(childName);
    if (!bindBonePosition || !bindChildPosition) return null;

    const bindWorldDirection = bindChildPosition.clone().sub(bindBonePosition);
    return bindWorldDirection.lengthSq() > 1e-8 ? bindWorldDirection.normalize() : null;
  };

  const getBindWorldLength = (boneName: string, childName: string) => {
    const bindBonePosition = avatarState.bindWorldPositions?.get(boneName);
    const bindChildPosition = avatarState.bindWorldPositions?.get(childName);

    return bindBonePosition && bindChildPosition
      ? bindBonePosition.distanceTo(bindChildPosition)
      : undefined;
  };

  const avatarToDatasetScale = (pose: readonly number[]) => {
    const avatarLeftShoulder = avatarState.bindWorldPositions?.get('LeftArm');
    const avatarRightShoulder = avatarState.bindWorldPositions?.get('RightArm');
    if (!avatarLeftShoulder || !avatarRightShoulder) return 1;

    const datasetShoulderWidth = getKeypoint3D(pose, 5).distanceTo(getKeypoint3D(pose, 2));
    const avatarShoulderWidth = avatarLeftShoulder.distanceTo(avatarRightShoulder);

    return datasetShoulderWidth > 1e-5 && avatarShoulderWidth > 1e-5
      ? avatarShoulderWidth / datasetShoulderWidth
      : 1;
  };

  const fixedShoulderArmDirection = (
    armBoneName: string,
    forearmBoneName: string,
    shoulderPoint: THREE.Vector3,
    elbowPoint: THREE.Vector3,
    targetWeight: number = MOTION_SETTINGS.shoulderArmTargetWeight,
  ) => {
    const keypointDirection = pointDirection(shoulderPoint, elbowPoint);
    const bindDirection = getBindWorldDirection(armBoneName, forearmBoneName);
    return bindDirection ? blendDirections(bindDirection, keypointDirection, targetWeight) : keypointDirection;
  };

  const solveAvatarArmIkDirections = (
    sidePrefix: 'Left' | 'Right',
    shoulderPoint: THREE.Vector3,
    elbowPoint: THREE.Vector3,
    wristPoint: THREE.Vector3,
    pose: readonly number[],
  ) => solveTwoBoneArmIkDirections(shoulderPoint, elbowPoint, wristPoint, {
    forearmLength: getBindWorldLength(`${sidePrefix}ForeArm`, `${sidePrefix}Hand`),
    scale: avatarToDatasetScale(pose),
    upperLength: getBindWorldLength(`${sidePrefix}Arm`, `${sidePrefix}ForeArm`),
  });

  const blendIkDirection = (
    fkDirection: THREE.Vector3,
    ikDirection: THREE.Vector3 | undefined,
    weight: number,
  ) => (!ikDirection || weight <= 0
    ? fkDirection
    : blendDirections(fkDirection, ikDirection, THREE.MathUtils.clamp(weight, 0, 1)));

  const limitedBindRelativeDirection = (
    boneName: string,
    childName: string,
    targetDirectionWorld: THREE.Vector3,
    targetWeight: number,
    maxAngle: number,
  ) => {
    const bindDirection = getBindWorldDirection(boneName, childName);
    if (!bindDirection) return targetDirectionWorld;

    const weightedDirection = blendDirections(bindDirection, targetDirectionWorld, targetWeight);
    const angle = bindDirection.angleTo(weightedDirection);
    if (!Number.isFinite(angle) || angle <= maxAngle) return weightedDirection;

    return blendDirections(bindDirection, weightedDirection, maxAngle / angle);
  };

  const setBoneTowardDirection = (
    boneName: string,
    childName: string,
    targetDirectionWorld: THREE.Vector3,
    options: { bindBlend?: number; smoothing?: number } = {},
  ) => {
    const smoothing = options.smoothing ?? 1;
    const bindBlend = options.bindBlend ?? 0;
    const bone = avatarState.bones.get(boneName);
    const child = avatarState.bones.get(childName);
    const bindRotation = avatarState.bindRotations.get(boneName);
    if (!bone || !child || !bindRotation || !bone.parent) return;

    const bindParentDirection = getBindParentDirection(boneName, childName)
      ?? child.position.clone().normalize().applyQuaternion(bindRotation);
    const parentWorldQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const targetParentDirection = targetDirectionWorld.clone().applyQuaternion(parentWorldQuaternion.invert()).normalize();
    const blendedParentDirection = bindBlend > 0
      ? targetParentDirection
        .clone()
        .multiplyScalar(Math.max(0, 1 - bindBlend))
        .add(bindParentDirection.clone().multiplyScalar(bindBlend))
        .normalize()
      : targetParentDirection;
    const offset = new THREE.Quaternion().setFromUnitVectors(
      bindParentDirection.normalize(),
      blendedParentDirection,
    );

    applyBoneQuaternion(boneName, offset.multiply(bindRotation.clone()), smoothing);
  };

  const setBoneTowardDirectionFromParentSpace = (
    boneName: string,
    bindParentDirection: THREE.Vector3,
    targetDirectionWorld: THREE.Vector3,
    options: { smoothing?: number } = {},
  ) => {
    const smoothing = options.smoothing ?? 1;
    const bone = avatarState.bones.get(boneName);
    const bindRotation = avatarState.bindRotations.get(boneName);
    if (!bone || !bindRotation || !bone.parent) return;

    const parentWorldQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const targetParentDirection = targetDirectionWorld.clone().applyQuaternion(parentWorldQuaternion.invert()).normalize();
    const offset = new THREE.Quaternion().setFromUnitVectors(bindParentDirection.clone().normalize(), targetParentDirection);

    applyBoneQuaternion(boneName, offset.multiply(bindRotation.clone()), smoothing);
  };

  const {
    applyFingerChainsFromFrame,
    setHandOrientationFromFrame,
  } = createHandRigAppliers({
    applyBoneQuaternion,
    avatarState,
    scene,
    setBoneTowardDirection,
    setBoneTowardDirectionFromParentSpace,
  });

  const applyRigidBoneHeadFollow = (name: string, options: { extraHeadLocalOffset?: THREE.Vector3; extraLocalRotation?: THREE.Quaternion; smoothing?: number } = {}) => {
    const headBone = avatarState.bones.get('Head');
    const bone = avatarState.bones.get(name);
    const bindHeadPosition = avatarState.bindWorldPositions?.get('Head');
    const bindHeadQuaternion = avatarState.bindWorldQuaternions?.get('Head');
    const bindBonePosition = avatarState.bindWorldPositions?.get(name);
    const bindBoneQuaternion = avatarState.bindWorldQuaternions?.get(name);
    const bindBoneLocalPosition = avatarState.bindPositions?.get(name);
    const smoothing = options.smoothing ?? 1;
    if (!headBone || !bone || !bindHeadPosition || !bindHeadQuaternion || !bindBonePosition || !bindBoneQuaternion || !bindBoneLocalPosition || !bone.parent) {
      return;
    }

    scene.updateMatrixWorld(true);
    const currentHeadPosition = headBone.getWorldPosition(new THREE.Vector3());
    const currentHeadQuaternion = headBone.getWorldQuaternion(new THREE.Quaternion());
    const headDeltaQuaternion = currentHeadQuaternion.clone().multiply(bindHeadQuaternion.clone().invert());
    const extraWorldOffset = (options.extraHeadLocalOffset ?? new THREE.Vector3()).clone().applyQuaternion(currentHeadQuaternion);
    const bindBoneOffset = bindBonePosition.clone().sub(bindHeadPosition);
    const targetWorldPosition = currentHeadPosition
      .clone()
      .add(bindBoneOffset.applyQuaternion(headDeltaQuaternion))
      .add(extraWorldOffset);
    const targetWorldQuaternion = headDeltaQuaternion
      .clone()
      .multiply(bindBoneQuaternion)
      .multiply(options.extraLocalRotation ?? new THREE.Quaternion());
    const targetLocalPosition = bone.parent.worldToLocal(targetWorldPosition.clone());
    const positionOffset = targetLocalPosition.sub(bindBoneLocalPosition);
    const parentWorldQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const targetLocalQuaternion = parentWorldQuaternion.invert().multiply(targetWorldQuaternion);

    setBonePositionOffset(name, positionOffset, smoothing);
    applyBoneQuaternion(name, targetLocalQuaternion, smoothing);
  };

  const applyRigidFaceAttachments = (morphs: Record<string, number>, smoothing = 1) => {
    applyRigidBoneHeadFollow('EyeLeft', { smoothing });
    applyRigidBoneHeadFollow('EyeRight', { smoothing });

    const jawOpen = THREE.MathUtils.clamp(
      Math.max(Number(morphs.jawOpen) || 0, (Number(morphs.mouthOpen) || 0) * 0.55),
      0,
      1,
    );
    const jawForward = THREE.MathUtils.clamp(Number(morphs.jawForward) || 0, 0, 1);
    const jawLateral = THREE.MathUtils.clamp((Number(morphs.jawRight) || 0) - (Number(morphs.jawLeft) || 0), -1, 1);
    const jawRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-jawOpen * 0.18, 0, jawLateral * 0.04));

    applyRigidBoneHeadFollow('JawMaster', {
      extraHeadLocalOffset: new THREE.Vector3(jawLateral * 0.0025, -jawOpen * 0.006, jawForward * 0.003),
      extraLocalRotation: jawRotation,
      smoothing,
    });
    applyRigidBoneHeadFollow('Jaw', {
      extraHeadLocalOffset: new THREE.Vector3(jawLateral * 0.0016, -jawOpen * 0.01, jawForward * 0.002),
      extraLocalRotation: jawRotation,
      smoothing,
    });
    applyRigidBoneHeadFollow('TeethTop', { smoothing });
    applyRigidBoneHeadFollow('TeethBottom', {
      extraHeadLocalOffset: new THREE.Vector3(jawLateral * 0.002, -jawOpen * 0.022, jawForward * 0.004),
      extraLocalRotation: jawRotation,
      smoothing,
    });
  };

  const renderLoop = () => {
    if (disposed) return;

    renderer.render(scene, camera);
    gl.endFrameEXP();
    animationFrame = requestAnimationFrame(renderLoop);
  };

  const notifyReadyAfterPaint = () => {
    let remaining = 2;
    const waitNextFrame = () => {
      if (disposed) return;
      remaining -= 1;
      if (remaining <= 0) {
        onReady?.();
        return;
      }
      requestAnimationFrame(waitNextFrame);
    };
    requestAnimationFrame(waitNextFrame);
  };

  const applyFrameData = (frame: ViewerFrame, frameIndex: number) => {
    if (!modelLoaded) {
      pendingFrame = { frame, frameIndex };
      return;
    }

    const pose = frame.people.pose_keypoints_3d;
    const leftHand = frame.people.hand_left_keypoints_3d;
    const rightHand = frame.people.hand_right_keypoints_3d;
    const face = frame.people.face_keypoints_3d;
    const shouldResetContinuity = lastFrameIndex !== null && Math.abs(frameIndex - lastFrameIndex) > 1;

    if (shouldResetContinuity) resetTorsoCorrectionState();
    lastFrameIndex = frameIndex;

    resetPose();
    scene.updateMatrixWorld(true);

    const leftShoulder = getKeypoint3D(pose, 5);
    const leftElbow = getKeypoint3D(pose, 6);
    const leftCanonicalWrist = computeCanonicalWristTarget(getKeypoint3D(pose, 7), leftHand);
    const rightShoulder = getKeypoint3D(pose, 2);
    const rightElbow = getKeypoint3D(pose, 3);
    const rightCanonicalWrist = computeCanonicalWristTarget(getKeypoint3D(pose, 4), rightHand);
    const twoHandContact = detectTwoHandContact(leftHand, rightHand, pose, {
      ...TWO_HAND_CONTACT_OPTIONS,
      state: avatarState.twoHandContact,
    });
    const correctedLeftArm = computeCorrectedArmPoints(frame, 'left', leftElbow, leftCanonicalWrist, {
      correctionMode: null,
      correctionProfile: false,
      sequence: null,
    });
    const correctedRightArm = computeCorrectedArmPoints(frame, 'right', rightElbow, rightCanonicalWrist, {
      correctionMode: null,
      correctionProfile: false,
      sequence: null,
    });
    const torsoMotion = computeSharedTorsoMotion(pose, {
      forwardTiltScale: MOTION_SETTINGS.torsoForwardTiltScale,
      sideTiltScale: MOTION_SETTINGS.torsoSideTiltScale,
    });
    const leftFaceProximity = detectFaceHandProximity(leftHand, face, pose, {
      ...FACE_HAND_PROXIMITY_OPTIONS,
      state: avatarState.faceHandProximity.left,
      torsoBasis: torsoMotion.torsoBasis,
    });
    const rightFaceProximity = detectFaceHandProximity(rightHand, face, pose, {
      ...FACE_HAND_PROXIMITY_OPTIONS,
      state: avatarState.faceHandProximity.right,
      torsoBasis: torsoMotion.torsoBasis,
    });
    const leftCollisionArm = MOTION_SETTINGS.torsoCollision
      ? applyTorsoCollisionCorrection(pose, correctedLeftArm, {
        ...TORSO_COLLISION_OPTIONS,
        handPoints: leftHand,
        state: avatarState.torsoCollision.left,
        torsoBasis: torsoMotion.torsoBasis,
      })
      : correctedLeftArm;
    const rightCollisionArm = MOTION_SETTINGS.torsoCollision
      ? applyTorsoCollisionCorrection(pose, correctedRightArm, {
        ...TORSO_COLLISION_OPTIONS,
        handPoints: rightHand,
        state: avatarState.torsoCollision.right,
        torsoBasis: torsoMotion.torsoBasis,
      })
      : correctedRightArm;
    const leftArm = computeFaceRelativeArmCorrection(leftCollisionArm, {
      face,
      hand: leftHand,
      pose,
      proximity: leftFaceProximity,
      torsoBasis: torsoMotion.torsoBasis,
    });
    const rightArm = computeFaceRelativeArmCorrection(rightCollisionArm, {
      face,
      hand: rightHand,
      pose,
      proximity: rightFaceProximity,
      torsoBasis: torsoMotion.torsoBasis,
    });
    const headFaceResult = computeHeadFaceStrategy(frame, {
      blinkSync: { mode: 'average' },
      faceCalibration: null,
      mode: FACE_MODE,
    });
    const clampedFaceMorphs = clampFaceMorphs(headFaceResult.morphs);

    if (MOTION_SETTINGS.torsoPose) {
      setBoneTowardDirection(
        'Spine1',
        'Spine2',
        limitedBindRelativeDirection(
          'Spine1',
          'Spine2',
          torsoMotion.spine1Direction,
          MOTION_SETTINGS.torsoTargetWeight,
          MOTION_SETTINGS.torsoLimits.Spine1,
        ),
        { bindBlend: torsoMotion.spine1BindBlend, smoothing: MOTION_SETTINGS.playbackBoneSmoothing },
      );
      scene.updateMatrixWorld(true);
      setBoneTowardDirection(
        'Spine2',
        'Neck',
        limitedBindRelativeDirection(
          'Spine2',
          'Neck',
          torsoMotion.spine2Direction,
          MOTION_SETTINGS.torsoTargetWeight,
          MOTION_SETTINGS.torsoLimits.Spine2,
        ),
        { bindBlend: torsoMotion.spine2BindBlend, smoothing: MOTION_SETTINGS.playbackBoneSmoothing },
      );
      scene.updateMatrixWorld(true);
    }

    if (MOTION_SETTINGS.shoulderPose) {
      setBoneTowardDirection(
        'LeftShoulder',
        'LeftArm',
        limitedBindRelativeDirection(
          'LeftShoulder',
          'LeftArm',
          torsoMotion.leftShoulderDirection,
          MOTION_SETTINGS.shoulderPoseWeight,
          MOTION_SETTINGS.torsoLimits.LeftShoulder,
        ),
        { smoothing: MOTION_SETTINGS.playbackBoneSmoothing },
      );
      setBoneTowardDirection(
        'RightShoulder',
        'RightArm',
        limitedBindRelativeDirection(
          'RightShoulder',
          'RightArm',
          torsoMotion.rightShoulderDirection,
          MOTION_SETTINGS.shoulderPoseWeight,
          MOTION_SETTINGS.torsoLimits.RightShoulder,
        ),
        { smoothing: MOTION_SETTINGS.playbackBoneSmoothing },
      );
      scene.updateMatrixWorld(true);
    }

    applyRigidFaceAttachments(clampedFaceMorphs, MOTION_SETTINGS.playbackMorphSmoothing);

    const leftIkDirections = solveAvatarArmIkDirections('Left', leftShoulder, leftArm.elbow, leftArm.wrist, pose);
    const rightIkDirections = solveAvatarArmIkDirections('Right', rightShoulder, rightArm.elbow, rightArm.wrist, pose);
    const leftIkWeight = Math.max(
      MOTION_SETTINGS.baseIkWeight,
      twoHandContact.strength * MOTION_SETTINGS.twoHandIkWeight,
      leftFaceProximity.strength * MOTION_SETTINGS.faceHandIkWeight,
      avatarState.torsoCollision.left.active ? MOTION_SETTINGS.torsoContactIkWeight : 0,
    );
    const rightIkWeight = Math.max(
      MOTION_SETTINGS.baseIkWeight,
      twoHandContact.strength * MOTION_SETTINGS.twoHandIkWeight,
      rightFaceProximity.strength * MOTION_SETTINGS.faceHandIkWeight,
      avatarState.torsoCollision.right.active ? MOTION_SETTINGS.torsoContactIkWeight : 0,
    );
    const leftShoulderArmTargetWeight = Math.max(
      THREE.MathUtils.lerp(MOTION_SETTINGS.shoulderArmTargetWeight, MOTION_SETTINGS.contactShoulderArmTargetWeight, twoHandContact.strength),
      THREE.MathUtils.lerp(MOTION_SETTINGS.shoulderArmTargetWeight, MOTION_SETTINGS.faceHandShoulderArmTargetWeight, leftFaceProximity.strength),
    );
    const rightShoulderArmTargetWeight = Math.max(
      THREE.MathUtils.lerp(MOTION_SETTINGS.shoulderArmTargetWeight, MOTION_SETTINGS.contactShoulderArmTargetWeight, twoHandContact.strength),
      THREE.MathUtils.lerp(MOTION_SETTINGS.shoulderArmTargetWeight, MOTION_SETTINGS.faceHandShoulderArmTargetWeight, rightFaceProximity.strength),
    );
    const leftUpperDirection = blendIkDirection(
      fixedShoulderArmDirection('LeftArm', 'LeftForeArm', leftShoulder, leftArm.elbow, leftShoulderArmTargetWeight),
      leftIkDirections?.upperDirection,
      leftIkWeight,
    );
    const rightUpperDirection = blendIkDirection(
      fixedShoulderArmDirection('RightArm', 'RightForeArm', rightShoulder, rightArm.elbow, rightShoulderArmTargetWeight),
      rightIkDirections?.upperDirection,
      rightIkWeight,
    );
    const leftForearmDirection = blendIkDirection(pointDirection(leftArm.elbow, leftArm.wrist), leftIkDirections?.forearmDirection, leftIkWeight);
    const rightForearmDirection = blendIkDirection(pointDirection(rightArm.elbow, rightArm.wrist), rightIkDirections?.forearmDirection, rightIkWeight);

    setBoneTowardDirection('LeftArm', 'LeftForeArm', leftUpperDirection, { smoothing: MOTION_SETTINGS.playbackBoneSmoothing });
    setBoneTowardDirection('RightArm', 'RightForeArm', rightUpperDirection, { smoothing: MOTION_SETTINGS.playbackBoneSmoothing });
    scene.updateMatrixWorld(true);
    setBoneTowardDirection('LeftForeArm', 'LeftHand', leftForearmDirection, { smoothing: MOTION_SETTINGS.playbackBoneSmoothing });
    setBoneTowardDirection('RightForeArm', 'RightHand', rightForearmDirection, { smoothing: MOTION_SETTINGS.playbackBoneSmoothing });
    scene.updateMatrixWorld(true);

    if (hasReliableHandBasis(leftHand)) {
      setHandOrientationFromFrame('Left', leftArm.wrist, getKeypoint3D(leftHand, 5), getKeypoint3D(leftHand, 9), getKeypoint3D(leftHand, 13), {
        orientationWeight: MOTION_SETTINGS.handOrientationWeight,
        smoothing: MOTION_SETTINGS.playbackBoneSmoothing,
      });
    }
    if (hasReliableHandBasis(rightHand)) {
      setHandOrientationFromFrame('Right', rightArm.wrist, getKeypoint3D(rightHand, 5), getKeypoint3D(rightHand, 9), getKeypoint3D(rightHand, 13), {
        orientationWeight: MOTION_SETTINGS.handOrientationWeight,
        smoothing: MOTION_SETTINGS.playbackBoneSmoothing,
      });
    }
    scene.updateMatrixWorld(true);

    applyFingerChainsFromFrame('Left', leftHand, { smoothing: MOTION_SETTINGS.playbackBoneSmoothing });
    applyFingerChainsFromFrame('Right', rightHand, { smoothing: MOTION_SETTINGS.playbackBoneSmoothing });
    applyMorphMap(clampedFaceMorphs, MOTION_SETTINGS.playbackMorphSmoothing);
  };

  void createAvatarModelInstance()
    .then((modelRoot) => {
      if (disposed) {
        disposeObjectTree(modelRoot, { disposeGeometry: false });
        return;
      }

      scene.add(modelRoot);
      modelRoot.traverse((object: THREE.Object3D) => {
        if (object instanceof THREE.Bone) rememberBone(object);
        if (object instanceof THREE.Mesh) {
          object.frustumCulled = false;
          avatarState.renderMeshes.push(object);
          applyViewerMaterialSettings(object);
        }
        if (isMorphMesh(object)) rememberMorphMesh(object);
      });

      const avatarBox = new THREE.Box3().setFromObject(modelRoot);
      const center = avatarBox.getCenter(new THREE.Vector3());
      modelRoot.position.sub(center);
      modelRoot.position.y = 0;
      captureBindPose(scene);
      reportMissingAliases();
      scene.updateMatrixWorld(true);
      modelLoaded = true;

      if (pendingFrame) {
        applyFrameData(pendingFrame.frame, pendingFrame.frameIndex);
        pendingFrame = null;
      } else {
        const initialFrame = getFrames()?.[0];
        if (initialFrame) applyFrameData(initialFrame, 0);
      }

      notifyReadyAfterPaint();
    })
    .catch((error: unknown) => {
      console.error('Failed to load avatar model.', error);
    });

  animationFrame = requestAnimationFrame(renderLoop);

  return {
    applyFrameData,
    dispose: () => {
      disposed = true;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      disposeObjectTree(scene, { disposeGeometry: false });
      roomEnvironmentTexture.dispose();
      renderer.dispose();
    },
    resize,
  };
};

export const AvatarThreeRenderer = ({
  frame,
  frameIndex,
  frames,
  onReady,
}: AvatarThreeRendererProps) => {
  const runtimeRef = useRef<RendererRuntime | null>(null);
  const onReadyRef = useRef(onReady);
  const readyRef = useRef(false);
  const framesRef = useRef(frames);
  const [layout, setLayout] = useState({ height: 1, width: 1 });

  useEffect(() => {
    onReadyRef.current = onReady;
    if (readyRef.current) onReady?.();
  }, [onReady]);

  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  useEffect(() => {
    runtimeRef.current?.resize(layout.width, layout.height);
  }, [layout.height, layout.width]);

  useEffect(() => {
    runtimeRef.current?.applyFrameData(frame, frameIndex);
  }, [frame, frameIndex]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const { height, width } = event.nativeEvent.layout;
    setLayout({
      height: Math.max(height, 1),
      width: Math.max(width, 1),
    });
  };

  const handleContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    const runtime = createThreeRuntime(
      gl,
      layout.width || gl.drawingBufferWidth || 1,
      layout.height || gl.drawingBufferHeight || 1,
      () => framesRef.current,
      () => {
        readyRef.current = true;
        onReadyRef.current?.();
      },
    );
    runtimeRef.current = runtime;
    runtime.applyFrameData(frame, frameIndex);
  }, [frame, frameIndex, layout.height, layout.width]);

  useEffect(() => () => {
    runtimeRef.current?.dispose();
    runtimeRef.current = null;
    readyRef.current = false;
  }, []);

  return (
    <GLView
      style={styles.root}
      onContextCreate={handleContextCreate}
      onLayout={handleLayout}
    />
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
