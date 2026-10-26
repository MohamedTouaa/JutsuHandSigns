// In-browser port of backend/traits.py + match.py: measure the face (shape
// ratios, skin and hair colour) with MediaPipe and pick the closest
// character from the same precomputed trait table.
import CHARACTERS from "./data/character_traits.json";
import { loadLandmarker } from "../vfx/tracking";

const LEFT_EYE = [33, 133, 159, 145];
const RIGHT_EYE = [263, 362, 386, 374];
const FOREHEAD_TOP = 10;
const CHIN_BOTTOM = 152;
const JAW_LEFT = 234;
const JAW_RIGHT = 454;
const SKIN_SAMPLE_POINTS = [50, 280, 152];

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function avgPoint(lm, idx, w, h) {
  return [idx.reduce((s, i) => s + lm[i].x * w, 0) / idx.length, idx.reduce((s, i) => s + lm[i].y * h, 0) / idx.length];
}

// Mean RGB of the given pixel boxes (RGBA image data).
function meanColor(img, boxes) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const [x0f, y0f, x1f, y1f] of boxes) {
    const x0 = Math.max(0, Math.floor(x0f));
    const y0 = Math.max(0, Math.floor(y0f));
    const x1 = Math.min(img.width, Math.floor(x1f));
    const y1 = Math.min(img.height, Math.floor(y1f));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const k = (y * img.width + x) * 4;
        r += img.data[k];
        g += img.data[k + 1];
        b += img.data[k + 2];
        n++;
      }
    }
  }
  return n ? { r: r / n, g: g / n, b: b / n } : null;
}

// source: an image/canvas/bitmap of size w x h. Returns the trait dict with
// `detected`, in the same shape as the backend's.
export async function extractTraits(source, w, h) {
  const face = await loadLandmarker("face");
  const result = face.detectForVideo(source, performance.now());
  const lm = result.faceLandmarks?.[0];
  if (!lm) return { detected: false };

  const faceW = Math.abs(lm[JAW_RIGHT].x * w - lm[JAW_LEFT].x * w) || 1;
  const faceH = Math.abs(lm[CHIN_BOTTOM].y * h - lm[FOREHEAD_TOP].y * h) || 1;
  const eyeDist = dist(avgPoint(lm, LEFT_EYE, w, h), avgPoint(lm, RIGHT_EYE, w, h));
  const leftEyeW = dist([lm[33].x * w, lm[33].y * h], [lm[133].x * w, lm[133].y * h]);
  const rightEyeW = dist([lm[263].x * w, lm[263].y * h], [lm[362].x * w, lm[362].y * h]);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);

  const skinBoxes = SKIN_SAMPLE_POINTS.map((i) => {
    const x = lm[i].x * w;
    const y = lm[i].y * h;
    return [x - 4, y - 4, x + 4, y + 4];
  });
  const topX = lm[JAW_LEFT].x * w;
  const topY = Math.max(0, lm[FOREHEAD_TOP].y * h - faceH * 0.6);

  return {
    detected: true,
    faceRatio: faceW / faceH,
    eyeSpacingRatio: eyeDist / faceW,
    eyeSizeRatio: (leftEyeW + rightEyeW) / 2 / faceW,
    skin: meanColor(img, skinBoxes) ?? { r: 200, g: 170, b: 150 },
    hair: meanColor(img, [[topX, topY, topX + faceW, topY + faceH * 0.35]]) ?? { r: 60, g: 50, b: 50 },
  };
}

const colorDist = (a, b) => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2) / 441.67;

function traitDistance(a, b) {
  const face = Math.abs(a.faceRatio - b.faceRatio) / 0.3;
  const eyeSpacing = Math.abs(a.eyeSpacingRatio - b.eyeSpacingRatio) / 0.2;
  const eyeSize = Math.abs(a.eyeSizeRatio - b.eyeSizeRatio) / 0.15;
  return (face + (eyeSpacing + eyeSize) / 2 + colorDist(a.skin, b.skin) + colorDist(a.hair, b.hair)) / 4;
}

export function bestMatch(traits) {
  let best = null;
  for (const c of CHARACTERS) {
    const d = traitDistance(traits, c.traits);
    if (!best || d < best.distance) best = { id: c.id, name: c.name, file: c.file, distance: d };
  }
  return best;
}
