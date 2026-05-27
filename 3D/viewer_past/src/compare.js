import './compare.css';
import {
  DEFAULT_COMPARE_MANIFEST_PATH,
  createReportLoader,
  createViewerUrl,
  findSequence,
  loadCompareManifest,
  pairDurationSeconds,
} from './compare/manifest-client.js';
import {
  applyManifestMeta,
  collectCompareElements,
  populatePairSelect,
  renderError,
  renderPairDetails,
  selectPairOption,
  setViewerSources,
  updatePairSelectVisibility,
  updateProgress,
} from './compare/dom-renderer.js';
import { createPlaybackController } from './compare/playback-controller.js';

const urlParams = new URLSearchParams(window.location.search);
const compareManifestPath = urlParams.get('manifest') || DEFAULT_COMPARE_MANIFEST_PATH;
const initialPairId = urlParams.get('pair');

const elements = collectCompareElements();
const loadPairReport = createReportLoader();
const playback = createPlaybackController({
  leftFrameEl: elements.leftFrameEl,
  rightFrameEl: elements.rightFrameEl,
  onProgress: (ratio) => updateProgress(elements, ratio),
});

const state = {
  manifest: null,
  currentPair: null,
};

async function renderPair(pair) {
  state.currentPair = pair;
  playback.setPair(pair, pairDurationSeconds(state.manifest, pair));

  const leftSequence = findSequence(state.manifest, pair.leftSequenceId);
  const rightSequence = findSequence(state.manifest, pair.rightSequenceId);
  const report = await loadPairReport(pair);

  renderPairDetails(elements, {
    pair,
    leftSequence,
    rightSequence,
    report,
  });
  setViewerSources(elements, {
    leftUrl: createViewerUrl(compareManifestPath, pair.leftSequenceId),
    rightUrl: createViewerUrl(compareManifestPath, pair.rightSequenceId),
  });
}

function bindUi() {
  elements.playButtonEl.addEventListener('click', () => playback.play());
  elements.stopButtonEl.addEventListener('click', () => playback.stop());
  elements.resetButtonEl.addEventListener('click', () => playback.reset());
  elements.pairSelectEl.addEventListener('change', (event) => {
    const nextPair = state.manifest?.pairs?.find((pair) => pair.id === event.target.value);
    if (nextPair) {
      playback.stop();
      renderPair(nextPair).catch((error) => {
        console.error(error);
      });
    }
  });
  elements.progressRangeEl.addEventListener('input', (event) => {
    playback.seek(Number(event.target.value) / 1000);
  });

  window.addEventListener('message', (event) => {
    playback.handleViewerMessage(event.data);
  });
}

async function init() {
  bindUi();
  const manifest = await loadCompareManifest(compareManifestPath);
  state.manifest = manifest;
  applyManifestMeta(elements, manifest);
  const pairs = Array.isArray(manifest?.pairs) ? manifest.pairs : [];

  if (!pairs.length) {
    throw new Error('No compare pairs found in compare manifest.');
  }

  populatePairSelect(elements, pairs);
  updatePairSelectVisibility(elements, pairs);
  const pair =
    pairs.find((entry) => entry.id === initialPairId) ??
    pairs[0];
  selectPairOption(elements, pair);
  await renderPair(pair);
}

init().catch((error) => {
  console.error(error);
  renderError(elements, error);
});
