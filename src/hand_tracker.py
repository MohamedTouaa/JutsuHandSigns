import os
import time
import urllib.request

import cv2
import numpy as np

import mediapipe as mp
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions

MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/"
             "hand_landmarker/hand_landmarker/float16/1/"
             "hand_landmarker.task")
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         os.pardir, "models")
MODEL_PATH = os.path.join(MODEL_DIR, "hand_landmarker.task")

PANEL_IDS = (0, 5, 9, 13, 17)
_EMA = 0.35  # weight of the new measurement when smoothing the anchor

# fingertip connections (legacy HAND_CONNECTIONS set)
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]


def _ensure_model():
    if os.path.exists(MODEL_PATH):
        return
    os.makedirs(MODEL_DIR, exist_ok=True)
    print("Downloading hand_landmarker.task (one-time, ~8 MB)...")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print("Model saved to", os.path.relpath(MODEL_PATH))


class HandData:
    """Processed single-hand result for one frame."""

    __slots__ = ("points", "palm", "scale", "handed")

    def __init__(self, points, palm, scale, handed):
        self.points = points    # np.ndarray shape (21, 2), pixel coords
        self.palm = palm        # (x, y) smoothed palm center
        self.scale = scale      # approx px distance wrist -> middle MCP
        self.handed = handed    # "Left" / "Right"


class HandTracker:
    """Thin wrapper around the MediaPipe HandLandmarker task for one hand."""

    def __init__(self, max_hands=1):
        _ensure_model()
        options = vision.HandLandmarkerOptions(
            base_options=BaseOptions(
                model_asset_path=MODEL_PATH),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=max_hands,
            min_hand_detection_confidence=0.6,
            min_hand_presence_confidence=0.6,
            min_tracking_confidence=0.5,
        )
        self._landmarker = vision.HandLandmarker.create_from_options(options)
        self._last_ts = None
        self._prev_palm = None
        self._prev_scale = None

    def process(self, frame_bgr):
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        h, w = frame_bgr.shape[:2]
        now = time.perf_counter() * 1000.0
        ts = now if self._last_ts is None else max(now, self._last_ts + 1.0)
        self._last_ts = ts

        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self._landmarker.detect_for_video(mp_image, int(ts))
        if not result.hand_landmarks:
            self._prev_palm = None
            self._prev_scale = None
            return None

        lm = result.hand_landmarks[0]
        pts = np.array([(p.x * w, p.y * h) for p in lm], dtype=np.float32)

        palm = pts[list(PANEL_IDS)].mean(axis=0)
        scale = float(np.linalg.norm(pts[0] - pts[9]))

        if self._prev_palm is not None:
            palm = self._prev_palm + _EMA * (palm - self._prev_palm)
        if self._prev_scale is not None:
            scale = self._prev_scale + _EMA * (scale - self._prev_scale)

        self._prev_palm = palm
        self._prev_scale = scale

        handed = "Right"
        if result.handedness:
            handed = result.handedness[0][0].category_name

        return HandData(pts, (float(palm[0]), float(palm[1])), scale, handed)

    def close(self):
        self._landmarker.close()
