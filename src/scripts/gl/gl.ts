// Tiny raw-WebGL helpers shared by the site's WebGL assets (no dependencies).
export type GL = WebGLRenderingContext | WebGL2RenderingContext;

export const getGL = (canvas: HTMLCanvasElement): GL | null => {
  const attrs: WebGLContextAttributes = { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'low-power' };
  return (canvas.getContext('webgl2', attrs) as GL | null) ?? (canvas.getContext('webgl', attrs) as GL | null);
};

const compile = (gl: GL, type: number, src: string) => {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
  return s;
};

export interface Program {
  p: WebGLProgram;
  u: (name: string) => WebGLUniformLocation | null;
  a: (name: string) => number;
}

/** Compile and link a program (GLSL ES 1.00 sources work on WebGL1 and WebGL2). */
export const createProgram = (gl: GL, vs: string, fs: string): Program => {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  const uc: Record<string, WebGLUniformLocation | null> = {};
  return { p, u: (n) => (n in uc ? uc[n] : (uc[n] = gl.getUniformLocation(p, n))), a: (n) => gl.getAttribLocation(p, n) };
};

export const createBuffer = (gl: GL, data: BufferSource) => {
  const b = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return b;
};

/** One oversized triangle that covers the whole viewport. */
export const createFullscreenTriangle = (gl: GL) => createBuffer(gl, new Float32Array([-1, -1, 3, -1, -1, 3]));

export const attrib = (gl: GL, loc: number, buf: WebGLBuffer, size: number, stride = 0, offset = 0) => {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
};

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface RendererOptions {
  /** Called when the drawing buffer size changes (CSS px size + dpr). */
  resize: (cssW: number, cssH: number, dpr: number) => void;
  /** Called to draw one frame; `t` is seconds. */
  draw: (t: number) => void;
  /** True while the scene animates on its own (e.g. twinkle). */
  animated: () => boolean;
  /** Frame cap while interacting (scroll/pointer). */
  fps?: number;
  /** Frame cap for idle ambient animation. */
  idleFps?: number;
  maxDpr?: number;
}

/**
 * On-demand render loop: draws only when invalidated or animated, caps fps,
 * pauses while the document is hidden, debounces resize, caps DPR.
 */
export const createRenderer = (canvas: HTMLCanvasElement, o: RendererOptions) => {
  const ac = new AbortController();
  const opt = { signal: ac.signal };
  let raf = 0, last = 0, dirty = true, timer = 0;

  const schedule = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); };
  const frame = (now: number) => {
    raf = 0;
    if (document.hidden) return;
    if (now - last < 1000 / (dirty ? (o.fps ?? 30) : (o.idleFps ?? 15)) - 2) return schedule();
    last = now;
    dirty = false;
    o.draw(now / 1000);
    if (dirty || o.animated()) schedule();
  };
  const invalidate = () => { dirty = true; schedule(); };

  const measure = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr ?? 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    o.resize(w, h, dpr);
    invalidate();
  };
  addEventListener('resize', () => { clearTimeout(timer); timer = window.setTimeout(measure, 150); }, opt);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else invalidate(); }, opt);

  return {
    invalidate,
    measure,
    dispose: () => { ac.abort(); cancelAnimationFrame(raf); clearTimeout(timer); },
    signal: ac.signal,
  };
};
