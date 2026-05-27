const DEFAULT_COMPARE_TITLE = '\uc6d0\ubcf8 vs Word \uae30\ubc18 \ubcf4\uac04';
const SENTENCE_LABEL = '\ubb38\uc7a5';
const WORD_LABEL = '\uc0ac\uc6a9 \ub2e8\uc5b4';

export function collectCompareElements(root = document) {
  return {
    compareEyebrowEl: root.querySelector('#compare-eyebrow'),
    compareTitleEl: root.querySelector('#compare-title'),
    pairSelectEl: root.querySelector('#pair-select'),
    metricSummaryEl: root.querySelector('#metric-summary'),
    progressRangeEl: root.querySelector('#progress-range'),
    progressLabelEl: root.querySelector('#progress-label'),
    leftTitleEl: root.querySelector('#left-title'),
    rightTitleEl: root.querySelector('#right-title'),
    leftMetaEl: root.querySelector('#left-meta'),
    rightMetaEl: root.querySelector('#right-meta'),
    leftDetailEl: root.querySelector('#left-detail'),
    rightDetailEl: root.querySelector('#right-detail'),
    leftFrameEl: root.querySelector('#left-frame'),
    rightFrameEl: root.querySelector('#right-frame'),
    playButtonEl: root.querySelector('#compare-play'),
    stopButtonEl: root.querySelector('#compare-stop'),
    resetButtonEl: root.querySelector('#compare-reset'),
  };
}

export function applyManifestMeta(elements, manifest) {
  const meta = manifest?.meta ?? {};
  elements.compareEyebrowEl.textContent = meta.eyebrow ?? 'Compare';
  elements.compareTitleEl.textContent = meta.title ?? DEFAULT_COMPARE_TITLE;
}

export function populatePairSelect(elements, pairs) {
  elements.pairSelectEl.innerHTML = '';
  pairs.forEach((pair) => {
    const option = document.createElement('option');
    option.value = pair.id;
    option.textContent = pair.label ?? pair.id;
    elements.pairSelectEl.append(option);
  });
}

export function updatePairSelectVisibility(elements, pairs) {
  elements.pairSelectEl.hidden = pairs.length <= 1;
}

export function selectPairOption(elements, pair) {
  elements.pairSelectEl.value = pair.id;
}

export function updateMetrics(elements, pair) {
  const metrics = pair?.metrics ?? {};
  const pose = metrics.pose_mean_l2?.toFixed?.(2) ?? '-';
  const left = metrics.left_hand_mean_l2?.toFixed?.(2) ?? '-';
  const right = metrics.right_hand_mean_l2?.toFixed?.(2) ?? '-';
  elements.metricSummaryEl.textContent = `pose ${pose} | left hand ${left} | right hand ${right}`;
}

export function updateProgress(elements, ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));
  elements.progressRangeEl.value = String(Math.round(clamped * 1000));
  elements.progressLabelEl.textContent = `${Math.round(clamped * 100)}%`;
}

export function renderPairDetails(elements, { pair, leftSequence, rightSequence, report }) {
  elements.leftTitleEl.textContent = leftSequence?.meta?.panelTitle ?? leftSequence?.label ?? pair.leftSequenceId;
  elements.rightTitleEl.textContent = rightSequence?.meta?.panelTitle ?? rightSequence?.label ?? pair.rightSequenceId;
  elements.leftMetaEl.textContent = `${leftSequence?.files?.length ?? 0} frames @ ${leftSequence?.fps ?? '-'} fps`;
  elements.rightMetaEl.textContent = `${rightSequence?.files?.length ?? 0} frames @ ${rightSequence?.fps ?? '-'} fps`;
  elements.leftDetailEl.textContent = formatSentenceDetail(report, leftSequence);
  elements.rightDetailEl.textContent = formatWordDetail(report, pair);
  updateMetrics(elements, pair);
  updateProgress(elements, 0);
}

export function setViewerSources(elements, { leftUrl, rightUrl }) {
  elements.leftFrameEl.src = leftUrl;
  elements.rightFrameEl.src = rightUrl;
}

export function renderError(elements, error) {
  elements.compareTitleEl.textContent = error.message;
}

function formatSentenceDetail(report, sequence) {
  const sentenceId = report?.sentence_id ?? sequence?.meta?.sentenceId ?? '-';
  const labels = Array.isArray(report?.labels) ? report.labels.filter(Boolean) : [];
  if (!labels.length) {
    return `${SENTENCE_LABEL} ID: ${sentenceId}`;
  }
  return `${SENTENCE_LABEL} ID: ${sentenceId} | ${SENTENCE_LABEL}: ${labels.join(' / ')}`;
}

function formatWordDetail(report, pair) {
  const labels = Array.isArray(report?.labels)
    ? report.labels.filter(Boolean)
    : [];
  if (labels.length) {
    return `${WORD_LABEL}: ${labels.join(', ')}`;
  }

  const wordIds = Array.isArray(report?.word_ids)
    ? report.word_ids
    : Array.isArray(pair?.word_ids)
      ? pair.word_ids
      : [];
  if (!wordIds.length) {
    return `${WORD_LABEL}: -`;
  }
  return `${WORD_LABEL}: ${wordIds.join(', ')}`;
}
