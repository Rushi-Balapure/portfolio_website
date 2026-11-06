import { attrib, createFullscreenTriangle, createProgram, createRenderer, getGL, prefersReducedMotion, type GL, type Program } from './gl/gl';

const STAR_VS = `
attribute vec2 aPos;   // normalised 0..1 position
attribute vec4 aData;  // layer(0..2), size(css px), colour temperature, twinkle seed (0 = steady)
uniform vec2 uRes;     // css px
uniform float uScroll, uTime, uDpr;
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
  gl_PointSize = aData.y * uDpr + 2.0;
  float tw = 1.0;
  if (aData.w > 0.0) {
    float period = 3.0 + 4.0 * fract(aData.w * 37.0);
    tw = 1.0 + 0.25 * sin(uTime * 6.2831853 / period + aData.w * 60.0);
  }
  vA = (layer < 0.5 ? 0.5 : (layer < 1.5 ? 0.7 : 0.9)) * tw;
  vCol = mix(vec3(0.70, 0.80, 1.0), vec3(1.0, 0.95, 0.88), aData.z);
  vSize = aData.y * uDpr;
}`;

const STAR_FS = `
precision mediump float;
varying vec3 vCol;
varying float vA;
varying float vSize;
void main() {
  float r = length(gl_PointCoord - 0.5) * (vSize + 2.0);   // distance in device px
  float core = 1.0 - smoothstep(vSize * 0.5 - 0.5, vSize * 0.5 + 0.7, r); // crisp
  float a = core * vA;
  gl_FragColor = vec4(vCol * a, a);
}`;

const VS_TRI = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Low-resolution nebula: a few very faint fbm clouds (mint + cool violet-blue).
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
  float mint = cloud(q + vec2(t, 0.0), vec2(0.08 * asp, 0.55), 0.75, 3.0) + 0.6 * cloud(q - vec2(t, 0.0), vec2(0.95 * asp, 0.12 + s * 0.5), 0.55, 11.0);
  float vio = cloud(q + vec2(0.0, t), vec2(0.85 * asp, 0.92), 0.8, 21.0) + 0.7 * cloud(q - vec2(t, 0.0), vec2(0.35 * asp, 0.15), 0.6, 33.0);
  vec3 c = vec3(0.50, 0.82, 0.68) * mint * 0.045 + vec3(0.56, 0.64, 1.0) * vio * 0.05;
  gl_FragColor = vec4(c, 1.0);
}`;

const BLIT_FS = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uRes;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(uTex, gl_FragCoord.xy / uRes).rgb;
  c += (h(gl_FragCoord.xy) - 0.5) / 255.0 * step(0.001, c.g + c.b);  // dither: avoids banding at low alpha
  float a = clamp(max(c.r, max(c.g, c.b)) * 1.15, 0.0, 0.06);
  gl_FragColor = vec4(c, a);
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

function init() {
  const root = document.querySelector<HTMLElement>('[data-starfield]');
  const canvas = root?.querySelector('canvas');
  if (!root || !canvas || (window as any).__starfield) return;
  (window as any).__starfield = true;

  let gl: GL | null = null;
  let star: Program, neb: Program, blit: Program;
  let starBuf: WebGLBuffer, triBuf: WebGLBuffer, tex: WebGLTexture, fbo: WebGLFramebuffer;
  let count = 0, cssW = 1, cssH = 1, dpr = 1, lw = 1, lh = 1, lost = false, starKey = '';
  let reduced = prefersReducedMotion();
  let scroll = 0, px = 0, py = 0, tx = 0, ty = 0;
  const profile = () => (window as any).__sfProfile as number[] | undefined;

  const fallback = (on: boolean) => root.classList.toggle('sf-fallback', on);

  const setup = () => {
    gl = getGL(canvas);
    if (!gl) return fallback(true);
    try {
      star = createProgram(gl, STAR_VS, STAR_FS);
      neb = createProgram(gl, VS_TRI, NEBULA_FS);
      blit = createProgram(gl, VS_TRI, BLIT_FS);
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

  const draw = (t: number) => {
    if (!gl || lost) return;
    const t0 = profile() ? performance.now() : 0;
    const time = reduced ? 0 : t, sc = reduced ? 0 : scroll;
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
    gl.uniform2f(star.u('uPointer'), reduced ? 0 : px, reduced ? 0 : py);
    gl.drawArrays(gl.POINTS, 0, count);

    const p = profile();
    if (p) { gl.finish(); p.push(performance.now() - t0); }
  };

  const loop = createRenderer(canvas, {
    resize: (w, h, d) => { cssW = w; cssH = h; dpr = d; sizeResources(); },
    draw,
    animated: () => !reduced && !!gl && !lost,
    fps: 30,
    idleFps: 15,
  });

  setup();
  loop.measure();

  const opt = { signal: loop.signal, passive: true } as const;
  addEventListener('scroll', () => { scroll = window.scrollY; if (!reduced) loop.invalidate(); }, opt);
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    addEventListener('pointermove', (e) => { tx = (e.clientX / innerWidth) * 2 - 1; ty = (e.clientY / innerHeight) * 2 - 1; if (!reduced) loop.invalidate(); }, opt);
  }
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => { reduced = prefersReducedMotion(); loop.invalidate(); }, { signal: loop.signal });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; fallback(true); }, { signal: loop.signal });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; setup(); sizeResources(); loop.invalidate(); }, { signal: loop.signal });
}

init();
