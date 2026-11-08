import type { PlanetTheme } from '../../data/themes';

// Shared planet uber-shader (used by the companion planet and the /starfield galaxy scene).
export const VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Analytic planet "uber-shader": ray-sphere on a quad. Four worlds (Pandora, HD 189733 b, 55 Cancri e, GJ 504 b) each have a
// surface function; per-world weights (uW) blend them, and a weight of ~0 skips that world's noise entirely.
export const WORLDS = ['biolum-ocean', 'cobalt-giant', 'lava-world', 'magenta-giant'] as const;
export const DEFAULT_RING = [0.70, 0.52, 0.64];
export const themeVec = (t: PlanetTheme) => {
  const g = t.gl, w = [0, 0, 0, 0]; w[WORLDS.indexOf(g.world)] = 1;
  return [...g.surfaceA, ...g.surfaceB, ...g.highlight, ...g.emissive, ...g.atmosphere, ...(g.ring ?? DEFAULT_RING), g.ring ? 1 : 0, ...w];
};
export const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uRot, uPx, uR, uOct, uDrift, uTime, uRing;
uniform vec2 uOrg;       // window-space origin of the draw rect (0 = canvas fills the quad)
uniform float uOrientOn; // 0 = ignore uOrient (default)
uniform mat3 uOrient;    // optional free orientation (view -> object), applied before uRot
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
  if (nOct > 4.5) dens += (fbmn(c * 15.0 + sw * 4.0, 3.0) - 0.5) * 0.11;   // fine edge breakup
  gCd = smoothstep(0.62, 0.80, dens);
  return smoothstep(0.53, 0.605, dens);
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

  float wr = wrapd(d, 0.17);
  float day = smoothstep(-0.18, 0.5, d);
  vec3 ambL = lin(uAtm) * 0.010 + vec3(0.002, 0.004, 0.007);
  vec3 col = lin(surf) * (ambL + vec3(1.0, 0.98, 0.94) * wr * 1.12);
  // twilight band
  col += lin(uAtm) * smoothstep(-0.10, 0.02, d) * (1.0 - smoothstep(0.02, 0.26, d)) * 0.10 * (1.0 - cloud);
  // sun glint on the sea
  vec3 H = normalize(normalize(uL) + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(n, H), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - zs, 5.0);
  float glint = (pow(nh, 160.0) * 1.9 + pow(nh, 24.0) * 0.20) * (1.0 - 0.6 * land) * (1.0 - cloud) * (0.4 + fres) * smoothstep(0.0, 0.2, d);
  col += vec3(1.0, 0.97, 0.88) * glint;
  // cloud layer
  vec3 cl = lin(uH) * (0.02 + 1.10 * wrapd(d, 0.17)) * (0.50 + 0.55 * cdet);
  cl = mix(cl * vec3(0.78, 0.9, 1.05), cl, smoothstep(0.0, 0.5, d));
  cl += lin(uAtm) * 0.015;
  col = mix(col, cl, cloud * (0.50 + 0.45 * cdet));

  // Rayleigh-like limb glow: cyan-blue, brighter on the day limb
  float lm = 1.0 - zs;
  vec3 at = lin(uAtm);
  col += at * (pow(lm, 2.2) * 0.85 + pow(lm, 6.0) * 0.9) * (0.05 + 0.95 * day);
  col = mix(col, at * (0.10 + 0.5 * day), pow(lm, 1.3) * 0.16 * (0.3 + day));

  // bioluminescence on the night side
  float nightF = 1.0 - smoothstep(-0.20, 0.05, d);
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
  float wr = wrapd(d, 0.17);
  float day = smoothstep(-0.20, 0.55, d);
  vec3 col = lin(c) * (vec3(0.007, 0.009, 0.013) + 1.30 * wr);
  col = mix(col, lin(uH) * 0.55 * wr, 0.14 * day);
  // glassy highlight
  vec3 H = normalize(normalize(uL) + vec3(0.0, 0.0, 1.0));
  col += lin(uAtm) * pow(max(dot(n, H), 0.0), 50.0) * 0.22 * day;
  // faint deep-red thermal glow on the night side
  float nightF = 1.0 - smoothstep(-0.18, 0.12, d);
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
  // black / charcoal basalt: desaturated dark grey with only a faint brown cast from the palette
  vec3 crust = mix(vec3(0.10, 0.10, 0.108), vec3(0.26, 0.255, 0.26), smoothstep(0.34, 0.70, cr));
  crust = mix(crust, crust * (uB * 5.0 + 0.4), 0.12) * (0.65 + 0.6 * fine) * (1.0 + 0.5 * cH);

  float tm = uTime * 0.35;
  vec3 pw = p + 0.65 * (vec3(fbmn(p * 1.3 + vec3(1.7, 9.2, 3.1), 3.0), fbmn(p * 1.3 + vec3(8.3, 2.8, 5.1), 3.0), fbmn(p * 1.3 + vec3(4.1, 6.6, 7.7), 3.0)) - 0.5);
  pw += 0.012 * sin(vec3(tm * 1.7, tm * 1.3, tm * 2.1) + pw.yzx * 7.0);   // heat shimmer

  // ridged-noise cracks: width varies along the crack and tapers to nothing
  float rid = 1.0 - abs(2.0 * fbmn(pw * 1.7, 5.0) - 1.0);
  float wv = fbmn(pw * 2.3 + 11.0, 3.0);
  float wid = 0.004 + 0.062 * smoothstep(0.38, 0.72, wv);
  float xr = clamp((rid - (1.0 - wid)) / wid, 0.0, 1.0);          // 0 at the crack edge, 1 on its centreline
  float bleed = pow(clamp((rid - (1.0 - wid * 6.0)) / (wid * 6.0), 0.0, 1.0), 2.5) * smoothstep(0.01, 0.045, wid);
  float xr2 = 0.0;
  if (uOct > 3.3) {
    float r2 = 1.0 - abs(2.0 * fbmn(pw * 4.8 + 7.0, 4.0) - 1.0);
    float w2 = 0.003 + 0.020 * smoothstep(0.35, 0.75, fbmn(pw * 5.5 + 2.0, 3.0));
    xr2 = clamp((r2 - (1.0 - w2)) / w2, 0.0, 1.0) * 0.5;
  }
  float cx = max(xr, xr2);

  // offset hot spot: the substellar point rotated ~40 degrees around the view's vertical axis
  float hc = 0.76, hs_ = 0.65;
  vec3 hdir = normalize(vec3(normalize(uL).x * hc + normalize(uL).z * hs_, normalize(uL).y, -normalize(uL).x * hs_ + normalize(uL).z * hc));
  float hm = dot(n, hdir);
  float sea = smoothstep(0.76, 0.97, hm + (fbmn(p * 2.4 + 3.0, 5.0) - 0.5) * 0.45);
  float pn = fbmn(pw * 3.1 + 1.0, 5.0);
  float plates = smoothstep(0.50, 0.535, pn);                       // dark floating crust plates
  float plateEdge = exp(-abs(pn - 0.50) * 38.0);                    // glowing seams around each plate
  float seaE = sea * (1.0 - plates);
  float conv = fbmn(pw * 9.0 + vec3(tm * 0.35, 0.0, tm * 0.2), 4.0);  // convection mottling in the melt

  float wr = wrapd(d, 0.15);
  float dayK = smoothstep(-0.05, 0.4, d);
  vec3 col = lin(crust) * (vec3(0.010, 0.012, 0.016) + 2.0 * wr * vec3(0.95, 0.97, 1.0));   // dark rock under starlight
  col += lin(uE) * smoothstep(0.4, 0.95, hm) * 0.012 * (1.0 - cx);

  float shim = 1.0 + 0.06 * sin(uTime * 2.6 + fbmn(p * 5.0, 2.0) * 18.0);
  float fk = mix(1.5, 1.0, dayK);                                   // fissures strongest at night
  vec3 red = vec3(0.55, 0.035, 0.0), org = lin(uE) * 1.1, hot = vec3(1.6, 1.25, 0.65);
  vec3 vein = mix(red, org, smoothstep(0.0, 0.45, cx));
  vein = mix(vein, hot, smoothstep(0.62, 1.0, cx));
  vec3 em = vein * smoothstep(0.0, 0.12, cx) * (0.55 + 0.9 * cx) * 1.3 * fk;
  em += lin(mix(uE, red, 0.35)) * bleed * 0.22 * fk * (1.0 - cx);   // faint glow bleeding into the crust
  float temp = clamp(0.05 + 0.65 * conv + 0.35 * (hm - 0.75), 0.0, 1.0);
  vec3 lavaC = mix(red * 1.3, org * 1.2, smoothstep(0.15, 0.55, temp));
  lavaC = mix(lavaC, hot * 0.9, smoothstep(0.62, 0.98, temp));
  em += lavaC * seaE * 0.8;
  em += mix(org, hot, 0.4) * plateEdge * sea * 0.6;
  em += red * 0.12 * sea * plates * cx;                    // plates are cracked and red-lit from below
  col += em * shim;

  // thin orange heat-haze limb
  float lm = 1.0 - zs;
  vec3 at = lin(uAtm);
  col += at * (pow(lm, 4.5) * 0.4 + pow(lm, 10.0) * 1.0) * (0.22 + 0.8 * dayK);
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

  float wr = wrapd(d, 0.17);
  float day = smoothstep(-0.2, 0.5, d);
  c = mix(c, vec3(dot(c, vec3(0.3, 0.5, 0.2))), 0.16);
  vec3 col = lin(c) * (0.012 + 0.96 * wr);
  // young and warm: self-emission, strongest on the night side, belts glow a little more
  float nightF = 1.0 - smoothstep(-0.18, 0.12, d);
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
  vec2 q = ((gl_FragCoord.xy - uOrg) / uRes * 2.0 - 1.0) * 1.55;
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
    if (uOrientOn > 0.5) { o = uOrient * o; lo = uOrient * lo; }
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
