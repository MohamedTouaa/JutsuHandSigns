"""TTF text rendering via Pillow: anti-aliased fonts with soft glow.

`size` is kept in "Hershey scale" units (about 42 px per unit) so existing
call sites keep working; use `size_px` for exact pixel height.
"""
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

_FONT_DIRS = ["C:/Windows/Fonts/"]
_TITLE_CANDIDATES = [
    "impact.ttf", "segoeuib.ttf", "arialbd.ttf", "seguiemb.ttf",
    "DejaVuSans-Bold.ttf",
]
_BODY_CANDIDATES = [
    "segoeuisl.ttf", "segoeui.ttf", "arial.ttf", "DejaVuSans.ttf",
]
_FALLBACK_TITLE = "DejaVuSansCondensed-BoldOblique.ttf"

_fonts = {}  # (kind, px) -> ImageFont
_missing_warned = set()


def _locate():
    here = os.path.dirname(os.path.abspath(__file__))
    dirs = [d for d in _FONT_DIRS if os.path.isdir(d)]
    return dirs + [os.path.join(here, os.pardir, "assets", "fonts")]


def _load_font(kind, px):
    px = max(10, int(px))
    key = (kind, px)
    if key in _fonts:
        return _fonts[key]
    candidates = (_TITLE_CANDIDATES if kind == "title" else _BODY_CANDIDATES)
    path = None
    for d in _locate():
        for name in candidates:
            cand = os.path.join(d, name)
            if os.path.exists(cand):
                path = cand
                break
        if path:
            break
    try:
        font = ImageFont.truetype(path, px) if path else \
            ImageFont.load_default(px)
    except Exception:
        font = ImageFont.load_default(px)
    _fonts[key] = font
    return font


def _measure(font, text):
    box = font.getbbox(text)
    if box is None:
        box = (0, 0, 0, 0)
    l, t, r, b = box
    return l, t, r, b


def draw_text(img, xy, text, size=1.0, bgr=(255, 255, 255),
              glow_bgr=None, glow=0, align="center", alpha=1.0,
              title=False, size_px=None, anchor="mm"):
    """Draw anti-aliased text with optional Gaussian glow, in-place.

    xy       anchor point in frame pixel coords
    align    "center" | "left"
    anchor   PIL vertical anchor tag ("mm" = middle-center by default)
    size_px  overrides the size-scale param when given
    """
    px = max(11, int(round(size_px))) if size_px else \
        max(11, int(round(size * 42)))
    font = _load_font("title" if title else "body", px)
    l, t, r, b = _measure(font, text)
    tw, th = r - l, b - t

    gpx = int(max(0, glow) * max(1.0, px * 0.16))
    pad = 2 * gpx + 6
    cw, ch = tw + 2 * pad, th + 2 * pad

    sprite = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    origin = (pad - l, pad - t)

    if gpx > 0:
        gcol = glow_bgr if glow_bgr is not None else bgr
        grow = int(min(255, max(0, 200)))
        glayer = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        ImageDraw.Draw(glayer).text(origin, text, font=font,
                                    fill=(gcol[2], gcol[1], gcol[0], grow))
        glayer = glayer.filter(ImageFilter.GaussianBlur(gpx))
        sprite = Image.alpha_composite(sprite, glayer)
        sprite = Image.alpha_composite(sprite, glayer)

    ImageDraw.Draw(sprite).text(origin, text, font=font,
                                fill=(bgr[2], bgr[1], bgr[0], 255))

    arr = np.asarray(sprite).astype(np.float32)
    if alpha < 1.0:
        arr[..., 3] *= max(0.0, min(1.0, alpha))

    # frame anchor placement
    if align == "center":
        fx0 = int(round(xy[0] - cw / 2))
    else:
        fx0 = int(round(xy[0]))
    fy0 = int(round(xy[1] - ch / 2))

    h, w = img.shape[:2]
    sx0 = max(0, -fx0)
    sy0 = max(0, -fy0)
    fx0, fy0 = max(0, fx0), max(0, fy0)
    fx1, fy1 = min(w, fx0 + cw - sx0), min(h, fy0 + ch - sy0)
    if fx1 <= fx0 or fy1 <= fy0:
        return

    spr = arr[sy0:sy0 + (fy1 - fy0), sx0:sx0 + (fx1 - fx0)]
    a = spr[..., 3:4] / 255.0
    rgb = spr[..., 2::-1]  # RGBA -> BGR
    roi = img[fy0:fy1, fx0:fx1].astype(np.float32)
    roi[:] = roi * (1 - a) + rgb * a
    img[fy0:fy1, fx0:fx1] = roi.astype(np.uint8)


def text_size(text, size=1.0, title=False, size_px=None):
    px = max(11, int(round(size_px))) if size_px else \
        max(11, int(round(size * 42)))
    font = _load_font("title" if title else "body", px)
    l, t, r, b = _measure(font, text)
    return r - l, b - t
