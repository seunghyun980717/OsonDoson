from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from runtime.sign_to_speech.infer import *  # noqa: F401,F403
