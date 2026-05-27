const COMPARE_MESSAGE_SOURCE = 'sign-avatar-compare';
const VIEWER_MESSAGE_SOURCE = 'sign-avatar-viewer';
const VIEWER_READY_TYPE = 'viewer-ready';

export function createPlaybackController({
  leftFrameEl,
  rightFrameEl,
  onProgress,
}) {
  const state = {
    currentPair: null,
    playing: false,
    startTime: 0,
    durationSeconds: 1,
    lastRatio: 0,
    rafId: null,
    readyViewers: new Set(),
  };

  function setPair(pair, durationSeconds) {
    state.currentPair = pair;
    state.readyViewers.clear();
    state.durationSeconds = durationSeconds;
    state.lastRatio = 0;
  }

  function stop() {
    state.playing = false;
    if (state.rafId !== null) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  function broadcastRatio(ratio) {
    postToFrame(leftFrameEl, 'show-frame-ratio', { ratio });
    postToFrame(rightFrameEl, 'show-frame-ratio', { ratio });
  }

  function updateRatio(ratio) {
    const clamped = Math.max(0, Math.min(1, ratio));
    state.lastRatio = clamped;
    onProgress(clamped);
    return clamped;
  }

  function tick(now) {
    if (!state.playing) {
      return;
    }

    const elapsed = (now - state.startTime) / 1000;
    const ratio = Math.min(1, elapsed / state.durationSeconds);
    broadcastRatio(ratio);
    updateRatio(ratio);

    if (ratio >= 1) {
      stop();
      return;
    }

    state.rafId = window.requestAnimationFrame(tick);
  }

  function play() {
    if (!state.currentPair) {
      return;
    }

    stop();
    updateRatio(0);
    broadcastRatio(0);
    state.playing = true;
    state.startTime = performance.now();
    state.rafId = window.requestAnimationFrame(tick);
  }

  function reset() {
    stop();
    updateRatio(0);
    broadcastRatio(0);
  }

  function seek(ratio) {
    stop();
    const clamped = updateRatio(ratio);
    broadcastRatio(clamped);
  }

  function handleViewerMessage(message) {
    if (!message || message.source !== VIEWER_MESSAGE_SOURCE || message.type !== VIEWER_READY_TYPE) {
      return;
    }

    const sequenceId = message.sequenceId;
    if (!sequenceId) {
      return;
    }

    state.readyViewers.add(sequenceId);
    if (
      state.currentPair &&
      state.readyViewers.has(state.currentPair.leftSequenceId) &&
      state.readyViewers.has(state.currentPair.rightSequenceId)
    ) {
      broadcastRatio(state.lastRatio);
    }
  }

  return {
    setPair,
    stop,
    play,
    reset,
    seek,
    handleViewerMessage,
  };
}

function postToFrame(frameEl, command, payload = {}) {
  frameEl.contentWindow?.postMessage(
    {
      source: COMPARE_MESSAGE_SOURCE,
      command,
      ...payload,
    },
    '*',
  );
}
