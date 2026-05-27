import {
  ARRAY_KEYS,
  cloneArrayFrames,
  frameCountForArrays,
} from './keypoint-arrays.js';

const SOURCE_GUARD_FRAMES = 3;

const SMOOTHING_SPECS = Object.freeze({
  pose_3d: [0.45, 0.32, 1.0, 0.88],
  pose_2d: [0.45, 0.32, 1.0, 0.88],
  left_hand_3d: [0.7, 0.5, 1.0, 0.92],
  left_hand_2d: [0.7, 0.5, 1.0, 0.92],
  right_hand_3d: [0.7, 0.5, 1.0, 0.92],
  right_hand_2d: [0.7, 0.5, 1.0, 0.92],
  face_3d: [0.55, 0.38, 1.0, 0.8],
  face_2d: [0.55, 0.38, 1.0, 0.8],
});

function alphaSchedule(frameCount, segments, defaultAlpha, transitionAlpha, holdAlpha, sourceGuardAlpha) {
  const schedule = Array.from({ length: frameCount }, () => defaultAlpha);
  const resetMask = Array.from({ length: frameCount }, () => false);
  let previousSegment = null;

  segments.forEach((segment) => {
    const start = Math.max(0, Math.floor(Number(segment.start_frame) || 0));
    const end = Math.min(frameCount - 1, Math.floor(Number(segment.end_frame) || start));

    if (segment.kind === 'generated-transition' || segment.kind === 'cached-transition') {
      schedule.fill(transitionAlpha, start, end + 1);
    } else if (segment.kind === 'boundary-hold') {
      schedule.fill(holdAlpha, start, end + 1);
    }

    if (
      previousSegment
      && (previousSegment.kind === 'generated-transition' || previousSegment.kind === 'cached-transition')
      && segment.kind === 'source'
    ) {
      resetMask[start] = true;
      schedule.fill(sourceGuardAlpha, start, Math.min(end + 1, start + SOURCE_GUARD_FRAMES));
    }

    previousSegment = segment;
  });

  return { resetMask, schedule };
}

function smoothPointSeries(frames, schedule, resetMask) {
  const result = cloneArrayFrames(frames);
  for (let frameIndex = 1; frameIndex < result.length; frameIndex += 1) {
    if (resetMask[frameIndex]) {
      result[frameIndex] = frames[frameIndex].map((point) => [...point]);
      continue;
    }

    const alpha = schedule[frameIndex];
    result[frameIndex].forEach((point, pointIndex) => {
      const previous = result[frameIndex - 1][pointIndex];
      const source = frames[frameIndex][pointIndex];
      const channels = Math.min(point.length, previous?.length || 0, source?.length || 0);
      for (let channel = 0; channel < channels; channel += 1) {
        point[channel] = (alpha * source[channel]) + ((1 - alpha) * previous[channel]);
      }
    });
  }
  return result;
}

export function smoothSequence(arrays, segments) {
  const frameCount = frameCountForArrays(arrays);
  if (frameCount <= 1) {
    return arrays;
  }

  const smoothed = { ...arrays };
  ARRAY_KEYS.forEach((key) => {
    const [defaultAlpha, transitionAlpha, holdAlpha, sourceGuardAlpha] = SMOOTHING_SPECS[key];
    const { schedule, resetMask } = alphaSchedule(
      frameCount,
      segments,
      defaultAlpha,
      transitionAlpha,
      holdAlpha,
      sourceGuardAlpha,
    );
    smoothed[key] = smoothPointSeries(arrays[key] || [], schedule, resetMask);
  });

  return smoothed;
}
