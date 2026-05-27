export const DEFAULT_COMPARE_MANIFEST_PATH = '/data/compare-manifest.json';

export function createViewerUrl(manifestPath, sequenceId) {
  const params = new URLSearchParams({
    embed: '1',
    manifest: manifestPath,
    sequence: sequenceId,
  });
  return `/index.html?${params.toString()}`;
}

export async function loadCompareManifest(manifestPath) {
  const response = await fetch(manifestPath);
  if (!response.ok) {
    throw new Error(`Failed to load compare manifest: ${response.status}`);
  }
  return response.json();
}

export function findSequence(manifest, sequenceId) {
  return manifest?.sequences?.find((sequence) => sequence.id === sequenceId) ?? null;
}

export function sequenceDuration(sequence) {
  const fps = Number(sequence?.fps) || 30;
  const frameCount = Array.isArray(sequence?.files) ? sequence.files.length : 0;
  return frameCount > 0 ? frameCount / fps : 0;
}

export function pairDurationSeconds(manifest, pair) {
  return Math.max(
    sequenceDuration(findSequence(manifest, pair.leftSequenceId)),
    sequenceDuration(findSequence(manifest, pair.rightSequenceId)),
    0.001,
  );
}

export function createReportLoader() {
  const reportCache = new Map();

  return async function loadPairReport(pair) {
    if (!pair?.report) {
      return null;
    }

    if (reportCache.has(pair.report)) {
      return reportCache.get(pair.report);
    }

    const response = await fetch(pair.report);
    if (!response.ok) {
      return null;
    }

    const report = await response.json();
    reportCache.set(pair.report, report);
    return report;
  };
}
