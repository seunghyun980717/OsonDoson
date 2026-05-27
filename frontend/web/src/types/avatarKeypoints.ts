// 아바타 viewer가 소비하는 키포인트 페이로드 타입.
// jetson `types/ws.ts`에서 사용된 정의를 web 전용으로 분리. (WS 타입은 가져오지 않음)
// 이 타입들은 Spring `/api/translation/speech-to-sign` 응답의 keypoint_payload 필드에 매핑됨.

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

export type ViewerSegment = {
  gloss: string;
  start_frame: number;
  end_frame: number;
  is_transition?: boolean;
  source?: string;
  source_clip?: {
    dataset?: string;
    reference_video_ref?: string;
    source_path?: string;
    video_id?: string;
    video_ref?: string;
  };
  source_segment?: {
    source_start_frame?: number;
    source_start_sec?: number;
  };
};

export type SignSentenceKeypointPayload = {
  schema_version: 'sign-sentence-keypoints/v1';
  fps: number;
  glosses: string[];
  segments: ViewerSegment[];
  frames: ViewerFrame[];
};

// 전환 중 호환을 위해 느슨하게.
export type KeypointPayload = SignSentenceKeypointPayload | Record<string, unknown>;
