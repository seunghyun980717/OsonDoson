from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from core.data_utils.video_to_keypoints import *  # noqa: F401,F403
