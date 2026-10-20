import time

import cv2

from src.camera import Camera
from src.game import Game
from src.hand_tracker import HandTracker

WINDOW = "Jutsu Hand Signs"


def main():
    cam = Camera()
    tracker = HandTracker()
    game = Game()

    cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)

    try:
        cv2.resizeWindow(WINDOW, cam.width, cam.height)
        last = time.time()
        while True:
            ok, frame = cam.read()
            if not ok:
                continue

            now = time.time()
            dt = min(0.05, now - last)
            last = now

            hand = tracker.process(frame)
            game.update(hand, dt)

            out = frame.copy()
            game.draw(out, dt)

            cv2.imshow(WINDOW, out)
            key = cv2.waitKey(1) & 0xFF
            if not game.handle_key(key):
                break
    finally:
        tracker.close()
        cam.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
