import type { KeypointPayload, ViewerFrame } from '@/types/avatarKeypoints';

import type { NormalizedAvatarPayload } from './avatarTypes';

const DEFAULT_AVATAR_FPS = 30;
const POSE_3D_STRIDE = 4;
const POINT_2D_STRIDE = 3;
const HAND_3D_COUNT = 21;
const FACE_3D_COUNT = 68;
const POSE_3D_COUNT = 25;

type LegacyPoint = {
  x: number;
  y: number;
  z: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const isNumberArray = (value: unknown): value is number[] => (
  Array.isArray(value) && value.every((item) => typeof item === 'number')
);

const hasRequiredKeypointArrays = (people: Record<string, unknown>) => (
  isNumberArray(people.pose_keypoints_3d) &&
  isNumberArray(people.hand_left_keypoints_3d) &&
  isNumberArray(people.hand_right_keypoints_3d)
);

const isViewerFrame = (value: unknown): value is ViewerFrame => {
  if (!isRecord(value) || !isRecord(value.people)) {
    return false;
  }

  return hasRequiredKeypointArrays(value.people);
};

const isLegacyPoint = (value: unknown): value is LegacyPoint => (
  isRecord(value) &&
  typeof value.x === 'number' &&
  typeof value.y === 'number' &&
  typeof value.z === 'number'
);

const isLegacyPointArray = (value: unknown): value is LegacyPoint[] => (
  Array.isArray(value) && value.every(isLegacyPoint)
);

const flatten3dPoints = (
  points: readonly LegacyPoint[],
  minCount: number,
) => {
  const values = Array.from({ length: minCount * POSE_3D_STRIDE }, () => 0);

  points.slice(0, minCount).forEach((point, index) => {
    const base = index * POSE_3D_STRIDE;
    values[base] = point.x;
    values[base + 1] = point.y;
    values[base + 2] = point.z;
    values[base + 3] = 1;
  });

  return values;
};

const blank2d = (count: number) => Array.from({ length: count * POINT_2D_STRIDE }, () => 0);

const normalizeLegacyFrame = (value: unknown): ViewerFrame | null => {
  if (
    !isRecord(value) ||
    !isLegacyPointArray(value.pose) ||
    !isLegacyPointArray(value.left_hand) ||
    !isLegacyPointArray(value.right_hand)
  ) {
    return null;
  }

  return {
    frame_index: typeof value.frame_index === 'number' ? value.frame_index : 0,
    people: {
      pose_keypoints_2d: blank2d(POSE_3D_COUNT),
      pose_keypoints_3d: flatten3dPoints(value.pose, POSE_3D_COUNT),
      hand_left_keypoints_2d: blank2d(HAND_3D_COUNT),
      hand_left_keypoints_3d: flatten3dPoints(value.left_hand, HAND_3D_COUNT),
      hand_right_keypoints_2d: blank2d(HAND_3D_COUNT),
      hand_right_keypoints_3d: flatten3dPoints(value.right_hand, HAND_3D_COUNT),
      face_keypoints_2d: blank2d(FACE_3D_COUNT),
      face_keypoints_3d: flatten3dPoints([], FACE_3D_COUNT),
    },
  };
};

const normalizeFps = (fps: unknown) => (
  typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_AVATAR_FPS
);

export const normalizeAvatarPayload = (
  payload: KeypointPayload | unknown,
): NormalizedAvatarPayload => {
  if (!isRecord(payload)) {
    return { fps: DEFAULT_AVATAR_FPS, frames: undefined };
  }

  const fps = normalizeFps(payload.fps);
  const frames = Array.isArray(payload.frames)
    ? payload.frames
      .map((frame) => (isViewerFrame(frame) ? frame : normalizeLegacyFrame(frame)))
      .filter((frame): frame is ViewerFrame => frame !== null)
    : [];

  return {
    fps,
    frames: frames.length > 0 ? frames : undefined,
  };
};
