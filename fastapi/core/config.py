import os
from pathlib import Path

CORE_DIR = Path(__file__).parent
LKS_DIR = CORE_DIR.parent
DATA_DIR = LKS_DIR / "data"
EXTERNAL_DATA_DIR = DATA_DIR / "external"
DERIVED_DATA_DIR = DATA_DIR / "derived"
RAW_DATA_DIR = DATA_DIR / "raw"

# ── 외부 원본 데이터 루트 (gitignore 대상) ──────────────────────────────────
BASE  = EXTERNAL_DATA_DIR / "aihub_sign"
TRAIN = BASE / "1.Training"
VAL   = BASE / "2.Validation"
AI    = BASE / "03.AI모델" / "03.AI모델"
SPLITS_DIR = DERIVED_DATA_DIR / "splits"

# ── 문장 keypoint (CTC 학습용) ─────────────────────────────────────────────
TRAIN_SEN_KEYPOINT_ZIP     = TRAIN / "[라벨]01_real_sen_keypoint.zip"
VAL_SEN_09_KEYPOINT_ZIP    = VAL   / "[라벨]09_real_sen_keypoint.zip"
VAL_CROWD_KEYPOINT_ZIP     = VAL   / "[라벨]01_crowd_keypoint.zip"
VAL_SYN_SEN_KEYPOINT_ZIP   = VAL   / "[라벨]02_syn_sen_keypoint.zip"

# ── 단어 keypoint (향후 CTC 학습 통합 예정) ────────────────────────────────
VAL_WORD_REAL_KEYPOINT_ZIP = VAL / "[라벨]09_real_word_keypoint.zip"
VAL_WORD_SYN_KEYPOINT_ZIP  = VAL / "[라벨]02_syn_word_keypoint.zip"

# zip별 내부 경로 prefix (load_video_keypoints zip_inner_prefix 파라미터에 사용)
# ex) "keypoint/" → keypoint/{folder}/{video}/..._keypoints.json
KEYPOINT_ZIP_PREFIX = {
    str(TRAIN_SEN_KEYPOINT_ZIP):     "",             # 01/{video}/
    str(VAL_SEN_09_KEYPOINT_ZIP):    "keypoint/",    # keypoint/17/{video}/
    str(VAL_CROWD_KEYPOINT_ZIP):     "keypoint/",    # keypoint/18/{video}/
    str(VAL_SYN_SEN_KEYPOINT_ZIP):   "SEN/keypoint/",
    str(VAL_WORD_REAL_KEYPOINT_ZIP): "keypoint/",    # keypoint/17/{video}/
    str(VAL_WORD_SYN_KEYPOINT_ZIP):  "WORD/keypoint/",
}

# ── 문장 morpheme (글로스 레이블, CTC 학습 / clip 추출) ─────────────────────
TRAIN_SEN_MORPHEME_ZIP  = TRAIN / "[라벨]01_real_sen_morpheme.zip"
VAL_SEN_09_MORPHEME_ZIP = VAL   / "[라벨]09_real_sen_morpheme.zip"

# ── 단어 morpheme (통합 DB용) ──────────────────────────────────────────────
WORD_MORPHEME_ZIP = VAL / "[라벨]01_real_word_morpheme.zip"

# ── 영상 (클립 추출용) ─────────────────────────────────────────────────────
WORD_VIDEO_ZIP   = VAL   / "[원천]01_real_word_video.zip"
SEN_01_VIDEO_ZIP = TRAIN / "[원천]01_real_sen_video.zip"
SEN_09_VIDEO_ZIP = VAL   / "[원천]09_real_sen_video.zip"

# ── CSV (NIA_CSLR 베이스라인 호환, 문장 split 기준) ───────────────────────
OFFICIAL_TRAIN_CSV = AI / "NIA_SEN_train.csv"
OFFICIAL_VAL_CSV   = AI / "NIA_SEN_val.csv"
AVAILABLE_TRAIN_CSV = SPLITS_DIR / "available_train.csv"
AVAILABLE_VAL_CSV   = SPLITS_DIR / "available_val.csv"
TRAIN_CSV = AVAILABLE_TRAIN_CSV if AVAILABLE_TRAIN_CSV.exists() else OFFICIAL_TRAIN_CSV
VAL_CSV   = AVAILABLE_VAL_CSV if AVAILABLE_VAL_CSV.exists() else OFFICIAL_VAL_CSV

# ── GKSL 데이터셋 (seq2seq fine-tuning용) ────────────────────────────────
# 레포 내부 외부데이터 경로: LKS/data/external/GKSL-dataset
GKSL_DIR = EXTERNAL_DATA_DIR / "GKSL-dataset"
MALMOONGCHI_DIR = EXTERNAL_DATA_DIR / "malmoongchi"

# ── 출력 경로 ─────────────────────────────────────────────────────────────
WORD_CLIPS_DIR      = DERIVED_DATA_DIR / "word_clips"
CACHE_DIR           = DERIVED_DATA_DIR / "cache"
CHECKPOINTS_DIR     = DERIVED_DATA_DIR / "checkpoints"
VOCAB_PATH          = DERIVED_DATA_DIR / "vocab.json"
WORD_DB_PATH        = DERIVED_DATA_DIR / "word_db.json"
GLOSS_INVENTORY_PATH = DERIVED_DATA_DIR / "gloss_inventory.json"
GLOSS_INVENTORY_REPORT_PATH = DERIVED_DATA_DIR / "gloss_inventory_report.json"
GENERATED_WORD_CLIPS_DIR = DERIVED_DATA_DIR / "word_clips_generated"
GENERATED_WORD_DB_PATH = DERIVED_DATA_DIR / "word_db_generated.json"
GENERATED_WORD_KEYPOINT_CLIPS_DIR = DERIVED_DATA_DIR / "word_keypoint_clips_generated"
GENERATED_WORD_KEYPOINT_DB_PATH = DERIVED_DATA_DIR / "word_keypoint_db_generated.json"
GLOSS_CANDIDATE_MANIFEST_PATH = DERIVED_DATA_DIR / "gloss_candidate_manifest.json"
GLOSS_SELECTION_REPORT_PATH = DERIVED_DATA_DIR / "gloss_selection_report.json"
GLOSS_PROJECTION_MAP_PATH = DERIVED_DATA_DIR / "gloss_projection_map.json"
SEQ2SEQ_DATA_DIR    = DERIVED_DATA_DIR / "seq2seq"
SEQ2SEQ_DATA_PATH   = SEQ2SEQ_DATA_DIR / "dataset.json"
SEQ2SEQ_REPORT_PATH = SEQ2SEQ_DATA_DIR / "dataset_report.json"
SEQ2SEQ_MODEL_DIR   = CHECKPOINTS_DIR / "seq2seq"
OUTPUTS_DIR         = DERIVED_DATA_DIR / "outputs"
SEGMENT_MANIFEST_DIR = DERIVED_DATA_DIR / "segment_manifests"

# ── 특징 차원 ─────────────────────────────────────────────────────────────
IMG_W        = 1920
IMG_H        = 1080
# sign-v2: pose 33pt×2 + lhand 21pt×2 + rhand 21pt×2 (face 제외)
KEYPOINT_DIM = 150
MP_LSHOULDER = 11   # MediaPipe pose landmark index
MP_RSHOULDER = 12
LOWER_BODY_START = 23   # 23~32번 포인트 = 하체 → 제로 처리
FPS          = 30

# ── 모델 (sign-v2 Conformer) ───────────────────────────────────────────────
SIGN_MODEL_DIM        = 256
SIGN_MODEL_LAYERS     = 4
SIGN_MODEL_HEADS      = 4
SIGN_MODEL_FF_MULT    = 4
SIGN_CONV_KERNEL      = 15
DROPOUT               = 0.1
TOKEN_AUX_LOSS_WEIGHT = 0.2
MAX_SEGMENT_FRAMES    = 96

# ── 학습 ──────────────────────────────────────────────────────────────────
# 30k 풀 데이터셋 기준 (REAL01~REAL20 전체 캐시 완료 후)
# 소규모(3k) 데이터 시절: BATCH_SIZE=8, LR=1e-3, DROPOUT=0.3
BATCH_SIZE = 64
LR         = 5e-4
EPOCHS     = 100
GRAD_CLIP  = 5.0

# ── 번역 백엔드 선택 ────────────────────────────────────────────────────
# "t5"    : fine-tuned pko-t5-small (오프라인, 빠름, Jetson Orin Nano 배포용)
# "ollama": 로컬 ollama LLM (학습 전 또는 비교용)
# "openai": OpenAI API
TRANSLATION_BACKEND = "t5"
# TRANSLATION_BACKEND = "ollama"

# ── LLM (ollama 우선, OpenAI fallback) ───────────────────────────────────
OPENAI_MODEL    = "gpt-4o"
OLLAMA_BASE_URL = "http://localhost:11434/v1"
OLLAMA_MODEL    = "gemma4:e4b"

# ── 하위호환: 기존 코드가 참조하는 변수명 유지 ──────────────────────────────
TRAIN_KEYPOINT_ZIP  = TRAIN_SEN_KEYPOINT_ZIP
VAL_KEYPOINT_ZIP    = VAL_SEN_09_KEYPOINT_ZIP
TRAIN_MORPHEME_ZIP  = TRAIN_SEN_MORPHEME_ZIP
WORD_MORPHEME_ZIP   = WORD_MORPHEME_ZIP


def get_active_word_db_path() -> Path:
    override = os.getenv("LKS_WORD_DB_PATH")
    if override:
        return Path(override)

    mode = os.getenv("LKS_WORD_DB_MODE", "").strip().lower()
    if mode == "legacy":
        return WORD_DB_PATH
    if mode == "generated":
        return GENERATED_WORD_DB_PATH

    # Default behavior: prefer generated assets when available.
    if GENERATED_WORD_DB_PATH.exists():
        return GENERATED_WORD_DB_PATH
    return WORD_DB_PATH


def get_active_word_keypoint_db_path() -> Path:
    override = os.getenv("LKS_WORD_KEYPOINT_DB_PATH")
    if override:
        return Path(override)
    return GENERATED_WORD_KEYPOINT_DB_PATH
