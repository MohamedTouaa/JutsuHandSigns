"""Real two-handed Naruto hand-sign detection.

Vendored from Kazuhito00/NARUTO-HandSignDetection (MIT license, see
yolox/THIRD_PARTY_LICENSE_NARUTO-HandSignDetection.txt): a YOLOX-Nano object
detector trained directly on images of the actual two-handed seals, so it
detects which of the 12 canonical seals (plus a few extras) a person is
forming, with a bounding box — not a geometric single-hand heuristic.
"""
import csv
import os
import re

from .yolox.yolox_onnx import YoloxONNX

_HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(_HERE, "yolox", "yolox_nano.onnx")
LABELS_PATH = os.path.join(_HERE, "data", "labels.csv")

_NAME_RE = re.compile(r"\(([^)]+)\)")


def _load_labels():
    with open(LABELS_PATH, encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    labels = []
    for en, jp in rows:
        m = _NAME_RE.search(en)
        labels.append({"en": m.group(1) if m else en, "en_raw": en, "jp": jp})
    return labels


LABELS = _load_labels()

# The 12 canonical zodiac seals (what jutsu sequences are built from) —
# excludes the "None"/"Gassho"/"Unknown"/"Mizunoe" extras.
CANONICAL_SIGNS = ["Rat", "Ox", "Tiger", "Hare", "Dragon", "Snake", "Horse",
                   "Ram", "Monkey", "Bird", "Dog", "Boar"]


class SignDetector:
    def __init__(self, score_th=0.6):
        self.score_th = score_th
        self.yolox = YoloxONNX(
            model_path=MODEL_PATH,
            input_shape=(416, 416),
            class_score_th=score_th,
            nms_th=0.45,
            nms_score_th=0.1,
            providers=["CPUExecutionProvider"],
        )

    def detect(self, frame_bgr):
        """Returns the single best detection as a dict
        {en, jp, score, bbox: (x1,y1,x2,y2)}, or None."""
        bboxes, scores, class_ids = self.yolox.inference(frame_bgr)
        best = None
        for bbox, score, class_id in zip(bboxes, scores, class_ids):
            if score < self.score_th:
                continue
            label = LABELS[int(class_id) + 1]
            if best is None or score > best["score"]:
                best = {
                    "en": label["en"],
                    "jp": label["jp"],
                    "score": float(score),
                    "bbox": (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])),
                }
        return best
