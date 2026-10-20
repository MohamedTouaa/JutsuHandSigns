import json
import math
import os

DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "character_traits.json")

with open(DATA_PATH, "r", encoding="utf-8") as f:
    CHARACTERS = json.load(f)


def _color_dist(a, b):
    return math.sqrt(
        (a["r"] - b["r"]) ** 2 + (a["g"] - b["g"]) ** 2 + (a["b"] - b["b"]) ** 2
    ) / 441.67  # sqrt(3 * 255^2)


def trait_distance(a, b):
    face_diff = abs(a["faceRatio"] - b["faceRatio"]) / 0.3
    eye_spacing_diff = abs(a["eyeSpacingRatio"] - b["eyeSpacingRatio"]) / 0.2
    eye_size_diff = abs(a["eyeSizeRatio"] - b["eyeSizeRatio"]) / 0.15
    eye_diff = (eye_spacing_diff + eye_size_diff) / 2
    skin_diff = _color_dist(a["skin"], b["skin"])
    hair_diff = _color_dist(a["hair"], b["hair"])
    return (face_diff + eye_diff + skin_diff + hair_diff) / 4


def best_match(user_traits):
    best = None
    for char in CHARACTERS:
        dist = trait_distance(user_traits, char["traits"])
        if best is None or dist < best[1]:
            best = (char, dist)
    char, dist = best
    return {
        "id": char["id"],
        "name": char["name"],
        "file": char["file"],
        "distance": dist,
    }
