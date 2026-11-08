// /starfield: an interactive procedural galaxy with the four theme planets, a fly-to close-up view and a spaceship.
// Raw WebGL, one canvas, one perspective camera. Initialised on astro:page-load, torn down on astro:before-swap.
import { THEMES, type PlanetTheme } from '../data/themes';
import { getTheme, setTheme } from './theme';
import { createBlend, watchTheme } from './gl/themeGl';
import { attrib, createBuffer, createFullscreenTriangle, createProgram, createRenderer, prefersReducedMotion, type GL, type Program } from './gl/gl';
import { FS as PLANET_FS, VS as PLANET_VS, themeVec } from './gl/planetShader';
import { angDiff, clamp, easeInOut, easeInOutSine, lerp, m4, quat, rng, v3, type Mat4, type Quat, type V3 } from './gl/math';
import { createShip, SHIP_CREDIT, type Ship } from './gl/ship';

// ---- shaders -----------------------------------------------------------------------------------------------------------
const STAR_VS = `
attribute vec3 aPos; attribute vec4 aD;
uniform mat4 uVP; uniform float uF, uTime, uKind, uDpr, uMaxPt, uTw, uGain;
uniform vec3 uA, uB, uCore;
varying vec3 vCol; varying float vA;
float h(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void main() {
  vec4 c = uVP * vec4(aPos, 1.0);
  gl_Position = c;
  float ps = uKind > 1.5 ? aD.x * uDpr : aD.x * uF / max(c.w, 0.01);
  float tw = 1.0 + uTw * 0.35 * sin(uTime * (1.2 + aD.w * 2.5) + aD.w * 60.0) * step(0.55, fract(aD.w * 13.7));
  float pc = clamp(ps, 1.0, uMaxPt);
  gl_PointSize = pc;
  float m = h(aD.w * 91.7);
  vec3 arm = mix(uB, uA, m);
  vec3 col = mix(uCore, mix(vec3(0.78, 0.86, 1.0) * 0.6 + arm * 0.5, arm, 0.45), smoothstep(0.04, 0.55, aD.z));
  if (uKind > 1.5) col = mix(vec3(0.85, 0.9, 1.0), vec3(1.0, 0.92, 0.82), m);
  else if (uKind > 0.5) col = arm;
  float near = uKind > 1.5 ? 1.0 : smoothstep(0.8, 4.0, c.w);
  vCol = col;
  vA = aD.y * tw * min(1.0, (ps * ps) / (pc * pc)) * near * uGain;
}`;
const STAR_FS = `
precision mediump float;
varying vec3 vCol; varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = max(1.0 - d, 0.0); a *= a;
  gl_FragColor = vec4(vCol * a * vA, 1.0);
}`;
const GLOW_VS = `
attribute vec3 aPos; attribute vec2 aA;
uniform mat4 uVP; uniform float uF, uMaxPt;
varying float vA;
void main() {
  vec4 c = uVP * vec4(aPos, 1.0);
  gl_Position = c;
  gl_PointSize = clamp(aA.x * uF / max(c.w, 0.01), 1.0, uMaxPt);
  vA = aA.y;
}`;
const GLOW_FS = `
precision mediump float;
uniform vec3 uColor; uniform float uMode;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = uMode < 0.5 ? pow(max(1.0 - d, 0.0), 2.2) : smoothstep(0.80, 0.90, d) * (1.0 - smoothstep(0.94, 1.0, d));
  gl_FragColor = vec4(uColor * a * vA, 1.0);
}`;
const LINE_VS = `
attribute vec2 aC;
uniform mat4 uVP; uniform float uRad, uY;
varying float vF;
void main() {
  vec4 c = uVP * vec4(aC.x * uRad, uY, aC.y * uRad, 1.0);
  gl_Position = c;
  vF = 1.0;
}`;
const LINE_FS = `
precision mediump float;
uniform vec3 uColor; uniform float uAlpha;
void main() { gl_FragColor = vec4(uColor * uAlpha, 1.0); }`;

// ---- scene constants ---------------------------------------------------------------------------------------------------
const FOV = 0.8;
const GALAXY_R = 12;
const ROT_SPEED = 0.028;       // galaxy rad/s
const NEAR = 0.05, FAR = 200;
const PANEL_W = 384;           // desktop panel footprint incl. margins
const DEF_YAW = 0.35, DEF_PITCH = 0.62, DEF_DIST = 22;
const DIST_MIN = 9, DIST_MAX = 34;
const ZOOM_MIN = 0.7, ZOOM_MAX = 2.2;
const CORE: V3 = [0, 0, 0];

interface PlanetDef { orbit: number; a0: number; y: number; r: number; pole: V3; spin: number; }
const DEFS: PlanetDef[] = [
  { orbit: 4.3, a0: 0.7, y: 0.15, r: 0.6, pole: [0.2, 1, 0.12], spin: 0.06 },    // pandora
  { orbit: 6.2, a0: 2.55, y: -0.25, r: 0.78, pole: [-0.1, 1, 0.22], spin: 0.045 }, // hd189733b
  { orbit: 7.7, a0: 4.2, y: 0.3, r: 0.46, pole: [0.15, 1, -0.2], spin: 0.03 },     // cancri55e
  { orbit: 9.3, a0: 5.6, y: -0.1, r: 0.68, pole: [-0.18, 1, -0.08], spin: 0.05 },   // gj504b
];

interface Cam { yaw: number; pitch: number; dist: number; t: V3; sx: number; sy: number; }
interface Flight { t0: number; dur: number; camFrom: Cam; camTo: () => Cam; planet: number; shipTo: 'planet' | 'idle'; p0: V3; d0: V3; scale0: number; }
interface ShipState { pos: V3; q: Quat; scale: number; mode: 'idle' | 'flight' | 'parked'; at: number; fwd: V3; bank: number; }

const hexToRgb = (hex: string): V3 => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

// ---- galaxy point cloud ------------------------------------------------------------------------------------------------
function makeGalaxy() {
  const rand = rng(20240607);
  const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += rand(); return (s - 2) * 1.7; };
  const N = 30000, DUST = 900;
  const pos = new Float32Array((N + DUST) * 3), dat = new Float32Array((N + DUST) * 4);
  const put = (i: number, x: number, y: number, z: number, size: number, bright: number, rn: number) => {
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    dat[i * 4] = size; dat[i * 4 + 1] = bright; dat[i * 4 + 2] = rn; dat[i * 4 + 3] = rand();
  };
  const spiral = (r: number, arm: number) => arm * Math.PI + 3.2 * Math.log(1 + r / 2.2);
  for (let i = 0; i < N; i++) {
    const size = 0.022 + 0.085 * Math.pow(rand(), 3.5);
    if (i < N * 0.2) {   // bulge
      const rad = 2.4 * Math.pow(rand(), 1.8), th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1);
      put(i, rad * Math.sin(ph) * Math.cos(th), rad * Math.cos(ph) * 0.62, rad * Math.sin(ph) * Math.sin(th), size * 1.1, 0.35 + 0.65 * rand(), rad / GALAXY_R);
      continue;
    }
    let r = -0.34 * GALAXY_R * Math.log(1 - rand() * 0.985);
    if (r > GALAXY_R) r = rand() * GALAXY_R;
    r = Math.max(r, 0.3);
    const inArm = rand() < 0.78;
    const arm = Math.floor(rand() * 2);
    let th = inArm ? spiral(r, arm) + gauss() * (0.13 + 0.05 * Math.sqrt(r)) / Math.max(0.35, Math.sqrt(r) * 0.55) : rand() * Math.PI * 2;
    const y = gauss() * (0.07 + 0.3 * Math.exp(-r / 2.6));
    put(i, Math.cos(th) * r, y, Math.sin(th) * r, size, (inArm ? 0.45 : 0.22) + 0.55 * rand(), r / GALAXY_R);
  }
  for (let j = 0; j < DUST; j++) {   // soft nebular sprites hugging the arms
    const r = 1.5 + rand() * (GALAXY_R - 2), arm = Math.floor(rand() * 2);
    const th = spiral(r, arm) + gauss() * 0.16;
    put(N + j, Math.cos(th) * r, gauss() * 0.14, Math.sin(th) * r, 1.0 + rand() * 1.9, 0.012 + 0.02 * rand(), r / GALAXY_R);
  }
  return { pos, dat, n: N, dust: DUST };
}

function makeBackdrop() {
  const rand = rng(777), N = 2600;
  const pos = new Float32Array(N * 3), dat = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const th = rand() * Math.PI * 2, y = 2 * rand() - 1, s = Math.sqrt(1 - y * y);
    pos.set([Math.cos(th) * s * 60, y * 60, Math.sin(th) * s * 60], i * 3);
    dat.set([0.7 + 1.5 * Math.pow(rand(), 3), 0.2 + 0.6 * Math.pow(rand(), 2), 0.5, rand()], i * 4);
  }
  return { pos, dat, n: N };
}

// ---- helpers -----------------------------------------------------------------------------------------------------------
const mat3mul = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  const o = new Float32Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  return o;
};
const mat3T = (a: ArrayLike<number>) => new Float32Array([a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]);
const rotateY3 = (v: V3, a: number): V3 => { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]; };
const bezier = (p0: V3, p1: V3, p2: V3, p3: V3, s: number): V3 => {
  const u = 1 - s, a = u * u * u, b = 3 * u * u * s, c = 3 * u * s * s, d = s * s * s;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1], a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2]];
};
const bezierD = (p0: V3, p1: V3, p2: V3, p3: V3, s: number): V3 => {
  const u = 1 - s, a = 3 * u * u, b = 6 * u * s, c = 3 * s * s;
  return [a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]), a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1]), a * (p1[2] - p0[2]) + b * (p2[2] - p1[2]) + c * (p3[2] - p2[2])];
};

/** Orientation with nose along `fwd` (canonical -Z), up hint, and a roll (bank) about the nose. */
const frameQuat = (fwd: V3, upHint: V3, bank: number): Quat => {
  const back = v3.scale(v3.norm(fwd), -1);
  let right = v3.cross(upHint, back);
  if (v3.len(right) < 1e-4) right = v3.cross([1, 0, 0], back);
  right = v3.norm(right);
  const up = v3.cross(back, right);
  return quat.mul(quat.fromBasis(right, up, back), quat.fromAxisAngle([0, 0, -1], bank));
};

// ---- the scene ---------------------------------------------------------------------------------------------------------
interface Instance { dispose: () => void; root: HTMLElement; }
let current: Instance | null = null;

function init() {
  const root = document.querySelector<HTMLElement>('[data-sf]');
  if (!root || current?.root === root) return;
  current?.dispose();
  current = start(root);
}

function start(root: HTMLElement): Instance {
  const q = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const canvas = q<HTMLCanvasElement>('[data-sf-canvas]');
  const ac = new AbortController();
  const sig = { signal: ac.signal };
  const live = q('[data-sf-live]');
  const panel = q('[data-sf-panel]');
  const label = q('[data-sf-label]');
  const buttons = THEMES.map((t) => q<HTMLButtonElement>(`[data-sf-planet="${t.id}"]`));
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  let loop: ReturnType<typeof createRenderer>;
  let reduced = prefersReducedMotion();
  let debug = location.search.includes('debug-starfield');

  // ----- theme-bound UI (works with and without WebGL) -----
  const useButtons = () => [...root.querySelectorAll<HTMLButtonElement>('[data-use-theme], [data-sf-use]')];
  const refreshUse = () => {
    const active = getTheme().id;
    for (const b of useButtons()) {
      const id = b.dataset.useTheme ?? b.dataset.sfUseId ?? '';
      const on = id === active;
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? 'Active theme' : 'Use this theme';
      b.disabled = false;
    }
  };
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-use-theme], [data-sf-use]');
    if (!b) return;
    const id = b.dataset.useTheme ?? b.dataset.sfUseId;
    if (id) { setTheme(id); refreshUse(); }
  }, sig);
  refreshUse();

  const attrs: WebGLContextAttributes = { alpha: false, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, powerPreference: 'default' };
  const gl = ((canvas.getContext('webgl2', attrs) ?? canvas.getContext('webgl', attrs)) as GL | null);
  const fail = (why: unknown) => {
    if (why) console.warn('starfield: WebGL unavailable, showing the static fallback', why);
    root.dataset.fallback = '';
    return { root, dispose: () => ac.abort() };
  };
  if (!gl) return fail(null);

  let planetProg: Program, starProg: Program, glowProg: Program, lineProg: Program;
  let ship: Ship;
  try {
    planetProg = createProgram(gl, PLANET_VS, PLANET_FS);
    starProg = createProgram(gl, STAR_VS, STAR_FS);
    glowProg = createProgram(gl, GLOW_VS, GLOW_FS);
    lineProg = createProgram(gl, LINE_VS, LINE_FS);
    ship = createShip(gl);
  } catch (e) { return fail(e); }

  const tri = createFullscreenTriangle(gl);
  const galaxy = makeGalaxy(), back = makeBackdrop();
  const gPos = createBuffer(gl, galaxy.pos), gDat = createBuffer(gl, galaxy.dat);
  const bPos = createBuffer(gl, back.pos), bDat = createBuffer(gl, back.dat);
  const circ = new Float32Array(130);
  for (let i = 0; i <= 64; i++) { circ[i * 2] = Math.cos((i / 64) * Math.PI * 2); circ[i * 2 + 1] = Math.sin((i / 64) * Math.PI * 2); }
  const circBuf = createBuffer(gl, circ);
  const GLOW_MAX = 200;
  const glowBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, glowBuf);
  gl.bufferData(gl.ARRAY_BUFFER, GLOW_MAX * 5 * 4, gl.DYNAMIC_DRAW);
  const glowData = new Float32Array(GLOW_MAX * 5);
  const maxPt = Math.min(256, (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1] || 64);
  const maxVp = (gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array)[0] || 4096;
  const themeVecs = THEMES.map((t) => themeVec(t));

  // ----- state -----
  let W = 1, H = 1, dpr = 1;
  let mode: 'galaxy' | 'focus' = 'galaxy';
  let focusIdx = -1;
  let gAng = 0.4, rotMix = 1;
  let gYaw = DEF_YAW, gPitch = DEF_PITCH, gDist = DEF_DIST, gDistT = DEF_DIST;
  let yawV = 0, pitchV = 0;
  let zoomCur = 1, zoomT = 1;
  let userQ: Quat = quat.identity(), spin = [0, 0], resetAnim: { t0: number; from: Quat } | null = null;
  const planetQ: Quat[] = THEMES.map(() => quat.identity());
  let flight: Flight | null = null;
  let hover = -1, kbFocus = -1;
  let ptr = [0, 0];
  let lastT = 0, time = 0, firstFrame = false;
  let cam: Cam = { yaw: gYaw, pitch: gPitch, dist: gDist, t: [0, 0, 0], sx: 0, sy: 0 };
  let view = m4.identity(), proj = m4.identity(), vp = m4.identity(), eye: V3 = [0, 0, 1], viewRot = new Float32Array(9);
  let camRight: V3 = [1, 0, 0], camUp: V3 = [0, 1, 0], camFwd: V3 = [0, 0, -1];
  const shipS: ShipState = { pos: [0, 0, 0], q: quat.identity(), scale: 0.4, mode: 'idle', at: -1, fwd: [0, 0, -1], bank: 0 };
  const trails: { p: V3; born: number }[] = [];
  let lastTrail = 0;
  const tint = createBlend([...getTheme().gl.nebulaA, ...getTheme().gl.nebulaB, ...getTheme().gl.astronautAccent, ...hexToRgb(getTheme().palette.paper)], 900);
  watchTheme((t: PlanetTheme) => { tint.to([...t.gl.nebulaA, ...t.gl.nebulaB, ...t.gl.astronautAccent, ...hexToRgb(t.palette.paper)], reduced || !firstFrame); loop?.invalidate(); refreshUse(); }, ac.signal);

  const distMax = () => DIST_MAX * (W / H < 1 ? 1.5 : 1);
  const fpx = () => (H / 2) / Math.tan(FOV / 2);
  const dprNow = () => (mode === 'focus' || flight ? 1.5 : 1.25);

  // ----- planets -----
  const pAngle = (j: number) => DEFS[j].a0 + gAng * (4.5 / DEFS[j].orbit);
  const planetPos = (j: number): V3 => { const d = DEFS[j], a = pAngle(j); return [Math.cos(a) * d.orbit, d.y, Math.sin(a) * d.orbit]; };
  const lightDirOf = (j: number): V3 => v3.norm(v3.sub(CORE, planetPos(j)));
  const orbitBasis = (): [V3, V3] => { const n = v3.norm([0.35, 1, 0.2]); const u = v3.norm(v3.cross(n, [0, 0, 1])); return [u, v3.cross(n, u)]; };
  const [oU, oV] = orbitBasis();
  const ORBIT_W = 0.28;
  const parkPhase = (j: number, tt: number) => j * 1.7 + (reduced ? 0.6 : ORBIT_W * tt);
  const parkPos = (j: number, tt: number): V3 => {
    const ro = DEFS[j].r * 1.75, ph = parkPhase(j, tt), c = planetPos(j);
    return [c[0] + ro * (Math.cos(ph) * oU[0] + Math.sin(ph) * oV[0]), c[1] + ro * (Math.cos(ph) * oU[1] + Math.sin(ph) * oV[1]), c[2] + ro * (Math.cos(ph) * oU[2] + Math.sin(ph) * oV[2])];
  };
  const parkTan = (j: number, tt: number): V3 => { const ph = parkPhase(j, tt); return v3.norm([-Math.sin(ph) * oU[0] + Math.cos(ph) * oV[0], -Math.sin(ph) * oU[1] + Math.cos(ph) * oV[1], -Math.sin(ph) * oU[2] + Math.cos(ph) * oV[2]]); };
  const parkScale = (j: number) => DEFS[j].r * 0.4;

  // ----- camera -----
  const occupied = () => {
    const wide = W >= 900;
    const pw = wide ? Math.min(PANEL_W, W * 0.45) : 0;
    const ph = wide ? 0 : Math.min(panel.offsetHeight || H * 0.42, H * 0.52) + 40;
    return { pw, ph };
  };
  const galaxyCam = (): Cam => ({ yaw: gYaw, pitch: gPitch, dist: gDist, t: [0, 0, 0], sx: 0, sy: 0 });
  const closeCam = (j: number): Cam => {
    const { pw, ph } = occupied();
    const avail = Math.max(120, Math.min(W - pw, H - ph));
    const rpx = 0.3 * avail;
    const dist = (DEFS[j].r * fpx()) / rpx / zoomCur;
    const L = lightDirOf(j), side = rotateY3([L[0], 0, L[2]], 1.22), n = v3.norm([side[0], 0.34, side[2]]);
    return { yaw: Math.atan2(n[0], n[2]), pitch: Math.asin(n[1]), dist, t: planetPos(j), sx: -pw / W, sy: ph / H };
  };
  const blendCam = (a: Cam, b: Cam, e: number): Cam => ({
    yaw: a.yaw + angDiff(a.yaw, b.yaw) * e, pitch: lerp(a.pitch, b.pitch, e), dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), e)),
    t: v3.lerp(a.t, b.t, e), sx: lerp(a.sx, b.sx, e), sy: lerp(a.sy, b.sy, e),
  });
  const applyCam = (c: Cam) => {
    cam = c;
    const cp = Math.cos(c.pitch);
    eye = [c.t[0] + c.dist * cp * Math.sin(c.yaw), c.t[1] + c.dist * Math.sin(c.pitch), c.t[2] + c.dist * cp * Math.cos(c.yaw)];
    view = m4.lookAt(eye, c.t);
    proj = m4.perspective(FOV, W / H, NEAR, FAR, c.sx, c.sy);
    vp = m4.mul(proj, view);
    camRight = [view[0], view[4], view[8]]; camUp = [view[1], view[5], view[9]]; camFwd = [-view[2], -view[6], -view[10]];
    viewRot = new Float32Array([view[0], view[1], view[2], view[4], view[5], view[6], view[8], view[9], view[10]]);
  };
  const viewDir = (d: V3): V3 => [viewRot[0] * d[0] + viewRot[3] * d[1] + viewRot[6] * d[2], viewRot[1] * d[0] + viewRot[4] * d[1] + viewRot[7] * d[2], viewRot[2] * d[0] + viewRot[5] * d[1] + viewRot[8] * d[2]];

  /** World point -> css px + depth. */
  const project = (p: V3) => { const c = m4.point(vp, p); return { x: (c[0] / c[3] * 0.5 + 0.5) * W, y: (0.5 - c[1] / c[3] * 0.5) * H, w: c[3] }; };

  // ----- ship -----
  const idleScale = () => (0.14 * Math.min(W, H) * 3.2) / fpx() * (W < 700 ? 1.15 : 1);
  const idleWorld = (): V3 => {
    const d = 3.2, hh = d * Math.tan(FOV / 2), hw = hh * (W / H);
    const x = hw * (W < 700 ? 0.5 : 0.6), y = -hh * 0.56;
    return v3.add(eye, v3.add(v3.add(v3.scale(camRight, x), v3.scale(camUp, y)), v3.scale(camFwd, d)));
  };
  const idleDir = (): V3 => {
    const fc: V3 = v3.norm([-0.5 + ptr[0] * 0.28, 0.16 - ptr[1] * 0.16, -1]);
    return v3.add(v3.add(v3.scale(camRight, fc[0]), v3.scale(camUp, fc[1])), v3.scale(camFwd, -fc[2]));
  };
  const setShipPark = (j: number) => {
    shipS.mode = 'parked'; shipS.at = j; shipS.pos = parkPos(j, time); shipS.scale = parkScale(j);
    shipS.fwd = parkTan(j, time); shipS.q = frameQuat(shipS.fwd, [0, 1, 0], 0); shipS.bank = 0;
  };
  const setShipIdle = () => {
    shipS.mode = 'idle'; shipS.at = -1; shipS.pos = idleWorld(); shipS.scale = idleScale();
    shipS.fwd = v3.norm(idleDir()); shipS.q = frameQuat(shipS.fwd, camUp, 0); shipS.bank = 0;
  };

  const updateShip = (dt: number) => {
    const s = shipS;
    let target: V3 = s.pos, fwd = s.fwd, up: V3 = [0, 1, 0], bankT = 0;
    if (s.mode === 'idle') {
      const bob = reduced ? 0 : Math.sin(time * 1.1) * 0.045 * idleScale() * 6;
      target = v3.madd(idleWorld(), camUp, bob);
      s.scale = idleScale();
      fwd = v3.norm(idleDir()); up = camUp;
      bankT = reduced ? 0 : Math.sin(time * 0.8) * 0.12 + Math.sin(time * 0.37) * 0.05;
      if (!reduced) fwd = v3.norm(v3.madd(fwd, camRight, Math.sin(time * 0.6) * 0.03));
      s.pos = v3.lerp(s.pos, target, reduced || dt > 0.2 ? 1 : 1 - Math.exp(-dt * 14));
    } else if (s.mode === 'parked') {
      s.pos = parkPos(s.at, time); s.scale = parkScale(s.at); fwd = parkTan(s.at, time);
    } else if (flight) {
      const f = flight, el = time - f.t0, sp = clamp(el / (f.dur * 0.86)), e = easeInOut(sp);
      const p3 = f.shipTo === 'planet' ? parkPos(f.planet, time + f.dur * 0.1) : idleWorld();
      const endDir = f.shipTo === 'planet' ? parkTan(f.planet, time) : v3.norm(v3.add(camFwd, v3.scale(camRight, -0.3)));
      const len = v3.len(v3.sub(p3, f.p0));
      const p1 = v3.madd(f.p0, f.d0, len * 0.4), p2 = v3.madd(p3, endDir, -len * 0.4);
      s.pos = bezier(f.p0, p1, p2, p3, e);
      fwd = v3.norm(bezierD(f.p0, p1, p2, p3, clamp(e, 0.001, 0.999)));
      s.scale = lerp(f.scale0, f.shipTo === 'planet' ? parkScale(f.planet) : idleScale(), e);
      if (sp >= 1) { if (f.shipTo === 'planet') setShipPark(f.planet); else setShipIdle(); }
    }
    // bank into turns
    const turn = angDiff(Math.atan2(s.fwd[0], s.fwd[2]), Math.atan2(fwd[0], fwd[2])) / Math.max(dt, 1 / 120);
    if (s.mode === 'flight') bankT = clamp(-turn * 0.38, -0.85, 0.85);
    s.bank += (bankT - s.bank) * (1 - Math.exp(-dt * 5));
    s.fwd = fwd;
    const tq = frameQuat(fwd, up, s.bank);
    s.q = quat.slerp(s.q, tq, reduced ? 1 : 1 - Math.exp(-dt * 9));
  };

  // ----- flights & focus -----
  const startFlight = (to: 'planet' | 'galaxy', j: number) => {
    const dur = (reduced ? 0 : clamp(1.45 + v3.len(v3.sub(to === 'planet' ? planetPos(j) : eye, shipS.pos)) * 0.045, 1.6, 2.2));
    const camTo = to === 'planet' ? () => closeCam(j) : () => galaxyCam();
    if (reduced) {
      fade(() => {
        flight = null; applyCam(camTo());
        if (to === 'planet') setShipPark(j); else setShipIdle();
        loop.measure();
      });
      return;
    }
    flight = { t0: time, dur, camFrom: cam, camTo, planet: j, shipTo: to === 'planet' ? 'planet' : 'idle', p0: shipS.pos, d0: v3.norm(shipS.fwd), scale0: shipS.scale };
    shipS.mode = 'flight';
    loop.measure();
  };
  let fadeTimer = 0;
  const fade = (mid: () => void) => {
    canvas.style.transition = 'opacity 0.14s linear';
    canvas.style.opacity = '0';
    clearTimeout(fadeTimer);
    fadeTimer = window.setTimeout(() => { mid(); loop.invalidate(); canvas.style.opacity = '1'; fadeTimer = window.setTimeout(() => { canvas.style.transition = ''; }, 200); }, 150);
  };

  const fillPanel = (j: number) => {
    const t = THEMES[j];
    q('[data-sf-kind]').textContent = t.kind;
    q('[data-sf-name]').textContent = t.name;
    q('[data-sf-fact]').textContent = t.fact;
    const sw = q('[data-sf-source-wrap]'), sa = q<HTMLAnchorElement>('[data-sf-source]');
    sw.hidden = !t.source;
    if (t.source) { sa.href = t.source.url; sa.textContent = t.source.label; }
    q<HTMLButtonElement>('[data-sf-use]').dataset.sfUseId = t.id;
    q('[data-sf-prev]').setAttribute('aria-label', `Previous planet: ${THEMES[(j + 3) % 4].name}`);
    q('[data-sf-next]').setAttribute('aria-label', `Next planet: ${THEMES[(j + 1) % 4].name}`);
    refreshUse();
  };
  const setHash = (id: string | null, push: boolean) => {
    const want = id ? '#' + id : '';
    if (location.hash === want) return;
    const url = location.pathname + location.search + want;
    if (push && id) { try { history.pushState(history.state, '', url); } catch { /* ignore */ } }
    else { try { history.replaceState(history.state, '', url); } catch { /* ignore */ } }
  };

  const focusPlanet = (j: number, opts: { fromHash?: boolean; instant?: boolean } = {}) => {
    if (j === focusIdx && mode === 'focus') return;
    const wasFocus = mode === 'focus';
    mode = 'focus'; focusIdx = j;
    root.dataset.mode = 'focus';
    userQ = planetQ[j]; spin = [0, 0]; zoomT = 1; if (!wasFocus) zoomCur = 1;
    fillPanel(j);
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('is-open'));
    root.querySelector('[data-sf-overlay]')?.setAttribute('inert', '');
    hover = -1; label.classList.remove('is-on'); canvas.classList.remove('is-hover');
    if (!opts.fromHash) setHash(THEMES[j].id, !wasFocus);
    else if (!wasFocus) { /* hash already set by the browser */ }
    if (opts.instant) {
      flight = null; rotMix = 0; applyCam(closeCam(j)); setShipPark(j); announce(`Arrived at ${THEMES[j].name}`); loop.measure();
    } else {
      startFlight('planet', j);
      if (reduced) setTimeout(() => announce(`Arrived at ${THEMES[j].name}`), 200);
    }
    loop.invalidate();
  };
  const toGalaxy = (opts: { fromHash?: boolean } = {}) => {
    if (mode === 'galaxy') return;
    planetQ[focusIdx] = userQ;
    mode = 'galaxy';
    const prev = focusIdx; focusIdx = -1;
    delete root.dataset.mode;
    panel.classList.remove('is-open');
    setTimeout(() => { if (mode === 'galaxy') panel.hidden = true; }, 350);
    root.querySelector('[data-sf-overlay]')?.removeAttribute('inert');
    if (!opts.fromHash) setHash(null, false);
    startFlight('galaxy', prev);
    announce('Back to the galaxy view');
    (buttons[prev] as HTMLElement | undefined)?.focus({ preventScroll: true });
    loop.invalidate();
  };
  const announce = (s: string) => { live.textContent = ''; setTimeout(() => { live.textContent = s; }, 50); };
  const step = (d: number) => focusPlanet((focusIdx + d + 4) % 4);

  // ----- input -----
  const pts = new Map<number, { x: number; y: number }>();
  let dragging = false, moved = 0, downT = 0, pinch0 = 0, lastMoveT = 0;
  const hit = (x: number, y: number) => {
    let best = -1, bw = Infinity;
    for (let j = 0; j < 4; j++) {
      const ps = screen[j];
      if (!ps.on) continue;
      const slop = Math.max(12, ps.r * 0.3);
      if (Math.hypot(x - ps.x, y - ps.y) <= ps.r + slop && ps.w < bw) { best = j; bw = ps.w; }
    }
    return best;
  };
  const setHover = (j: number) => {
    if (j === hover) return;
    hover = j;
    canvas.classList.toggle('is-hover', j >= 0);
    loop.invalidate();
  };
  const local = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 1) { dragging = true; moved = 0; downT = performance.now(); yawV = pitchV = 0; spin = [0, 0]; resetAnim = null; canvas.classList.add('is-dragging'); }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); moved = 99; }
    lastMoveT = performance.now();
    loop.invalidate();
  }, sig);
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    ptr = [clamp(p.x / W * 2 - 1, -1, 1), clamp(p.y / H * 2 - 1, -1, 1)];
    const prev = pts.get(e.pointerId);
    if (!prev) { if (mode === 'galaxy' && e.pointerType !== 'touch') setHover(hit(p.x, p.y)); return; }
    pts.set(e.pointerId, p);
    const now = performance.now(), dtm = Math.max(1, now - lastMoveT) / 1000; lastMoveT = now;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) { if (mode === 'galaxy') gDistT = clamp(gDistT * pinch0 / d, DIST_MIN, distMax()); else zoomT = clamp(zoomT * d / pinch0, ZOOM_MIN, zoomMax()); }
      pinch0 = d; loop.invalidate(); return;
    }
    const dx = p.x - prev.x, dy = p.y - prev.y;
    moved += Math.abs(dx) + Math.abs(dy);
    if (mode === 'galaxy') {
      const k = 0.0055 * (reduced ? 1 : 1);
      gYaw -= dx * k; gPitch = clamp(gPitch + dy * k, -0.15, 1.3);
      if (!flight) { yawV = (-dx * k) / dtm * 0.5 + yawV * 0.5; pitchV = (dy * k) / dtm * 0.5 + pitchV * 0.5; }
    } else if (focusIdx >= 0) {
      const r = Math.max(40, screen[focusIdx].r);
      const ang = Math.hypot(dx, dy) / r;
      if (ang > 0) {
        userQ = quat.norm(quat.mul(quat.fromAxisAngle([dy, dx, 0], ang), userQ));
        spin = [(dy / r) / dtm * 0.5 + spin[0] * 0.5, (dx / r) / dtm * 0.5 + spin[1] * 0.5];
      }
    }
    loop.invalidate();
  }, sig);
  const up = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e);
    pts.delete(e.pointerId);
    canvas.classList.remove('is-dragging');
    if (pts.size === 0) {
      dragging = false;
      if (e.type === 'pointerup' && moved < 6 && performance.now() - downT < 600 && mode === 'galaxy') {
        const j = hit(p.x, p.y);
        if (j >= 0) focusPlanet(j);
      }
      if (performance.now() - lastMoveT > 90) { yawV = pitchV = 0; spin = [0, 0]; }
      if (reduced) { yawV = pitchV = 0; spin = [0, 0]; }
      if (e.pointerType === 'touch') setHover(-1);
    } else pinch0 = 0;
    loop.invalidate();
  };
  canvas.addEventListener('pointerup', up, sig);
  canvas.addEventListener('pointercancel', up, sig);
  canvas.addEventListener('pointerleave', () => { if (!dragging) setHover(-1); }, sig);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = Math.exp(clamp(e.deltaY, -120, 120) * 0.0011);
    if (mode === 'galaxy') gDistT = clamp(gDistT * k, DIST_MIN, distMax()); else zoomT = clamp(zoomT / k, ZOOM_MIN, zoomMax());
    loop.invalidate();
  }, { signal: ac.signal, passive: false });
  canvas.addEventListener('dblclick', () => {
    if (mode !== 'focus') return;
    resetAnim = { t0: time, from: userQ }; zoomT = 1; spin = [0, 0];
    if (reduced) { userQ = quat.identity(); resetAnim = null; }
    loop.invalidate();
  }, sig);
  const zoomMax = () => {
    if (focusIdx < 0) return ZOOM_MAX;
    const rpx0 = (0.3 * Math.max(120, Math.min(W, H))) * dprNow();
    return Math.min(ZOOM_MAX, maxVp / (3.1 * rpx0));
  };

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'Escape' && mode === 'focus') { e.preventDefault(); toGalaxy(); return; }
    if (k === '+' || k === '=' || k === '-' || k === '_') {
      e.preventDefault();
      const f = k === '+' || k === '=' ? 1 : -1;
      if (mode === 'galaxy') gDistT = clamp(gDistT * (f > 0 ? 0.88 : 1.14), DIST_MIN, distMax()); else zoomT = clamp(zoomT * (f > 0 ? 1.15 : 0.87), ZOOM_MIN, zoomMax());
      loop.invalidate(); return;
    }
    if (mode === 'focus' && k.startsWith('Arrow')) {
      e.preventDefault();
      const imp = 0.5;
      if (k === 'ArrowLeft') spin[1] -= imp; else if (k === 'ArrowRight') spin[1] += imp; else if (k === 'ArrowUp') spin[0] -= imp; else spin[0] += imp;
      if (reduced) { userQ = quat.norm(quat.mul(quat.fromAxisAngle([spin[0], spin[1], 0], 0.2), userQ)); spin = [0, 0]; }
      loop.invalidate();
    }
  }, sig);

  buttons.forEach((b, j) => {
    b.addEventListener('click', () => focusPlanet(j), sig);
    b.addEventListener('focus', () => { kbFocus = j; loop.invalidate(); }, sig);
    b.addEventListener('blur', () => { if (kbFocus === j) kbFocus = -1; loop.invalidate(); }, sig);
    b.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') setHover(j); }, sig);
  });
  q('[data-sf-prev]').addEventListener('click', () => step(-1), sig);
  q('[data-sf-next]').addEventListener('click', () => step(1), sig);
  q('[data-sf-back]').addEventListener('click', () => toGalaxy(), sig);
  addEventListener('hashchange', () => {
    const id = location.hash.slice(1), j = THEMES.findIndex((t) => t.id === id);
    if (j >= 0) focusPlanet(j, { fromHash: true }); else toGalaxy({ fromHash: true });
  }, sig);
  reducedMq.addEventListener('change', () => { reduced = reducedMq.matches; loop.invalidate(); }, sig);

  // ----- rendering -----
  const screen = DEFS.map(() => ({ x: 0, y: 0, r: 0, w: 1, on: false, depth: 0 }));
  const lastBtn: string[] = ['', '', '', ''];

  const bindStars = (pos: WebGLBuffer, dat: WebGLBuffer) => {
    attrib(gl, starProg.a('aPos'), pos, 3);
    attrib(gl, starProg.a('aD'), dat, 4);
  };
  const glowAttribs = () => {
    attrib(gl, glowProg.a('aPos'), glowBuf, 3, 20, 0);
    attrib(gl, glowProg.a('aA'), glowBuf, 2, 20, 12);
  };

  const draw = (t: number) => {
    const dt = lastT ? clamp(t - lastT, 0.001, 0.05) : 0.016;
    lastT = t; time = t;
    firstFrame = true;
    tint.step();
    const tv = tint.v;

    // ----- update -----
    rotMix += ((mode === 'galaxy' && !flight && !reduced ? 1 : 0) - rotMix) * (1 - Math.exp(-dt * 2.5));
    if (!reduced) gAng += dt * ROT_SPEED * rotMix;
    if (mode === 'galaxy') {
      if (!reduced) { gYaw += yawV * dt; gPitch = clamp(gPitch + pitchV * dt, -0.15, 1.3); const dk = Math.exp(-dt * 3.2); if (!dragging) { yawV *= dk; pitchV *= dk; } }
      gDist = lerp(gDist, gDistT, reduced ? 1 : 1 - Math.exp(-dt * 8));
    } else {
      zoomCur = lerp(zoomCur, zoomT, reduced ? 1 : 1 - Math.exp(-dt * 8));
      const dk = Math.exp(-dt * (reduced ? 12 : 2.4));
      if (!dragging) {
        const w = Math.hypot(spin[0], spin[1]);
        if (w > 0.004) { userQ = quat.norm(quat.mul(quat.fromAxisAngle([spin[0], spin[1], 0], w * dt), userQ)); spin = [spin[0] * dk, spin[1] * dk]; } else spin = [0, 0];
      }
      if (resetAnim) {
        const e = easeInOut(clamp((time - resetAnim.t0) / 0.7));
        userQ = quat.slerp(resetAnim.from, quat.identity(), e);
        if (e >= 1) resetAnim = null;
      }
      if (focusIdx >= 0) planetQ[focusIdx] = userQ;
    }
    // camera
    if (flight) {
      const el = time - flight.t0;
      const e = easeInOutSine(clamp(el / flight.dur));
      applyCam(blendCam(flight.camFrom, flight.camTo(), e));
      if (el >= flight.dur) {
        const f = flight; flight = null;
        if (f.shipTo === 'planet' && mode === 'focus') announce(`Arrived at ${THEMES[f.planet].name}`);
        applyCam(mode === 'focus' ? closeCam(focusIdx) : galaxyCam());
        loop.measure();
      }
    } else applyCam(mode === 'focus' && focusIdx >= 0 ? closeCam(focusIdx) : galaxyCam());
    updateShip(dt);

    // project planets
    const f = fpx();
    DEFS.forEach((d, j) => {
      const p = planetPos(j), s = project(p), r = d.r * f / Math.max(s.w, 0.01);
      const ps = screen[j];
      ps.x = s.x; ps.y = s.y; ps.r = r; ps.w = s.w;
      ps.on = s.w > NEAR * 4 && s.x + r * 1.7 > 0 && s.x - r * 1.7 < W && s.y + r * 1.7 > 0 && s.y - r * 1.7 < H;
    });

    // ----- render -----
    gl.viewport(0, 0, canvas.width, canvas.height);
    const paper: V3 = [tv[9], tv[10], tv[11]];
    gl.clearColor(paper[0], paper[1], paper[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const D = canvas.width / W;   // actual device px per css px

    // stars
    gl.useProgram(starProg.p);
    gl.uniform1f(starProg.u('uF'), f * D);
    gl.uniform1f(starProg.u('uTime'), reduced ? 0 : t);
    gl.uniform1f(starProg.u('uDpr'), D);
    gl.uniform1f(starProg.u('uMaxPt'), Math.min(maxPt, 12 * D));
    gl.uniform1f(starProg.u('uTw'), reduced ? 0 : 1);
    gl.uniform3f(starProg.u('uA'), tv[0], tv[1], tv[2]);
    gl.uniform3f(starProg.u('uB'), tv[3], tv[4], tv[5]);
    gl.uniform3f(starProg.u('uCore'), 1.0, 0.86, 0.62);
    // distant background (rotation only)
    const vr = new Float32Array(view); vr[12] = vr[13] = vr[14] = 0;
    gl.uniformMatrix4fv(starProg.u('uVP'), false, m4.mul(m4.perspective(FOV, W / H, 1, 200, cam.sx, cam.sy), vr));
    gl.uniform1f(starProg.u('uKind'), 2); gl.uniform1f(starProg.u('uGain'), 1);
    bindStars(bPos, bDat);
    gl.drawArrays(gl.POINTS, 0, back.n);
    // galaxy
    gl.uniformMatrix4fv(starProg.u('uVP'), false, m4.mul(vp, m4.rotY(gAng)));
    bindStars(gPos, gDat);
    gl.uniform1f(starProg.u('uKind'), 1); gl.uniform1f(starProg.u('uGain'), 1);
    gl.drawArrays(gl.POINTS, galaxy.n, galaxy.dust);
    gl.uniform1f(starProg.u('uKind'), 0);
    gl.drawArrays(gl.POINTS, 0, galaxy.n);

    // glow points for this frame: core, planets, highlight, engine glows, trail
    let gn = 0;
    const gpush = (p: V3, size: number, a: number) => { glowData.set([p[0], p[1], p[2], size, a], gn * 5); return gn++; };
    const coreIdx = gpush(CORE, 5.2, 0.5), coreIdx2 = gpush(CORE, 1.8, 0.7);
    const pGlow = DEFS.map((d, j) => (screen[j].on && screen[j].r * 5 < maxPt / D * 0.9 ? gpush(planetPos(j), d.r * 5.2, mode === 'focus' && j !== focusIdx ? 0.18 : 0.34) : -1));
    const hl = kbFocus >= 0 && mode === 'galaxy' ? kbFocus : mode === 'galaxy' ? hover : -1;
    const hlIdx = hl >= 0 && screen[hl].on ? gpush(planetPos(hl), DEFS[hl].r * 3.0, 0.95) : -1;
    const shipM = m4.fromRotScaleTrans(quat.toMat3(shipS.q), shipS.scale, shipS.pos);
    const engPts = ship.engines.map((en) => m4.point(shipM, en));
    const engStart = gn;
    const flying = shipS.mode === 'flight';
    const nowS = time;
    if (flying && nowS - lastTrail > 0.028 && !reduced) {
      for (const ep of engPts) trails.push({ p: [ep[0], ep[1], ep[2]], born: nowS });
      lastTrail = nowS;
    }
    while (trails.length && nowS - trails[0].born > 0.9) trails.shift();
    const trailStart = gn;
    for (const tr of trails) { const age = (nowS - tr.born) / 0.9; if (gn < GLOW_MAX - 8) gpush(tr.p, shipS.scale * ship.engineSize * 1.5 * (1 - age * 0.8), 0.55 * Math.pow(1 - age, 1.6)); }
    const trailCount = gn - trailStart;
    const flick = reduced ? 1 : 0.9 + 0.1 * Math.sin(t * 31) + 0.05 * Math.sin(t * 17.3);
    engPts.forEach((ep) => gpush([ep[0], ep[1], ep[2]], shipS.scale * ship.engineSize * 2.2, (flying ? 1 : 0.6) * flick));
    gl.bindBuffer(gl.ARRAY_BUFFER, glowBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, glowData.subarray(0, gn * 5));

    gl.useProgram(glowProg.p);
    gl.uniform1f(glowProg.u('uF'), f * D);
    gl.uniform1f(glowProg.u('uMaxPt'), maxPt);
    glowAttribs();
    gl.uniformMatrix4fv(glowProg.u('uVP'), false, vp);
    gl.uniform1f(glowProg.u('uMode'), 0);
    gl.uniform3f(glowProg.u('uColor'), 1.0, 0.78, 0.5);
    gl.drawArrays(gl.POINTS, coreIdx, 1);
    gl.uniform3f(glowProg.u('uColor'), 1.0, 0.92, 0.75);
    gl.drawArrays(gl.POINTS, coreIdx2, 1);

    // orbit rings
    gl.useProgram(lineProg.p);
    gl.uniformMatrix4fv(lineProg.u('uVP'), false, vp);
    attrib(gl, lineProg.a('aC'), circBuf, 2);
    gl.uniform3f(lineProg.u('uColor'), tv[0] * 0.7 + 0.3, tv[1] * 0.7 + 0.3, tv[2] * 0.7 + 0.3);
    DEFS.forEach((d, j) => {
      gl.uniform1f(lineProg.u('uRad'), d.orbit);
      gl.uniform1f(lineProg.u('uY'), d.y);
      gl.uniform1f(lineProg.u('uAlpha'), (mode === 'focus' ? 0.08 : j === hl ? 0.34 : 0.16));
      gl.drawArrays(gl.LINE_STRIP, 0, 65);
    });

    // planets and the ship, far to near
    type Item = { kind: 'planet' | 'ship'; j: number; w: number };
    const items: Item[] = [];
    DEFS.forEach((_, j) => { if (screen[j].on) items.push({ kind: 'planet', j, w: screen[j].w }); });
    const sc = project(shipS.pos);
    items.push({ kind: 'ship', j: -1, w: sc.w });
    items.sort((a, b) => b.w - a.w);

    for (const it of items) {
      if (it.kind === 'planet') {
        const j = it.j, ps = screen[j];
        if (pGlow[j] >= 0) {
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(glowProg.p); glowAttribs();
          gl.uniform1f(glowProg.u('uMode'), 0);
          const g = THEMES[j].gl.atmosphere;
          gl.uniform3f(glowProg.u('uColor'), g[0], g[1], g[2]);
          gl.drawArrays(gl.POINTS, pGlow[j], 1);
        }
        drawPlanet(j, ps, t, D);
      } else {
        drawShip(shipM, trailStart, trailCount, engStart, tv);
      }
    }
    if (hlIdx >= 0) {
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(glowProg.p); glowAttribs();
      gl.uniform1f(glowProg.u('uMode'), 1);
      const a = THEMES[hl].palette.accent; const c = hexToRgb(a);
      gl.uniform3f(glowProg.u('uColor'), c[0], c[1], c[2]);
      gl.drawArrays(gl.POINTS, hlIdx, 1);
    }

    // ----- DOM overlay -----
    updateDom();
    if (!document.documentElement.dataset.sfReady) document.documentElement.dataset.sfReady = '1';
    if (!loaded) { loaded = true; lazyShip(); }
    if (debug) (window as any).__sf = { screen, cam, mode, focusIdx, shipS, flight: !!flight };
  };

  const drawPlanet = (j: number, ps: { x: number; y: number; r: number }, t: number, D: number) => {
    const rd = ps.r * D, S = Math.ceil(2 * 1.55 * rd);
    if (S > maxVp || S < 2) return;
    const v = themeVecs[j];
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(planetProg.p);
    attrib(gl, planetProg.a('aPos'), tri, 2);
    const x0 = Math.round(ps.x * D - S / 2), y0 = Math.round((H - ps.y) * D - S / 2);
    gl.viewport(x0, y0, S, S);
    const u = planetProg.u;
    gl.uniform2f(u('uRes'), S, S);
    gl.uniform2f(u('uOrg'), x0, y0);
    gl.uniform1f(u('uPx'), rd);
    gl.uniform1f(u('uR'), rd);
    gl.uniform1f(u('uOct'), clamp(2.0 + 1.15 * Math.log2(Math.max(rd, 20) / 40), 3, 6));
    gl.uniform1f(u('uRot'), 0.5 * j + (reduced ? 0 : t * DEFS[j].spin));
    gl.uniform1f(u('uDrift'), reduced ? 0.3 * j : t * 0.022 + 1.7 * j);
    gl.uniform1f(u('uTime'), reduced ? 4 + j : t);
    gl.uniform1f(u('uRing'), 0.36 * v[18]);
    const N = v3.norm(viewDir(DEFS[j].pole));
    gl.uniform3f(u('uN'), N[0], N[1], N[2]);
    const L = viewDir(lightDirOf(j));
    gl.uniform3f(u('uL'), L[0], L[1], L[2]);
    gl.uniform3f(u('uA'), v[0], v[1], v[2]);
    gl.uniform3f(u('uB'), v[3], v[4], v[5]);
    gl.uniform3f(u('uH'), v[6], v[7], v[8]);
    gl.uniform3f(u('uE'), v[9], v[10], v[11]);
    gl.uniform3f(u('uAtm'), v[12], v[13], v[14]);
    gl.uniform3f(u('uRC'), v[15], v[16], v[17]);
    gl.uniform4f(u('uW'), v[19], v[20], v[21], v[22]);
    const q2 = j === focusIdx ? userQ : planetQ[j];
    const has = q2[0] !== 0 || q2[1] !== 0 || q2[2] !== 0;
    gl.uniform1f(u('uOrientOn'), has ? 1 : 0);
    if (has) {
      const T1 = v3.norm(v3.cross(N, [0, 0, 1])), T2 = v3.cross(N, T1);
      const B = new Float32Array([T1[0], T1[1], T1[2], N[0], N[1], N[2], T2[0], T2[1], T2[2]]);
      const R = quat.toMat3(quat.conj(q2));
      gl.uniformMatrix3fv(u('uOrient'), false, mat3mul(mat3T(B), mat3mul(R, B)));
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const drawShip = (model: Mat4, trailStart: number, trailCount: number, engStart: number, tv: ArrayLike<number>) => {
    const acc: V3 = [tv[6], tv[7], tv[8]];
    gl.disable(gl.BLEND);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
    const ld = v3.norm(v3.sub(CORE, shipS.pos));
    ship.draw({ viewProj: vp, model, eye, lightDir: ld, lightColor: [1.25, 1.1, 0.95], accent: acc });
    // engine glow + trail: additive, depth-tested against the ship but not written
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.useProgram(glowProg.p); glowAttribs();
    gl.uniform1f(glowProg.u('uMode'), 0);
    const eng: V3 = [0.55 + acc[0] * 0.5, 0.75 + acc[1] * 0.3, 0.95 + acc[2] * 0.1];
    gl.uniform3f(glowProg.u('uColor'), eng[0] * 0.8, eng[1] * 0.8, eng[2] * 0.8);
    if (trailCount > 0) gl.drawArrays(gl.POINTS, trailStart, trailCount);
    gl.uniform3f(glowProg.u('uColor'), eng[0], eng[1], eng[2]);
    gl.drawArrays(gl.POINTS, engStart, ship.engines.length);
    gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
  };

  let loaded = false;
  const renderCredit = () => {
    const c = SHIP_CREDIT, el = root.querySelector<HTMLElement>('[data-sf-credit]');
    if (!c || !el) return;
    const a = (text: string, href?: string) => { if (!href) return document.createTextNode(text); const l = document.createElement('a'); l.href = href; l.target = '_blank'; l.rel = 'noreferrer'; l.textContent = text; return l; };
    el.replaceChildren('Ship: ', a(`\u201c${c.title}\u201d`, c.sourceUrl), ' by ', a(c.author, c.authorUrl), ', ', a(c.license, c.licenseUrl), c.note ? `. ${c.note}` : '.');
    el.hidden = false;
  };
  const lazyShip = () => {
    const go = () => ship.load().then((ok) => {
      if (ac.signal.aborted) return;
      if (!ok) return;
      renderCredit();
      loop.invalidate();
    });
    if ('requestIdleCallback' in window) (window as any).requestIdleCallback(go, { timeout: 1500 }); else setTimeout(go, 400);
  };

  const updateDom = () => {
    const showBtn = mode === 'galaxy';
    for (let j = 0; j < 4; j++) {
      const ps = screen[j], b = buttons[j];
      const on = showBtn && ps.on;
      b.classList.toggle('is-on', on);
      if (!on) continue;
      const size = Math.max(36, ps.r * 2 + 16);
      const s = `${(ps.x - size / 2).toFixed(1)}|${(ps.y - size / 2).toFixed(1)}|${size.toFixed(0)}`;
      if (s !== lastBtn[j]) { lastBtn[j] = s; b.style.width = b.style.height = size.toFixed(0) + 'px'; b.style.transform = `translate(${(ps.x - size / 2).toFixed(1)}px, ${(ps.y - size / 2).toFixed(1)}px)`; }
    }
    const hl = mode === 'galaxy' ? (kbFocus >= 0 ? kbFocus : hover) : -1;
    if (hl >= 0 && screen[hl].on) {
      if (label.dataset.j !== String(hl)) { label.dataset.j = String(hl); q('[data-sf-label-name]').textContent = THEMES[hl].name; q('[data-sf-label-kind]').textContent = THEMES[hl].kind; }
      const ps = screen[hl];
      const lw = label.offsetWidth || 120;
      const lx = clamp(ps.x - lw / 2, 8, W - lw - 8), ly = Math.max(8, ps.y - ps.r - 14 - (label.offsetHeight || 40));
      label.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px)`;
      label.classList.add('is-on');
    } else { label.classList.remove('is-on'); delete label.dataset.j; }
  };

  // ----- loop -----
  loop = createRenderer(canvas, {
    resize: (w, h, d) => { W = w; H = h; dpr = d; },
    draw,
    animated: () => {
      if (flight || dragging) return true;
      if (reduced) return false;
      return true;   // galaxy rotation, twinkle, ship bob
    },
    fps: 60,
    idleFps: 30,
    get maxDpr() { return dprNow(); },
  });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); root.dataset.fallback = ''; }, sig);

  // initial state (deep link or galaxy)
  loop.measure();
  if (W / H < 1) { gDist = gDistT = DEF_DIST * 1.45; }
  const hashJ = THEMES.findIndex((t) => '#' + t.id === location.hash);
  applyCam(galaxyCam());
  if (hashJ >= 0) focusPlanet(hashJ, { fromHash: true, instant: true });
  else setShipIdle();
  loop.invalidate();
  if (debug) (window as any).__sfCtl = { focus: (j: number) => focusPlanet(j), galaxy: () => toGalaxy(), loop, set: (o: any) => { Object.assign(o, {}); }, setTime: (x: number) => { time = x; } };

  return {
    root,
    dispose: () => {
      ac.abort();
      loop.dispose();
      clearTimeout(fadeTimer);
      try {
        ship.dispose();
        for (const b of [gPos, gDat, bPos, bDat, circBuf, glowBuf, tri]) gl.deleteBuffer(b);
        for (const p of [planetProg, starProg, glowProg, lineProg]) gl.deleteProgram(p.p);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch { /* context already gone */ }
      delete root.dataset.mode;
      document.documentElement.removeAttribute('data-sf-ready');
    },
  };
}

// Astro: module scripts run once, so initialise per page-load and tear down before the DOM is swapped.
document.addEventListener('astro:page-load', init);
document.addEventListener('astro:before-swap', () => { current?.dispose(); current = null; });
init();
