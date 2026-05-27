from dataclasses import dataclass
from typing import Optional


@dataclass
class AppState:
    device_info: Optional[dict]   = None   # {"device": "cuda"|"cpu", ...}
    retriever:   Optional[object] = None   # GlossRetriever
    translator:  Optional[object] = None   # GlossTranslator (T5)
    word_db:     Optional[dict]   = None   # {gloss: clip_path}
    stt_model:   Optional[object] = None   # Whisper (lazy load)
    ctc_model:   Optional[object] = None   # SignLSTM (CTC)
    ctc_vocab:   Optional[object] = None   # Vocabulary
    label_index: Optional[dict]   = None   # {video_stem: gloss_label} (CSV)


state = AppState()
