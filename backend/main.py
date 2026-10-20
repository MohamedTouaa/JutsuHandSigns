import base64
import binascii

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from captures import save_capture
from game.session import JutsuSession
from match import best_match
from traits import extract_traits

app = FastAPI(title="Which Shinobi Are You? - matching backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


def _decode_frame(data_url: str):
    try:
        b64data = data_url.split(",", 1)[1] if "," in data_url else data_url
        raw = base64.b64decode(b64data)
    except (binascii.Error, ValueError):
        return None
    if not raw:
        return None
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


@app.websocket("/ws/match")
async def ws_match(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            message = await websocket.receive_json()
            if message.get("type") != "frame":
                continue

            try:
                image = _decode_frame(message.get("image", ""))
                if image is None:
                    await websocket.send_json({"status": "error", "message": "bad_image"})
                    continue

                traits = extract_traits(image)
                if not traits.get("detected"):
                    save_capture(image, traits, match=None)
                    await websocket.send_json({"status": "no_face"})
                    continue

                match = best_match(traits)
                save_capture(image, traits, match=match)
                await websocket.send_json({"status": "ok", "character": match})
            except Exception as exc:  # keep the socket alive on a bad frame
                print("frame processing error:", repr(exc))
                await websocket.send_json({"status": "error", "message": "processing_failed"})
    except WebSocketDisconnect:
        pass


def _encode_frame(image) -> str:
    ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii")


@app.websocket("/ws/jutsu")
async def ws_jutsu(websocket: WebSocket):
    await websocket.accept()
    session = None
    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")

            if msg_type == "start":
                if session is not None:
                    session.close()
                session = JutsuSession(message.get("skill", "Rasengan"))
                await websocket.send_json({"status": "started"})
                continue

            if msg_type != "frame" or session is None:
                continue

            try:
                image = _decode_frame(message.get("image", ""))
                if image is None:
                    await websocket.send_json({"status": "error", "message": "bad_image"})
                    continue

                annotated, state = session.process_frame(image)
                await websocket.send_json({
                    "status": "frame",
                    "image": _encode_frame(annotated),
                    "state": state,
                })
            except Exception as exc:
                print("jutsu frame processing error:", repr(exc))
                await websocket.send_json({"status": "error", "message": "processing_failed"})
    except WebSocketDisconnect:
        pass
    finally:
        if session is not None:
            session.close()
