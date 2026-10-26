"""Persists every processed webcam frame to disk, alongside the traits and
match result computed for it — so captures can be reviewed or reused later
(e.g. to build a per-user animation)."""
import json
import os
import uuid
from datetime import datetime, timezone

import cv2

CAPTURES_DIR = os.path.join(os.path.dirname(__file__), "captures")
# Set SAVE_CAPTURES=0 when hosting publicly: captures are visitors' face photos.
SAVE_CAPTURES = os.environ.get("SAVE_CAPTURES", "1") != "0"
if SAVE_CAPTURES:
    os.makedirs(CAPTURES_DIR, exist_ok=True)


def save_capture(image, traits, match=None):
    if not SAVE_CAPTURES:
        return None
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    stem = f"{timestamp}-{uuid.uuid4().hex[:8]}"

    image_path = os.path.join(CAPTURES_DIR, f"{stem}.jpg")
    cv2.imwrite(image_path, image)

    meta = {
        "timestamp": timestamp,
        "traits": traits,
        "match": match,
    }
    meta_path = os.path.join(CAPTURES_DIR, f"{stem}.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    return image_path
