export const VERT_SRC = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Chidori: crackling electric aura anchored to the hand. Rendered with
// mix-blend-mode: screen over the video, so black == "no effect here".
export const CHIDORI_FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uHandPos;   // pixels, GL (bottom-left origin)
uniform float uHandScale; // px radius of the hand bbox
uniform float uActive;    // 0..1 fade for hand presence

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return v;
}

// Real lightning doesn't glide smoothly between shapes, it snaps between
// discrete configurations. Quantizing time into fixed steps per bolt is
// what sells the "electric" read instead of a wobbling blob.
float stepTime(float t, float rate) {
  return floor(t * rate) / rate;
}

float hash1(float n) {
  return fract(sin(n) * 43758.5453123);
}

// Distance-to-a-single-jagged-bolt field. The bolt is a ray from the hand
// center out along dir, displaced sideways by 1D noise that grows from
// the base and tapers at the tip - the midpoint-displacement look of real
// lightning, evaluated analytically instead of walking a polyline.
float boltMask(vec2 p, float angle0, float len, float amp, float seed, float thickness) {
  vec2 dir = vec2(cos(angle0), sin(angle0));
  vec2 perpDir = vec2(-dir.y, dir.x);
  float s = dot(p, dir);
  float perp = dot(p, perpDir);
  if (s < 0.0 || s > len) return 0.0;
  float sn = s / len;

  float wobble = (noise(vec2(s * 5.5 + seed * 17.0, seed)) - 0.5) * 2.0
               + (noise(vec2(s * 14.0 + seed * 31.0, seed + 5.0)) - 0.5) * 0.6;
  float lateral = wobble * amp * smoothstep(0.0, 0.25, sn);

  float dist = abs(perp - lateral);
  float core = exp(-dist * dist / (thickness * thickness));
  float glow = exp(-dist * dist / (thickness * thickness * 10.0)) * 0.35;

  float baseFade = smoothstep(0.0, 0.06, sn);
  float tipFade = smoothstep(1.0, 0.7, sn);
  return (core + glow) * baseFade * tipFade;
}

void main() {
  vec2 p = (gl_FragCoord.xy - uHandPos) / max(uHandScale, 1.0);
  float d = length(p);
  float t = uTime;

  float bolts = 0.0;
  const int BOLT_COUNT = 9;
  for (int i = 0; i < BOLT_COUNT; i++) {
    float fi = float(i);
    // Each bolt flickers (re-jitters angle/length) on its own cadence so
    // they don't all snap in sync.
    float rate = mix(5.0, 11.0, hash1(fi * 3.1 + 0.4));
    float seedT = stepTime(t, rate) + fi * 101.7;

    float baseAngle = fi * (6.2831 / float(BOLT_COUNT));
    float angle0 = baseAngle + (hash1(seedT) - 0.5) * 1.1;
    float len = mix(1.3, 2.6, hash1(seedT * 1.37 + fi));
    float amp = mix(0.22, 0.5, hash1(seedT * 2.11 + fi));

    bolts += boltMask(p, angle0, len, amp, seedT + fi * 7.0, 0.045);
  }
  bolts = clamp(bolts, 0.0, 1.6);

  // Tight ambient halo right at the hand only - a wide soft wash is what
  // reads as a "filter", so keep this small and let the bolts carry the
  // rest of the silhouette.
  float haloCore = exp(-d * d * 22.0);
  float haloSoft = exp(-d * d * 5.0) * 0.18;
  float flicker = 0.88 + 0.12 * noise(vec2(t * 26.0, 0.0));

  float intensity = (bolts + haloCore * 2.4 + haloSoft) * flicker;
  intensity *= uActive;

  vec3 white = vec3(0.96, 0.99, 1.0);
  vec3 cyan = vec3(0.4, 0.82, 1.0);
  vec3 deepBlue = vec3(0.1, 0.32, 0.9);

  vec3 color = mix(deepBlue, cyan, clamp(bolts * 1.6, 0.0, 1.0));
  color = mix(color, white, clamp(haloCore * 2.0 + bolts * 0.4, 0.0, 1.0));
  color *= intensity;

  // Alpha here means "occlusion" in the composite pass, not opacity - the
  // bolts are a pure additive glow on top of the video, never blocking it.
  fragColor = vec4(color, 0.0);
}
`;

// Rasengan: samples a pre-rendered swirling-orb video (center-cropped to a
// square) into a soft-edged circle anchored on the hand. Pre-rendered
// footage carries texture/detail that's hard to fake procedurally.
export const ORB_FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D uOrbTex;
uniform vec2 uHandPos;    // bottom-origin GL px
uniform float uHandScale; // px radius of the hand bbox
uniform float uActive;
uniform float uOrbAspect; // video width / height, for center-crop to square

out vec4 fragColor;

void main() {
  vec2 p = (gl_FragCoord.xy - uHandPos) / (uHandScale * 1.3);
  float d = length(p);
  if (d > 1.05) {
    fragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  vec2 uv = vec2(0.5 + p.x * 0.5 / uOrbAspect, 0.5 - p.y * 0.5);
  vec3 color = texture(uOrbTex, clamp(uv, 0.0, 1.0)).rgb;

  // The source clip is overexposed (blows out to flat white). Tame it with
  // a tonemap and push the balance back toward blue so it doesn't read as
  // a white blob.
  color *= 0.5;
  color = color / (1.0 + color);
  color.r *= 0.82;
  color.g *= 0.92;

  float edge = smoothstep(1.05, 0.8, d);
  float occlusion = edge * uActive; // the orb is solid: it blocks the video behind it
  color *= occlusion;

  fragColor = vec4(color, occlusion);
}
`;

// Susanoo: a giant translucent ribcage/spine figure built from SDF line
// segments (same "distance field over a few primitives" trick as chidori's
// boltMask), looming far larger than the hand-anchored effects. No pose
// model is available in this lab, so it anchors off the single tracked hand
// and treats that point as roughly chest height, scaling way up from there -
// see the main.js comment next to the susanoo branch for the reasoning.
// Alpha is forced to 0 everywhere (same "pure additive glow" contract as
// chidori) so the camera feed is NEVER occluded - this is the whole point:
// the person must stay clearly visible "inside" the ribcage, not hidden
// behind a sprite. Keep per-line brightness modest so it reads as a ghostly
// energy outline, not a solid cutout.
export const SUSANOO_FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uHandPos;    // pixels, GL (bottom-left origin) - treated as chest anchor
uniform float uHandScale; // px radius of the hand bbox
uniform float uActive;    // 0..1 fade for hand presence

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// Distance from p to the segment a-b - the one primitive the whole figure
// (spine, ribs, skull, arms) is built out of.
float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float lineMask(vec2 p, vec2 a, vec2 b, float thickness) {
  float d = sdSegment(p, a, b);
  float core = exp(-d * d / (thickness * thickness));
  float glow = exp(-d * d / (thickness * thickness * 14.0)) * 0.3;
  return core + glow;
}

float circleMask(vec2 p, vec2 c, float r, float thickness) {
  float d = abs(length(p - c) - r);
  return exp(-d * d / (thickness * thickness));
}

void main() {
  // Local space: chest-anchored, scaled WAY beyond the hand radius so the
  // figure looms over the whole body rather than sitting in the palm.
  const float BODY_SCALE = 9.0;
  vec2 p = (gl_FragCoord.xy - uHandPos) / max(uHandScale * BODY_SCALE, 1.0);
  float t = uTime;

  float lines = 0.0;

  // Spine, running from the skull base down past the bottom of the frame.
  lines += lineMask(p, vec2(0.0, 2.05), vec2(0.0, -3.0), 0.025);

  // Skull: a rough ribcage-topping skull outline (circle + jaw V).
  vec2 skullC = vec2(0.0, 2.55);
  lines += circleMask(p, skullC, 0.42, 0.03) * 0.9;
  lines += lineMask(p, skullC + vec2(0.0, -0.3), skullC + vec2(-0.22, -0.62), 0.028);
  lines += lineMask(p, skullC + vec2(0.0, -0.3), skullC + vec2(0.22, -0.62), 0.028);
  // Horn-like crest, echoing Susanoo's helmet silhouette.
  lines += lineMask(p, skullC + vec2(-0.2, 0.28), skullC + vec2(-0.55, 0.85), 0.022);
  lines += lineMask(p, skullC + vec2(0.2, 0.28), skullC + vec2(0.55, 0.85), 0.022);

  // Ribcage: a handful of paired bracket-shaped ribs bowing out from the
  // spine then back in toward a sternum line, stacked top to bottom.
  const int RIB_COUNT = 6;
  for (int i = 0; i < RIB_COUNT; i++) {
    float fi = float(i);
    float frac = fi / float(RIB_COUNT - 1); // 0 at top rib, 1 at bottom rib
    float yTop = mix(1.55, -0.95, frac);
    float yBot = yTop - mix(0.18, 0.34, frac);
    float outX = mix(0.55, 1.35, sin(frac * 3.14159)); // widest around the middle
    float inX = 0.12;

    // Left side.
    lines += lineMask(p, vec2(0.0, yTop), vec2(-outX, yTop - 0.12), 0.02);
    lines += lineMask(p, vec2(-outX, yTop - 0.12), vec2(-inX, yBot), 0.02);
    // Right side (mirrored).
    lines += lineMask(p, vec2(0.0, yTop), vec2(outX, yTop - 0.12), 0.02);
    lines += lineMask(p, vec2(outX, yTop - 0.12), vec2(inX, yBot), 0.02);
  }

  // Wide, bent arms looming outward - the classic Susanoo wide-armed pose.
  vec2 shoulderL = vec2(-0.62, 1.45);
  vec2 shoulderR = vec2(0.62, 1.45);
  vec2 elbowL = vec2(-2.1, 0.55);
  vec2 elbowR = vec2(2.1, 0.55);
  vec2 handL = vec2(-1.75, -0.75);
  vec2 handR = vec2(1.75, -0.75);
  lines += lineMask(p, shoulderL, elbowL, 0.03);
  lines += lineMask(p, elbowL, handL, 0.03);
  lines += lineMask(p, shoulderR, elbowR, 0.03);
  lines += lineMask(p, elbowR, handR, 0.03);

  lines = clamp(lines, 0.0, 1.8);

  // Faint overall chest-cavity fill so the ribcage reads as an enclosing
  // volume, not just outlines - kept very weak so it never looks solid.
  float torsoFill = exp(-dot(p - vec2(0.0, 0.5), p - vec2(0.0, 0.5)) * 0.35) * 0.08;

  float flicker = 0.9 + 0.1 * noise(vec2(t * 3.0, p.y * 2.0));
  float intensity = (lines + torsoFill) * flicker * uActive;

  vec3 purple = vec3(0.5, 0.22, 0.95);
  vec3 cyan = vec3(0.35, 0.78, 1.0);
  vec3 white = vec3(0.9, 0.95, 1.0);

  vec3 color = mix(purple, cyan, clamp(p.y * 0.3 + 0.5, 0.0, 1.0));
  color = mix(color, white, clamp(lines * 0.5, 0.0, 1.0));
  // Deliberately dim - this is meant to be a translucent ghost overlay, not
  // a bright solid figure; the person standing "inside" it must stay readable.
  color *= intensity * 0.55;

  // Alpha forced to 0: pure additive glow, camera is never occluded. This
  // is what satisfies the "must see myself inside the Susanoo" requirement.
  fragColor = vec4(color, 0.0);
}
`;

// Extracts the bright parts of the scene texture for blurring.
export const BRIGHT_PASS_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform float uThreshold;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float lum = max(c.r, max(c.g, c.b));
  float w = smoothstep(uThreshold, uThreshold + 0.25, lum);
  fragColor = vec4(c * w, 1.0);
}
`;

// Separable gaussian blur, one direction per draw call.
export const BLUR_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexelStep;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float weights[5];
  weights[0] = 0.227027;
  weights[1] = 0.1945946;
  weights[2] = 0.1216216;
  weights[3] = 0.054054;
  weights[4] = 0.016216;
  vec3 result = texture(uTex, vUv).rgb * weights[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uTexelStep * float(i);
    result += texture(uTex, vUv + off).rgb * weights[i];
    result += texture(uTex, vUv - off).rgb * weights[i];
  }
  fragColor = vec4(result, 1.0);
}
`;

// Composites bolts + bloom over the LIVE VIDEO, sampled with a heat-shimmer
// warp and chromatic aberration near the hand so the effect reads as
// something distorting the air in the scene, not a sticker laid on top.
export const COMPOSITE_FRAG_SRC = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uVideo;
uniform float uBloomStrength;
uniform vec2 uCanvasSize;
uniform vec2 uVideoOffset; // top-origin px, where the cover-fit video starts
uniform vec2 uVideoExtent; // top-origin px, cover-fit video width/height
uniform vec2 uHandPos;     // bottom-origin GL px (matches the scene pass)
uniform float uHandScale;
uniform float uActive;
uniform float uTime;
in vec2 vUv;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

vec3 sampleVideo(vec2 fragPx) {
  vec2 topOrigin = vec2(fragPx.x, uCanvasSize.y - fragPx.y);
  vec2 frac = (topOrigin - uVideoOffset) / uVideoExtent;
  vec2 uv = vec2(1.0 - frac.x, 1.0 - frac.y); // mirror selfie-style, flip Y
  return texture(uVideo, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
  vec2 fragPx = gl_FragCoord.xy;
  vec2 p = (fragPx - uHandPos) / max(uHandScale, 1.0);
  float d = length(p);

  // Heat-shimmer: push video sample positions outward/sideways near the
  // hand, strongest close in, faded out by ~2.5 hand-radii.
  float warpFalloff = exp(-d * d * 0.9) * uActive;
  float n1 = noise(p * 2.2 + uTime * 1.6) - 0.5;
  float n2 = noise(p * 2.2 + 11.0 - uTime * 1.3) - 0.5;
  vec2 warp = vec2(n1, n2) * warpFalloff * 10.0; // px, scaled below by hand size

  vec2 warpPx = warp * (uHandScale / 90.0);
  float ab = warpFalloff * 2.5; // chromatic aberration spread, px

  vec3 video;
  video.r = sampleVideo(fragPx + warpPx + vec2(ab, 0.0)).r;
  video.g = sampleVideo(fragPx + warpPx).g;
  video.b = sampleVideo(fragPx + warpPx - vec2(ab, 0.0)).b;

  // Slightly darken the video right around the hand so the bolts pop with
  // more contrast, like the anime's darkened backdrop around the jutsu.
  video *= mix(1.0, 0.55, exp(-d * d * 3.0) * uActive);

  vec4 scene = texture(uScene, vUv);
  vec3 bloom = texture(uBloom, vUv).rgb;

  // scene.a is occlusion, not opacity: 0 means "pure glow on top of video"
  // (chidori bolts), >0 means "this pixel is solid effect, hide the video
  // behind it" (rasengan's orb surface).
  vec3 color = video * (1.0 - scene.a) + scene.rgb + bloom * uBloomStrength;
  fragColor = vec4(color, 1.0);
}
`;

// Fullscreen-triangle vertex shader that also emits a 0..1 UV, used by the
// bloom passes (the main chidori pass only needs clip-space position).
export const VERT_UV_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;
