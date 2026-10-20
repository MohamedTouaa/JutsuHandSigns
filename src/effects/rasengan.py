"""Rasengan: swirling pseudo-3D chakra orb.

Rotating spiral arms + orbiting mist particles + pulsing core, all drawn
additively around the palm anchor.
"""
import math
import random

from .engine import add_glow, project

BLUE = (255, 165, 40)     # azure glow (BGR)
MIST_COLORS = [(255, 190, 90), (240, 255, 130), (255, 160, 40)]
CORE = (255, 255, 235)


class RasenganEffect:
    def __init__(self):
        self.t = 0.0
        self.mist = []  # dicts: angle, rad, z, spin, rin, zs, size, color

    def update(self, dt, power, anchor=None, base_r=90.0):
        self.t += dt
        target = int(80 * max(power, 0.15))
        while len(self.mist) < target:
            self._spawn_mist()
        dead = []
        for p in self.mist:
            p["angle"] += p["spin"] * dt
            p["rad"] -= p["rin"] * dt
            p["z"] = math.sin(math.tau * (p["phase"] + self.t * p["zs"])) * 0.35
            if p["rad"] < 0.22:
                dead.append(p)
        for p in dead:
            self.mist.remove(p)

    def _spawn_mist(self):
        self.mist.append({
            "angle": random.uniform(0, math.tau),
            "rad": random.uniform(0.9, 1.6),
            "phase": random.random(),
            "spin": random.choice([-1, 1]) * random.uniform(1.5, 3.2),
            "rin": random.uniform(0.15, 0.45),
            "zs": random.uniform(1.5, 2.8),
            "size": random.uniform(0.05, 0.12),
            "color": random.choice(MIST_COLORS),
            "age": 0.0,
        })

    def draw(self, canvas, anchor, base_r, power):
        if power <= 0:
            return
        ax, ay = anchor
        t = self.t

        # outer aura
        add_glow(canvas, ax, ay, base_r * 0.85, BLUE, 0.55 * power)

        # rotating spiral arms
        for arm in range(3):
            a0 = t * 4.2 + arm * 2.094
            steps = 14
            for s in range(steps):
                f = s / (steps - 1)
                ang = a0 + f * 3.4
                rad = 0.22 + f * 0.75
                dz = math.sin((f + t * 0.35) * math.tau + arm * 2.1) * 0.35
                x, y, persp = project(anchor, base_r,
                                      math.cos(ang) * rad, math.sin(ang) * rad, dz)
                add_glow(canvas, x, y, base_r * 0.11 * persp, BLUE,
                         0.9 * power * (1.0 - 0.55 * f))

        # pulsing core
        pulse = 1.0 + 0.08 * math.sin(t * 18)
        add_glow(canvas, ax, ay, base_r * 0.32 * pulse, BLUE, 1.0 * power)
        add_glow(canvas, ax, ay, base_r * 0.13, CORE, 0.9 * power)

        # orbiting mist
        for p in self.mist:
            x, y, persp = project(anchor, base_r,
                                  math.cos(p["angle"]) * p["rad"],
                                  math.sin(p["angle"]) * p["rad"], p["z"])
            fade = 1.0 - abs(p["rad"] - 1.1)
            add_glow(canvas, x, y, p["size"] * base_r * persp + 1.0,
                     p["color"], 0.55 * power * max(0.2, fade))
