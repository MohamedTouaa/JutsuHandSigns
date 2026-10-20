"""Game state machine: menus -> play (sign sequence) -> cast -> result."""
import random

import cv2

from .effects.rasengan import RasenganEffect
from .effects.chidori import ChidoriEffect
from .jutsus import CHARACTER_INFO, DIFFICULTIES, DIFF_ORDER, JUTSUS
from .signs import classify
from .ui import (cast_banner, char_menu, diff_menu, glow_text, hand_ring,
                 play_help, play_hud, result_panel, draw_pose_pictogram)

MENU, DIFF, PLAY, CAST, RESULT = "menu", "difficulty", "play", "cast", "result"
CHARS = ["naruto", "sasuke"]
GRACE = 0.35  # seconds of tracking loss tolerated while holding a sign

CAST_DURATION = 4.0

WIN_LINES = [
    "The chakra flows through you.",
    "Unbeatable... dattebayo!",
    "Such power... incredible.",
]
FAIL_LINES = [
    "Your chakra scattered into the wind.",
    "Too slow... the jutsu collapsed.",
]


def _envelope(t, duration, attack=0.25, release=0.5):
    up = min(1.0, t / attack)
    down = min(1.0, max(0.0, (duration - t) / release))
    return max(0.0, min(up, down))


class Game:
    def __init__(self):
        self.state = MENU
        self.t = 0.0
        self.skeleton = False
        self.hints_on = True

        self.menu_sel = 0
        self.diff_sel = 0
        self.char = None
        self.diff_key = None

        # play state
        self.jutsu = None
        self.cfg = None
        self.seq = []          # display signs (MONKEY, TIGER, ...)
        self.pose_seq = []     # canonical poses
        self.idx = 0
        self.hold = 0.0
        self.misses = 0
        self.elapsed = 0.0
        self.flash = 0.0
        self.wrong = 0.0
        self.last_pose = None
        self.lost_time = 0.0
        self.hand = None

        # cast / result
        self.effect = None
        self.cast_t = 0.0
        self.success = False
        self.result_msg = ""
        self.rating = ""
        self.anchor = (960.0, 540.0)
        self.scale = 90.0

    # ------------------------------------------------------------- input

    def handle_key(self, key):
        """Returns False to quit the app."""
        if key in (27, ord("q")):        # ESC / q -> quit everywhere
            return False

        if self.state == MENU:
            if key in (ord("1"), ord("2")):
                self.menu_sel = int(chr(key)) - 1
            elif key in (ord("a"), ord("d"), 81, 83):
                self.menu_sel = (self.menu_sel + (1 if key in (ord("d"), 83)
                                                  else -1)) % len(CHARS)
            elif key in (13, 32):
                self.char = CHARS[self.menu_sel]
                self.state = DIFF

        elif self.state == DIFF:
            if key in (ord("1"), ord("2"), ord("3")):
                self.diff_sel = int(chr(key)) - 1
            elif key in (ord("a"), ord("d"), 81, 83):
                self.diff_sel = (self.diff_sel + (1 if key in (ord("d"), 83)
                                                  else -1)) % len(DIFF_ORDER)
            elif key in (13, 32):
                self.diff_key = DIFF_ORDER[self.diff_sel]
                self._start_play()
            elif key in (ord("m"), ord("x")):
                self.state = MENU

        elif self.state == PLAY:
            if key == ord("h"):
                self.hints_on = not self.hints_on
            elif key == ord("v"):
                self.skeleton = not self.skeleton
            elif key == ord("r"):
                self._start_play()
            elif key == ord("m"):
                self.state = MENU

        elif self.state == CAST:
            if key in (13, 32):          # finish the cast early
                self._finish_cast()

        elif self.state == RESULT:
            if key == ord("r"):
                self._start_play()
            elif key == ord("m"):
                self.state = MENU
                self.effect = None
        return True

    # ------------------------------------------------------------ update

    def update(self, hand, dt):
        self.t += dt
        self.hand = hand

        if self.state == PLAY:
            self._update_play(hand, dt)
        elif self.state == CAST:
            self._update_cast(hand, dt)
        elif self.state == RESULT:
            if self.effect is not None:
                self.effect.update(dt, 0.15, self.anchor, self.scale)

    def _update_play(self, hand, dt):
        self.elapsed += dt
        self.flash = max(0.0, self.flash - dt * 2.5)
        self.wrong = max(0.0, self.wrong - dt * 4.0)

        pose = None
        if hand is not None:
            self.anchor = hand.palm
            self.scale = hand.scale
            self.lost_time = 0.0
            pose = classify(hand.points)
        else:
            self.lost_time += dt

        target = self.pose_seq[self.idx] if self.idx < len(self.pose_seq) else None

        if hand is not None and pose == target:
            self.hold += dt
            if self.hold >= self.cfg["hold"]:
                self.hold = 0.0
                self.flash = 1.0
                self.idx += 1
                if self.idx >= len(self.pose_seq):
                    self._start_cast()
                    return
        elif hand is not None and pose is not None:
            # a clear pose, but the wrong one
            if pose != self.last_pose:
                self.misses += 1
            self.wrong = 0.35
            self.hold = 0.0
        else:
            if hand is None and self.lost_time > GRACE:
                self.hold = 0.0
            elif hand is not None:
                self.hold = max(0.0, self.hold - dt * 0.8)
        self.last_pose = pose

        limit = self.cfg["limit"]
        if limit is not None and self.elapsed > limit:
            self.success = False
            self.result_msg = random.choice(FAIL_LINES)
            self.rating = "TIME OUT"
            self.state = RESULT
            self.effect = None

    def _update_cast(self, hand, dt):
        self.cast_t += dt
        if hand is not None:
            self.anchor = hand.palm
            self.scale = hand.scale
        power = _envelope(self.cast_t, CAST_DURATION)
        if self.effect is not None:
            self.effect.update(dt, power, self.anchor, self.scale)
        if self.cast_t >= CAST_DURATION:
            self._finish_cast()

    def _finish_cast(self):
        self.success = True
        self.result_msg = random.choice(WIN_LINES)
        self.rating = ("PERFECT!" if self.elapsed < 15 else
                       "CLEAN" if self.elapsed < 25 else "TRAINED HARD")
        self.state = RESULT

    # -------------------------------------------------------------- play

    def _start_play(self):
        self.jutsu = JUTSUS[self.char]
        self.cfg = DIFFICULTIES[self.diff_key]
        self.seq = self.jutsu.sign_seq[: self.cfg["count"]]
        self.pose_seq = self.jutsu.pose_seq[: self.cfg["count"]]
        self.idx = 0
        self.hold = 0.0
        self.misses = 0
        self.elapsed = 0.0
        self.flash = 0.0
        self.wrong = 0.0
        self.lost_time = 0.0
        self.last_pose = None
        self.effect = None
        self.state = PLAY

    def _start_cast(self):
        self.cast_t = 0.0
        self.hold = 0.0
        self.effect = RasenganEffect() if self.char == "naruto" else ChidoriEffect()
        self.state = CAST

    # -------------------------------------------------------------- draw

    def draw(self, img, dt):
        if self.state == MENU:
            char_menu(img, self.menu_sel, self.t, CHARS)
        elif self.state == DIFF:
            diff_menu(img, self.diff_sel, self.t, self.char)
        elif self.state == PLAY:
            self._draw_play(img)
        elif self.state == CAST:
            self._draw_effect(img, _envelope(self.cast_t, CAST_DURATION))
            cast_banner(img, self.jutsu.name, self.char, self.cast_t,
                        CAST_DURATION)
            glow_text(img, (img.shape[1] // 2, img.shape[0] - 40),
                      "SPACE: finish early", 0.45, (220, 220, 220),
                      thickness=1, glow=0)
        elif self.state == RESULT:
            self._draw_effect(img, 0.15)
            result_panel(img, self.success, self.elapsed, self.misses,
                         self.jutsu.name, self.cfg["name"], self.rating)

    def _draw_effect(self, img, power):
        if self.effect is not None:
            self.effect.draw(img, self.anchor, self.scale, power)

    def _draw_play(self, img):
        hand = self.hand
        show_hint = (not self.cfg["hide_pose"]) and self.hints_on
        target = self.pose_seq[self.idx] if self.idx < len(self.pose_seq) else None
        info = CHARACTER_INFO[self.char]

        play_hud(img, char=self.char, jutsu_name=self.jutsu.name,
                 diff_name=self.cfg["name"], elapsed=self.elapsed,
                 limit=self.cfg["limit"], seq=self.seq, idx=self.idx,
                 hold_frac=self.hold / self.cfg["hold"], hand=hand,
                 skeleton=self.skeleton, show_hint=show_hint,
                 hints_on=self.hints_on)

        # target sign hint panel (hard mode shows the name only)
        px, py, pw, ph = img.shape[1] - 205, 110, 185, 240
        cv2.rectangle(img, (px, py), (px + pw, py + ph), (25, 25, 25), -1)
        cv2.rectangle(img, (px, py), (px + pw, py + ph), info["color"], 2,
                      cv2.LINE_AA)
        glow_text(img, (px + pw // 2, py + 24), "NEXT SIGN", 0.48,
                  (220, 220, 220), thickness=1, glow=0)
        glow_text(img, (px + pw // 2, py + 52), self.seq[self.idx], 0.8,
                  (255, 255, 255), glow=3)
        if show_hint and target is not None:
            draw_pose_pictogram(img, target,
                                (px + pw // 2, py + ph // 2 + 8), 80,
                                info["color"], highlight=True)

        # tracking-loss warning
        if hand is None:
            glow_text(img, (img.shape[1] // 2, 170), "HAND NOT VISIBLE", 0.7,
                      (0, 100, 255), glow=4)

        # X over palm when a clear but wrong pose is held
        if self.wrong > 0.01 and hand is not None:
            a = self.wrong / 0.35
            cx, cy = int(hand.palm[0]), int(hand.palm[1])
            r = int(self.scale * 0.8)
            col = (int(60 * a), int(60 * a), int(255 * a))
            cv2.line(img, (cx - r, cy - r), (cx + r, cy + r), col, 4, cv2.LINE_AA)
            cv2.line(img, (cx - r, cy + r), (cx + r, cy - r), col, 4, cv2.LINE_AA)

        # expanding ring flash when a sign registers
        if self.flash > 0.01 and hand is not None:
            a = self.flash
            r = int(self.scale * 1.25 + 60 * (1.0 - self.flash))
            cv2.ellipse(img, (int(hand.palm[0]), int(hand.palm[1])), (r, r),
                        0, 0, 360, (int(0 * a), int(255 * a), int(200 * a)),
                        4, cv2.LINE_AA)

        if hand is not None:
            hand_ring(img, hand.palm, hand.scale, self.hold / self.cfg["hold"],
                      active=True)

        play_help(img)
