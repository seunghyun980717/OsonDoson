export const POSE_LEFT_SHOULDER_INDEX = 5;
export const POSE_RIGHT_SHOULDER_INDEX = 2;
export const POSE_LEFT_ELBOW_INDEX = 6;
export const POSE_RIGHT_ELBOW_INDEX = 3;
export const POSE_LEFT_WRIST_INDEX = 7;
export const POSE_RIGHT_WRIST_INDEX = 4;

export const ARRAY_KEYS = Object.freeze([
  'pose_3d',
  'pose_2d',
  'left_hand_3d',
  'left_hand_2d',
  'right_hand_3d',
  'right_hand_2d',
  'face_3d',
  'face_2d',
]);

export const FRAME_TO_ARRAY_KEY = Object.freeze({
  pose_keypoints_3d: 'pose_3d',
  pose_keypoints_2d: 'pose_2d',
  hand_left_keypoints_3d: 'left_hand_3d',
  hand_left_keypoints_2d: 'left_hand_2d',
  hand_right_keypoints_3d: 'right_hand_3d',
  hand_right_keypoints_2d: 'right_hand_2d',
  face_keypoints_3d: 'face_3d',
  face_keypoints_2d: 'face_2d',
});

export const ARRAY_TO_FRAME_KEY = Object.freeze(
  Object.fromEntries(Object.entries(FRAME_TO_ARRAY_KEY).map(([frameKey, arrayKey]) => [arrayKey, frameKey])),
);

export function strideForArrayKey(key) {
  return key.endsWith('_2d') ? 3 : 4;
}

export function spatialDimsForArrayKey(key) {
  return key.endsWith('_2d') ? 2 : 3;
}

export function numberAt(array, index) {
  return Number(array?.[index]) || 0;
}

export function flatToPoints(flat = [], stride = 4) {
  const count = Math.floor(flat.length / stride);
  return Array.from({ length: count }, (_, pointIndex) =>
    Array.from({ length: stride }, (_, axisIndex) => numberAt(flat, (pointIndex * stride) + axisIndex)),
  );
}

export function pointsToFlat(points = []) {
  return points.flatMap((point) => point.map((value) => Number(value) || 0));
}

export function clonePoint(point = []) {
  return point.map((value) => Number(value) || 0);
}

export function cloneFramePoints(frame = []) {
  return frame.map(clonePoint);
}

export function cloneArrayFrames(frames = []) {
  return frames.map(cloneFramePoints);
}

export function vectorBetween(a = [], b = [], dims = 3) {
  return Array.from({ length: dims }, (_, index) => numberAt(b, index) - numberAt(a, index));
}

export function vectorNorm(vector = []) {
  return Math.hypot(...vector);
}

export function lerp(a, b, t) {
  return a + ((b - a) * t);
}

export function frameToArrays(frame) {
  const people = frame.people || {};
  const arrays = {};

  Object.entries(FRAME_TO_ARRAY_KEY).forEach(([frameKey, arrayKey]) => {
    arrays[arrayKey] = flatToPoints(people[frameKey] || [], strideForArrayKey(arrayKey));
  });

  return arrays;
}

export function clipFramesToArrays(frames = []) {
  const arrays = Object.fromEntries(ARRAY_KEYS.map((key) => [key, []]));

  frames.forEach((frame) => {
    const frameArrays = frameToArrays(frame);
    ARRAY_KEYS.forEach((key) => {
      arrays[key].push(frameArrays[key] || []);
    });
  });

  return arrays;
}

export function arraysToFrames(arrays, startFrameIndex = 0) {
  const frameCount = arrays?.[ARRAY_KEYS[0]]?.length || 0;

  return Array.from({ length: frameCount }, (_, frameOffset) => {
    const people = {};
    ARRAY_KEYS.forEach((arrayKey) => {
      people[ARRAY_TO_FRAME_KEY[arrayKey]] = pointsToFlat(arrays[arrayKey]?.[frameOffset] || []);
    });
    return {
      frame_index: startFrameIndex + frameOffset,
      people,
    };
  });
}

export function appendArrays(target, source) {
  if (!Object.keys(target).length) {
    return Object.fromEntries(ARRAY_KEYS.map((key) => [key, cloneArrayFrames(source[key] || [])]));
  }

  return Object.fromEntries(ARRAY_KEYS.map((key) => [
    key,
    [...(target[key] || []), ...cloneArrayFrames(source[key] || [])],
  ]));
}

export function frameCountForArrays(arrays) {
  return arrays?.[ARRAY_KEYS[0]]?.length || 0;
}
