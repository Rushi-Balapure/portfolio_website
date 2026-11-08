import { createBlend, currentTheme, watchTheme } from './gl/themeGl';
import { themeById, type PlanetTheme } from '../data/themes';
import { attrib, createFullscreenTriangle, createProgram, createRenderer, getGL, prefersReducedMotion, type GL, type Program } from './gl/gl';

const VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Analytic planet "uber-shader": ray-sphere on a quad. Four worlds (Pandora, HD 189733 b, 55 Cancri e, GJ 504 b) each have a
// surface function; per-world weights (uW) blend them, and a weight of ~0 skips that world's noise entirely.
const WORLDS = ['biolum-ocean', 'cobalt-giant', 'lava-world', 'magenta-giant'] as const;
const DEFAULT_RING = [0.70, 0.52, 0.64];
const themeVec = (t: PlanetTheme) => {
  const g = t.gl, w = [0, 0, 0, 0]; w[WORLDS.indexOf(g.world)] = 1;
  return [...g.surfaceA, ...g.surfaceB, ...g.highlight, ...g.emissive, ...g.atmosphere, ...(g.ring ?? DEFAULT_RING), g.ring ? 1 : 0, ...w];
};
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uRot, uPx, uR, uOct, uDrift, uTime, uRing;
uniform vec3 uN, uL, uA, uB, uH, uE, uAtm, uRC;
uniform vec4 uW;   // world weights: pandora, cobalt, lava, magenta

vec3 gO, gOc, gLo, gLoc, gNv;
float gD, gZs, gCd;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// LOD-aware fbm: n octaves requested, capped by uOct; the last octave fades in so detail never pops.
float fbmn(vec3 p, float n) {
  float m = min(n, uOct), v = 0.0, a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) {
    float w = clamp(m - float(i), 0.0, 1.0);
    if (w <= 0.0) break;
    v += a * w * noise(p); s += a * w;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5;
  }
  return v - 0.5 * s + 0.5;
}
float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
float wrapd(float d, float w) { return clamp((d + w) / (1.0 + w), 0.0, 1.0); }
vec3 lin(vec3 c) { return c * c; }
vec3 tone(vec3 c) { vec3 x = max(c - 0.7, 0.0); return min(c, vec3(0.7)) + 0.3 * (1.0 - exp(-x / 0.3)); }
vec3 enc(vec3 c) { return pow(max(tone(c), 0.0), vec3(0.4545)); }

// ---------- ring ----------
float ringDens(float rad) {
  float inside = smoothstep(1.22, 1.245, rad) * (1.0 - smoothstep(1.465, 1.49, rad));
  float hiK = smoothstep(120.0, 300.0, uR);
  float fine = 0.5 * noise(vec3(rad * 150.0, 1.3, 2.7)) * hiK + 0.5 * noise(vec3(rad * 43.0, 7.1, 3.3)) + (1.0 - hiK) * 0.25;
  float bands = 0.22 + 0.95 * smoothstep(0.18, 0.8, fine);
  float gap = 1.0 - 0.85 * (1.0 - smoothstep(0.0, 0.012, abs(rad - 1.335)));
  gap *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.006, abs(rad - 1.415)));
  float edge = 0.55 + 0.45 * smoothstep(1.22, 1.30, rad);
  return inside * bands * gap * edge;
}

// ---------- shared pieces ----------
float craters(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float on = step(0.5, hash(i));
  vec3 c = vec3(0.32 + 0.36 * hash(i + 1.7), 0.32 + 0.36 * hash(i + 5.3), 0.32 + 0.36 * hash(i + 9.1));
  float r = 0.10 + 0.16 * hash(i + 3.9);
  float d = length(f - c) / r;
  float bowl = 1.0 - smoothstep(0.0, 1.0, d);
  float rim = smoothstep(0.75, 1.0, d) * (1.0 - smoothstep(1.0, 1.3, d));
  return on * (rim * 0.8 - bowl * 0.55);
}

// =====================================================================
// 1. PANDORA: ocean world with clouds and bioluminescent night side
// =====================================================================
float cloudDens(vec3 c, float nOct) {
  // one slow cyclone: twist the sampling coordinates around a fixed axis so the clouds spiral
  vec3 cc = normalize(vec3(-0.46, 0.50, 0.73));
  vec3 e1 = normalize(cross(vec3(0.0, 1.0, 0.0), cc)), e2 = cross(cc, e1);
  vec2 cp = vec2(dot(c, e1), dot(c, e2)) / 0.34;
  float cr = length(cp);
  float tw = (1.0 - smoothstep(0.0, 1.3, cr)) * 4.0 * step(0.0, dot(c, cc));
  float cs = cos(tw), sn = sin(tw);
  c += e1 * ((cs * cp.x - sn * cp.y) - cp.x) * 0.34 + e2 * ((sn * cp.x + cs * cp.y) - cp.y) * 0.34;
  vec3 sw = vec3(fbmn(c * 1.5 + vec3(5.2, 1.3, 8.8), 3.0), fbmn(c * 1.5 + vec3(2.2, 7.3, 1.8), 3.0), fbmn(c * 1.5 + vec3(9.1, 3.3, 4.8), 3.0)) - 0.5;
  float latw = c.y + 0.14 * sw.x;
  float band = 0.5 + 0.5 * sin(latw * 13.0 + sw.y * 5.0);
  float band2 = 0.5 + 0.5 * sin(latw * 31.0 + sw.z * 8.0);
  float cd = fbmn(c * vec3(3.0, 4.2, 3.0) + sw * 3.2, nOct);
  float dens = cd * 0.70 + band * 0.30 + band2 * 0.10 - 0.07;
  gCd = smoothstep(0.62, 0.80, dens);
  return smoothstep(0.50, 0.64, dens);
}

vec3 wPandora() {
  vec3 n = gNv, o = gO;
  float d = gD, zs = gZs;
  vec3 p = o * 1.55 + vec3(3.7, 1.1, 6.2);
  vec3 q = p + 1.15 * (vec3(fbmn(p * 0.9 + vec3(1.7, 9.2, 3.1), 3.0), fbmn(p * 0.9 + vec3(8.3, 2.8, 5.1), 3.0), fbmn(p * 0.9 + vec3(4.1, 6.6, 7.7), 3.0)) - 0.5);
  float h = fbmn(q * 1.25, 6.0);
  float isl = fbmn(p * 3.3 + 9.0, 4.0);
  h += 0.22 * smoothstep(0.56, 0.70, isl) * smoothstep(0.30, 0.46, h);
  float land = smoothstep(0.530, 0.540, h);
  float shore = 1.0 - smoothstep(0.540, 0.585, h);
  float mott = fbmn(p * 7.0 + 3.0, 4.0);

  // ocean: deep teal, lighter shallows near coasts
  float depth = smoothstep(0.18, 0.52, h);
  vec3 ocean = mix(uA * vec3(0.45, 0.55, 0.65), uA * vec3(1.15, 1.35, 1.25), depth);
  float shal = smoothstep(0.455, 0.53, h);
  ocean = mix(ocean, vec3(0.05, 0.50, 0.50) + uA * 0.4, shal * 0.85);
  ocean *= 0.80 + 0.40 * fbmn(p * 2.2 + 30.0, 3.0);
  ocean += (fbmn(p * 12.0, 3.0) - 0.5) * 0.04;
  // land: lush green, darker jungle mottling, lighter coast, paler highlands
  vec3 jungle = mix(uB * vec3(0.42, 0.50, 0.50), uB * vec3(1.25, 1.35, 1.0) + vec3(0.0, 0.05, 0.0), smoothstep(0.32, 0.68, mott));
  jungle = mix(jungle, vec3(0.30, 0.52, 0.30), shore * 0.55);
  jungle = mix(jungle, vec3(0.30, 0.44, 0.40), smoothstep(0.66, 0.80, h) * 0.5);
  vec3 surf = mix(ocean, jungle, land);

  // clouds (faster drift than surface) and their soft shadows
  float cloud = cloudDens(gOc, 6.0);
  float cloudA = cloud * (0.50 + 0.45 * gCd);
  float cdet = gCd;
  float lit0 = smoothstep(-0.05, 0.3, d);
  float cshadow = 0.0;
  if (lit0 > 0.01 && uOct > 3.5) cshadow = cloudDens(gOc + gLoc * 0.05, 4.0);
  surf *= 1.0 - cshadow * 0.5 * (1.0 - cloud);

  float wr = wrapd(d, 0.10);
  float day = smoothstep(-0.30, 0.55, d);
  vec3 ambL = lin(uAtm) * 0.020 + vec3(0.002, 0.004, 0.006);
  vec3 col = lin(surf) * (ambL + vec3(1.0, 0.98, 0.94) * wr * 1.10);
  // twilight band
  col += lin(uAtm) * smoothstep(-0.04, 0.05, d) * (1.0 - smoothstep(0.05, 0.28, d)) * 0.07 * (1.0 - cloud);
  // sun glint on the sea
  vec3 H = normalize(normalize(uL) + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(n, H), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - zs, 5.0);
  float glint = (pow(nh, 160.0) * 1.9 + pow(nh, 24.0) * 0.20) * (1.0 - land) * (1.0 - cloud) * (0.4 + fres) * smoothstep(0.0, 0.2, d);
  col += vec3(1.0, 0.97, 0.88) * glint;
  // cloud layer
  vec3 cl = lin(uH) * (0.05 + 1.10 * wrapd(d, 0.22)) * (0.50 + 0.55 * cdet);
  cl = mix(cl * vec3(0.78, 0.9, 1.05), cl, smoothstep(0.0, 0.5, d));
  cl += lin(uAtm) * 0.015;
  col = mix(col, cl, cloud * (0.50 + 0.45 * cdet));

  // Rayleigh-like limb glow: cyan-blue, brighter on the day limb
  float lm = 1.0 - zs;
  vec3 at = lin(uAtm);
  col += at * (pow(lm, 2.2) * 0.85 + pow(lm, 6.0) * 0.9) * (0.05 + 0.95 * day);
  col = mix(col, at * (0.10 + 0.5 * day), pow(lm, 1.3) * 0.16 * (0.3 + day));

  // bioluminescence on the night side
  float nightF = 1.0 - smoothstep(-0.10, 0.36, d);
  if (nightF > 0.004 && uOct > 2.5) {
    float coast = exp(-abs(h - 0.535) * 26.0);
    float forest = land * smoothstep(0.28, 0.70, mott) * (0.55 + 0.45 * smoothstep(0.545, 0.62, h));
    vec3 pb = q * 3.1 + 11.0;
    float r1 = 1.0 - abs(2.0 * fbmn(pb, 4.0) - 1.0);
    float fil = smoothstep(0.945, 0.992, r1);
    float fil2 = 0.0;
    if (uOct > 3.8) { float r2 = 1.0 - abs(2.0 * fbmn(q * 8.0 + 4.0, 3.0) - 1.0); fil2 = smoothstep(0.95, 0.992, r2); }
    float net = fil * (0.04 + 0.9 * forest + 0.55 * coast) + fil2 * (0.8 * forest + 0.3 * coast);
    // speckles
    vec3 sp1 = p * 26.0; vec3 ci = floor(sp1), cf = fract(sp1);
    vec3 cen = vec3(hash(ci + 1.3), hash(ci + 7.7), hash(ci + 4.1)) * 0.6 + 0.2;
    float spot = smoothstep(0.26, 0.0, length(cf - cen)) * step(0.52, hash(ci + 2.9));
    float spots = spot * (0.9 * forest + 0.5 * coast + 0.05);
    if (uOct > 4.6) {
      vec3 sp2 = p * 58.0; vec3 cj = floor(sp2), cg = fract(sp2);
      vec3 cen2 = vec3(hash(cj + 6.3), hash(cj + 2.7), hash(cj + 8.1)) * 0.6 + 0.2;
      spots += 0.8 * smoothstep(0.16, 0.0, length(cg - cen2)) * step(0.70, hash(cj + 5.9)) * (forest + 0.35 * coast);
    }
    float viol = smoothstep(0.60, 0.76, fbmn(p * 2.2 + 17.0, 3.0));
    vec3 bc = mix(lin(uE), lin(vec3(0.62, 0.34, 1.0)), viol * 0.85);
    float pulse = 0.84 + 0.16 * sin(uTime * 0.55 + hash(ci) * 6.28 + h * 9.0);
    float plank = coast * (1.0 - land) * 0.06 * (0.6 + 0.4 * sin(uTime * 0.4 + h * 30.0));
    vec3 bio = bc * (net * 0.85 + spots * 2.0 + plank + forest * 0.04) * pulse * 1.3;
    col += bio * nightF * (1.0 - cloudA * 0.75);
  }
  return col;
}

// =====================================================================
// 2. HD 189733 b: cobalt hot Jupiter
// =====================================================================
vec3 wCobalt() {
  vec3 n = gNv, o = gO;
  float d = gD, zs = gZs;
  // two vortex storms (twist the sampling coordinates so the bands spiral)
  vec3 s1 = normalize(vec3(0.74, -0.34, 0.58));
  vec3 e1 = normalize(cross(vec3(0.0, 1.0, 0.0), s1)), e2 = cross(s1, e1);
  vec2 sp = vec2(dot(o, e1) / 0.40, dot(o, e2) / 0.24);
  float sr = length(sp);
  float tw = (1.0 - smoothstep(0.0, 1.25, sr)) * 5.2 * step(0.0, dot(o, s1));
  float ca = cos(tw), sa = sin(tw);
  vec2 sp2 = vec2(ca * sp.x - sa * sp.y, sa * sp.x + ca * sp.y);
  vec3 oo = o + e1 * (sp2.x - sp.x) * 0.40 + e2 * (sp2.y - sp.y) * 0.24;
  vec3 s2 = normalize(vec3(-0.35, 0.40, 0.84));
  vec3 f1 = normalize(cross(vec3(0.0, 1.0, 0.0), s2)), f2 = cross(s2, f1);
  vec2 tp = vec2(dot(oo, f1) / 0.20, dot(oo, f2) / 0.13);
  float tr = length(tp);
  float tw2 = (1.0 - smoothstep(0.0, 1.3, tr)) * -4.5 * step(0.0, dot(o, s2));
  float c2 = cos(tw2), s2n = sin(tw2);
  vec2 tp2 = vec2(c2 * tp.x - s2n * tp.y, s2n * tp.x + c2 * tp.y);
  oo += f1 * (tp2.x - tp.x) * 0.20 + f2 * (tp2.y - tp.y) * 0.13;

  float w1 = fbmn(oo * vec3(2.2, 5.0, 2.2) + vec3(2.3, 7.7, 1.1), 4.0);
  float jets = 0.55 + 0.9 * abs(sin(oo.y * 17.0 + 0.6));        // edges of the strongest jets are the most sheared
  float w2 = fbmn(oo * vec3(5.5, 12.0, 5.5) + vec3(3.1, 1.7, 8.2) + w1 * 2.2, 5.0);
  float latw = oo.y + 0.045 * jets * (w1 - 0.5) + 0.020 * jets * (w2 - 0.5);
  float b = 0.5 + 0.5 * (0.50 * sin(latw * 17.0 + 0.6) + 0.28 * sin(latw * 41.0 + 2.1) + 0.14 * sin(latw * 93.0 + 4.3) + 0.08 * sin(latw * 150.0 + 1.1)) / 0.88;
  float streak = fbmn(vec3(oo.x * 3.2, latw * 78.0, oo.z * 3.2) + vec3(4.4, 0.0, 2.0), 5.0);
  float v = clamp(mix(b, streak, 0.34) + (w2 - 0.5) * 0.25, 0.0, 1.0);
  vec3 c = mix(uA * 0.75, uB, smoothstep(0.18, 0.62, v));
  c = mix(c, uH * 0.85, smoothstep(0.60, 0.95, v) * 0.55);
  // storm colouring: dark core, bright rim, spiral arms
  float m1 = 1.0 - smoothstep(0.55, 1.0, sr);
  float arm1 = 0.5 + 0.5 * sin(atan(sp.y, sp.x) * 2.0 - sr * 14.0 + 1.5);
  float rim1 = smoothstep(0.62, 0.92, sr) * (1.0 - smoothstep(0.92, 1.15, sr));
  c = mix(c, mix(uA * 0.42, uB * 0.9, arm1 * 0.55), m1 * 0.75);
  c = mix(c, uH * 0.95, rim1 * 0.45 * step(0.0, dot(o, s1)));
  float m2 = 1.0 - smoothstep(0.5, 1.0, tr);
  float arm2 = 0.5 + 0.5 * sin(atan(tp.y, tp.x) * 2.0 + tr * 12.0);
  c = mix(c, mix(uB, uH, 0.35 + 0.5 * arm2), m2 * 0.7 * step(0.0, dot(o, s2)));

  // tidally locked: bright, slightly washed day side; very dark night side
  float wr = wrapd(d, 0.30);
  float day = smoothstep(-0.25, 0.55, d);
  vec3 col = lin(c) * (0.010 + 1.25 * wr);
  col = mix(col, lin(uH) * 0.55 * wr, 0.14 * day);
  // glassy highlight
  vec3 H = normalize(normalize(uL) + vec3(0.0, 0.0, 1.0));
  col += lin(uAtm) * pow(max(dot(n, H), 0.0), 50.0) * 0.22 * day;
  // faint deep-red thermal glow on the night side
  float nightF = 1.0 - smoothstep(-0.10, 0.34, d);
  vec3 therm = lin(uE) * vec3(1.0, 0.9, 0.9) * 2.6 * (0.55 + 0.9 * (1.0 - v) + 0.5 * (streak - 0.5));
  col += therm * nightF;
  // silicate haze + strong blue rim scattering
  float lm = 1.0 - zs;
  vec3 at = lin(uAtm);
  col = mix(col, at * (0.30 + 0.85 * day), pow(lm, 1.6) * 0.62 * (0.25 + 0.75 * day));
  col += at * pow(lm, 3.2) * 1.5 * (0.18 + 0.82 * day);
  col += mix(at, vec3(0.8, 0.9, 1.0), 0.6) * pow(lm, 8.0) * 1.2 * (0.25 + 0.75 * day);
  return col;
}

// =====================================================================
// 3. 55 Cancri e: lava super-Earth
// =====================================================================
vec3 wLava() {
  vec3 n = gNv, o = gO;
  float d = gD, zs = gZs;
  vec3 p = o * 2.0 + vec3(5.1, 2.3, 7.9);
  float cr = fbmn(p * 2.6, 5.0);
  float fine = fbmn(p * 15.0, 3.0);
  float cH = craters(p * 5.0) + 0.6 * craters(p * 11.0 + 3.0);
  vec3 crust = mix(uA, uB, smoothstep(0.36, 0.68, cr)) * (0.70 + 0.55 * fine) * (1.0 + 0.55 * cH);

  float tm = uTime * 0.35;
  vec3 pw = p + 0.65 * (vec3(fbmn(p * 1.3 + vec3(1.7, 9.2, 3.1), 3.0), fbmn(p * 1.3 + vec3(8.3, 2.8, 5.1), 3.0), fbmn(p * 1.3 + vec3(4.1, 6.6, 7.7), 3.0)) - 0.5);
  pw += 0.012 * sin(vec3(tm * 1.7, tm * 1.3, tm * 2.1) + pw.yzx * 7.0);   // heat shimmer
  float rid = 1.0 - abs(2.0 * fbmn(pw * 1.7, 5.0) - 1.0);
  float major = smoothstep(0.935, 0.988, rid);
  float halo = smoothstep(0.86, 0.97, rid);
  float fis2 = 0.0;
  if (uOct > 3.3) { float r2 = 1.0 - abs(2.0 * fbmn(pw * 4.8 + 7.0, 4.0) - 1.0); fis2 = smoothstep(0.965, 0.995, r2) * 0.55; }
  float fis = max(major, fis2);

  // offset hot spot: the substellar point rotated ~40 degrees around the view's vertical axis
  float hc = 0.76, hs_ = 0.65;
  vec3 hdir = normalize(vec3(normalize(uL).x * hc + normalize(uL).z * hs_, normalize(uL).y, -normalize(uL).x * hs_ + normalize(uL).z * hc));
  float hm = dot(n, hdir);
  float sea = smoothstep(0.74, 0.97, hm + (fbmn(p * 2.4 + 3.0, 5.0) - 0.5) * 0.45);
  float plates = smoothstep(0.50, 0.63, fbmn(pw * 3.1 + 1.0, 5.0));
  float seaE = sea * (1.0 - plates * 0.82);
  float temp = smoothstep(0.2, 1.0, sea * (1.0 - plates * 0.5) + 0.1 * (fbmn(p * 6.0, 3.0) - 0.5));

  float wr = wrapd(d, 0.05);
  float dayK = smoothstep(-0.05, 0.4, d);
  vec3 col = lin(crust * 1.3) * (0.015 + 0.50 * wr);
  col += lin(uE) * smoothstep(0.4, 0.95, hm) * 0.03 * (1.0 - fis);   // crust glowing dully near the hot spot

  float shim = 1.0 + 0.06 * sin(uTime * 2.6 + fbmn(p * 5.0, 2.0) * 18.0);
  float fk = mix(1.45, 0.95, dayK);                     // fissures strongest at night
  vec3 em = lin(uE) * (fis * 1.25 + halo * 0.07) * fk;
  em += lin(mix(uE, uH, 0.4)) * fis * fis * 0.6 * fk;
  vec3 lavaC = mix(lin(uE) * 1.0, lin(vec3(1.0, 0.74, 0.32)) * 1.6, smoothstep(0.55, 1.0, temp));
  em += lavaC * seaE * 0.85 + lin(uE) * 0.45 * sea * plates * (fis + halo * 0.5);
  col += em * shim;

  // thin orange heat-haze limb
  float lm = 1.0 - zs;
  vec3 at = lin(uAtm);
  col += at * (pow(lm, 3.6) * 0.8 + pow(lm, 9.0) * 1.1) * (0.38 + 0.8 * dayK);
  return col;
}

// =====================================================================
// 4. GJ 504 b: dull magenta young giant
// =====================================================================
vec3 wMagenta() {
  vec3 n = gNv, o = gO;
  float d = gD, zs = gZs;
  float w1 = fbmn(o * vec3(1.6, 3.4, 1.6) + vec3(6.1, 2.2, 4.4), 4.0);
  float w2 = fbmn(o * vec3(4.0, 9.0, 4.0) + w1 * 1.6 + 5.0, 5.0);
  float latw = o.y + 0.055 * (w1 - 0.5) + 0.020 * (w2 - 0.5);
  float b = 0.5 + 0.5 * (0.62 * sin(latw * 9.0 + 0.4) + 0.28 * sin(latw * 19.0 + 1.9) + 0.10 * sin(latw * 33.0 + 0.3));
  b = smoothstep(0.12, 0.88, b);
  float streak = fbmn(vec3(o.x * 2.0, latw * 36.0, o.z * 2.0) + 3.7, 4.0);
  float v = clamp(mix(b, streak, 0.34) + (w2 - 0.5) * 0.26 + 0.05 * sin(latw * 63.0 + w2 * 6.0), 0.0, 1.0);
  // soft oval storm
  vec3 s1 = normalize(vec3(0.55, 0.30, 0.78));
  vec3 e1 = normalize(cross(vec3(0.0, 1.0, 0.0), s1)), e2 = cross(s1, e1);
  float sr = length(vec2(dot(o, e1) / 0.20, dot(o, e2) / 0.12));
  float st = (1.0 - smoothstep(0.4, 1.0, sr)) * step(0.0, dot(o, s1));
  vec3 c = mix(uA * 0.62, uB, smoothstep(0.22, 0.68, v));
  c = mix(c, uH * 0.92, smoothstep(0.58, 0.95, v) * 0.62);
  c = mix(c, uH * 0.85, st * 0.45);
  c *= 0.92 + 0.16 * fbmn(o * 9.0 + 2.0, 3.0);
  c *= 1.0 - 0.28 * smoothstep(0.78, 0.98, abs(o.y));   // dusky poles

  float wr = wrapd(d, 0.22);
  float day = smoothstep(-0.3, 0.5, d);
  c = mix(c, vec3(dot(c, vec3(0.3, 0.5, 0.2))), 0.16);
  vec3 col = lin(c) * (0.020 + 0.92 * wr);
  // young and warm: self-emission, strongest on the night side, belts glow a little more
  float nightF = 1.0 - smoothstep(-0.10, 0.30, d);
  vec3 em = lin(uE) * (0.55 + 0.9 * (1.0 - v)) * (0.35 + 0.65 * (streak * 0.5 + 0.5));
  col += em * (0.30 + 0.9 * nightF) * 1.1;
  // ring shadow on the planet
  if (uRing > 0.001) {
    vec3 Nn = normalize(uN);
    float dn = dot(normalize(uL), Nn);
    if (abs(dn) > 0.02) {
      float t = -dot(n, Nn) / dn;
      if (t > 0.0) { float rad = length(n + t * normalize(uL)); col *= 1.0 - 0.85 * ringDens(rad) * min(1.0, uRing * 2.2); }
    }
  }
  // pinkish limb
  float lm = 1.0 - zs;
  vec3 at = lin(uAtm);
  col += at * (pow(lm, 2.4) * 0.65 + pow(lm, 7.0) * 0.6) * (0.25 + 0.75 * day);
  return col;
}

void main() {
  vec2 q = (gl_FragCoord.xy / uRes * 2.0 - 1.0) * 1.55;
  float r2 = dot(q, q), rr = sqrt(r2);
  vec3 L = normalize(uL), N = normalize(uN);
  vec3 T1 = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
  vec3 T2 = cross(N, T1);
  float cover = clamp((1.0 - rr) * uPx + 0.5, 0.0, 1.0);
  float zs = sqrt(max(1.0 - r2, 0.0));

  // ---- ring (equatorial plane) ----
  vec3 ringCol = vec3(0.0); float ringA = 0.0; bool front = false;
  if (uRing > 0.001) {
    float z = -(N.x * q.x + N.y * q.y) / N.z;
    vec3 P = vec3(q, z);
    float rad = length(P);
    float dens = ringDens(rad);
    float b = dot(P, L);
    float d = sqrt(max(dot(P, P) - b * b, 0.0));
    float sh = b < 0.0 ? 1.0 - smoothstep(0.86, 1.0, d) : 0.0;
    float sunSide = 0.55 + 0.45 * abs(dot(N, L));
    ringCol = lin(mix(uRC * 1.05, uRC * 0.72, smoothstep(1.22, 1.48, rad))) * sunSide * mix(1.0, 0.08, sh) * 1.15;
    ringA = dens * uRing;
    front = rr < 1.0 ? z > zs : z > 0.0;
  }

  // ---- sphere ----
  vec3 sph = vec3(0.0);
  if (rr < 1.02) {
    vec3 n = vec3(q, zs);
    vec3 o = vec3(dot(n, T1), dot(n, N), dot(n, T2));
    vec3 lo = vec3(dot(L, T1), dot(L, N), dot(L, T2));
    float cs = cos(uRot), sn = sin(uRot);
    gO = vec3(cs * o.x + sn * o.z, o.y, -sn * o.x + cs * o.z);
    gLo = vec3(cs * lo.x + sn * lo.z, lo.y, -sn * lo.x + cs * lo.z);
    gOc = rotY(gO, uDrift); gLoc = rotY(gLo, uDrift);
    gNv = n; gD = dot(n, L); gZs = zs;
    vec3 c = vec3(0.0);
    if (uW.x > 0.001) c += uW.x * wPandora();
    if (uW.y > 0.001) c += uW.y * wCobalt();
    if (uW.z > 0.001) c += uW.z * wLava();
    if (uW.w > 0.001) c += uW.w * wMagenta();
    sph = enc(c);
  }
  // atmosphere seen beyond the limb
  float glowA = 0.0;
  vec3 glowC = enc(lin(uAtm) * 1.5);
  if (rr < 1.22) {
    float dOut = dot(vec3(q / max(rr, 0.001), 0.0), L);
    float wd = dot(uW, vec4(46.0, 42.0, 85.0, 70.0));
    float gk = dot(uW, vec4(0.62, 0.50, 0.36, 0.30));
    glowA = exp(-max(rr - 1.0, 0.0) * wd) * smoothstep(-0.45, 0.6, dOut) * gk * (1.0 - cover);
  }

  // ---- composite (premultiplied) ----
  vec4 o4 = vec4(0.0);
  vec3 rcEnc = enc(ringCol);
  if (!front) o4 = vec4(rcEnc * ringA, ringA);
  o4 = vec4(sph * cover, cover) + o4 * (1.0 - cover);
  o4 += vec4(glowC * glowA, glowA) * (1.0 - o4.a);
  if (front) o4 = vec4(rcEnc * ringA, ringA) + o4 * (1.0 - ringA);
  o4.rgb += (h2(gl_FragCoord.xy) - 0.5) / 255.0 * o4.a;
  gl_FragColor = o4;
}`;


// Per-section modulation within the active world: light yaw, light pitch, rotation offset, cloud drift offset.
const PRESETS: number[][] = [
  [0.0, 0.0, 0.0, 0.0],
  [0.12, 0.0, 0.06, 0.05],
  [0.25, 0.05, 0.13, 0.11],
  [0.4, -0.05, 0.20, 0.17],
  [0.2, 0.1, 0.28, 0.23],
  [-0.2, 0.08, 0.35, 0.29],
  [-0.35, 0.0, 0.42, 0.35],
  [-0.1, -0.08, 0.49, 0.41],
];
const NP = 4;
const HOME_SECTIONS: [number, string][] = [
  [1, '[data-tech-stack]'], [2, '#experience'], [3, '#selected-work'], [4, 'section[aria-label="Open source"]'],
  [5, 'section[aria-label="Research"]'], [6, 'section[aria-label="Community and speaking"]'], [7, 'section[aria-label="Education"]'],
];
const PATH_PRESET: Record<string, number> = { experience: 2, projects: 3, 'open-source': 4, publications: 5, blogs: 5, community: 6, education: 7 };

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const chase = (cur: number, tgt: number, rate: number, dt: number) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

function init() {
  const root = document.querySelector<HTMLElement>('[data-planet]');
  const canvas = root?.querySelector('canvas');
  if (!root || !canvas || (window as any).__planet) return;
  (window as any).__planet = true;

  Object.assign(canvas.style, { position: 'absolute', top: '0', left: '0', display: 'block', transformOrigin: '50% 50%' });
  let gl: GL | null = null;
  let prog: Program, tri: WebGLBuffer;
  let lost = false;
  let reduced = prefersReducedMotion();
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // page / layout state
  let vw = innerWidth, vh = innerHeight, mobile = vw < 760;
  let home = false, contentRight = vw, heroEl = null as HTMLElement | null;
  let sections: [number, HTMLElement][] = [];
  let pageBase = 0;
  let footerEl = null as HTMLElement | null;
  let rDock = 100, cxDock = vw, dockOpacity = 0.9, rHero = 250, cxHero = vw, cyHero = vh * 0.5, dockCyTop = 0;

  // animated state
  let drift = 0, debugTime = -1, debugFreeze = false, debugGeo: number[] | null = null;
  let ds = 1, ps = 0, setS = 0, rot = 0.6, vel = 0, px = 0, py = 0, tx = 0, ty = 0;
  const cur = PRESETS[0].slice();
  const blend = createBlend(themeVec(currentTheme()));
  let tgtPreset = PRESETS[0];
  let lastT = 0, lastScroll = scrollY, lastActive = performance.now();
  let navigating = false, snapNext = false;
  let bufCss = 0, snapped = false;
  const opts = { maxDpr: 2 };

  const ringTilt = -0.36, ringElev = 0.32;
  const axis = [Math.sin(ringTilt) * Math.cos(ringElev), Math.cos(ringTilt) * Math.cos(ringElev), Math.sin(ringElev)];

  const fallback = (on: boolean) => root.classList.toggle('pl-fallback', on);

  const setup = () => {
    gl = getGL(canvas);
    if (!gl) return fallback(true);
    try {
      prog = createProgram(gl, VS, FS);
      tri = createFullscreenTriangle(gl);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      fallback(false);
    } catch (e) {
      console.warn('planet: WebGL setup failed', e);
      gl = null;
      fallback(true);
    }
  };

  const docMax = () => Math.max(1, document.documentElement.scrollHeight - vh);

  /** Re-read page structure and geometry. Called on resize, navigation and load. */
  const layout = () => {
    vw = innerWidth; vh = innerHeight; mobile = vw < 760;
    heroEl = document.querySelector<HTMLElement>('main .hero');
    home = !!heroEl;
    footerEl = document.querySelector<HTMLElement>('footer');
    const container = document.querySelector<HTMLElement>('main .shell') ?? document.querySelector<HTMLElement>('.header-inner');
    contentRight = container ? container.getBoundingClientRect().right : vw * 0.9;
    const gutter = vw - contentRight;

    // Docked state: sits in the right gutter, partly off-screen, never under body text.
    const rWant = clamp(vw * 0.08, 56, 190);               // diameter ~16vw
    const ringExt = 1.42;
    if (mobile) {
      rDock = vw * 0.19;
      cxDock = vw - rDock * 0.4;
      dockOpacity = 0.5;
    } else {
      // Need: cx - ringExt*r >= contentRight + 8, and cx <= vw + 0.45r (still mostly visible body).
      let r = Math.min(rWant, (gutter - 8) / (ringExt - 0.45));
      const fits = r >= rWant * 0.55;
      r = fits ? Math.min(rWant, Math.max(r, rWant * 0.55)) : rWant * 0.75;
      rDock = r;
      if (fits) { cxDock = Math.max(vw - r * 0.35, contentRight + 8 + ringExt * r); cxDock = Math.min(cxDock, vw + r * 0.45); dockOpacity = 0.92; }
      else { cxDock = vw - r * 0.3; dockOpacity = 0.35; }
    }
    dockCyTop = (mobile ? 64 : 84) + rDock * 0.55;

    // Hero state (home, desktop): large backdrop behind the portrait, offset right.
    rHero = vw * 0.21;
    const portrait = heroEl?.querySelector<HTMLElement>('.hero-portrait');
    let pcx = vw * 0.72, pcy = vh * 0.5;
    if (portrait) {
      const r = portrait.getBoundingClientRect();
      pcx = r.left + r.width / 2; pcy = r.top + scrollY + r.height / 2;
    }
    cxHero = Math.max(pcx + rHero * 0.55, vw - rHero * 0.6);
    cyHero = clamp(pcy, rHero * 0.8, vh - rHero * 0.2);

    // Sections for per-section looks.
    sections = [];
    if (home) for (const [i, sel] of HOME_SECTIONS) { const el = document.querySelector<HTMLElement>(sel); if (el) sections.push([i, el]); }
    pageBase = home ? 0 : (PATH_PRESET[location.pathname.split('/')[1]] ?? 0);
    tgtPreset = PRESETS[pageBase];
  };

  const sizeTarget = () => (home && !mobile && !reduced ? smooth(vh * 0.04, vh * 0.8, scrollY) : 1);
  const progress = () => clamp(scrollY / docMax());

  const activePreset = () => {
    if (!home) return pageBase;
    let idx = 0;
    for (const [i, el] of sections) if (el.getBoundingClientRect().top < vh * 0.55) idx = i;
    return idx;
  };

  let moving = true;
  const draw = (t: number) => {
    if (!gl || lost) return;
    const dt = lastT ? clamp(t - lastT, 0.001, 1 / 30) : 0.016;
    lastT = t;
    const now = performance.now();

    // ---- targets ----
    const sT = sizeTarget(), pT = progress();
    let setT = 0;
    if (footerEl) { const ft = footerEl.getBoundingClientRect().top; setT = smooth(vh, vh - Math.min(vh * 0.6, footerEl.offsetHeight + 60), ft); }
    tgtPreset = PRESETS[activePreset()];

    if (snapNext) {   // jump straight to the new targets: no spring travel after navigation / resize / resume
      snapNext = false;
      ds = sT; ps = pT; setS = setT; vel = 0; px = tx; py = ty;
      for (let i = 0; i < NP; i++) cur[i] = tgtPreset[i];
    }
    if (reduced) { ds = 1; ps = 0.12; setS = 0; vel = 0; }
    else {
      ds = chase(ds, sT, 3.2, dt); ps = chase(ps, pT, 5, dt); setS = chase(setS, setT, 4, dt);
      vel *= Math.exp(-dt * 2.4);
      rot += (vel + (now - lastActive < 10000 ? 0.035 : 0)) * dt;
      for (let i = 0; i < NP; i++) cur[i] = chase(cur[i], tgtPreset[i], 2.2, dt);
      rot += Math.sin(Math.PI * blend.e) * (blend.active ? 2.4 : 0) * dt;   // spin-up during a world morph
      drift += dt * 0.022;
    }
    const blending = debugFreeze ? false : blend.step(performance.now());
    px = chase(px, tx, 6, dt); py = chase(py, ty, 6, dt);

    // ---- geometry ----
    let r = lerp(rDock, rHero, 1 - ds);
    let cx = lerp(cxDock, cxHero, 1 - ds);
    const bob = reduced ? 0 : Math.sin(ps * 14) * 0.012 * vh + Math.sin(t * 0.35) * 2.5;
    const dockCy = mobile ? dockCyTop + ps * vh * 0.22 : dockCyTop + ps * (vh * 0.52 - dockCyTop) + bob;
    let cy = lerp(dockCy, cyHero, 1 - ds);
    if (setS > 0.001 && footerEl) {
      const ft = footerEl.getBoundingClientRect().top;
      cy = lerp(cy, Math.min(cy + r * 0.2, ft + r * 0.3), setS);   // sink behind the footer's top edge like a horizon
    }
    if (debugGeo) { [cx, cy, r] = debugGeo; }
    const opacity = lerp(dockOpacity, home && !mobile ? 0.88 : dockOpacity, 1 - ds);

    // ---- canvas sizing (only as large as the planet) ----
    const need = Math.max(8, 2 * 1.55 * r);
    if (!bufCss || need > bufCss * 1.2 || need < bufCss * 0.6 || (!moving && Math.abs(need / bufCss - 1) > 0.03)) {
      bufCss = Math.ceil(need);
      canvas.style.width = canvas.style.height = bufCss + 'px';
      opts.maxDpr = Math.min(2, 1100 / bufCss);
      loop.measure();
      if (canvas.clientWidth !== bufCss) { bufCss = 0; setTimeout(() => loop.invalidate(), 50); return; }  // stylesheet not applied yet: retry
    }
    const k = need / bufCss;
    canvas.style.transform = `translate3d(${(cx - bufCss / 2).toFixed(2)}px, ${(cy - bufCss / 2).toFixed(2)}px, 0) scale(${k.toFixed(4)})`;
    canvas.style.opacity = String(opacity.toFixed(3));

    // ---- draw ----
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog.p);
    attrib(gl, prog.a('aPos'), tri, 2);
    gl.uniform2f(prog.u('uRes'), canvas.width, canvas.height);
    gl.uniform1f(prog.u('uPx'), canvas.width / (2 * 1.55));
    const v = blend.v;
    gl.uniform1f(prog.u('uR'), canvas.width / 3.1);
    gl.uniform1f(prog.u('uOct'), clamp(2.0 + 1.15 * Math.log2(Math.max(canvas.width / 3.1, 20) / 40), 3, 6));
    gl.uniform1f(prog.u('uRot'), rot + cur[2]);
    gl.uniform1f(prog.u('uDrift'), drift + cur[3]);
    gl.uniform1f(prog.u('uTime'), debugTime >= 0 ? debugTime : t);
    gl.uniform1f(prog.u('uRing'), lerp(0.30, 0.40, 1 - ds) * v[18]);
    gl.uniform3f(prog.u('uN'), axis[0], axis[1], axis[2]);
    const yaw = cur[0] + px * 0.14, pitch = cur[1] - py * 0.1;
    const lx = -0.62, ly = 0.46, lz = 0.63;
    gl.uniform3f(prog.u('uL'), lx * Math.cos(yaw) + lz * Math.sin(yaw), ly + pitch, -lx * Math.sin(yaw) + lz * Math.cos(yaw));
    gl.uniform3f(prog.u('uA'), v[0], v[1], v[2]);
    gl.uniform3f(prog.u('uB'), v[3], v[4], v[5]);
    gl.uniform3f(prog.u('uH'), v[6], v[7], v[8]);
    gl.uniform3f(prog.u('uE'), v[9], v[10], v[11]);
    gl.uniform3f(prog.u('uAtm'), v[12], v[13], v[14]);
    gl.uniform3f(prog.u('uRC'), v[15], v[16], v[17]);
    gl.uniform4f(prog.u('uW'), v[19], v[20], v[21], v[22]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!snapped) { snapped = true; root.classList.add('pl-ready'); }

    // ---- keep animating while anything is still easing ----
    let diff = Math.abs(ds - sT) * 4 + Math.abs(ps - pT) * 20 + Math.abs(setS - setT) * 4 + Math.abs(vel) * 0.5 + Math.abs(px - tx) + Math.abs(py - ty);
    for (let i = 0; i < NP; i++) diff += Math.abs(cur[i] - tgtPreset[i]) * 0.5;
    moving = (diff > 0.004 || blending) && !reduced;
    if (moving) loop.invalidate();
    else if (!reduced) { vel = 0; px = tx; py = ty; }
  };

  const loop = createRenderer(canvas, {
    resize: () => {},
    draw,
    animated: () => !reduced && !!gl && !lost && (performance.now() - lastActive < 10000),
    fps: 60,
    idleFps: 12,
    get maxDpr() { return opts.maxDpr; },
  });

  const poke = () => { lastActive = performance.now(); loop.invalidate(); };

  setup();
  layout();
  ds = sizeTarget();
  ps = progress();
  {
    const ft = footerEl?.getBoundingClientRect().top ?? vh * 2;
    setS = smooth(vh, vh - Math.min(vh * 0.6, (footerEl?.offsetHeight ?? 0) + 60), ft);
  }
  cur.splice(0, NP, ...PRESETS[activePreset()]);
  loop.measure();

  watchTheme((th) => { blend.to(themeVec(th), reduced || !snapped); loop.invalidate(); }, loop.signal);
  if (location.search.includes('debug-planet')) {
    const idx = (id: string) => themeVec(themeById(id));
    (window as any).__planetDebug = {
      setTheme: (id: string) => { debugFreeze = false; blend.to(idx(id), true); loop.invalidate(); },
      setBlend: (t: number, a: string, b: string) => { debugFreeze = true; blend.freeze(idx(a), idx(b), t); loop.invalidate(); },
      setGeo: (cx: number, cy: number, r: number) => { debugGeo = [cx, cy, r]; loop.invalidate(); },
      setTime: (x: number) => { debugTime = x; loop.invalidate(); },
      setRot: (x: number) => { rot = x; loop.invalidate(); },
      info: () => ({ oct: 0, w: canvas.width, bufCss }),
      perf: (n = 30) => { const a: number[] = []; const g = gl!; for (let i = 0; i < n; i++) { const t0 = performance.now(); draw(performance.now() / 1000); g.finish(); a.push(performance.now() - t0); } return a; },
    };
  }

  const opt = { signal: loop.signal, passive: true } as const;
  const resync = () => {   // forget any scroll jump, zero motion, snap to the new layout
    lastScroll = scrollY; vel = 0; navigating = false; lastT = 0; snapNext = true; poke();
  };
  addEventListener('scroll', () => {
    const dy = scrollY - lastScroll; lastScroll = scrollY;
    if (navigating || Math.abs(dy) > vh * 0.6) { snapNext = true; poke(); return; }   // navigation / programmatic jump, not the user
    if (!reduced) { vel = clamp(vel + dy * 0.004, -6, 6); poke(); }
  }, opt);
  addEventListener('resize', () => { layout(); resync(); }, opt);
  addEventListener('load', () => { layout(); resync(); }, { signal: loop.signal, once: true });
  document.addEventListener('astro:page-load', () => { layout(); resync(); }, { signal: loop.signal });
  document.addEventListener('astro:before-preparation', () => { navigating = true; vel = 0; }, { signal: loop.signal });
  document.addEventListener('astro:after-swap', () => { lastScroll = scrollY; vel = 0; }, { signal: loop.signal });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); }, { signal: loop.signal });
  if (fine) {
    addEventListener('pointermove', (e) => { tx = (e.clientX / innerWidth) * 2 - 1; ty = (e.clientY / innerHeight) * 2 - 1; if (!reduced) poke(); }, opt);
  }
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { reduced = prefersReducedMotion(); layout(); loop.invalidate(); }, { signal: loop.signal });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; fallback(true); }, { signal: loop.signal });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; setup(); bufCss = 0; loop.invalidate(); }, { signal: loop.signal });
}

init();
