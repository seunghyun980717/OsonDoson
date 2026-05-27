"""
(T, 134) keypoint npy 시각화

npy 레이아웃:
  [0:50]   pose 25pt × (x, y)   — 어깨 기준 정규화 좌표
  [50:92]  hand_left 21pt × (x, y)
  [92:134] hand_right 21pt × (x, y)

사용법:
    python visualize_npy.py --npy path/to/file.npy
    python visualize_npy.py --npy path/to/file.npy --gloss "버스 곳 내리다"
    python visualize_npy.py --npy path/to/file.npy --output out.mp4
    python visualize_npy.py --npy path/to/file.npy --video original.mp4
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

try:
    from PIL import Image, ImageDraw, ImageFont
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

COLOR_POSE       = (0, 255, 0)
COLOR_LEFT_HAND  = (255, 100, 0)
COLOR_RIGHT_HAND = (0, 100, 255)

POSE_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (1, 5), (5, 6), (6, 7),
    (0, 15), (15, 17), (0, 16), (16, 18),
    (1, 8), (8, 9), (9, 10), (10, 11),
    (8, 12), (12, 13), (13, 14),
]

HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (0, 9), (9, 10), (10, 11), (11, 12),
    (0, 13), (13, 14), (14, 15), (15, 16),
    (0, 17), (17, 18), (18, 19), (19, 20),
    (5, 9), (9, 13), (13, 17),
]

_KOREAN_FONT_PATHS = [
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "C:/Windows/Fonts/malgun.ttf",
]

_cached_font = None


def _get_korean_font(size=36):
    if not _PIL_AVAILABLE:
        return None
    for path in _KOREAN_FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def denormalize(seq: np.ndarray, W: int, H: int) -> np.ndarray:
    """어깨 기준 정규화 좌표 → 캔버스 픽셀 좌표."""
    scale = H * 0.28
    cx, cy = W // 2, int(H * 0.38)
    px = (seq[:, :, 0] * scale + cx).astype(np.float32)
    py = (seq[:, :, 1] * scale + cy).astype(np.float32)
    return np.stack([px, py], axis=-1)  # (T, N, 2)


def draw_skeleton(frame, pts_2d, connections, color, r=4, t=2):
    for i, j in connections:
        if i < len(pts_2d) and j < len(pts_2d):
            cv2.line(frame, (int(pts_2d[i][0]), int(pts_2d[i][1])),
                     (int(pts_2d[j][0]), int(pts_2d[j][1])), color, t, cv2.LINE_AA)
    for x, y in pts_2d:
        cv2.circle(frame, (int(x), int(y)), r, color, -1, cv2.LINE_AA)


def draw_legend(frame):
    items = [("Pose", COLOR_POSE), ("L-Hand", COLOR_LEFT_HAND), ("R-Hand", COLOR_RIGHT_HAND)]
    y = 22
    for label, color in items:
        cv2.circle(frame, (15, y), 5, color, -1)
        cv2.putText(frame, label, (26, y + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)
        y += 20


def draw_gloss(frame, gloss: str):
    global _cached_font
    h, w = frame.shape[:2]
    if _PIL_AVAILABLE:
        if _cached_font is None:
            _cached_font = _get_korean_font(40)
        pil = Image.fromarray(frame[..., ::-1])
        draw = ImageDraw.Draw(pil)
        bbox = draw.textbbox((0, 0), gloss, font=_cached_font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x, y = (w - tw) // 2, h - th - 15
        draw.rectangle([x - 10, y - 6, x + tw + 10, y + th + 6], fill=(0, 0, 0, 200))
        draw.text((x, y), gloss, font=_cached_font, fill=(255, 255, 255))
        frame[...] = np.array(pil)[..., ::-1]
    else:
        font = cv2.FONT_HERSHEY_SIMPLEX
        (tw, th), _ = cv2.getTextSize(gloss, font, 0.9, 2)
        x, y = (w - tw) // 2, h - 20
        cv2.rectangle(frame, (x - 10, y - th - 8), (x + tw + 10, y + 8), (0, 0, 0), -1)
        cv2.putText(frame, gloss, (x, y), font, 0.9, (255, 255, 255), 2, cv2.LINE_AA)


def visualize_npy(
    npy_path: Path,
    gloss: str = "",
    output_path: Path = None,
    video_path: Path = None,
    fps: float = 30.0,
    canvas_size: tuple = (640, 480),
):
    seq = np.load(npy_path)
    if seq.ndim != 2 or seq.shape[1] != 134:
        print(f"[에러] 예상 shape (T, 134), 실제: {seq.shape}")
        sys.exit(1)

    T = len(seq)
    W, H = canvas_size
    pts_all = seq.reshape(T, 67, 2)

    cap = None
    if video_path:
        cap = cv2.VideoCapture(str(video_path))
        if cap.isOpened():
            fps = cap.get(cv2.CAP_PROP_FPS) or fps
            W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        else:
            cap = None

    px = denormalize(pts_all, W, H)

    writer = None
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(output_path), fourcc, fps, (W, H))
        print(f"[출력] {output_path}  ({T}프레임, {fps:.1f}fps)")

    print(f"[로드] {npy_path.name}  shape={seq.shape}")
    if gloss:
        print(f"[글로스] {gloss}")

    for t in range(T):
        if cap:
            ret, frame = cap.read()
            frame = frame if ret else np.zeros((H, W, 3), dtype=np.uint8)
        else:
            frame = np.zeros((H, W, 3), dtype=np.uint8)

        overlay = frame.copy()
        draw_skeleton(overlay, px[t, :25],   POSE_CONNECTIONS,  COLOR_POSE,       r=4, t=2)
        draw_skeleton(overlay, px[t, 25:46], HAND_CONNECTIONS, COLOR_LEFT_HAND,  r=2, t=1)
        draw_skeleton(overlay, px[t, 46:67], HAND_CONNECTIONS, COLOR_RIGHT_HAND, r=2, t=1)
        frame = cv2.addWeighted(overlay, 0.9, frame, 0.1, 0)
        draw_legend(frame)
        if gloss:
            draw_gloss(frame, gloss)
        cv2.putText(frame, f"{t+1}/{T}  {t/fps:.2f}s",
                    (10, H - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 180, 180), 1, cv2.LINE_AA)

        if writer:
            writer.write(frame)
        else:
            cv2.imshow(f"KSL npy Visualizer — {npy_path.stem}", frame)
            key = cv2.waitKey(int(1000 / fps))
            if key == 27:
                break
            elif key == ord(" "):
                cv2.waitKey(0)

    if cap:
        cap.release()
    if writer:
        writer.release()
        print(f"[완료] 저장: {output_path}")
    else:
        cv2.destroyAllWindows()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="KSL npy Keypoint Visualizer")
    parser.add_argument("--npy",    required=True)
    parser.add_argument("--gloss",  default="")
    parser.add_argument("--output", default=None)
    parser.add_argument("--video",  default=None)
    parser.add_argument("--fps",    type=float, default=30.0)
    parser.add_argument("--width",  type=int,   default=640)
    parser.add_argument("--height", type=int,   default=480)
    args = parser.parse_args()

    visualize_npy(
        npy_path    = Path(args.npy),
        gloss       = args.gloss,
        output_path = Path(args.output) if args.output else None,
        video_path  = Path(args.video)  if args.video  else None,
        fps         = args.fps,
        canvas_size = (args.width, args.height),
    )
