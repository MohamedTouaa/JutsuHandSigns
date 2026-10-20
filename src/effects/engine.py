"""Pseudo-3D effect helpers for OpenCV: additive glow blending,
perspective projection of 3D offsets and a small particle system.

Effects work in "unit space": offsets are multiplied by a base radius
(driven by the size of the tracked hand), so effects scale with the hand.
"""
import math

import cv2
import numpy as np

FOCAL = 600.0  # px, fudge factor for perspective projection
WHITE = (255, 255, 255)


def _clamp_color(color, factor):
    return tuple(min(255, int(c * factor)) for c in color)


def add_glow(canvas, x, y, r, color, intensity):
    """Additively draw a soft radial glow onto `canvas` (in-place)."""
    if intensity <= 0 or r < 1.0:
        return
    h, w = canvas.shape[:2]
    ir = int(r)
    x0, y0 = max(0, int(x) - ir - 2), max(0, int(y) - ir - 2)
    x1, y1 = min(w, int(x) + ir + 3), min(h, int(y) + ir + 3)
    if x1 <= x0 or y1 <= y0:
        return

    sub = canvas[y0:y1, x0:x1]
    layer = np.zeros(sub.shape, np.uint8)
    cx = int(x) - x0
    cy = int(y) - y0
    rings = max(5, min(12, ir // 5))
    for i in range(rings, 0, -1):  # rings -> outermost, 1 -> innermost
        rr = max(1, int(r * i / rings))
        f = 1.0 - i / (rings + 1.0)          # 0 at outer edge, ~0.9 at center
        cv2.circle(layer, (cx, cy), rr, _clamp_color(color, intensity * f ** 1.5), -1)
    cv2.circle(layer, (cx, cy), max(1, int(r * 0.2)),
               _clamp_color(color, intensity * 2.0), -1)
    canvas[y0:y1, x0:x1] = cv2.add(sub, layer)


def project(anchor, base_r, dx, dy, dz):
    """Project a unit-space offset (dx, dy, dz) to screen space.

    dz shifts in depth (positive = farther away from camera).
    Returns (x, y, perspective_scale).
    """
    persp = FOCAL / (FOCAL + max(dz, -0.85) * base_r)
    return (
        anchor[0] + dx * base_r * persp,
        anchor[1] + dy * base_r * persp,
        persp,
    )


class Particle:
    """Offsets/velocities are in unit space (fractions of the base radius)."""

    __slots__ = ("x", "y", "z", "vx", "vy", "vz", "life", "max_life", "size", "color")

    def __init__(self, x, y, z, vx, vy, vz, life, size, color):
        self.x, self.y, self.z = x, y, z
        self.vx, self.vy, self.vz = vx, vy, vz
        self.life = life
        self.max_life = max(life, 1e-6)
        self.size = size
        self.color = color


class ParticleSystem:
    def __init__(self):
        self.particles = []

    def spawn(self, x, y, z, vx, vy, vz, life, size, color):
        self.particles.append(Particle(x, y, z, vx, vy, vz, life, size, color))

    def update(self, dt, drag=0.0):
        alive = []
        for p in self.particles:
            d = max(0.0, 1.0 - drag * dt)
            p.vx *= d
            p.vy *= d
            p.vz *= d
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.z += p.vz * dt
            p.life -= dt
            if p.life > 0 and abs(p.z) < 1.5:
                alive.append(p)
        self.particles = alive

    def draw(self, canvas, anchor, base_r, intensity):
        if intensity <= 0:
            return
        for p in self.particles:
            x, y, persp = project(anchor, base_r, p.x, p.y, p.z)
            fade = (p.life / p.max_life) ** 0.7
            add_glow(canvas, x, y, max(1.0, p.size * base_r * persp),
                     p.color, intensity * fade)

    def clear(self):
        self.particles = []
