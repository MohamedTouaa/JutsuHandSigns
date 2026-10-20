"""Rule-based hand-sign classification from MediaPipe landmarks.

Canonical poses (what the classifier actually detects):
    FIST, OPEN, POINT, PEACE, THREE, THUMB, HOOK

Each pose is later given a Naruto-flavored display name in jutsus.py
(MONKEY, TIGER, OX, RAM, ...).
"""
import numpy as np

# (mcp, pip, tip) landmark ids for each finger
_FINGERS = {
    "index": (5, 6, 8),
    "middle": (9, 10, 12),
    "ring": (13, 14, 16),
    "pinky": (17, 18, 20),
}

W = 0      # wrist
THUMB_TIP = 4
PINKY_MCP = 17
MIDDLE_MCP = 9


def finger_states(pts):
    """Return ({finger: bool extended}, thumb_extended, hand_scale)."""
    wrist = pts[W]
    scale = float(np.linalg.norm(wrist - pts[MIDDLE_MCP]))
    scale = max(scale, 1e-6)

    states = {}
    for name, (mcp, pip, tip) in _FINGERS.items():
        d_tip = np.linalg.norm(pts[tip] - wrist)
        d_pip = np.linalg.norm(pts[pip] - wrist)
        states[name] = bool(d_tip > d_pip * 1.08)

    # thumb: distance from thumb tip to pinky knuckle.
    # tucked -> small (~palm size), raised/spread -> large
    thumb = bool(np.linalg.norm(pts[THUMB_TIP] - pts[PINKY_MCP]) > scale * 1.55)
    return states, thumb, scale


def classify(pts):
    """Classify a 21x2 landmark array (pixel coords) -> pose name or None."""
    s, thumb, _ = finger_states(pts)
    i, m, r, p = s["index"], s["middle"], s["ring"], s["pinky"]
    n_up = i + m + r + p

    if n_up == 0:
        return "THUMB" if thumb else "FIST"
    if p and not (i or m or r):
        return "HOOK" if not thumb else None
    if i and not (m or r or p):
        return "POINT"
    if i and m and not (r or p):
        return "PEACE"
    if i and m and r and not p:
        return "THREE"
    if n_up == 4:
        return "OPEN"
    return None


POSE_DESCRIPTIONS = {
    "FIST": "curl everything - just a fist",
    "OPEN": "open palm, all fingers up",
    "POINT": "only the index finger up",
    "PEACE": "index + middle fingers up",
    "THREE": "index + middle + ring up",
    "THUMB": "thumbs up",
    "HOOK": "only the pinky up",
}
