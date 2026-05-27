import './keypoint-smoothing-compare.css';

const sourceSelect = document.querySelector('#source-word-select');
const modeSelect = document.querySelector('#compare-mode');
const speedSelect = document.querySelector('#compare-speed');
const loadButton = document.querySelector('#load-pair');
const playButton = document.querySelector('#play-pair');
const statusEl = document.querySelector('#compare-status');
const originalFrame = document.querySelector('#original-frame');
const smoothedFrame = document.querySelector('#smoothed-frame');
const originalMetaEl = document.querySelector('#original-meta');
const smoothedMetaEl = document.querySelector('#smoothed-meta');
const frameRange = document.querySelector('#frame-range');
const frameLabel = document.querySelector('#frame-label');

const urlParams = new URLSearchParams(window.location.search);
const initialSourceWord = urlParams.get('source') || urlParams.get('word') || '0';

const state = {
  pairs: [],
  currentPair: null,
  sourcePayload: null,
  animationFrame: null,
  playbackStartedAt: 0,
  camera: null,
  viewerReady: {
    original: false,
    smoothed: false,
  },
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

function predictionMode() {
  return modeSelect?.value === 'sequence' ? 'sequence' : 'center';
}

function viewerUrl(entry) {
  const params = new URLSearchParams({
    src: entry.path,
    embed: '1',
    speed: String(playbackSpeed()),
  });
  return `/index.html?${params.toString()}`;
}

function postToViewers(message) {
  [originalFrame, smoothedFrame].forEach((frame) => {
    frame.contentWindow?.postMessage(message, window.location.origin);
  });
}

function postToFrame(frame, message) {
  frame.contentWindow?.postMessage(message, window.location.origin);
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

function viewersReady() {
  return state.viewerReady.original && state.viewerReady.smoothed;
}

function syncCameraFrom(sourceWindow, camera) {
  state.camera = camera;
  const targetFrame = sourceWindow === originalFrame.contentWindow ? smoothedFrame : originalFrame;
  postCameraToFrame(targetFrame);
}

function buildPairs(entries) {
  const centerOriginalBySource = new Map();
  const centerSmoothBySource = new Map();
  const sequenceOriginalBySource = new Map();
  const sequenceSmoothBySource = new Map();

  entries.forEach((entry) => {
    if (entry.qaKind === 'tcn_v1_center_QA_full') {
      centerOriginalBySource.set(entry.sourceWord, entry);
    }
    if (entry.qaKind === 'tcn_v1_center_smooth2d_QA_full') {
      centerSmoothBySource.set(entry.sourceWord, entry);
    }
    if (entry.qaKind === 'tcn_v1_sequence_QA_full') {
      sequenceOriginalBySource.set(entry.sourceWord, entry);
    }
    if (entry.qaKind === 'tcn_v1_sequence_smooth2d_QA_full') {
      sequenceSmoothBySource.set(entry.sourceWord, entry);
    }
  });

  const sourceWords = new Set([
    ...centerOriginalBySource.keys(),
    ...centerSmoothBySource.keys(),
    ...sequenceOriginalBySource.keys(),
    ...sequenceSmoothBySource.keys(),
  ]);

  return Array.from(sourceWords)
    .map((sourceWord) => ({
      sourceWord,
      center: {
        original: centerOriginalBySource.get(sourceWord),
        smoothed: centerSmoothBySource.get(sourceWord),
      },
      sequence: {
        original: sequenceOriginalBySource.get(sourceWord),
        smoothed: sequenceSmoothBySource.get(sourceWord),
      },
    }))
    .filter((pair) => pair.center.original && pair.center.smoothed && pair.sequence.original && pair.sequence.smoothed)
    .sort((a, b) => a.sourceWord.localeCompare(b.sourceWord, 'ko', {
      numeric: true,
      sensitivity: 'base',
    }));
}

function currentVariant(pair) {
  return pair[predictionMode()];
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
  const segmentCount = Number(payload?.sample?.segment?.frame_count);
  if (Number.isFinite(segmentCount) && segmentCount > 0) {
    return segmentCount;
  }
  return Math.max(0, ...['pose', 'left_hand', 'right_hand'].map((part) => valuesFor(payload, part).length));
}

function fps(payload) {
  return Number(payload?.sample?.segment?.fps) || 30;
}

function stopPlayback() {
  if (state.animationFrame !== null) {
    window.cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }
}

function updateFrameLabel(frameIndex) {
  const totalFrames = Math.max(1, frameCount(state.sourcePayload));
  const clampedFrameIndex = Math.min(totalFrames - 1, Math.max(0, Math.floor(Number(frameIndex) || 0)));
  state.currentFrameIndex = clampedFrameIndex;
  frameRange.value = String(clampedFrameIndex);
  frameLabel.textContent = `Frame ${clampedFrameIndex + 1} / ${totalFrames}`;
}

function playSequence() {
  stopPlayback();
  if (!state.sourcePayload) {
    return;
  }
  state.playbackStartedAt = performance.now();
  const totalFrames = Math.max(1, frameCount(state.sourcePayload));
  const tick = () => {
    const elapsedSec = (performance.now() - state.playbackStartedAt) / 1000;
    const nextFrame = Math.floor(elapsedSec * fps(state.sourcePayload) * playbackSpeed());
    if (nextFrame >= totalFrames) {
      updateFrameLabel(totalFrames - 1);
      postFrameToViewers(totalFrames - 1);
      stopPlayback();
      return;
    }
    updateFrameLabel(nextFrame);
    postFrameToViewers(nextFrame);
    state.animationFrame = window.requestAnimationFrame(tick);
  };
  updateFrameLabel(0);
  postFrameToViewers(0);
  state.animationFrame = window.requestAnimationFrame(tick);
}

async function renderPair(pair) {
  stopPlayback();
  state.currentPair = pair;
  state.viewerReady.original = false;
  state.viewerReady.smoothed = false;
  playButton.disabled = true;
  sourceSelect.value = pair.sourceWord;
  const variant = currentVariant(pair);
  originalFrame.src = viewerUrl(variant.original);
  smoothedFrame.src = viewerUrl(variant.smoothed);
  originalMetaEl.textContent = variant.original.word;
  smoothedMetaEl.textContent = variant.smoothed.word;
  state.sourcePayload = await fetchJson(variant.original.path);
  const totalFrames = Math.max(1, frameCount(state.sourcePayload));
  frameRange.max = String(Math.max(0, totalFrames - 1));
  frameRange.value = '0';
  frameLabel.textContent = `Frame 1 / ${totalFrames}`;
  statusEl.textContent = `${pair.sourceWord} | ${predictionMode()} | original 2D input vs smoothed 2D input | ${playbackSpeed()}x`;
}

function handleViewerMessage(event) {
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
  if (message.type === 'word-viewer:loaded') {
    if (event.source === originalFrame.contentWindow) {
      state.viewerReady.original = true;
      postToFrame(originalFrame, {
        type: 'word-viewer:show-frame',
        frameIndex: state.currentFrameIndex,
      });
    }
    if (event.source === smoothedFrame.contentWindow) {
      state.viewerReady.smoothed = true;
      postToFrame(smoothedFrame, {
        type: 'word-viewer:show-frame',
        frameIndex: state.currentFrameIndex,
      });
    }
    playButton.disabled = !viewersReady();
    if (viewersReady() && state.currentPair) {
      statusEl.textContent = `${state.currentPair.sourceWord} | ${predictionMode()} | original 2D input vs smoothed 2D input | ${playbackSpeed()}x`;
    }
  }
}

async function init() {
  window.addEventListener('message', handleViewerMessage);

  const payload = await fetchJson('/words-index.json');
  const entries = Array.isArray(payload.words) ? payload.words : [];
  state.pairs = buildPairs(entries);

  if (!state.pairs.length) {
    throw new Error('No original/smoothed 3D QA pairs found.');
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
    if (!viewersReady()) {
      statusEl.textContent = `${state.currentPair?.sourceWord ?? '-'} | waiting for both 3D viewers to load`;
      return;
    }
    postToViewers({
      type: 'word-viewer:play',
      speed: String(playbackSpeed()),
    });
    playSequence();
  });

  sourceSelect.addEventListener('change', () => {
    const pair = state.pairs.find((entry) => entry.sourceWord === sourceSelect.value);
    if (pair) {
      renderPair(pair).catch((error) => {
        statusEl.textContent = error.message;
      });
    }
  });

  modeSelect.addEventListener('change', () => {
    if (state.currentPair) {
      renderPair(state.currentPair).catch((error) => {
        statusEl.textContent = error.message;
      });
    }
  });

  speedSelect.addEventListener('change', () => {
    postToViewers({
      type: 'word-viewer:set-speed',
      speed: String(playbackSpeed()),
    });
    statusEl.textContent = `${state.currentPair?.sourceWord ?? '-'} | ${predictionMode()} | original 2D input vs smoothed 2D input | ${playbackSpeed()}x`;
  });

  frameRange.addEventListener('input', () => {
    stopPlayback();
    const frameIndex = Number(frameRange.value) || 0;
    updateFrameLabel(frameIndex);
    postFrameToViewers(frameIndex);
  });

  originalFrame.addEventListener('load', () => postCameraToFrame(originalFrame));
  smoothedFrame.addEventListener('load', () => postCameraToFrame(smoothedFrame));
}

init().catch((error) => {
  console.error(error);
  statusEl.textContent = error.message;
  sourceSelect.disabled = true;
  modeSelect.disabled = true;
  speedSelect.disabled = true;
  loadButton.disabled = true;
  playButton.disabled = true;
});
