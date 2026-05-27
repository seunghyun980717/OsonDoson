import type {
  SignSentenceKeypointPayload,
  ViewerFrame,
  ViewerFramePeople,
  ViewerSegment,
} from '@/types/avatarKeypoints';

export type {
  SignSentenceKeypointPayload,
  ViewerFrame,
  ViewerFramePeople,
  ViewerSegment,
};

export type NormalizedAvatarPayload = {
  fps: number;
  frames: ViewerFrame[] | undefined;
  segments: ViewerSegment[];
};
