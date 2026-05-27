import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { createAvatarModelInstance } from '@/lib/avatar-renderer/avatarModelCache';
import type { ViewerFrame, ViewerSegment } from '@/lib/avatar-renderer/avatarTypes';
import {
  buildSequenceFaceCalibrationFromFrames,
  computeHeadFaceStrategy,
} from '@/lib/avatar-viewer/lib/head-face-strategies.js';
import {
  applyTorsoCollisionCorrection,
  blendDirections,
  computeCanonicalWristTarget,
  computeCorrectedArmPoints,
  computeSharedTorsoMotion,
  createHandRigAppliers,
  datasetToWorld,
  detectFaceHandProximity,
  detectTwoHandContact,
  getKeypoint3D,
  getKeypoint3DConfidence,
  pointDirection,
  remapClamped,
  solveTwoBoneArmIkDirections,
} from '@/lib/avatar-viewer/viewer/body-motion.js';
import {
  clampFaceMorphs,
  containSentenceEyeMorphs,
  stabilizeEyeMorphs,
} from '@/lib/avatar-viewer/viewer/face-morph-safety.js';
import { createRigController } from '@/lib/avatar-viewer/viewer/rig-controller.js';

type AvatarThreeRendererProps = {
  frame: ViewerFrame;
  frameIndex: number;
  frames?: readonly ViewerFrame[];
  onReady?: () => void;
  segments?: readonly ViewerSegment[];
};

type PendingFrame = {
  frame: ViewerFrame;
  frameIndex: number;
  frames?: readonly ViewerFrame[];
  segments?: readonly ViewerSegment[];
};

type RendererRuntime = {
  applyFrameData: (
    frame: ViewerFrame,
    frameIndex: number,
    frames?: readonly ViewerFrame[],
    segments?: readonly ViewerSegment[],
  ) => void;
  dispose: () => void;
};

type MorphMesh = THREE.Mesh & {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
};

type AvatarRigState = {
  bindMorphValues?: Record<string, number>;
  bindPositions: Map<string, THREE.Vector3>;
  bindRotations: Map<string, THREE.Quaternion>;
  bindWorldPositions?: Map<string, THREE.Vector3>;
  bindWorldQuaternions?: Map<string, THREE.Quaternion>;
  boneAliases?: Record<string, string>;
  bones: Map<string, THREE.Bone>;
  morphAliases?: Record<string, string>;
  morphMeshes: MorphMesh[];
  morphValues: Record<string, number>;
  supportedMorphNames: Set<string>;
};

type RigidBoneHeadFollowOptions = {
  extraHeadLocalOffset?: THREE.Vector3;
  extraLocalRotation?: THREE.Quaternion;
  maxLocalOffset?: THREE.Vector3;
  smoothing?: number;
};

type RigidFaceAttachmentOptions = {
  eye?: RigidBoneHeadFollowOptions;
  jawSmoothing?: number;
};

type RuntimeAvatarState = AvatarRigState & {
  faceHandProximity: {
    left: { active: boolean; forwardDelta: null | number; strength: number };
    right: { active: boolean; forwardDelta: null | number; strength: number };
  };
  renderMeshes: THREE.Mesh[];
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

const ENABLE_TORSO_POSE = true;
const ENABLE_HEAD_POSE = true;
const FIXED_SHOULDER_ARM_TARGET_WEIGHT = 0.72;
const TORSO_FORWARD_TILT_SCALE = 0;
const SAFE_TORSO_TARGET_WEIGHT = 0.1;
const SAFE_TORSO_LIMITS = Object.freeze({
  Spine1: THREE.MathUtils.degToRad(5),
  Spine2: THREE.MathUtils.degToRad(4),
});
const SAFE_HEAD_POSE_WEIGHT = 0.18;
const SAFE_HEAD_LIMITS = Object.freeze({
  headPitch: THREE.MathUtils.degToRad(2.8),
  headRoll: THREE.MathUtils.degToRad(2.8),
  headYaw: THREE.MathUtils.degToRad(4.2),
  neckPitch: THREE.MathUtils.degToRad(2.2),
  neckRoll: THREE.MathUtils.degToRad(2.2),
  neckYaw: THREE.MathUtils.degToRad(3.2),
});
const EYE_ATTACHMENT_OPTIONS = Object.freeze({
  maxLocalOffset: new THREE.Vector3(0.08, 0.08, 0.08),
  smoothing: 1,
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
const CONTACT_SHOULDER_ARM_TARGET_WEIGHT = 0.98;
const TWO_HAND_IK_WEIGHT = 0.95;
const TORSO_CONTACT_IK_WEIGHT = 0.72;
const FACE_HAND_SHOULDER_ARM_TARGET_WEIGHT = 0.98;
const FACE_HAND_IK_WEIGHT = 0.82;
const FACE_HAND_PROXIMITY_OPTIONS = Object.freeze({
  enterScore: 0.18,
  exitScore: 0.08,
  fullForward: 0.42,
  minForward: 0.12,
  sideRadius: 0.32,
  upRadius: 0.36,
});
const DEFAULT_VIEWER_FACE_MODE = 'faithful';
const DEFAULT_MOTION_MODE = 'faithful';
const FAITHFUL_TORSO_LIMITS = Object.freeze({
  LeftShoulder: THREE.MathUtils.degToRad(38),
  RightShoulder: THREE.MathUtils.degToRad(38),
  Spine1: THREE.MathUtils.degToRad(18),
  Spine2: THREE.MathUtils.degToRad(18),
});
const FAITHFUL_HEAD_LIMITS = Object.freeze({
  headPitch: THREE.MathUtils.degToRad(9),
  headRoll: THREE.MathUtils.degToRad(9),
  headYaw: THREE.MathUtils.degToRad(12),
  neckPitch: THREE.MathUtils.degToRad(7),
  neckRoll: THREE.MathUtils.degToRad(7),
  neckYaw: THREE.MathUtils.degToRad(9),
});
const MOTION_MODE_SETTINGS = Object.freeze({
  faithful: Object.freeze({
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
    headLimits: FAITHFUL_HEAD_LIMITS,
    headPose: false,
    headPoseWeight: 0.45,
    playbackBoneSmoothing: 0.82,
    playbackMorphSmoothing: 0.28,
    relativeTorsoPose: true,
    shoulderArmTargetWeight: 1,
    shoulderPose: true,
    shoulderPoseWeight: 0.32,
    torsoCollision: false,
    torsoContactIkWeight: 0,
    torsoForwardTiltScale: 0.65,
    torsoLimits: FAITHFUL_TORSO_LIMITS,
    torsoPose: true,
    torsoSideTiltScale: 0.45,
    torsoTargetWeight: 0.72,
    twoHandIkWeight: 1,
  }),
  natural: Object.freeze({
    baseIkWeight: 0,
    contactShoulderArmTargetWeight: CONTACT_SHOULDER_ARM_TARGET_WEIGHT,
    faceHandIkWeight: FACE_HAND_IK_WEIGHT,
    faceHandShoulderArmTargetWeight: FACE_HAND_SHOULDER_ARM_TARGET_WEIGHT,
    faceRelativeHandCorrection: false,
    faceRelativeHandCorrectionStrength: 0,
    faceRelativeHandElbowFollow: 0,
    faceRelativeHandMaxSideOffset: 0.42,
    faceRelativeHandMaxUpOffset: 0.5,
    handOrientationWeight: 0.48,
    headLimits: SAFE_HEAD_LIMITS,
    headPose: ENABLE_HEAD_POSE,
    headPoseWeight: SAFE_HEAD_POSE_WEIGHT,
    playbackBoneSmoothing: 0.35,
    playbackMorphSmoothing: 0.18,
    relativeTorsoPose: false,
    shoulderArmTargetWeight: FIXED_SHOULDER_ARM_TARGET_WEIGHT,
    shoulderPose: false,
    shoulderPoseWeight: SAFE_TORSO_TARGET_WEIGHT,
    torsoCollision: true,
    torsoContactIkWeight: TORSO_CONTACT_IK_WEIGHT,
    torsoForwardTiltScale: TORSO_FORWARD_TILT_SCALE,
    torsoLimits: SAFE_TORSO_LIMITS,
    torsoPose: ENABLE_TORSO_POSE,
    torsoSideTiltScale: 1.05,
    torsoTargetWeight: SAFE_TORSO_TARGET_WEIGHT,
    twoHandIkWeight: TWO_HAND_IK_WEIGHT,
  }),
});
const LIGHTING_SETUP = Object.freeze({
  ambient: 1.65,
  exposure: 0.78,
  fill: 0.8,
  fillColor: 0xf2f0ee,
  fillPosition: [ -3.2, 1.7, 2.5 ],
  groundColor: 0xe3d8d2,
  key: 0.62,
  keyColor: 0xfffbf6,
  keyPosition: [ 2.2, 2.8, 3.7 ],
  rim: 0.08,
  rimColor: 0xffffff,
  rimPosition: [ -2.2, 2.1, -2.6 ],
  skyColor: 0xffffff,
  toneMapping: THREE.NeutralToneMapping ?? THREE.LinearToneMapping,
});
const RENDER_FIT_SETTINGS = Object.freeze({
  clothShadowLift: 0.02,
});
const MATERIAL_TUNING = Object.freeze({
  clothEnvIntensity: 0.12,
  clothRoughness: 0.86,
  eyeEnvIntensity: 0.38,
  hairEnvIntensity: 0.18,
  hairRoughness: 0.72,
  skinEnvIntensity: 0.18,
  skinRoughness: 0.68,
});

const MAN03_BONE_ALIASES = Object.freeze({
  Spine1: 'DEF-spine002',
  Spine2: 'DEF-spine004',
  Neck: 'DEF-spine005',
  Head: 'DEF-spine006',
  EyeRigParent: 'MCH-eyes_parent',
  EyeRig: 'eyes',
  EyeLeft: 'master_eyeL',
  EyeRight: 'master_eyeR',
  JawMaster: 'jaw_master',
  Jaw: 'jaw',
  TeethTop: 'DEF-teethT',
  TeethBottom: 'DEF-teethB',
  LeftShoulder: 'ORG-shoulderL',
  LeftArm: 'DEF-upper_armL',
  LeftForeArm: 'DEF-forearmL',
  LeftHand: 'DEF-handL',
  LeftHandThumb1: 'DEF-thumb01L',
  LeftHandThumb2: 'DEF-thumb02L',
  LeftHandThumb3: 'DEF-thumb03L',
  LeftHandIndex1: 'DEF-f_index01L',
  LeftHandIndex2: 'DEF-f_index02L',
  LeftHandIndex3: 'DEF-f_index03L',
  LeftHandMiddle1: 'DEF-f_middle01L',
  LeftHandMiddle2: 'DEF-f_middle02L',
  LeftHandMiddle3: 'DEF-f_middle03L',
  LeftHandRing1: 'DEF-f_ring01L',
  LeftHandRing2: 'DEF-f_ring02L',
  LeftHandRing3: 'DEF-f_ring03L',
  LeftHandPinky1: 'DEF-f_pinky01L',
  LeftHandPinky2: 'DEF-f_pinky02L',
  LeftHandPinky3: 'DEF-f_pinky03L',
  RightShoulder: 'ORG-shoulderR',
  RightArm: 'DEF-upper_armR',
  RightForeArm: 'DEF-forearmR',
  RightHand: 'DEF-handR',
  RightHandThumb1: 'DEF-thumb01R',
  RightHandThumb2: 'DEF-thumb02R',
  RightHandThumb3: 'DEF-thumb03R',
  RightHandIndex1: 'DEF-f_index01R',
  RightHandIndex2: 'DEF-f_index02R',
  RightHandIndex3: 'DEF-f_index03R',
  RightHandMiddle1: 'DEF-f_middle01R',
  RightHandMiddle2: 'DEF-f_middle02R',
  RightHandMiddle3: 'DEF-f_middle03R',
  RightHandRing1: 'DEF-f_ring01R',
  RightHandRing2: 'DEF-f_ring02R',
  RightHandRing3: 'DEF-f_ring03R',
  RightHandPinky1: 'DEF-f_pinky01R',
  RightHandPinky2: 'DEF-f_pinky02R',
  RightHandPinky3: 'DEF-f_pinky03R',
});

const MAN03_MORPH_ALIASES = Object.freeze({
  browInnerUp: 'A01_Brow_Inner_Up',
  browDownLeft: 'A02_Brow_Down_Left',
  browDownRight: 'A03_Brow_Down_Right',
  browOuterUpLeft: 'A04_Brow_Outer_Up_Left',
  browOuterUpRight: 'A05_Brow_Outer_Up_Right',
  eyeBlinkLeft: 'A14_Eye_Blink_Left',
  eyeBlinkRight: 'A15_Eye_Blink_Right',
  eyeSquintLeft: 'A16_Eye_Squint_Left',
  eyeSquintRight: 'A17_Eye_Squint_Right',
  eyeWideLeft: 'A18_Eye_Wide_Left',
  eyeWideRight: 'A19_Eye_Wide_Right',
  jawOpen: 'A25_Jaw_Open',
  jawForward: 'A26_Jaw_Forward',
  jawLeft: 'A27_Jaw_Left',
  jawRight: 'A28_Jaw_Right',
  mouthFunnel: 'A29_Mouth_Funnel',
  mouthPucker: 'A30_Mouth_Pucker',
  mouthLeft: 'A31_Mouth_Left',
  mouthRight: 'A32_Mouth_Right',
  mouthRollUpper: 'A33_Mouth_Roll_Upper',
  mouthRollLower: 'A34_Mouth_Roll_Lower',
  mouthClose: 'A37_Mouth_Close',
  mouthSmileLeft: 'A38_Mouth_Smile_Left',
  mouthSmileRight: 'A39_Mouth_Smile_Right',
  mouthFrownLeft: 'A40_Mouth_Frown_Left',
  mouthFrownRight: 'A41_Mouth_Frown_Right',
  mouthUpperUpLeft: 'A44_Mouth_Upper_Up_Left',
  mouthUpperUpRight: 'A45_Mouth_Upper_Up_Right',
  mouthLowerDownLeft: 'A46_Mouth_Lower_Down_Left',
  mouthLowerDownRight: 'A47_Mouth_Lower_Down_Right',
  mouthPressLeft: 'A48_Mouth_Press_Left',
  mouthPressRight: 'A49_Mouth_Press_Right',
  mouthStretchLeft: 'A50_Mouth_Stretch_Left',
  mouthStretchRight: 'A51_Mouth_Stretch_Right',
  mouthOpen: 'Mouth_Open',
});

const createMorphValues = (): Record<string, number> => ({
  browDownLeft: 0,
  browDownRight: 0,
  browInnerUp: 0,
  browOuterUpLeft: 0,
  browOuterUpRight: 0,
  eyeBlinkLeft: 0,
  eyeBlinkRight: 0,
  eyeSquintLeft: 0,
  eyeSquintRight: 0,
  eyeWideLeft: 0,
  eyeWideRight: 0,
  jawForward: 0,
  jawLeft: 0,
  jawOpen: 0,
  jawRight: 0,
  mouthClose: 0,
  mouthFrownLeft: 0,
  mouthFrownRight: 0,
  mouthFunnel: 0,
  mouthLeft: 0,
  mouthLowerDownLeft: 0,
  mouthLowerDownRight: 0,
  mouthOpen: 0,
  mouthPressLeft: 0,
  mouthPressRight: 0,
  mouthPucker: 0,
  mouthRight: 0,
  mouthRollLower: 0,
  mouthRollUpper: 0,
  mouthSmileLeft: 0,
  mouthSmileRight: 0,
  mouthStretchLeft: 0,
  mouthStretchRight: 0,
  mouthUpperUpLeft: 0,
  mouthUpperUpRight: 0,
});

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

  if (name.includes('eye') || name.includes('cornea')) {
    return 'eye';
  }
  if (
    name.includes('teeth') ||
    name.includes('tongue') ||
    name.includes('nail') ||
    name.includes('eyelash')
  ) {
    return 'detail';
  }
  if (name.includes('skin') || name.includes('body') || name.includes('arm') || name.includes('leg')) {
    return 'skin';
  }
  if (name.includes('hair')) {
    return 'hair';
  }
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
  ) {
    return 'cloth';
  }

  return 'avatar';
};

const suppressUnmappedEmissive = (material: TunableMaterial) => {
  if (!material.emissive || material.emissiveMap) {
    return;
  }

  const emissiveStrength = Math.max(material.emissive.r, material.emissive.g, material.emissive.b);

  if (emissiveStrength < 0.5) {
    return;
  }

  material.emissive.setRGB(0, 0, 0);
  material.emissiveIntensity = 0;
};

const applyViewerMaterialSettings = (mesh: THREE.Mesh) => {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  materials.filter(Boolean).forEach((material) => {
    const tunableMaterial = material as TunableMaterial;
    const kind = materialKind(tunableMaterial, mesh);

    suppressUnmappedEmissive(tunableMaterial);

    if (kind === 'cloth') {
      tunableMaterial.roughness = MATERIAL_TUNING.clothRoughness;
      tunableMaterial.envMapIntensity = MATERIAL_TUNING.clothEnvIntensity;
      if (tunableMaterial.emissive) {
        tunableMaterial.emissive.setRGB(
          RENDER_FIT_SETTINGS.clothShadowLift,
          RENDER_FIT_SETTINGS.clothShadowLift,
          RENDER_FIT_SETTINGS.clothShadowLift,
        );
        tunableMaterial.emissiveIntensity = 1;
      }
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
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    if (disposeGeometry) {
      child.geometry.dispose();
    }
    disposeMaterial(child.material);
  });
};

const setRendererSize = (
  container: HTMLDivElement,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
) => {
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
};

const hasReliableHandBasis = (handPoints: readonly number[], minConfidence = 0.05) => (
  [0, 5, 9, 13].every((index) => getKeypoint3DConfidence(handPoints, index) >= minConfidence)
);

const createThreeRuntime = (container: HTMLDivElement, onReady?: () => void): RendererRuntime => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  const controls = new OrbitControls(camera, renderer.domElement);
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
  let sequenceFrames: readonly ViewerFrame[] = [];
  let sequenceSegments: readonly ViewerSegment[] = [];
  let lastSequenceFrames: readonly ViewerFrame[] | undefined;
  let lastSequenceSegments: readonly ViewerSegment[] | undefined;
  const faceCalibrationCache = new Map<string, unknown>();

  pmremGenerator.dispose();
  camera.position.set(0, 1.42, 2.28);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = LIGHTING_SETUP.toneMapping;
  renderer.toneMappingExposure = LIGHTING_SETUP.exposure;
  scene.environment = roomEnvironmentTexture;
  container.appendChild(renderer.domElement);
  setRendererSize(container, camera, renderer);

  controls.target.set(0, 1.42, 0);
  controls.enableDamping = true;
  controls.enablePan = false;

  const ambientLight = new THREE.HemisphereLight(
    LIGHTING_SETUP.skyColor,
    LIGHTING_SETUP.groundColor,
    LIGHTING_SETUP.ambient,
  );
  const keyLight = new THREE.DirectionalLight(LIGHTING_SETUP.keyColor, LIGHTING_SETUP.key);
  keyLight.position.set(
    LIGHTING_SETUP.keyPosition[0],
    LIGHTING_SETUP.keyPosition[1],
    LIGHTING_SETUP.keyPosition[2],
  );
  const fillLight = new THREE.DirectionalLight(LIGHTING_SETUP.fillColor, LIGHTING_SETUP.fill);
  fillLight.position.set(
    LIGHTING_SETUP.fillPosition[0],
    LIGHTING_SETUP.fillPosition[1],
    LIGHTING_SETUP.fillPosition[2],
  );
  const rimLight = new THREE.DirectionalLight(LIGHTING_SETUP.rimColor, LIGHTING_SETUP.rim);
  rimLight.position.set(
    LIGHTING_SETUP.rimPosition[0],
    LIGHTING_SETUP.rimPosition[1],
    LIGHTING_SETUP.rimPosition[2],
  );
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

  const updateSequenceContext = (
    frames?: readonly ViewerFrame[],
    segments?: readonly ViewerSegment[],
  ) => {
    if (lastSequenceFrames !== frames || lastSequenceSegments !== segments) {
      faceCalibrationCache.clear();
    }

    lastSequenceFrames = frames;
    lastSequenceSegments = segments;
    sequenceFrames = frames ?? [];
    sequenceSegments = segments ?? [];
  };

  const segmentForFrame = (frameIndex: number) => (
    sequenceSegments.find((segment) =>
      frameIndex >= segment.start_frame && frameIndex <= segment.end_frame,
    ) ?? null
  );

  const baselineFrameIndexForFrame = (frameIndex: number) => {
    const segment = segmentForFrame(frameIndex);

    if (!segment) {
      return 0;
    }

    return segment.is_transition
      ? Math.max(0, segment.start_frame - 1)
      : segment.start_frame;
  };

  const sourceDatasetForSegment = (segment: ViewerSegment | null) => (
    String(segment?.source_clip?.dataset ?? '')
  );

  const usesSentenceFaceStabilization = (segment: ViewerSegment | null) => {
    const dataset = sourceDatasetForSegment(segment);
    return dataset.includes('real_sen') || dataset.includes('raw_out_sentence');
  };

  const faceCalibrationForFrame = (frameIndex: number) => {
    const segment = segmentForFrame(frameIndex);

    if (!segment || segment.is_transition) {
      return null;
    }

    const key = `${segment.start_frame}:${segment.end_frame}:mouth3`;
    if (faceCalibrationCache.has(key)) {
      return faceCalibrationCache.get(key) ?? null;
    }

    const sampleEnd = Math.min(segment.end_frame + 1, segment.start_frame + 3);
    const sampleFrames = sequenceFrames.slice(segment.start_frame, sampleEnd);
    const calibration = buildSequenceFaceCalibrationFromFrames(sampleFrames);
    const mouthCalibration = calibration
      ? {
        head: calibration.head,
        mouth: calibration.mouth,
      }
      : null;

    faceCalibrationCache.set(key, mouthCalibration);
    return mouthCalibration;
  };

  const stabilizeSentenceFaceMorphs = (
    morphs: Record<string, number>,
    segment: ViewerSegment | null,
  ) => {
    if (!usesSentenceFaceStabilization(segment)) {
      return morphs;
    }

    const next = { ...morphs };
    const expressiveMouth = Math.max(
      next.mouthPucker ?? 0,
      next.mouthFunnel ?? 0,
      next.mouthClose ?? 0,
      next.mouthSmileLeft ?? 0,
      next.mouthSmileRight ?? 0,
      next.mouthFrownLeft ?? 0,
      next.mouthFrownRight ?? 0,
      next.mouthStretchLeft ?? 0,
      next.mouthStretchRight ?? 0,
    );
    const neutralMouthGate = 1 - remapClamped(expressiveMouth, 0.1, 0.28);
    const capWithGate = (name: string, cap: number) => {
      const value = next[name] ?? 0;
      next[name] = THREE.MathUtils.lerp(value, Math.min(value, cap), neutralMouthGate);
    };

    capWithGate('mouthOpen', 0.12);
    capWithGate('jawOpen', 0.035);
    capWithGate('mouthLowerDownLeft', 0.035);
    capWithGate('mouthLowerDownRight', 0.035);
    const eyeContained = containSentenceEyeMorphs(next);
    next.eyeBlinkLeft = eyeContained.eyeBlinkLeft;
    next.eyeBlinkRight = eyeContained.eyeBlinkRight;
    next.eyeSquintLeft = eyeContained.eyeSquintLeft;
    next.eyeSquintRight = eyeContained.eyeSquintRight;
    next.eyeWideLeft = eyeContained.eyeWideLeft;
    next.eyeWideRight = eyeContained.eyeWideRight;
    next.browInnerUp = Math.min(next.browInnerUp ?? 0, 0.04);
    next.browOuterUpLeft = Math.min(next.browOuterUpLeft ?? 0, 0.04);
    next.browOuterUpRight = Math.min(next.browOuterUpRight ?? 0, 0.04);

    return next;
  };

  const applyRigidBoneHeadFollow = (
    name: string,
    options: RigidBoneHeadFollowOptions = {},
  ) => {
    const headBone = avatarState.bones.get('Head');
    const bone = avatarState.bones.get(name);
    const bindHeadPosition = avatarState.bindWorldPositions?.get('Head');
    const bindHeadQuaternion = avatarState.bindWorldQuaternions?.get('Head');
    const bindBonePosition = avatarState.bindWorldPositions?.get(name);
    const bindBoneQuaternion = avatarState.bindWorldQuaternions?.get(name);
    const bindBoneLocalPosition = avatarState.bindPositions.get(name);
    const smoothing = options.smoothing ?? 1;

    if (
      !headBone ||
      !bone ||
      !bindHeadPosition ||
      !bindHeadQuaternion ||
      !bindBonePosition ||
      !bindBoneQuaternion ||
      !bindBoneLocalPosition ||
      !bone.parent
    ) {
      return;
    }

    scene.updateMatrixWorld(true);
    const currentHeadPosition = headBone.getWorldPosition(new THREE.Vector3());
    const currentHeadQuaternion = headBone.getWorldQuaternion(new THREE.Quaternion());
    const headDeltaQuaternion = currentHeadQuaternion
      .clone()
      .multiply(bindHeadQuaternion.clone().invert());
    const extraHeadLocalOffset = options.extraHeadLocalOffset ?? new THREE.Vector3();
    const extraWorldOffset = extraHeadLocalOffset.clone().applyQuaternion(currentHeadQuaternion);
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
    const maxLocalOffset = options.maxLocalOffset;

    if (maxLocalOffset) {
      positionOffset.set(
        THREE.MathUtils.clamp(positionOffset.x, -maxLocalOffset.x, maxLocalOffset.x),
        THREE.MathUtils.clamp(positionOffset.y, -maxLocalOffset.y, maxLocalOffset.y),
        THREE.MathUtils.clamp(positionOffset.z, -maxLocalOffset.z, maxLocalOffset.z),
      );
    }

    const parentWorldQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const targetLocalQuaternion = parentWorldQuaternion
      .invert()
      .multiply(targetWorldQuaternion);

    setBonePositionOffset(name, positionOffset, smoothing);
    applyBoneQuaternion(name, targetLocalQuaternion, smoothing);
  };

  const applyJawAttachmentFollow = (morphs: Record<string, number>, smoothing = 1) => {
    const jawOpen = THREE.MathUtils.clamp(
      Math.max(
        Number(morphs.jawOpen) || 0,
        (Number(morphs.mouthOpen) || 0) * 0.55,
      ),
      0,
      1,
    );
    const jawForward = THREE.MathUtils.clamp(Number(morphs.jawForward) || 0, 0, 1);
    const jawLateral = THREE.MathUtils.clamp(
      (Number(morphs.jawRight) || 0) - (Number(morphs.jawLeft) || 0),
      -1,
      1,
    );
    const jawOffset = new THREE.Vector3(
      jawLateral * 0.0025,
      -jawOpen * 0.006,
      jawForward * 0.003,
    );
    const lowerTeethOffset = new THREE.Vector3(
      jawLateral * 0.002,
      -jawOpen * 0.022,
      jawForward * 0.004,
    );
    const lowerJawOffset = new THREE.Vector3(
      jawLateral * 0.0016,
      -jawOpen * 0.01,
      jawForward * 0.002,
    );
    const jawRotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-jawOpen * 0.18, 0, jawLateral * 0.04),
    );

    applyRigidBoneHeadFollow('JawMaster', {
      extraHeadLocalOffset: jawOffset,
      extraLocalRotation: jawRotation,
      smoothing,
    });
    applyRigidBoneHeadFollow('Jaw', {
      extraHeadLocalOffset: lowerJawOffset,
      extraLocalRotation: jawRotation,
      smoothing,
    });
    applyRigidBoneHeadFollow('TeethTop', { smoothing });
    applyRigidBoneHeadFollow('TeethBottom', {
      extraHeadLocalOffset: lowerTeethOffset,
      extraLocalRotation: jawRotation,
      smoothing,
    });
  };

  const applyRigidFaceAttachments = (
    morphs: Record<string, number>,
    options: RigidFaceAttachmentOptions = {},
  ) => {
    const eyeOptions = {
      ...EYE_ATTACHMENT_OPTIONS,
      ...(options.eye ?? {}),
    };

    applyRigidBoneHeadFollow('EyeLeft', eyeOptions);
    applyRigidBoneHeadFollow('EyeRight', eyeOptions);
    applyJawAttachmentFollow(morphs, options.jawSmoothing ?? 1);
  };

  const getBindParentDirection = (boneName: string, childName: string) => {
    const bone = avatarState.bones.get(boneName);
    const bindBonePosition = avatarState.bindWorldPositions?.get(boneName);
    const bindChildPosition = avatarState.bindWorldPositions?.get(childName);

    if (!bone || !bindBonePosition || !bindChildPosition) {
      return null;
    }

    const bindWorldDirection = bindChildPosition.clone().sub(bindBonePosition);

    if (bindWorldDirection.lengthSq() < 1e-8) {
      return null;
    }

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

    if (!bindBonePosition || !bindChildPosition) {
      return null;
    }

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

    if (!avatarLeftShoulder || !avatarRightShoulder) {
      return 1;
    }

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
    targetWeight = FIXED_SHOULDER_ARM_TARGET_WEIGHT,
  ) => {
    const keypointDirection = pointDirection(shoulderPoint, elbowPoint);
    const bindDirection = getBindWorldDirection(armBoneName, forearmBoneName);

    if (!bindDirection) {
      return keypointDirection;
    }

    return blendDirections(bindDirection, keypointDirection, targetWeight);
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
  ) => {
    if (!ikDirection || weight <= 0) {
      return fkDirection;
    }

    return blendDirections(fkDirection, ikDirection, THREE.MathUtils.clamp(weight, 0, 1));
  };

  const limitedBindRelativeDirection = (
    boneName: string,
    childName: string,
    targetDirectionWorld: THREE.Vector3,
    targetWeight: number,
    maxAngle: number,
  ) => {
    const bindDirection = getBindWorldDirection(boneName, childName);

    if (!bindDirection) {
      return targetDirectionWorld;
    }

    const weightedDirection = blendDirections(bindDirection, targetDirectionWorld, targetWeight);
    const angle = bindDirection.angleTo(weightedDirection);

    if (!Number.isFinite(angle) || angle <= maxAngle) {
      return weightedDirection;
    }

    return blendDirections(bindDirection, weightedDirection, maxAngle / angle);
  };

  const directionWithBaselineDelta = (
    boneName: string,
    childName: string,
    currentDirection: THREE.Vector3,
    baselineDirection: THREE.Vector3,
  ) => {
    const bindDirection = getBindWorldDirection(boneName, childName);

    if (!bindDirection) {
      return currentDirection;
    }

    const baseline = baselineDirection.clone().normalize();
    const current = currentDirection.clone().normalize();

    if (baseline.lengthSq() < 1e-8 || current.lengthSq() < 1e-8) {
      return bindDirection;
    }

    const delta = new THREE.Quaternion().setFromUnitVectors(baseline, current);
    return bindDirection.clone().applyQuaternion(delta).normalize();
  };

  const computeRelativeTorsoPoseTargets = (
    frameIndex: number,
    currentTorsoMotion: ReturnType<typeof computeSharedTorsoMotion>,
    motionSettings: (typeof MOTION_MODE_SETTINGS)[keyof typeof MOTION_MODE_SETTINGS],
  ) => {
    if (!motionSettings.relativeTorsoPose) {
      return {
        baselineFrameIndex: null as number | null,
        leftShoulderDirection: currentTorsoMotion.leftShoulderDirection,
        rightShoulderDirection: currentTorsoMotion.rightShoulderDirection,
        spine1Direction: currentTorsoMotion.spine1Direction,
        spine2Direction: currentTorsoMotion.spine2Direction,
      };
    }

    const baselineFrameIndex = baselineFrameIndexForFrame(frameIndex);
    const baselinePose = sequenceFrames[baselineFrameIndex]?.people?.pose_keypoints_3d;

    if (!baselinePose) {
      return {
        baselineFrameIndex: null as number | null,
        leftShoulderDirection: currentTorsoMotion.leftShoulderDirection,
        rightShoulderDirection: currentTorsoMotion.rightShoulderDirection,
        spine1Direction: currentTorsoMotion.spine1Direction,
        spine2Direction: currentTorsoMotion.spine2Direction,
      };
    }

    const baselineTorsoMotion = computeSharedTorsoMotion(baselinePose, {
      forwardTiltScale: motionSettings.torsoForwardTiltScale,
      sideTiltScale: motionSettings.torsoSideTiltScale,
    });

    return {
      baselineFrameIndex,
      leftShoulderDirection: directionWithBaselineDelta(
        'LeftShoulder',
        'LeftArm',
        currentTorsoMotion.leftShoulderDirection,
        baselineTorsoMotion.leftShoulderDirection,
      ),
      rightShoulderDirection: directionWithBaselineDelta(
        'RightShoulder',
        'RightArm',
        currentTorsoMotion.rightShoulderDirection,
        baselineTorsoMotion.rightShoulderDirection,
      ),
      spine1Direction: directionWithBaselineDelta(
        'Spine1',
        'Spine2',
        currentTorsoMotion.spine1Direction,
        baselineTorsoMotion.spine1Direction,
      ),
      spine2Direction: directionWithBaselineDelta(
        'Spine2',
        'Neck',
        currentTorsoMotion.spine2Direction,
        baselineTorsoMotion.spine2Direction,
      ),
    };
  };

  const averageDatasetKeypoints = (
    flatArray: readonly number[],
    indices: readonly number[],
    minConfidence = 0.05,
  ) => {
    const points = indices
      .filter((index) => getKeypoint3DConfidence(flatArray, index) >= minConfidence)
      .map((index) => getKeypoint3D(flatArray, index));

    if (points.length === 0) {
      return null;
    }

    return points
      .reduce((sum, point) => sum.add(point), new THREE.Vector3())
      .multiplyScalar(1 / points.length);
  };

  const localTorsoPoint = (
    point: THREE.Vector3,
    shoulderCenter: THREE.Vector3,
    torsoBasis: ReturnType<typeof computeSharedTorsoMotion>['torsoBasis'],
  ) => {
    const forward = (torsoBasis.horizontalForward ?? torsoBasis.forward).clone().normalize();
    const side = torsoBasis.side.clone().normalize();
    const up = torsoBasis.up.clone().normalize();
    const world = datasetToWorld(point.clone().sub(shoulderCenter));

    return {
      forward: world.dot(forward),
      side: world.dot(side),
      up: world.dot(up),
    };
  };

  const datasetDeltaFromTorsoLocal = (
    delta: { forward?: number; side?: number; up?: number },
    torsoBasis: ReturnType<typeof computeSharedTorsoMotion>['torsoBasis'],
  ) => {
    const forward = (torsoBasis.horizontalForward ?? torsoBasis.forward).clone().normalize();
    const side = torsoBasis.side.clone().normalize();
    const up = torsoBasis.up.clone().normalize();
    const worldDelta = forward
      .multiplyScalar(delta.forward ?? 0)
      .add(side.multiplyScalar(delta.side ?? 0))
      .add(up.multiplyScalar(delta.up ?? 0));

    return new THREE.Vector3(worldDelta.x, -worldDelta.y, -worldDelta.z);
  };

  const computeFaceRelativeArmCorrection = (
    armPoints: { elbow: THREE.Vector3; wrist: THREE.Vector3 },
    options: {
      face: readonly number[];
      hand: readonly number[];
      motionSettings: (typeof MOTION_MODE_SETTINGS)[keyof typeof MOTION_MODE_SETTINGS];
      pose: readonly number[];
      proximity: { strength: number };
      torsoBasis: ReturnType<typeof computeSharedTorsoMotion>['torsoBasis'];
    },
  ) => {
    const settings = options.motionSettings;

    if (!settings.faceRelativeHandCorrection) {
      return { arm: armPoints };
    }

    const leftShoulder = getKeypoint3D(options.pose, 5);
    const rightShoulder = getKeypoint3D(options.pose, 2);
    const shoulderWidth = leftShoulder.distanceTo(rightShoulder);

    if (!Number.isFinite(shoulderWidth) || shoulderWidth <= 1e-5) {
      return { arm: armPoints };
    }

    const shoulderCenter = leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5);
    const faceAnchor = averageDatasetKeypoints(
      options.face,
      [27, 28, 29, 30, 31, 33, 36, 39, 42, 45, 48, 54],
    );

    if (!faceAnchor) {
      return { arm: armPoints };
    }

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
    const forwardScore = 1 - remapClamped(
      Math.abs(forwardOffset),
      shoulderWidth * 0.08,
      shoulderWidth * 0.72,
    );
    const planarStrength = Math.min(sideScore, upScore) * forwardScore;
    const strength = Math.max(options.proximity.strength, planarStrength * 0.75);

    if (strength < 0.12) {
      return { arm: armPoints };
    }

    const sideLimit = shoulderWidth * settings.faceRelativeHandMaxSideOffset;
    const upLimit = shoulderWidth * settings.faceRelativeHandMaxUpOffset;
    const targetSideOffset = THREE.MathUtils.clamp(sideOffset, -sideLimit, sideLimit);
    const targetUpOffset = THREE.MathUtils.clamp(upOffset, -upLimit, upLimit);
    const correctionWeight = THREE.MathUtils.clamp(
      strength * settings.faceRelativeHandCorrectionStrength,
      0,
      1,
    );
    const wristDelta = datasetDeltaFromTorsoLocal({
      forward: 0,
      side: (targetSideOffset - sideOffset) * correctionWeight,
      up: (targetUpOffset - upOffset) * correctionWeight,
    }, options.torsoBasis);

    if (wristDelta.lengthSq() < 1e-10) {
      return { arm: armPoints };
    }

    return {
      arm: {
        elbow: armPoints.elbow.clone().add(
          wristDelta.clone().multiplyScalar(settings.faceRelativeHandElbowFollow),
        ),
        wrist: armPoints.wrist.clone().add(wristDelta),
      },
    };
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

    if (!bone || !child || !bindRotation || !bone.parent) {
      return;
    }

    const bindParentDirection = getBindParentDirection(boneName, childName) ??
      child.position.clone().normalize().applyQuaternion(bindRotation);
    const parentWorldQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const targetParentDirection = targetDirectionWorld
      .clone()
      .applyQuaternion(parentWorldQuaternion.invert())
      .normalize();
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

    if (!bone || !bindRotation || !bone.parent) {
      return;
    }

    const parentWorldQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const targetParentDirection = targetDirectionWorld
      .clone()
      .applyQuaternion(parentWorldQuaternion.invert())
      .normalize();
    const offset = new THREE.Quaternion().setFromUnitVectors(
      bindParentDirection.clone().normalize(),
      targetParentDirection,
    );

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

  const resizeObserver = new ResizeObserver(() => {
    setRendererSize(container, camera, renderer);
  });
  resizeObserver.observe(container);

  const renderLoop = () => {
    if (disposed) {
      return;
    }

    controls.update();
    renderer.render(scene, camera);
    animationFrame = window.requestAnimationFrame(renderLoop);
  };

  let readyFrameRequest: number | null = null;
  // 느린 환경(Jetson SwiftShader CPU 렌더 + RAM 부족)에서는 GLTF 로드 후 frame 0가
  // 실제 화면에 paint될 때까지 PC보다 훨씬 오래 걸린다. rAF callback은 디바이스 부하에
  // 비례해 지연되므로, rAF 카운트를 늘리면 PC에선 거의 인지 안 되고 느린 환경에선
  // 자연스럽게 더 긴 시간으로 보정된다.
  const READY_RAF_COUNT = 8;
  const notifyReadyAfterPaint = () => {
    let remaining = READY_RAF_COUNT;
    const waitNextFrame = () => {
      if (disposed) {
        readyFrameRequest = null;
        return;
      }
      remaining -= 1;
      if (remaining <= 0) {
        readyFrameRequest = null;
        onReady?.();
        return;
      }
      readyFrameRequest = window.requestAnimationFrame(waitNextFrame);
    };
    readyFrameRequest = window.requestAnimationFrame(waitNextFrame);
  };

  const applyFrameData = (
    frame: ViewerFrame,
    frameIndex: number,
    frames?: readonly ViewerFrame[],
    segments?: readonly ViewerSegment[],
  ) => {
    if (!modelLoaded) {
      pendingFrame = { frame, frameIndex, frames, segments };
      return;
    }

    updateSequenceContext(frames, segments);

    const pose = frame.people.pose_keypoints_3d;
    const leftHand = frame.people.hand_left_keypoints_3d;
    const rightHand = frame.people.hand_right_keypoints_3d;
    const face = frame.people.face_keypoints_3d;
    const shouldResetContinuity = lastFrameIndex !== null && Math.abs(frameIndex - lastFrameIndex) > 1;
    const preserveCurrentPose = !shouldResetContinuity && lastFrameIndex !== null;
    const motionMode = DEFAULT_MOTION_MODE;
    const motionSettings = MOTION_MODE_SETTINGS[motionMode];
    const boneSmoothing = preserveCurrentPose ? motionSettings.playbackBoneSmoothing : 1;
    const morphSmoothing = preserveCurrentPose ? motionSettings.playbackMorphSmoothing : 1;
    const segment = segmentForFrame(frameIndex);

    if (shouldResetContinuity) {
      resetTorsoCorrectionState();
    }
    lastFrameIndex = frameIndex;

    if (!preserveCurrentPose) {
      resetPose();
      resetTorsoCorrectionState();
    }
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
    const correctedLeftArm = computeCorrectedArmPoints(
      frame,
      'left',
      leftElbow,
      leftCanonicalWrist,
      { correctionMode: null, correctionProfile: false, sequence: null },
    );
    const correctedRightArm = computeCorrectedArmPoints(
      frame,
      'right',
      rightElbow,
      rightCanonicalWrist,
      { correctionMode: null, correctionProfile: false, sequence: null },
    );
    const torsoMotion = computeSharedTorsoMotion(pose, {
      forwardTiltScale: motionSettings.torsoForwardTiltScale,
      sideTiltScale: motionSettings.torsoSideTiltScale,
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
    if (!motionSettings.torsoCollision) {
      avatarState.torsoCollision.left.active = false;
      avatarState.torsoCollision.left.pushWorld.set(0, 0, 0);
      avatarState.torsoCollision.right.active = false;
      avatarState.torsoCollision.right.pushWorld.set(0, 0, 0);
    }
    const leftCollisionArm = motionSettings.torsoCollision
      ? applyTorsoCollisionCorrection(pose, correctedLeftArm, {
        ...TORSO_COLLISION_OPTIONS,
        handPoints: leftHand,
        smoothing: preserveCurrentPose ? TORSO_COLLISION_OPTIONS.smoothing : 1,
        state: avatarState.torsoCollision.left,
        torsoBasis: torsoMotion.torsoBasis,
      })
      : correctedLeftArm;
    const rightCollisionArm = motionSettings.torsoCollision
      ? applyTorsoCollisionCorrection(pose, correctedRightArm, {
        ...TORSO_COLLISION_OPTIONS,
        handPoints: rightHand,
        smoothing: preserveCurrentPose ? TORSO_COLLISION_OPTIONS.smoothing : 1,
        state: avatarState.torsoCollision.right,
        torsoBasis: torsoMotion.torsoBasis,
      })
      : correctedRightArm;
    const leftArm = computeFaceRelativeArmCorrection(leftCollisionArm, {
      face,
      hand: leftHand,
      motionSettings,
      pose,
      proximity: leftFaceProximity,
      torsoBasis: torsoMotion.torsoBasis,
    }).arm;
    const rightArm = computeFaceRelativeArmCorrection(rightCollisionArm, {
      face,
      hand: rightHand,
      motionSettings,
      pose,
      proximity: rightFaceProximity,
      torsoBasis: torsoMotion.torsoBasis,
    }).arm;
    const headFaceResult = computeHeadFaceStrategy(frame, {
      blinkSync: { mode: 'average' },
      faceCalibration: faceCalibrationForFrame(frameIndex) as ReturnType<
        typeof buildSequenceFaceCalibrationFromFrames
      > | null,
      mode: DEFAULT_VIEWER_FACE_MODE,
    });
    const stabilizedFaceMorphs = stabilizeSentenceFaceMorphs(headFaceResult.morphs, segment);
    const clampedFaceMorphs = clampFaceMorphs(stabilizedFaceMorphs);
    const safeFaceMorphs = preserveCurrentPose
      ? stabilizeEyeMorphs(clampedFaceMorphs, avatarState.morphValues)
      : clampedFaceMorphs;
    const {
      eyeBlinkLeft,
      eyeBlinkRight,
      eyeSquintLeft,
      eyeSquintRight,
      ...baseFaceMorphs
    } = safeFaceMorphs;
    const stabilizedEyeMorphs = {
      eyeBlinkLeft,
      eyeBlinkRight,
      eyeSquintLeft,
      eyeSquintRight,
    };
    const torsoSmoothing = preserveCurrentPose && !motionSettings.torsoPose
      ? Math.min(boneSmoothing, 0.08)
      : boneSmoothing;
    const torsoPoseTargets = computeRelativeTorsoPoseTargets(frameIndex, torsoMotion, motionSettings);

    if (motionSettings.torsoPose) {
      const spine1Direction = limitedBindRelativeDirection(
        'Spine1',
        'Spine2',
        torsoPoseTargets.spine1Direction,
        motionSettings.torsoTargetWeight,
        motionSettings.torsoLimits.Spine1,
      );
      const spine2Direction = limitedBindRelativeDirection(
        'Spine2',
        'Neck',
        torsoPoseTargets.spine2Direction,
        motionSettings.torsoTargetWeight,
        motionSettings.torsoLimits.Spine2,
      );

      setBoneTowardDirection('Spine1', 'Spine2', spine1Direction, {
        bindBlend: 0,
        smoothing: torsoSmoothing,
      });
      scene.updateMatrixWorld(true);
      setBoneTowardDirection('Spine2', 'Neck', spine2Direction, {
        bindBlend: 0,
        smoothing: torsoSmoothing,
      });
      scene.updateMatrixWorld(true);
    }

    if (motionSettings.shoulderPose) {
      const leftShoulderDirection = limitedBindRelativeDirection(
        'LeftShoulder',
        'LeftArm',
        torsoPoseTargets.leftShoulderDirection,
        motionSettings.shoulderPoseWeight,
        motionSettings.torsoLimits.LeftShoulder,
      );
      const rightShoulderDirection = limitedBindRelativeDirection(
        'RightShoulder',
        'RightArm',
        torsoPoseTargets.rightShoulderDirection,
        motionSettings.shoulderPoseWeight,
        motionSettings.torsoLimits.RightShoulder,
      );

      setBoneTowardDirection('LeftShoulder', 'LeftArm', leftShoulderDirection, {
        bindBlend: torsoMotion.shoulderBindBlend * 0.25,
        smoothing: torsoSmoothing,
      });
      setBoneTowardDirection('RightShoulder', 'RightArm', rightShoulderDirection, {
        bindBlend: torsoMotion.shoulderBindBlend * 0.25,
        smoothing: torsoSmoothing,
      });
      scene.updateMatrixWorld(true);
    }

    scene.updateMatrixWorld(true);

    applyMorphMap(baseFaceMorphs, morphSmoothing);
    applyMorphMap(stabilizedEyeMorphs, 1);
    applyRigidFaceAttachments(safeFaceMorphs, {
      eye: EYE_ATTACHMENT_OPTIONS,
      jawSmoothing: morphSmoothing,
    });
    scene.updateMatrixWorld(true);

    const leftIkDirections = solveAvatarArmIkDirections('Left', leftShoulder, leftArm.elbow, leftArm.wrist, pose);
    const rightIkDirections = solveAvatarArmIkDirections('Right', rightShoulder, rightArm.elbow, rightArm.wrist, pose);
    const leftIkWeight = Math.max(
      motionSettings.baseIkWeight,
      twoHandContact.strength * motionSettings.twoHandIkWeight,
      leftFaceProximity.strength * motionSettings.faceHandIkWeight,
      avatarState.torsoCollision.left.active ? motionSettings.torsoContactIkWeight : 0,
    );
    const rightIkWeight = Math.max(
      motionSettings.baseIkWeight,
      twoHandContact.strength * motionSettings.twoHandIkWeight,
      rightFaceProximity.strength * motionSettings.faceHandIkWeight,
      avatarState.torsoCollision.right.active ? motionSettings.torsoContactIkWeight : 0,
    );
    const leftShoulderArmTargetWeight = Math.max(
      THREE.MathUtils.lerp(
        motionSettings.shoulderArmTargetWeight,
        motionSettings.contactShoulderArmTargetWeight,
        twoHandContact.strength,
      ),
      THREE.MathUtils.lerp(
        motionSettings.shoulderArmTargetWeight,
        motionSettings.faceHandShoulderArmTargetWeight,
        leftFaceProximity.strength,
      ),
    );
    const rightShoulderArmTargetWeight = Math.max(
      THREE.MathUtils.lerp(
        motionSettings.shoulderArmTargetWeight,
        motionSettings.contactShoulderArmTargetWeight,
        twoHandContact.strength,
      ),
      THREE.MathUtils.lerp(
        motionSettings.shoulderArmTargetWeight,
        motionSettings.faceHandShoulderArmTargetWeight,
        rightFaceProximity.strength,
      ),
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
    const leftForearmDirection = blendIkDirection(
      pointDirection(leftArm.elbow, leftArm.wrist),
      leftIkDirections?.forearmDirection,
      leftIkWeight,
    );
    const rightForearmDirection = blendIkDirection(
      pointDirection(rightArm.elbow, rightArm.wrist),
      rightIkDirections?.forearmDirection,
      rightIkWeight,
    );

    setBoneTowardDirection('LeftArm', 'LeftForeArm', leftUpperDirection, {
      smoothing: boneSmoothing,
    });
    setBoneTowardDirection('RightArm', 'RightForeArm', rightUpperDirection, {
      smoothing: boneSmoothing,
    });
    scene.updateMatrixWorld(true);

    setBoneTowardDirection('LeftForeArm', 'LeftHand', leftForearmDirection, {
      smoothing: boneSmoothing,
    });
    setBoneTowardDirection('RightForeArm', 'RightHand', rightForearmDirection, {
      smoothing: boneSmoothing,
    });
    scene.updateMatrixWorld(true);

    if (hasReliableHandBasis(leftHand)) {
      setHandOrientationFromFrame(
        'Left',
        leftArm.wrist,
        getKeypoint3D(leftHand, 5),
        getKeypoint3D(leftHand, 9),
        getKeypoint3D(leftHand, 13),
        { smoothing: boneSmoothing, weight: motionSettings.handOrientationWeight },
      );
    }
    if (hasReliableHandBasis(rightHand)) {
      setHandOrientationFromFrame(
        'Right',
        rightArm.wrist,
        getKeypoint3D(rightHand, 5),
        getKeypoint3D(rightHand, 9),
        getKeypoint3D(rightHand, 13),
        { smoothing: boneSmoothing, weight: motionSettings.handOrientationWeight },
      );
    }
    scene.updateMatrixWorld(true);

    applyFingerChainsFromFrame('Left', leftHand, { smoothing: boneSmoothing });
    applyFingerChainsFromFrame('Right', rightHand, { smoothing: boneSmoothing });
  };

  void createAvatarModelInstance()
    .then((modelRoot) => {
      if (disposed) {
        disposeObjectTree(modelRoot, { disposeGeometry: false });
        return;
      }

      scene.add(modelRoot);

      modelRoot.traverse((object) => {
        if (object instanceof THREE.Bone) {
          rememberBone(object);
        }

        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.frustumCulled = false;
          avatarState.renderMeshes.push(object);
          applyViewerMaterialSettings(object);
        }

        if (isMorphMesh(object)) {
          rememberMorphMesh(object);
        }
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
        applyFrameData(
          pendingFrame.frame,
          pendingFrame.frameIndex,
          pendingFrame.frames,
          pendingFrame.segments,
        );
        pendingFrame = null;
      }

      notifyReadyAfterPaint();
    })
    .catch((error: unknown) => {
      console.error('Failed to load avatar model.', error);
    });

  animationFrame = window.requestAnimationFrame(renderLoop);

  return {
    applyFrameData,
    dispose: () => {
      disposed = true;
      resizeObserver.disconnect();

      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (readyFrameRequest !== null) {
        window.cancelAnimationFrame(readyFrameRequest);
      }

      controls.dispose();
      disposeObjectTree(scene, { disposeGeometry: false });
      roomEnvironmentTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
};

export const AvatarThreeRenderer = ({
  frame,
  frameIndex,
  frames,
  onReady,
  segments,
}: AvatarThreeRendererProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<RendererRuntime | null>(null);
  const onReadyRef = useRef(onReady);
  const readyRef = useRef(false);

  useEffect(() => {
    onReadyRef.current = onReady;
    if (readyRef.current) {
      onReady?.();
    }
  }, [onReady]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    const runtime = createThreeRuntime(container, () => {
      readyRef.current = true;
      onReadyRef.current?.();
    });
    runtimeRef.current = runtime;

    return () => {
      runtime.dispose();
      runtimeRef.current = null;
      readyRef.current = false;
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.applyFrameData(frame, frameIndex, frames, segments);
  }, [frame, frameIndex, frames, segments]);

  return <div ref={containerRef} className="h-full w-full" />;
};
