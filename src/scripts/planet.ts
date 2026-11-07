import { attrib, createFullscreenTriangle, createProgram, createRenderer, getGL, prefersReducedMotion, type GL, type Program } from './gl/gl';

const VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Analytic planet: ray-sphere on a quad, fbm surface, terminator, fresnel rim, faint tilted ring with planet shadow.
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uRot, uSeed, uBand, uRing, uPx;
uniform vec3 uN, uL, uA, uB, uC;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return v; }
float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

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
    float inside = smoothstep(1.2, 1.235, rad) * (1.0 - smoothstep(1.455, 1.485, rad));
    float bands = 0.65 + 0.35 * sin(rad * 61.0) * sin(rad * 17.0 + 1.0);
    float gap = 1.0 - 0.8 * (1.0 - smoothstep(0.0, 0.018, abs(rad - 1.335)));
    float dens = inside * bands * gap;
    float b = dot(P, L);
    float d = sqrt(max(dot(P, P) - b * b, 0.0));
    float sh = b < 0.0 ? 1.0 - smoothstep(0.86, 1.0, d) : 0.0;
    float sunSide = 0.55 + 0.45 * abs(dot(N, L));
    ringCol = mix(vec3(0.70, 0.52, 0.54), vec3(0.52, 0.34, 0.38), smoothstep(1.2, 1.48, rad)) * sunSide * mix(1.0, 0.10, sh);
    ringA = dens * uRing;
    front = rr < 1.0 ? z > zs : z > 0.0;
  }

  // ---- sphere ----
  vec3 sph = vec3(0.0);
  float glowA = 0.0; vec3 glowC = vec3(0.0);
  if (rr < 1.08) {
    vec3 n = vec3(q, zs);
    vec3 o = vec3(dot(n, T1), dot(n, N), dot(n, T2));
    float cs = cos(uRot), sn = sin(uRot);
    o = vec3(cs * o.x + sn * o.z, o.y, -sn * o.x + cs * o.z);
    vec3 w = o * 1.7 + uSeed;
    float warp = fbm(w * 1.3 + 4.0);
    float hh = fbm(w + warp * 0.9);
    float land = smoothstep(0.47, 0.58, hh);
    float band = sin(o.y * uBand + warp * 3.0) * 0.5 + 0.5;
    float cloud = fbm(o * 5.0 + uSeed * 1.7 + warp);
    vec3 ocean = mix(uA, uA * 1.7 + 0.01, band * 0.55);
    vec3 ground = mix(uB * 0.8, uB * 1.2, band);
    vec3 base = mix(ocean, ground, land);
    base = mix(base, uC, smoothstep(0.62, 0.82, hh) * 0.45 + smoothstep(0.58, 0.85, cloud) * 0.16);
    base = mix(base, uC * 1.05, smoothstep(0.84, 0.97, abs(o.y)) * 0.35);
    float d = dot(n, L);
    float lit = smoothstep(-0.05, 0.34, d);
    float diff = max(d, 0.0) * (0.82 + 0.36 * hh);
    vec3 amb = vec3(0.026, 0.012, 0.014) + uA * 0.10;
    vec3 c = base * (amb + vec3(1.0, 0.98, 0.94) * diff * 1.08 * lit);
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    c += uC * pow(max(dot(n, H), 0.0), 40.0) * (1.0 - land) * 0.16 * lit;
    c += uC * smoothstep(0.0, 0.1, d) * (1.0 - smoothstep(0.1, 0.34, d)) * 0.035;
    float fr = pow(1.0 - zs, 2.8);
    c += vec3(0.88, 0.34, 0.36) * fr * (0.10 + 0.60 * smoothstep(-0.35, 0.55, d));
    sph = c;
    // thin outer atmosphere
    float dOut = dot(vec3(q / max(rr, 0.001), 0.0), L);
    glowA = exp(-max(rr - 1.0, 0.0) * 75.0) * smoothstep(-0.45, 0.6, dOut) * 0.42 * (1.0 - cover);
    glowC = vec3(0.95, 0.42, 0.40);
  }

  // ---- composite (premultiplied) ----
  vec4 o4 = vec4(0.0);
  if (!front) o4 = vec4(ringCol * ringA, ringA);
  o4 = vec4(sph * cover, cover) + o4 * (1.0 - cover);
  o4 += vec4(glowC * glowA, glowA) * (1.0 - o4.a);
  if (front) o4 = vec4(ringCol * ringA, ringA) + o4 * (1.0 - ringA);
  o4.rgb += (h2(gl_FragCoord.xy) - 0.5) / 255.0 * o4.a;
  gl_FragColor = o4;
}`;

// Per-section looks (red family): A deep oxblood "ocean", B garnet land, C ember highlight, band count, seed, light yaw, light pitch.
const PRESETS: number[][] = [
  [0.136, 0.025, 0.043, 0.304, 0.086, 0.123, 0.740, 0.443, 0.407, 7, 0.0, 0.0, 0.0],
  [0.162, 0.021, 0.051, 0.336, 0.070, 0.139, 0.757, 0.417, 0.434, 8, 0.5, 0.12, 0.0],
  [0.119, 0.025, 0.060, 0.272, 0.078, 0.164, 0.705, 0.426, 0.478, 6, 1.1, 0.25, 0.05],
  [0.153, 0.043, 0.034, 0.320, 0.109, 0.098, 0.757, 0.494, 0.390, 9, 1.7, 0.4, -0.05],
  [0.145, 0.034, 0.060, 0.360, 0.117, 0.172, 0.774, 0.512, 0.530, 7, 2.3, 0.2, 0.1],
  [0.068, 0.043, 0.047, 0.208, 0.094, 0.107, 0.740, 0.288, 0.319, 10, 2.9, -0.2, 0.08],
  [0.102, 0.021, 0.051, 0.264, 0.062, 0.139, 0.671, 0.357, 0.460, 6, 3.5, -0.35, 0.0],
  [0.128, 0.034, 0.034, 0.288, 0.094, 0.107, 0.722, 0.426, 0.372, 8, 4.1, -0.1, -0.08],
];
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
  let ds = 1, ps = 0, setS = 0, rot = 0.6, vel = 0, px = 0, py = 0, tx = 0, ty = 0;
  const cur = PRESETS[0].slice();
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
      for (let i = 0; i < 13; i++) cur[i] = tgtPreset[i];
    }
    if (reduced) { ds = 1; ps = 0.12; setS = 0; vel = 0; }
    else {
      ds = chase(ds, sT, 3.2, dt); ps = chase(ps, pT, 5, dt); setS = chase(setS, setT, 4, dt);
      vel *= Math.exp(-dt * 2.4);
      rot += (vel + (now - lastActive < 10000 ? 0.035 : 0)) * dt;
      for (let i = 0; i < 13; i++) cur[i] = chase(cur[i], tgtPreset[i], 2.2, dt);
    }
    px = chase(px, tx, 6, dt); py = chase(py, ty, 6, dt);

    // ---- geometry ----
    const r = lerp(rDock, rHero, 1 - ds);
    let cx = lerp(cxDock, cxHero, 1 - ds);
    const bob = reduced ? 0 : Math.sin(ps * 14) * 0.012 * vh + Math.sin(t * 0.35) * 2.5;
    const dockCy = mobile ? dockCyTop + ps * vh * 0.22 : dockCyTop + ps * (vh * 0.52 - dockCyTop) + bob;
    let cy = lerp(dockCy, cyHero, 1 - ds);
    if (setS > 0.001 && footerEl) {
      const ft = footerEl.getBoundingClientRect().top;
      cy = lerp(cy, Math.min(cy + r * 0.2, ft + r * 0.3), setS);   // sink behind the footer's top edge like a horizon
    }
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
    gl.uniform1f(prog.u('uRot'), rot);
    gl.uniform1f(prog.u('uSeed'), cur[10]);
    gl.uniform1f(prog.u('uBand'), cur[9]);
    gl.uniform1f(prog.u('uRing'), lerp(0.42, 0.55, 1 - ds));
    gl.uniform3f(prog.u('uN'), axis[0], axis[1], axis[2]);
    const yaw = cur[11] + px * 0.14, pitch = cur[12] - py * 0.1;
    const lx = -0.62, ly = 0.46, lz = 0.63;
    gl.uniform3f(prog.u('uL'), lx * Math.cos(yaw) + lz * Math.sin(yaw), ly + pitch, -lx * Math.sin(yaw) + lz * Math.cos(yaw));
    gl.uniform3f(prog.u('uA'), cur[0], cur[1], cur[2]);
    gl.uniform3f(prog.u('uB'), cur[3], cur[4], cur[5]);
    gl.uniform3f(prog.u('uC'), cur[6], cur[7], cur[8]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!snapped) { snapped = true; root.classList.add('pl-ready'); }

    // ---- keep animating while anything is still easing ----
    let diff = Math.abs(ds - sT) * 4 + Math.abs(ps - pT) * 20 + Math.abs(setS - setT) * 4 + Math.abs(vel) * 0.5 + Math.abs(px - tx) + Math.abs(py - ty);
    for (let i = 0; i < 13; i++) diff += Math.abs(cur[i] - tgtPreset[i]) * 0.5;
    moving = diff > 0.004 && !reduced;
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
  cur.splice(0, 13, ...PRESETS[activePreset()]);
  loop.measure();

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
