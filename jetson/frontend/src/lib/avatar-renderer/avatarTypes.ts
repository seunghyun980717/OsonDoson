import type {
  SignSentenceKeypointPayload,
  ViewerFrame,
  ViewerFramePeople,
  ViewerSegment,
} from '@/types/ws';

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
