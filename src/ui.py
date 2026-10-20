"""All 2D drawing: menus, HUD, sign icons, glow text."""
import math

import cv2

from . import icons
from . import text as textfx
from .hand_tracker import HAND_CONNECTIONS
from .jutsus import (CHARACTER_INFO, DIFFICULTIES, DIFF_ORDER,
                     POSE_TO_SIGN, SIGN_TO_POSE, JUTSUS)
from .signs import POSE_DESCRIPTIONS

GREEN = (120, 220, 120)
GRAY = (140, 140, 140)
DARK = (50, 50, 50)


def dim(img, factor=0.45):
    cv2.convertScaleAbs(img, img, alpha=factor, beta=0)


def glow_text(img, xy, text, size, color=(255, 255, 255),
              glow_color=None, thickness=2, glow=None, align="center"):
    """Anti-aliased TTF text with soft glow (Pillow-backed)."""
    if glow is None:
        glow = 2 if size < 0.9 else 3
    textfx.draw_text(img, xy, text, size=size, bgr=color,
                     glow_bgr=glow_color, glow=glow, align=align,
                     title=size >= 0.95)


def panel(img, rect, fill=(28, 16, 10), border=(255, 165, 40), thickness=1):
    x, y, w, h = rect
    if fill is not None:
        cv2.rectangle(img, (x, y), (x + w, y + h), fill, -1)
    if border is not None:
        cv2.rectangle(img, (x, y), (x + w, y + h), border, thickness, cv2.LINE_AA)


def draw_pose_pictogram(img, pose, center, size, color, highlight=False):
    """Anti-aliased hand glyph for a canonical pose."""
    icons.paste(img, pose, center, size, color, highlight)


def pose_hint(img, pose, rect, label_color):
    """Target-sign panel: pictogram + display name + description."""
    x, y, w, h = rect
    panel(img, rect, border=label_color, thickness=2)
    cx = x + w // 2
    draw_pose_pictogram(img, pose, (cx, y + int(h * 0.1)), 70, label_color)
    name = POSE_TO_SIGN.get(pose, pose)
    glow_text(img, (cx, y + h * 0.33), name, 0.7, label_color)
    glow_text(img, (cx, y + h * 0.45), POSE_DESCRIPTIONS[pose], 0.42,
              (210, 210, 210), thickness=1, glow=2)


def sequence_bar(img, signs, idx, hold_frac, jutsu_name, label_color,
                 show_pictograms=True):
    """Row of sign slots: done / current / upcoming."""
    box_w, box_h, gap = 58, 66, 10
    n = len(signs)
    total = n * box_w + (n - 1) * gap
    x0 = (img.shape[1] - total) // 2
    y0 = 64

    glow_text(img, (img.shape[1] // 2, 34), jutsu_name, 0.85, label_color,
              glow=4)
    for i, sign in enumerate(signs):
        x = x0 + i * (box_w + gap)
        if i < idx:                      # completed
            fill, border, col = (60, 120, 60), GREEN, GREEN
        elif i == idx:                   # current
            fill, border, col = (80, 60, 30), (255, 255, 255), (255, 255, 255)
        else:                            # upcoming
            fill, border, col = (25, 25, 25), DARK, GRAY
        rect = (x, y0, box_w, box_h)
        panel(img, rect, fill=fill, border=border,
              thickness=2 if i == idx else 1)
        center = (x + box_w // 2, y0 + box_h // 2 + 8)
        if show_pictograms:
            draw_pose_pictogram(img, SIGN_TO_POSE[sign], center, 38, col,
                                highlight=(i == idx))
        else:
            textfx.draw_text(img, center, "?", size_px=30, bgr=col,
                             glow=1, title=True)
        # hold progress underline for the current slot
        if i == idx and hold_frac > 0:
            cv2.line(img, (x, y0 + box_h), (x + int(box_w * hold_frac),
                                            y0 + box_h), (0, 255, 200), 4)


def hand_ring(img, palm, scale, frac, active):
    """Hold-progress ring drawn around the palm."""
    r = max(30, int(scale * 1.25))
    base = (255, 255, 255) if active else (150, 150, 150)
    cv2.ellipse(img, (int(palm[0]), int(palm[1])), (r, r), 0, 0, 360, base, 1,
                cv2.LINE_AA)
    if frac > 0.01:
        cv2.ellipse(img, (int(palm[0]), int(palm[1])), (r, r), 0, -90,
                    -90 + 360 * min(1.0, frac), (0, 255, 200), 3, cv2.LINE_AA)


def char_menu(img, sel, t, chars):
    dim(img, 0.5)
    w, h = img.shape[1], img.shape[0]
    glow_text(img, (w // 2, 60), "JUTSU  HAND  SIGNS", 1.6, (255, 255, 255),
              (255, 160, 60), glow=6)
    glow_text(img, (w // 2, 105), "choose your ninja", 0.55, (200, 200, 200),
              thickness=1, glow=2)

    card_w, card_h = 340, 330
    cx0 = w // 2 - card_w - 60
    for i, char in enumerate(chars):
        info = CHARACTER_INFO[char]
        x = cx0 + i * (card_w + 120)
        y = h // 2 - card_h // 2
        rect = (x, y, card_w, card_h)
        selected = (i == sel)
        panel(img, rect,
              border=info["color"] if selected else DARK,
              thickness=3 if selected else 1)
        if selected:
            t2 = t * 2.5
            for k in range(4):
                a = t2 + k * math.tau / 4
                cv2.ellipse(img, (x + card_w // 2, y + card_h - 32),
                            (52 + int(8 * math.sin(t2 * 3)), 16),
                            math.degrees(a), 0, 140, info["color"], 2,
                            cv2.LINE_AA)
        glow_text(img, (x + card_w // 2, y + 50), info["name"], 1.0,
                  info["color"] if selected else (200, 200, 200), glow=4)
        glow_text(img, (x + card_w // 2, y + 100), info["jutsu"], 0.7,
                  (255, 255, 255) if selected else GRAY, thickness=1)
        glow_text(img, (x + card_w // 2, y + 140), info["desc"], 0.42,
                  (190, 190, 190), glow=1)
        glow_text(img, (x + card_w // 2, y + card_h - 82),
                  f"press {i + 1} to select", 0.45,
                  (0, 255, 200) if selected else GRAY, glow=1)

    glow_text(img, (w // 2, h - 60), "ENTER to lock in | Q to quit", 0.5,
              (220, 220, 220), thickness=1, glow=1)


def diff_menu(img, sel, t, char):
    dim(img, 0.5)
    w, h = img.shape[1], img.shape[0]
    info = CHARACTER_INFO[char]
    glow_text(img, (w // 2, 60), f"{info['name']}  |  {info['jutsu'].upper()}",
              1.0, info["color"], glow=4)
    glow_text(img, (w // 2, 105),
              "sequence: " + " -> ".join(JUTSUS[char].sign_seq),
              0.5, (220, 220, 220), thickness=1, glow=0)
    glow_text(img, (w // 2, 150), "choose difficulty", 0.55, (200, 200, 200),
              thickness=1, glow=2)

    card_w, card_h = 320, 220
    keys = DIFF_ORDER
    x0 = w // 2 - (3 * card_w + 2 * 50) // 2
    for i, key in enumerate(keys):
        cfg = DIFFICULTIES[key]
        x = x0 + i * (card_w + 50)
        y = h // 2 - 60
        selected = (i == sel)
        border = (0, 255, 200) if selected else DARK
        panel(img, (x, y, card_w, card_h), border=border,
              thickness=3 if selected else 1)
        glow_text(img, (x + card_w // 2, y + 45), cfg["name"], 0.8,
                  (0, 255, 200) if selected else (210, 210, 210), glow=3)
        glow_text(img, (x + card_w // 2, y + 85), cfg["desc"], 0.40,
                  (200, 200, 200), glow=1)
        glow_text(img, (x + card_w // 2, y + 145),
                  f"press {i + 1}", 0.5,
                  (0, 255, 200) if selected else GRAY, thickness=1, glow=1)

    glow_text(img, (w // 2, h - 60), "ESC back | Q quit", 0.5,
              (220, 220, 220), thickness=1, glow=1)


def play_hud(img, *, char, jutsu_name, diff_name, elapsed, limit,
             seq, idx, hold_frac, hand, skeleton, show_hint, hints_on):
    w = img.shape[1]
    info = CHARACTER_INFO[char]
    glow_text(img, (120, 40), f"{info['name']}  |  {jutsu_name}", 0.7,
              info["color"], thickness=2, glow=3, align="left")
    timer_txt = f"{int(elapsed)}s"
    if limit:
        left = max(0, int(limit - elapsed))
        timer_txt = f"{timer_txt}  / limit {left}s"
        tcol = (0, 165, 255) if left < 10 else (255, 255, 255)
    else:
        tcol = (255, 255, 255)
    glow_text(img, (w - 130, 40), timer_txt, 0.7, tcol, glow=3, align="center")
    glow_text(img, (w - 130, 70), diff_name, 0.45, (200, 200, 200),
              thickness=1, glow=0)
    if not show_hint:
        glow_text(img, (w - 130, 95), "hard mode: no previews", 0.42,
                  (0, 165, 255), thickness=1, glow=0)

    sequence_bar(img, seq, idx, hold_frac, jutsu_name, info["color"],
                 show_pictograms=show_hint)

    if not show_hint:
        glow_text(img, (w // 2, img.shape[0] - 46),
                  "signs are hidden - follow the names above only", 0.5,
                  (0, 165, 255), thickness=1, glow=0)

    if hand is not None and skeleton:
        draw_skeleton(img, hand)


def draw_skeleton(img, hand):
    pts = hand.points.astype(int)
    for p in pts:
        cv2.circle(img, tuple(p), 2, (180, 105, 255), -1)
    for a, b in HAND_CONNECTIONS:
        cv2.line(img, tuple(pts[a]), tuple(pts[b]), (180, 105, 255), 1,
                 cv2.LINE_AA)


def cast_banner(img, jutsu_name, char, t, duration):
    """Big jutsu-name banner that punches in at the start of the cast."""
    ramp = min(1.0, t / 0.35)
    fade = 1.0
    if duration - t < 0.6:
        fade = max(0.0, (duration - t) / 0.6)
    a = ramp * fade
    if a <= 0.01:
        return
    grow = 0.6 + 0.6 * ramp + t * 0.05
    info = CHARACTER_INFO[char]
    color = tuple(int(round(c * a)) for c in info["color"])
    glow_text(img, (img.shape[1] // 2, img.shape[0] - 120), jutsu_name + " !",
              grow, (255, 255, 255), color, glow=5)


def result_panel(img, success, elapsed, attempts, jutsu_name, diff_name,
                 rating):
    dim(img, 0.35)
    w, h = img.shape[1], img.shape[0]
    if success:
        title = "JUTSU COMPLETE !"
        color = (0, 255, 200)
        sub = f"{jutsu_name} was cast successfully"
    else:
        title = "THE HAND SIGNS FAILED..."
        color = (0, 100, 255)
        sub = "stay steady - each sign must be held clearly"
    glow_text(img, (w // 2, h // 2 - 60), title, 1.1, (255, 255, 255), color,
              glow=4)
    glow_text(img, (w // 2, h // 2 + 6), sub, 0.6, (220, 220, 220),
              thickness=1, glow=1)
    glow_text(img, (w // 2, h // 2 + 60),
              f"time {int(elapsed)}s | slips {attempts} | {diff_name} | "
              f"{rating}", 0.6, (0, 255, 200), thickness=1, glow=1)
    glow_text(img, (w // 2, h // 2 + 110),
              "R retry | M menu | ESC quit", 0.6, (255, 255, 255),
              thickness=2, glow=2)


def play_help(img):
    glow_text(img, (img.shape[1] // 2, img.shape[0] - 90),
              "show the sign in the highlighted slot | H hint toggle | "
              "V skeleton | M menu", 0.48, (210, 210, 210), thickness=1,
              glow=0)
