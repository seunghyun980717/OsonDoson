import type { KeypointPayload, ViewerFrame, ViewerSegment } from '@/types/ws';

import type { NormalizedAvatarPayload } from './avatarTypes';

const DEFAULT_AVATAR_FPS = 30;

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

const isViewerSegment = (value: unknown): value is ViewerSegment => (
  isRecord(value) &&
  typeof value.gloss === 'string' &&
  typeof value.start_frame === 'number' &&
  typeof value.end_frame === 'number'
);

const normalizeFps = (fps: unknown) => (
  typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_AVATAR_FPS
);

export const normalizeAvatarPayload = (
  payload: KeypointPayload | unknown,
): NormalizedAvatarPayload => {
  if (!isRecord(payload)) {
    return { fps: DEFAULT_AVATAR_FPS, frames: undefined, segments: [] };
  }

  const fps = normalizeFps(payload.fps);
  const frames = Array.isArray(payload.frames)
    ? payload.frames.filter(isViewerFrame)
    : [];
  const segments = Array.isArray(payload.segments)
    ? payload.segments.filter(isViewerSegment)
    : [];

  return {
    fps,
    frames: frames.length > 0 ? frames : undefined,
    segments,
  };
};
