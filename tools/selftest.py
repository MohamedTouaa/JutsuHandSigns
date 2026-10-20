"""Headless self-test: no camera or display needed.

1. Classifies synthetic MediaPipe-style landmarks for every pose.
2. Drives a full jutsu sequence through the Game state machine.
3. Renders both effects into a dummy frame (smoke test).

Run:  python tools/selftest.py
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.signs import classify                       # noqa: E402
from src.game import Game                           # noqa: E402
from src.hand_tracker import HandData               # noqa: E402
from src.jutsus import DIFFICULTIES, JUTSUS         # noqa: E402
from src.effects.rasengan import RasenganEffect     # noqa: E402
from src.effects.chidori import ChidoriEffect       # noqa: E402

# --------------------------------------------------------------- synthetic hand

_Wrist = np.array([0.0, 0.0])
_MCPS = {
    "index": np.array([50.0, -85.0]),
    "middle": np.array([18.0, -98.0]),
    "ring": np.array([-15.0, -95.0]),
    "pinky": np.array([-45.0, -80.0]),
}
_DIRS = {
    "index": np.array([0.33, -0.94]),
    "middle": np.array([0.06, -1.00]),
    "ring": np.array([-0.25, -0.97]),
    "pinky": np.array([-0.50, -0.87]),
}
_PIP = 48.0
_TIP_EXT = 86.0
_TIP_CURL = 10.0


def make_hand(i=False, m=False, r=False, p=False, thumb=False):
    """Build a 21x2 landmark array like MediaPipe would produce."""
    pts = [np.zeros(2)]
    if thumb:
        pts += [np.array([25, -18]), np.array([30, -15]), np.array([42, -22]),
                np.array([150, -20])]
    else:
        pts += [np.array([25, -18]), np.array([30, -15]), np.array([42, -22]),
                np.array([55, -30])]
    flags = {"index": i, "middle": m, "ring": r, "pinky": p}
    base = {"index": 5, "middle": 9, "ring": 13, "pinky": 17}
    for name in ("index", "middle", "ring", "pinky"):
        mcp = _MCPS[name]
        d = _DIRS[name]
        up = flags[name]
        pip = mcp + _PIP * d
        tip = mcp + (_TIP_EXT if up else _TIP_CURL) * d
        mid = (mcp + pip) / 2
        dip = (pip + tip) / 2
        pts += [mcp, pip, dip, tip]
    arr = np.array(pts, np.float32)
    assert arr.shape == (21, 2), arr.shape
    return arr


def test_classifier():
    cases = [
        (make_hand(), "FIST"),
        (make_hand(thumb=True), "THUMB"),
        (make_hand(i=True), "POINT"),
        (make_hand(i=True, m=True), "PEACE"),
        (make_hand(i=True, m=True, r=True), "THREE"),
        (make_hand(i=True, m=True, r=True, p=True), "OPEN"),
        (make_hand(p=True), "HOOK"),
        (make_hand(i=True, r=True), None),          # ambiguous
        (make_hand(m=True), None),
        (make_hand(i=True, m=True, p=True), None),
    ]
    for pts, expected in cases:
        got = classify(pts)
        assert got == expected, f"expected {expected}, got {got}"
    print("[OK] classifier: all poses match")


def test_game_flow():
    game = Game()
    game.char = "naruto"
    game.diff_key = "medium"
    game._start_play()
    assert game.seq == JUTSUS["naruto"].sign_seq[:5]
    assert game.pose_seq == JUTSUS["naruto"].pose_seq[:5]

    # wrong pose does not advance
    pts_wrong = make_hand(i=True, m=True) if game.pose_seq[0] != "PEACE" \
        else make_hand()
    for _ in range(20):
        game.update(HandData(pts_wrong, (400.0, 400.0), 90.0, "Right"), 0.1)
    assert game.idx == 0, f"advanced on wrong pose, idx={game.idx}"

    # hold the right pose long enough to complete the full sequence
    for idx, pose in enumerate(game.pose_seq):
        # synthetic geometry is only exact for POINT/PEACE/etc - map pose
        pts = synth_for(pose)
        assert pts is not None, pose
        steps = int(DIFFICULTIES["medium"]["hold"] / 0.1) + 2
        for _ in range(steps):
            if game.state != "play":  # crossed into cast on the last sign
                break
            game.update(HandData(pts, (400.0, 400.0), 90.0, "Right"), 0.1)
        assert game.state in ("play", "cast")
        assert game.idx == idx + 1, f"idx {game.idx} != {idx + 1}"

    assert game.state == "cast", game.state
    assert game.effect is not None
    game._finish_cast()
    assert game.success and game.state == "result"
    print("[OK] game flow: full sequence -> cast -> result")


def synth_for(pose):
    combos = {
        "FIST": {}, "THUMB": {"thumb": True}, "POINT": {"i": True},
        "PEACE": {"i": True, "m": True},
        "THREE": {"i": True, "m": True, "r": True},
        "OPEN": {"i": True, "m": True, "r": True, "p": True},
        "HOOK": {"p": True},
    }
    flags = combos.get(pose)
    if flags is None:
        return None
    return make_hand(**flags)


def test_effects():
    canvas = np.zeros((480, 640, 3), np.uint8)
    anchor = (320.0, 240.0)
    for effect in (RasenganEffect(), ChidoriEffect()):
        for _ in range(8):
            effect.update(1 / 30.0, 1.0, anchor, 90.0)
            effect.draw(canvas, anchor, 90.0, 1.0)
        assert canvas.sum() > 0, f"{type(effect).__name__} drew nothing"
    # hand can be lost at the boundary: must not crash on extreme dz
    ras = RasenganEffect()
    ras.update(0.1, 1.0, anchor, -1000.0)
    ras.draw(canvas, (0, 0), 900.0, 1.0)
    print("[OK] effects: both render without errors")


def test_key_navigation():
    game = Game()
    assert game.handle_key(ord("1"))            # select naruto
    assert game.state == "menu"
    game.handle_key(13)                         # enter
    assert game.state == "difficulty" and game.char == "naruto"
    game.handle_key(ord("2"))                   # medium
    game.hand = None
    game.handle_key(13)
    assert game.state == "play" and game.diff_key == "medium"
    game.handle_key(ord("m"))
    assert game.state == "menu"
    print("[OK] key navigation works")


if __name__ == "__main__":
    test_classifier()
    test_game_flow()
    test_effects()
    test_key_navigation()
    print("ALL SELFTESTS PASSED")
