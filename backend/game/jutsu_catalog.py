"""Maps any skill name (from the frontend's skills.js roster) to:
  - a hand-sign sequence drawn from the REAL 12 canonical two-handed seals
    (Rat, Ox, Tiger, Hare, Dragon, Snake, Horse, Ram, Monkey, Bird, Dog,
    Boar) detected by the vendored YOLOX model — canon sequences for a few
    jutsu are pulled straight from the vendored jutsu.csv; everything else
    gets a deterministic (same skill -> same sequence, always) generated one.
  - a visual effect archetype + color palette, picked by keyword, so every
    jutsu gets a distinct, thematically-fitting cast effect without needing
    one hand-built effect per jutsu (there are ~70 of them).
"""
import csv
import hashlib
import os

from .effects import OrbEffect, LightningEffect, FlameEffect, EyeEffect
from .sign_detector import CANONICAL_SIGNS, LABELS

_HERE = os.path.dirname(os.path.abspath(__file__))
JUTSU_CSV_PATH = os.path.join(_HERE, "data", "jutsu.csv")

_JP_TO_EN = {label["jp"]: label["en"] for label in LABELS}


def _load_canon_jutsus():
    """{lowercased english jutsu name: [English sign names]} from jutsu.csv."""
    canon = {}
    with open(JUTSU_CSV_PATH, encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            en_name = row[3].strip()
            if not en_name:
                continue
            jp_signs = [c for c in row[4:] if c]
            en_signs = [_JP_TO_EN.get(jp) for jp in jp_signs]
            if any(s is None for s in en_signs):
                continue  # skip rows using the rare extras we don't train on
            key = en_name.lower()
            if key not in canon or len(en_signs) < len(canon[key]):
                canon[key] = en_signs
    return canon


CANON_JUTSUS = _load_canon_jutsus()
MAX_CANON_LENGTH = 6  # longer canon sequences (e.g. Water Dragon's 44) aren't practical to play


def _find_canon_sequence(skill_name):
    key = skill_name.strip().lower()
    for jutsu_key, signs in CANON_JUTSUS.items():
        if len(signs) > MAX_CANON_LENGTH:
            continue
        if jutsu_key in key or key in jutsu_key:
            return signs
    return None


def sequence_for(skill_name, length=4):
    canon = _find_canon_sequence(skill_name)
    if canon:
        return canon
    # Deterministic pseudo-random sequence from the skill name, so the same
    # skill always gets the same sequence across sessions.
    digest = hashlib.sha256(skill_name.strip().lower().encode("utf-8")).digest()
    return [CANONICAL_SIGNS[b % len(CANONICAL_SIGNS)] for b in digest[:length]]


# (archetype class, color, *extra args) — colors are BGR (OpenCV convention)
ARCHETYPES = {
    "orb_blue": (OrbEffect, (255, 165, 40), {"mist_colors": [(255, 190, 90), (240, 255, 130), (255, 160, 40)]}),
    "orb_purple": (OrbEffect, (240, 80, 170), {"mist_colors": [(255, 120, 200), (200, 60, 160)]}),
    "orb_green": (OrbEffect, (90, 200, 90), {"mist_colors": [(120, 230, 130), (60, 180, 70)]}),
    "orb_teal": (OrbEffect, (210, 190, 60), {"mist_colors": [(230, 210, 100), (180, 160, 40)]}),
    "lightning_cyan": (LightningEffect, (255, 230, 120), {"spark_color": (255, 240, 180)}),
    "lightning_yellow": (LightningEffect, (60, 230, 255), {"spark_color": (120, 245, 255)}),
    "flame_orange": (FlameEffect, (40, 130, 255), {"tip_color": (200, 255, 255)}),
    "flame_black": (FlameEffect, (20, 20, 20), {"tip_color": (80, 40, 200)}),
    "eye_red": (EyeEffect, (40, 30, 220), {"ring_color": (255, 255, 255)}),
    "eye_lavender": (EyeEffect, (210, 160, 200), {"ring_color": (255, 255, 255)}),
}

# Ordered keyword -> archetype rules. First match wins; falls back to a
# neutral generic chakra orb so literally every skill renders *something*.
_KEYWORD_RULES = [
    ("rasengan", "orb_blue"),
    ("chidori", "lightning_cyan"),
    ("lightning release armor", "lightning_yellow"),
    ("lariat", "lightning_yellow"),
    ("lava-melting", "flame_orange"),
    ("earth-shattering", "flame_orange"),
    ("thunder", "lightning_yellow"),
    ("lightning", "lightning_cyan"),
    ("water", "orb_teal"),
    ("shark", "orb_teal"),
    ("amaterasu", "flame_black"),
    ("fire", "flame_orange"),
    ("explo", "flame_orange"),
    ("clay", "flame_orange"),
    ("c4 karura", "flame_orange"),
    ("susanoo", "orb_purple"),
    ("sharingan", "eye_red"),
    ("mangekyo", "eye_red"),
    ("rinnegan", "eye_lavender"),
    ("byakugan", "eye_lavender"),
    ("kotoamatsukami", "eye_lavender"),
    ("wood release", "orb_green"),
    ("wood clone", "orb_green"),
    ("four-pillar", "orb_green"),
    ("paper", "orb_teal"),
    ("shadow", "orb_purple"),
    ("sand", "flame_orange"),
    ("iron sand", "flame_orange"),
    ("puppet", "orb_teal"),
    ("edo tensei", "orb_purple"),
    ("living corpse", "orb_purple"),
    ("snake", "orb_green"),
    ("sage mode", "orb_green"),
    ("gentle fist", "orb_teal"),
    ("eight trigrams", "orb_teal"),
    ("eight gates", "flame_orange"),
    ("lotus", "flame_orange"),
    ("leaf hurricane", "flame_orange"),
    ("strength of a hundred", "orb_purple"),
    ("byakugo", "orb_purple"),
    ("cherry blossom", "flame_orange"),
    ("mind", "eye_lavender"),
    ("flying thunder god", "lightning_yellow"),
    ("flicker", "lightning_cyan"),
    ("scalpel", "orb_teal"),
    ("expansion", "orb_green"),
    ("boulder", "orb_green"),
    ("butterfly", "orb_green"),
    ("fang", "flame_orange"),
    ("beast human", "flame_orange"),
    ("hound", "orb_teal"),
    ("kamui", "eye_red"),
]


def archetype_for(skill_name):
    key = skill_name.strip().lower()
    for keyword, archetype_key in _KEYWORD_RULES:
        if keyword in key:
            return archetype_key
    return "orb_blue"


def build_effect(skill_name):
    archetype_key = archetype_for(skill_name)
    cls, color, kwargs = ARCHETYPES[archetype_key]
    return cls(color, **kwargs)
