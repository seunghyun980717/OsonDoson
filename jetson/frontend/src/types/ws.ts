// * 공통 PayLoad

export type Role = 'hearing' | 'signer';

// ? 송신용 (signer_keypoints) - MediaPipe 출력 그대로
export type Landmark = {
    x: number;
    y: number;
    z: number;
    visibility: number;
};

// signer_keypoints 송신 시 1프레임 구조
export type SignerFrame = {
    poseLandmarks: Landmark[];
    leftHandLandmarks: Landmark[];
    rightHandLandmarks: Landmark[];
    videoWidth: number;
    videoHeight: number;
};

// sign_to_speech_result.audio
// 현재 백엔드는 base64 mp3를 인라인 전송하지 않고 정적 파일 URL을 보낸다.
export type AudioPayload = {
    format: 'mp3';
    content_type: 'audio/mpeg';
    url: string; // 정적 파일 상대 경로 (예: /static/audio/xxx.mp3)
};

// 청인이 받는 결과 payload (수어 -> 한국어/음성)
export type SignToSpeechResult = {
    source: 'signer';
    glosses: string[];
    korean: string;
    audio_url: string | null; // audio.url과 동일값을 담는 alias 필드 (백엔드가 함께 송신)
    audio: AudioPayload;
};

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

// speech_to_sign_result.keypoint_payload
// 서버가 최종적으로 sign-sentence-keypoints/v1을 내려주지만, 전환 중 호환을 위해 느슨하게 받는다.
export type KeypointPayload = SignSentenceKeypointPayload | Record<string, unknown>;

// speech_to_sign_result.timings — 단계별 소요 시간 (초)
export type SpeechToSignTimings = Record<string, number>;

// 농인이 받는 결과 페이로드 (한국어 -> 수어 keypoint payload)
export type SpeechToSignResult = {
    source: 'hearing';
    korean: string;
    glosses: string[];
    gloss_str: string;
    keypoint_url: string | null;
    keypoint_path: string | null;
    keypoint_payload: KeypointPayload;
    resolved_glosses: string[];
    missing_glosses: string[];
    coverage: number;
    timings: SpeechToSignTimings;
};

// * =================================
// * 공통 수신 메시지 (청인/농인 모두 받음)
// * =================================
export type ConnectedMessage = {
    type: 'connected';
    role: Role; // 나의 역할
};

export type PeerConnectedMessage = {
    type: 'peer_connected';
    role: Role; // 상대방 역할
};

export type PeerDisconnectedMessage = {
    type: 'peer_disconnected';
    role: Role; // 상대방 역할
};

export type PeerUnavailableMessage = {
    type: 'peer_unavailable';
    target: Role;
    message: string;
};

export type ProcessingPipeline = 'speech_to_sign' | 'sign_to_speech';

export type ProcessingMessage = {
    type: 'processing';
    pipeline: ProcessingPipeline;
};

export type ErrorMessage = {
    type: 'error';
    message: string;
}

export type PongMessage = {
    type: 'pong';
}

type CommonIncomingMessage =
| ConnectedMessage
| PeerConnectedMessage
| PeerDisconnectedMessage
| PeerUnavailableMessage
| ProcessingMessage
| ErrorMessage
| PongMessage;


// * =================================
// * 청인(hearing) 송신 / 수신
// * =================================
export type HearingTextMessage = {
    type: 'hearing_text';
    text: string;
};

export type AudioFormat = 'webm' | 'wav';

export type HearingAudioMessage = {
    type: 'hearing_audio';
    audio_base64: string;
    format: AudioFormat;
};

export type PingMessage = {
    type: 'ping';
};

export type HearingOutgoingMessage = 
| HearingTextMessage
| HearingAudioMessage
| PingMessage;

export type SignToSpeechResultMessage = {
    type: 'sign_to_speech_result';
} & SignToSpeechResult;

export type HearingIncomingMessage = 
| CommonIncomingMessage
| SignToSpeechResultMessage;

// * =================================
// * 농인(Signer) 송신 / 수신
// * =================================

export type SignerKeypointsMessage = {
    type: 'signer_keypoints';
    frames: SignerFrame[];
};

export type SignerOutgoingMessage = SignerKeypointsMessage | PingMessage;

export type SpeechToSignResultMessage = {
    type: 'speech_to_sign_result';
} & SpeechToSignResult;

export type SignerIncomingMessage = 
| CommonIncomingMessage
| SpeechToSignResultMessage;
