import './tcn-compare.css';

const sourceSelect = document.querySelector('#source-word-select');
const speedSelect = document.querySelector('#compare-speed');
const loadButton = document.querySelector('#load-pair');
const playButton = document.querySelector('#play-pair');
const statusEl = document.querySelector('#compare-status');
const centerFrame = document.querySelector('#center-frame');
const sequenceFrame = document.querySelector('#sequence-frame');
const centerWordEl = document.querySelector('#center-word');
const sequenceWordEl = document.querySelector('#sequence-word');
const sequence2dCanvas = document.querySelector('#sequence-2d-canvas');
const sequence2dMetaEl = document.querySelector('#sequence-2d-meta');
const frameRange = document.querySelector('#frame-range');
const frameLabel = document.querySelector('#frame-label');

const urlParams = new URLSearchParams(window.location.search);
const initialSourceWord = urlParams.get('source') || urlParams.get('word') || '0';

const POSE_EDGES = [
  [1, 2], [2, 3], [3, 4],
  [1, 5], [5, 6], [6, 7],
  [1, 8], [8, 9], [9, 10],
  [8, 12], [12, 13],
  [1, 0], [0, 15], [0, 16],
];
const HAND_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
];

const state = {
  pairs: [],
  currentPair: null,
  sourcePayload: null,
  animationFrame: null,
  playbackStartedAt: 0,
  camera: null,
  currentFrameIndex: 0,
};

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.json();
}

function playbackSpeed() {
  const value = Number(speedSelect?.value || 1);
  return Number.isFinite(value) ? Math.min(1, Math.max(0.25, value)) : 1;
}

function viewerUrl(word) {
  const params = new URLSearchParams({
    word,
    embed: '1',
    speed: String(playbackSpeed()),
  });
  return `/index.html?${params.toString()}`;
}

function postToViewers(message) {
  [centerFrame, sequenceFrame].forEach((frame) => {
    frame.contentWindow?.postMessage(message, window.location.origin);
  });
}

function postCameraToFrame(frame) {
  if (!state.camera) {
    return;
  }
  frame.contentWindow?.postMessage({
    type: 'word-viewer:set-camera',
    camera: state.camera,
  }, window.location.origin);
}

function postFrameToViewers(frameIndex) {
  postToViewers({
    type: 'word-viewer:show-frame',
    frameIndex,
  });
}

function syncCameraFrom(sourceWindow, camera) {
  state.camera = camera;
  const targetFrame = sourceWindow === centerFrame.contentWindow ? sequenceFrame : centerFrame;
  postCameraToFrame(targetFrame);
}

function buildPairs(entries) {
  const centerBySource = new Map();
  const sequenceBySource = new Map();
  const original2dBySource = new Map();

  entries.forEach((entry) => {
    if (entry.qaKind === 'tcn_v1_center_QA_full') {
      centerBySource.set(entry.sourceWord, entry);
    }
    if (entry.qaKind === 'tcn_v1_sequence_QA_full') {
      sequenceBySource.set(entry.sourceWord, entry);
    }
    if (entry.qaKind === 'original2d_QA_full') {
      original2dBySource.set(entry.sourceWord, entry);
    }
  });

  return Array.from(centerBySource.entries())
    .filter(([sourceWord]) => sequenceBySource.has(sourceWord) && original2dBySource.has(sourceWord))
    .map(([sourceWord, center]) => ({
      sourceWord,
      center,
      sequence: sequenceBySource.get(sourceWord),
      original2d: original2dBySource.get(sourceWord),
    }))
    .sort((a, b) => a.sourceWord.localeCompare(b.sourceWord, 'ko', {
      numeric: true,
      sensitivity: 'base',
    }));
}

function populateSelect(pairs) {
  sourceSelect.innerHTML = '';
  pairs.forEach((pair) => {
    const option = document.createElement('option');
    option.value = pair.sourceWord;
    option.textContent = pair.sourceWord;
    sourceSelect.append(option);
  });
}

function selectInitialPair(pairs) {
  return pairs.find((pair) => pair.sourceWord === initialSourceWord)
    ?? pairs.find((pair) => pair.sourceWord === '0')
    ?? pairs[0];
}

function valuesFor(payload, partName) {
  const values = payload?.sample?.keypoints?.image_2d?.[partName]?.values;
  return Array.isArray(values) ? values : [];
}

function frameCount(payload) {
  return Number(payload?.sample?.segment?.frame_count) || valuesFor(payload, 'pose').length;
}

function fps(payload) {
  return Number(payload?.sample?.segment?.fps) || 30;
}

function confidence(point) {
  return Number(point?.[2]) || 0;
}

function pointBounds(frames) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  frames.forEach((points) => {
    points.forEach((point) => {
      if (!Array.isArray(point) || confidence(point) <= 0.01) {
        return;
      }
      const x = Number(point[0]);
      const y = Number(point[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
  });
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, maxX: 1920, maxY: 1080 };
  }
  return { minX, minY, maxX, maxY };
}

function drawEdges(ctx, points, edges, color, mapPoint) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  edges.forEach(([a, b]) => {
    const pointA = points[a];
    const pointB = points[b];
    if (confidence(pointA) <= 0.02 || confidence(pointB) <= 0.02) {
      return;
    }
    const [x1, y1] = mapPoint(pointA);
    const [x2, y2] = mapPoint(pointB);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });
}

function drawPoints(ctx, points, color, mapPoint, radius = 2.8) {
  ctx.fillStyle = color;
  points.forEach((point) => {
    if (confidence(point) <= 0.02) {
      return;
    }
    const [x, y] = mapPoint(point);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function draw2dFrame(frameIndex) {
  const payload = state.sourcePayload;
  const canvas = sequence2dCanvas;
  const ctx = canvas.getContext('2d');
  const cssWidth = canvas.clientWidth || 320;
  const cssHeight = canvas.clientHeight || 240;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(cssWidth * scale));
  canvas.height = Math.max(1, Math.floor(cssHeight * scale));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  if (!payload) {
    return;
  }
  const totalFrames = frameCount(payload);
  const clampedFrameIndex = Math.min(totalFrames - 1, Math.max(0, Math.floor(Number(frameIndex) || 0)));
  state.currentFrameIndex = clampedFrameIndex;
  frameRange.value = String(clampedFrameIndex);
  frameLabel.textContent = `Frame ${clampedFrameIndex + 1} / ${totalFrames}`;

  const poseFrames = valuesFor(payload, 'pose');
  const leftFrames = valuesFor(payload, 'left_hand');
  const rightFrames = valuesFor(payload, 'right_hand');
  const pose = poseFrames[clampedFrameIndex] || [];
  const left = leftFrames[clampedFrameIndex] || [];
  const right = rightFrames[clampedFrameIndex] || [];
  const bounds = pointBounds([pose, left, right]);
  const padding = 28;
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  const fit = Math.min((cssWidth - padding * 2) / sourceWidth, (cssHeight - padding * 2) / sourceHeight);
  const offsetX = (cssWidth - sourceWidth * fit) * 0.5;
  const offsetY = (cssHeight - sourceHeight * fit) * 0.5;
  const mapPoint = (point) => [
    offsetX + (Number(point[0]) - bounds.minX) * fit,
    offsetY + (Number(point[1]) - bounds.minY) * fit,
  ];

  drawEdges(ctx, pose, POSE_EDGES, '#38bdf8', mapPoint);
  drawEdges(ctx, left, HAND_EDGES, '#f97316', mapPoint);
  drawEdges(ctx, right, HAND_EDGES, '#22c55e', mapPoint);
  drawPoints(ctx, pose, '#bae6fd', mapPoint, 3);
  drawPoints(ctx, left, '#fed7aa', mapPoint, 2.5);
  drawPoints(ctx, right, '#bbf7d0', mapPoint, 2.5);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '12px "Segoe UI", sans-serif';
  ctx.fillText(`Frame ${clampedFrameIndex + 1}/${totalFrames} | ${playbackSpeed()}x`, 12, 22);
  sequence2dMetaEl.textContent = `${clampedFrameIndex + 1}/${totalFrames} @ ${fps(payload)}fps`;
}

function stop2dPlayback() {
  if (state.animationFrame !== null) {
    window.cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }
}

function play2dSequence() {
  stop2dPlayback();
  const payload = state.sourcePayload;
  if (!payload) {
    return;
  }
  state.playbackStartedAt = performance.now();
  const totalFrames = frameCount(payload);
  const tick = () => {
    const elapsedSec = (performance.now() - state.playbackStartedAt) / 1000;
    const nextFrame = Math.floor(elapsedSec * fps(payload) * playbackSpeed());
    if (nextFrame >= totalFrames) {
      draw2dFrame(totalFrames - 1);
      postFrameToViewers(totalFrames - 1);
      stop2dPlayback();
      return;
    }
    draw2dFrame(nextFrame);
    postFrameToViewers(nextFrame);
    state.animationFrame = window.requestAnimationFrame(tick);
  };
  draw2dFrame(0);
  postFrameToViewers(0);
  state.animationFrame = window.requestAnimationFrame(tick);
}

async function renderPair(pair) {
  stop2dPlayback();
  state.currentPair = pair;
  sourceSelect.value = pair.sourceWord;
  centerFrame.src = viewerUrl(pair.center.word);
  sequenceFrame.src = viewerUrl(pair.sequence.word);
  centerWordEl.textContent = pair.center.word;
  sequenceWordEl.textContent = pair.sequence.word;
  statusEl.textContent = `${pair.sourceWord} | center vs original2d vs sequence | ${playbackSpeed()}x`;
  state.sourcePayload = await fetchJson(pair.original2d.path);
  const totalFrames = frameCount(state.sourcePayload);
  frameRange.max = String(Math.max(0, totalFrames - 1));
  frameRange.value = '0';
  frameLabel.textContent = `Frame 1 / ${totalFrames}`;
  draw2dFrame(0);
}

async function init() {
  const payload = await fetchJson('/words-index.json');
  const entries = Array.isArray(payload.words) ? payload.words : [];
  state.pairs = buildPairs(entries);

  if (!state.pairs.length) {
    throw new Error('No matching TCN center/sequence QA pairs found.');
  }

  populateSelect(state.pairs);
  await renderPair(selectInitialPair(state.pairs));

  loadButton.addEventListener('click', () => {
    const pair = state.pairs.find((entry) => entry.sourceWord === sourceSelect.value);
    if (pair) {
      renderPair(pair).catch((error) => {
        statusEl.textContent = error.message;
      });
    }
  });

  playButton.addEventListener('click', () => {
    postToViewers({
      type: 'word-viewer:play',
      speed: String(playbackSpeed()),
    });
    play2dSequence();
  });

  sourceSelect.addEventListener('change', () => {
    const pair = state.pairs.find((entry) => entry.sourceWord === sourceSelect.value);
    if (pair) {
      renderPair(pair).catch((error) => {
        statusEl.textContent = error.message;
      });
    }
  });

  speedSelect.addEventListener('change', () => {
    postToViewers({
      type: 'word-viewer:set-speed',
      speed: String(playbackSpeed()),
    });
    statusEl.textContent = `${state.currentPair?.sourceWord ?? '-'} | center vs original2d vs sequence | ${playbackSpeed()}x`;
    draw2dFrame(0);
  });

  frameRange.addEventListener('input', () => {
    stop2dPlayback();
    const frameIndex = Number(frameRange.value) || 0;
    draw2dFrame(frameIndex);
    postFrameToViewers(frameIndex);
  });

  window.addEventListener('resize', () => {
    draw2dFrame(0);
  });

  centerFrame.addEventListener('load', () => postCameraToFrame(centerFrame));
  sequenceFrame.addEventListener('load', () => postCameraToFrame(sequenceFrame));

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) {
      return;
    }
    const message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'word-viewer:camera-change') {
      syncCameraFrom(event.source, message.camera);
    }
  });
}

init().catch((error) => {
  console.error(error);
  statusEl.textContent = error.message;
  sourceSelect.disabled = true;
  speedSelect.disabled = true;
  loadButton.disabled = true;
  playButton.disabled = true;
});
