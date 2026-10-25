import { FilesetResolver, HandLandmarker, PoseLandmarker, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";
import {
  VERT_SRC,
  VERT_UV_SRC,
  CHIDORI_FRAG_SRC,
  ORB_FRAG_SRC,
  SUSANOO_FRAG_SRC,
  CLAY_FRAG_SRC,
  C4_KARURA_FRAG_SRC,
  CLAY_CLONE_FRAG_SRC,
  FIST_VERT_SRC,
  FIST_FRAG_SRC,
  OUTLINE_FRAG_SRC,
  STEAM_FRAG_SRC,
  BOULDER_FRAG_SRC,
  WING_FRAG_SRC,
  SHARINGAN_FRAG_SRC,
  BRIGHT_PASS_FRAG_SRC,
  BLUR_FRAG_SRC,
  COMPOSITE_FRAG_SRC,
} from "./shaders.js?v=4";

const video = document.getElementById("cam");
const canvas = document.getElementById("fx");
const startBtn = document.getElementById("start");
const statusEl = document.getElementById("status");
const jutsuSelect = document.getElementById("jutsu");

const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false });
if (!gl) {
  setStatus("WebGL2 not available in this browser.", "err");
  throw new Error("no webgl2");
}

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = cls || "";
}

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("shader compile failed: " + log);
  }
  return sh;
}

function buildProgram(vertSrc, fragSrc) {
  const vert = compile(gl.VERTEX_SHADER, vertSrc);
  const frag = compile(gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error("program link failed: " + log);
  }
  return prog;
}

// Like buildProgram, but pins the fist mesh's attribute locations to fixed
// indices before linking, so the same VAO (built once against whichever
// program linked first) stays valid when a second program - the outline
// pass - is bound without that program having independently landed on the
// same locations for "aPosition" etc.
function buildMeshProgram(vertSrc, fragSrc) {
  const vert = compile(gl.VERTEX_SHADER, vertSrc);
  const frag = compile(gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.bindAttribLocation(prog, 0, "aPosition");
  gl.bindAttribLocation(prog, 1, "aNormal");
  gl.bindAttribLocation(prog, 2, "aUv");
  gl.bindAttribLocation(prog, 3, "aBandageMask");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error("program link failed: " + log);
  }
  return prog;
}

// Fullscreen triangle shared by every pass.
const quad = new Float32Array([-1, -1, 3, -1, -1, 3]);
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

function bindQuad(program) {
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
}

// Procedural low-poly fist/forearm mesh for Partial Expansion's 3D render
// path (Approach B - a real mesh, not a video warp). Local space: +x runs
// along the arm from the wrist (x=0) outward to the fist; y/z form each
// cross-section's circle, so a single rotation about the depth axis in the
// vertex shader orients the whole rigid shape to the tracked 2D arm
// direction without distorting the cross-sections (see FIST_VERT_SRC).
function buildFistMesh() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const bandageMask = [];
  const indices = [];

  function addVertex(x, y, z, nx, ny, nz, u, v, mask) {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    bandageMask.push(mask);
    return positions.length / 3 - 1;
  }

  // Forearm: a tapered cylinder, radius growing from wrist to fist.
  const RADIAL_SEGS = 12;
  const LENGTH_SEGS = 8;
  const FOREARM_LEN = 1.5;
  const WRIST_R = 0.38;
  const FOREARM_R = 0.55;

  const forearmRing = [];
  for (let j = 0; j <= LENGTH_SEGS; j++) {
    const tt = j / LENGTH_SEGS;
    const x = tt * FOREARM_LEN;
    const r = WRIST_R + (FOREARM_R - WRIST_R) * Math.pow(tt, 0.7);
    const row = [];
    for (let i = 0; i <= RADIAL_SEGS; i++) {
      const theta = (i / RADIAL_SEGS) * Math.PI * 2;
      const y = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      // Radial normal approximation (ignores the taper's slight slope) -
      // close enough at this poly count for a cel-shaded look.
      row.push(addVertex(x, y, z, 0, Math.cos(theta), Math.sin(theta), i / RADIAL_SEGS, tt, 1.0));
    }
    forearmRing.push(row);
  }
  for (let j = 0; j < LENGTH_SEGS; j++) {
    for (let i = 0; i < RADIAL_SEGS; i++) {
      const a = forearmRing[j][i];
      const b = forearmRing[j][i + 1];
      const c = forearmRing[j + 1][i];
      const d = forearmRing[j + 1][i + 1];
      indices.push(a, c, b, b, c, d);
    }
  }

  // Fist: a squashed sphere (elongated along the arm axis) past the end of
  // the forearm - stylized, not an anatomically detailed hand.
  const FIST_CENTER_X = FOREARM_LEN + 0.55;
  const FIST_RADIUS = 0.95;
  const FIST_STRETCH = 1.15;
  const LAT_SEGS = 10;
  const LON_SEGS = 14;

  const fistRows = [];
  for (let la = 0; la <= LAT_SEGS; la++) {
    const v = la / LAT_SEGS;
    const phi = v * Math.PI;
    const row = [];
    for (let lo = 0; lo <= LON_SEGS; lo++) {
      const u = lo / LON_SEGS;
      const theta = u * Math.PI * 2;
      const sx = -Math.cos(phi); // -1 toward the wrist, +1 away from it
      const ringR = Math.sin(phi);
      const sy = Math.cos(theta) * ringR;
      const sz = Math.sin(theta) * ringR;
      const x = FIST_CENTER_X + sx * FIST_RADIUS * FIST_STRETCH;
      const y = sy * FIST_RADIUS;
      const z = sz * FIST_RADIUS;
      row.push(addVertex(x, y, z, sx, sy, sz, u, v, 0.0));
    }
    fistRows.push(row);
  }
  for (let la = 0; la < LAT_SEGS; la++) {
    for (let lo = 0; lo < LON_SEGS; lo++) {
      const a = fistRows[la][lo];
      const b = fistRows[la][lo + 1];
      const c = fistRows[la + 1][lo];
      const d = fistRows[la + 1][lo + 1];
      indices.push(a, c, b, b, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    bandageMask: new Float32Array(bandageMask),
    indices: new Uint16Array(indices),
  };
}

// local-mesh-units -> px multiplier. The mesh's total reach (wrist to
// fist-tip) is ~3.14 local units, and handPxSmoothed.scale is already a
// sizeable quantity (other effects use it directly as a drawing radius) -
// at the original 1.7 this compounded to ~5x handScale of total reach,
// which is what was blowing the mesh up off the top of the frame. Keeping
// this well under 1.0 keeps the enlarged limb comparable in size to the
// other effects instead of several times bigger.
const FIST_SCALE = 0.85;

// --- Programs ---------------------------------------------------------
const sceneProgram = buildProgram(VERT_SRC, CHIDORI_FRAG_SRC);
const orbProgram = buildProgram(VERT_SRC, ORB_FRAG_SRC);
const susanooProgram = buildProgram(VERT_SRC, SUSANOO_FRAG_SRC);
const clayProgram = buildProgram(VERT_SRC, CLAY_FRAG_SRC);
const c4Program = buildProgram(VERT_SRC, C4_KARURA_FRAG_SRC);
const cloneProgram = buildProgram(VERT_SRC, CLAY_CLONE_FRAG_SRC);
const fistProgram = buildMeshProgram(FIST_VERT_SRC, FIST_FRAG_SRC);
const outlineProgram = buildMeshProgram(FIST_VERT_SRC, OUTLINE_FRAG_SRC);
const steamProgram = buildProgram(VERT_SRC, STEAM_FRAG_SRC);
const boulderProgram = buildProgram(VERT_SRC, BOULDER_FRAG_SRC);
const wingProgram = buildProgram(VERT_SRC, WING_FRAG_SRC);
const sharinganProgram = buildProgram(VERT_SRC, SHARINGAN_FRAG_SRC);
const brightProgram = buildProgram(VERT_UV_SRC, BRIGHT_PASS_FRAG_SRC);
const blurProgram = buildProgram(VERT_UV_SRC, BLUR_FRAG_SRC);
const compositeProgram = buildProgram(VERT_UV_SRC, COMPOSITE_FRAG_SRC);

const sceneU = {
  uResolution: gl.getUniformLocation(sceneProgram, "uResolution"),
  uTime: gl.getUniformLocation(sceneProgram, "uTime"),
  uHandPos: gl.getUniformLocation(sceneProgram, "uHandPos"),
  uHandScale: gl.getUniformLocation(sceneProgram, "uHandScale"),
  uActive: gl.getUniformLocation(sceneProgram, "uActive"),
};
const orbU = {
  uTime: gl.getUniformLocation(orbProgram, "uTime"),
  uHandPos: gl.getUniformLocation(orbProgram, "uHandPos"),
  uHandScale: gl.getUniformLocation(orbProgram, "uHandScale"),
  uActive: gl.getUniformLocation(orbProgram, "uActive"),
};
const susanooU = {
  uResolution: gl.getUniformLocation(susanooProgram, "uResolution"),
  uTime: gl.getUniformLocation(susanooProgram, "uTime"),
  uHandPos: gl.getUniformLocation(susanooProgram, "uHandPos"),
  uHandScale: gl.getUniformLocation(susanooProgram, "uHandScale"),
  uActive: gl.getUniformLocation(susanooProgram, "uActive"),
};
const clayU = {
  uResolution: gl.getUniformLocation(clayProgram, "uResolution"),
  uTime: gl.getUniformLocation(clayProgram, "uTime"),
  uHandPos: gl.getUniformLocation(clayProgram, "uHandPos"),
  uHandScale: gl.getUniformLocation(clayProgram, "uHandScale"),
  uActive: gl.getUniformLocation(clayProgram, "uActive"),
};
const c4U = {
  uResolution: gl.getUniformLocation(c4Program, "uResolution"),
  uTime: gl.getUniformLocation(c4Program, "uTime"),
  uHandPos: gl.getUniformLocation(c4Program, "uHandPos"),
  uHandScale: gl.getUniformLocation(c4Program, "uHandScale"),
  uActive: gl.getUniformLocation(c4Program, "uActive"),
};
const cloneU = {
  uResolution: gl.getUniformLocation(cloneProgram, "uResolution"),
  uTime: gl.getUniformLocation(cloneProgram, "uTime"),
  uHandPos: gl.getUniformLocation(cloneProgram, "uHandPos"),
  uHandScale: gl.getUniformLocation(cloneProgram, "uHandScale"),
  uActive: gl.getUniformLocation(cloneProgram, "uActive"),
};
const fistU = {
  uAnchorPx: gl.getUniformLocation(fistProgram, "uAnchorPx"),
  uAngle: gl.getUniformLocation(fistProgram, "uAngle"),
  uScalePx: gl.getUniformLocation(fistProgram, "uScalePx"),
  uCanvasSize: gl.getUniformLocation(fistProgram, "uCanvasSize"),
  uZRange: gl.getUniformLocation(fistProgram, "uZRange"),
  uActive: gl.getUniformLocation(fistProgram, "uActive"),
  uInflate: gl.getUniformLocation(fistProgram, "uInflate"),
};
const outlineU = {
  uAnchorPx: gl.getUniformLocation(outlineProgram, "uAnchorPx"),
  uAngle: gl.getUniformLocation(outlineProgram, "uAngle"),
  uScalePx: gl.getUniformLocation(outlineProgram, "uScalePx"),
  uCanvasSize: gl.getUniformLocation(outlineProgram, "uCanvasSize"),
  uZRange: gl.getUniformLocation(outlineProgram, "uZRange"),
  uActive: gl.getUniformLocation(outlineProgram, "uActive"),
  uInflate: gl.getUniformLocation(outlineProgram, "uInflate"),
};
const steamU = {
  uTime: gl.getUniformLocation(steamProgram, "uTime"),
  uHandPos: gl.getUniformLocation(steamProgram, "uHandPos"),
  uHandScale: gl.getUniformLocation(steamProgram, "uHandScale"),
  uActive: gl.getUniformLocation(steamProgram, "uActive"),
};

const fistMeshData = buildFistMesh();
const fistMesh = { indexCount: fistMeshData.indices.length };
const fistVAO = gl.createVertexArray();
gl.bindVertexArray(fistVAO);

function uploadAttrib(program, attribName, data, size) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, attribName);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
}
uploadAttrib(fistProgram, "aPosition", fistMeshData.positions, 3);
uploadAttrib(fistProgram, "aNormal", fistMeshData.normals, 3);
uploadAttrib(fistProgram, "aUv", fistMeshData.uvs, 2);
uploadAttrib(fistProgram, "aBandageMask", fistMeshData.bandageMask, 1);

const fistIndexBuf = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fistIndexBuf);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, fistMeshData.indices, gl.STATIC_DRAW);

gl.bindVertexArray(null);
const boulderU = {
  uResolution: gl.getUniformLocation(boulderProgram, "uResolution"),
  uTime: gl.getUniformLocation(boulderProgram, "uTime"),
  uHandPos: gl.getUniformLocation(boulderProgram, "uHandPos"),
  uHandScale: gl.getUniformLocation(boulderProgram, "uHandScale"),
  uActive: gl.getUniformLocation(boulderProgram, "uActive"),
};
const wingU = {
  uResolution: gl.getUniformLocation(wingProgram, "uResolution"),
  uTime: gl.getUniformLocation(wingProgram, "uTime"),
  uHandPos: gl.getUniformLocation(wingProgram, "uHandPos"),
  uHandScale: gl.getUniformLocation(wingProgram, "uHandScale"),
  uActive: gl.getUniformLocation(wingProgram, "uActive"),
};
const sharinganU = {
  uLeftEyePos: gl.getUniformLocation(sharinganProgram, "uLeftEyePos"),
  uLeftEyeR: gl.getUniformLocation(sharinganProgram, "uLeftEyeR"),
  uLeftHalfW: gl.getUniformLocation(sharinganProgram, "uLeftHalfW"),
  uLeftHalfH: gl.getUniformLocation(sharinganProgram, "uLeftHalfH"),
  uRightEyePos: gl.getUniformLocation(sharinganProgram, "uRightEyePos"),
  uRightEyeR: gl.getUniformLocation(sharinganProgram, "uRightEyeR"),
  uRightHalfW: gl.getUniformLocation(sharinganProgram, "uRightHalfW"),
  uRightHalfH: gl.getUniformLocation(sharinganProgram, "uRightHalfH"),
  uIgnite: gl.getUniformLocation(sharinganProgram, "uIgnite"),
  uTime: gl.getUniformLocation(sharinganProgram, "uTime"),
  uActive: gl.getUniformLocation(sharinganProgram, "uActive"),
  uVideoTex: gl.getUniformLocation(sharinganProgram, "uVideoTex"),
  uCanvasSize: gl.getUniformLocation(sharinganProgram, "uCanvasSize"),
  uVideoOffset: gl.getUniformLocation(sharinganProgram, "uVideoOffset"),
  uVideoExtent: gl.getUniformLocation(sharinganProgram, "uVideoExtent"),
};
const brightU = {
  uScene: gl.getUniformLocation(brightProgram, "uScene"),
  uThreshold: gl.getUniformLocation(brightProgram, "uThreshold"),
};
const blurU = {
  uTex: gl.getUniformLocation(blurProgram, "uTex"),
  uTexelStep: gl.getUniformLocation(blurProgram, "uTexelStep"),
};
const compositeU = {
  uScene: gl.getUniformLocation(compositeProgram, "uScene"),
  uBloom: gl.getUniformLocation(compositeProgram, "uBloom"),
  uVideo: gl.getUniformLocation(compositeProgram, "uVideo"),
  uBloomStrength: gl.getUniformLocation(compositeProgram, "uBloomStrength"),
  uCanvasSize: gl.getUniformLocation(compositeProgram, "uCanvasSize"),
  uVideoOffset: gl.getUniformLocation(compositeProgram, "uVideoOffset"),
  uVideoExtent: gl.getUniformLocation(compositeProgram, "uVideoExtent"),
  uHandPos: gl.getUniformLocation(compositeProgram, "uHandPos"),
  uHandScale: gl.getUniformLocation(compositeProgram, "uHandScale"),
  uActive: gl.getUniformLocation(compositeProgram, "uActive"),
  uTime: gl.getUniformLocation(compositeProgram, "uTime"),
};

function createVideoTexture() {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

const videoTex = createVideoTexture();

// --- Framebuffers -------------------------------------------------------
function createFBO(w, h, withDepth) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  // Only sceneFBO needs a depth buffer, for the Partial Expansion fist mesh
  // (the only real 3D geometry drawn in this lab - every other effect is a
  // fullscreen triangle with no depth test).
  let depthRb = null;
  if (withDepth) {
    depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h, depthRb };
}

let sceneFBO, bloomFBOA, bloomFBOB;
const BLOOM_SCALE = 0.5; // half-res blur: cheaper + naturally softer
const BLOOM_ITERATIONS = 3;
const BLOOM_THRESHOLD = 0.45;
const BLOOM_STRENGTH = 1.3;

function rebuildFBOs() {
  const w = canvas.width;
  const h = canvas.height;
  const bw = Math.max(1, Math.round(w * BLOOM_SCALE));
  const bh = Math.max(1, Math.round(h * BLOOM_SCALE));
  sceneFBO = createFBO(w, h, true);
  bloomFBOA = createFBO(bw, bh);
  bloomFBOB = createFBO(bw, bh);
}

let dpr = Math.min(window.devicePixelRatio || 1, 2);
let handPxTarget = { x: 0, y: 0, scale: 80, active: 0, dirX: 1, dirY: 0, wristX: 0, wristY: 0 };
let handPxSmoothed = { x: 0, y: 0, scale: 80, active: 0, dirX: 1, dirY: 0, wristX: 0, wristY: 0 };

// Body-pose anchor, used by effects that come from the torso/back rather
// than the hand (Human Boulder curls the whole torso into a ball; Butterfly
// Mode's wings sprout from the shoulder blades) - a single tracked hand
// point can't stand in for those without drifting away from the body.
let bodyPxTarget = { torsoX: 0, torsoY: 0, backX: 0, backY: 0, scale: 120, active: 0 };
let bodyPxSmoothed = { torsoX: 0, torsoY: 0, backX: 0, backY: 0, scale: 120, active: 0 };

// Face-anchored eye jutsu (Sharingan) - needs real per-eye position/size,
// which hand/pose landmarks can't give. FaceLandmarker's 478-point mesh
// includes iris landmarks (468 left iris center, 473 right iris center)
// and eye-corner landmarks, used below to size each eye independently.
let facePxTarget = { lx: 0, ly: 0, lr: 20, lHalfW: 40, lHalfH: 20, rx: 0, ry: 0, rr: 20, rHalfW: 40, rHalfH: 20, active: 0 };
let facePxSmoothed = { lx: 0, ly: 0, lr: 20, lHalfW: 40, lHalfH: 20, rx: 0, ry: 0, rr: 20, rHalfW: 40, rHalfH: 20, active: 0 };
// Sharingan "ignition": eases toward 1 while a face is tracked, back toward
// 0 when it's lost, so activating/deactivating is a ramp (spin slowing to
// a stop, red saturating in) instead of an instant on/off.
let sharinganIgnite = 0;
let lastFrameMs = 0;

function resize() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  rebuildFBOs();
}
window.addEventListener("resize", resize);

// object-fit:cover mapping between the raw video frame and the canvas, in
// device pixels, top-origin (matches CSS pixel space before the GL Y-flip).
// Shared by the hand-position math below and the composite shader's video
// sampling, so the mirrored/warped overlay always lines up with the hand.
function coverParams() {
  const rect = canvas.getBoundingClientRect();
  const cw = rect.width * dpr;
  const ch = rect.height * dpr;
  const vw = video.videoWidth || cw;
  const vh = video.videoHeight || ch;
  const scale = Math.max(cw / vw, ch / vh);
  const offX = (cw - vw * scale) / 2;
  const offY = (ch - vh * scale) / 2;
  return { cw, ch, extentX: vw * scale, extentY: vh * scale, offX, offY };
}

// Map a normalized (0..1) landmark coord from the raw video frame into
// canvas pixel space, accounting for object-fit:cover cropping and the
// horizontal mirror applied for the selfie view.
function videoNormToCanvasPx(nx, ny) {
  const { ch, extentX, extentY, offX, offY } = coverParams();
  const mirroredX = 1 - nx;
  const dispX = offX + mirroredX * extentX;
  const dispY = offY + ny * extentY;
  // flip Y: canvas CSS space is top-origin, GL fragCoord is bottom-origin
  return { x: dispX, y: ch - dispY };
}

let landmarker = null;
let poseLandmarker = null;
let faceLandmarker = null;
let lastVideoTime = -1;
let lastPoseVideoTime = -1;
let lastFaceVideoTime = -1;

async function setupHandLandmarker() {
  setStatus("Loading hand + pose models...");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
  });
  // "lite" variant: the body-anchored effects (boulder/wing) only need
  // shoulder/hip landmarks, not per-joint precision, so the cheapest model
  // keeps the two trackers running side by side affordable.
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  setStatus("Models ready. Hold a hand up / step back for pose.");
}

async function setupFaceLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
}

function detectLoop() {
  requestAnimationFrame(detectLoop);
  if (video.readyState < 2) return;

  if (landmarker && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = landmarker.detectForVideo(video, performance.now());
    if (result.landmarks && result.landmarks.length > 0) {
      const lm = result.landmarks[0];
      // Palm center: average the four finger-base knuckles (5, 9, 13, 17).
      // Including the wrist pulled this down toward the forearm, so the
      // orb/bolts sat below the hand instead of in the palm.
      const cx = (lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 4;
      const cy = (lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 4;
      // Hand "radius" from wrist-to-middle-tip span, in normalized units.
      const spanX = lm[0].x - lm[12].x;
      const spanY = lm[0].y - lm[12].y;
      const spanNorm = Math.hypot(spanX, spanY);

      const centerPx = videoNormToCanvasPx(cx, cy);
      const edgePx = videoNormToCanvasPx(cx + spanNorm, cy);
      const scalePx = Math.max(40, Math.hypot(edgePx.x - centerPx.x, edgePx.y - centerPx.y) * 1.6);

      // Wrist -> palm-center direction, so Partial Expansion's magnify warp
      // can elongate along the actual limb axis instead of being a plain
      // circle (same pixel space as centerPx, so no extra conversion).
      const wristPx = videoNormToCanvasPx(lm[0].x, lm[0].y);
      let dirX = centerPx.x - wristPx.x;
      let dirY = centerPx.y - wristPx.y;
      const dirLen = Math.hypot(dirX, dirY) || 1;
      dirX /= dirLen;
      dirY /= dirLen;

      handPxTarget = {
        x: centerPx.x,
        y: centerPx.y,
        scale: scalePx,
        active: 1,
        dirX,
        dirY,
        wristX: wristPx.x,
        wristY: wristPx.y,
      };
    } else {
      handPxTarget.active = 0;
    }
  }

  if (poseLandmarker && video.currentTime !== lastPoseVideoTime) {
    lastPoseVideoTime = video.currentTime;
    const poseResult = poseLandmarker.detectForVideo(video, performance.now());
    if (poseResult.landmarks && poseResult.landmarks.length > 0) {
      const lm = poseResult.landmarks[0];
      // Standard 33-point Mediapipe Pose: 11/12 shoulders, 23/24 hips.
      const shoulderMidX = (lm[11].x + lm[12].x) / 2;
      const shoulderMidY = (lm[11].y + lm[12].y) / 2;
      const hipMidX = (lm[23].x + lm[24].x) / 2;
      const hipMidY = (lm[23].y + lm[24].y) / 2;
      // Torso center: midpoint between shoulders and hips, for Human
      // Boulder's full-body-curls-into-a-ball anchor.
      const torsoX = (shoulderMidX + hipMidX) / 2;
      const torsoY = (shoulderMidY + hipMidY) / 2;
      // Upper-back anchor, nudged above the shoulder line, for Butterfly
      // Mode's wings - the camera only sees the front, so "between the
      // shoulder blades" is approximated as "just above the shoulders".
      const backX = shoulderMidX;
      const backY = shoulderMidY - 0.06;

      const shoulderSpanNorm = Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y);
      const torsoCenterPx = videoNormToCanvasPx(torsoX, torsoY);
      const backCenterPx = videoNormToCanvasPx(backX, backY);
      const shoulderEdgePx = videoNormToCanvasPx(shoulderMidX + shoulderSpanNorm, shoulderMidY);
      const bodyScalePx = Math.max(
        60,
        Math.hypot(shoulderEdgePx.x - torsoCenterPx.x, shoulderEdgePx.y - torsoCenterPx.y) * 1.8
      );

      bodyPxTarget = {
        torsoX: torsoCenterPx.x,
        torsoY: torsoCenterPx.y,
        backX: backCenterPx.x,
        backY: backCenterPx.y,
        scale: bodyScalePx,
        active: 1,
      };
    } else {
      bodyPxTarget.active = 0;
    }
  }

  if (faceLandmarker && video.currentTime !== lastFaceVideoTime) {
    lastFaceVideoTime = video.currentTime;
    const faceResult = faceLandmarker.detectForVideo(video, performance.now());
    if (faceResult.faceLandmarks && faceResult.faceLandmarks.length > 0) {
      const lm = faceResult.faceLandmarks[0];
      // Iris centers (canonical 478-point face mesh indices). Note the
      // selfie mirror: "left iris" (468) is the landmark on the viewer's
      // right of the raw frame, but videoNormToCanvasPx already mirrors x,
      // so no extra left/right swap is needed here - it lines up the same
      // way hand tracking already does.
      const leftIrisPx = videoNormToCanvasPx(lm[468].x, lm[468].y);
      const rightIrisPx = videoNormToCanvasPx(lm[473].x, lm[473].y);

      // Canthus-to-canthus eye width (362/263 left eye, 33/133 right eye) -
      // used for two DIFFERENT, INDEPENDENT things below. Reusing one of
      // them as both the iris draw radius and the eyelid clip extent is
      // what squashed the iris into an almond before: the clip ellipse
      // naturally isn't 1:1 (eyes are wider than tall), and sharing its
      // scale with the circle being drawn stretched the circle itself.
      const leftCornerA = videoNormToCanvasPx(lm[362].x, lm[362].y);
      const leftCornerB = videoNormToCanvasPx(lm[263].x, lm[263].y);
      const rightCornerA = videoNormToCanvasPx(lm[33].x, lm[33].y);
      const rightCornerB = videoNormToCanvasPx(lm[133].x, lm[133].y);
      const leftEyeWidthPx = Math.hypot(leftCornerA.x - leftCornerB.x, leftCornerA.y - leftCornerB.y);
      const rightEyeWidthPx = Math.hypot(rightCornerA.x - rightCornerB.x, rightCornerA.y - rightCornerB.y);

      // 1. Iris draw radius: a real iris is ~35-40% of the eye's width, not
      // the whole socket - 0.22 of the full corner-to-corner span leaves the
      // white sclera clearly visible on both sides, matching that ratio.
      const leftR = Math.max(6, leftEyeWidthPx * 0.28);
      const rightR = Math.max(6, rightEyeWidthPx * 0.28);

      // 2. Eyelid clip extents: the eye-opening ellipse's own half-width/
      // half-height, evaluated in the shader as a SEPARATE test from the
      // iris circle above (see eyeColor) - this cuts the circle off at the
      // lid boundary without ever deforming the circle itself.
      const leftLidTopPx = videoNormToCanvasPx(lm[386].x, lm[386].y);
      const leftLidBottomPx = videoNormToCanvasPx(lm[374].x, lm[374].y);
      const rightLidTopPx = videoNormToCanvasPx(lm[159].x, lm[159].y);
      const rightLidBottomPx = videoNormToCanvasPx(lm[145].x, lm[145].y);
      const lOpenPx = Math.hypot(leftLidTopPx.x - leftLidBottomPx.x, leftLidTopPx.y - leftLidBottomPx.y);
      const rOpenPx = Math.hypot(rightLidTopPx.x - rightLidBottomPx.x, rightLidTopPx.y - rightLidBottomPx.y);

      facePxTarget = {
        lx: leftIrisPx.x,
        ly: leftIrisPx.y,
        lr: leftR,
        lHalfW: leftEyeWidthPx / 2,
        lHalfH: lOpenPx / 2,
        rx: rightIrisPx.x,
        ry: rightIrisPx.y,
        rr: rightR,
        rHalfW: rightEyeWidthPx / 2,
        rHalfH: rOpenPx / 2,
        active: 1,
      };
    } else {
      facePxTarget.active = 0;
    }
  }

  if (handPxTarget.active && bodyPxTarget.active) {
    setStatus("Tracking hand + pose.");
  } else if (handPxTarget.active) {
    setStatus("Tracking hand. Step back for pose.", "warn");
  } else if (bodyPxTarget.active) {
    setStatus("Tracking pose. Hold a hand up for hand FX.", "warn");
  } else {
    setStatus("No hand or pose detected.", "warn");
  }
}

let startTime = 0;
function renderLoop(now) {
  requestAnimationFrame(renderLoop);
  if (!startTime) startTime = now;
  const t = (now - startTime) / 1000;

  const lerp = (a, b, k) => a + (b - a) * k;
  handPxSmoothed.x = lerp(handPxSmoothed.x, handPxTarget.x, 0.35);
  handPxSmoothed.y = lerp(handPxSmoothed.y, handPxTarget.y, 0.35);
  handPxSmoothed.scale = lerp(handPxSmoothed.scale, handPxTarget.scale, 0.2);
  handPxSmoothed.active = lerp(handPxSmoothed.active, handPxTarget.active, 0.15);
  handPxSmoothed.dirX = lerp(handPxSmoothed.dirX, handPxTarget.dirX, 0.25);
  handPxSmoothed.dirY = lerp(handPxSmoothed.dirY, handPxTarget.dirY, 0.25);
  handPxSmoothed.wristX = lerp(handPxSmoothed.wristX, handPxTarget.wristX, 0.35);
  handPxSmoothed.wristY = lerp(handPxSmoothed.wristY, handPxTarget.wristY, 0.35);

  bodyPxSmoothed.torsoX = lerp(bodyPxSmoothed.torsoX, bodyPxTarget.torsoX, 0.25);
  bodyPxSmoothed.torsoY = lerp(bodyPxSmoothed.torsoY, bodyPxTarget.torsoY, 0.25);
  bodyPxSmoothed.backX = lerp(bodyPxSmoothed.backX, bodyPxTarget.backX, 0.25);
  bodyPxSmoothed.backY = lerp(bodyPxSmoothed.backY, bodyPxTarget.backY, 0.25);
  bodyPxSmoothed.scale = lerp(bodyPxSmoothed.scale, bodyPxTarget.scale, 0.15);
  bodyPxSmoothed.active = lerp(bodyPxSmoothed.active, bodyPxTarget.active, 0.12);

  facePxSmoothed.lx = lerp(facePxSmoothed.lx, facePxTarget.lx, 0.4);
  facePxSmoothed.ly = lerp(facePxSmoothed.ly, facePxTarget.ly, 0.4);
  facePxSmoothed.lr = lerp(facePxSmoothed.lr, facePxTarget.lr, 0.25);
  facePxSmoothed.lHalfW = lerp(facePxSmoothed.lHalfW, facePxTarget.lHalfW, 0.3);
  // Eyelid gap gets a faster lerp than most smoothed values - it needs to
  // track real blinks (a few hundred ms), not glide behind them.
  facePxSmoothed.lHalfH = lerp(facePxSmoothed.lHalfH, facePxTarget.lHalfH, 0.5);
  facePxSmoothed.rx = lerp(facePxSmoothed.rx, facePxTarget.rx, 0.4);
  facePxSmoothed.ry = lerp(facePxSmoothed.ry, facePxTarget.ry, 0.4);
  facePxSmoothed.rr = lerp(facePxSmoothed.rr, facePxTarget.rr, 0.25);
  facePxSmoothed.rHalfW = lerp(facePxSmoothed.rHalfW, facePxTarget.rHalfW, 0.3);
  facePxSmoothed.rHalfH = lerp(facePxSmoothed.rHalfH, facePxTarget.rHalfH, 0.5);
  facePxSmoothed.active = lerp(facePxSmoothed.active, facePxTarget.active, 0.2);

  const dtSec = lastFrameMs ? Math.min((now - lastFrameMs) / 1000, 0.1) : 0;
  lastFrameMs = now;
  const igniteTarget = facePxSmoothed.active > 0.5 ? 1 : 0;
  const igniteRate = igniteTarget ? 1 / 1.5 : 1 / 0.4;
  sharinganIgnite += (igniteTarget - sharinganIgnite) * Math.min(1, dtSec * igniteRate * 3);

  // Upload the current video frame and compute its cover-fit mapping before
  // the effect pass (not after, as the composite step used to do) - the
  // Sharingan effect needs to sample the real eye underneath it while it
  // draws, not just leave an occlusion flag for the composite pass.
  if (video.readyState >= 2) {
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }
  const cp = coverParams();

  // 1. Render the selected effect into sceneFBO. Alpha clears to 0 (not 1):
  // every fullscreen-triangle effect below overwrites every pixel's alpha
  // itself (0 = pure glow, >0 = occlusion), but the mesh effect only covers
  // part of the screen, so pixels outside it must default to "not occluded"
  // rather than inheriting a stale opaque clear value.
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO.fbo);
  gl.viewport(0, 0, sceneFBO.w, sceneFBO.h);
  gl.clearColor(0, 0, 0, 0);
  gl.clearDepth(1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);

  // Only the 3D fist mesh (Partial Expansion) issues its own draw calls
  // below; every other branch falls through to the shared fullscreen-
  // triangle draw after the if/else chain.
  let customDraw = false;

  if (jutsuSelect.value === "rasengan") {
    gl.useProgram(orbProgram);
    bindQuad(orbProgram);
    gl.uniform1f(orbU.uTime, t);
    gl.uniform2f(orbU.uHandPos, handPxSmoothed.x, handPxSmoothed.y);
    gl.uniform1f(orbU.uHandScale, handPxSmoothed.scale);
    gl.uniform1f(orbU.uActive, handPxSmoothed.active);
  } else if (jutsuSelect.value === "deidara") {
    gl.useProgram(clayProgram);
    bindQuad(clayProgram);
    gl.uniform2f(clayU.uResolution, canvas.width, canvas.height);
    gl.uniform1f(clayU.uTime, t);
    gl.uniform2f(clayU.uHandPos, handPxSmoothed.x, handPxSmoothed.y);
    gl.uniform1f(clayU.uHandScale, handPxSmoothed.scale);
    gl.uniform1f(clayU.uActive, handPxSmoothed.active);
  } else if (jutsuSelect.value === "c4karura") {
    gl.useProgram(c4Program);
    bindQuad(c4Program);
    gl.uniform2f(c4U.uResolution, canvas.width, canvas.height);
    gl.uniform1f(c4U.uTime, t);
    gl.uniform2f(c4U.uHandPos, handPxSmoothed.x, handPxSmoothed.y);
    gl.uniform1f(c4U.uHandScale, handPxSmoothed.scale);
    gl.uniform1f(c4U.uActive, handPxSmoothed.active);
  } else if (jutsuSelect.value === "clayclone") {
    gl.useProgram(cloneProgram);
    bindQuad(cloneProgram);
    gl.uniform2f(cloneU.uResolution, canvas.width, canvas.height);
    gl.uniform1f(cloneU.uTime, t);
    gl.uniform2f(cloneU.uHandPos, handPxSmoothed.x, handPxSmoothed.y);
    gl.uniform1f(cloneU.uHandScale, handPxSmoothed.scale);
    gl.uniform1f(cloneU.uActive, handPxSmoothed.active);
  } else if (jutsuSelect.value === "expansion") {
    // Partial Expansion - Approach B: a real low-poly 3D fist/forearm mesh,
    // not a 2D video warp (see FIST_VERT_SRC/FIST_FRAG_SRC and
    // buildFistMesh()). Needs its own draw calls (real depth test +
    // backface culling for a solid mesh, then a separate additive steam
    // pass), so it skips the shared fullscreen-triangle draw below.
    customDraw = true;

    const angle = Math.atan2(handPxSmoothed.dirY, handPxSmoothed.dirX);
    const period = 1.8;
    const breathe = 0.85 + 0.15 * (0.65 + 0.35 * Math.sin((t * 2 * Math.PI) / period));
    const scalePx = handPxSmoothed.scale * FIST_SCALE * breathe;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(fistVAO);

    // Anime ink outline first: front-face culled (only inside-out backfaces
    // render) and pushed outward along the normal, so it peeks out from
    // behind the regular mesh drawn next - see OUTLINE_FRAG_SRC.
    gl.cullFace(gl.FRONT);
    gl.useProgram(outlineProgram);
    gl.uniform2f(outlineU.uAnchorPx, handPxSmoothed.wristX, handPxSmoothed.wristY);
    gl.uniform1f(outlineU.uAngle, angle);
    gl.uniform1f(outlineU.uScalePx, scalePx);
    gl.uniform2f(outlineU.uCanvasSize, canvas.width, canvas.height);
    gl.uniform1f(outlineU.uZRange, Math.max(canvas.width, canvas.height));
    gl.uniform1f(outlineU.uActive, handPxSmoothed.active);
    gl.uniform1f(outlineU.uInflate, 0.05);
    gl.drawElements(gl.TRIANGLES, fistMesh.indexCount, gl.UNSIGNED_SHORT, 0);

    gl.cullFace(gl.BACK);
    gl.useProgram(fistProgram);
    gl.uniform2f(fistU.uAnchorPx, handPxSmoothed.wristX, handPxSmoothed.wristY);
    gl.uniform1f(fistU.uAngle, angle);
    gl.uniform1f(fistU.uScalePx, scalePx);
    gl.uniform2f(fistU.uCanvasSize, canvas.width, canvas.height);
    gl.uniform1f(fistU.uZRange, Math.max(canvas.width, canvas.height));
    gl.uniform1f(fistU.uActive, handPxSmoothed.active);
    gl.uniform1f(fistU.uInflate, 0.0);
    gl.drawElements(gl.TRIANGLES, fistMesh.indexCount, gl.UNSIGNED_SHORT, 0);

    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // Yang-release vapor: additive steam rising off the fist, anchored
    // partway up the mesh (not the wrist) so it reads as coming off the
    // enlarged limb's surface.
    const dirN = { x: Math.cos(angle), y: Math.sin(angle) };
    const steamX = handPxSmoothed.wristX + dirN.x * scalePx * 1.6;
    const steamY = handPxSmoothed.wristY + dirN.y * scalePx * 1.6;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(steamProgram);
    bindQuad(steamProgram);
    gl.uniform1f(steamU.uTime, t);
    gl.uniform2f(steamU.uHandPos, steamX, steamY);
    gl.uniform1f(steamU.uHandScale, scalePx);
    gl.uniform1f(steamU.uActive, handPxSmoothed.active);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  } else if (jutsuSelect.value === "boulder") {
    // Human Boulder curls the whole torso into a ball, not the hand - anchor
    // on the pose tracker's torso center instead (see detectLoop).
    gl.useProgram(boulderProgram);
    bindQuad(boulderProgram);
    gl.uniform2f(boulderU.uResolution, canvas.width, canvas.height);
    gl.uniform1f(boulderU.uTime, t);
    gl.uniform2f(boulderU.uHandPos, bodyPxSmoothed.torsoX, bodyPxSmoothed.torsoY);
    gl.uniform1f(boulderU.uHandScale, bodyPxSmoothed.scale);
    gl.uniform1f(boulderU.uActive, bodyPxSmoothed.active);
  } else if (jutsuSelect.value === "wing") {
    // Butterfly Mode's wings sprout from the shoulder blades, not the hand -
    // anchor on the pose tracker's upper-back point.
    gl.useProgram(wingProgram);
    bindQuad(wingProgram);
    gl.uniform2f(wingU.uResolution, canvas.width, canvas.height);
    gl.uniform1f(wingU.uTime, t);
    gl.uniform2f(wingU.uHandPos, bodyPxSmoothed.backX, bodyPxSmoothed.backY);
    gl.uniform1f(wingU.uHandScale, bodyPxSmoothed.scale);
    gl.uniform1f(wingU.uActive, bodyPxSmoothed.active);
  } else if (jutsuSelect.value === "sharingan") {
    // Face-anchored, not hand-anchored - uses FaceLandmarker's iris tracking
    // (see detectLoop) instead of handPxSmoothed.
    gl.useProgram(sharinganProgram);
    bindQuad(sharinganProgram);
    gl.uniform2f(sharinganU.uLeftEyePos, facePxSmoothed.lx, facePxSmoothed.ly);
    gl.uniform1f(sharinganU.uLeftEyeR, facePxSmoothed.lr);
    gl.uniform1f(sharinganU.uLeftHalfW, facePxSmoothed.lHalfW);
    gl.uniform1f(sharinganU.uLeftHalfH, facePxSmoothed.lHalfH);
    gl.uniform2f(sharinganU.uRightEyePos, facePxSmoothed.rx, facePxSmoothed.ry);
    gl.uniform1f(sharinganU.uRightEyeR, facePxSmoothed.rr);
    gl.uniform1f(sharinganU.uRightHalfW, facePxSmoothed.rHalfW);
    gl.uniform1f(sharinganU.uRightHalfH, facePxSmoothed.rHalfH);
    gl.uniform1f(sharinganU.uIgnite, sharinganIgnite);
    gl.uniform1f(sharinganU.uTime, t);
    gl.uniform1f(sharinganU.uActive, facePxSmoothed.active);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.uniform1i(sharinganU.uVideoTex, 0);
    gl.uniform2f(sharinganU.uCanvasSize, canvas.width, canvas.height);
    gl.uniform2f(sharinganU.uVideoOffset, cp.offX, cp.offY);
    gl.uniform2f(sharinganU.uVideoExtent, cp.extentX, cp.extentY);
  } else if (jutsuSelect.value === "susanoo") {
    // No pose/body tracking in this lab - only a single hand's landmarks
    // are available (see detectLoop above). Judgment call: anchor Susanoo
    // off the same hand point used by the other effects and treat it as
    // roughly chest height, then scale the whole figure up hugely inside
    // the shader (BODY_SCALE) so it looms over the user's whole body
    // instead of sitting in the palm like the orb/bolts do. This avoids
    // pulling in a full pose-estimation model just for one effect.
    gl.useProgram(susanooProgram);
    bindQuad(susanooProgram);
    gl.uniform2f(susanooU.uResolution, canvas.width, canvas.height);
    gl.uniform1f(susanooU.uTime, t);
    gl.uniform2f(susanooU.uHandPos, handPxSmoothed.x, handPxSmoothed.y);
    gl.uniform1f(susanooU.uHandScale, handPxSmoothed.scale);
    gl.uniform1f(susanooU.uActive, handPxSmoothed.active);
  } else {
    gl.useProgram(sceneProgram);
    bindQuad(sceneProgram);
    gl.uniform2f(sceneU.uResolution, canvas.width, canvas.height);
    gl.uniform1f(sceneU.uTime, t);
    gl.uniform2f(sceneU.uHandPos, handPxSmoothed.x, handPxSmoothed.y);
    gl.uniform1f(sceneU.uHandScale, handPxSmoothed.scale);
    gl.uniform1f(sceneU.uActive, handPxSmoothed.active);
  }
  if (!customDraw) {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // 2. Extract bright areas into bloomFBOA (half-res).
  gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOA.fbo);
  gl.viewport(0, 0, bloomFBOA.w, bloomFBOA.h);
  gl.useProgram(brightProgram);
  bindQuad(brightProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sceneFBO.tex);
  gl.uniform1i(brightU.uScene, 0);
  gl.uniform1f(brightU.uThreshold, BLOOM_THRESHOLD);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // 3. Ping-pong separable blur between bloomFBOA <-> bloomFBOB.
  let srcFBO = bloomFBOA;
  let dstFBO = bloomFBOB;
  for (let i = 0; i < BLOOM_ITERATIONS; i++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFBO.fbo);
    gl.viewport(0, 0, dstFBO.w, dstFBO.h);
    gl.useProgram(blurProgram);
    bindQuad(blurProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcFBO.tex);
    gl.uniform1i(blurU.uTex, 0);
    gl.uniform2f(blurU.uTexelStep, 1 / srcFBO.w, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    [srcFBO, dstFBO] = [dstFBO, srcFBO];

    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFBO.fbo);
    gl.viewport(0, 0, dstFBO.w, dstFBO.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcFBO.tex);
    gl.uniform2f(blurU.uTexelStep, 0, 1 / srcFBO.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    [srcFBO, dstFBO] = [dstFBO, srcFBO];
  }

  // 4. Composite sharp scene + blurred bloom + warped video onto the
  // visible canvas. (video texture + cp already set above, before step 1.)

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(compositeProgram);
  bindQuad(compositeProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sceneFBO.tex);
  gl.uniform1i(compositeU.uScene, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, srcFBO.tex);
  gl.uniform1i(compositeU.uBloom, 1);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.uniform1i(compositeU.uVideo, 2);
  // Sharingan is a realistic eye overlay, not a chakra/energy effect - it
  // must never bloom. Its bright specular glint was small but exceeded
  // BLOOM_THRESHOLD, and the shared bloom pass blurred that glow outward
  // over the real sclera, reading as "bleached white holes" around the eye.
  const bloomStrength = jutsuSelect.value === "sharingan" ? 0.0 : BLOOM_STRENGTH;
  gl.uniform1f(compositeU.uBloomStrength, bloomStrength);
  gl.uniform2f(compositeU.uCanvasSize, canvas.width, canvas.height);
  gl.uniform2f(compositeU.uVideoOffset, cp.offX, cp.offY);
  gl.uniform2f(compositeU.uVideoExtent, cp.extentX, cp.extentY);
  gl.uniform2f(compositeU.uHandPos, handPxSmoothed.x, handPxSmoothed.y);
  gl.uniform1f(compositeU.uHandScale, handPxSmoothed.scale);
  gl.uniform1f(compositeU.uActive, handPxSmoothed.active);
  gl.uniform1f(compositeU.uTime, t);
  // Partial Expansion is the only effect that visibly bulges the live video
  // (the limb itself swells) rather than just glowing on top of it.
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  try {
    setStatus("Requesting camera...");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    resize();
    await setupHandLandmarker();
    await setupFaceLandmarker();
    detectLoop();
    requestAnimationFrame(renderLoop);
  } catch (err) {
    setStatus("Error: " + err.message, "err");
    startBtn.disabled = false;
  }
});

resize();
