import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";
import {
  VERT_SRC,
  VERT_UV_SRC,
  CHIDORI_FRAG_SRC,
  ORB_FRAG_SRC,
  SUSANOO_FRAG_SRC,
  BRIGHT_PASS_FRAG_SRC,
  BLUR_FRAG_SRC,
  COMPOSITE_FRAG_SRC,
} from "./shaders.js";

const video = document.getElementById("cam");
const canvas = document.getElementById("fx");
const startBtn = document.getElementById("start");
const statusEl = document.getElementById("status");
const jutsuSelect = document.getElementById("jutsu");
const fxAsset = document.getElementById("fxAsset");

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

// --- Programs ---------------------------------------------------------
const sceneProgram = buildProgram(VERT_SRC, CHIDORI_FRAG_SRC);
const orbProgram = buildProgram(VERT_SRC, ORB_FRAG_SRC);
const susanooProgram = buildProgram(VERT_SRC, SUSANOO_FRAG_SRC);
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
  uOrbTex: gl.getUniformLocation(orbProgram, "uOrbTex"),
  uHandPos: gl.getUniformLocation(orbProgram, "uHandPos"),
  uHandScale: gl.getUniformLocation(orbProgram, "uHandScale"),
  uActive: gl.getUniformLocation(orbProgram, "uActive"),
  uOrbAspect: gl.getUniformLocation(orbProgram, "uOrbAspect"),
};
const susanooU = {
  uResolution: gl.getUniformLocation(susanooProgram, "uResolution"),
  uTime: gl.getUniformLocation(susanooProgram, "uTime"),
  uHandPos: gl.getUniformLocation(susanooProgram, "uHandPos"),
  uHandScale: gl.getUniformLocation(susanooProgram, "uHandScale"),
  uActive: gl.getUniformLocation(susanooProgram, "uActive"),
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
const orbTex = createVideoTexture();

// --- Framebuffers -------------------------------------------------------
function createFBO(w, h) {
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
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
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
  sceneFBO = createFBO(w, h);
  bloomFBOA = createFBO(bw, bh);
  bloomFBOB = createFBO(bw, bh);
}

let dpr = Math.min(window.devicePixelRatio || 1, 2);
let handPxTarget = { x: 0, y: 0, scale: 80, active: 0 };
let handPxSmoothed = { x: 0, y: 0, scale: 80, active: 0 };

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
let lastVideoTime = -1;

async function setupHandLandmarker() {
  setStatus("Loading hand model...");
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
  setStatus("Model ready. Hold a hand up.");
}

function detectLoop() {
  requestAnimationFrame(detectLoop);
  if (!landmarker || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
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

    handPxTarget = { x: centerPx.x, y: centerPx.y, scale: scalePx, active: 1 };
    setStatus("Tracking hand.");
  } else {
    handPxTarget.active = 0;
    setStatus("No hand detected.", "warn");
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

  // 1. Render the selected effect into sceneFBO.
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO.fbo);
  gl.viewport(0, 0, sceneFBO.w, sceneFBO.h);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  if (jutsuSelect.value === "rasengan") {
    if (fxAsset.readyState >= 2) {
      gl.bindTexture(gl.TEXTURE_2D, orbTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fxAsset);
    }
    gl.useProgram(orbProgram);
    bindQuad(orbProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, orbTex);
    gl.uniform1i(orbU.uOrbTex, 0);
    gl.uniform2f(orbU.uHandPos, handPxSmoothed.x, handPxSmoothed.y);
    gl.uniform1f(orbU.uHandScale, handPxSmoothed.scale);
    gl.uniform1f(orbU.uActive, handPxSmoothed.active);
    const aspect = fxAsset.videoWidth && fxAsset.videoHeight ? fxAsset.videoWidth / fxAsset.videoHeight : 1;
    gl.uniform1f(orbU.uOrbAspect, aspect);
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
  gl.drawArrays(gl.TRIANGLES, 0, 3);

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
  // visible canvas.
  if (video.readyState >= 2) {
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  const cp = coverParams();

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
  gl.uniform1f(compositeU.uBloomStrength, BLOOM_STRENGTH);
  gl.uniform2f(compositeU.uCanvasSize, canvas.width, canvas.height);
  gl.uniform2f(compositeU.uVideoOffset, cp.offX, cp.offY);
  gl.uniform2f(compositeU.uVideoExtent, cp.extentX, cp.extentY);
  gl.uniform2f(compositeU.uHandPos, handPxSmoothed.x, handPxSmoothed.y);
  gl.uniform1f(compositeU.uHandScale, handPxSmoothed.scale);
  gl.uniform1f(compositeU.uActive, handPxSmoothed.active);
  gl.uniform1f(compositeU.uTime, t);
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
    fxAsset.play().catch(() => {});
    resize();
    await setupHandLandmarker();
    detectLoop();
    requestAnimationFrame(renderLoop);
  } catch (err) {
    setStatus("Error: " + err.message, "err");
    startBtn.disabled = false;
  }
});

resize();
