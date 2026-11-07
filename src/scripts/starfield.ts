import { attrib, createFullscreenTriangle, createProgram, createRenderer, getGL, prefersReducedMotion, type GL, type Program } from './gl/gl';

const STAR_VS = `
attribute vec2 aPos;   // normalised 0..1 position
attribute vec4 aData;  // layer(0..2), size(css px), colour temperature, twinkle seed (0 = steady)
uniform vec2 uRes;     // css px
uniform float uScroll, uTime, uDpr, uDim;
uniform vec2 uPointer; // -1..1, already eased
varying vec3 vCol;
varying float vA;
varying float vSize;
void main() {
  float layer = aData.x;
  float k = layer < 0.5 ? 0.02 : (layer < 1.5 ? 0.05 : 0.09);
  float ptr = layer < 0.5 ? 1.2 : (layer < 1.5 ? 3.0 : 6.0);
  vec2 p = aPos * uRes;
  p.y -= uScroll * k;
  p += uPointer * ptr;
  p = mod(p, uRes);
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
  float sz = aData.y * uDpr;
  gl_PointSize = sz + 2.0;
  float tw = 1.0;
  if (aData.w > 0.0) {
    float period = 3.0 + 4.0 * fract(aData.w * 37.0);
    tw = 1.0 + 0.25 * sin(uTime * 6.2831853 / period + aData.w * 60.0);
  }
  vA = (layer < 0.5 ? 0.5 : (layer < 1.5 ? 0.7 : 0.9)) * tw * uDim;
  vCol = mix(vec3(0.86, 0.86, 1.0), vec3(1.0, 0.93, 0.85), aData.z);
  vSize = sz;
}`;

const STAR_FS = `
precision mediump float;
varying vec3 vCol;
varying float vA;
varying float vSize;
void main() {
  float r = length(gl_PointCoord - 0.5) * (vSize + 2.0);
  float a = (1.0 - smoothstep(vSize * 0.5 - 0.5, vSize * 0.5 + 0.7, r)) * vA;
  gl_FragColor = vec4(vCol * a, a);
}`;

// Warp drive: particles in a tunnel around the view axis, flying toward the viewer.
// z is derived from a per-particle phase and uTravel (integrated speed), so the CPU touches one float per frame.
const WARP_VS = `
attribute vec4 aP;   // angle seed, radius seed, phase 0..1, brightness seed
attribute vec2 aC;   // x: 0 head / 1 tail, y: side -1 / +1
uniform vec2 uRes, uCenter;
uniform float uTravel, uSpeed, uFocal;
varying float vAcross, vHalfW, vAlong, vB;
const float NEAR = 0.25, FAR = 3.2;
float hash(float x) { return fract(sin(x * 12.9898 + 78.233) * 43758.5453); }
void main() {
  float range = FAR - NEAR;
  float u = aP.z * range - uTravel;
  float cyc = floor(u / range);
  float z = NEAR + u - cyc * range;              // decreases as travel grows; respawns at FAR
  float h1 = hash(cyc * 1.37 + aP.w * 91.7), h2 = hash(cyc * 2.11 + aP.y * 57.3 + 3.1);
  float ang = (aP.x + h1) * 6.2831853;
  float rad = 0.08 + 1.5 * sqrt(h2);
  vec2 dir = vec2(cos(ang), sin(ang));
  float zt = z + uSpeed * 0.55;                  // tail sits deeper in the tunnel, shrinking with speed
  vec2 head = uCenter + dir * (rad / z * uFocal);
  vec2 tail = uCenter + dir * (rad / zt * uFocal);
  float near01 = 1.0 - (z - NEAR) / range;
  float w = 0.7 + 1.1 * near01 * near01;
  float hw = w * 0.5 + 0.8;
  vec2 p = mix(head + dir * hw, tail - dir * hw, aC.x);
  p += vec2(-dir.y, dir.x) * aC.y * hw;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
  vAcross = aC.y * hw;
  vHalfW = w * 0.5;
  vAlong = aC.x;
  vB = (0.55 + 0.45 * hash(aP.w * 17.0)) * smoothstep(FAR, FAR - 0.7, z) * smoothstep(NEAR, NEAR + 0.2, z) * (0.6 + 0.6 * near01);
}`;

const WARP_FS = `
precision mediump float;
uniform float uAlpha;
varying float vAcross, vHalfW, vAlong, vB;
void main() {
  float edge = 1.0 - smoothstep(vHalfW - 0.4, vHalfW + 0.8, abs(vAcross));
  float along = 1.0 - vAlong;                       // 1 at head, 0 at tail
  float a = edge * (0.04 + 0.96 * along * along) * vB * uAlpha;
  vec3 col = mix(vec3(1.0, 0.80, 0.78), vec3(1.0, 0.97, 0.95), along);
  gl_FragColor = vec4(col * a, a);
}`;

// Faint vanishing-point bloom + vignette while warping (premultiplied output).
const FX_FS = `
precision mediump float;
uniform vec2 uRes;
uniform float uVig, uGlow;
void main() {
  vec2 q = (gl_FragCoord.xy / uRes - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(q);
  float vig = smoothstep(0.3, 0.95, r) * uVig;
  float g = exp(-r * r * 22.0) * uGlow;
  gl_FragColor = vec4(vec3(1.0, 0.90, 0.88) * g, min(1.0, vig + g));
}`;

const VS_TRI = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Low-resolution nebula: a few very faint fbm clouds (crimson + burgundy).
const NEBULA_FS = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime, uScroll;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * n(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
float cloud(vec2 uv, vec2 c, float rad, float seed) {
  float d = length((uv - c) / rad);
  float m = smoothstep(1.0, 0.0, d);
  return m * smoothstep(0.30, 0.80, fbm(uv * 1.6 + seed));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes.y;
  float asp = uRes.x / uRes.y;
  float t = uTime * 0.004;
  float s = uScroll * 0.00004;
  vec2 q = vec2(uv.x, uv.y + s);
  float crim = cloud(q + vec2(t, 0.0), vec2(0.08 * asp, 0.55), 0.75, 3.0) + 0.6 * cloud(q - vec2(t, 0.0), vec2(0.95 * asp, 0.12 + s * 0.5), 0.55, 11.0);
  float vio = cloud(q + vec2(0.0, t), vec2(0.85 * asp, 0.92), 0.8, 21.0) + 0.7 * cloud(q - vec2(t, 0.0), vec2(0.35 * asp, 0.15), 0.6, 33.0);
  vec3 c = vec3(1.0, 0.30, 0.36) * crim * 0.045 + vec3(0.70, 0.12, 0.34) * vio * 0.05;
  gl_FragColor = vec4(c, 1.0);
}`;

const BLIT_FS = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uDim;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(uTex, gl_FragCoord.xy / uRes).rgb;
  c += (h(gl_FragCoord.xy) - 0.5) / 255.0 * step(0.001, c.g + c.b);  // dither: avoids banding at low alpha
  float a = clamp(max(c.r, max(c.g, c.b)) * 1.15, 0.0, 0.06);
  gl_FragColor = vec4(c, a) * uDim;
}`;

const rand = (() => { let s = 1337; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();

function buildStars(w: number, h: number) {
  const count = Math.max(60, Math.min(900, Math.round((w * h) / 7500)));
  const data = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const r = rand(), layer = r < 0.55 ? 0 : r < 0.85 ? 1 : 2;
    const size = [0.5 + rand() * 0.4, 0.7 + rand() * 0.5, 1.0 + rand() * 0.6][layer];
    data.set([rand(), rand(), layer, size, rand(), rand() < 0.05 ? 0.05 + rand() * 0.95 : 0], i * 6);
  }
  return { data, count };
}

// 6 vertices per particle (two triangles): [angle, radius, phase, seed, end, side]
function createWarpBuffer(gl: GL, n: number) {
  const corners = [[0, -1], [0, 1], [1, -1], [1, -1], [0, 1], [1, 1]];
  const d = new Float32Array(n * 36);
  for (let i = 0; i < n; i++) {
    const a = rand(), r = rand(), ph = (i + rand()) / n, sd = rand();
    for (let v = 0; v < 6; v++) d.set([a, r, ph, sd, corners[v][0], corners[v][1]], (i * 6 + v) * 6);
  }
  const b = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
  return b;
}

function init() {
  const root = document.querySelector<HTMLElement>('[data-starfield]');
  const canvas = root?.querySelector('canvas');
  if (!root || !canvas || (window as any).__starfield) return;
  (window as any).__starfield = true;

  let gl: GL | null = null;
  let star: Program, neb: Program, blit: Program, wrp: Program, fx: Program;
  let warpBuf: WebGLBuffer;
  let starBuf: WebGLBuffer, triBuf: WebGLBuffer, tex: WebGLTexture, fbo: WebGLFramebuffer;
  let count = 0, cssW = 1, cssH = 1, dpr = 1, lw = 1, lh = 1, lost = false, starKey = '';
  let reduced = prefersReducedMotion();
  let scroll = 0, px = 0, py = 0, tx = 0, ty = 0;
  let lastX = innerWidth / 2, lastY = innerHeight / 2, speed = 0, travel = 0, lastFrame = 0, cx = 0.5, cy = 0.5;
  const debug = location.search.includes('debug-warp');
  let frozen = false;
  const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 720;
  const WARP_N = mobile ? 350 : 800, VMAX = 7;
  const profile = () => (window as any).__sfProfile as number[] | undefined;

  const fallback = (on: boolean) => root.classList.toggle('sf-fallback', on);

  const setup = () => {
    gl = getGL(canvas);
    if (!gl) return fallback(true);
    try {
      star = createProgram(gl, STAR_VS, STAR_FS);
      neb = createProgram(gl, VS_TRI, NEBULA_FS);
      blit = createProgram(gl, VS_TRI, BLIT_FS);
      fx = createProgram(gl, VS_TRI, FX_FS);
      if (!reduced) { wrp = createProgram(gl, WARP_VS, WARP_FS); warpBuf = createWarpBuffer(gl, WARP_N); }
      triBuf = createFullscreenTriangle(gl);
      tex = gl.createTexture()!;
      fbo = gl.createFramebuffer()!;
      starBuf = gl.createBuffer()!;
      starKey = '';
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      fallback(false);
    } catch (e) {
      console.warn('starfield: WebGL setup failed', e);
      gl = null;
      fallback(true);
    }
  };

  const sizeResources = () => {
    if (!gl) return;
    lw = Math.max(2, Math.round(cssW / 4));
    lh = Math.max(2, Math.round(cssH / 4));
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lw, lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]] as const) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Regenerate stars only when the target count changes materially (mobile URL-bar resizes keep them).
    const want = Math.round((cssW * cssH) / 7500);
    if (!starKey || Math.abs(want - Number(starKey)) / want > 0.2) {
      const s = buildStars(cssW, cssH);
      count = s.count;
      starKey = String(want);
      gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
      gl.bufferData(gl.ARRAY_BUFFER, s.data, gl.STATIC_DRAW);
    }
  };

  // ---- warp drive tied to the router lifecycle (speed only ever goes 0 -> 1 -> 0; motion is always forward) ----
  // phase: 0 idle, 1 accelerate (300ms ease-in), 2 hold, 3 decelerate (560ms ease-out)
  let warpPhase = 0, phaseT = 0, phaseFrom = 0, holdTimer = 0, endPending = false;
  const setPhase = (ph: number) => { warpPhase = ph; phaseT = performance.now(); phaseFrom = speed; loop.invalidate(); };
  const stepWarp = (dt: number) => {
    if (!frozen) {
      const el = performance.now() - phaseT;
      if (warpPhase === 1) {
        const x = Math.min(1, el / 300);
        speed = phaseFrom + (1 - phaseFrom) * x * x;
        if (x >= 1) { speed = 1; if (endPending) setPhase(3); else warpPhase = 2; }
      } else if (warpPhase === 3) {
        const x = Math.min(1, el / 560);
        speed = phaseFrom * (1 - x) * (1 - x);
        if (x >= 1) { speed = 0; warpPhase = 0; }
      }
      travel += speed * VMAX * dt;
    }
    (window as any).__warp = speed;
    if (warpPhase !== 0) loop.invalidate();
  };
  const endWarp = () => {
    clearTimeout(holdTimer);
    if (warpPhase === 1) endPending = true; // let the punch finish, then slow down
    else if (warpPhase === 2) setPhase(3);
  };
  const startWarp = (x: number, y: number) => {
    if (reduced || !gl || lost || !wrp) return;
    clearTimeout(holdTimer);
    cx = 0.5 + (x / innerWidth - 0.5) * 0.04; cy = 0.5 + (y / innerHeight - 0.5) * 0.04;
    endPending = false;
    setPhase(1);
    holdTimer = window.setTimeout(endWarp, 4000); // safety: never get stuck if navigation fails
  };
  if (debug) (window as any).__warpDebug = { set: (s: number, t: number) => { frozen = true; speed = s; travel = t; (window as any).__warp = s; loop.invalidate(); } };

  const draw = (t: number) => {
    if (!gl || lost) return;
    const t0 = profile() ? performance.now() : 0;
    const time = reduced ? 0 : t, sc = reduced ? 0 : scroll;
    const dt = lastFrame ? Math.min(0.05, t - lastFrame) : 0.016;
    lastFrame = speed > 0 || warpPhase ? t : 0;
    stepWarp(dt);
    const sm = speed * speed * (3 - 2 * speed);
    const dim = 1 - 0.4 * Math.min(1, speed / 0.6);
    px += (tx - px) * 0.12; py += (ty - py) * 0.12;
    if (Math.abs(tx - px) + Math.abs(ty - py) > 0.002) loop.invalidate(); else { px = tx; py = ty; }

    // Pass 1: nebula into the low-res texture.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, lw, lh);
    gl.disable(gl.BLEND);
    gl.useProgram(neb.p);
    attrib(gl, neb.a('aPos'), triBuf, 2);
    gl.uniform2f(neb.u('uRes'), lw, lh);
    gl.uniform1f(neb.u('uTime'), time);
    gl.uniform1f(neb.u('uScroll'), sc);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Pass 2: upscale (linear) + dither onto the canvas, then stars on top.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(blit.p);
    attrib(gl, blit.a('aPos'), triBuf, 2);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(blit.u('uTex'), 0);
    gl.uniform2f(blit.u('uRes'), canvas.width, canvas.height);
    gl.uniform1f(blit.u('uDim'), dim);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(star.p);
    attrib(gl, star.a('aPos'), starBuf, 2, 24, 0);
    attrib(gl, star.a('aData'), starBuf, 4, 24, 8);
    gl.uniform2f(star.u('uRes'), cssW, cssH);
    gl.uniform1f(star.u('uScroll'), sc);
    gl.uniform1f(star.u('uTime'), time);
    gl.uniform1f(star.u('uDpr'), dpr);
    gl.uniform1f(star.u('uDim'), dim);
    gl.uniform2f(star.u('uPointer'), reduced ? 0 : px, reduced ? 0 : py);
    gl.drawArrays(gl.POINTS, 0, count);

    if (speed > 0.001 && wrp && !reduced) {
      gl.useProgram(wrp.p);
      attrib(gl, wrp.a('aP'), warpBuf, 4, 24, 0);
      attrib(gl, wrp.a('aC'), warpBuf, 2, 24, 16);
      gl.uniform2f(wrp.u('uRes'), cssW, cssH);
      gl.uniform2f(wrp.u('uCenter'), cssW * cx, cssH * cy);
      gl.uniform1f(wrp.u('uFocal'), Math.hypot(cssW, cssH) * 0.25);
      gl.uniform1f(wrp.u('uTravel'), travel);
      gl.uniform1f(wrp.u('uSpeed'), speed);
      gl.uniform1f(wrp.u('uAlpha'), Math.min(1, speed / 0.45));
      gl.drawArrays(gl.TRIANGLES, 0, WARP_N * 6);

      gl.useProgram(fx.p);
      attrib(gl, fx.a('aPos'), triBuf, 2);
      gl.uniform2f(fx.u('uRes'), canvas.width, canvas.height);
      gl.uniform1f(fx.u('uVig'), 0.22 * sm);
      gl.uniform1f(fx.u('uGlow'), 0.07 * Math.max(0, Math.min(1, (speed - 0.8) / 0.2)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    const p = profile();
    if (p) { gl.finish(); p.push(performance.now() - t0); }
  };

  const loop = createRenderer(canvas, {
    resize: (w, h, d) => { cssW = w; cssH = h; dpr = d; sizeResources(); },
    draw,
    animated: () => (!reduced && !!gl && !lost) || speed > 0.001 || warpPhase !== 0,
    fps: 30,
    idleFps: 15,
  });

  setup();
  loop.measure();
  document.addEventListener('astro:before-preparation', (e) => {
    const ev = e as any;
    if (reduced || !gl || lost) return;
    startWarp(lastX, lastY);
    // Local navigations resolve in a few ms; top the load up to 220ms so the jump is always visible.
    const load = ev.loader as () => Promise<void>;
    ev.loader = async () => {
      const t0 = performance.now();
      await load();
      const wait = Math.max(0, 220 - (performance.now() - t0));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    };
  }, { signal: loop.signal });
  document.addEventListener('astro:page-load', endWarp, { signal: loop.signal });

  const opt = { signal: loop.signal, passive: true } as const;
  addEventListener('pointerdown', (e) => { lastX = e.clientX; lastY = e.clientY; }, opt);
  addEventListener('scroll', () => { scroll = window.scrollY; if (!reduced) loop.invalidate(); }, opt);
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    addEventListener('pointermove', (e) => { tx = (e.clientX / innerWidth) * 2 - 1; ty = (e.clientY / innerHeight) * 2 - 1; if (!reduced) loop.invalidate(); }, opt);
  }
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { reduced = prefersReducedMotion(); loop.invalidate(); }, { signal: loop.signal });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; fallback(true); }, { signal: loop.signal });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; setup(); sizeResources(); loop.invalidate(); }, { signal: loop.signal });
}

init();
