export type ViewerFramePeople = {
  pose_keypoints_2d: number[];
  pose_keypoints_3d: number[];
  hand_left_keypoints_2d: number[];
  hand_left_keypoints_3d: number[];
  hand_right_keypoints_2d: number[];
  hand_right_keypoints_3d: number[];
  face_keypoints_2d: number[];
  face_keypoints_3d: number[];
};

export type ViewerFrame = {
  frame_index: number;
  people: ViewerFramePeople;
};

export type SignSentenceKeypointPayload = {
  schema_version: 'sign-sentence-keypoints/v1';
  fps: number;
  glosses: string[];
  segments: {
    gloss: string;
    start_frame: number;
    end_frame: number;
    source?: string;
  }[];
  frames: ViewerFrame[];
};

export type KeypointPayload = SignSentenceKeypointPayload | Record<string, unknown>;
