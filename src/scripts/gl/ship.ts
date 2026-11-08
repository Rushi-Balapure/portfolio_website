// The Starfield spaceship: loads /starfield/ship.glb when present, otherwise builds a small procedural fighter.
// Canonical ship space: unit bounding box centred on the origin, nose toward -Z, up +Y, engines at +Z.
import { createBuffer, createProgram, type GL, type Program } from './gl';
import { parseGlb, type GlbMaterial, type GlbModel } from './glb';
import { quat, v3, type Mat4, type V3 } from './math';

// ---- tuning constants for the real model ("Futuristic Airfighter CGPT 14") ------------------------------------------
export const SHIP_URL = '/starfield/ship.glb';
/**
 * Attribution for the real model. Keep null until the author and licence are confirmed: the credit line on the
 * page is only rendered when this is non-null AND the GLB actually loaded.
 * e.g. { title: 'Spacecraft', author: '…', authorUrl: '…', sourceUrl: 'https://free3d.com/3d-model/spacecraft-54534.html',
 *        license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', note: 'Modified for the web.' }
 */
export interface ShipCredit { title: string; author: string; authorUrl?: string; sourceUrl: string; license: string; licenseUrl?: string; note?: string; }
export const SHIP_CREDIT: ShipCredit | null = null;
/** Which model-space axis points out of the nose. glTF convention is +Z; many exports use +X or -Z. */
export const SHIP_FORWARD: V3 = [0, 0, 1];
/** Which model-space axis is "up" (roof of the cockpit). */
export const SHIP_UP: V3 = [0, 1, 0];
/** Extra rotation applied after the axes are aligned, Euler XYZ in radians (fine-tune nose heading / roll). */
export const SHIP_ROT_OFFSET: V3 = [0, 0, 0];
/** Extra uniform scale multiplier on top of the unit-bounding-box normalisation. */
export const SHIP_SCALE = 1;
/** Engine glow positions in canonical (normalised) space, used for the trail and engine glow of the loaded model. */
export const SHIP_ENGINES: V3[] = [[0, 0, 0.5]];
/** Engine glow size relative to the ship length. */
export const SHIP_ENGINE_SIZE = 0.16;

const PLACEHOLDER_ENGINES: V3[] = [[-0.12, 0.0, 0.5], [0.12, 0.0, 0.5]];

interface Material extends Omit<GlbMaterial, 'baseTex' | 'emissiveTex' | 'mrTex'> {
  baseTex?: WebGLTexture; emissiveTex?: WebGLTexture; mrTex?: WebGLTexture;
  /** Procedural engine nozzles: emissive follows the theme accent. */
  engine?: boolean;
}
interface Item { vbo: WebGLBuffer; ibo: WebGLBuffer; count: number; type: number; mat: Material; }

export interface ShipDrawParams {
  viewProj: Mat4; model: Mat4; eye: V3;
  /** Unit vector toward the light, and its colour. */
  lightDir: V3; lightColor: V3;
  /** Rim light + engine tint (theme astronautAccent). */
  accent: V3;
}

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv;
uniform mat4 uVP, uModel;
varying vec3 vN, vW; varying vec2 vUv;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz; vN = mat3(uModel) * aNrm; vUv = aUv;
  gl_Position = uVP * w;
}`;
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uBase, uEmis, uMR;
uniform vec4 uColor; uniform vec3 uEmisF; uniform vec2 uMRF;
uniform vec3 uEye, uL, uLC, uAcc;
uniform float uEngine;
varying vec3 vN, vW; varying vec2 vUv;
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
void main() {
  vec4 bt = texture2D(uBase, vUv);
  vec3 base = uColor.rgb * lin(bt.rgb);
  vec3 mr = texture2D(uMR, vUv).rgb;
  float rough = clamp(uMRF.y * mr.g, 0.08, 1.0), metal = clamp(uMRF.x * mr.b, 0.0, 1.0);
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vW), L = normalize(uL), H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0), ndv = max(dot(N, V), 0.0);
  float shin = mix(180.0, 8.0, rough);
  vec3 F0 = mix(vec3(0.04), base, metal);
  vec3 spec = F0 * pow(max(dot(N, H), 0.0), shin) * (shin + 8.0) / 25.0 * ndl;
  vec3 amb = mix(vec3(0.05, 0.06, 0.09), vec3(0.16, 0.18, 0.24), 0.5 + 0.5 * N.y);
  vec3 col = base * (1.0 - metal * 0.85) * (uLC * ndl + amb) + spec * uLC;
  col += uAcc * pow(1.0 - ndv, 3.0) * (0.25 + 0.75 * ndl + 0.25);   // rim light, theme accent
  vec3 em = uEmisF * lin(texture2D(uEmis, vUv).rgb);
  col += em + uAcc * uEngine * 1.6;
  col = col / (1.0 + col * 0.55);
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

// ---- tiny mesh builder ------------------------------------------------------------------------------------------------
class Mesh {
  v: number[] = []; i: number[] = [];
  /** Flat-shaded polygon (convex, fan). */
  poly(pts: V3[], flip = false) {
    const n = v3.norm(v3.cross(v3.sub(pts[1], pts[0]), v3.sub(pts[2], pts[0])));
    const nn = flip ? v3.scale(n, -1) : n;
    const b = this.v.length / 8;
    for (const p of pts) this.v.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], 0, 0);
    for (let k = 1; k + 1 < pts.length; k++) this.i.push(b, b + k + (flip ? 1 : 0), b + k + (flip ? 0 : 1));
  }
  /** Smooth-shaded grid: rings[r][s] with closed segments. */
  grid(rings: V3[][], closeStart = true, closeEnd = true) {
    const b = this.v.length / 8, R = rings.length, S = rings[0].length;
    const nrm = rings.map((ring, r) => ring.map((_p, s) => {
      const a = rings[Math.min(r + 1, R - 1)][s], c = rings[Math.max(r - 1, 0)][s];
      const t1 = v3.sub(a, c), t2 = v3.sub(ring[(s + 1) % S], ring[(s + S - 1) % S]);
      return v3.norm(v3.cross(t2, t1));
    }));
    for (let r = 0; r < R; r++) for (let s = 0; s < S; s++) this.v.push(...rings[r][s], ...nrm[r][s], 0, 0);
    for (let r = 0; r + 1 < R; r++) for (let s = 0; s < S; s++) {
      const a = b + r * S + s, c = b + r * S + ((s + 1) % S), d = b + (r + 1) * S + s, e = b + (r + 1) * S + ((s + 1) % S);
      this.i.push(a, c, d, c, e, d);
    }
    const cap = (ring: V3[], flip: boolean) => {
      const cc = ring.reduce((acc, p) => v3.add(acc, p), [0, 0, 0] as V3).map((x) => x / ring.length) as V3;
      const out = ring.map((p) => v3.sub(p, cc));
      const dir = v3.norm(v3.cross(out[1], out[0]));
      const n = flip ? v3.scale(dir, -1) : dir;
      const base = this.v.length / 8;
      this.v.push(cc[0], cc[1], cc[2], n[0], n[1], n[2], 0, 0);
      for (const p of ring) this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0);
      for (let s = 0; s < ring.length; s++) { const q = base + 1 + s, q2 = base + 1 + ((s + 1) % ring.length); this.i.push(base, flip ? q2 : q, flip ? q : q2); }
    };
    if (closeStart) cap(rings[0], false);
    if (closeEnd) cap(rings[R - 1], true);
  }
  /** Extrude a planform polygon (x, z) between two heights. */
  slab(plan: [number, number][], y0: (x: number, z: number) => number, y1: (x: number, z: number) => number) {
    const top = plan.map(([x, z]) => [x, y1(x, z), z] as V3), bot = plan.map(([x, z]) => [x, y0(x, z), z] as V3);
    this.poly(top.slice(), false); this.poly(bot.slice().reverse(), false);
    for (let k = 0; k < plan.length; k++) { const n = (k + 1) % plan.length; this.poly([bot[k], bot[n], top[n], top[k]], false); }
  }
  /** Fix winding so every triangle faces away from `centre`-ish: only used per primitive part. */
  data() { return { vertices: new Float32Array(this.v), indices: new Uint16Array(this.i) }; }
}

const ellipse = (z: number, hw: number, ht: number, hb: number, yOff = 0, S = 14): V3[] => {
  const ring: V3[] = [];
  for (let s = 0; s < S; s++) { const a = (s / S) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a); ring.push([c * hw, yOff + si * (si > 0 ? ht : hb), z]); }
  return ring;
};

function buildProcedural(): { mesh: ReturnType<Mesh['data']>; mat: Material }[] {
  const hull: Material = { baseColor: [0.62, 0.66, 0.74, 1], metallic: 0.55, roughness: 0.38, emissive: [0, 0, 0] };
  const dark: Material = { baseColor: [0.10, 0.11, 0.14, 1], metallic: 0.6, roughness: 0.45, emissive: [0, 0, 0] };
  const glass: Material = { baseColor: [0.02, 0.03, 0.05, 1], metallic: 0.9, roughness: 0.12, emissive: [0, 0, 0] };
  const engine: Material = { baseColor: [0.05, 0.05, 0.06, 1], metallic: 0.3, roughness: 0.4, emissive: [0, 0, 0], engine: true };
  const out: { mesh: ReturnType<Mesh['data']>; mat: Material }[] = [];

  // fuselage (nose toward -Z)
  const f = new Mesh();
  f.grid([
    ellipse(-0.5, 0.004, 0.004, 0.004), ellipse(-0.40, 0.03, 0.026, 0.02), ellipse(-0.25, 0.062, 0.05, 0.036),
    ellipse(-0.05, 0.088, 0.062, 0.05), ellipse(0.2, 0.1, 0.06, 0.055), ellipse(0.42, 0.09, 0.05, 0.05), ellipse(0.48, 0.07, 0.04, 0.04),
  ]);
  out.push({ mesh: f.data(), mat: hull });

  // wings: swept, slightly drooping
  const w = new Mesh();
  const wing = (sx: number) => {
    const plan: [number, number][] = [[0.07 * sx, -0.12], [0.5 * sx, 0.3], [0.5 * sx, 0.4], [0.1 * sx, 0.34]];
    const droop = (x: number) => -0.05 * Math.abs(x);
    w.slab(sx > 0 ? plan : plan.slice().reverse(), (x) => droop(x) - 0.01, (x) => droop(x) + 0.008);
  };
  wing(1); wing(-1);
  out.push({ mesh: w.data(), mat: hull });

  // twin canted tail fins + tailplane in the dark accent colour
  const t = new Mesh();
  const fin = (sx: number) => {
    const b = (y: number, z: number, x = 0.14 * sx) => [x + y * 0.35 * sx, y, z] as V3;
    const a = [b(0.04, 0.2), b(0.2, 0.36), b(0.2, 0.44), b(0.04, 0.46)];
    const th = 0.01;
    const front = a.map((p) => [p[0] - th, p[1], p[2]] as V3), back = a.map((p) => [p[0] + th, p[1], p[2]] as V3);
    t.poly(sx > 0 ? back : front.slice().reverse(), false);
    t.poly(sx > 0 ? front.slice().reverse() : back, false);
    for (let k = 0; k < 4; k++) { const n = (k + 1) % 4; t.poly([front[k], front[n], back[n], back[k]], sx < 0); }
  };
  fin(1); fin(-1);
  out.push({ mesh: t.data(), mat: dark });

  // cockpit canopy
  const c = new Mesh();
  const canopy: V3[][] = [];
  for (const [z, hw, h] of [[-0.3, 0.004, 0.004], [-0.24, 0.03, 0.04], [-0.12, 0.045, 0.062], [0.02, 0.04, 0.05], [0.1, 0.01, 0.01]] as const) {
    const ring: V3[] = [];
    for (let s = 0; s < 12; s++) { const a = (s / 12) * Math.PI * 2; ring.push([Math.cos(a) * hw, 0.04 + Math.max(Math.sin(a), -0.1) * h, z]); }
    canopy.push(ring);
  }
  c.grid(canopy);
  out.push({ mesh: c.data(), mat: glass });

  // engines: nacelles with emissive nozzles
  const n = new Mesh();
  for (const sx of [-1, 1]) {
    const x = 0.12 * sx;
    const ring = (z: number, r: number) => { const q: V3[] = []; for (let s = 0; s < 12; s++) { const a = (s / 12) * Math.PI * 2; q.push([x + Math.cos(a) * r, Math.sin(a) * r, z]); } return q; };
    n.grid([ring(0.1, 0.04), ring(0.3, 0.052), ring(0.47, 0.048), ring(0.5, 0.036)], false, true);
  }
  out.push({ mesh: n.data(), mat: engine });
  return out;
}

// ---- GPU side ---------------------------------------------------------------------------------------------------------
export interface Ship {
  readonly placeholder: boolean;
  readonly engines: V3[];
  /** Length of the engine glow, in canonical units. */
  readonly engineSize: number;
  /** Try to replace the placeholder with the real GLB. Resolves true when it loaded. */
  load(url?: string): Promise<boolean>;
  draw(p: ShipDrawParams): void;
  dispose(): void;
}

export function createShip(gl: GL): Ship {
  const prog: Program = createProgram(gl, VS, FS);
  const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const uint32 = gl2 || !!gl.getExtension('OES_element_index_uint');
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const white = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, white);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let items: Item[] = [];
  const textures: WebGLTexture[] = [];
  let state: Ship['placeholder'] = true;
  let engines = PLACEHOLDER_ENGINES;
  let engineSize = 0.2;

  const upload = (bmp: ImageBitmap) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    const pot = (n: number) => (n & (n - 1)) === 0;
    const mips = gl2 || (pot(bmp.width) && pot(bmp.height));
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    const wrap = mips ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    textures.push(t);
    return t;
  };

  const makeItem = (vertices: Float32Array, indices: Uint16Array | Uint32Array, mat: Material): Item => {
    const vbo = createBuffer(gl, new Float32Array(vertices));
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices.slice() as unknown as BufferSource, gl.STATIC_DRAW);
    return { vbo, ibo, count: indices.length, type: indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, mat };
  };
  const freeItems = () => { for (const it of items) { gl.deleteBuffer(it.vbo); gl.deleteBuffer(it.ibo); } for (const t of textures.splice(0)) gl.deleteTexture(t); items = []; };

  for (const part of buildProcedural()) items.push(makeItem(part.mesh.vertices, part.mesh.indices, part.mat));

  /** Bake the normalising transform (axis alignment, offset rotation, unit bounding box) into the vertex data. */
  const normalise = (model: GlbModel) => {
    const f = v3.norm(SHIP_FORWARD);
    const right = v3.norm(v3.cross(f, v3.norm(SHIP_UP)));
    const up = v3.cross(right, f);
    const off = quat.toMat3(quat.fromEuler(SHIP_ROT_OFFSET[0], SHIP_ROT_OFFSET[1], SHIP_ROT_OFFSET[2]));
    const rot = (p: V3): V3 => {
      const c: V3 = [v3.dot(p, right), v3.dot(p, up), -v3.dot(p, f)];   // canonical axes: x right, y up, -z forward
      return [off[0] * c[0] + off[3] * c[1] + off[6] * c[2], off[1] * c[0] + off[4] * c[1] + off[7] * c[2], off[2] * c[0] + off[5] * c[1] + off[8] * c[2]];
    };
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of model.prims) for (let i = 0; i < p.vertices.length; i += 8) {
      const r = rot([p.vertices[i], p.vertices[i + 1], p.vertices[i + 2]]);
      for (let k = 0; k < 3; k++) { if (r[k] < lo[k]) lo[k] = r[k]; if (r[k] > hi[k]) hi[k] = r[k]; }
    }
    const ctr = v3.scale(v3.add(lo, hi), 0.5), size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1, k = SHIP_SCALE / size;
    for (const p of model.prims) for (let i = 0; i < p.vertices.length; i += 8) {
      const r = rot([p.vertices[i], p.vertices[i + 1], p.vertices[i + 2]]);
      const n = rot([p.vertices[i + 3], p.vertices[i + 4], p.vertices[i + 5]]);
      p.vertices[i] = (r[0] - ctr[0]) * k; p.vertices[i + 1] = (r[1] - ctr[1]) * k; p.vertices[i + 2] = (r[2] - ctr[2]) * k;
      p.vertices[i + 3] = n[0]; p.vertices[i + 4] = n[1]; p.vertices[i + 5] = n[2];
    }
  };

  const api: Ship = {
    get placeholder() { return state; },
    get engines() { return engines; },
    get engineSize() { return engineSize; },
    async load(url = SHIP_URL) {
      try {
        const res = await fetch(url);
        if (!res.ok || /text\/html/.test(res.headers.get('content-type') ?? '')) return false;   // dev servers answer 200 + HTML for missing files
        const model = await parseGlb(await res.arrayBuffer());
        if (!uint32 && model.prims.some((p) => p.indices instanceof Uint32Array)) return false;
        normalise(model);
        const next: Item[] = [];
        const prevItems = items, prevTex = textures.splice(0);
        items = [];
        for (const p of model.prims) {
          const m = p.material;
          next.push(makeItem(p.vertices, p.indices, {
            baseColor: m.baseColor, metallic: m.metallic, roughness: m.roughness, emissive: m.emissive,
            baseTex: m.baseTex && upload(m.baseTex), emissiveTex: m.emissiveTex && upload(m.emissiveTex), mrTex: m.mrTex && upload(m.mrTex),
          }));
        }
        for (const it of prevItems) { gl.deleteBuffer(it.vbo); gl.deleteBuffer(it.ibo); }
        for (const t of prevTex) gl.deleteTexture(t);
        items = next; state = false; engines = SHIP_ENGINES; engineSize = SHIP_ENGINE_SIZE;
        return true;
      } catch (e) {
        console.warn('ship: model not loaded, keeping the placeholder', e);
        return false;
      }
    },
    draw(p) {
      gl.useProgram(prog.p);
      gl.uniformMatrix4fv(prog.u('uVP'), false, p.viewProj);
      gl.uniformMatrix4fv(prog.u('uModel'), false, p.model);
      gl.uniform3fv(prog.u('uEye'), p.eye);
      gl.uniform3fv(prog.u('uL'), p.lightDir);
      gl.uniform3fv(prog.u('uLC'), p.lightColor);
      gl.uniform3fv(prog.u('uAcc'), p.accent);
      gl.uniform1i(prog.u('uBase'), 0); gl.uniform1i(prog.u('uEmis'), 1); gl.uniform1i(prog.u('uMR'), 2);
      const aP = prog.a('aPos'), aN = prog.a('aNrm'), aU = prog.a('aUv');
      for (const it of items) {
        const m = it.mat;
        gl.uniform4fv(prog.u('uColor'), m.baseColor);
        gl.uniform3fv(prog.u('uEmisF'), m.emissive);
        gl.uniform2f(prog.u('uMRF'), m.metallic, m.roughness);
        gl.uniform1f(prog.u('uEngine'), m.engine ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, m.baseTex ?? white);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, m.emissiveTex ?? white);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, m.mrTex ?? white);
        gl.bindBuffer(gl.ARRAY_BUFFER, it.vbo);
        gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 32, 0);
        gl.enableVertexAttribArray(aN); gl.vertexAttribPointer(aN, 3, gl.FLOAT, false, 32, 12);
        gl.enableVertexAttribArray(aU); gl.vertexAttribPointer(aU, 2, gl.FLOAT, false, 32, 24);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, it.ibo);
        gl.drawElements(gl.TRIANGLES, it.count, it.type, 0);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.disableVertexAttribArray(aN); gl.disableVertexAttribArray(aU);
    },
    dispose() { freeItems(); gl.deleteTexture(white); gl.deleteProgram(prog.p); },
  };
  return api;
}

