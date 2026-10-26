// In-browser port of backend/game/sign_detector.py + yolox_onnx.py: the
// YOLOX-Nano two-handed seal detector (Kazuhito00/NARUTO-HandSignDetection,
// MIT — see public/models/signs/LICENSE-NARUTO-HandSignDetection.txt) run
// with onnxruntime-web. Same preprocessing (letterbox to 416, pad 114, BGR,
// 0..255), same decoding and class-agnostic NMS as the Python version.
import * as ort from "onnxruntime-web/wasm";
import labelsCsv from "./data/labels.csv?raw";

// The runtime's .wasm is bundled by Vite (served with the site).
// Multi-threading needs cross-origin isolation, which static hosts don't give.
ort.env.wasm.numThreads = 1;

const INPUT = 416;
const SCORE_TH = 0.6;
const NMS_TH = 0.45;
const NMS_SCORE_TH = 0.1;
const STRIDES = [8, 16, 32];

// labels.csv rows: "Ne(Rat),子" -> { en: "Rat", jp: "子" }; row 0 is "None".
export const LABELS = labelsCsv
  .replace(/^﻿/, "")
  .trim()
  .split(/\r?\n/)
  .map((line) => {
    const [enRaw, jp] = line.split(",");
    const m = enRaw.match(/\(([^)]+)\)/);
    return { en: m ? m[1] : enRaw, jp: (jp ?? "").trim() };
  });

export const CANONICAL_SIGNS = ["Rat", "Ox", "Tiger", "Hare", "Dragon", "Snake", "Horse", "Ram", "Monkey", "Bird", "Dog", "Boar"];

let sessionPromise = null;
function session() {
  sessionPromise ??= ort.InferenceSession.create(`${import.meta.env.BASE_URL}models/signs/yolox_nano.onnx`, {
    executionProviders: ["wasm"],
  });
  return sessionPromise;
}
export const preloadSignModel = () => session().catch(() => {});

// Anchor grid for the three output strides, built once.
const GRID = (() => {
  const g = [];
  for (const s of STRIDES) {
    const n = INPUT / s;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g.push([x, y, s]);
  }
  return g;
})();

const canvas = document.createElement("canvas");
canvas.width = INPUT;
canvas.height = INPUT;
const ctx = canvas.getContext("2d", { willReadFrequently: true });

function preprocess(source, w, h) {
  const ratio = Math.min(INPUT / h, INPUT / w);
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, INPUT, INPUT);
  ctx.drawImage(source, 0, 0, Math.floor(w * ratio), Math.floor(h * ratio));
  const px = ctx.getImageData(0, 0, INPUT, INPUT).data;
  const plane = INPUT * INPUT;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    // CHW, BGR order (the model was trained on OpenCV images).
    data[i] = px[i * 4 + 2];
    data[plane + i] = px[i * 4 + 1];
    data[2 * plane + i] = px[i * 4];
  }
  return { tensor: new ort.Tensor("float32", data, [1, 3, INPUT, INPUT]), ratio };
}

function iou(a, b) {
  const xx1 = Math.max(a[0], b[0]);
  const yy1 = Math.max(a[1], b[1]);
  const xx2 = Math.min(a[2], b[2]);
  const yy2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, xx2 - xx1 + 1) * Math.max(0, yy2 - yy1 + 1);
  const area = (r) => (r[2] - r[0] + 1) * (r[3] - r[1] + 1);
  return inter / (area(a) + area(b) - inter);
}

// Returns the best detection { en, jp, score, bbox: [x1,y1,x2,y2] } in the
// source's pixel space, or null.
export async function detectSign(source, w, h) {
  const sess = await session();
  const { tensor, ratio } = preprocess(source, w, h);
  const out = await sess.run({ [sess.inputNames[0]]: tensor });
  const o = out[sess.outputNames[0]];
  const [, n, dims] = o.dims;
  const v = o.data;
  const cands = [];
  for (let i = 0; i < n; i++) {
    const r = i * dims;
    const [gx, gy, s] = GRID[i];
    const obj = v[r + 4];
    let best = 0;
    let cls = 0;
    for (let c = 5; c < dims; c++) {
      const sc = obj * v[r + c];
      if (sc > best) {
        best = sc;
        cls = c - 5;
      }
    }
    if (best <= NMS_SCORE_TH) continue;
    const cx = (v[r] + gx) * s;
    const cy = (v[r + 1] + gy) * s;
    const bw = Math.exp(v[r + 2]) * s;
    const bh = Math.exp(v[r + 3]) * s;
    cands.push({
      box: [(cx - bw / 2) / ratio, (cy - bh / 2) / ratio, (cx + bw / 2) / ratio, (cy + bh / 2) / ratio],
      score: best,
      cls,
    });
  }
  cands.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of cands) if (kept.every((k) => iou(k.box, c.box) <= NMS_TH)) kept.push(c);
  const top = kept.find((k) => k.score >= SCORE_TH);
  if (!top) return null;
  const label = LABELS[top.cls + 1];
  const [x1, y1, x2, y2] = top.box;
  return {
    en: label.en,
    jp: label.jp,
    score: top.score,
    bbox: [Math.max(0, x1), Math.max(0, y1), Math.min(x2, w), Math.min(y2, h)],
  };
}
