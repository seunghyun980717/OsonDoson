import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  DEFAULT_FACE_MODE,
  computeHeadFaceStrategy,
} from './lib/head-face-strategies.js';
import { createKeypointPreview } from './preview/keypoint-preview.js';
import { createRigController } from './viewer/rig-controller.js';
import {
  getKeypoint3DConfidence,
  getKeypoint3D,
  pointDirection,
} from './viewer/keypoint-utils.js';
import {
  computeCorrectedArmPoints,
  computeSharedTorsoMotion,
  createHandRigAppliers,
} from './viewer/body-motion.js';

const container = document.querySelector('#viewer-canvas');
const frameLabelEl = document.querySelector('#word-frame-label');
const keypointCanvas = document.querySelector('#keypoint-canvas');
const referenceVideoEl = document.querySelector('#reference-video');
const referenceFaceCanvas = document.querySelector('#reference-face-canvas');
const keypointFaceCanvas = document.querySelector('#keypoint-face-canvas');
const wordSelect = document.querySelector('#word-select');
const wordInput = document.querySelector('#word-input');
const frameInput = document.querySelector('#word-frame-input');
const loadButton = document.querySelector('#load-word');
const playButton = document.querySelector('#play-word');
const stopButton = document.querySelector('#stop-word');
const qaWordFilterButton = document.querySelector('#qa-word-filter');
const playbackSpeedSelect = document.querySelector('#playback-speed');
const showFrameButton = document.querySelector('#show-word-frame');
const expandButtons = document.querySelectorAll('.expand-button');

const urlParams = new URLSearchParams(window.location.search);
const initialWord = urlParams.get('word') || urlParams.get('src') || '0';
const autoplayOnReady = urlParams.get('autoplay') === '1';
const embeddedMode = urlParams.get('embed') === '1';
const initialPlaybackSpeed = urlParams.get('speed');
document.body.classList.toggle('embed-mode', embeddedMode);
wordInput.value = initialWord;
if (initialPlaybackSpeed && playbackSpeedSelect) {
  playbackSpeedSelect.value = initialPlaybackSpeed;
}

let wordIndexEntries = [];
let qaOnlyWords = false;

const {
  configureKeypointCanvas,
  renderKeypointPreview,
} = createKeypointPreview({
  keypointCanvas,
  referenceVideoEl,
  referenceFaceCanvas,
  keypointFaceCanvas,
});

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0f172a');

const camera = new THREE.PerspectiveCamera(
  35,
  container.clientWidth / container.clientHeight,
  0.1,
  100,
);
camera.position.set(0, 1.5, 3.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.enableDamping = true;
let suppressCameraSync = false;
let pendingCameraSyncFrame = null;

scene.add(new THREE.AmbientLight('#ffffff', 1.8));

const keyLight = new THREE.DirectionalLight('#fff7ed', 2.8);
keyLight.position.set(3, 5, 3);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight('#bfdbfe', 1.6);
rimLight.position.set(-3, 2, -2);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(4, 64),
  new THREE.MeshStandardMaterial({
    color: '#111827',
    roughness: 0.9,
    metalness: 0.05,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.02;
scene.add(floor);

scene.add(new THREE.GridHelper(8, 16, '#475569', '#1f2937'));
const axes = new THREE.AxesHelper(0.75);
axes.position.set(-1.2, 0.05, 0);
scene.add(axes);

const avatarState = {
  loaded: false,
  faceMode: DEFAULT_FACE_MODE,
  currentFrameData: null,
  playbackAnimationFrame: null,
  isPlaying: false,
  playbackStartedAt: 0,
  playbackStartFrame: 0,
  pendingFrameIndex: 0,
  word: null,
  frames: [],
  bones: new Map(),
  bindRotations: new Map(),
  morphMeshes: [],
  supportedMorphNames: new Set(),
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
};

const {
  applyBoneQuaternion,
  applyMorphMap,
  rememberBone,
  resetPose,
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

function wordFrames() {
  return avatarState.frames;
}

function wordFps() {
  return Number(avatarState.word?.sample?.segment?.fps) || 30;
}

function playbackSpeed() {
  const value = Number(playbackSpeedSelect?.value || 1);
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 1, 0.25, 1);
}

function setStatus(message) {
  frameLabelEl.textContent = message;
}

function cameraState() {
  return {
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    zoom: camera.zoom,
    fov: camera.fov,
  };
}

function applyCameraState(state) {
  if (!state || !Array.isArray(state.position) || !Array.isArray(state.target)) {
    return;
  }

  suppressCameraSync = true;
  camera.position.fromArray(state.position.map(Number));
  controls.target.fromArray(state.target.map(Number));
  if (Number.isFinite(Number(state.zoom))) {
    camera.zoom = Number(state.zoom);
  }
  if (Number.isFinite(Number(state.fov))) {
    camera.fov = Number(state.fov);
  }
  camera.updateProjectionMatrix();
  controls.update();
  suppressCameraSync = false;
}

function emitCameraState() {
  if (!embeddedMode || suppressCameraSync || window.parent === window) {
    return;
  }
  if (pendingCameraSyncFrame !== null) {
    return;
  }
  pendingCameraSyncFrame = window.requestAnimationFrame(() => {
    pendingCameraSyncFrame = null;
    window.parent.postMessage({
      type: 'word-viewer:camera-change',
      camera: cameraState(),
    }, window.location.origin);
  });
}

function resolveWordUrl(input) {
  const value = String(input || '').trim();

  if (!value) {
    throw new Error('Enter a word or word JSON path.');
  }

  if (value.endsWith('.json') || value.startsWith('/') || value.startsWith('http')) {
    return value;
  }

  return `/words/${encodeURIComponent(value)}.json`;
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }

  return response.json();
}

async function loadWordIndex() {
  try {
    const payload = await fetchJson('/words-index.json');
    wordIndexEntries = Array.isArray(payload.words) ? payload.words : [];
    renderWordOptions();
  } catch (error) {
    console.warn(error);
    wordSelect.innerHTML = '';
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Word list unavailable';
    wordSelect.append(option);
    wordSelect.disabled = true;
  }
}

function qaSourceWords(entries) {
  const sources = new Set();
  entries.forEach((entry) => {
    if (entry.qaKind && entry.qaKind !== 'source') {
      sources.add(entry.sourceWord);
    }
  });
  return sources;
}

function renderWordOptions() {
  const qaSources = qaSourceWords(wordIndexEntries);
  const words = qaOnlyWords
    ? wordIndexEntries.filter((entry) => qaSources.has(entry.sourceWord))
    : wordIndexEntries;

  wordSelect.innerHTML = '';

  if (!words.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = qaOnlyWords ? 'No QA words' : 'No words';
    wordSelect.append(option);
    wordSelect.disabled = true;
    return;
  }

  wordSelect.disabled = false;
  words.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.word;
    option.textContent = entry.label ?? entry.word;
    wordSelect.append(option);
  });

  const currentValue = String(wordInput.value || initialWord);
  const selectedOption = Array.from(wordSelect.options).find((option) => option.value === currentValue)
    ?? Array.from(wordSelect.options).find((option) => option.value === initialWord);
  if (selectedOption) {
    wordSelect.value = selectedOption.value;
  }

  if (qaWordFilterButton) {
    qaWordFilterButton.classList.toggle('is-active', qaOnlyWords);
    qaWordFilterButton.textContent = qaOnlyWords ? 'All Words' : 'QA Only';
    qaWordFilterButton.title = qaOnlyWords ? 'Show all words' : 'Show only words that have QA copies';
  }
}

function valuesFor(block, partName) {
  const values = block?.[partName]?.values;
  return Array.isArray(values) ? values : null;
}

function flattenPoints(points, fallbackSize) {
  if (!Array.isArray(points)) {
    return [];
  }

  const output = [];
  points.forEach((point) => {
    for (let index = 0; index < fallbackSize; index += 1) {
      output.push(Number(point?.[index]) || 0);
    }
  });
  return output;
}

function build3DFrame(imageFrame, depthFrame, explicitFrame, imageSpace) {
  if (Array.isArray(explicitFrame)) {
    return explicitFrame.flatMap((point, index) => {
      const imagePoint = imageFrame?.[index] ?? [];
      const x = Number(point?.[0]) || 0;
      const y = Number(point?.[1]) || 0;
      const z = Number(point?.[2]) || 0;
      const confidence = Number(point?.[3] ?? imagePoint?.[2]) || 0;
      return [x, y, z, confidence];
    });
  }

  const width = Number(imageSpace?.width) || 1920;
  const height = Number(imageSpace?.height) || 1080;
  const coordinateScale = Math.max(1, height);

  return (imageFrame ?? []).flatMap((point, index) => {
    const depthPoint = depthFrame?.[index] ?? [];
    const x = ((Number(point?.[0]) || 0) - width * 0.5) / coordinateScale;
    const y = ((Number(point?.[1]) || 0) - height * 0.5) / coordinateScale;
    const z = -(Number(depthPoint?.[0]) || 0);
    const confidence = Math.min(
      Number(point?.[2]) || 0,
      Number(depthPoint?.[1] ?? point?.[2]) || 0,
    );
    return [x, y, z, confidence];
  });
}

function pick3DBlock(keypoints, wordName = '') {
  if (wordName.startsWith('post_v0_5') && keypoints?.postprocessed_3d) {
    return keypoints.postprocessed_3d;
  }

  if (keypoints?.estimated_3d) {
    return keypoints.estimated_3d;
  }

  if (keypoints?.calibrated_3d) {
    return keypoints.calibrated_3d;
  }

  return null;
}

function buildWordFrames(payload) {
  const sample = payload?.sample;
  const keypoints = sample?.keypoints;
  const image2d = keypoints?.image_2d;
  const depthHint = keypoints?.depth_hint;
  const explicit3d = pick3DBlock(keypoints, String(payload?.word || ''));
  const imageSpace = sample?.spaces?.image_2d;

  if (!sample || !image2d) {
    throw new Error('Word JSON must contain sample.keypoints.image_2d.');
  }

  const pose2d = valuesFor(image2d, 'pose');
  const left2d = valuesFor(image2d, 'left_hand');
  const right2d = valuesFor(image2d, 'right_hand');
  const face2d = valuesFor(image2d, 'face');

  if (!pose2d || !left2d || !right2d || !face2d) {
    throw new Error('Word JSON is missing 2D pose, hand, or face keypoints.');
  }

  const pose3d = valuesFor(explicit3d, 'pose');
  const left3d = valuesFor(explicit3d, 'left_hand');
  const right3d = valuesFor(explicit3d, 'right_hand');
  const face3d = valuesFor(explicit3d, 'face');
  const poseDepth = valuesFor(depthHint, 'pose');
  const leftDepth = valuesFor(depthHint, 'left_hand');
  const rightDepth = valuesFor(depthHint, 'right_hand');
  const faceDepth = valuesFor(depthHint, 'face');
  const frameCount = Number(sample.segment?.frame_count) || pose2d.length;

  return Array.from({ length: frameCount }, (_, frameIndex) => ({
    frame_index: frameIndex,
    people: {
      pose_keypoints_2d: flattenPoints(pose2d[frameIndex], 3),
      hand_left_keypoints_2d: flattenPoints(left2d[frameIndex], 3),
      hand_right_keypoints_2d: flattenPoints(right2d[frameIndex], 3),
      face_keypoints_2d: flattenPoints(face2d[frameIndex], 3),
      pose_keypoints_3d: build3DFrame(pose2d[frameIndex], poseDepth?.[frameIndex], pose3d?.[frameIndex], imageSpace),
      hand_left_keypoints_3d: build3DFrame(left2d[frameIndex], leftDepth?.[frameIndex], left3d?.[frameIndex], imageSpace),
      hand_right_keypoints_3d: build3DFrame(right2d[frameIndex], rightDepth?.[frameIndex], right3d?.[frameIndex], imageSpace),
      face_keypoints_3d: build3DFrame(face2d[frameIndex], faceDepth?.[frameIndex], face3d?.[frameIndex], imageSpace),
    },
  }));
}

function hasReliableHandBasis(handPoints, minConfidence = 0.05) {
  return [0, 5, 9, 13].every((index) =>
    getKeypoint3DConfidence(handPoints, index) >= minConfidence,
  );
}

async function loadWord(input = wordInput.value) {
  stopPlayback();
  const url = resolveWordUrl(input);
  const payload = await fetchJson(url);
  const frames = buildWordFrames(payload);

  if (!frames.length) {
    throw new Error('Word JSON contains no frames.');
  }

  avatarState.word = payload;
  avatarState.frames = frames;
  avatarState.pendingFrameIndex = 0;
  frameInput.value = '0';
  wordInput.value = payload.word || input;
  setStatus(`Loaded ${payload.word || input} | ${frames.length} frames @ ${wordFps()}fps | ${playbackSpeed()}x`);
  configureKeypointCanvas();
  showFrame(0);
  if (embeddedMode && window.parent !== window) {
    window.parent.postMessage({
      type: 'word-viewer:loaded',
      word: payload.word || input,
      frameCount: frames.length,
      fps: wordFps(),
    }, window.location.origin);
  }

  if (autoplayOnReady) {
    playWord();
  }
}

function applyHeadPose(headPose, smoothing = 1) {
  if (!headPose) {
    return;
  }

  setBoneRotation(
    'Neck',
    new THREE.Euler(headPose.neckPitch ?? 0, headPose.neckYaw ?? 0, headPose.neckRoll ?? 0),
    smoothing,
  );
  setBoneRotation(
    'Head',
    new THREE.Euler(headPose.headPitch ?? 0, headPose.headYaw ?? 0, headPose.headRoll ?? 0),
    smoothing,
  );
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

  const bindLocalDirection = child.position.clone().normalize();
  const bindParentDirection = bindLocalDirection.clone().applyQuaternion(bindRotation);
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

  const targetQuaternion = offset.multiply(bindRotation.clone());
  applyBoneQuaternion(boneName, targetQuaternion, smoothing);
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

  const targetQuaternion = offset.multiply(bindRotation.clone());
  applyBoneQuaternion(boneName, targetQuaternion, smoothing);
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
  } = options;
  avatarState.currentFrameData = frameData;

  const pose = frameData.people.pose_keypoints_3d;
  const leftHand = frameData.people.hand_left_keypoints_3d;
  const rightHand = frameData.people.hand_right_keypoints_3d;

  if (!preserveCurrentPose) {
    resetPose();
  }
  scene.updateMatrixWorld(true);

  const leftShoulder = getKeypoint3D(pose, 5);
  const leftElbow = getKeypoint3D(pose, 6);
  const rightShoulder = getKeypoint3D(pose, 2);
  const rightElbow = getKeypoint3D(pose, 3);
  const correctedLeftArm = computeCorrectedArmPoints(
    frameData,
    'left',
    leftElbow,
    getKeypoint3D(pose, 7),
    { sequence: null, correctionProfile: false, correctionMode: null },
  );
  const correctedRightArm = computeCorrectedArmPoints(
    frameData,
    'right',
    rightElbow,
    getKeypoint3D(pose, 4),
    { sequence: null, correctionProfile: false, correctionMode: null },
  );
  const torsoMotion = computeSharedTorsoMotion(pose);
  const headFaceResult = computeHeadFaceStrategy(frameData, {
    mode: avatarState.faceMode,
    faceCalibration: null,
  });
  const torsoSmoothing = preserveCurrentPose ? Math.min(boneSmoothing, 0.08) : boneSmoothing;
  const shoulderSmoothing = preserveCurrentPose ? Math.min(boneSmoothing, 0.16) : boneSmoothing;

  setBoneTowardDirection('Spine1', 'Spine2', torsoMotion.spine1Direction, {
    smoothing: torsoSmoothing,
    bindBlend: torsoMotion.spine1BindBlend,
  });
  scene.updateMatrixWorld(true);

  setBoneTowardDirection('Spine2', 'Neck', torsoMotion.spine2Direction, {
    smoothing: torsoSmoothing,
    bindBlend: torsoMotion.spine2BindBlend,
  });
  scene.updateMatrixWorld(true);

  applyHeadPose(headFaceResult.headPose, torsoSmoothing);
  scene.updateMatrixWorld(true);

  setBoneTowardDirection('LeftShoulder', 'LeftArm', torsoMotion.leftShoulderDirection, {
    smoothing: shoulderSmoothing,
    bindBlend: torsoMotion.shoulderBindBlend,
  });
  setBoneTowardDirection('RightShoulder', 'RightArm', torsoMotion.rightShoulderDirection, {
    smoothing: shoulderSmoothing,
    bindBlend: torsoMotion.shoulderBindBlend,
  });
  scene.updateMatrixWorld(true);

  setBoneTowardDirection('LeftArm', 'LeftForeArm', pointDirection(leftShoulder, correctedLeftArm.elbow), {
    smoothing: boneSmoothing,
  });
  setBoneTowardDirection('RightArm', 'RightForeArm', pointDirection(rightShoulder, correctedRightArm.elbow), {
    smoothing: boneSmoothing,
  });
  scene.updateMatrixWorld(true);

  setBoneTowardDirection('LeftForeArm', 'LeftHand', pointDirection(correctedLeftArm.elbow, correctedLeftArm.wrist), {
    smoothing: boneSmoothing,
  });
  setBoneTowardDirection('RightForeArm', 'RightHand', pointDirection(correctedRightArm.elbow, correctedRightArm.wrist), {
    smoothing: boneSmoothing,
  });
  scene.updateMatrixWorld(true);

  if (hasReliableHandBasis(leftHand)) {
    setHandOrientationFromFrame(
      'Left',
      getKeypoint3D(leftHand, 0),
      getKeypoint3D(leftHand, 5),
      getKeypoint3D(leftHand, 9),
      getKeypoint3D(leftHand, 13),
      { smoothing: boneSmoothing },
    );
  }
  if (hasReliableHandBasis(rightHand)) {
    setHandOrientationFromFrame(
      'Right',
      getKeypoint3D(rightHand, 0),
      getKeypoint3D(rightHand, 5),
      getKeypoint3D(rightHand, 9),
      getKeypoint3D(rightHand, 13),
      { smoothing: boneSmoothing },
    );
  }
  scene.updateMatrixWorld(true);

  applyFingerChainsFromFrame('Left', leftHand, { smoothing: boneSmoothing });
  applyFingerChainsFromFrame('Right', rightHand, { smoothing: boneSmoothing });
  applyMorphMap(headFaceResult.morphs, morphSmoothing);

  renderKeypointPreview(frameData);
  frameInput.value = String(frameIndex);
  setStatus(`Word ${avatarState.word?.word ?? '-'} | Frame ${frameIndex + 1}/${wordFrames().length} | ${wordFps()}fps | ${playbackSpeed()}x`);
}

function showFrame(rawFrameIndex, options = {}) {
  const frames = wordFrames();
  if (!frames.length) {
    throw new Error('No word loaded.');
  }

  const frameIndex = THREE.MathUtils.clamp(Math.floor(Number(rawFrameIndex) || 0), 0, frames.length - 1);
  applyFrameData(frames[frameIndex], frameIndex, options);
}

function stopPlayback() {
  if (avatarState.playbackAnimationFrame !== null) {
    window.cancelAnimationFrame(avatarState.playbackAnimationFrame);
    avatarState.playbackAnimationFrame = null;
  }

  avatarState.isPlaying = false;
}

function playWord() {
  const frames = wordFrames();
  if (!frames.length) {
    return;
  }

  stopPlayback();
  const startFrame = 0;
  avatarState.isPlaying = true;
  avatarState.playbackStartFrame = startFrame;
  avatarState.playbackStartedAt = performance.now();

  const tick = () => {
    if (!avatarState.isPlaying) {
      return;
    }

    const elapsedSec = (performance.now() - avatarState.playbackStartedAt) / 1000;
    const nextFrame = avatarState.playbackStartFrame + Math.floor(elapsedSec * wordFps() * playbackSpeed());

    if (nextFrame >= frames.length) {
      showFrame(frames.length - 1, {
        preserveCurrentPose: true,
        boneSmoothing: 0.35,
        morphSmoothing: 0.18,
      });
      stopPlayback();
      return;
    }

    showFrame(nextFrame, {
      preserveCurrentPose: true,
      boneSmoothing: 0.35,
      morphSmoothing: 0.18,
    });
    avatarState.playbackAnimationFrame = window.requestAnimationFrame(tick);
  };

  showFrame(startFrame);
  avatarState.playbackAnimationFrame = window.requestAnimationFrame(tick);
}

function toggleFaceZoom(targetCanvasId) {
  const targetCanvas = document.getElementById(targetCanvasId);

  if (targetCanvas) {
    targetCanvas.classList.toggle('is-hidden');
  }
}

function setupUi() {
  loadButton.addEventListener('click', async () => {
    try {
      await loadWord(wordInput.value);
    } catch (error) {
      console.error(error);
      setStatus(error.message);
    }
  });
  playButton.addEventListener('click', () => playWord());
  stopButton.addEventListener('click', () => stopPlayback());
  playbackSpeedSelect?.addEventListener('change', () => {
    if (avatarState.isPlaying) {
      playWord();
      return;
    }
    if (avatarState.frames.length) {
      showFrame(frameInput.value);
    }
  });
  qaWordFilterButton?.addEventListener('click', () => {
    qaOnlyWords = !qaOnlyWords;
    renderWordOptions();
  });
  showFrameButton.addEventListener('click', () => {
    try {
      stopPlayback();
      showFrame(frameInput.value);
    } catch (error) {
      console.error(error);
      setStatus(error.message);
    }
  });
  frameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      showFrameButton.click();
    }
  });
  wordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      loadButton.click();
    }
  });
  wordSelect.addEventListener('change', async (event) => {
    const selectedWord = event.target.value;
    if (!selectedWord) {
      return;
    }

    wordInput.value = selectedWord;
    try {
      await loadWord(selectedWord);
    } catch (error) {
      console.error(error);
      setStatus(error.message);
    }
  });
  expandButtons.forEach((button) => {
    if (button.dataset.faceTarget) {
      button.addEventListener('click', () => toggleFaceZoom(button.dataset.faceTarget));
    }
  });
}

window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'word-viewer:set-speed' && playbackSpeedSelect) {
    const nextSpeed = String(message.speed ?? '');
    if (Array.from(playbackSpeedSelect.options).some((option) => option.value === nextSpeed)) {
      playbackSpeedSelect.value = nextSpeed;
    }
  }

  if (message.type === 'word-viewer:play') {
    if (playbackSpeedSelect && message.speed !== undefined) {
      const nextSpeed = String(message.speed);
      if (Array.from(playbackSpeedSelect.options).some((option) => option.value === nextSpeed)) {
        playbackSpeedSelect.value = nextSpeed;
      }
    }
    playWord();
  }

  if (message.type === 'word-viewer:stop') {
    stopPlayback();
  }

  if (message.type === 'word-viewer:show-frame') {
    stopPlayback();
    if (avatarState.frames.length) {
      showFrame(message.frameIndex);
    }
  }

  if (message.type === 'word-viewer:set-camera') {
    applyCameraState(message.camera);
  }
});

controls.addEventListener('change', emitCameraState);

new GLTFLoader().load(
  '/models/model.glb',
  (gltf) => {
    const avatar = gltf.scene;
    avatar.position.set(0, 0, 0);
    scene.add(avatar);

    const morphTargetNames = new Set();
    avatar.traverse((child) => {
      if (child.isBone) {
        rememberBone(child);
      }

      if (child.isMesh && child.morphTargetDictionary) {
        avatarState.morphMeshes.push(child);
        Object.keys(child.morphTargetDictionary).forEach((name) => morphTargetNames.add(name));
      }

      if (child.isMesh) {
        child.castShadow = true;
        child.frustumCulled = false;
      }
    });

    const avatarBox = new THREE.Box3().setFromObject(avatar);
    const center = avatarBox.getCenter(new THREE.Vector3());
    avatar.position.sub(center);
    avatar.position.y = 0;
    avatarState.supportedMorphNames = morphTargetNames;
    avatarState.loaded = true;

    if (avatarState.frames.length) {
      showFrame(avatarState.pendingFrameIndex);
    }
  },
  undefined,
  (error) => {
    console.error(error);
    setStatus(error.message);
  },
);

function onResize() {
  const width = container.clientWidth;
  const height = container.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  configureKeypointCanvas();
}

window.addEventListener('resize', onResize);

const clock = new THREE.Clock();

function animate() {
  const elapsed = clock.getElapsedTime();
  controls.update();
  keyLight.position.x = Math.cos(elapsed * 0.2) * 3;
  keyLight.position.z = Math.sin(elapsed * 0.2) * 3;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

setupUi();
configureKeypointCanvas();
loadWordIndex();
loadWord(initialWord).catch((error) => {
  console.error(error);
  setStatus(error.message);
});
animate();
