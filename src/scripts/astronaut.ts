import { createBlend, currentTheme, watchTheme } from './gl/themeGl';
import { attrib, createFullscreenTriangle, createProgram, createRenderer, getGL, prefersReducedMotion, type GL, type Program } from './gl/gl';

const VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Raymarched SDF astronaut (orthographic, 2x2 supersampled). Joint angles come from uniforms.
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform vec3 uRot;     // roll, yaw, pitch of the whole body
uniform vec2 uHead;    // head yaw, pitch (relative)
uniform vec4 uArm;     // right shoulder, right elbow, left shoulder, left elbow
uniform vec4 uLeg;     // right hip, right knee, left hip, left knee
uniform vec3 uL;
uniform float uPulse;
uniform vec3 uAcc;     // theme accent: visor reflection, chest light, rim light

mat3 gR; mat3 gH;
const vec3 HC = vec3(0.0, 0.80, 0.03);
const float VIEW = 1.9;

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float sdCap(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float sdRB(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
vec3 dirA(float a, float s) { return normalize(vec3(s * sin(a), -cos(a), 0.16)); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Two-segment limb; returns sleeve distance and writes the end point.
float limb(vec3 p, vec3 root, float a, float b, float s, float l1, float l2, float r1, float r2, out vec3 end) {
  vec3 m = root + dirA(a, s) * l1;
  end = m + dirA(a + b, s) * l2;
  return smin(sdCap(p, root, m, r1), sdCap(p, m, end, r2), 0.05);
}

vec2 map(vec3 pw) {
  vec3 p = gR * pw;
  float dT = sdRB(p, vec3(0.26, 0.29, 0.16), 0.15);
  float dP = sdRB(p - vec3(0.0, 0.07, -0.30), vec3(0.21, 0.27, 0.09), 0.10);
  float dC = sdCap(p, vec3(0.0, 0.36, 0.0), vec3(0.0, 0.46, 0.0), 0.21);
  vec3 hp = gH * (p - HC);
  float dH = (length(hp / vec3(0.53, 0.50, 0.54)) - 1.0) * 0.50;

  vec3 e1, e2, e3, e4;
  float dA = limb(p, vec3(0.35, 0.20, 0.0), uArm.x, uArm.y, 1.0, 0.29, 0.26, 0.118, 0.105, e1);
  dA = smin(dA, limb(p, vec3(-0.35, 0.20, 0.0), uArm.z, uArm.w, -1.0, 0.29, 0.26, 0.118, 0.105, e2), 0.05);
  float dL = limb(p, vec3(0.155, -0.34, 0.0), uLeg.x, uLeg.y, 1.0, 0.33, 0.30, 0.145, 0.125, e3);
  dL = smin(dL, limb(p, vec3(-0.155, -0.34, 0.0), uLeg.z, uLeg.w, -1.0, 0.33, 0.30, 0.145, 0.125, e4), 0.05);
  float dG = min(length(p - e1) - 0.125, length(p - e2) - 0.125);
  float dB = min(sdCap(p, e3, e3 + vec3(0.0, -0.05, 0.11), 0.14), sdCap(p, e4, e4 + vec3(0.0, -0.05, 0.11), 0.14));

  float suit = smin(smin(dT, dC, 0.1), smin(dA, dL, 0.05), 0.07);
  float d = smin(suit, dP, 0.08);
  d = smin(d, dH, 0.05);
  d = smin(d, min(dG, dB), 0.025);
  float id = 0.0, best = suit;
  if (dP < best) { best = dP; id = 3.0; }
  if (dH < best) { best = dH; id = 1.0; }
  if (dG < best) { best = dG; id = 2.0; }
  if (dB < best) { id = 2.0; }
  return vec2(d, id);
}

vec3 calcN(vec3 p) {
  const vec2 k = vec2(1.0, -1.0); const float e = 0.0025;
  return normalize(k.xyy * map(p + k.xyy * e).x + k.yyx * map(p + k.yyx * e).x + k.yxy * map(p + k.yxy * e).x + k.xxx * map(p + k.xxx * e).x);
}

float shadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.03;
  for (int i = 0; i < 14; i++) {
    float h = map(ro + rd * t).x;
    res = min(res, 7.0 * h / t);
    t += clamp(h, 0.04, 0.25);
    if (res < 0.02 || t > 1.8) break;
  }
  return clamp(res, 0.0, 1.0);
}

vec3 shade(vec3 pw, vec3 n, float id) {
  vec3 L = normalize(uL);
  vec3 p = gR * pw;
  vec3 hp = gH * (p - HC);
  vec3 v = vec3(0.0, 0.0, 1.0);
  float ndv = clamp(dot(n, v), 0.0, 1.0);

  vec3 alb = vec3(0.86, 0.88, 0.92);
  float spec = 0.10, gloss = 28.0;
  float visor = 0.0, trim = 0.0, glow = 0.0;
  if (id > 2.5) { alb = vec3(0.68, 0.72, 0.79); spec = 0.06; }
  else if (id > 1.5) { alb = vec3(0.40, 0.44, 0.52); spec = 0.14; gloss = 20.0; }
  else if (id > 0.5) {
    alb = vec3(0.92, 0.94, 0.97);
    vec2 q = vec2(hp.x / 0.405, (hp.y - 0.015) / 0.30);
    float e = pow(pow(abs(q.x), 2.7) + pow(abs(q.y), 2.7), 1.0 / 2.7);
    float zf = smoothstep(0.06, 0.20, hp.z / 0.52);
    visor = (1.0 - smoothstep(0.90, 0.975, e)) * zf;
    trim = smoothstep(0.88, 0.97, e) * (1.0 - smoothstep(1.0, 1.1, e)) * zf;
  } else {
    // suit details on torso: belt, chest panel, buttons, chest light
    float front = smoothstep(0.18, 0.30, p.z);
    float torso = 1.0 - smoothstep(0.30, 0.42, abs(p.x) + max(p.y - 0.3, 0.0) + max(-0.5 - p.y, 0.0));
    float belt = smoothstep(0.035, 0.0, abs(p.y + 0.29)) * smoothstep(0.35, 0.28, abs(p.x)) ;
    alb = mix(alb, vec3(0.55, 0.60, 0.68), belt * 0.9 * smoothstep(0.35, 0.2, length(p.xz) - 0.0));
    vec2 pq = abs(vec2(p.x, p.y - 0.12)) - vec2(0.18, 0.095);
    float panel = (1.0 - smoothstep(0.0, 0.012, max(pq.x, pq.y))) * front * torso;
    float panelEdge = (1.0 - smoothstep(0.0, 0.01, abs(max(pq.x, pq.y) + 0.008))) * front * torso;
    alb = mix(alb, vec3(0.70, 0.74, 0.81), panel * 0.9);
    alb = mix(alb, vec3(0.47, 0.51, 0.60), panelEdge * 0.7);
    float b1 = (1.0 - smoothstep(0.012, 0.02, length(p.xy - vec2(-0.12, 0.12)))) * front;
    float b2 = (1.0 - smoothstep(0.012, 0.02, length(p.xy - vec2(-0.06, 0.12)))) * front;
    alb = mix(alb, vec3(0.30, 0.34, 0.42), max(b1, b2));
    float cl = length(p.xy - vec2(0.115, 0.125));
    glow = (1.0 - smoothstep(0.016, 0.026, cl)) * front;
    float halo = (1.0 - smoothstep(0.026, 0.07, cl)) * front * 0.5;
    alb = mix(alb, vec3(0.30, 0.34, 0.42), (1.0 - smoothstep(0.026, 0.034, cl)) * front * 0.8 * (1.0 - glow));
    glow += halo * 0.15;
  }

  // lighting: upper-left sun, cool fill, cool rim, AO
  float ao = 1.0, aw = 1.0;
  for (int i = 1; i <= 3; i++) { float hh = 0.05 * float(i); ao -= (hh - map(pw + n * hh).x) * aw * 2.2; aw *= 0.6; }
  ao = clamp(ao, 0.15, 1.0);
  float sh = shadow(pw + n * 0.02, L);
  float ndl = dot(n, L);
  float key = clamp((ndl + 0.18) / 1.18, 0.0, 1.0);
  key = key * key * (3.0 - 2.0 * key) * 0.35 + key * 0.65;
  vec3 keyC = vec3(1.0, 0.97, 0.92) * 1.12;
  vec3 fillD = normalize(vec3(0.7, -0.35, 0.55));
  vec3 fill = vec3(0.30, 0.38, 0.50) * (0.30 + 0.7 * max(dot(n, fillD), 0.0)) * 0.55;
  vec3 amb = mix(vec3(0.07, 0.085, 0.12), vec3(0.15, 0.19, 0.25), 0.5 + 0.5 * n.y);
  vec3 col = alb * (keyC * key * mix(0.30, 1.0, sh) + (fill + amb) * ao);
  vec3 H = normalize(L + v);
  col += vec3(1.0, 0.98, 0.95) * pow(max(dot(n, H), 0.0), gloss) * spec * sh;
  // rim: reads against black, strongest on the sun side edge and below
  float rimF = pow(1.0 - ndv, 2.6);
  vec3 rimD = normalize(vec3(0.55, 0.15, -0.6));
  col += mix(uAcc, vec3(1.0), 0.35) * rimF * (0.20 + 0.55 * max(dot(n, rimD) * 0.5 + 0.5, 0.0)) * ao * 0.9;

  if (visor > 0.0) {
    vec3 rw = reflect(vec3(0.0, 0.0, -1.0), n);
    vec3 vc = uAcc * 0.04;
    float sky = smoothstep(-0.3, 0.9, rw.y);
    vc += uAcc * 0.11 * sky * 0.8;
    float blob = smoothstep(0.50, 0.92, dot(rw, normalize(vec3(-0.45, 0.62, 0.64))));
    vc += uAcc * 0.72 * blob * 0.85;
    vec2 sc = rw.xy * 26.0 + 3.0; vec2 ci = floor(sc), cf = fract(sc);
    float hh = h21(ci);
    vc += vec3(0.8, 0.9, 1.0) * step(0.90, hh) * smoothstep(0.20, 0.0, length(cf - 0.3 - 0.4 * vec2(h21(ci + 4.1), h21(ci + 9.7)))) * 0.75;
    vc += vec3(1.0, 0.94, 0.92) * pow(max(dot(rw, L), 0.0), 70.0) * 1.1;
    vc += uAcc * 0.55 * pow(1.0 - ndv, 3.0) * 0.5;
    col = mix(col, vc, visor);
  }
  col = mix(col, vec3(0.22, 0.26, 0.33) * (0.5 + 0.5 * key), trim * 0.65);
  col += uAcc * 1.15 * glow * (0.85 + 0.25 * uPulse);
  return col;
}

vec4 trace(vec2 uv) {
  vec2 xy = uv * VIEW;
  if (abs(xy.x) > 1.9 || abs(xy.y) > 1.9) return vec4(0.0);
  vec3 ro = vec3(xy, 3.0), rd = vec3(0.0, 0.0, -1.0);
  float t = 0.9; bool hit = false; vec2 h = vec2(0.0);
  for (int i = 0; i < 56; i++) {
    h = map(ro + rd * t);
    if (h.x < 0.0016) { hit = true; break; }
    t += h.x * 0.92;
    if (t > 4.6) break;
  }
  if (!hit) return vec4(0.0);
  vec3 p = ro + rd * t;
  vec3 n = calcN(p);
  return vec4(shade(p, n, h.y), 1.0);
}

void main() {
  gR = rotX(-uRot.z) * rotY(-uRot.y) * rotZ(-uRot.x);
  gH = rotX(-uHead.y) * rotY(-uHead.x);
  vec2 f = gl_FragCoord.xy;
  vec4 a = trace((f + vec2(0.125, 0.375)) / uRes * 2.0 - 1.0)
         + trace((f + vec2(0.625, 0.125)) / uRes * 2.0 - 1.0)
         + trace((f + vec2(0.875, 0.625)) / uRes * 2.0 - 1.0)
         + trace((f + vec2(0.375, 0.875)) / uRes * 2.0 - 1.0);
  a *= 0.25;
  vec3 c = pow(a.rgb, vec3(0.92));
  c += (h21(f) - 0.5) / 255.0 * a.a;
  gl_FragColor = vec4(c, a.a);   // a.rgb is already coverage-weighted (misses add zero), so this is premultiplied
}`;

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const chase = (cur: number, tgt: number, rate: number, dt: number) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

const VIS = 0.46;      // visual figure width as a fraction of the canvas
const BASE = 150;      // canvas size (CSS px) with a comfortable gutter
const HERO_K = 1.25;   // size multiplier on the home hero
const IDLE_MS = 20000;

function init() {
  const root = document.querySelector<HTMLElement>('[data-astronaut]');
  const canvas = root?.querySelector('canvas');
  const W = window as any;
  if (!root || !canvas || W.__astronaut) return;

  Object.assign(canvas.style, { position: 'absolute', top: '0', left: '0', display: 'block', transformOrigin: '50% 50%' });
  let gl: GL | null = null;
  let prog: Program, tri: WebGLBuffer;
  let lost = false;
  let reduced = prefersReducedMotion();
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // layout
  let vw = innerWidth, vh = innerHeight;
  let off = true, home = false, size = BASE, bufCss = 0, dockOpacity = 0.95, shellLeft = 140;
  let footerEl = null as HTMLElement | null;

  // dynamic state
  let ds = 1, ps = 0, vel = 0, omega = 0, rollOff = 0, tx = 0.5, ty = 0.5, hx = 0, hy = 0;
  let lastT = 0, lastScroll = scrollY, lastActive = performance.now(), navigating = false, snapNext = false, ready = false, moving = true;
  let nextWave = 9, waveStart = -99, cyS = 0, cxS = 0;
  const opts = { maxDpr: 2 };
  const blend = createBlend([...currentTheme().gl.astronautAccent]);
  let blending = false;

  const setup = () => {
    gl = getGL(canvas);
    if (!gl) { root.classList.add('as-off'); return; }
    try {
      prog = createProgram(gl, VS, FS);
      tri = createFullscreenTriangle(gl);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } catch (e) {
      console.warn('astronaut: WebGL setup failed', e);
      gl = null;
      root.classList.add('as-off');
    }
  };

  const layout = () => {
    vw = innerWidth; vh = innerHeight;
    home = !!document.querySelector('main .hero');
    footerEl = document.querySelector<HTMLElement>('footer');
    const shell = document.querySelector<HTMLElement>('main .shell');
    shellLeft = shell ? shell.getBoundingClientRect().left : vw * 0.05;
    // Free gutter: left of the content edge, with an 8px screen margin and a 14px breathing gap.
    const avail = shellLeft - 14 - 8;
    const want = Math.min(BASE, avail / VIS);
    off = vw < 760 || want < 70 || !gl;
    size = clamp(want, 70, BASE);
    dockOpacity = want < 110 ? 0.6 : 0.95;
    root.classList.toggle('as-off', off || !gl);
    if (off) return;
    const css = Math.ceil(size * (home ? HERO_K : 1));
    if (css !== bufCss) {
      bufCss = css;
      canvas.style.width = canvas.style.height = css + 'px';
      opts.maxDpr = 2;
      loop.measure();
    }
  };

  const docMax = () => Math.max(1, document.documentElement.scrollHeight - vh);
  const progress = () => clamp(scrollY / docMax());
  const pageHidden = () => document.documentElement.dataset.page === 'starfield';
  const heroT = () => (home && !reduced ? smooth(vh * 0.04, vh * 0.7, scrollY) : 1);

  const sm = [0, 0, 0];   // scratch
  const draw = (t: number) => {
    if (!gl || lost || off || pageHidden()) return;
    const dt = lastT ? clamp(t - lastT, 0.001, 1 / 30) : 0.016;
    lastT = t;

    blending = blend.step();

    // ---- motion state ----
    const dsT = heroT(), pT = progress();
    if (snapNext) {
      snapNext = false;
      ds = dsT; ps = pT; vel = 0; omega = 0; rollOff = 0; hx = (tx - 0.5) * 0.9; hy = (ty - 0.5) * 0.7; cxS = 0; cyS = 0;
    }
    if (reduced) { ds = 1; ps = 0.2; vel = 0; omega = 0; rollOff = 0; }
    else {
      ds = chase(ds, dsT, 3, dt);
      ps = chase(ps, pT, 3.2, dt);                      // spring lag: trails the scroll
      vel *= Math.exp(-dt * 2.6);
      omega *= Math.exp(-dt * 0.9);
      rollOff += omega * dt;
      omega += -rollOff * 7 * dt;                       // tumble decays back to level
      omega -= omega * 1.6 * dt;
    }
    hx = chase(hx, (tx - 0.5) * 0.9, 5, dt); hy = chase(hy, (ty - 0.5) * 0.7, 5, dt);

    // ---- idle floating pose ----
    const idle = reduced ? 0 : 1;
    const f = clamp(Math.abs(vel) / 3.5);               // flail amount from scroll velocity
    const bob = idle * Math.sin(t * 1.25) * 4.2;
    let roll = idle * (Math.sin(t * 0.33) * 0.17 + Math.sin(t * 0.141 + 1.3) * 0.05) + rollOff - clamp(vel * 0.05, -0.3, 0.3) * idle;
    const yaw = idle * (Math.sin(t * 0.37 + 0.6) * 0.34) + (reduced ? -0.18 : 0);
    const pitch = idle * Math.sin(t * 0.29 + 2) * 0.07 + clamp(vel * 0.02, -0.12, 0.12) * idle;

    // occasional slow wave (right arm)
    if (!reduced && t > nextWave) { waveStart = t; nextWave = t + 12 + Math.random() * 8; }
    const wx = t - waveStart;
    const wv = smooth(0, 0.8, wx) * (1 - smooth(3.4, 4.3, wx));
    const sw = (ph: number, sp: number) => Math.sin(t * sp + ph);
    const fl = f * 0.55;
    const aR = lerp(0.55 + idle * (0.16 * sw(0, 0.9) + 0.0), 2.45, wv) + fl * sw(0.5, 8.1) + f * 0.35;
    const bR = lerp(0.65 + idle * 0.22 * sw(1.1, 1.1), 0.0, wv) + wv * 0.38 * sw(0, 7.5) + fl * sw(1.7, 9.3);
    const aL = 0.62 + idle * 0.16 * sw(3.2, 0.8) + fl * sw(2.4, 7.4) + f * 0.35;
    const bL = 0.55 + idle * 0.22 * sw(4.4, 1.0) + fl * sw(3.9, 8.7);
    const lR = 0.20 + idle * 0.10 * sw(2.0, 0.7) + fl * 0.7 * sw(1.0, 6.6);
    const kR = -0.10 + idle * 0.14 * sw(0.3, 0.85) + fl * 0.8 * sw(2.2, 7.9);
    const lL = 0.24 + idle * 0.10 * sw(5.1, 0.75) + fl * 0.7 * sw(4.0, 6.1);
    const kL = -0.06 + idle * 0.14 * sw(3.6, 0.8) + fl * 0.8 * sw(5.3, 8.3);

    // ---- placement ----
    const k = lerp(1, home ? HERO_K : 1, 1 - ds);
    const cssNow = size * k;
    const half = VIS * cssNow * 0.5 + 2;
    const halfWide = half + 12 * k;   // arms flare a little beyond the nominal width
    const gx = shellLeft - 14;
    let cx = clamp(shellLeft * 0.5, 8 + halfWide, Math.max(8 + halfWide, gx - halfWide));
    const dockY = lerp(Math.max(vh * 0.30, 150), vh * 0.74, ps) + bob;
    const heroY = vh * 0.30;
    let cy = lerp(dockY, heroY + bob, 1 - ds);
    // never sit on the footer: drift up as it approaches
    if (footerEl) {
      const ft = footerEl.getBoundingClientRect().top;
      const lim = ft - cssNow * 0.40 - 22;
      const a = cy, b = lim, kk = 50;
      const h = Math.max(kk - Math.abs(a - b), 0) / kk;
      cy = Math.min(a, b) - h * h * kk * 0.25;
    }
    cy = Math.max(cy, 96 + cssNow * 0.32);
    cxS = cxS ? chase(cxS, cx, reduced ? 100 : 12, dt) : cx;
    cyS = cyS ? chase(cyS, cy, reduced ? 100 : 12, dt) : cy;

    const scl = cssNow / bufCss;
    canvas.style.transform = `translate3d(${(cxS - bufCss / 2).toFixed(2)}px, ${(cyS - bufCss / 2).toFixed(2)}px, 0) scale(${scl.toFixed(4)})`;
    canvas.style.opacity = (ready ? dockOpacity : 0) + '';

    // ---- draw ----
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog.p);
    attrib(gl, prog.a('aPos'), tri, 2);
    gl.uniform2f(prog.u('uRes'), canvas.width, canvas.height);
    gl.uniform3f(prog.u('uRot'), roll, yaw, pitch);
    gl.uniform2f(prog.u('uHead'), clamp(hx + idle * 0.16 * Math.sin(t * 0.5), -0.6, 0.6) - yaw * 0.35, clamp(-hy * 0.8 + idle * 0.05 * Math.sin(t * 0.43 + 1), -0.4, 0.4));
    gl.uniform4f(prog.u('uArm'), aR, bR, aL, bL);
    gl.uniform4f(prog.u('uLeg'), lR, kR, lL, kL);
    gl.uniform3f(prog.u('uL'), -0.62, 0.46, 0.63);
    gl.uniform3f(prog.u('uAcc'), blend.v[0], blend.v[1], blend.v[2]);
    gl.uniform1f(prog.u('uPulse'), idle * Math.sin(t * 2.2));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!ready) { ready = true; canvas.style.opacity = dockOpacity + ''; }

    sm[0] = Math.abs(ds - dsT) * 4 + Math.abs(ps - pT) * 20 + Math.abs(vel) * 0.5 + Math.abs(omega) + Math.abs(rollOff) + Math.abs(hx - (tx - 0.5) * 0.9) + Math.abs(hy - (ty - 0.5) * 0.7) + Math.abs(cxS - cx) * 0.05 + Math.abs(cyS - cy) * 0.05;
    moving = !reduced && sm[0] > 0.004;
    if (moving || blending) loop.invalidate();
  };

  const loop = createRenderer(canvas, {
    resize: () => {},
    draw,
    animated: () => !reduced && !!gl && !lost && !off && !pageHidden() && (performance.now() - lastActive < IDLE_MS),
    fps: 60,
    idleFps: 30,
    get maxDpr() { return opts.maxDpr; },
  });

  W.__astronaut = { dispose: () => { loop.dispose(); delete W.__astronaut; } };

  setup();
  layout();
  ps = progress();
  ds = heroT();
  if (!off) loop.measure();

  watchTheme((t) => { blend.to([...t.gl.astronautAccent], reduced); loop.invalidate(); }, loop.signal);
  const poke = () => { lastActive = performance.now(); loop.invalidate(); };
  const sig = { signal: loop.signal };
  const opt = { signal: loop.signal, passive: true } as const;
  const resync = () => {   // forget any scroll jump, zero motion, snap to the new layout
    lastScroll = scrollY; vel = 0; omega = 0; rollOff = 0; navigating = false; lastT = 0; snapNext = true; poke();
  };
  addEventListener('scroll', () => {
    const dy = scrollY - lastScroll; lastScroll = scrollY;
    if (navigating || Math.abs(dy) > vh * 0.6) { snapNext = true; poke(); return; }   // navigation / programmatic jump, not the user
    if (!reduced) { vel = clamp(vel + dy * 0.004, -6, 6); omega = clamp(omega + dy * 0.0028, -2.4, 2.4); }
    poke();
  }, opt);
  addEventListener('resize', () => { layout(); resync(); }, sig);
  addEventListener('load', () => { layout(); resync(); }, { signal: loop.signal, once: true });
  document.addEventListener('astro:page-load', () => { bufCss = 0; layout(); resync(); }, sig);
  document.addEventListener('astro:before-preparation', () => { navigating = true; vel = 0; omega = 0; }, sig);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); }, sig);
  document.addEventListener('astro:after-swap', () => { lastScroll = scrollY; vel = 0; omega = 0; rollOff = 0; if (!root.isConnected) loop.dispose(), delete W.__astronaut; }, sig);
  if (fine) {
    addEventListener('pointermove', (e) => {
      const rx = cxS || 0, ry = cyS || 0;
      tx = clamp(0.5 + (e.clientX - rx) / (vw * 2), 0, 1); ty = clamp(0.5 + (e.clientY - ry) / (vh * 2), 0, 1);
      if (!reduced) poke();
    }, opt);
  }
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { reduced = prefersReducedMotion(); layout(); loop.invalidate(); }, sig);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; root.classList.add('as-off'); }, sig);
  canvas.addEventListener('webglcontextrestored', () => { lost = false; setup(); if (gl) root.classList.remove('as-off'); bufCss = 0; layout(); loop.invalidate(); }, sig);
}

init();
