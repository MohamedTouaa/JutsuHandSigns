"""Anti-aliased hand-sign icons drawn with Pillow and cached as RGBA sprites.

Each icon: stylized one-hand glyph (dark palm + colored outline) matching the
in-game sign language, rendered at 4x supersampling and downsampled.
"""
import numpy as np
from PIL import Image, ImageDraw

_SS = 4  # supersample factor
_CACHE = {}

# (index, middle, ring, pinky) up + thumb up per canonical pose
POSE_FINGERS = {
    "FIST": ((0, 0, 0, 0), False),
    "OPEN": ((1, 1, 1, 1), False),
    "POINT": ((1, 0, 0, 0), False),
    "PEACE": ((1, 1, 0, 0), False),
    "THREE": ((1, 1, 1, 0), False),
    "THUMB": ((0, 0, 0, 0), True),
    "HOOK": ((0, 0, 0, 1), False),
}

_FILL = (16, 16, 22, 255)


def _capsule(d, x0, y0, x1, y1, col, w, fill=_FILL):
    """Rounded vertical capsule (a finger)."""
    d.rounded_rectangle([x0, y0, x1, y1], radius=(x1 - x0) / 2,
                        fill=fill, outline=col, width=w)


def _sprite(pose, w, h, rgb, highlight):
    ss = _SS
    S = w * ss
    col = (0, 255, 255, 255) if highlight else (rgb[2], rgb[1], rgb[0], 255)
    img = Image.new("RGBA", (S, int(S * h / w)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lw = max(2, int(S * 0.040))

    fingers, thumb_up = POSE_FINGERS[pose]

    palm_w = S * 0.74
    palm_h = S * 0.60
    margin = S * 0.06
    thumb_gap = S * (0.16 if thumb_up else 0.10)
    px0 = (img.width - palm_w) // 2
    py1 = img.height - margin
    py0 = py1 - palm_h

    # palm
    d.rounded_rectangle([px0, py0, px0 + palm_w, py1], radius=S * 0.16,
                        fill=_FILL, outline=col, width=lw)

    # fingers
    fw = palm_w * 0.155
    centers = [0.14, 0.38, 0.62, 0.86]
    fl_up = S * 0.50
    flags = fingers
    for i, up in enumerate(flags):
        fx = px0 + palm_w * centers[i]
        if up:
            _capsule(d, fx - fw / 2, py0 - fl_up + fw / 2,
                     fx + fw / 2, py0 + palm_h * 0.30, col, lw)
        else:
            # curled: subtle knuckle ridge fully inside the palm
            top = py0 + S * 0.06
            d.rounded_rectangle([fx - fw / 2, top, fx + fw / 2,
                                 top + palm_h * 0.30],
                                radius=fw / 2, outline=(36, 36, 44, 255),
                                width=max(1, lw // 2))

    # thumb
    if thumb_up:
        tl = S * 0.42
        tw = fw * 1.0
        d.rounded_rectangle(
            [px0 + palm_w - fw * 0.4, py1 - palm_h * 0.75,
             px0 + palm_w + fw * 1.5, py1 - palm_h * 0.75 + tl],
            radius=tw / 2, fill=_FILL, outline=col, width=lw)
    else:
        d.arc([px0 + palm_w - S * 0.05, py0 + palm_h * 0.25,
               px0 + palm_w + S * 0.10, py0 + palm_h * 0.75],
              -80, 90, fill=col, width=lw)

    return img.resize((w, h), Image.LANCZOS)


def sprite(pose, size, bgr, highlight=False):
    """Get (or build) the RGBA sprite for a pose at a given pixel width."""
    key = (pose, size, tuple(bgr), highlight)
    if key not in _CACHE:
        _CACHE[key] = _sprite(pose, size, int(size * 1.35), tuple(bgr),
                              highlight)
    return _CACHE[key]


def paste(img, pose, center, size, bgr, highlight=False):
    """Alpha-composite a pose sprite centered at `center` onto a BGR frame."""
    spr = sprite(pose, int(size), bgr, highlight)
    arr = np.asarray(spr)
    h, w = arr.shape[:2]
    x0 = int(center[0] - w // 2)
    y0 = int(center[1] - h // 2)
    fh, fw = img.shape[:2]
    sx0, sy0 = max(0, -x0), max(0, -y0)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(fw, x0 + w - sx0), min(fh, y0 + h - sy0)
    if x1 <= x0 or y1 <= y0:
        return
    s = arr[sy0:sy0 + (y1 - y0), sx0:sx0 + (x1 - x0)].astype(np.float32)
    a = s[..., 3:4] / 255.0
    rgb = s[..., 2::-1]
    roi = img[y0:y1, x0:x1].astype(np.float32)
    roi[:] = roi * (1 - a) + rgb * a
    img[y0:y1, x0:x1] = roi.astype(np.uint8)
