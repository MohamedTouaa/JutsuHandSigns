import cv2


class Camera:
    """Webcam capture with mirroring, sized to a fixed resolution."""

    def __init__(self, index=0, width=1280, height=720, mirror=True):
        self.cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        if not self.cap.isOpened():
            self.cap = cv2.VideoCapture(index)
        if not self.cap.isOpened():
            raise RuntimeError(
                "Could not open webcam. Make sure a camera is connected "
                "and not used by another app."
            )
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.mirror = mirror

    def read(self):
        ok, frame = self.cap.read()
        if ok and self.mirror:
            frame = cv2.flip(frame, 1)
        return ok, frame

    def release(self):
        self.cap.release()
