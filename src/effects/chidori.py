"""Chidori: crackling pseudo-3D lightning around the hand.

Midpoint-displacement bolts regenerated every few frames, flickering,
plus sparks and rare white flashes.
"""
import math
import random

import cv2
import numpy as np

from .engine import add_glow, project, ParticleSystem

ELECTRIC = (255, 230, 120)   # electric cyan (BGR)
SPARK = (255, 240, 180)


def _gen_bolt(angle, r0, r1):
    """Random lightning polyline in unit space via midpoint displacement.

    Returns list of (dx, dy, dz) offsets from the anchor.
    """
    ux, uy = math.cos(angle), math.sin(angle)
    px, py = -uy, ux  # perpendicular
    start = (r0 * ux, r0 * uy)
    end = (r1 * ux, r1 * uy)

    pts = [start + (0.0,), end + (0.0,)]
    rough = 0.5
    for _ in range(4):  # subdivision depth -> 16 segments
        new_pts = [pts[0]]
        rough *= 0.55
        for a, b in zip(pts, pts[1:]):
            mx = (a[0] + b[0]) / 2 + random.uniform(-rough, rough) * px
            my = (a[1] + b[1]) / 2 + random.uniform(-rough, rough) * py
            mz = (a[2] + b[2]) / 2 + random.uniform(-0.12, 0.12)
            new_pts.append((mx, my, mz))
            new_pts.append(b)
        pts = new_pts
    return pts


class ChidoriEffect:
    def __init__(self):
        self.t = 0.0
        self.regen = 0.0
        self.bolts = []
        self.flash = 0.0
        self.sparks = ParticleSystem()

    def update(self, dt, power, anchor=None, base_r=90.0):
        self.t += dt
        self.regen -= dt
        if self.regen <= 0:
            self.regen = random.uniform(0.05, 0.12)
            count = int(5 + 7 * power)
            self.bolts = []
            for _ in range(count):
                r1 = random.uniform(0.8, 1.45)
                self.bolts.append(_gen_bolt(
                    random.uniform(0, math.tau),
                    random.uniform(0.1, 0.3), r1))

        if random.random() < 0.10 * power:
            self.flash = random.uniform(0.3, 0.8)
        self.flash = max(0.0, self.flash - dt * 7)

        # crackling sparks
        if power > 0.05:
            for _ in range(int(14 * power)):
                a = random.uniform(0, math.tau)
                z = random.uniform(-0.4, 0.4)
                speed = random.uniform(0.9, 1.9)
                self.sparks.spawn(
                random.uniform(-0.2, 0.2), random.uniform(-0.2, 0.2), z,
                math.cos(a) * speed, math.sin(a) * speed,
                random.uniform(-0.5, 0.5),
                random.uniform(0.08, 0.3),
                random.uniform(0.02, 0.05),
                SPARK,
            )
        self.sparks.update(dt, drag=2.2)

    def draw(self, canvas, anchor, base_r, power):
        if power <= 0:
            return
        ax, ay = anchor

        # crackle glow around the hand
        add_glow(canvas, ax, ay, base_r * 0.7, ELECTRIC, 0.7 * power)
        add_glow(canvas, ax, ay, base_r * 0.3, (255, 255, 255), 0.8 * power)

        for bolt in self.bolts:
            pts = []
            for dx, dy, dz in bolt:
                x, y, _ = project(anchor, base_r, dx, dy, dz)
                pts.append((int(x), int(y)))
            pts = np.array(pts, np.int32)

            flick = random.uniform(0.25, 1.0) * power
            # broad faint stroke
            lay = np.zeros(canvas.shape, np.uint8)
            cv2.polylines(lay, [pts], False,
                          (int(255 * flick * 0.4), int(230 * flick * 0.4),
                           int(120 * flick * 0.4)),
                          max(2, int(base_r * 0.05)), cv2.LINE_AA)
            cv2.add(canvas, lay, dst=canvas)
            # thin bright core
            cv2.polylines(canvas, [pts], False,
                          _bright(ELECTRIC, min(1.0, flick + 0.3)),
                          max(1, int(base_r * 0.015)), cv2.LINE_AA)

        # crackle arcs hugging the palm
        for _ in range(2):
            a = random.uniform(0, math.tau)
            pts = []
            for s in range(3):
                rr = base_r * (0.25 + 0.12 * s)
                dx, dy = math.cos(a + random.uniform(-0.9, 0.9)) * rr / base_r, \
                    math.sin(a + random.uniform(-0.9, 0.9)) * rr / base_r
                x, y, _ = project(anchor, base_r, dx, dy, 0.0)
                pts.append((int(x), int(y)))
            cv2.polylines(canvas, [np.array(pts, np.int32)], False,
                          _bright(ELECTRIC, 0.8), 2, cv2.LINE_AA)

        self.sparks.draw(canvas, anchor, base_r, power * 0.9)

        if self.flash > 0.01:
            fl = np.full(canvas.shape,
                         (int(200 * self.flash * 0.25),
                          int(235 * self.flash * 0.25),
                          int(255 * self.flash * 0.25)),
                         np.uint8)
            cv2.add(canvas, fl, dst=canvas)


def _bright(color, factor):
    return tuple(min(255, int(c * factor)) for c in color)
