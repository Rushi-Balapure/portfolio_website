import { createBlend, currentTheme, watchTheme } from './gl/themeGl';
import { themeById } from '../data/themes';
import { FS, VS, themeVec } from './gl/planetShader';
import { attrib, createFullscreenTriangle, createProgram, createRenderer, getGL, prefersReducedMotion, type GL, type Program } from './gl/gl';

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

  const pageHidden = () => document.documentElement.dataset.page === 'starfield';
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
    if (!gl || lost || pageHidden()) return;
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
    const lx = -0.78, ly = 0.56, lz = 0.26;   // key light from upper-left, mostly side-on: ~60% of the disc lit
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
    animated: () => !reduced && !!gl && !lost && !pageHidden() && (performance.now() - lastActive < 10000),
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
  document.addEventListener('astro:page-load', () => { bufCss = 0; layout(); resync(); }, { signal: loop.signal });
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
