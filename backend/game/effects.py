"""Generalized, color-parametrized jutsu effects.

Rather than hand-building a unique particle system per named jutsu (there are
~80 distinct skill names across the character roster), every jutsu is
rendered by one of a few reusable archetypes (orb / lightning / flame / eye),
each just recolored and re-tuned per jutsu. See jutsu_catalog.py for the
keyword rules that pick an archetype + palette for a given skill name.
"""
import math
import random

import cv2
import numpy as np

from .engine import add_glow, project, ParticleSystem


class OrbEffect:
    """Swirling chakra sphere (Rasengan-style): rotating spiral arms +
    orbiting mist + pulsing core."""

    def __init__(self, color, mist_colors=None, core=(255, 255, 235)):
        self.color = color
        self.mist_colors = mist_colors or [color]
        self.core = core
        self.t = 0.0
        self.mist = []

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
            "color": random.choice(self.mist_colors),
        })

    def draw(self, canvas, anchor, base_r, power):
        if power <= 0:
            return
        ax, ay = anchor
        t = self.t

        add_glow(canvas, ax, ay, base_r * 0.85, self.color, 0.55 * power)

        for arm in range(3):
            a0 = t * 4.2 + arm * 2.094
            steps = 14
            for s in range(steps):
                f = s / (steps - 1)
                ang = a0 + f * 3.4
                rad = 0.22 + f * 0.75
                dz = math.sin((f + t * 0.35) * math.tau + arm * 2.1) * 0.35
                x, y, persp = project(anchor, base_r, math.cos(ang) * rad, math.sin(ang) * rad, dz)
                add_glow(canvas, x, y, base_r * 0.11 * persp, self.color, 0.9 * power * (1.0 - 0.55 * f))

        pulse = 1.0 + 0.08 * math.sin(t * 18)
        add_glow(canvas, ax, ay, base_r * 0.32 * pulse, self.color, 1.0 * power)
        add_glow(canvas, ax, ay, base_r * 0.13, self.core, 0.9 * power)

        for p in self.mist:
            x, y, persp = project(anchor, base_r, math.cos(p["angle"]) * p["rad"], math.sin(p["angle"]) * p["rad"], p["z"])
            fade = 1.0 - abs(p["rad"] - 1.1)
            add_glow(canvas, x, y, p["size"] * base_r * persp + 1.0, p["color"], 0.55 * power * max(0.2, fade))


def _gen_bolt(angle, r0, r1):
    ux, uy = math.cos(angle), math.sin(angle)
    px, py = -uy, ux
    pts = [(r0 * ux, r0 * uy, 0.0), (r1 * ux, r1 * uy, 0.0)]
    rough = 0.5
    for _ in range(4):
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


def _bright(color, factor):
    return tuple(min(255, int(c * factor)) for c in color)


class LightningEffect:
    """Crackling bolts (Chidori-style) around the hand."""

    def __init__(self, color, spark_color=None):
        self.color = color
        self.spark_color = spark_color or color
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
                self.bolts.append(_gen_bolt(random.uniform(0, math.tau), random.uniform(0.1, 0.3), r1))

        if random.random() < 0.10 * power:
            self.flash = random.uniform(0.3, 0.8)
        self.flash = max(0.0, self.flash - dt * 7)

        if power > 0.05:
            for _ in range(int(14 * power)):
                a = random.uniform(0, math.tau)
                z = random.uniform(-0.4, 0.4)
                speed = random.uniform(0.9, 1.9)
                self.sparks.spawn(
                    random.uniform(-0.2, 0.2), random.uniform(-0.2, 0.2), z,
                    math.cos(a) * speed, math.sin(a) * speed, random.uniform(-0.5, 0.5),
                    random.uniform(0.08, 0.3), random.uniform(0.02, 0.05), self.spark_color,
                )
        self.sparks.update(dt, drag=2.2)

    def draw(self, canvas, anchor, base_r, power):
        if power <= 0:
            return
        ax, ay = anchor

        add_glow(canvas, ax, ay, base_r * 0.7, self.color, 0.7 * power)
        add_glow(canvas, ax, ay, base_r * 0.3, (255, 255, 255), 0.8 * power)

        for bolt in self.bolts:
            pts = []
            for dx, dy, dz in bolt:
                x, y, _ = project(anchor, base_r, dx, dy, dz)
                pts.append((int(x), int(y)))
            pts = np.array(pts, np.int32)

            flick = random.uniform(0.25, 1.0) * power
            lay = np.zeros(canvas.shape, np.uint8)
            cv2.polylines(lay, [pts], False, _bright(self.color, flick * 0.4), max(2, int(base_r * 0.05)), cv2.LINE_AA)
            cv2.add(canvas, lay, dst=canvas)
            cv2.polylines(canvas, [pts], False, _bright(self.color, min(1.0, flick + 0.3)), max(1, int(base_r * 0.015)), cv2.LINE_AA)

        self.sparks.draw(canvas, anchor, base_r, power * 0.9)

        if self.flash > 0.01:
            fl = np.full(canvas.shape, _bright(self.color, self.flash * 0.25), np.uint8)
            cv2.add(canvas, fl, dst=canvas)


class FlameEffect:
    """Rising fire/explosion burst — reuses ParticleSystem with an upward
    drift and a hot core flash."""

    def __init__(self, color, tip_color=(200, 255, 255)):
        self.color = color
        self.tip_color = tip_color
        self.t = 0.0
        self.particles = ParticleSystem()

    def update(self, dt, power, anchor=None, base_r=90.0):
        self.t += dt
        if power > 0.05:
            for _ in range(int(18 * power)):
                a = random.uniform(0, math.tau)
                speed = random.uniform(0.6, 1.6)
                self.particles.spawn(
                    random.uniform(-0.15, 0.15), random.uniform(-0.1, 0.1), random.uniform(-0.3, 0.3),
                    math.cos(a) * speed * 0.4, -abs(math.sin(a)) * speed - 0.4, random.uniform(-0.3, 0.3),
                    random.uniform(0.3, 0.7), random.uniform(0.07, 0.16), self.color,
                )
        self.particles.update(dt, drag=0.6)

    def draw(self, canvas, anchor, base_r, power):
        if power <= 0:
            return
        ax, ay = anchor
        pulse = 1.0 + 0.1 * math.sin(self.t * 12)
        add_glow(canvas, ax, ay, base_r * 0.5 * pulse, self.color, 0.85 * power)
        add_glow(canvas, ax, ay, base_r * 0.2, self.tip_color, 0.9 * power)
        self.particles.draw(canvas, anchor, base_r, power)


class EyeEffect:
    """Ocular jutsu (Sharingan/Byakugan/Rinnegan-style): pulsing iris ring +
    slow radial spokes."""

    def __init__(self, color, ring_color=(255, 255, 255)):
        self.color = color
        self.ring_color = ring_color
        self.t = 0.0

    def update(self, dt, power, anchor=None, base_r=90.0):
        self.t += dt

    def draw(self, canvas, anchor, base_r, power):
        if power <= 0:
            return
        ax, ay = anchor
        t = self.t
        add_glow(canvas, ax, ay, base_r * 0.65, self.color, 0.6 * power)
        add_glow(canvas, ax, ay, base_r * 0.22, self.ring_color, 0.9 * power)

        spokes = 6
        for i in range(spokes):
            ang = t * 1.4 + i * (math.tau / spokes)
            for f in (0.4, 0.7, 1.0):
                x, y, persp = project(anchor, base_r, math.cos(ang) * f, math.sin(ang) * f, 0.0)
                add_glow(canvas, x, y, base_r * 0.07 * persp, self.color, 0.7 * power * (1.0 - 0.4 * f))
