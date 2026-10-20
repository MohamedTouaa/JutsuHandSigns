"""Characters, jutsu sequences and difficulty settings.

The visible signs are Naruto-flavored display names (RAM, TIGER, ...)
mapped onto the poses the classifier can actually detect.
"""

# display name -> canonical pose
SIGN_TO_POSE = {
    "MONKEY": "FIST",
    "TIGER": "OPEN",
    "OX": "POINT",
    "RAM": "PEACE",
    "BIRD": "THREE",
    "HARE": "THUMB",
    "SNAKE": "HOOK",
}
POSE_TO_SIGN = {v: k for k, v in SIGN_TO_POSE.items()}


class Jutsu:
    def __init__(self, char, name, sign_seq):
        self.char = char
        self.name = name
        self.sign_seq = sign_seq                              # display names
        self.pose_seq = [SIGN_TO_POSE[s] for s in sign_seq]   # canonical poses


JUTSUS = {
    "naruto": Jutsu(
        "naruto",
        "RASENGAN",
        ["MONKEY", "TIGER", "RAM", "MONKEY", "RAM", "TIGER", "RAM"],
    ),
    "sasuke": Jutsu(
        "sasuke",
        "CHIDORI",
        ["OX", "HARE", "MONKEY", "BIRD", "TIGER", "OX", "TIGER"],
    ),
}

CHARACTER_INFO = {
    "naruto": {
        "name": "NARUTO",
        "jutsu": "Rasengan",
        "color": (0, 140, 255),      # BGR orange
        "desc": "The number one knucklehead ninja",
    },
    "sasuke": {
        "name": "SASUKE",
        "jutsu": "Chidori",
        "color": (255, 120, 60),     # BGR purple-blue
        "desc": "The avenger of the Uchiha",
    },
}


DIFF_ORDER = ["easy", "medium", "hard"]   # display order

DIFFICULTIES = {
    "easy": {
        "name": "EASY",
        "count": 3,
        "hold": 0.60,
        "limit": None,
        "hide_pose": False,
        "desc": "3 signs | hold 0.6s | poses shown",
    },
    "medium": {
        "name": "MEDIUM",
        "count": 5,
        "hold": 0.40,
        "limit": 75.0,
        "hide_pose": False,
        "desc": "5 signs | hold 0.4s | 75s limit",
    },
    "hard": {
        "name": "HARD",
        "count": 7,
        "hold": 0.30,
        "limit": 50.0,
        "hide_pose": True,
        "desc": "7 signs | hold 0.3s | 50s limit | NO pose images",
    },
}


def pose_label(pose):
    """Display name for a canonical pose."""
    return POSE_TO_SIGN.get(pose, pose)
