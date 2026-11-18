// The Starfield fighter as the GitHub pulse invader: one fixed, click-through WebGL canvas over the page.
// World units are CSS px with y up; the camera is placed so the z = 0 plane lines up exactly with the viewport,
// which lets the ship aim at DOM squares. Deep space is far down -z, so arriving reads as diving out of the starfield.
// While hunting it parks close to the camera off the grid's lower-right corner, nose into the screen: a chase view
// that shares the reader's point of view, with the laser travelling into depth to hit each square.
import { createProgram, type GL, type Program } from './gl/gl';
import { clamp, easeInOut, lerp, m4, quat, smoothstep, v3, type Mat4, type Quat, type V3 } from './gl/math';
import { createShip, type Ship } from './gl/ship';
import { watchTheme } from './gl/themeGl';
import type { Aim, Pilot } from './invader';

const FOV = (38 * Math.PI) / 180;
const SHIP_LEN = 50;
/** Apparent scale at the chase position; > 1 puts the ship in front of the page plane, toward the reader. */
const CHASE_SCALE = 2.3;
/** Keeps the nose nearly level while aiming (the beam covers the rest) so the camera looks down on the ship's back. */
const AIM_PITCH = 0.3;
/** Nose-down dip (as a slope against depth) that tips the ship's back toward the camera. */
const CHASE_DIP = 0.38;
/** How far the chase position leans toward the current target (0 = fixed in the corner). */
const CHASE_FOLLOW = 0.14;
/** Max nose error (radians) before the ship may fire. */
const AIM_TOLERANCE = 0.04;
/** Apparent size (relative to the screen plane) where the ship appears out of, and vanishes back into, deep space. */
const SPAWN_SCALE = 0.025;
const GONE_SCALE = 0.02;
const ENTER_MS = 1700;
const LEAVE_MS = 1300;
const SWOOP_PX = 90;
const HUNT_STIFFNESS = 40;
const MAX_SPEED = 2600;
const TRAIL_LIFE = 0.7;
const GLOW_MAX = 256;
const LIGHT = v3.norm([-0.35, 0.8, 0.6]);

const GLOW_VS = `
attribute vec3 aP; attribute vec2 aSA;
uniform mat4 uVP; uniform float uDpr;
varying float vA;
void main() { gl_Position = uVP * vec4(aP, 1.0); gl_PointSize = aSA.x * uDpr; vA = aSA.y; }`;
const GLOW_FS = `
precision mediump float;
uniform vec3 uC;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float g = exp(-d * d * 3.5) * (1.0 - smoothstep(0.75, 1.0, d)) * vA;
  gl_FragColor = vec4(uC * g, g);
}`;

interface Gfx { canvas: HTMLCanvasElement; gl: GL; ship: Ship; glow: Program; glowBuf: WebGLBuffer; accent: V3; lost: boolean; }
let gfx: Gfx | null = null;
let failed = false;

function setupGfx(): Gfx | null {
  if (failed) return null;
  if (gfx) return gfx.lost ? null : gfx;
  const canvas = document.createElement('canvas');
  canvas.className = 'invader-gl';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '5', pointerEvents: 'none', display: 'none' });
  const attrs: WebGLContextAttributes = { alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, powerPreference: 'default' };
  const gl = (canvas.getContext('webgl2', attrs) ?? canvas.getContext('webgl', attrs)) as GL | null;
  if (!gl) { failed = true; return null; }
  try {
    const ship = createShip(gl);
    const glow = createProgram(gl, GLOW_VS, GLOW_FS);
    const glowBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, glowBuf);
    gl.bufferData(gl.ARRAY_BUFFER, GLOW_MAX * 5 * 4, gl.DYNAMIC_DRAW);
    gfx = { canvas, gl, ship, glow, glowBuf, accent: [0.3, 0.95, 0.85], lost: false };
    const g = gfx;
    watchTheme((t) => { g.accent = [...t.gl.astronautAccent] as V3; });
    ship.load().catch(() => false);
    canvas.addEventListener('webglcontextlost', () => { g.lost = true; failed = true; canvas.style.display = 'none'; });
    return gfx;
  } catch (e) {
    console.warn('invader: WebGL setup failed, using the 2D sprite', e);
    failed = true;
    return null;
  }
}

export function createGlPilot(): Pilot | null {
  const g = setupGfx();
  if (!g) return null;
  const { canvas, gl, ship, glow, glowBuf } = g;

  let W = 1, H = 1, D = 1, dpr = 1;
  let vp: Mat4 = m4.identity();
  let eye: V3 = [0, 0, 1];
  let p: V3 = [0, 0, 0];
  let vel: V3 = [0, 0, 0];
  let q: Quat = quat.identity();
  let state: 'enter' | 'hunt' | 'leave' | 'gone' = 'gone';
  let t0 = 0;
  let from = { x: 0, y: 0, s: 1 };
  const trails: { p: V3; born: number }[] = [];
  let lastTrail = 0;
  const glowData = new Float32Array(GLOW_MAX * 5);

  const layout = () => {
    if (!canvas.isConnected) document.body.append(canvas);
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    const d = Math.min(devicePixelRatio || 1, 2);
    if (w === W && h === H && d === dpr) return;
    const onScreen = D > 1 ? toScreen(p) : null;
    W = w; H = h; dpr = d;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    D = H / 2 / Math.tan(FOV / 2);
    eye = [W / 2, H / 2, D];
    vp = m4.mul(m4.perspective(FOV, W / H, 4, D / Math.min(SPAWN_SCALE, GONE_SCALE) + 1000), m4.lookAt(eye, [W / 2, H / 2, 0], [0, 1, 0]));
    if (onScreen) {
      p = toWorld(onScreen.x, onScreen.y, depthAt(onScreen.s));
      vel = [0, 0, 0];
      trails.length = 0;
    }
  };
  /** Apparent scale of something at depth z, and the inverse. */
  const scaleAt = (z: number) => D / (D - z);
  const depthAt = (s: number) => D - D / s;
  /** World point at depth z that projects onto client pixel (cx, cy). */
  const toWorld = (cx: number, cy: number, z: number): V3 => {
    const k = (D - z) / D;
    return [W / 2 + (cx - W / 2) * k, H / 2 + (H - cy - H / 2) * k, z];
  };
  const toScreen = (pt: V3) => {
    const s = scaleAt(pt[2]);
    return { x: W / 2 + (pt[0] - W / 2) * s, y: H / 2 - (pt[1] - H / 2) * s, s };
  };
  const begin = (next: 'enter' | 'leave', now: number) => { state = next; t0 = now; from = toScreen(p); };
  /** Scripted flight between screen points while the apparent scale changes exponentially (reads as constant zoom). */
  const glide = (dt: number, x: number, y: number, s: number) => {
    const prev = p;
    p = toWorld(x, y, depthAt(s));
    vel = dt ? v3.scale(v3.sub(p, prev), 1 / dt) : [0, 0, 0];
  };

  /** Screen point the ship parks at: just off the grid's lower-right corner, leaning slightly toward the target. */
  const chasePoint = (aim: Aim) => {
    const g = aim.grid;
    const ax = g.right - Math.min(110, g.width * 0.14), ay = Math.min(g.bottom + 60, H - 80);
    return { x: ax + (aim.x - ax) * CHASE_FOLLOW, y: ay + (aim.y - ay) * CHASE_FOLLOW };
  };
  const forward = (): V3 => { const m = quat.toMat3(q); return [-m[6], -m[7], -m[8]]; };
  const aimDir = (at: V3): V3 => { const d = v3.sub(at, p); return v3.norm([d[0], d[1] * AIM_PITCH - Math.abs(d[2]) * CHASE_DIP, d[2]]); };

  const orient = (dt: number, aimAt: V3 | null) => {
    const speed = v3.len(vel);
    const hoverFwd = aimAt ? aimDir(aimAt) : v3.norm([0, -CHASE_DIP, -1]);
    const w = smoothstep(120, 700, speed);
    const f = v3.norm(v3.lerp(hoverFwd, v3.scale(vel, 1 / (speed || 1)), w));
    const hint: V3 = Math.abs(f[1]) > 0.92 ? [0, 0, 1] : [0, 1, 0];
    const right0 = v3.norm(v3.cross(f, hint));
    const up0 = v3.cross(right0, f);
    const roll = clamp(-f[0] * 1.1 - vel[0] * 0.0008, -0.6, 0.6) * (1 - w * 0.5);
    const c = Math.cos(roll), s = Math.sin(roll);
    const right = v3.add(v3.scale(right0, c), v3.scale(up0, s));
    const up = v3.sub(v3.scale(up0, c), v3.scale(right0, s));
    q = quat.slerp(q, quat.fromBasis(right, up, v3.scale(f, -1)), 1 - Math.exp(-7 * dt));
  };

  const draw = (now: number, beamTo: V3 | null) => {
    const t = now / 1000;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const model = m4.fromRotScaleTrans(quat.toMat3(q), SHIP_LEN, p);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
    ship.draw({ viewProj: vp, model, eye, lightDir: LIGHT, lightColor: [1.25, 1.12, 1.0], accent: g.accent });

    const speed = v3.len(vel);
    const engines = ship.engines.map((e) => { const r = m4.point(model, e); return [r[0], r[1], r[2]] as V3; });
    if (speed > 180 && t - lastTrail > 0.024) { for (const e of engines) trails.push({ p: e, born: t }); lastTrail = t; }
    while (trails.length && t - trails[0].born > TRAIL_LIFE) trails.shift();

    let n = 0;
    const perspective = (pt: V3) => D / Math.max(1, D - pt[2]);
    const push = (pt: V3, size: number, a: number) => { if (n < GLOW_MAX) glowData.set([pt[0], pt[1], pt[2], size * perspective(pt), a], (n++) * 5); };
    const engSize = SHIP_LEN * ship.engineSize;
    for (const tr of trails) { const age = (t - tr.born) / TRAIL_LIFE; push(tr.p, engSize * 1.6 * (1 - age * 0.7), 0.5 * Math.pow(1 - age, 1.6)); }
    const trailCount = n;
    const flick = 0.9 + 0.1 * Math.sin(t * 31) + 0.05 * Math.sin(t * 17.3);
    for (const e of engines) push(e, engSize * (speed > 180 ? 2.6 : 2.0), flick);
    const engineCount = n - trailCount;
    let beamCount = 0;
    if (beamTo) {
      const nose = m4.point(model, [0, 0, -0.5]);
      const from: V3 = [nose[0], nose[1], nose[2]];
      const steps = Math.max(8, Math.min(90, Math.round(v3.len(v3.sub(beamTo, from)) / 2.5)));
      for (let i = 0; i <= steps; i++) push(v3.lerp(from, beamTo, i / steps), 7 + Math.sin(t * 60 + i) * 1.2, 0.95);
      push(beamTo, 26 + Math.sin(t * 40) * 4, 1);
      beamCount = n - trailCount - engineCount;
    }

    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.useProgram(glow.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, glowBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, glowData.subarray(0, n * 5));
    const aP = glow.a('aP'), aSA = glow.a('aSA');
    gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(aSA); gl.vertexAttribPointer(aSA, 2, gl.FLOAT, false, 20, 12);
    gl.uniformMatrix4fv(glow.u('uVP'), false, vp);
    gl.uniform1f(glow.u('uDpr'), dpr);
    const a = g.accent;
    const eng: V3 = [0.55 + a[0] * 0.5, 0.75 + a[1] * 0.3, 0.95 + a[2] * 0.1];
    gl.uniform3f(glow.u('uC'), eng[0] * 0.8, eng[1] * 0.8, eng[2] * 0.8);
    if (trailCount) gl.drawArrays(gl.POINTS, 0, trailCount);
    gl.uniform3f(glow.u('uC'), eng[0], eng[1], eng[2]);
    gl.drawArrays(gl.POINTS, trailCount, engineCount);
    if (beamCount) {
      gl.uniform3f(glow.u('uC'), a[0] * 0.7 + 0.3, a[1] * 0.7 + 0.3, a[2] * 0.7 + 0.3);
      gl.drawArrays(gl.POINTS, trailCount + engineCount, beamCount);
    }
    gl.disableVertexAttribArray(aSA);
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
  };

  return {
    enter() {
      layout();
      canvas.style.display = 'block';
      p = toWorld(W * 0.86, H * 0.08, depthAt(SPAWN_SCALE));
      vel = [0, 0, 0];
      state = 'gone';
      trails.length = 0;
      const f = v3.norm(v3.sub(toWorld(W * 0.5, H * 0.5, depthAt(CHASE_SCALE)), p));
      const right = v3.norm(v3.cross(f, [0, 1, 0]));
      q = quat.fromBasis(right, v3.cross(right, f), v3.scale(f, -1));
    },
    fly(dt, now, aim, firing) {
      if (g.lost) return { arrived: false, visible: false };
      layout();
      const chase = aim ? chasePoint(aim) : null;
      const goal = chase ? toWorld(chase.x, chase.y, depthAt(CHASE_SCALE)) : p;

      if (aim && (state === 'gone' || state === 'leave')) begin('enter', now);
      if (!aim && (state === 'enter' || state === 'hunt')) begin('leave', now);

      if (state === 'enter' && chase) {
        const e = clamp((now - t0) / ENTER_MS), k = easeInOut(e);
        const dx = chase.x - from.x, dy = chase.y - from.y, len = Math.hypot(dx, dy) || 1;
        const swoop = Math.sin(Math.PI * k) * SWOOP_PX;
        glide(dt, lerp(from.x, chase.x, k) - (dy / len) * swoop, lerp(from.y, chase.y, k) + (dx / len) * swoop, from.s * Math.pow(CHASE_SCALE / from.s, k));
        if (e >= 1) { state = 'hunt'; vel = [0, 0, 0]; }
      } else if (state === 'hunt') {
        const acc = v3.sub(v3.scale(v3.sub(goal, p), HUNT_STIFFNESS), v3.scale(vel, 2 * Math.sqrt(HUNT_STIFFNESS)));
        vel = v3.madd(vel, acc, dt);
        const speed = v3.len(vel);
        if (speed > MAX_SPEED) vel = v3.scale(vel, MAX_SPEED / speed);
        p = v3.madd(p, vel, dt);
      } else if (state === 'leave') {
        const e = clamp((now - t0) / LEAVE_MS), k = e * e;
        glide(dt, lerp(from.x, W * 0.62, k), lerp(from.y, H * 0.3, k), from.s * Math.pow(GONE_SCALE / from.s, k));
        if (e >= 1) state = 'gone';
      }

      const target = aim ? toWorld(aim.x, aim.y, 0) : null;
      orient(dt, state === 'hunt' ? target : null);
      const visible = state !== 'gone';
      if (visible) draw(now, firing && state === 'hunt' && target ? target : null);
      else canvas.style.display = 'none';
      const settled = state === 'hunt' && v3.len(v3.sub(goal, p)) * CHASE_SCALE < 6 && v3.len(vel) < 120;
      const aligned = !!target && Math.acos(clamp(v3.dot(forward(), aimDir(target)), -1, 1)) < AIM_TOLERANCE;
      return { arrived: settled && aligned, visible };
    },
    hide() {
      canvas.style.display = 'none';
      trails.length = 0;
    },
  };
}
