import type {
  SignSentenceKeypointPayload,
  ViewerFrame,
  ViewerFramePeople,
} from '@/types/avatarKeypoints';

export type {
  SignSentenceKeypointPayload,
  ViewerFrame,
  ViewerFramePeople,
};

export type NormalizedAvatarPayload = {
  fps: number;
  frames: ViewerFrame[] | undefined;
};
