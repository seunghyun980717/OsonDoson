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
  getKeypoint3D,
  pointDirection,
} from './viewer/keypoint-utils.js';
import {
  computeCorrectedArmPoints,
  computeSharedTorsoMotion,
  createHandRigAppliers,
} from './viewer/body-motion.js';

const container = document.querySelector('#viewer-canvas');
const frameLabelEl = document.querySelector('#sentence-frame-label');
const keypointCanvas = document.querySelector('#keypoint-canvas');
const referenceVideoEl = document.querySelector('#reference-video');
const referenceFaceCanvas = document.querySelector('#reference-face-canvas');
const keypointFaceCanvas = document.querySelector('#keypoint-face-canvas');
const keypointCorrectionInfoEl = document.querySelector('#keypoint-correction-info');
const pathInput = document.querySelector('#sentence-path-input');
const frameInput = document.querySelector('#sentence-frame-input');
const loadButton = document.querySelector('#load-sentence');
const playButton = document.querySelector('#play-sentence');
const stopButton = document.querySelector('#stop-sentence');
const showFrameButton = document.querySelector('#show-sentence-frame');
const interpolationTestNameInput = document.querySelector('#interpolation-test-name');
const interpolationWordsInput = document.querySelector('#interpolation-words');
const interpolationFramesInput = document.querySelector('#interpolation-frames');
const runInterpolationButton = document.querySelector('#run-interpolation-test');
const interpolationMethodContainer = document.querySelector('#interpolation-methods');
const interpolationReportButton = document.querySelector('#load-interpolation-report');
const interpolationReportEl = document.querySelector('#interpolation-report');

const urlParams = new URLSearchParams(window.location.search);
const initialSentencePath = urlParams.get('src') || '/sen/sentence.json';
const autoplayOnReady = urlParams.get('autoplay') === '1';
const interpolationMethods = ['linear', 'smoothstep', 'hermite', 'catmull_rom', 'bezier'];
pathInput.value = initialSentencePath;

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
  sentence: null,
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

function sentenceFrames() {
  return Array.isArray(avatarState.sentence?.frames) ? avatarState.sentence.frames : [];
}

function sentenceFps() {
  return Number(avatarState.sentence?.fps) || 30;
}

function setStatus(message) {
  frameLabelEl.textContent = message;
}

function setInterpolationReport(message) {
  interpolationReportEl.textContent = message;
}

function setKeypointCorrectionInfo(summary, frameData) {
  if (!keypointCorrectionInfoEl) {
    return;
  }

  const word = frameData?.source_word ? ` | ${frameData.source_word}` : '';
  if (!summary || summary.count <= 0) {
    keypointCorrectionInfoEl.textContent = `Correction: -${word}`;
    return;
  }

  const parts = Object.entries(summary.byPart || {})
    .map(([part, count]) => `${part}:${count}`)
    .join(', ');
  const maxDelta = Number(summary.maxDelta || 0).toFixed(1);
  keypointCorrectionInfoEl.textContent = `Correction: ${summary.count} point(s), max ${maxDelta}px${parts ? ` | ${parts}` : ''}${word}`;
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }

  return response.json();
}

function validateSentence(payload) {
  if (!payload || !Array.isArray(payload.frames) || payload.frames.length === 0) {
    throw new Error('Sentence JSON must contain a non-empty frames array.');
  }

  for (const [index, frame] of payload.frames.entries()) {
    const people = frame?.people;
    if (
      !Array.isArray(people?.pose_keypoints_3d) ||
      !Array.isArray(people?.hand_left_keypoints_3d) ||
      !Array.isArray(people?.hand_right_keypoints_3d)
    ) {
      throw new Error(`Frame ${index} is missing required 3D keypoints.`);
    }
  }
}

async function loadSentence(path = pathInput.value) {
  stopPlayback();
  const payload = await fetchJson(path);
  validateSentence(payload);
  avatarState.sentence = payload;
  avatarState.pendingFrameIndex = 0;
  frameInput.value = '0';
  setStatus(`Loaded ${path} | ${payload.frames.length} frames @ ${sentenceFps()}fps`);
  configureKeypointCanvas();
  showFrame(0, { syncInput: true });

  if (autoplayOnReady) {
    playSentence();
  }
}

function interpolationTestName() {
  return String(interpolationTestNameInput.value || 'default')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    || 'default';
}

function interpolationSentencePath(method) {
  return `/sen/interpolation-tests/${encodeURIComponent(interpolationTestName())}/${method}.json`;
}

function interpolationReportPath() {
  return `/sen/interpolation-tests/${encodeURIComponent(interpolationTestName())}/report.json`;
}

function markActiveInterpolationMethod(method) {
  interpolationMethodContainer.querySelectorAll('[data-method]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.method === method);
  });
}

function wordsForInterpolation() {
  return String(interpolationWordsInput.value || '')
    .split(/[,\s]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

async function runInterpolationTest() {
  const words = wordsForInterpolation();
  if (!words.length) {
    throw new Error('Enter at least one word.');
  }

  const transitionFrames = Math.max(1, Math.floor(Number(interpolationFramesInput.value) || 12));
  const testName = interpolationTestName();
  runInterpolationButton.disabled = true;
  setInterpolationReport('Running...');
  setStatus(`Generating interpolation test: ${testName}`);

  try {
    const response = await fetch('/api/interpolation-tests/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        testName,
        words,
        transitionFrames,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Failed to run interpolation test: ${response.status}`);
    }
    renderInterpolationReport(payload.report);
    await loadInterpolationMethod('smoothstep');
  } finally {
    runInterpolationButton.disabled = false;
  }
}

function renderInterpolationReport(report) {
  if (!report?.methods) {
    setInterpolationReport('Report unavailable.');
    return;
  }

  const lines = Object.entries(report.methods).map(([method, summary]) => {
    const speed = Number(summary.max_speed_ratio || 0).toFixed(2);
    const terminal = Number(summary.terminal_discontinuity || 0).toFixed(3);
    const overshoot = Number(summary.max_overshoot || 0).toFixed(3);
    const seconds = Number(summary.generation_seconds || 0).toFixed(2);
    return `${method}: ${seconds}s, frames ${summary.frame_count}, transition ${summary.transition_frame_count_max}, speed ${speed}, terminal ${terminal}, overshoot ${overshoot}`;
  });
  const source = report.input_source ? `Source: ${report.input_source} | ${report.asset_root || '-'}` : '';
  const warnings = Array.isArray(report.failed_or_warning_methods) && report.failed_or_warning_methods.length
    ? `Warnings: ${report.failed_or_warning_methods.join(', ')}`
    : 'Warnings: -';
  setInterpolationReport(`${source ? `${source}\n` : ''}${warnings}\n${lines.join('\n')}`);
}

async function loadInterpolationReport() {
  const report = await fetchJson(interpolationReportPath());
  renderInterpolationReport(report);
}

async function loadInterpolationMethod(method) {
  if (!interpolationMethods.includes(method)) {
    throw new Error(`Unknown interpolation method: ${method}`);
  }
  const path = interpolationSentencePath(method);
  pathInput.value = path;
  markActiveInterpolationMethod(method);
  await loadSentence(path);
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

  const neck = getKeypoint3D(pose, 1);
  const leftShoulder = getKeypoint3D(pose, 5);
  const leftElbow = getKeypoint3D(pose, 6);
  const leftWrist = getKeypoint3D(pose, 7);
  const rightShoulder = getKeypoint3D(pose, 2);
  const rightElbow = getKeypoint3D(pose, 3);
  const rightWrist = getKeypoint3D(pose, 4);
  const correctedLeftArm = computeCorrectedArmPoints(
    frameData,
    'left',
    leftElbow,
    leftWrist,
    { sequence: null, correctionProfile: false, correctionMode: null },
  );
  const correctedRightArm = computeCorrectedArmPoints(
    frameData,
    'right',
    rightElbow,
    rightWrist,
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

  const leftHandBase = getKeypoint3D(leftHand, 0);
  const leftIndexBase = getKeypoint3D(leftHand, 5);
  const leftMiddleBase = getKeypoint3D(leftHand, 9);
  const leftRingBase = getKeypoint3D(leftHand, 13);
  const rightHandBase = getKeypoint3D(rightHand, 0);
  const rightIndexBase = getKeypoint3D(rightHand, 5);
  const rightMiddleBase = getKeypoint3D(rightHand, 9);
  const rightRingBase = getKeypoint3D(rightHand, 13);

  setHandOrientationFromFrame('Left', leftHandBase, leftIndexBase, leftMiddleBase, leftRingBase, {
    smoothing: boneSmoothing,
  });
  setHandOrientationFromFrame('Right', rightHandBase, rightIndexBase, rightMiddleBase, rightRingBase, {
    smoothing: boneSmoothing,
  });
  scene.updateMatrixWorld(true);

  applyFingerChainsFromFrame('Left', leftHand, { smoothing: boneSmoothing });
  applyFingerChainsFromFrame('Right', rightHand, { smoothing: boneSmoothing });
  applyMorphMap(headFaceResult.morphs, morphSmoothing);

  const correctionSummary = renderKeypointPreview(frameData);
  setKeypointCorrectionInfo(correctionSummary, frameData);
  frameInput.value = String(frameIndex);
  setStatus(`Frame ${frameIndex + 1}/${sentenceFrames().length} | ${sentenceFps()}fps`);
}

function showFrame(rawFrameIndex, options = {}) {
  const frames = sentenceFrames();
  if (!frames.length) {
    throw new Error('No sentence loaded.');
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

function playSentence() {
  const frames = sentenceFrames();
  if (!frames.length) {
    return;
  }

  stopPlayback();
  const startFrame = THREE.MathUtils.clamp(Math.floor(Number(frameInput.value) || 0), 0, frames.length - 1);
  avatarState.isPlaying = true;
  avatarState.playbackStartFrame = startFrame;
  avatarState.playbackStartedAt = performance.now();

  const tick = () => {
    if (!avatarState.isPlaying) {
      return;
    }

    const elapsedSec = (performance.now() - avatarState.playbackStartedAt) / 1000;
    const nextFrame = avatarState.playbackStartFrame + Math.floor(elapsedSec * sentenceFps());

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

function setupUi() {
  loadButton.addEventListener('click', async () => {
    try {
      await loadSentence(pathInput.value);
    } catch (error) {
      console.error(error);
      setStatus(error.message);
    }
  });
  playButton.addEventListener('click', () => playSentence());
  stopButton.addEventListener('click', () => stopPlayback());
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
  pathInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      loadButton.click();
    }
  });
  runInterpolationButton.addEventListener('click', async () => {
    try {
      await runInterpolationTest();
    } catch (error) {
      console.error(error);
      setStatus(error.message);
      setInterpolationReport(error.message);
    }
  });
  interpolationMethodContainer.addEventListener('click', async (event) => {
    const method = event.target?.dataset?.method;
    if (!method) {
      return;
    }
    try {
      await loadInterpolationMethod(method);
    } catch (error) {
      console.error(error);
      setStatus(error.message);
    }
  });
  interpolationReportButton.addEventListener('click', async () => {
    try {
      await loadInterpolationReport();
    } catch (error) {
      console.error(error);
      setStatus(error.message);
      setInterpolationReport(error.message);
    }
  });
}

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

    if (avatarState.sentence) {
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
loadSentence(initialSentencePath).catch((error) => {
  console.error(error);
  setStatus(error.message);
});
animate();
