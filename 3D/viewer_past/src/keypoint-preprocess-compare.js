import './keypoint-preprocess-compare.css';

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
];

const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [1, 5], [5, 6], [6, 7], [1, 8],
  [8, 9], [9, 10], [10, 11],
  [8, 12], [12, 13], [13, 14],
];

const sourceSelect = document.querySelector('#source-word-select');
const speedSelect = document.querySelector('#compare-speed');
const loadButton = document.querySelector('#load-pair');
const playButton = document.querySelector('#play-pair');
const statusEl = document.querySelector('#compare-status');
const originalCanvas = document.querySelector('#original-canvas');
const overlayCanvas = document.querySelector('#overlay-canvas');
const correctedCanvas = document.querySelector('#corrected-canvas');
const originalMetaEl = document.querySelector('#original-meta');
const overlayMetaEl = document.querySelector('#overlay-meta');
const correctedMetaEl = document.querySelector('#corrected-meta');
const frameRange = document.querySelector('#frame-range');
const frameLabel = document.querySelector('#frame-label');

const urlParams = new URLSearchParams(window.location.search);
const initialSourceWord = urlParams.get('source') || urlParams.get('word') || '0';

const state = {
  pairs: [],
  currentPair: null,
  originalPayload: null,
  correctedPayload: null,
  frameIndex: 0,
  animationFrame: null,
  playbackStartedAt: 0,
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

function valuesFor(payload, partName) {
  const values = payload?.sample?.keypoints?.image_2d?.[partName]?.values;
  return Array.isArray(values) ? values : [];
}

function frameCount(payload) {
  const segmentCount = Number(payload?.sample?.segment?.frame_count);
  if (Number.isFinite(segmentCount) && segmentCount > 0) {
    return segmentCount;
  }
  return Math.max(0, ...['pose', 'left_hand', 'right_hand', 'face'].map((part) => valuesFor(payload, part).length));
}

function fps(payload) {
  return Number(payload?.sample?.segment?.fps) || 30;
}

function point(frame, index) {
  const item = Array.isArray(frame) ? frame[index] : null;
  if (!Array.isArray(item) || item.length < 2) {
    return null;
  }
  const x = Number(item[0]);
  const y = Number(item[1]);
  const confidence = Number(item[2] ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y, confidence: Number.isFinite(confidence) ? confidence : 0 };
}

function allFramePoints(payloads, maxFrames) {
  const points = [];
  payloads.forEach((payload) => {
    ['pose', 'left_hand', 'right_hand'].forEach((part) => {
      const frames = valuesFor(payload, part);
      frames.slice(0, maxFrames).forEach((frame) => {
        if (!Array.isArray(frame)) {
          return;
        }
        frame.forEach((rawPoint) => {
          const p = point([rawPoint], 0);
          if (p && p.confidence > 0) {
            points.push(p);
          }
        });
      });
    });
  });
  return points;
}

function computeViewBox(originalPayload, correctedPayload, maxFrames) {
  const points = allFramePoints([originalPayload, correctedPayload], maxFrames);
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 1920, maxY: 1080 };
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = Math.max(40, Math.max(maxX - minX, maxY - minY) * 0.08);
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.max(320, Math.floor(rect.width * scale));
  canvas.height = Math.max(240, Math.floor(rect.height * scale));
}

function createTransform(canvas, viewBox) {
  const width = canvas.width;
  const height = canvas.height;
  const sourceWidth = Math.max(1, viewBox.maxX - viewBox.minX);
  const sourceHeight = Math.max(1, viewBox.maxY - viewBox.minY);
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const offsetX = (width - sourceWidth * scale) * 0.5;
  const offsetY = (height - sourceHeight * scale) * 0.5;
  return (p) => ({
    x: offsetX + (p.x - viewBox.minX) * scale,
    y: offsetY + (p.y - viewBox.minY) * scale,
  });
}

function drawBackground(ctx, canvas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawConnections(ctx, frame, connections, transform, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  connections.forEach(([from, to]) => {
    const a = point(frame, from);
    const b = point(frame, to);
    if (!a || !b || a.confidence <= 0 || b.confidence <= 0) {
      return;
    }
    const ta = transform(a);
    const tb = transform(b);
    ctx.beginPath();
    ctx.moveTo(ta.x, ta.y);
    ctx.lineTo(tb.x, tb.y);
    ctx.stroke();
  });
}

function drawPoints(ctx, frame, transform, color, radius) {
  ctx.fillStyle = color;
  if (!Array.isArray(frame)) {
    return;
  }
  frame.forEach((_, index) => {
    const p = point(frame, index);
    if (!p || p.confidence <= 0) {
      return;
    }
    const tp = transform(p);
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function changedJoints(originalFrame, correctedFrame, thresholdPx = 1.0) {
  const changed = [];
  const maxPoints = Math.max(
    Array.isArray(originalFrame) ? originalFrame.length : 0,
    Array.isArray(correctedFrame) ? correctedFrame.length : 0,
  );
  for (let index = 0; index < maxPoints; index += 1) {
    const original = point(originalFrame, index);
    const corrected = point(correctedFrame, index);
    if (!original || !corrected) {
      continue;
    }
    const distance = Math.hypot(corrected.x - original.x, corrected.y - original.y);
    if (distance > thresholdPx) {
      changed.push({ index, original, corrected, distance });
    }
  }
  return changed;
}

function drawSkeleton(ctx, payload, frameIndex, transform, variant) {
  const pose = valuesFor(payload, 'pose')[frameIndex];
  const left = valuesFor(payload, 'left_hand')[frameIndex];
  const right = valuesFor(payload, 'right_hand')[frameIndex];
  const muted = variant === 'muted';
  drawConnections(ctx, pose, POSE_CONNECTIONS, transform, muted ? 'rgba(125, 211, 252, 0.35)' : '#7dd3fc', muted ? 2 : 4);
  drawConnections(ctx, left, HAND_CONNECTIONS, transform, muted ? 'rgba(251, 146, 60, 0.35)' : '#fb923c', muted ? 2 : 3);
  drawConnections(ctx, right, HAND_CONNECTIONS, transform, muted ? 'rgba(74, 222, 128, 0.35)' : '#4ade80', muted ? 2 : 3);
  drawPoints(ctx, pose, transform, muted ? 'rgba(226, 232, 240, 0.45)' : '#e2e8f0', muted ? 3 : 4);
  drawPoints(ctx, left, transform, muted ? 'rgba(253, 186, 116, 0.45)' : '#fdba74', muted ? 3 : 4);
  drawPoints(ctx, right, transform, muted ? 'rgba(134, 239, 172, 0.45)' : '#86efac', muted ? 3 : 4);
}

function drawChangeOverlay(ctx, originalPayload, correctedPayload, frameIndex, transform) {
  ['left_hand', 'right_hand'].forEach((part) => {
    const originalFrame = valuesFor(originalPayload, part)[frameIndex];
    const correctedFrame = valuesFor(correctedPayload, part)[frameIndex];
    changedJoints(originalFrame, correctedFrame).forEach((change) => {
      const a = transform(change.original);
      const b = transform(change.corrected);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = Math.max(2, Math.min(8, change.distance * 0.08));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

function renderCanvases(frameIndex) {
  if (!state.originalPayload || !state.correctedPayload) {
    return;
  }
  const totalFrames = Math.max(1, Math.min(frameCount(state.originalPayload), frameCount(state.correctedPayload)));
  const clampedFrame = Math.max(0, Math.min(totalFrames - 1, frameIndex));
  state.frameIndex = clampedFrame;
  frameRange.value = String(clampedFrame);
  frameLabel.textContent = `Frame ${clampedFrame + 1} / ${totalFrames}`;

  [originalCanvas, overlayCanvas, correctedCanvas].forEach(fitCanvas);
  const viewBox = computeViewBox(state.originalPayload, state.correctedPayload, totalFrames);

  const originalCtx = originalCanvas.getContext('2d');
  const overlayCtx = overlayCanvas.getContext('2d');
  const correctedCtx = correctedCanvas.getContext('2d');
  const originalTransform = createTransform(originalCanvas, viewBox);
  const overlayTransform = createTransform(overlayCanvas, viewBox);
  const correctedTransform = createTransform(correctedCanvas, viewBox);

  drawBackground(originalCtx, originalCanvas);
  drawSkeleton(originalCtx, state.originalPayload, clampedFrame, originalTransform, 'normal');

  drawBackground(overlayCtx, overlayCanvas);
  drawSkeleton(overlayCtx, state.originalPayload, clampedFrame, overlayTransform, 'muted');
  drawSkeleton(overlayCtx, state.correctedPayload, clampedFrame, overlayTransform, 'normal');
  drawChangeOverlay(overlayCtx, state.originalPayload, state.correctedPayload, clampedFrame, overlayTransform);

  drawBackground(correctedCtx, correctedCanvas);
  drawSkeleton(correctedCtx, state.correctedPayload, clampedFrame, correctedTransform, 'normal');

  const changedCount = ['left_hand', 'right_hand'].reduce((sum, part) => {
    return sum + changedJoints(
      valuesFor(state.originalPayload, part)[clampedFrame],
      valuesFor(state.correctedPayload, part)[clampedFrame],
    ).length;
  }, 0);
  overlayMetaEl.textContent = `${changedCount} changed joints`;
}

function buildPairs(entries) {
  const originalBySource = new Map();
  const correctedBySource = new Map();
  entries.forEach((entry) => {
    if (entry.qaKind === 'original2d_QA_full') {
      originalBySource.set(entry.sourceWord, entry);
    }
    if (entry.qaKind === 'smooth2d_v2_QA_full') {
      correctedBySource.set(entry.sourceWord, entry);
    }
  });
  return Array.from(correctedBySource.entries())
    .filter(([sourceWord]) => originalBySource.has(sourceWord))
    .map(([sourceWord, corrected]) => ({
      sourceWord,
      original: originalBySource.get(sourceWord),
      corrected,
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

function selectedPair() {
  return state.pairs.find((entry) => entry.sourceWord === sourceSelect.value);
}

function stopPlayback() {
  if (state.animationFrame !== null) {
    window.cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }
}

function playSequence() {
  stopPlayback();
  if (!state.originalPayload) {
    return;
  }
  state.playbackStartedAt = performance.now();
  const totalFrames = Math.max(1, Math.min(frameCount(state.originalPayload), frameCount(state.correctedPayload)));
  const tick = () => {
    const elapsedSec = (performance.now() - state.playbackStartedAt) / 1000;
    const nextFrame = Math.floor(elapsedSec * fps(state.originalPayload) * playbackSpeed());
    if (nextFrame >= totalFrames) {
      renderCanvases(totalFrames - 1);
      stopPlayback();
      return;
    }
    renderCanvases(nextFrame);
    state.animationFrame = window.requestAnimationFrame(tick);
  };
  renderCanvases(0);
  state.animationFrame = window.requestAnimationFrame(tick);
}

async function renderPair(pair) {
  stopPlayback();
  state.currentPair = pair;
  sourceSelect.value = pair.sourceWord;
  state.originalPayload = await fetchJson(pair.original.path);
  state.correctedPayload = await fetchJson(pair.corrected.path);
  const totalFrames = Math.max(1, Math.min(frameCount(state.originalPayload), frameCount(state.correctedPayload)));
  frameRange.max = String(Math.max(0, totalFrames - 1));
  frameRange.value = '0';
  originalMetaEl.textContent = pair.original.word;
  correctedMetaEl.textContent = pair.corrected.word;
  statusEl.textContent = `${pair.sourceWord} | original2d vs smooth2d_v2 | ${playbackSpeed()}x`;
  renderCanvases(0);
}

async function init() {
  const payload = await fetchJson('/words-index.json');
  const entries = Array.isArray(payload.words) ? payload.words : [];
  state.pairs = buildPairs(entries);
  if (!state.pairs.length) {
    throw new Error('No original2d/smooth2d_v2 QA pairs found.');
  }
  populateSelect(state.pairs);
  await renderPair(selectInitialPair(state.pairs));

  loadButton.addEventListener('click', () => {
    const pair = selectedPair();
    if (pair) {
      renderPair(pair).catch((error) => {
        statusEl.textContent = error.message;
      });
    }
  });

  playButton.addEventListener('click', playSequence);

  sourceSelect.addEventListener('change', () => {
    const pair = selectedPair();
    if (pair) {
      renderPair(pair).catch((error) => {
        statusEl.textContent = error.message;
      });
    }
  });

  speedSelect.addEventListener('change', () => {
    statusEl.textContent = `${state.currentPair?.sourceWord ?? '-'} | original2d vs smooth2d_v2 | ${playbackSpeed()}x`;
  });

  frameRange.addEventListener('input', () => {
    stopPlayback();
    renderCanvases(Number(frameRange.value) || 0);
  });

  window.addEventListener('resize', () => renderCanvases(state.frameIndex));
}

init().catch((error) => {
  console.error(error);
  statusEl.textContent = error.message;
  sourceSelect.disabled = true;
  speedSelect.disabled = true;
  loadButton.disabled = true;
  playButton.disabled = true;
});
