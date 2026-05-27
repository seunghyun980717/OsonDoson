const DEFAULT_SEQUENCE_MANIFEST_PATH =
  import.meta.env?.VITE_SEQUENCE_MANIFEST_PATH ?? '/data/sequence-manifest.json';
const COMPARE_REGISTRY_PATH =
  import.meta.env?.VITE_COMPARE_REGISTRY_PATH ?? '/data/interpolation-compare-registry.json';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getFrameCacheKey(sequence, frameName) {
  return `${sequence.key}/${frameName}`;
}

async function fetchJson(path, errorMessage) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`${errorMessage}: ${response.status}`);
  }

  return response.json();
}

export function buildCompareViewerUrl(entry) {
  const params = new URLSearchParams({
    manifest: entry.manifest,
  });

  if (entry.defaultPairId) {
    params.set('pair', entry.defaultPairId);
  }

  return `/compare.html?${params.toString()}`;
}

export function buildFrameNameFromNumber(frameNumber, sequence) {
  if (!sequence) {
    throw new Error('No active sequence selected.');
  }

  return `${sequence.key}_${String(frameNumber).padStart(12, '0')}_keypoints.json`;
}

export function getFrameNumberFromName(frameName) {
  const match = frameName.match(/_(\d{12})_keypoints\.json$/);
  return match ? Number(match[1]) : null;
}

export function pickRandomMiddleFrameName(files) {
  const start = Math.max(1, Math.floor(files.length * 0.2));
  const end = Math.max(start, Math.ceil(files.length * 0.8) - 1);
  const index = Math.floor(Math.random() * (end - start + 1)) + start;
  return { frameName: files[index], frameIndex: index };
}

export function resolveFrameNameAndIndex(rawFrameIndex, sequence) {
  const files = Array.isArray(sequence?.files) ? sequence.files : [];

  if (!files.length) {
    throw new Error('Selected sequence has no frames.');
  }

  const frameIndex = clamp(Math.floor(rawFrameIndex), 0, files.length - 1);
  return {
    frameIndex,
    frameName: files[frameIndex],
    frameCount: files.length,
  };
}

export function createSequenceStore({ manifestPath = DEFAULT_SEQUENCE_MANIFEST_PATH } = {}) {
  let sequenceManifest = null;
  let compareManifestRegistry = null;
  let activeSequenceId = null;
  const frameCache = new Map();

  async function loadFrameManifest() {
    if (sequenceManifest) {
      return sequenceManifest;
    }

    sequenceManifest = await fetchJson(
      manifestPath,
      'Failed to load sequence manifest',
    );
    return sequenceManifest;
  }

  async function loadCompareManifestRegistry() {
    if (compareManifestRegistry) {
      return compareManifestRegistry;
    }

    compareManifestRegistry = await fetchJson(
      COMPARE_REGISTRY_PATH,
      'Failed to load compare registry',
    );
    return compareManifestRegistry;
  }

  function getActiveSequence() {
    const sequences = sequenceManifest?.sequences ?? [];

    if (!sequences.length) {
      return null;
    }

    return (
      sequences.find((sequence) => sequence.id === activeSequenceId) ??
      sequences[0]
    );
  }

  function getActiveSequenceFiles() {
    const sequence = getActiveSequence();
    return Array.isArray(sequence?.files) ? sequence.files : [];
  }

  async function selectSequence(sequenceId) {
    const manifest = await loadFrameManifest();
    const sequences = manifest.sequences ?? [];
    const sequence =
      sequences.find((entry) => entry.id === sequenceId) ??
      sequences[0];

    if (!sequence) {
      throw new Error('No sequence available.');
    }

    activeSequenceId = sequence.id;
    return sequence;
  }

  async function loadFrameByName(frameName, sequence = getActiveSequence()) {
    if (!sequence) {
      throw new Error('No active sequence selected.');
    }

    const cacheKey = getFrameCacheKey(sequence, frameName);

    if (frameCache.has(cacheKey)) {
      return frameCache.get(cacheKey);
    }

    const frameData = await fetchJson(
      `${sequence.frameDir}/${frameName}`,
      `Failed to load frame ${frameName}`,
    );
    frameCache.set(cacheKey, frameData);
    return frameData;
  }

  async function preloadAllFrames(files, sequence = getActiveSequence()) {
    await Promise.all(files.map((frameName) => loadFrameByName(frameName, sequence)));
  }

  function getCachedFrame(frameName, sequence = getActiveSequence()) {
    if (!sequence) {
      return undefined;
    }

    return frameCache.get(getFrameCacheKey(sequence, frameName));
  }

  return {
    loadFrameManifest,
    loadCompareManifestRegistry,
    selectSequence,
    getActiveSequence,
    getActiveSequenceFiles,
    loadFrameByName,
    preloadAllFrames,
    getCachedFrame,
    buildFrameNameFromNumber: (frameNumber, sequence = getActiveSequence()) =>
      buildFrameNameFromNumber(frameNumber, sequence),
    resolveFrameNameAndIndex: (rawFrameIndex, sequence = getActiveSequence()) =>
      resolveFrameNameAndIndex(rawFrameIndex, sequence),
  };
}
