// Backend-free mode for static hosting (GitHub Pages): a stand-in for the
// backend's WebSockets that speaks the same messages but runs the matching
// and hand-sign logic in the browser. Enabled by VITE_STANDALONE=1 (see
// web/.env.pages); local development keeps using the Python backend.
import { bestMatch, extractTraits } from "./match";
import { detectSign, preloadSignModel } from "./signs";
import { JutsuSession, sequenceFor } from "./session";

export const STANDALONE = import.meta.env.VITE_STANDALONE === "1";

const BOX_OK = "rgb(120,230,90)";
const BOX_OFF = "rgb(255,220,60)";

async function decode(dataUrl) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  return { bitmap, w: bitmap.width, h: bitmap.height };
}

class LocalSocket {
  constructor(kind) {
    this.kind = kind;
    this.readyState = 0;
    this.onopen = this.onmessage = this.onerror = this.onclose = null;
    this.busy = false;
    this.session = null;
    this.canvas = document.createElement("canvas");
    if (kind === "jutsu") preloadSignModel();
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  _reply(msg) {
    if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(msg) });
  }

  send(raw) {
    const msg = JSON.parse(raw);
    // Like a real socket under load, skip frames while the last one is busy.
    if (msg.type === "frame" && this.busy) return;
    this.busy = true;
    const job = this.kind === "match" ? this._match(msg) : this._jutsu(msg);
    job
      .catch((err) => {
        console.error("standalone backend error", err);
        this._reply({ status: "error", message: "processing_failed" });
      })
      .finally(() => {
        this.busy = false;
      });
  }

  async _match(msg) {
    if (msg.type !== "frame") return;
    const { bitmap, w, h } = await decode(msg.image);
    const traits = await extractTraits(bitmap, w, h);
    bitmap.close();
    if (!traits.detected) return this._reply({ status: "no_face" });
    this._reply({ status: "ok", character: bestMatch(traits) });
  }

  async _jutsu(msg) {
    if (msg.type === "start") {
      this.session = new JutsuSession(await sequenceFor(msg.skill || "Rasengan"));
      return this._reply({ status: "started" });
    }
    if (msg.type !== "frame" || !this.session) return;
    const { bitmap, w, h } = await decode(msg.image);
    const detection = await detectSign(bitmap, w, h);
    const state = this.session.step(detection);
    // Same annotated frame the backend sends: the raw frame + detection box.
    const c = this.canvas;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    if (detection && state.stage === "play") {
      const [x1, y1, x2, y2] = detection.bbox;
      const color = detection.en === state.target_sign ? BOX_OK : BOX_OFF;
      ctx.strokeStyle = ctx.fillStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.font = "bold 20px sans-serif";
      ctx.fillText(`${detection.en} ${detection.score.toFixed(2)}`, x1, Math.max(20, y1 - 12));
    }
    this._reply({ status: "frame", image: c.toDataURL("image/jpeg", 0.8), state });
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
}

// Open the backend channel at `url` ("/ws/match" or "/ws/jutsu"): a real
// WebSocket normally, the in-browser stand-in when hosted statically.
export function openSocket(url) {
  if (!STANDALONE) return new WebSocket(url);
  return new LocalSocket(url.includes("jutsu") ? "jutsu" : "match");
}
