import {
  ARRAY_KEYS,
  POSE_LEFT_SHOULDER_INDEX,
  POSE_RIGHT_SHOULDER_INDEX,
  clipFramesToArrays,
  frameCountForArrays,
  numberAt,
} from './keypoint-arrays.js';

const KEYPOINT_3D_FRAME_KEYS = Object.freeze([
  'pose_keypoints_3d',
  'hand_left_keypoints_3d',
  'hand_right_keypoints_3d',
  'face_keypoints_3d',
]);

function point3D(flat = [], index) {
  const offset = index * 4;
  return [
    numberAt(flat, offset),
    numberAt(flat, offset + 1),
    numberAt(flat, offset + 2),
    numberAt(flat, offset + 3),
  ];
}

function shoulderCenterAndWidth(pose3d = []) {
  const rightShoulder = point3D(pose3d, POSE_RIGHT_SHOULDER_INDEX);
  const leftShoulder = point3D(pose3d, POSE_LEFT_SHOULDER_INDEX);
  const center = [
    (rightShoulder[0] + leftShoulder[0]) * 0.5,
    (rightShoulder[1] + leftShoulder[1]) * 0.5,
    (rightShoulder[2] + leftShoulder[2]) * 0.5,
  ];
  const width = Math.max(
    Math.hypot(
      leftShoulder[0] - rightShoulder[0],
      leftShoulder[1] - rightShoulder[1],
      leftShoulder[2] - rightShoulder[2],
    ),
    1e-6,
  );

  return { center, width };
}

function normalizeFlat3D(flat = [], center, width, zSign) {
  const normalized = [...flat];
  for (let index = 0; index + 3 < normalized.length; index += 4) {
    normalized[index] = (numberAt(flat, index) - center[0]) / width;
    normalized[index + 1] = (numberAt(flat, index + 1) - center[1]) / width;
    normalized[index + 2] = ((numberAt(flat, index + 2) - center[2]) / width) * zSign;
    normalized[index + 3] = numberAt(flat, index + 3);
  }
  return normalized;
}

function zSignForDataset() {
  return 1;
}

function normalizeFrame(frame, zSign) {
  const people = frame.people || {};
  const { center, width } = shoulderCenterAndWidth(people.pose_keypoints_3d);
  const normalizedPeople = { ...people };

  KEYPOINT_3D_FRAME_KEYS.forEach((key) => {
    normalizedPeople[key] = normalizeFlat3D(people[key] || [], center, width, zSign);
  });

  return {
    ...frame,
    people: normalizedPeople,
  };
}

export function normalizeClipPayload(payload) {
  if (payload?.processing?.coordinate_normalization === 'shoulder-root-relative/v1') {
    return payload;
  }

  if (!Array.isArray(payload?.frames)) {
    return payload;
  }

  const zSign = zSignForDataset(payload?.source?.dataset);
  return {
    ...payload,
    processing: {
      ...(payload.processing || {}),
      source_coordinate_normalization: payload.processing?.coordinate_normalization ?? null,
      coordinate_normalization: 'viewer-root-relative/v1',
      z_polarity: zSign,
    },
    frames: payload.frames.map((frame) => normalizeFrame(frame, zSign)),
  };
}

function confidenceChannel(point = []) {
  if (point.length === 3) {
    return Number(point[2]) || 0;
  }
  if (point.length >= 4) {
    return Number(point[3]) || 0;
  }
  return 1;
}

function frameHasFace(face2d = [], face3d = []) {
  return Math.max(
    ...face2d.map(confidenceChannel),
    ...face3d.map(confidenceChannel),
    0,
  ) > 0;
}

function nearestValidFaceIndex(validFlags, index) {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  validFlags.forEach((isValid, candidate) => {
    if (!isValid) {
      return;
    }
    const distance = Math.abs(candidate - index);
    if (distance < bestDistance) {
      bestIndex = candidate;
      bestDistance = distance;
    }
  });

  return bestIndex;
}

function ensureFaceFallback(arrays) {
  const face2d = arrays.face_2d || [];
  const face3d = arrays.face_3d || [];
  const validFlags = face2d.map((frame, index) => frameHasFace(frame, face3d[index]));

  if (validFlags.every(Boolean)) {
    return arrays;
  }

  const firstValid = validFlags.findIndex(Boolean);
  const fallback2d = firstValid >= 0 ? face2d[firstValid] : face2d[0];
  const fallback3d = firstValid >= 0 ? face3d[firstValid] : face3d[0];

  return {
    ...arrays,
    face_2d: face2d.map((frame, index) => {
      if (validFlags[index]) {
        return frame;
      }
      const nearest = nearestValidFaceIndex(validFlags, index);
      return nearest >= 0 ? face2d[nearest].map((point) => [...point]) : fallback2d.map((point) => [...point]);
    }),
    face_3d: face3d.map((frame, index) => {
      if (validFlags[index]) {
        return frame;
      }
      const nearest = nearestValidFaceIndex(validFlags, index);
      return nearest >= 0 ? face3d[nearest].map((point) => [...point]) : fallback3d.map((point) => [...point]);
    }),
  };
}

function resampleFrameSeries(frames, targetFrames) {
  if (frames.length === targetFrames) {
    return frames.map((frame) => frame.map((point) => [...point]));
  }
  if (frames.length <= 1) {
    return Array.from({ length: targetFrames }, () => (frames[0] || []).map((point) => [...point]));
  }

  return Array.from({ length: targetFrames }, (_, targetIndex) => {
    const sourcePosition = (targetIndex / Math.max(1, targetFrames - 1)) * (frames.length - 1);
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(frames.length - 1, leftIndex + 1);
    const weight = sourcePosition - leftIndex;
    const leftFrame = frames[leftIndex];
    const rightFrame = frames[rightIndex];
    const pointCount = Math.min(leftFrame.length, rightFrame.length);

    return Array.from({ length: pointCount }, (_, pointIndex) => {
      const leftPoint = leftFrame[pointIndex];
      const rightPoint = rightFrame[pointIndex];
      const channels = Math.min(leftPoint.length, rightPoint.length);
      return Array.from({ length: channels }, (_, channelIndex) =>
        leftPoint[channelIndex] + ((rightPoint[channelIndex] - leftPoint[channelIndex]) * weight),
      );
    });
  });
}

function targetFrameCount(frameCount, sourceFps, targetFps) {
  if (frameCount <= 1 || sourceFps === targetFps) {
    return frameCount;
  }
  const duration = (frameCount - 1) / sourceFps;
  return Math.max(1, Math.round(duration * targetFps) + 1);
}

function resampleClipArrays(arrays, sourceFps, targetFps) {
  const frameCount = frameCountForArrays(arrays);
  const nextFrameCount = targetFrameCount(frameCount, sourceFps, targetFps);
  if (nextFrameCount === frameCount) {
    return arrays;
  }

  return Object.fromEntries(ARRAY_KEYS.map((key) => [key, resampleFrameSeries(arrays[key] || [], nextFrameCount)]));
}

export function payloadToClipAsset(rawPayload, options = {}) {
  const payload = normalizeClipPayload(rawPayload);
  const fps = Number(payload?.fps) || Number(options.targetFps) || 30;
  const targetFps = Number(options.targetFps) || fps;
  const arrays = resampleClipArrays(
    ensureFaceFallback(clipFramesToArrays(payload.frames || [])),
    fps,
    targetFps,
  );

  return {
    id: payload.gloss || payload.source?.video_id || 'clip',
    label: payload.gloss || payload.source?.video_id || 'clip',
    fps: targetFps,
    source: 'word',
    path: payload.source?.source_path || null,
    arrays,
    meta: {
      source: payload.source,
      processing: payload.processing,
      segment: payload.segment,
      raw_payload: payload,
    },
  };
}
