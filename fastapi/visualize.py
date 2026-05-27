"""
AI Hub 한국수어 Keypoint 시각화
사용법:
    python visualize.py --video data/raw/video/NAME.mp4 --keypoints data/raw/keypoint_json/NAME/ --output out.mp4
    python visualize.py  # data/raw/ 자동 탐색 (morpheme_json도 자동 탐색)
    python visualize.py --no-morpheme  # 자막 비활성화
"""

import json
import argparse
import sys
from pathlib import Path

import cv2

try:
    from PIL import Image, ImageDraw, ImageFont
    _PIL_AVAILABLE = True
except ImportError:
    _PIL_AVAILABLE = False

COLOR_POSE = (0, 255, 0)
COLOR_LEFT_HAND = (255, 100, 0)
COLOR_RIGHT_HAND = (0, 100, 255)
COLOR_FACE = (0, 220, 220)

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


def parse_flat(values):
    """flat [x,y,c, x,y,c, ...] → [(x,y,c), ...]"""
    pts = []
    for i in range(0, len(values) - 2, 3):
        pts.append((float(values[i]), float(values[i + 1]), float(values[i + 2])))
    return pts


def load_frame_keypoints(json_path: Path) -> dict:
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    people = data.get("people", {})
    return {
        "pose": parse_flat(people.get("pose_keypoints_2d", [])),
        "left_hand": parse_flat(people.get("hand_left_keypoints_2d", [])),
        "right_hand": parse_flat(people.get("hand_right_keypoints_2d", [])),
        "face": parse_flat(people.get("face_keypoints_2d", [])),
    }


def draw_skeleton(frame, points, connections, color, r=3, t=2):
    if not points:
        return
    for i, j in connections:
        if i < len(points) and j < len(points):
            x1, y1, c1 = points[i]
            x2, y2, c2 = points[j]
            if c1 > 0 and c2 > 0:
                cv2.line(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, t, cv2.LINE_AA)
    for x, y, c in points:
        if c > 0:
            cv2.circle(frame, (int(x), int(y)), r, color, -1, cv2.LINE_AA)


def draw_frame(frame, kp):
    overlay = frame.copy()

    if kp["face"]:
        for x, y, c in kp["face"]:
            if c > 0:
                cv2.circle(overlay, (int(x), int(y)), 1, COLOR_FACE, -1, cv2.LINE_AA)

    draw_skeleton(overlay, kp["pose"], POSE_CONNECTIONS, COLOR_POSE, r=4, t=2)
    draw_skeleton(overlay, kp["left_hand"], HAND_CONNECTIONS, COLOR_LEFT_HAND, r=2, t=1)
    draw_skeleton(overlay, kp["right_hand"], HAND_CONNECTIONS, COLOR_RIGHT_HAND, r=2, t=1)

    return cv2.addWeighted(overlay, 0.9, frame, 0.1, 0)


def draw_legend(frame):
    items = [("Pose", COLOR_POSE), ("L-Hand", COLOR_LEFT_HAND), ("R-Hand", COLOR_RIGHT_HAND), ("Face", COLOR_FACE)]
    y = 22
    for label, color in items:
        cv2.circle(frame, (15, y), 5, color, -1)
        cv2.putText(frame, label, (26, y + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)
        y += 20
    return frame


def load_morpheme(json_path: Path) -> list:
    """morpheme JSON → [{"start": float, "end": float, "name": str}, ...]"""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    segments = []
    for item in data.get("data", []):
        name = item.get("attributes", [{}])[0].get("name", "")
        segments.append({"start": float(item["start"]), "end": float(item["end"]), "name": name})
    return segments


def get_current_morpheme(segments: list, t: float) -> str | None:
    for seg in segments:
        if seg["start"] <= t <= seg["end"]:
            return seg["name"]
    return None


# 한글 폰트 경로 후보
_KOREAN_FONT_PATHS = [
    "C:/Windows/Fonts/malgun.ttf",
    "C:/Windows/Fonts/gulim.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
]


def _get_korean_font(size=32):
    if not _PIL_AVAILABLE:
        return None
    from PIL import ImageFont
    for path in _KOREAN_FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


_cached_font = None


def draw_subtitle(frame, text: str) -> None:
    """프레임 하단 중앙에 한글 자막을 그립니다 (PIL 사용, 없으면 cv2 fallback)."""
    global _cached_font
    h, w = frame.shape[:2]

    if _PIL_AVAILABLE:
        import numpy as np
        from PIL import Image, ImageDraw
        if _cached_font is None:
            _cached_font = _get_korean_font(64)
        pil = Image.fromarray(frame[..., ::-1])  # BGR→RGB
        draw = ImageDraw.Draw(pil)
        bbox = draw.textbbox((0, 0), text, font=_cached_font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        # x, y = (w - tw) // 2, h - th - 20
        x, y = (w - tw) // 2, h - th - 250
        draw.rectangle([x - 10, y - 6, x + tw + 10, y + th + 6], fill=(0, 0, 0, 180))
        draw.text((x, y), text, font=_cached_font, fill=(255, 255, 255))
        frame[...] = np.array(pil)[..., ::-1]  # RGB→BGR, overwrite in-place
    else:
        font = cv2.FONT_HERSHEY_SIMPLEX
        scale, thick = 1.0, 2
        (tw, th), _ = cv2.getTextSize(text, font, scale, thick)
        x, y = (w - tw) // 2, h - 30
        cv2.rectangle(frame, (x - 10, y - th - 8), (x + tw + 10, y + 8), (0, 0, 0), -1)
        cv2.putText(frame, text, (x, y), font, scale, (255, 255, 255), thick, cv2.LINE_AA)


def find_data_auto(base: Path):
    """data/raw/ 아래에서 영상, keypoint 폴더, morpheme JSON을 자동으로 찾습니다."""
    videos = list((base / "video").glob("*.mp4"))
    if not videos:
        return None, None, None
    video = videos[0]
    kp_root = base / "keypoint_json" / video.stem
    morpheme_candidates = list((base / "morpheme_json").glob(f"{video.stem}_morpheme.json"))
    morpheme = morpheme_candidates[0] if morpheme_candidates else None
    return video, kp_root if kp_root.exists() else None, morpheme


def visualize(video_path: Path, kp_dir: Path, morpheme_path: Path = None, output_path: Path = None):
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"[에러] 영상 열기 실패: {video_path}")
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"[정보] {video_path.name}  |  {w}x{h}  {fps:.1f}fps  {total}프레임")

    json_files = {int(p.stem.split("_")[-2]): p for p in sorted(kp_dir.glob("*_keypoints.json"))}
    print(f"[정보] keypoint JSON {len(json_files)}개 로드")

    morpheme_segments = []
    if morpheme_path:
        morpheme_segments = load_morpheme(morpheme_path)
        print(f"[정보] morpheme {len(morpheme_segments)}개 로드: {morpheme_path.name}")
        if not _PIL_AVAILABLE:
            print("[경고] Pillow 미설치 — 한글 자막이 깨질 수 있습니다 (pip install pillow)")

    writer = None
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(output_path), fourcc, fps, (w, h))

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx in json_files:
            try:
                kp = load_frame_keypoints(json_files[frame_idx])
            except Exception as e:
                print(f"[경고] 프레임 {frame_idx} JSON 파싱 실패: {e}")
                kp = {"pose": [], "left_hand": [], "right_hand": [], "face": []}
        else:
            kp = {"pose": [], "left_hand": [], "right_hand": [], "face": []}

        frame = draw_frame(frame, kp)
        draw_legend(frame)

        if morpheme_segments:
            current_time = frame_idx / fps
            label = get_current_morpheme(morpheme_segments, current_time)
            if label:
                draw_subtitle(frame, label)

        cv2.putText(frame, f"{frame_idx}/{total}  {frame_idx/fps:.2f}s",
                    (10, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 180, 180), 1, cv2.LINE_AA)

        if writer:
            writer.write(frame)
            if frame_idx % 50 == 0:
                print(f"  {frame_idx}/{total} ({frame_idx/total*100:.1f}%)")
        else:
            cv2.imshow("KSL Visualizer", frame)
            key = cv2.waitKey(int(1000 / fps))
            if key == 27:
                break
            elif key == ord(" "):
                cv2.waitKey(0)

        frame_idx += 1

    cap.release()
    if writer:
        writer.release()
        print(f"[완료] 저장: {output_path}")
    else:
        cv2.destroyAllWindows()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AI Hub KSL Keypoint Visualizer")
    parser.add_argument("--video", default=None)
    parser.add_argument("--keypoints", default=None, help="프레임별 JSON이 담긴 폴더")
    parser.add_argument("--morpheme", default=None, help="morpheme JSON 파일 경로")
    parser.add_argument("--no-morpheme", action="store_true", help="자막 비활성화")
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    base = Path(__file__).parent / "data" / "raw"

    if args.video and args.keypoints:
        video_path = Path(args.video)
        kp_dir = Path(args.keypoints)
        morpheme_path = Path(args.morpheme) if args.morpheme else None
    else:
        video_path, kp_dir, morpheme_path = find_data_auto(base)
        if video_path is None:
            print(f"[에러] {base}/video/ 에 .mp4 파일이 없습니다.")
            sys.exit(1)
        if kp_dir is None:
            print(f"[에러] keypoint_json/{video_path.stem}/ 폴더를 찾을 수 없습니다.")
            sys.exit(1)
        print(f"[자동 탐색] video={video_path.name}  keypoints={kp_dir.name}  morpheme={morpheme_path and morpheme_path.name}")

    if args.no_morpheme:
        morpheme_path = None

    output_path = Path(args.output) if args.output else None
    visualize(video_path, kp_dir, morpheme_path, output_path)
