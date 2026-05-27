import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  buildSequenceFaceCalibrationFromFrames,
  computeHeadFaceStrategy,
} from './lib/head-face-strategies.js';
import { createRigController } from './viewer/rig-controller.js';
import {
  blendDirections,
  datasetToWorld,
  getKeypoint3D,
  getKeypoint3DConfidence,
  pointDirection,
  remapClamped,
} from './viewer/keypoint-utils.js';
import {
  applyTorsoCollisionCorrection,
  computeCanonicalWristTarget,
  computeCorrectedArmPoints,
  computeSharedTorsoMotion,
  createHandRigAppliers,
  detectFaceHandProximity,
  detectTwoHandContact,
  solveTwoBoneArmIkDirections,
} from './viewer/body-motion.js';
import {
  composeSentenceFromClips,
} from './interpolator/sequence-composer.js';
import {
  loadFavoriteSentences,
  removeFavoriteSentence,
  saveFavoriteSentence,
} from './viewer/sentence-favorites.js';
import {
  clampFaceMorphs,
  containSentenceEyeMorphs,
  stabilizeEyeMorphs,
} from './viewer/face-morph-safety.js';
import {
  normalizeGlossKey,
  normalizeGlossSearch,
} from './viewer/gloss-normalization.js';
import { createTypedWordSubmitGuard } from './viewer/typed-word-submit.js';

const WORD_RENDER_LIMIT = 160;
const DEFAULT_TRANSITION_FRAMES = 12;
const DEFAULT_PLAYBACK_SPEED = '1.5';
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
  neckPitch: THREE.MathUtils.degToRad(2.2),
  neckYaw: THREE.MathUtils.degToRad(3.2),
  neckRoll: THREE.MathUtils.degToRad(2.2),
  headPitch: THREE.MathUtils.degToRad(2.8),
  headYaw: THREE.MathUtils.degToRad(4.2),
  headRoll: THREE.MathUtils.degToRad(2.8),
});
const EYE_ATTACHMENT_OPTIONS = Object.freeze({
  maxLocalOffset: new THREE.Vector3(0.08, 0.08, 0.08),
  smoothing: 1,
});
const TORSO_COLLISION_OPTIONS = Object.freeze({
  elbowRatio: 0.42,
  enterForward: 0.16,
  exitForward: 0.21,
  maxPush: 0.30,
  pushRange: 0.12,
  smoothing: 0.28,
  targetForward: 0.22,
});
const GLOSS_FORWARD_ARM_BOOSTS = Object.freeze({
  반갑다: Object.freeze({
    elbowRatio: 0.78,
    forwardWidth: 0.28,
  }),
});
const GLOSS_FACE_MORPH_ADJUSTMENTS = Object.freeze({
  반갑다: Object.freeze({
    smileFloor: 0.2,
    smileBalance: 0.56,
    frownScale: 0.18,
  }), 
});
const GLOSS_HAND_MOTION_FREEZE_RANGES = Object.freeze({
  '\uD1B5\uC7A5': Object.freeze([
    Object.freeze({
      startFrame: 40,
      endFrame: 58,
      holdFrame: 39,
    }),
  ]),
});
const GLOSS_RIGHT_HAND_MOTION_FREEZE_RANGES = Object.freeze({
  '\uB3C4\uC640\uC8FC\uB2E4': Object.freeze([
    Object.freeze({
      startFrame: 5,
      endFrame: 40,
      holdFrame: 5,
    }),
  ]),
});
const GLOSS_LEFT_THUMB_MOTION_FREEZE_RANGES = Object.freeze({
  '\uB3C4\uC640\uC8FC\uB2E4': Object.freeze([
    Object.freeze({
      startFrame: 5,
      endFrame: 40,
      holdFrame: 5,
    }),
  ]),
});
const THUMB_KEYPOINT_INDICES = Object.freeze([1, 2, 3, 4]);
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
  Spine1: THREE.MathUtils.degToRad(18),
  Spine2: THREE.MathUtils.degToRad(18),
  LeftShoulder: THREE.MathUtils.degToRad(38),
  RightShoulder: THREE.MathUtils.degToRad(38),
});
const FAITHFUL_HEAD_LIMITS = Object.freeze({
  neckPitch: THREE.MathUtils.degToRad(7),
  neckYaw: THREE.MathUtils.degToRad(9),
  neckRoll: THREE.MathUtils.degToRad(7),
  headPitch: THREE.MathUtils.degToRad(9),
  headYaw: THREE.MathUtils.degToRad(12),
  headRoll: THREE.MathUtils.degToRad(9),
});
const MOTION_MODE_SETTINGS = Object.freeze({
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
    playbackTorsoSmoothing: 0.35,
    shoulderArmTargetWeight: FIXED_SHOULDER_ARM_TARGET_WEIGHT,
    shoulderPose: false,
    shoulderPoseWeight: SAFE_TORSO_TARGET_WEIGHT,
    relativeTorsoPose: false,
    torsoCollision: true,
    torsoContactIkWeight: TORSO_CONTACT_IK_WEIGHT,
    torsoForwardTiltScale: TORSO_FORWARD_TILT_SCALE,
    torsoSideTiltDeadzone: 0,
    torsoSideTiltScale: 1.05,
    torsoLimits: SAFE_TORSO_LIMITS,
    torsoPose: ENABLE_TORSO_POSE,
    torsoTargetWeight: SAFE_TORSO_TARGET_WEIGHT,
    twoHandIkWeight: TWO_HAND_IK_WEIGHT,
  }),
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
    playbackTorsoSmoothing: 0.45,
    shoulderArmTargetWeight: 1,
    shoulderPose: true,
    shoulderPoseWeight: 0.22,
    relativeTorsoPose: true,
    torsoCollision: true,
    torsoContactIkWeight: 0.72,
    torsoForwardTiltScale: 0.65,
    torsoSideTiltDeadzone: 0.006,
    torsoSideTiltScale: 0.3,
    torsoLimits: FAITHFUL_TORSO_LIMITS,
    torsoPose: true,
    torsoTargetWeight: 0.58,
    twoHandIkWeight: 1,
  }),
});
const VIEWER_BACKGROUND_COLOR = '#fbf7f5';
const BASE_RENDER_SETTINGS = Object.freeze({
  ambient: 1.45,
  exposure: 0.85,
  fill: 2.0,
  fillColor: 0xdbeafe,
  fillPosition: [-3.5, 2.2, 2.8],
  groundColor: 0x4b5563,
  key: 1.2,
  keyColor: 0xfff4e6,
  keyPosition: [2.5, 3.8, 4.2],
  rim: 0.45,
  rimColor: 0xffffff,
  rimPosition: [-2, 2.6, -3],
  skyColor: 0xffffff,
  toneMapping: THREE.ACESFilmicToneMapping,
});
const LIGHTING_SETUP = Object.freeze({
  ambient: 1.65,
  fillColor: 0xf2f0ee,
  fillPosition: [-3.2, 1.7, 2.5],
  fill: 0.8,
  groundColor: 0xe3d8d2,
  keyColor: 0xfffbf6,
  keyPosition: [2.2, 2.8, 3.7],
  key: 0.62,
  rimColor: 0xffffff,
  rimPosition: [-2.2, 2.1, -2.6],
  rim: 0.08,
  skyColor: 0xffffff,
  toneMapping: THREE.NeutralToneMapping ?? THREE.LinearToneMapping,
});
const DEFAULT_RENDER_FIT_SETTINGS = Object.freeze({
  enabled: true,
  clothShadowLift: 0.02,
  exposure: 0.78,
});
const MATERIAL_TUNING = Object.freeze({
  skinEnvIntensity: 0.18,
  skinRoughness: 0.68,
  clothEnvIntensity: 0.12,
  clothNormalOffset: 0.008,
  clothRoughness: 0.86,
  hairEnvIntensity: 0.18,
  hairRoughness: 0.72,
  eyeEnvIntensity: 0.38,
});
const KEYPOINT_PREVIEW_POSE_EDGES = Object.freeze([
  [1, 2],
  [1, 5],
  [2, 3],
  [3, 4],
  [5, 6],
  [6, 7],
  [1, 8],
  [8, 9],
  [8, 12],
]);
const KEYPOINT_PREVIEW_POSE_POINTS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12]);
const KEYPOINT_PREVIEW_HAND_EDGES = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
]);
const KEYPOINT_PREVIEW_FACE_EDGES = Object.freeze([
  ...Array.from({ length: 16 }, (_, index) => [index, index + 1]),
  ...Array.from({ length: 4 }, (_, index) => [17 + index, 18 + index]),
  ...Array.from({ length: 4 }, (_, index) => [22 + index, 23 + index]),
  ...Array.from({ length: 3 }, (_, index) => [27 + index, 28 + index]),
  [31, 32], [32, 33], [33, 34], [34, 35],
  [36, 37], [37, 38], [38, 39], [39, 40], [40, 41], [41, 36],
  [42, 43], [43, 44], [44, 45], [45, 46], [46, 47], [47, 42],
  ...Array.from({ length: 11 }, (_, index) => [48 + index, 49 + index]),
  [59, 48],
  ...Array.from({ length: 7 }, (_, index) => [60 + index, 61 + index]),
  [67, 60],
]);
const KEYPOINT_PREVIEW_FACE_POINTS = Object.freeze(Array.from({ length: 68 }, (_, index) => index));
const KEYPOINT_PREVIEW_HAND_POINTS = Object.freeze(Array.from({ length: 21 }, (_, index) => index));
const KEYPOINT_PREVIEW_CONFIDENCE = 0.05;
const KEYPOINT_PREVIEW_MIN_WIDTH = 160;
const KEYPOINT_PREVIEW_MIN_HEIGHT = 124;
const KEYPOINT_PREVIEW_MAX_VIEWPORT_RATIO = 0.56;
const DEFAULT_CAMERA_VIEW = Object.freeze({
  distance: 2.28,
  fov: 28,
  height: 1.42,
  targetHeight: 1.42,
});
// GLTFLoader strips reserved dots from node names at runtime.
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
const urlParams = new URLSearchParams(window.location.search);

const elements = {
  canvas: document.querySelector('#viewer-canvas'),
  keypointPreviewPanel: document.querySelector('#keypoint-preview-panel'),
  keypointPreview: document.querySelector('#keypoint-preview'),
  keypointPreviewResize: document.querySelector('#keypoint-preview-resize'),
  referencePanel: document.querySelector('#reference-panel'),
  referenceVideo: document.querySelector('#reference-video'),
  referenceEmpty: document.querySelector('#reference-empty'),
  referenceFrameMeta: document.querySelector('#reference-frame-meta'),
  toggleReferencePanel: document.querySelector('#toggle-reference-panel'),
  modelStatus: document.querySelector('#model-status'),
  frameStatus: document.querySelector('#frame-status'),
  dictionaryStats: document.querySelector('#dictionary-stats'),
  dictionaryVersions: document.querySelector('#dictionary-versions'),
  wordSearch: document.querySelector('#word-search'),
  wordList: document.querySelector('#word-list'),
  selectedWords: document.querySelector('#selected-words'),
  selectedEmpty: document.querySelector('#selected-empty'),
  saveSentence: document.querySelector('#save-sentence'),
  favoriteSentences: document.querySelector('#favorite-sentences'),
  favoritesEmpty: document.querySelector('#favorites-empty'),
  addTypedWord: document.querySelector('#add-typed-word'),
  clearSentence: document.querySelector('#clear-sentence'),
  play: document.querySelector('#play-sentence'),
  stop: document.querySelector('#stop-sentence'),
  resetPose: document.querySelector('#reset-pose'),
  speed: document.querySelector('#playback-speed'),
  transitionFrames: document.querySelector('#transition-frames'),
  useInterpolation: document.querySelector('#use-interpolation'),
  blinkSyncMode: document.querySelector('#blink-sync-mode'),
  blinkSyncThreshold: document.querySelector('#blink-sync-threshold'),
  blinkSyncThresholdValue: document.querySelector('#blink-sync-threshold-value'),
  frameRange: document.querySelector('#frame-range'),
  frameNumber: document.querySelector('#frame-number'),
  cameraDistance: document.querySelector('#camera-distance'),
  cameraDistanceValue: document.querySelector('#camera-distance-value'),
  cameraHeight: document.querySelector('#camera-height'),
  cameraHeightValue: document.querySelector('#camera-height-value'),
  targetHeight: document.querySelector('#target-height'),
  targetHeightValue: document.querySelector('#target-height-value'),
  cameraFov: document.querySelector('#camera-fov'),
  cameraFovValue: document.querySelector('#camera-fov-value'),
  resetCamera: document.querySelector('#reset-camera'),
  renderFitEnabled: document.querySelector('#render-fit-enabled'),
  renderFitExposure: document.querySelector('#render-fit-exposure'),
  renderFitExposureValue: document.querySelector('#render-fit-exposure-value'),
  renderFitClothLift: document.querySelector('#render-fit-cloth-lift'),
  renderFitClothLiftValue: document.querySelector('#render-fit-cloth-lift-value'),
  resetRenderFit: document.querySelector('#reset-render-fit'),
  sequenceMeta: document.querySelector('#sequence-meta'),
  frameDebug: document.querySelector('#frame-debug'),
  copyFrameDebug: document.querySelector('#copy-frame-debug'),
};

const initialWords = String(urlParams.get('words') || '')
  .split(',')
  .map(normalizeGlossKey)
  .filter(Boolean);
const autoplayOnReady = urlParams.get('autoplay') === '1';
const initialTransitionParam = urlParams.get('transition');
const initialTransition = Number(initialTransitionParam);
const initialSpeed = urlParams.get('speed');
const initialFrameParam = Number(urlParams.get('frame'));
const initialCameraView = urlParams.get('cameraView');
const initialReferenceCollapsed = urlParams.get('referencePanel') === 'collapsed';
const initialDictionaryVersion = urlParams.get('wordVersion') || 'current';

elements.transitionFrames.value = String(DEFAULT_TRANSITION_FRAMES);
elements.speed.value = DEFAULT_PLAYBACK_SPEED;

if (initialTransitionParam !== null && Number.isFinite(initialTransition)) {
  elements.transitionFrames.value = String(Math.max(0, Math.floor(initialTransition)));
}

if (initialSpeed && Array.from(elements.speed.options).some((option) => option.value === initialSpeed)) {
  elements.speed.value = initialSpeed;
}

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(
  DEFAULT_CAMERA_VIEW.fov,
  elements.canvas.clientWidth / elements.canvas.clientHeight,
  0.1,
  100,
);
camera.position.set(0, DEFAULT_CAMERA_VIEW.height, DEFAULT_CAMERA_VIEW.distance);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(elements.canvas.clientWidth, elements.canvas.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = LIGHTING_SETUP.toneMapping;
renderer.toneMappingExposure = DEFAULT_RENDER_FIT_SETTINGS.exposure;
renderer.setClearColor(VIEWER_BACKGROUND_COLOR, 0);
elements.canvas.appendChild(renderer.domElement);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
const roomEnvironmentTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = roomEnvironmentTexture;
pmremGenerator.dispose();

const ambientLight = new THREE.HemisphereLight(
  LIGHTING_SETUP.skyColor,
  LIGHTING_SETUP.groundColor,
  LIGHTING_SETUP.ambient,
);
const keyLight = new THREE.DirectionalLight(LIGHTING_SETUP.keyColor, LIGHTING_SETUP.key);
keyLight.position.set(...LIGHTING_SETUP.keyPosition);
const fillLight = new THREE.DirectionalLight(LIGHTING_SETUP.fillColor, LIGHTING_SETUP.fill);
fillLight.position.set(...LIGHTING_SETUP.fillPosition);
const rimLight = new THREE.DirectionalLight(LIGHTING_SETUP.rimColor, LIGHTING_SETUP.rim);
rimLight.position.set(...LIGHTING_SETUP.rimPosition);
scene.add(ambientLight, keyLight, fillLight, rimLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, DEFAULT_CAMERA_VIEW.targetHeight, 0);
controls.enableDamping = true;
controls.update();

const state = {
  dictionaryVersions: [],
  dictionaryVersionId: 'current',
  dictionary: [],
  dictionaryByGloss: new Map(),
  selectedGlosses: [],
  favoriteSentences: [],
  clipCache: new Map(),
  sentence: null,
  currentFrameIndex: 0,
  playbackAnimationFrame: null,
  playbackStartedAt: 0,
  referenceVideoSrc: null,
  referenceVideoTime: null,
  referencePlaybackKey: null,
  faceCalibrationCache: new Map(),
  motionMetrics: null,
  loadedOnce: false,
};

const shouldAcceptTypedWordSubmit = createTypedWordSubmitGuard();

const lookState = {
  renderFit: { ...DEFAULT_RENDER_FIT_SETTINGS },
};
const originalMaterialSettings = new WeakMap();
const clothInflatedGeometries = new WeakSet();
const keypointPreviewResizeState = {
  active: false,
  startX: 0,
  startY: 0,
  startWidth: 0,
  startHeight: 0,
};

const avatarState = {
  loaded: false,
  faceMode: DEFAULT_VIEWER_FACE_MODE,
  currentFrameData: null,
  pendingFrameIndex: 0,
  bones: new Map(),
  boneAliases: MAN03_BONE_ALIASES,
  bindPositions: new Map(),
  bindRotations: new Map(),
  bindWorldPositions: new Map(),
  bindWorldQuaternions: new Map(),
  morphAliases: MAN03_MORPH_ALIASES,
  morphMeshes: [],
  renderMeshes: [],
  supportedMorphNames: new Set(),
  bindMorphValues: {},
  morphValues: {
    mouthOpen: 0,
    eyeBlinkLeft: 0,
    eyeBlinkRight: 0,
    browInnerUp: 0,
    jawOpen: 0,
    mouthPucker: 0,
    mouthFunnel: 0,
    mouthClose: 0,
    mouthPressLeft: 0,
    mouthPressRight: 0,
    mouthRollUpper: 0,
    mouthRollLower: 0,
    browOuterUpLeft: 0,
    browOuterUpRight: 0,
    browDownLeft: 0,
    browDownRight: 0,
    eyeSquintLeft: 0,
    eyeSquintRight: 0,
    eyeWideLeft: 0,
    eyeWideRight: 0,
    mouthSmileLeft: 0,
    mouthSmileRight: 0,
    mouthFrownLeft: 0,
    mouthFrownRight: 0,
    mouthStretchLeft: 0,
    mouthStretchRight: 0,
    mouthLeft: 0,
    mouthRight: 0,
    mouthUpperUpLeft: 0,
    mouthUpperUpRight: 0,
    mouthLowerDownLeft: 0,
    mouthLowerDownRight: 0,
    jawLeft: 0,
    jawRight: 0,
    jawForward: 0,
  },
  torsoCollision: {
    left: { active: false, pushWorld: new THREE.Vector3() },
    right: { active: false, pushWorld: new THREE.Vector3() },
  },
  faceHandProximity: {
    left: { active: false, forwardDelta: null, strength: 0 },
    right: { active: false, forwardDelta: null, strength: 0 },
  },
  twoHandContact: {
    active: false,
    minDistance: null,
    strength: 0,
  },
};

const {
  applyBoneQuaternion,
  applyMorphMap,
  captureBindPose,
  rememberBone,
  rememberMorphMesh,
  reportMissingAliases,
  resetPose,
  setBonePositionOffset,
  setBoneRotation,
} = createRigController(avatarState);

const {
  applyFingerChainsFromFrame,
  setHandOrientationFromFrame,
} = createHandRigAppliers({
  avatarState,
  scene,
  applyBoneQuaternion,
  setBoneTowardDirection,
  setBoneTowardDirectionFromParentSpace,
});

function setStatus(message) {
  elements.frameStatus.textContent = message;
}

function setModelStatus(message) {
  elements.modelStatus.textContent = message;
}

function resetTorsoCollisionState() {
  Object.values(avatarState.torsoCollision).forEach((collisionState) => {
    collisionState.active = false;
    collisionState.pushWorld.set(0, 0, 0);
  });
  Object.values(avatarState.faceHandProximity).forEach((proximityState) => {
    proximityState.active = false;
    proximityState.forwardDelta = null;
    proximityState.strength = 0;
  });
  avatarState.twoHandContact.active = false;
  avatarState.twoHandContact.minDistance = null;
  avatarState.twoHandContact.strength = 0;
}

function sentenceFrames() {
  return Array.isArray(state.sentence?.frames) ? state.sentence.frames : [];
}

function sentenceFps() {
  return Number(state.sentence?.fps) || 30;
}

function segmentForFrame(frameIndex) {
  return state.sentence?.segments?.find((segment) =>
    frameIndex >= segment.start_frame && frameIndex <= segment.end_frame,
  ) ?? null;
}

function sourceVideoPathForSegment(segment) {
  const sourceClip = segment?.source_clip ?? {};
  const glossVideoRef = segment?.gloss ? `${segment.gloss}.mp4` : null;
  const directWordVideoRef = sourceClip.reference_video_ref || glossVideoRef;
  const videoRef = directWordVideoRef
    || sourceClip.video_ref
    || (sourceClip.video_id ? `${sourceClip.video_id}.mp4` : null);

  if (!videoRef) {
    return null;
  }

  if (directWordVideoRef) {
    return directWordVideoRef;
  }

  const sourcePathParts = String(sourceClip.source_path ?? '')
    .split(/[\\/]+/)
    .filter(Boolean);
  const sourceGroup = sourcePathParts.at(-2);

  return /^\d+$/.test(sourceGroup ?? '')
    ? `${sourceGroup}/${videoRef}`
    : videoRef;
}

function referenceVideoUrlForSegment(segment, videoPath) {
  const sourceClip = segment?.source_clip ?? {};
  const videoBase = sourceClip.reference_video_base || '/reference-videos';
  return `${videoBase}/${videoPath.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

function sourceFrameContext(frameIndex) {
  const segment = segmentForFrame(frameIndex);

  if (!segment || segment.is_transition) {
    return {
      segment,
      localFrame: null,
      sourceFrame: null,
      sourceSecond: null,
      videoUrl: null,
    };
  }

  const localFrame = frameIndex - segment.start_frame;
  const sourceSegment = segment.source_segment ?? {};
  const sourceStartFrame = Number(sourceSegment.source_start_frame);
  const sourceStartSecond = Number(sourceSegment.source_start_sec);
  const fps = sentenceFps();
  const sourceFrame = Number.isFinite(sourceStartFrame)
    ? sourceStartFrame + localFrame
    : null;
  const sourceSecond = sourceFrame !== null
    ? sourceFrame / fps
    : (Number.isFinite(sourceStartSecond) ? sourceStartSecond + (localFrame / fps) : null);
  const videoPath = sourceVideoPathForSegment(segment);

  return {
    segment,
    localFrame,
    sourceFrame,
    sourceSecond,
    videoUrl: videoPath
      ? referenceVideoUrlForSegment(segment, videoPath)
      : null,
  };
}

function baselineFrameIndexForFrame(frameIndex) {
  const segment = segmentForFrame(frameIndex);

  if (!segment) {
    return 0;
  }

  if (!segment.is_transition) {
    return segment.start_frame;
  }

  return Math.max(0, segment.start_frame - 1);
}

function sourceDatasetForSegment(segment) {
  return String(segment?.source_clip?.dataset ?? '');
}

function usesSentenceFaceStabilization(segment) {
  const dataset = sourceDatasetForSegment(segment);
  return dataset.includes('real_sen') || dataset.includes('raw_out_sentence');
}

function faceCalibrationForFrame(frameIndex) {
  const segment = segmentForFrame(frameIndex);

  if (!segment || segment.is_transition) {
    return null;
  }

  const key = `${segment.start_frame}:${segment.end_frame}:mouth3-eye-segment`;
  if (state.faceCalibrationCache.has(key)) {
    return state.faceCalibrationCache.get(key);
  }

  const frames = sentenceFrames();
  const sampleEnd = Math.min(segment.end_frame + 1, segment.start_frame + 3);
  const sampleFrames = frames.slice(segment.start_frame, sampleEnd);
  const mouthCalibration = buildSequenceFaceCalibrationFromFrames(sampleFrames);
  const segmentCalibration = buildSequenceFaceCalibrationFromFrames(
    frames.slice(segment.start_frame, segment.end_frame + 1),
  );
  const calibration = mouthCalibration || segmentCalibration
    ? {
      head: mouthCalibration?.head ?? segmentCalibration?.head,
      leftEye: segmentCalibration?.leftEye,
      rightEye: segmentCalibration?.rightEye,
      mouth: mouthCalibration?.mouth ?? segmentCalibration?.mouth,
    }
    : null;

  state.faceCalibrationCache.set(key, calibration);
  return calibration;
}

function stabilizeSentenceFaceMorphs(morphs, sourceContext) {
  const segment = sourceContext?.segment;
  if (!usesSentenceFaceStabilization(segment)) {
    return {
      morphs,
      debug: {
        active: false,
      },
    };
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
  const capWithGate = (name, cap) => {
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

  return {
    morphs: next,
    debug: {
      active: true,
      dataset: sourceDatasetForSegment(segment),
      expressive_mouth: roundDebugValue(expressiveMouth),
      neutral_mouth_gate: roundDebugValue(neutralMouthGate),
      mouth_open_before: roundDebugValue(morphs.mouthOpen),
      mouth_open_after: roundDebugValue(next.mouthOpen),
      jaw_open_before: roundDebugValue(morphs.jawOpen),
      jaw_open_after: roundDebugValue(next.jawOpen),
      eye_blink_left_after: roundDebugValue(next.eyeBlinkLeft),
      eye_blink_right_after: roundDebugValue(next.eyeBlinkRight),
      eye_wide_left_before: roundDebugValue(morphs.eyeWideLeft),
      eye_wide_left_after: roundDebugValue(next.eyeWideLeft),
      eye_wide_right_before: roundDebugValue(morphs.eyeWideRight),
      eye_wide_right_after: roundDebugValue(next.eyeWideRight),
    },
  };
}

function applyGlossFaceMorphAdjustment(morphs, sourceContext) {
  const gloss = sourceContext?.segment?.gloss;
  const adjustment = GLOSS_FACE_MORPH_ADJUSTMENTS[gloss];

  if (!adjustment) {
    return {
      morphs,
      debug: {
        active: false,
        gloss: gloss ?? null,
      },
    };
  }

  const next = { ...morphs };
  const smileLeftBefore = next.mouthSmileLeft ?? 0;
  const smileRightBefore = next.mouthSmileRight ?? 0;
  const frownLeftBefore = next.mouthFrownLeft ?? 0;
  const frownRightBefore = next.mouthFrownRight ?? 0;
  const smileTarget = Math.max(
    adjustment.smileFloor,
    smileLeftBefore * adjustment.smileBalance,
    smileRightBefore * adjustment.smileBalance,
  );

  next.mouthSmileLeft = Math.max(smileLeftBefore, smileTarget);
  next.mouthSmileRight = Math.max(smileRightBefore, smileTarget);
  next.mouthFrownLeft = frownLeftBefore * adjustment.frownScale;
  next.mouthFrownRight = frownRightBefore * adjustment.frownScale;

  return {
    morphs: next,
    debug: {
      active: true,
      gloss,
      smile_left_before: roundDebugValue(smileLeftBefore),
      smile_left_after: roundDebugValue(next.mouthSmileLeft),
      smile_right_before: roundDebugValue(smileRightBefore),
      smile_right_after: roundDebugValue(next.mouthSmileRight),
      frown_left_before: roundDebugValue(frownLeftBefore),
      frown_left_after: roundDebugValue(next.mouthFrownLeft),
      frown_right_before: roundDebugValue(frownRightBefore),
      frown_right_after: roundDebugValue(next.mouthFrownRight),
    },
  };
}

function glossHandMotionFreezeRange(sourceContext) {
  const gloss = sourceContext?.segment?.gloss;
  const localFrame = sourceContext?.localFrame;
  const ranges = GLOSS_HAND_MOTION_FREEZE_RANGES[gloss];

  if (!Array.isArray(ranges) || !Number.isFinite(localFrame)) {
    return null;
  }

  return ranges.find((range) =>
    localFrame >= range.startFrame && localFrame <= range.endFrame
  ) ?? null;
}

function glossRightHandMotionFreezeRange(sourceContext) {
  const gloss = sourceContext?.segment?.gloss;
  const localFrame = sourceContext?.localFrame;
  const ranges = GLOSS_RIGHT_HAND_MOTION_FREEZE_RANGES[gloss];

  if (!Array.isArray(ranges) || !Number.isFinite(localFrame)) {
    return null;
  }

  return ranges.find((range) =>
    localFrame >= range.startFrame && localFrame <= range.endFrame
  ) ?? null;
}

function glossLeftThumbMotionFreezeRange(sourceContext) {
  const gloss = sourceContext?.segment?.gloss;
  const localFrame = sourceContext?.localFrame;
  const ranges = GLOSS_LEFT_THUMB_MOTION_FREEZE_RANGES[gloss];

  if (!Array.isArray(ranges) || !Number.isFinite(localFrame)) {
    return null;
  }

  return ranges.find((range) =>
    localFrame >= range.startFrame && localFrame <= range.endFrame
  ) ?? null;
}

function handMotionFreezeDebug(sourceContext, range) {
  return {
    active: Boolean(range),
    gloss: sourceContext?.segment?.gloss ?? null,
    local_frame: sourceContext?.localFrame ?? null,
    start_frame: range?.startFrame ?? null,
    end_frame: range?.endFrame ?? null,
    hold_frame: range?.holdFrame ?? null,
  };
}

function rightHandMotionFreezeKeypoints(sourceContext, range, fallbackHand) {
  if (!range || !sourceContext?.segment) {
    return fallbackHand;
  }

  const frames = sentenceFrames();
  const holdLocalFrame = Number.isFinite(range.holdFrame)
    ? range.holdFrame
    : range.startFrame;
  const holdFrameIndex = THREE.MathUtils.clamp(
    sourceContext.segment.start_frame + holdLocalFrame,
    sourceContext.segment.start_frame,
    sourceContext.segment.end_frame,
  );
  const holdHand = frames[holdFrameIndex]?.people?.hand_right_keypoints_3d;

  return Array.isArray(holdHand) ? holdHand : fallbackHand;
}

function replaceKeypoint3DIndices(targetHand, sourceHand, indices) {
  if (!Array.isArray(targetHand) || !Array.isArray(sourceHand)) {
    return targetHand;
  }

  const next = [...targetHand];
  indices.forEach((keypointIndex) => {
    const base = keypointIndex * 4;
    if (base + 3 >= next.length || base + 3 >= sourceHand.length) {
      return;
    }
    next[base] = sourceHand[base];
    next[base + 1] = sourceHand[base + 1];
    next[base + 2] = sourceHand[base + 2];
    next[base + 3] = sourceHand[base + 3];
  });
  return next;
}

function leftThumbMotionFreezeKeypoints(sourceContext, range, fallbackHand) {
  if (!range || !sourceContext?.segment) {
    return fallbackHand;
  }

  const frames = sentenceFrames();
  const holdLocalFrame = Number.isFinite(range.holdFrame)
    ? range.holdFrame
    : range.startFrame;
  const holdFrameIndex = THREE.MathUtils.clamp(
    sourceContext.segment.start_frame + holdLocalFrame,
    sourceContext.segment.start_frame,
    sourceContext.segment.end_frame,
  );
  const holdHand = frames[holdFrameIndex]?.people?.hand_left_keypoints_3d;

  return replaceKeypoint3DIndices(fallbackHand, holdHand, THUMB_KEYPOINT_INDICES);
}

function playbackSpeed() {
  const value = Number(elements.speed.value || DEFAULT_PLAYBACK_SPEED);
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 1, 0.25, 2);
}

function transitionFrameCount() {
  const value = Math.floor(Number(elements.transitionFrames.value));
  return Math.max(0, Number.isFinite(value) ? value : DEFAULT_TRANSITION_FRAMES);
}

function shouldUseInterpolation() {
  return elements.useInterpolation.checked && transitionFrameCount() > 0;
}

function medianNumber(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!sorted.length) {
    return null;
  }

  return sorted[Math.floor(sorted.length / 2)];
}

function datasetShoulderWidthFromPose(pose) {
  if (!Array.isArray(pose)) {
    return null;
  }

  const width = getKeypoint3D(pose, 5).distanceTo(getKeypoint3D(pose, 2));
  return width > 1e-5 ? width : null;
}

function limbLengthFromPose(pose, fromIndex, toIndex) {
  if (!Array.isArray(pose)) {
    return null;
  }

  const fromConfidence = getKeypoint3DConfidence(pose, fromIndex);
  const toConfidence = getKeypoint3DConfidence(pose, toIndex);

  if (fromConfidence < 0.05 || toConfidence < 0.05) {
    return null;
  }

  const length = getKeypoint3D(pose, fromIndex).distanceTo(getKeypoint3D(pose, toIndex));
  return length > 1e-5 ? length : null;
}

function computeSentenceMotionMetrics(sentence) {
  const poses = (sentence?.frames ?? [])
    .map((frame) => frame?.people?.pose_keypoints_3d);
  const widths = poses.map((pose) => datasetShoulderWidthFromPose(pose));
  const medianDatasetShoulderWidth = medianNumber(widths);

  return {
    medianDatasetShoulderWidth,
    medianLeftUpperArmLength: medianNumber(poses.map((pose) => limbLengthFromPose(pose, 5, 6))),
    medianLeftForearmLength: medianNumber(poses.map((pose) => limbLengthFromPose(pose, 6, 7))),
    medianRightUpperArmLength: medianNumber(poses.map((pose) => limbLengthFromPose(pose, 2, 3))),
    medianRightForearmLength: medianNumber(poses.map((pose) => limbLengthFromPose(pose, 3, 4))),
  };
}

function shouldUseModelDefaultFace() {
  return false;
}

function readMotionMode() {
  return DEFAULT_MOTION_MODE;
}

function readMotionSettings() {
  return MOTION_MODE_SETTINGS[readMotionMode()] ?? MOTION_MODE_SETTINGS[DEFAULT_MOTION_MODE];
}

function readBlinkSyncSettings() {
  const mode = ['average', 'threshold'].includes(elements.blinkSyncMode?.value)
    ? elements.blinkSyncMode.value
    : 'off';
  const threshold = Number(elements.blinkSyncThreshold?.value);

  return {
    mode,
    threshold: Number.isFinite(threshold) ? threshold : 0.12,
  };
}

function renderBlinkSyncControls(settings = readBlinkSyncSettings()) {
  if (elements.blinkSyncThresholdValue) {
    elements.blinkSyncThresholdValue.textContent = settings.threshold.toFixed(2);
  }

  if (elements.blinkSyncThreshold) {
    elements.blinkSyncThreshold.disabled = settings.mode !== 'threshold';
  }
}

function applyBlinkSyncSettings() {
  renderBlinkSyncControls();
  showFrame(state.currentFrameIndex);
}

function setInputValue(input, value) {
  input.value = String(value);
}

function readCameraView() {
  return {
    distance: Number(elements.cameraDistance.value) || DEFAULT_CAMERA_VIEW.distance,
    fov: Number(elements.cameraFov.value) || DEFAULT_CAMERA_VIEW.fov,
    height: Number(elements.cameraHeight.value) || DEFAULT_CAMERA_VIEW.height,
    targetHeight: Number(elements.targetHeight.value) || DEFAULT_CAMERA_VIEW.targetHeight,
  };
}

function renderCameraValues(view = readCameraView()) {
  elements.cameraDistanceValue.textContent = view.distance.toFixed(2);
  elements.cameraHeightValue.textContent = view.height.toFixed(2);
  elements.targetHeightValue.textContent = view.targetHeight.toFixed(2);
  elements.cameraFovValue.textContent = String(Math.round(view.fov));
}

function applyCameraView(view = readCameraView()) {
  camera.position.set(0, view.height, view.distance);
  controls.target.set(0, view.targetHeight, 0);
  camera.fov = view.fov;
  camera.updateProjectionMatrix();
  controls.update();
  renderCameraValues(view);
}

function applyInitialCameraView() {
  const view = readCameraView();

  if (initialCameraView === 'side') {
    camera.position.set(-view.distance, view.height, 0);
    controls.target.set(0, view.targetHeight, 0);
    camera.fov = view.fov;
    camera.updateProjectionMatrix();
    controls.update();
    renderCameraValues(view);
    return;
  }

  applyCameraView(DEFAULT_CAMERA_VIEW);
}

function applyInitialReferencePanelState() {
  if (!initialReferenceCollapsed || !elements.referencePanel) {
    return;
  }

  elements.referencePanel.classList.add('is-collapsed');
  if (elements.toggleReferencePanel) {
    elements.toggleReferencePanel.textContent = 'Show';
  }
}

function resetCameraView() {
  setInputValue(elements.cameraDistance, DEFAULT_CAMERA_VIEW.distance);
  setInputValue(elements.cameraHeight, DEFAULT_CAMERA_VIEW.height);
  setInputValue(elements.targetHeight, DEFAULT_CAMERA_VIEW.targetHeight);
  setInputValue(elements.cameraFov, DEFAULT_CAMERA_VIEW.fov);
  applyCameraView(DEFAULT_CAMERA_VIEW);
}

function readNumberInput(input, fallback) {
  const value = Number(input?.value);
  return Number.isFinite(value) ? value : fallback;
}

function readRenderFitSettings() {
  return {
    enabled: Boolean(elements.renderFitEnabled.checked),
    clothShadowLift: readNumberInput(elements.renderFitClothLift, DEFAULT_RENDER_FIT_SETTINGS.clothShadowLift),
    exposure: readNumberInput(elements.renderFitExposure, DEFAULT_RENDER_FIT_SETTINGS.exposure),
  };
}

function setRenderFitControls(settings) {
  elements.renderFitEnabled.checked = settings.enabled;
  setInputValue(elements.renderFitExposure, settings.exposure);
  setInputValue(elements.renderFitClothLift, settings.clothShadowLift);
  renderRenderFitValues(settings);
}

function renderRenderFitValues(settings = readRenderFitSettings()) {
  elements.renderFitExposureValue.textContent = settings.exposure.toFixed(2);
  elements.renderFitClothLiftValue.textContent = settings.clothShadowLift.toFixed(3);
}

function applyLightSetup(settings) {
  const renderFitEnabled = settings.enabled;
  const source = renderFitEnabled ? LIGHTING_SETUP : BASE_RENDER_SETTINGS;

  renderer.toneMapping = source.toneMapping;
  renderer.toneMappingExposure = renderFitEnabled ? settings.exposure : BASE_RENDER_SETTINGS.exposure;
  scene.environment = renderFitEnabled ? roomEnvironmentTexture : null;

  ambientLight.color.set(source.skyColor);
  ambientLight.groundColor.set(source.groundColor);
  ambientLight.intensity = source.ambient;

  keyLight.color.set(source.keyColor);
  keyLight.intensity = source.key;
  keyLight.position.set(...source.keyPosition);

  fillLight.color.set(source.fillColor);
  fillLight.intensity = source.fill;
  fillLight.position.set(...source.fillPosition);

  rimLight.color.set(source.rimColor);
  rimLight.intensity = source.rim;
  rimLight.position.set(...source.rimPosition);
}

function applyRenderFitSettings(options = {}) {
  const { updateMaterials = true } = options;
  lookState.renderFit = readRenderFitSettings();
  renderRenderFitValues(lookState.renderFit);
  applyLightSetup(lookState.renderFit);

  if (updateMaterials) {
    avatarState.renderMeshes.forEach((mesh) => applyViewerMaterialSettings(mesh));
  }
}

function resetRenderFitSettings() {
  lookState.renderFit = { ...DEFAULT_RENDER_FIT_SETTINGS };
  setRenderFitControls(lookState.renderFit);
  applyRenderFitSettings();
}

function keypointPreviewContext() {
  return elements.keypointPreview?.getContext('2d') ?? null;
}

function syncKeypointPreviewCanvasSize() {
  const canvas = elements.keypointPreview;

  if (!canvas) {
    return false;
  }

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  if (canvas.width === width && canvas.height === height) {
    return false;
  }

  canvas.width = width;
  canvas.height = height;
  return true;
}

function flatKeypoint(flatArray, index, options = {}) {
  const {
    reference2d = null,
    stride = 4,
  } = options;
  const base = index * stride;

  if (!Array.isArray(flatArray) || base + stride - 1 >= flatArray.length) {
    return null;
  }

  const x = Number(flatArray[base]);
  const y = Number(flatArray[base + 1]);
  const z = stride >= 4 ? Number(flatArray[base + 2]) : 0;
  const confidence = Number(flatArray[base + stride - 1]) || 0;
  const referenceBase = index * 3;

  if (Array.isArray(reference2d) && referenceBase + 2 < reference2d.length) {
    const sourceX = Number(reference2d[referenceBase]);
    const sourceY = Number(reference2d[referenceBase + 1]);
    const sourceConfidence = Number(reference2d[referenceBase + 2]) || 0;

    if (
      !Number.isFinite(sourceX) ||
      !Number.isFinite(sourceY) ||
      sourceConfidence < KEYPOINT_PREVIEW_CONFIDENCE ||
      (Math.abs(sourceX) < 1e-6 && Math.abs(sourceY) < 1e-6)
    ) {
      return null;
    }
  }

  if (![x, y, z].every(Number.isFinite) || confidence < KEYPOINT_PREVIEW_CONFIDENCE) {
    return null;
  }

  return { x, y, z, confidence };
}

function collectPreviewPoints(frameData) {
  const people = frameData?.people ?? {};
  const groups = [
    {
      color: '#2563eb',
      edges: KEYPOINT_PREVIEW_POSE_EDGES,
      indices: KEYPOINT_PREVIEW_POSE_POINTS,
      lineWidth: 2.2,
      points: people.pose_keypoints_3d,
      reference2d: people.pose_keypoints_2d,
    },
    {
      color: '#a855f7',
      edges: KEYPOINT_PREVIEW_FACE_EDGES,
      indices: KEYPOINT_PREVIEW_FACE_POINTS,
      lineWidth: 0.9,
      pointRadius: 1.2,
      points: people.face_keypoints_3d,
      reference2d: people.face_keypoints_2d,
    },
    {
      color: '#16a34a',
      edges: KEYPOINT_PREVIEW_HAND_EDGES,
      indices: KEYPOINT_PREVIEW_HAND_POINTS,
      lineWidth: 1.4,
      points: people.hand_left_keypoints_3d,
      reference2d: people.hand_left_keypoints_2d,
    },
    {
      color: '#dc2626',
      edges: KEYPOINT_PREVIEW_HAND_EDGES,
      indices: KEYPOINT_PREVIEW_HAND_POINTS,
      lineWidth: 1.4,
      points: people.hand_right_keypoints_3d,
      reference2d: people.hand_right_keypoints_2d,
    },
  ];

  const points = groups.flatMap((group) =>
    group.indices.map((index) => flatKeypoint(group.points, index, group)).filter(Boolean),
  );

  if (!points.length) {
    return null;
  }

  const bounds = points.reduce((nextBounds, point) => ({
    minX: Math.min(nextBounds.minX, point.x),
    maxX: Math.max(nextBounds.maxX, point.x),
    minY: Math.min(nextBounds.minY, point.y),
    maxY: Math.max(nextBounds.maxY, point.y),
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  });

  return { bounds, groups };
}

function drawPreviewEdge(context, project, group, edge) {
  const from = flatKeypoint(group.points, edge[0], group);
  const to = flatKeypoint(group.points, edge[1], group);

  if (!from || !to) {
    return;
  }

  const a = project(from);
  const b = project(to);
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();
}

function drawPreviewPoints(context, project, group) {
  group.indices.forEach((index) => {
    const point = flatKeypoint(group.points, index, group);

    if (!point) {
      return;
    }

    const projected = project(point);
    context.beginPath();
    context.arc(projected.x, projected.y, index === 0 ? 2.4 : group.pointRadius ?? 1.8, 0, Math.PI * 2);
    context.fill();
  });
}

function clearKeypointPreview(message = 'No frame') {
  const canvas = elements.keypointPreview;

  if (!canvas) {
    return;
  }

  syncKeypointPreviewCanvasSize();
  const context = keypointPreviewContext();

  if (!context) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(15, 23, 42, 0.04)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#64748b';
  context.font = '12px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(message, canvas.width / 2, canvas.height / 2);
}

function renderKeypointPreview(frameData) {
  const canvas = elements.keypointPreview;

  if (!canvas) {
    return;
  }

  syncKeypointPreviewCanvasSize();
  const context = keypointPreviewContext();
  const previewData = collectPreviewPoints(frameData);

  if (!context) {
    return;
  }
  if (!previewData) {
    clearKeypointPreview('No keypoints');
    return;
  }

  const { bounds, groups } = previewData;
  const padding = 14;
  const width = Math.max(bounds.maxX - bounds.minX, 0.001);
  const height = Math.max(bounds.maxY - bounds.minY, 0.001);
  const scale = Math.min((canvas.width - padding * 2) / width, (canvas.height - padding * 2) / height);
  const offsetX = (canvas.width - width * scale) / 2;
  const offsetY = (canvas.height - height * scale) / 2;
  const project = (point) => ({
    x: offsetX + (point.x - bounds.minX) * scale,
    y: offsetY + (point.y - bounds.minY) * scale,
  });

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(248, 250, 252, 0.72)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  groups.forEach((group) => {
    context.strokeStyle = group.color;
    context.fillStyle = context.strokeStyle;
    context.lineWidth = group.lineWidth;
    group.edges.forEach((edge) => drawPreviewEdge(context, project, group, edge));
    drawPreviewPoints(context, project, group);
  });
}

function setReferenceEmpty(message, hidden = false) {
  if (!elements.referenceEmpty) {
    return;
  }

  elements.referenceEmpty.textContent = message;
  elements.referenceEmpty.hidden = hidden;
}

function syncReferenceVideo(frameData, frameIndex, options = {}) {
  const context = sourceFrameContext(frameIndex);
  const video = elements.referenceVideo;
  const playback = Boolean(options.playback);

  if (!video || !elements.referenceFrameMeta) {
    return context;
  }

  if (!context.segment || context.segment.is_transition) {
    state.referenceVideoSrc = null;
    elements.referenceFrameMeta.textContent = context.segment
      ? `transition frame ${frameIndex}`
      : 'No source frame';
    video.removeAttribute('src');
    video.load();
    state.referencePlaybackKey = null;
    setReferenceEmpty(context.segment ? 'Generated transition' : 'No reference video');
    return context;
  }

  elements.referenceFrameMeta.textContent =
    `${context.segment.gloss} | json ${context.localFrame} | source ${context.sourceFrame ?? '-'} | ${context.sourceSecond?.toFixed(3) ?? '-'}s`;

  const playbackKey = `${context.segment.gloss ?? context.segment.label}:${context.segment.start_frame}:${context.videoUrl}`;
  const videoChanged = context.videoUrl && state.referenceVideoSrc !== context.videoUrl;
  const playbackSegmentChanged = playback && state.referencePlaybackKey !== playbackKey;

  if (videoChanged) {
    state.referenceVideoSrc = context.videoUrl;
    video.src = context.videoUrl;
    video.load();
  }

  if (context.sourceSecond !== null) {
    state.referenceVideoTime = context.sourceSecond;
    const seek = (force = false) => {
      if (Number.isFinite(state.referenceVideoTime) && (force || Math.abs(video.currentTime - state.referenceVideoTime) > 0.16)) {
        video.currentTime = state.referenceVideoTime;
      }
    };

    if (video.readyState >= 1) {
      seek(!playback || videoChanged || playbackSegmentChanged);
    } else {
      video.onloadedmetadata = () => seek(true);
    }
  }

  if (playback) {
    state.referencePlaybackKey = playbackKey;
    video.playbackRate = playbackSpeed();
    video.play?.().catch(() => {});
  } else {
    state.referencePlaybackKey = null;
    video.pause();
  }
  setReferenceEmpty('', true);
  return context;
}

function clearReferenceComparison(message = 'No reference video') {
  if (elements.referenceVideo) {
    state.referenceVideoSrc = null;
    state.referenceVideoTime = null;
    state.referencePlaybackKey = null;
    elements.referenceVideo.removeAttribute('src');
    elements.referenceVideo.load();
  }

  if (elements.referenceFrameMeta) {
    elements.referenceFrameMeta.textContent = 'No source frame';
  }

  setReferenceEmpty(message);
}

function roundDebugValue(value) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : value;
}

function vectorDebugValue(vector) {
  if (!vector) {
    return null;
  }

  return {
    x: roundDebugValue(vector.x),
    y: roundDebugValue(vector.y),
    z: roundDebugValue(vector.z),
  };
}

function worldToDataset(vector) {
  return new THREE.Vector3(vector.x, -vector.y, -vector.z);
}

function averageDatasetKeypoints(flatArray, indices, minConfidence = 0.05) {
  if (!Array.isArray(flatArray)) {
    return null;
  }

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

function localTorsoPoint(point, shoulderCenter, torsoBasis) {
  const forward = (torsoBasis.horizontalForward ?? torsoBasis.forward).clone().normalize();
  const side = torsoBasis.side.clone().normalize();
  const up = torsoBasis.up.clone().normalize();
  const world = datasetToWorld(point.clone().sub(shoulderCenter));

  return {
    forward: world.dot(forward),
    side: world.dot(side),
    up: world.dot(up),
  };
}

function datasetDeltaFromTorsoLocal(delta, torsoBasis) {
  const forward = (torsoBasis.horizontalForward ?? torsoBasis.forward).clone().normalize();
  const side = torsoBasis.side.clone().normalize();
  const up = torsoBasis.up.clone().normalize();
  const worldDelta = forward
    .multiplyScalar(delta.forward ?? 0)
    .add(side.multiplyScalar(delta.side ?? 0))
    .add(up.multiplyScalar(delta.up ?? 0));

  return worldToDataset(worldDelta);
}

function translateKeypoint3DFlatArray(flatArray, delta) {
  if (!Array.isArray(flatArray) || !delta || delta.lengthSq() < 1e-10) {
    return flatArray;
  }

  const translated = [...flatArray];
  for (let index = 0; index + 2 < translated.length; index += 4) {
    translated[index] += delta.x;
    translated[index + 1] += delta.y;
    translated[index + 2] += delta.z;
  }
  return translated;
}

function identityArmCorrection(armPoints, reason = 'inactive') {
  return {
    arm: {
      elbow: armPoints.elbow.clone(),
      wrist: armPoints.wrist.clone(),
    },
    wristDelta: new THREE.Vector3(),
    debug: {
      active: false,
      reason,
      strength: 0,
      wrist_delta: vectorDebugValue(new THREE.Vector3()),
    },
  };
}

function applyGlossForwardArmBoost(armPoints, options = {}) {
  const gloss = options.gloss;
  const boost = GLOSS_FORWARD_ARM_BOOSTS[gloss];
  const pose = options.pose;
  const torsoBasis = options.torsoBasis;

  if (!boost || !Array.isArray(pose) || !torsoBasis) {
    return {
      arm: armPoints,
      wristDelta: new THREE.Vector3(),
      debug: {
        active: false,
        gloss: gloss ?? null,
        wrist_delta: vectorDebugValue(new THREE.Vector3()),
      },
    };
  }

  const leftShoulder = getKeypoint3D(pose, 5);
  const rightShoulder = getKeypoint3D(pose, 2);
  const shoulderWidth = leftShoulder.distanceTo(rightShoulder);

  if (!Number.isFinite(shoulderWidth) || shoulderWidth <= 1e-5) {
    return {
      arm: armPoints,
      wristDelta: new THREE.Vector3(),
      debug: {
        active: false,
        gloss,
        reason: 'missing_shoulder_width',
        wrist_delta: vectorDebugValue(new THREE.Vector3()),
      },
    };
  }

  const wristDelta = datasetDeltaFromTorsoLocal({
    forward: shoulderWidth * boost.forwardWidth,
  }, torsoBasis);

  return {
    arm: {
      elbow: armPoints.elbow.clone().add(wristDelta.clone().multiplyScalar(boost.elbowRatio)),
      wrist: armPoints.wrist.clone().add(wristDelta),
    },
    wristDelta,
    debug: {
      active: true,
      gloss,
      forward_width: boost.forwardWidth,
      elbow_ratio: boost.elbowRatio,
      wrist_delta: vectorDebugValue(wristDelta),
    },
  };
}

function computeFaceRelativeArmCorrection(armPoints, options = {}) {
  const settings = options.motionSettings ?? readMotionSettings();

  if (!settings.faceRelativeHandCorrection) {
    return identityArmCorrection(armPoints, 'disabled');
  }

  const pose = options.pose;
  const face = options.face;
  const hand = options.hand;
  const torsoBasis = options.torsoBasis;

  if (!Array.isArray(pose) || !torsoBasis) {
    return identityArmCorrection(armPoints, 'missing_pose');
  }

  const leftShoulder = getKeypoint3D(pose, 5);
  const rightShoulder = getKeypoint3D(pose, 2);
  const shoulderWidth = leftShoulder.distanceTo(rightShoulder);

  if (!Number.isFinite(shoulderWidth) || shoulderWidth <= 1e-5) {
    return identityArmCorrection(armPoints, 'missing_shoulder_width');
  }

  const shoulderCenter = leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5);
  const faceAnchor = averageDatasetKeypoints(
    face,
    [27, 28, 29, 30, 31, 33, 36, 39, 42, 45, 48, 54],
  );

  if (!faceAnchor) {
    return identityArmCorrection(armPoints, 'missing_face');
  }

  const handAnchor = averageDatasetKeypoints(hand, [0, 5, 9, 13, 17])
    ?? averageDatasetKeypoints(hand, [5, 9, 13, 17])
    ?? armPoints.wrist;
  const faceLocal = localTorsoPoint(faceAnchor, shoulderCenter, torsoBasis);
  const handLocal = localTorsoPoint(handAnchor, shoulderCenter, torsoBasis);
  const sideOffset = handLocal.side - faceLocal.side;
  const upOffset = handLocal.up - faceLocal.up;
  const forwardOffset = handLocal.forward - faceLocal.forward;
  const sideScore = 1 - THREE.MathUtils.clamp(Math.abs(sideOffset) / (shoulderWidth * 0.74), 0, 1);
  const upScore = 1 - THREE.MathUtils.clamp(Math.abs(upOffset) / (shoulderWidth * 0.82), 0, 1);
  const forwardScore = 1 - remapClamped(Math.abs(forwardOffset), shoulderWidth * 0.08, shoulderWidth * 0.72);
  const planarStrength = Math.min(sideScore, upScore) * forwardScore;
  const proximityStrength = options.proximity?.strength ?? 0;
  const strength = Math.max(proximityStrength, planarStrength * 0.75);

  if (strength < 0.12) {
    return identityArmCorrection(armPoints, 'not_near_face');
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
  const localDelta = {
    forward: 0,
    side: (targetSideOffset - sideOffset) * correctionWeight,
    up: (targetUpOffset - upOffset) * correctionWeight,
  };
  const wristDelta = datasetDeltaFromTorsoLocal(localDelta, torsoBasis);

  if (wristDelta.lengthSq() < 1e-10) {
    return identityArmCorrection(armPoints, 'inside_face_window');
  }

  return {
    arm: {
      elbow: armPoints.elbow.clone().add(
        wristDelta.clone().multiplyScalar(settings.faceRelativeHandElbowFollow),
      ),
      wrist: armPoints.wrist.clone().add(wristDelta),
    },
    debug: {
      active: true,
      strength: roundDebugValue(strength),
      applied_weight: roundDebugValue(correctionWeight),
      side_offset_width: roundDebugValue(sideOffset / shoulderWidth),
      up_offset_width: roundDebugValue(upOffset / shoulderWidth),
      forward_offset_width: roundDebugValue(forwardOffset / shoulderWidth),
      side_limit_width: roundDebugValue(settings.faceRelativeHandMaxSideOffset),
      up_limit_width: roundDebugValue(settings.faceRelativeHandMaxUpOffset),
      wrist_delta: vectorDebugValue(wristDelta),
    },
  };
}

function renderFrameDebug(debug) {
  if (!elements.frameDebug) {
    return;
  }

  elements.frameDebug.textContent = debug ? JSON.stringify(debug, null, 2) : 'No frame';
}

function keypointPreviewSizeLimits() {
  const panel = elements.keypointPreviewPanel;
  const hostRect = panel?.parentElement?.getBoundingClientRect();
  const maxByHostWidth = hostRect ? hostRect.width - 36 : window.innerWidth * KEYPOINT_PREVIEW_MAX_VIEWPORT_RATIO;
  const maxByHostHeight = hostRect ? hostRect.height - 36 : window.innerHeight * KEYPOINT_PREVIEW_MAX_VIEWPORT_RATIO;

  return {
    minWidth: KEYPOINT_PREVIEW_MIN_WIDTH,
    minHeight: KEYPOINT_PREVIEW_MIN_HEIGHT,
    maxWidth: Math.max(KEYPOINT_PREVIEW_MIN_WIDTH, Math.min(maxByHostWidth, window.innerWidth * KEYPOINT_PREVIEW_MAX_VIEWPORT_RATIO)),
    maxHeight: Math.max(KEYPOINT_PREVIEW_MIN_HEIGHT, Math.min(maxByHostHeight, window.innerHeight * KEYPOINT_PREVIEW_MAX_VIEWPORT_RATIO)),
  };
}

function redrawKeypointPreview() {
  if (avatarState.currentFrameData) {
    renderKeypointPreview(avatarState.currentFrameData);
    return;
  }

  clearKeypointPreview('No sentence');
}

function setKeypointPreviewPanelSize(width, height) {
  const panel = elements.keypointPreviewPanel;

  if (!panel) {
    return;
  }

  const limits = keypointPreviewSizeLimits();
  const nextWidth = THREE.MathUtils.clamp(width, limits.minWidth, limits.maxWidth);
  const nextHeight = THREE.MathUtils.clamp(height, limits.minHeight, limits.maxHeight);
  panel.style.width = `${Math.round(nextWidth)}px`;
  panel.style.height = `${Math.round(nextHeight)}px`;
  redrawKeypointPreview();
}

function startKeypointPreviewResize(event) {
  const panel = elements.keypointPreviewPanel;
  const handle = elements.keypointPreviewResize;

  if (!panel || !handle) {
    return;
  }

  const rect = panel.getBoundingClientRect();
  keypointPreviewResizeState.active = true;
  keypointPreviewResizeState.startX = event.clientX;
  keypointPreviewResizeState.startY = event.clientY;
  keypointPreviewResizeState.startWidth = rect.width;
  keypointPreviewResizeState.startHeight = rect.height;
  handle.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

function updateKeypointPreviewResize(event) {
  if (!keypointPreviewResizeState.active) {
    return;
  }

  const nextWidth = keypointPreviewResizeState.startWidth + event.clientX - keypointPreviewResizeState.startX;
  const nextHeight = keypointPreviewResizeState.startHeight + event.clientY - keypointPreviewResizeState.startY;
  setKeypointPreviewPanelSize(nextWidth, nextHeight);
  event.preventDefault();
}

function stopKeypointPreviewResize(event) {
  if (!keypointPreviewResizeState.active) {
    return;
  }

  keypointPreviewResizeState.active = false;
  elements.keypointPreviewResize?.releasePointerCapture?.(event.pointerId);
  event.preventDefault();
}

function nudgeKeypointPreviewSize(deltaWidth, deltaHeight) {
  const panel = elements.keypointPreviewPanel;

  if (!panel) {
    return;
  }

  const rect = panel.getBoundingClientRect();
  setKeypointPreviewPanelSize(rect.width + deltaWidth, rect.height + deltaHeight);
}

function setupKeypointPreviewResizing() {
  const handle = elements.keypointPreviewResize;

  if (!handle) {
    return;
  }

  handle.addEventListener('pointerdown', startKeypointPreviewResize);
  handle.addEventListener('pointermove', updateKeypointPreviewResize);
  handle.addEventListener('pointerup', stopKeypointPreviewResize);
  handle.addEventListener('pointercancel', stopKeypointPreviewResize);
  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 24 : 8;

    if (event.key === 'ArrowRight') {
      nudgeKeypointPreviewSize(step, 0);
    } else if (event.key === 'ArrowLeft') {
      nudgeKeypointPreviewSize(-step, 0);
    } else if (event.key === 'ArrowDown') {
      nudgeKeypointPreviewSize(0, step);
    } else if (event.key === 'ArrowUp') {
      nudgeKeypointPreviewSize(0, -step);
    } else {
      return;
    }

    event.preventDefault();
  });
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }

  return response.json();
}

function validateClip(payload, label) {
  if (payload?.schema_version !== 'sign-keypoint-clip/v1') {
    throw new Error(`${label} is not sign-keypoint-clip/v1.`);
  }

  if (!Array.isArray(payload.frames) || payload.frames.length === 0) {
    throw new Error(`${label} has no frames.`);
  }

  payload.frames.forEach((frame, index) => {
    const people = frame?.people;
    const required = [
      'pose_keypoints_3d',
      'hand_left_keypoints_3d',
      'hand_right_keypoints_3d',
    ];
    required.forEach((key) => {
      if (!Array.isArray(people?.[key])) {
        throw new Error(`${label} frame ${index} is missing ${key}.`);
      }
    });
  });
}

function cloneFrame(frame, frameIndex) {
  const people = frame.people || {};
  return {
    frame_index: frameIndex,
    people: {
      pose_keypoints_2d: [...(people.pose_keypoints_2d || [])],
      pose_keypoints_3d: [...(people.pose_keypoints_3d || [])],
      hand_left_keypoints_2d: [...(people.hand_left_keypoints_2d || [])],
      hand_left_keypoints_3d: [...(people.hand_left_keypoints_3d || [])],
      hand_right_keypoints_2d: [...(people.hand_right_keypoints_2d || [])],
      hand_right_keypoints_3d: [...(people.hand_right_keypoints_3d || [])],
      face_keypoints_2d: [...(people.face_keypoints_2d || [])],
      face_keypoints_3d: [...(people.face_keypoints_3d || [])],
    },
  };
}

async function loadClip(entry) {
  const cacheKey = `${entry.dictionaryVersionId || state.dictionaryVersionId}:${entry.gloss}`;
  if (state.clipCache.has(cacheKey)) {
    return state.clipCache.get(cacheKey);
  }

  const payload = await fetchJson(entry.path);
  payload.source = {
    ...(payload.source || {}),
    reference_video_ref: entry.referenceVideoRef || null,
    reference_video_base: entry.referenceVideoBase || '/reference-videos',
  };
  validateClip(payload, entry.gloss);
  state.clipCache.set(cacheKey, payload);
  return payload;
}

async function buildSentencePayload(glosses) {
  const clips = [];

  for (const gloss of glosses) {
    const glossKey = normalizeGlossKey(gloss);
    const entry = state.dictionaryByGloss.get(glossKey);
    if (!entry) {
      throw new Error(`Unknown gloss: ${glossKey}`);
    }
    clips.push(await loadClip(entry));
  }

  const transitionCount = shouldUseInterpolation() ? transitionFrameCount() : 0;
  const fps = Number(clips[0]?.fps) || 30;

  return composeSentenceFromClips(clips, {
    targetFps: fps,
    transitionFrames: transitionCount,
    transitionMethod: 'smoothstep',
    allowTransitionFallback: true,
  });
}

function renderDictionaryList() {
  const query = normalizeGlossSearch(elements.wordSearch.value);
  const matches = state.dictionary.filter((entry) =>
    normalizeGlossSearch(entry.gloss).includes(query),
  );
  const visible = matches.slice(0, WORD_RENDER_LIMIT);

  elements.wordList.innerHTML = '';

  visible.forEach((entry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${entry.gloss} (${entry.frameCount})`;
    button.title = entry.file;
    button.addEventListener('click', () => addGloss(entry.gloss));
    elements.wordList.append(button);
  });

  if (matches.length > WORD_RENDER_LIMIT) {
    const more = document.createElement('button');
    more.type = 'button';
    more.disabled = true;
    more.textContent = `+ ${matches.length - WORD_RENDER_LIMIT} more`;
    elements.wordList.append(more);
  }
}

function renderSelectedWords() {
  elements.selectedWords.innerHTML = '';
  elements.selectedEmpty.hidden = state.selectedGlosses.length > 0;
  elements.saveSentence.disabled = state.selectedGlosses.length === 0;

  state.selectedGlosses.forEach((gloss, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    const number = document.createElement('span');
    number.className = 'word-index';
    number.textContent = String(index + 1);
    const label = document.createElement('span');
    label.textContent = gloss;
    const remove = document.createElement('span');
    remove.className = 'remove-word';
    remove.textContent = 'Remove';
    button.append(number, label, remove);
    button.addEventListener('click', () => removeGloss(index));
    elements.selectedWords.append(button);
  });
}

function renderFavoriteSentences() {
  elements.favoriteSentences.innerHTML = '';
  elements.favoritesEmpty.hidden = state.favoriteSentences.length > 0;

  state.favoriteSentences.forEach((favorite) => {
    const row = document.createElement('div');
    row.className = 'favorite-row';

    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'favorite-load';
    load.textContent = favorite.label;
    load.title = favorite.glosses.join(' ');
    load.addEventListener('click', () => loadFavoriteSentence(favorite));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'favorite-delete';
    remove.textContent = 'x';
    remove.title = `Remove ${favorite.label}`;
    remove.addEventListener('click', () => deleteFavoriteSentence(favorite.id));

    row.append(load, remove);
    elements.favoriteSentences.append(row);
  });
}

function renderSentenceMeta() {
  if (!state.sentence) {
    state.motionMetrics = null;
    state.faceCalibrationCache = new Map();
    elements.sequenceMeta.textContent = 'No payload';
    elements.frameRange.max = '0';
    elements.frameRange.value = '0';
    elements.frameNumber.value = '0';
    elements.play.disabled = true;
    clearKeypointPreview('No sentence');
    clearReferenceComparison('No sentence');
    renderFrameDebug(null);
    return;
  }

  const frames = sentenceFrames();
  state.faceCalibrationCache = new Map();
  state.motionMetrics = computeSentenceMotionMetrics(state.sentence);
  elements.frameRange.max = String(Math.max(0, frames.length - 1));
  elements.frameNumber.max = String(Math.max(0, frames.length - 1));
  elements.play.disabled = frames.length === 0;
  elements.sequenceMeta.textContent = JSON.stringify({
    schema_version: state.sentence.schema_version,
    fps: state.sentence.fps,
    glosses: state.sentence.glosses,
    frame_count: frames.length,
    transition_frames: shouldUseInterpolation() ? transitionFrameCount() : 0,
    motion_metrics: state.motionMetrics,
    segments: state.sentence.segments,
  }, null, 2);
}

async function rebuildSentence(options = {}) {
  stopPlayback();

  if (!state.selectedGlosses.length) {
    state.sentence = null;
    renderSentenceMeta();
    setStatus('No sentence');
    clearKeypointPreview('No sentence');
    return;
  }

  setStatus('Building sentence');
  state.sentence = await buildSentencePayload(state.selectedGlosses);
  renderSentenceMeta();
  const initialFrameIndex = Number.isFinite(options.frameIndex)
    ? THREE.MathUtils.clamp(Math.floor(options.frameIndex), 0, sentenceFrames().length - 1)
    : 0;
  state.currentFrameIndex = initialFrameIndex;

  showFrame(initialFrameIndex);

  if (options.autoplay) {
    playSentence();
  }
}

function addGloss(gloss) {
  const glossKey = normalizeGlossKey(gloss);
  const entry = state.dictionaryByGloss.get(glossKey);
  if (!entry) {
    setStatus(`Unknown gloss: ${glossKey}`);
    return;
  }

  state.selectedGlosses.push(entry.gloss);
  renderSelectedWords();
  rebuildSentence().catch((error) => {
    console.error(error);
    setStatus(error.message);
  });
}

function saveCurrentSentence() {
  const result = saveFavoriteSentence(state.selectedGlosses);

  if (!result.saved) {
    setStatus('No sentence to save');
    return;
  }

  state.favoriteSentences = result.favorites;
  renderFavoriteSentences();
  setStatus(`Saved favorite: ${result.favorite.label}`);
}

function loadFavoriteSentence(favorite) {
  const glosses = favorite.glosses
    .map((gloss) => state.dictionaryByGloss.get(normalizeGlossKey(gloss))?.gloss)
    .filter(Boolean);

  if (!glosses.length) {
    setStatus(`Favorite has no available words: ${favorite.label}`);
    return;
  }

  state.selectedGlosses = glosses;
  renderSelectedWords();
  rebuildSentence().catch((error) => {
    console.error(error);
    setStatus(error.message);
  });
}

function deleteFavoriteSentence(id) {
  state.favoriteSentences = removeFavoriteSentence(id);
  renderFavoriteSentences();
}

function removeGloss(index) {
  state.selectedGlosses.splice(index, 1);
  renderSelectedWords();
  rebuildSentence().catch((error) => {
    console.error(error);
    setStatus(error.message);
  });
}

function clearSentence() {
  state.selectedGlosses = [];
  renderSelectedWords();
  rebuildSentence().catch((error) => {
    console.error(error);
    setStatus(error.message);
  });
}

function selectedDictionaryVersion() {
  return state.dictionaryVersions.find((version) => version.id === state.dictionaryVersionId)
    || state.dictionaryVersions[0]
    || {
      id: 'current',
      label: 'Current',
      indexUrl: '/words-index.json',
      referenceVideoUrlPrefix: '/reference-videos',
      isDefault: true,
    };
}

function renderDictionaryVersions() {
  elements.dictionaryVersions.innerHTML = '';

  state.dictionaryVersions.forEach((version) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    const text = document.createElement('span');

    input.type = 'radio';
    input.name = 'dictionary-version';
    input.value = version.id;
    input.checked = version.id === state.dictionaryVersionId;
    text.textContent = version.label;

    label.append(input, text);
    elements.dictionaryVersions.append(label);
  });
}

async function loadDictionaryVersions() {
  const payload = await fetchJson('/dictionary-versions.json');
  const versions = Array.isArray(payload.versions)
    ? payload.versions.filter((version) => version.id && version.indexUrl)
    : [];
  state.dictionaryVersions = versions.length
    ? versions
    : [{
      id: 'current',
      label: 'Current',
      indexUrl: '/words-index.json',
      referenceVideoUrlPrefix: '/reference-videos',
      isDefault: true,
    }];

  const defaultVersion = state.dictionaryVersions.find((version) => version.isDefault)
    || state.dictionaryVersions[0];
  state.dictionaryVersionId = state.dictionaryVersions.some((version) => version.id === initialDictionaryVersion)
    ? initialDictionaryVersion
    : defaultVersion.id;
  renderDictionaryVersions();
}

async function switchDictionaryVersion(versionId) {
  if (versionId === state.dictionaryVersionId) {
    return;
  }

  stopPlayback();
  state.dictionaryVersionId = versionId;
  state.clipCache.clear();
  state.selectedGlosses = [];
  state.sentence = null;
  state.currentFrameIndex = 0;
  clearReferenceComparison('No sentence');
  clearKeypointPreview('No sentence');
  renderSelectedWords();
  renderSentenceMeta();
  renderFrameDebug(null);
  await loadDictionary({ applyInitialWords: false });
}

async function loadDictionary(options = {}) {
  const { applyInitialWords = true } = options;
  const version = selectedDictionaryVersion();
  const payload = await fetchJson(version.indexUrl);
  state.dictionary = Array.isArray(payload.words)
    ? payload.words
      .map((entry) => ({
        ...entry,
        gloss: normalizeGlossKey(entry.gloss),
        referenceVideoBase: entry.referenceVideoBase || version.referenceVideoUrlPrefix || '/reference-videos',
        dictionaryVersionId: entry.dictionaryVersionId || version.id,
      }))
      .filter((entry) => entry.gloss)
    : [];
  state.dictionaryByGloss = new Map(
    state.dictionary.map((entry) => [normalizeGlossKey(entry.gloss), entry]),
  );
  state.favoriteSentences = loadFavoriteSentences();

  elements.dictionaryStats.textContent =
    `${version.label}: ${state.dictionary.length} valid words, ${payload.invalidCount || 0} invalid files`;
  renderDictionaryList();
  renderFavoriteSentences();

  if (applyInitialWords && initialWords.length) {
    state.selectedGlosses = initialWords
      .map((word) => state.dictionaryByGloss.get(normalizeGlossKey(word))?.gloss)
      .filter(Boolean);
    renderSelectedWords();
    await rebuildSentence({
      autoplay: autoplayOnReady,
      frameIndex: initialFrameParam,
    });
  }
}

function hasReliableHandBasis(handPoints, minConfidence = 0.05) {
  return [0, 5, 9, 13].every((index) =>
    getKeypoint3DConfidence(handPoints, index) >= minConfidence,
  );
}

function clampWeightedAngle(value, limit, weight = 1) {
  return THREE.MathUtils.clamp((value ?? 0) * weight, -limit, limit);
}

function applyHeadPose(headPose, smoothing = 1, options = {}) {
  if (!headPose) {
    return;
  }

  const limits = options.limits ?? SAFE_HEAD_LIMITS;
  const weight = options.weight ?? SAFE_HEAD_POSE_WEIGHT;

  setBoneRotation(
    'Neck',
    new THREE.Euler(
      clampWeightedAngle(headPose.neckPitch, limits.neckPitch, weight),
      clampWeightedAngle(headPose.neckYaw, limits.neckYaw, weight),
      clampWeightedAngle(headPose.neckRoll, limits.neckRoll, weight),
    ),
    smoothing,
  );
  setBoneRotation(
    'Head',
    new THREE.Euler(
      clampWeightedAngle(headPose.headPitch, limits.headPitch, weight),
      clampWeightedAngle(headPose.headYaw, limits.headYaw, weight),
      clampWeightedAngle(headPose.headRoll, limits.headRoll, weight),
    ),
    smoothing,
  );
}

function applyRigidBoneHeadFollow(name, options = {}) {
  const headBone = avatarState.bones.get('Head');
  const bone = avatarState.bones.get(name);
  const bindHeadPosition = avatarState.bindWorldPositions?.get('Head');
  const bindHeadQuaternion = avatarState.bindWorldQuaternions?.get('Head');
  const bindBonePosition = avatarState.bindWorldPositions?.get(name);
  const bindBoneQuaternion = avatarState.bindWorldQuaternions?.get(name);
  const bindBoneLocalPosition = avatarState.bindPositions?.get(name);
  const smoothing = options.smoothing ?? 1;

  if (
    !headBone
    || !bone
    || !bindHeadPosition
    || !bindHeadQuaternion
    || !bindBonePosition
    || !bindBoneQuaternion
    || !bindBoneLocalPosition
    || !bone.parent
  ) {
    return {
      active: false,
      reason: `missing_${name}`,
    };
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
  const rawPositionOffset = targetLocalPosition.sub(bindBoneLocalPosition);
  const positionOffset = rawPositionOffset.clone();
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

  return {
    active: true,
    name,
    raw_position_offset: vectorDebugValue(rawPositionOffset),
    position_offset: vectorDebugValue(positionOffset),
  };
}

function applyJawAttachmentFollow(morphs, smoothing = 1) {
  const jawOpen = THREE.MathUtils.clamp(
    Math.max(
      Number(morphs?.jawOpen) || 0,
      (Number(morphs?.mouthOpen) || 0) * 0.55,
    ),
    0,
    1,
  );
  const jawForward = THREE.MathUtils.clamp(Number(morphs?.jawForward) || 0, 0, 1);
  const jawLateral = THREE.MathUtils.clamp(
    (Number(morphs?.jawRight) || 0) - (Number(morphs?.jawLeft) || 0),
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
  const followed = [
    applyRigidBoneHeadFollow('JawMaster', {
      extraHeadLocalOffset: jawOffset,
      extraLocalRotation: jawRotation,
      smoothing,
    }),
    applyRigidBoneHeadFollow('Jaw', {
      extraHeadLocalOffset: lowerJawOffset,
      extraLocalRotation: jawRotation,
      smoothing,
    }),
    applyRigidBoneHeadFollow('TeethTop', {
      smoothing,
    }),
    applyRigidBoneHeadFollow('TeethBottom', {
      extraHeadLocalOffset: lowerTeethOffset,
      extraLocalRotation: jawRotation,
      smoothing,
    }),
  ];

  return {
    active: followed.some((item) => item.active),
    jaw_open: roundDebugValue(jawOpen),
    jaw_forward: roundDebugValue(jawForward),
    jaw_lateral: roundDebugValue(jawLateral),
    jaw_offset: vectorDebugValue(jawOffset),
    lower_jaw_offset: vectorDebugValue(lowerJawOffset),
    lower_teeth_offset: vectorDebugValue(lowerTeethOffset),
    followed,
  };
}

function applyRigidFaceAttachments(morphs, options = {}) {
  const eyeOptions = {
    ...EYE_ATTACHMENT_OPTIONS,
    ...(options.eye ?? {}),
  };
  const jawSmoothing = options.jawSmoothing ?? 1;

  return {
    eye_rig: {
      left: applyRigidBoneHeadFollow('EyeLeft', eyeOptions),
      right: applyRigidBoneHeadFollow('EyeRight', eyeOptions),
    },
    jaw: applyJawAttachmentFollow(morphs, jawSmoothing),
  };
}

function getBindParentDirection(boneName, childName) {
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
}

function getBindWorldDirection(boneName, childName) {
  const bindBonePosition = avatarState.bindWorldPositions?.get(boneName);
  const bindChildPosition = avatarState.bindWorldPositions?.get(childName);

  if (!bindBonePosition || !bindChildPosition) {
    return null;
  }

  const bindWorldDirection = bindChildPosition.clone().sub(bindBonePosition);

  return bindWorldDirection.lengthSq() > 1e-8
    ? bindWorldDirection.normalize()
    : null;
}

function getBindWorldLength(boneName, childName) {
  const bindBonePosition = avatarState.bindWorldPositions?.get(boneName);
  const bindChildPosition = avatarState.bindWorldPositions?.get(childName);

  return bindBonePosition && bindChildPosition
    ? bindBonePosition.distanceTo(bindChildPosition)
    : null;
}

function avatarToDatasetScale(pose) {
  const avatarLeftShoulder = avatarState.bindWorldPositions?.get('LeftArm');
  const avatarRightShoulder = avatarState.bindWorldPositions?.get('RightArm');

  if (!avatarLeftShoulder || !avatarRightShoulder) {
    return 1;
  }

  const datasetShoulderWidth = state.motionMetrics?.medianDatasetShoulderWidth
    ?? datasetShoulderWidthFromPose(pose);
  const avatarShoulderWidth = avatarLeftShoulder.distanceTo(avatarRightShoulder);

  return datasetShoulderWidth && datasetShoulderWidth > 1e-5 && avatarShoulderWidth > 1e-5
    ? avatarShoulderWidth / datasetShoulderWidth
    : 1;
}

function fixedShoulderArmDirection(armBoneName, forearmBoneName, shoulderPoint, elbowPoint, targetWeight = FIXED_SHOULDER_ARM_TARGET_WEIGHT) {
  const keypointDirection = pointDirection(shoulderPoint, elbowPoint);
  const bindDirection = getBindWorldDirection(armBoneName, forearmBoneName);

  if (!bindDirection) {
    return keypointDirection;
  }

  return blendDirections(
    bindDirection,
    keypointDirection,
    targetWeight,
  );
}

function solveAvatarArmIkDirections(sidePrefix, shoulderPoint, elbowPoint, wristPoint, pose) {
  return solveTwoBoneArmIkDirections(shoulderPoint, elbowPoint, wristPoint, {
    forearmLength: getBindWorldLength(`${sidePrefix}ForeArm`, `${sidePrefix}Hand`),
    scale: avatarToDatasetScale(pose),
    upperLength: getBindWorldLength(`${sidePrefix}Arm`, `${sidePrefix}ForeArm`),
  });
}

function blendIkDirection(fkDirection, ikDirection, weight) {
  if (!ikDirection || weight <= 0) {
    return fkDirection;
  }

  return blendDirections(fkDirection, ikDirection, THREE.MathUtils.clamp(weight, 0, 1));
}

function limitedBindRelativeDirection(boneName, childName, targetDirectionWorld, targetWeight, maxAngle) {
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
}

function directionWithBaselineDelta(boneName, childName, currentDirection, baselineDirection) {
  const bindDirection = getBindWorldDirection(boneName, childName);

  if (!bindDirection || !currentDirection || !baselineDirection) {
    return currentDirection;
  }

  const baseline = baselineDirection.clone().normalize();
  const current = currentDirection.clone().normalize();

  if (baseline.lengthSq() < 1e-8 || current.lengthSq() < 1e-8) {
    return bindDirection;
  }

  const delta = new THREE.Quaternion().setFromUnitVectors(baseline, current);
  return bindDirection.clone().applyQuaternion(delta).normalize();
}

function computeRelativeTorsoPoseTargets(frameIndex, currentTorsoMotion, motionSettings) {
  if (!motionSettings.relativeTorsoPose) {
    return {
      baselineFrameIndex: null,
      spine1Direction: currentTorsoMotion.spine1Direction,
      spine2Direction: currentTorsoMotion.spine2Direction,
      leftShoulderDirection: currentTorsoMotion.leftShoulderDirection,
      rightShoulderDirection: currentTorsoMotion.rightShoulderDirection,
    };
  }

  const baselineFrameIndex = baselineFrameIndexForFrame(frameIndex);
  const baselineFrame = sentenceFrames()[baselineFrameIndex];
  const baselinePose = baselineFrame?.people?.pose_keypoints_3d;

  if (!baselinePose) {
    return {
      baselineFrameIndex: null,
      spine1Direction: currentTorsoMotion.spine1Direction,
      spine2Direction: currentTorsoMotion.spine2Direction,
      leftShoulderDirection: currentTorsoMotion.leftShoulderDirection,
      rightShoulderDirection: currentTorsoMotion.rightShoulderDirection,
    };
  }

  const baselineTorsoMotion = computeSharedTorsoMotion(baselinePose, {
    forwardTiltScale: motionSettings.torsoForwardTiltScale,
    sideTiltDeadzone: motionSettings.torsoSideTiltDeadzone,
    sideTiltScale: motionSettings.torsoSideTiltScale,
  });

  return {
    baselineFrameIndex,
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
  };
}

function setBoneTowardDirection(boneName, childName, targetDirectionWorld, options = {}) {
  const smoothing = options.smoothing ?? 1;
  const bindBlend = options.bindBlend ?? 0;
  const bone = avatarState.bones.get(boneName);
  const child = avatarState.bones.get(childName);
  const bindRotation = avatarState.bindRotations.get(boneName);

  if (!bone || !child || !bindRotation) {
    return;
  }

  const bindParentDirection = getBindParentDirection(boneName, childName)
    ?? child.position.clone().normalize().applyQuaternion(bindRotation);
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
}

function setBoneTowardDirectionFromParentSpace(boneName, bindParentDirection, targetDirectionWorld, options = {}) {
  const smoothing = options.smoothing ?? 1;
  const bone = avatarState.bones.get(boneName);
  const bindRotation = avatarState.bindRotations.get(boneName);

  if (!bone || !bindRotation) {
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
}

function applyFrameData(frameData, frameIndex, options = {}) {
  if (!avatarState.loaded) {
    avatarState.pendingFrameIndex = frameIndex;
    return;
  }

  const {
    preserveCurrentPose = false,
    boneSmoothing = 1,
    morphSmoothing = 1,
    torsoSmoothing: inputTorsoSmoothing = boneSmoothing,
  } = options;

  avatarState.currentFrameData = frameData;
  avatarState.faceMode = DEFAULT_VIEWER_FACE_MODE;
  const motionMode = readMotionMode();
  const motionSettings = readMotionSettings();

  const pose = frameData.people.pose_keypoints_3d;
  const leftHand = frameData.people.hand_left_keypoints_3d;
  const rightHand = frameData.people.hand_right_keypoints_3d;
  const face = frameData.people.face_keypoints_3d;
  renderKeypointPreview(frameData);
  const sourceContext = syncReferenceVideo(frameData, frameIndex, {
    playback: options.referencePlayback,
  });
  const leftHandMotionFreezeRange = glossHandMotionFreezeRange(sourceContext);
  const leftHandMotionFrozen = Boolean(leftHandMotionFreezeRange);
  const rightHandMotionFreezeRange = glossRightHandMotionFreezeRange(sourceContext);
  const leftThumbMotionFreezeRange = glossLeftThumbMotionFreezeRange(sourceContext);

  if (!preserveCurrentPose) {
    resetPose();
    resetTorsoCollisionState();
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
    frameData,
    'left',
    leftElbow,
    leftCanonicalWrist,
    { sequence: null, correctionProfile: false, correctionMode: null },
  );
  const correctedRightArm = computeCorrectedArmPoints(
    frameData,
    'right',
    rightElbow,
    rightCanonicalWrist,
    { sequence: null, correctionProfile: false, correctionMode: null },
  );
  const torsoMotion = computeSharedTorsoMotion(pose, {
    forwardTiltScale: motionSettings.torsoForwardTiltScale,
    sideTiltDeadzone: motionSettings.torsoSideTiltDeadzone,
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
      smoothing: preserveCurrentPose ? TORSO_COLLISION_OPTIONS.smoothing : 1,
      state: avatarState.torsoCollision.left,
      torsoBasis: torsoMotion.torsoBasis,
      handPoints: leftHand,
    })
    : correctedLeftArm;
  const rightCollisionArm = motionSettings.torsoCollision
    ? applyTorsoCollisionCorrection(pose, correctedRightArm, {
      ...TORSO_COLLISION_OPTIONS,
      smoothing: preserveCurrentPose ? TORSO_COLLISION_OPTIONS.smoothing : 1,
      state: avatarState.torsoCollision.right,
      torsoBasis: torsoMotion.torsoBasis,
      handPoints: rightHand,
    })
    : correctedRightArm;
  const leftArmCorrection = computeFaceRelativeArmCorrection(leftCollisionArm, {
    face,
    hand: leftHand,
    motionSettings,
    pose,
    proximity: leftFaceProximity,
    torsoBasis: torsoMotion.torsoBasis,
  });
  const rightArmCorrection = computeFaceRelativeArmCorrection(rightCollisionArm, {
    face,
    hand: rightHand,
    motionSettings,
    pose,
    proximity: rightFaceProximity,
    torsoBasis: torsoMotion.torsoBasis,
  });
  const leftGlossBoost = applyGlossForwardArmBoost(leftArmCorrection.arm, {
    gloss: sourceContext.segment?.gloss,
    pose,
    torsoBasis: torsoMotion.torsoBasis,
  });
  const rightGlossBoost = applyGlossForwardArmBoost(rightArmCorrection.arm, {
    gloss: sourceContext.segment?.gloss,
    pose,
    torsoBasis: torsoMotion.torsoBasis,
  });
  const leftArm = leftGlossBoost.arm;
  const rightArm = rightGlossBoost.arm;
  const leftHandForRig = translateKeypoint3DFlatArray(
    leftThumbMotionFreezeKeypoints(sourceContext, leftThumbMotionFreezeRange, leftHand),
    leftGlossBoost.wristDelta,
  );
  const rightHandForRig = translateKeypoint3DFlatArray(
    rightHandMotionFreezeKeypoints(sourceContext, rightHandMotionFreezeRange, rightHand),
    rightGlossBoost.wristDelta,
  );
  const headFaceResult = computeHeadFaceStrategy(frameData, {
    mode: avatarState.faceMode,
    faceCalibration: faceCalibrationForFrame(frameIndex),
    blinkSync: readBlinkSyncSettings(),
  });
  const stabilizedFace = stabilizeSentenceFaceMorphs(headFaceResult.morphs, sourceContext);
  const glossFaceAdjustment = applyGlossFaceMorphAdjustment(stabilizedFace.morphs, sourceContext);
  const clampedFaceMorphs = clampFaceMorphs(glossFaceAdjustment.morphs);
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
  let faceAttachmentDebug = null;
  const torsoSmoothing = preserveCurrentPose && !motionSettings.torsoPose
    ? Math.min(inputTorsoSmoothing, 0.08)
    : inputTorsoSmoothing;
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
      smoothing: torsoSmoothing,
      bindBlend: 0,
    });
    scene.updateMatrixWorld(true);

    setBoneTowardDirection('Spine2', 'Neck', spine2Direction, {
      smoothing: torsoSmoothing,
      bindBlend: 0,
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
      smoothing: torsoSmoothing,
      bindBlend: torsoMotion.shoulderBindBlend * 0.25,
    });
    setBoneTowardDirection('RightShoulder', 'RightArm', rightShoulderDirection, {
      smoothing: torsoSmoothing,
      bindBlend: torsoMotion.shoulderBindBlend * 0.25,
    });
    scene.updateMatrixWorld(true);
  }

  if (motionSettings.headPose) {
    applyHeadPose(headFaceResult.headPose, torsoSmoothing, {
      limits: motionSettings.headLimits,
      weight: motionSettings.headPoseWeight,
    });
  }
  scene.updateMatrixWorld(true);

  if (!shouldUseModelDefaultFace()) {
    applyMorphMap(baseFaceMorphs, morphSmoothing);
    applyMorphMap(stabilizedEyeMorphs, 1);
    faceAttachmentDebug = applyRigidFaceAttachments(safeFaceMorphs, {
      eye: EYE_ATTACHMENT_OPTIONS,
      jawSmoothing: morphSmoothing,
    });
    scene.updateMatrixWorld(true);
  }

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
    THREE.MathUtils.lerp(motionSettings.shoulderArmTargetWeight, motionSettings.contactShoulderArmTargetWeight, twoHandContact.strength),
    THREE.MathUtils.lerp(motionSettings.shoulderArmTargetWeight, motionSettings.faceHandShoulderArmTargetWeight, leftFaceProximity.strength),
  );
  const rightShoulderArmTargetWeight = Math.max(
    THREE.MathUtils.lerp(motionSettings.shoulderArmTargetWeight, motionSettings.contactShoulderArmTargetWeight, twoHandContact.strength),
    THREE.MathUtils.lerp(motionSettings.shoulderArmTargetWeight, motionSettings.faceHandShoulderArmTargetWeight, rightFaceProximity.strength),
  );
  renderFrameDebug({
    frame: {
      json_frame: frameIndex,
      segment_kind: sourceContext.segment?.kind ?? null,
      gloss: sourceContext.segment?.gloss ?? null,
      local_frame: sourceContext.localFrame,
      source_frame: sourceContext.sourceFrame,
      source_second: roundDebugValue(sourceContext.sourceSecond),
      fps: sentenceFps(),
    },
    rig_weights: {
      motion_mode: motionMode,
      left_ik: roundDebugValue(leftIkWeight),
      right_ik: roundDebugValue(rightIkWeight),
      left_shoulder_target: roundDebugValue(leftShoulderArmTargetWeight),
      right_shoulder_target: roundDebugValue(rightShoulderArmTargetWeight),
      hand_orientation_weight: roundDebugValue(motionSettings.handOrientationWeight),
      torso_smoothing: roundDebugValue(torsoSmoothing),
      playback_torso_smoothing: roundDebugValue(motionSettings.playbackTorsoSmoothing),
      torso_collision_enabled: motionSettings.torsoCollision,
      torso_pose_enabled: motionSettings.torsoPose,
      shoulder_pose_enabled: motionSettings.shoulderPose,
      head_pose_enabled: motionSettings.headPose,
      relative_torso_pose: motionSettings.relativeTorsoPose,
      torso_baseline_frame: torsoPoseTargets.baselineFrameIndex,
      torso_target_weight: roundDebugValue(motionSettings.torsoTargetWeight),
      torso_side_tilt_scale: roundDebugValue(motionSettings.torsoSideTiltScale),
      torso_side_tilt_deadzone: roundDebugValue(motionSettings.torsoSideTiltDeadzone),
      shoulder_pose_weight: roundDebugValue(motionSettings.shoulderPoseWeight),
      motion_scale: roundDebugValue(avatarToDatasetScale(pose)),
      median_dataset_shoulder_width: roundDebugValue(state.motionMetrics?.medianDatasetShoulderWidth),
    },
    motion_metrics: {
      median_dataset_shoulder_width: roundDebugValue(state.motionMetrics?.medianDatasetShoulderWidth),
      left_upper_arm: roundDebugValue(state.motionMetrics?.medianLeftUpperArmLength),
      left_forearm: roundDebugValue(state.motionMetrics?.medianLeftForearmLength),
      right_upper_arm: roundDebugValue(state.motionMetrics?.medianRightUpperArmLength),
      right_forearm: roundDebugValue(state.motionMetrics?.medianRightForearmLength),
    },
    contacts: {
      two_hand: {
        active: twoHandContact.active,
        strength: roundDebugValue(twoHandContact.strength),
        min_distance: roundDebugValue(twoHandContact.minDistance),
      },
      face_hand_left: {
        active: leftFaceProximity.active,
        strength: roundDebugValue(leftFaceProximity.strength),
        forward_delta: roundDebugValue(leftFaceProximity.forwardDelta),
      },
      face_hand_right: {
        active: rightFaceProximity.active,
        strength: roundDebugValue(rightFaceProximity.strength),
        forward_delta: roundDebugValue(rightFaceProximity.forwardDelta),
      },
      torso_collision_left: {
        active: avatarState.torsoCollision.left.active,
        push: vectorDebugValue(avatarState.torsoCollision.left.pushWorld),
      },
      torso_collision_right: {
        active: avatarState.torsoCollision.right.active,
        push: vectorDebugValue(avatarState.torsoCollision.right.pushWorld),
      },
    },
    arm_correction: {
      left: leftArmCorrection.debug,
      right: rightArmCorrection.debug,
    },
    gloss_forward_boost: {
      left: leftGlossBoost.debug,
      right: rightGlossBoost.debug,
    },
    left_hand_motion_freeze: handMotionFreezeDebug(sourceContext, leftHandMotionFreezeRange),
    left_thumb_motion_freeze: handMotionFreezeDebug(sourceContext, leftThumbMotionFreezeRange),
    right_hand_motion_freeze: handMotionFreezeDebug(sourceContext, rightHandMotionFreezeRange),
    torso_pose: {
      raw_spine1_direction: vectorDebugValue(torsoMotion.spine1Direction),
      raw_spine2_direction: vectorDebugValue(torsoMotion.spine2Direction),
      target_spine1_direction: vectorDebugValue(torsoPoseTargets.spine1Direction),
      target_spine2_direction: vectorDebugValue(torsoPoseTargets.spine2Direction),
      target_left_shoulder_direction: vectorDebugValue(torsoPoseTargets.leftShoulderDirection),
      target_right_shoulder_direction: vectorDebugValue(torsoPoseTargets.rightShoulderDirection),
    },
    head_pose: Object.fromEntries(
      Object.entries(headFaceResult.headPose ?? {}).map(([key, value]) => [key, roundDebugValue(value)]),
    ),
    face_stabilization: stabilizedFace.debug,
    face_gloss_adjustment: glossFaceAdjustment.debug,
    face_attachments: faceAttachmentDebug,
    face_signals: headFaceResult.debug?.faceSignals ?? null,
  });
  const leftUpperDirection = blendIkDirection(fixedShoulderArmDirection(
    'LeftArm',
    'LeftForeArm',
    leftShoulder,
    leftArm.elbow,
    leftShoulderArmTargetWeight,
  ), leftIkDirections?.upperDirection, leftIkWeight);
  const rightUpperDirection = blendIkDirection(fixedShoulderArmDirection(
    'RightArm',
    'RightForeArm',
    rightShoulder,
    rightArm.elbow,
    rightShoulderArmTargetWeight,
  ), rightIkDirections?.upperDirection, rightIkWeight);
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

  if (!leftHandMotionFrozen && hasReliableHandBasis(leftHandForRig)) {
    setHandOrientationFromFrame(
      'Left',
      leftArm.wrist,
      getKeypoint3D(leftHandForRig, 5),
      getKeypoint3D(leftHandForRig, 9),
      getKeypoint3D(leftHandForRig, 13),
      {
        orientationWeight: motionSettings.handOrientationWeight,
        smoothing: boneSmoothing,
      },
    );
  }
  if (hasReliableHandBasis(rightHandForRig)) {
    setHandOrientationFromFrame(
      'Right',
      rightArm.wrist,
      getKeypoint3D(rightHandForRig, 5),
      getKeypoint3D(rightHandForRig, 9),
      getKeypoint3D(rightHandForRig, 13),
      {
        orientationWeight: motionSettings.handOrientationWeight,
        smoothing: boneSmoothing,
      },
    );
  }
  scene.updateMatrixWorld(true);

  if (!leftHandMotionFrozen) {
    applyFingerChainsFromFrame('Left', leftHandForRig, { smoothing: boneSmoothing });
  }
  applyFingerChainsFromFrame('Right', rightHandForRig, { smoothing: boneSmoothing });

  state.currentFrameIndex = frameIndex;
  elements.frameRange.value = String(frameIndex);
  elements.frameNumber.value = String(frameIndex);
  setStatus(`Frame ${frameIndex + 1}/${sentenceFrames().length} | ${sentenceFps()}fps | ${playbackSpeed()}x`);
}

function showFrame(rawFrameIndex, options = {}) {
  const frames = sentenceFrames();
  if (!frames.length) {
    return;
  }

  const frameIndex = THREE.MathUtils.clamp(Math.floor(Number(rawFrameIndex) || 0), 0, frames.length - 1);
  const sourceContext = sourceFrameContext(frameIndex);
  const freezeRange = glossHandMotionFreezeRange(sourceContext);

  if (freezeRange && !options.preserveCurrentPose) {
    const holdLocalFrame = Number.isFinite(freezeRange.holdFrame)
      ? freezeRange.holdFrame
      : freezeRange.startFrame - 1;
    const holdFrameIndex = THREE.MathUtils.clamp(
      sourceContext.segment.start_frame + holdLocalFrame,
      sourceContext.segment.start_frame,
      sourceContext.segment.end_frame,
    );

    if (holdFrameIndex !== frameIndex) {
      applyFrameData(frames[holdFrameIndex], holdFrameIndex, {
        ...options,
        referencePlayback: false,
      });
      applyFrameData(frames[frameIndex], frameIndex, {
        ...options,
        preserveCurrentPose: true,
      });
      return;
    }
  }

  applyFrameData(frames[frameIndex], frameIndex, options);
}

function stopPlayback() {
  if (state.playbackAnimationFrame !== null) {
    window.cancelAnimationFrame(state.playbackAnimationFrame);
    state.playbackAnimationFrame = null;
  }
  elements.referenceVideo?.pause();
  state.referencePlaybackKey = null;
}

function showBindPose() {
  stopPlayback();
  resetPose();
  resetTorsoCollisionState();
  scene.updateMatrixWorld(true);
  state.currentFrameIndex = 0;
  elements.frameRange.value = '0';
  elements.frameNumber.value = '0';
  clearKeypointPreview('T pose');
  clearReferenceComparison('T pose');
  renderFrameDebug(null);
  setStatus('T pose');
}

function playSentence() {
  const frames = sentenceFrames();
  if (!frames.length) {
    return;
  }

  stopPlayback();
  const motionSettings = readMotionSettings();
  state.playbackStartedAt = performance.now();

  const tick = () => {
    const elapsedSec = (performance.now() - state.playbackStartedAt) / 1000;
    const nextFrame = Math.floor(elapsedSec * sentenceFps() * playbackSpeed());

    if (nextFrame >= frames.length) {
      showFrame(frames.length - 1, {
        preserveCurrentPose: true,
        boneSmoothing: motionSettings.playbackBoneSmoothing,
        morphSmoothing: motionSettings.playbackMorphSmoothing,
        torsoSmoothing: motionSettings.playbackTorsoSmoothing,
        referencePlayback: false,
      });
      stopPlayback();
      return;
    }

    showFrame(nextFrame, {
      preserveCurrentPose: true,
      boneSmoothing: motionSettings.playbackBoneSmoothing,
      morphSmoothing: motionSettings.playbackMorphSmoothing,
      torsoSmoothing: motionSettings.playbackTorsoSmoothing,
      referencePlayback: true,
    });
    state.playbackAnimationFrame = window.requestAnimationFrame(tick);
  };

  showFrame(0, {
    referencePlayback: true,
  });
  state.playbackAnimationFrame = window.requestAnimationFrame(tick);
}

function addTypedWord(event = null) {
  const gloss = normalizeGlossKey(elements.wordSearch.value);
  if (!shouldAcceptTypedWordSubmit(gloss, event)) {
    return;
  }
  addGloss(gloss);
}

function setupEvents() {
  elements.dictionaryVersions.addEventListener('change', (event) => {
    if (event.target?.name !== 'dictionary-version') {
      return;
    }

    switchDictionaryVersion(event.target.value).catch((error) => setStatus(error.message));
  });
  elements.wordSearch.addEventListener('input', renderDictionaryList);
  elements.addTypedWord.addEventListener('click', addTypedWord);
  elements.saveSentence.addEventListener('click', saveCurrentSentence);
  elements.clearSentence.addEventListener('click', clearSentence);
  elements.play.addEventListener('click', playSentence);
  elements.stop.addEventListener('click', stopPlayback);
  elements.resetPose.addEventListener('click', showBindPose);
  elements.transitionFrames.addEventListener('change', () => rebuildSentence().catch((error) => setStatus(error.message)));
  elements.useInterpolation.addEventListener('change', () => rebuildSentence().catch((error) => setStatus(error.message)));
  elements.blinkSyncMode.addEventListener('change', applyBlinkSyncSettings);
  elements.blinkSyncThreshold.addEventListener('input', applyBlinkSyncSettings);
  elements.frameRange.addEventListener('input', () => {
    stopPlayback();
    showFrame(elements.frameRange.value);
  });
  elements.frameNumber.addEventListener('change', () => {
    stopPlayback();
    showFrame(elements.frameNumber.value);
  });
  [
    elements.cameraDistance,
    elements.cameraHeight,
    elements.targetHeight,
    elements.cameraFov,
  ].forEach((input) => {
    input.addEventListener('input', () => applyCameraView());
  });
  elements.resetCamera.addEventListener('click', resetCameraView);
  [
    elements.renderFitEnabled,
    elements.renderFitExposure,
    elements.renderFitClothLift,
  ].forEach((input) => {
    input.addEventListener('input', () => applyRenderFitSettings());
    input.addEventListener('change', () => applyRenderFitSettings());
  });
  elements.resetRenderFit.addEventListener('click', resetRenderFitSettings);
  elements.toggleReferencePanel?.addEventListener('click', () => {
    const collapsed = elements.referencePanel?.classList.toggle('is-collapsed');
    elements.toggleReferencePanel.textContent = collapsed ? 'Show' : 'Hide';
  });
  elements.copyFrameDebug?.addEventListener('click', () => {
    navigator.clipboard?.writeText(elements.frameDebug?.textContent ?? '');
  });
  elements.referenceVideo?.addEventListener('loadeddata', () => {
    setReferenceEmpty('', true);
  });
  setupKeypointPreviewResizing();
  elements.wordSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTypedWord(event);
    }
  });
}

function materialName(material, mesh) {
  return `${material?.name || ''} ${mesh?.name || ''}`.toLowerCase();
}

function materialKind(material, mesh) {
  const name = materialName(material, mesh);

  if (name.includes('eye') || name.includes('cornea')) {
    return 'eye';
  }

  if (
    name.includes('teeth')
    || name.includes('tongue')
    || name.includes('nail')
    || name.includes('eyelash')
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
    name.includes('cloth')
    || name.includes('look')
    || name.includes('shirt')
    || name.includes('pants')
    || name.includes('pant')
    || name.includes('jeans')
    || name.includes('shoes')
    || name.includes('sneaker')
    || name.includes('coverall')
  ) {
    return 'cloth';
  }

  return 'avatar';
}

function isClothMesh(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  return materials.some((material) => materialKind(material, mesh) === 'cloth');
}

function inflateClothGeometry(mesh, offset = MATERIAL_TUNING.clothNormalOffset) {
  const geometry = mesh?.geometry;
  const position = geometry?.attributes?.position;
  const normal = geometry?.attributes?.normal;

  if (
    !geometry
    || !position
    || !normal
    || !Number.isFinite(offset)
    || offset <= 0
    || clothInflatedGeometries.has(geometry)
    || !isClothMesh(mesh)
  ) {
    return false;
  }

  for (let index = 0; index < position.count; index += 1) {
    position.setXYZ(
      index,
      position.getX(index) + normal.getX(index) * offset,
      position.getY(index) + normal.getY(index) * offset,
      position.getZ(index) + normal.getZ(index) * offset,
    );
  }

  position.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  clothInflatedGeometries.add(geometry);
  return true;
}

function suppressUnmappedEmissive(material) {
  if (!material?.emissive || material.emissiveMap) {
    return;
  }

  const emissiveStrength = Math.max(material.emissive.r, material.emissive.g, material.emissive.b);

  if (emissiveStrength < 0.5) {
    return;
  }

  material.emissive.setRGB(0, 0, 0);
  if ('emissiveIntensity' in material) {
    material.emissiveIntensity = 0;
  }
}

function rememberOriginalMaterialSettings(material) {
  if (!material || originalMaterialSettings.has(material)) {
    return;
  }

  originalMaterialSettings.set(material, {
    emissive: material.emissive?.clone() ?? null,
    emissiveIntensity: material.emissiveIntensity,
    envMapIntensity: material.envMapIntensity,
    metalness: material.metalness,
    roughness: material.roughness,
  });
}

function restoreOriginalMaterialSettings(material) {
  const original = originalMaterialSettings.get(material);

  if (!material || !original) {
    return;
  }

  if ('roughness' in material && original.roughness !== undefined) {
    material.roughness = original.roughness;
  }
  if ('metalness' in material && original.metalness !== undefined) {
    material.metalness = original.metalness;
  }
  if ('envMapIntensity' in material && original.envMapIntensity !== undefined) {
    material.envMapIntensity = original.envMapIntensity;
  }
  if (material.emissive && original.emissive) {
    material.emissive.copy(original.emissive);
  }
  if ('emissiveIntensity' in material && original.emissiveIntensity !== undefined) {
    material.emissiveIntensity = original.emissiveIntensity;
  }

  material.needsUpdate = true;
}

function applyViewerMaterialSettings(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  materials.filter(Boolean).forEach((material) => {
    const kind = materialKind(material, mesh);

    suppressUnmappedEmissive(material);
    rememberOriginalMaterialSettings(material);

    if (!lookState.renderFit.enabled) {
      restoreOriginalMaterialSettings(material);
      return;
    }

    if ('roughness' in material) {
      if (kind === 'cloth') {
        material.roughness = MATERIAL_TUNING.clothRoughness;
      } else if (kind === 'hair') {
        material.roughness = MATERIAL_TUNING.hairRoughness;
      } else if (kind === 'skin') {
        material.roughness = MATERIAL_TUNING.skinRoughness;
      }
    }
    if ('metalness' in material && kind !== 'hair') {
      material.metalness = 0;
    }
    if ('envMapIntensity' in material) {
      if (kind === 'cloth') {
        material.envMapIntensity = MATERIAL_TUNING.clothEnvIntensity;
      } else if (kind === 'hair') {
        material.envMapIntensity = MATERIAL_TUNING.hairEnvIntensity;
      } else if (kind === 'skin') {
        material.envMapIntensity = MATERIAL_TUNING.skinEnvIntensity;
      } else if (kind === 'eye') {
        material.envMapIntensity = MATERIAL_TUNING.eyeEnvIntensity;
      }
    }
    if (material.emissive) {
      if (kind === 'cloth') {
        material.emissive.setRGB(
          lookState.renderFit.clothShadowLift,
          lookState.renderFit.clothShadowLift,
          lookState.renderFit.clothShadowLift,
        );
        material.emissiveIntensity = 1;
      }
    }

    material.needsUpdate = true;
  });
}

new GLTFLoader().load(
  '/models/model.glb',
  (gltf) => {
    const avatar = gltf.scene;
    scene.add(avatar);

    avatar.traverse((child) => {
      if (child.isBone) {
        rememberBone(child);
      }

      if (child.isMesh) {
        child.castShadow = true;
        child.frustumCulled = false;
        avatarState.renderMeshes.push(child);
        if (child.morphTargetDictionary && rememberMorphMesh) {
          rememberMorphMesh(child);
        }
        inflateClothGeometry(child);
        applyViewerMaterialSettings(child);
      }
    });

    const avatarBox = new THREE.Box3().setFromObject(avatar);
    const center = avatarBox.getCenter(new THREE.Vector3());
    avatar.position.sub(center);
    avatar.position.y = 0;
    captureBindPose(scene);
    reportMissingAliases();
    avatarState.loaded = true;
    setModelStatus('Model ready');

    if (sentenceFrames().length) {
      showFrame(avatarState.pendingFrameIndex);
    }
  },
  undefined,
  (error) => {
    console.error(error);
    setModelStatus(error.message);
  },
);

function onResize() {
  const width = elements.canvas.clientWidth;
  const height = elements.canvas.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);

  if (elements.keypointPreviewPanel) {
    const rect = elements.keypointPreviewPanel.getBoundingClientRect();
    setKeypointPreviewPanelSize(rect.width, rect.height);
  }
  const frame = sentenceFrames()[state.currentFrameIndex];
  if (!frame) {
    setReferenceEmpty('No reference video');
  }
}

window.addEventListener('resize', onResize);

function animate() {
  controls.update();
  renderer.render(scene, camera);
  window.requestAnimationFrame(animate);
}

setupEvents();
renderBlinkSyncControls();
setRenderFitControls(lookState.renderFit);
applyRenderFitSettings({ updateMaterials: false });
applyInitialCameraView();
applyInitialReferencePanelState();
clearKeypointPreview('No sentence');
clearReferenceComparison('No sentence');
renderFrameDebug(null);
renderSelectedWords();
renderSentenceMeta();
loadDictionaryVersions()
  .then(() => loadDictionary())
  .catch((error) => {
    console.error(error);
    elements.dictionaryStats.textContent = error.message;
    setStatus(error.message);
  });
animate();
