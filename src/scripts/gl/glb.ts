// Minimal glTF 2.0 binary (.glb) reader: no Draco/meshopt, triangle primitives only.
// Supports POSITION / NORMAL / TEXCOORD_0, uint8/16/32 indices, node transforms (TRS or matrix),
// baseColor + metallicRoughness + emissive textures (decoded with createImageBitmap).
import { m4, type Mat4, type V3 } from './math';

export interface GlbMaterial {
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  emissive: V3;
  baseTex?: ImageBitmap;
  emissiveTex?: ImageBitmap;
  mrTex?: ImageBitmap;
}

export interface GlbPrimitive {
  /** Interleaved position(3) normal(3) uv(2), already in model space (node transform baked in). */
  vertices: Float32Array;
  indices: Uint16Array | Uint32Array;
  material: GlbMaterial;
}

export interface GlbModel {
  prims: GlbPrimitive[];
  min: V3;
  max: V3;
}

const COMP: Record<number, { n: number; bytes: number; get: (dv: DataView, o: number) => number }> = {
  5120: { n: 1, bytes: 1, get: (d, o) => d.getInt8(o) },
  5121: { n: 1, bytes: 1, get: (d, o) => d.getUint8(o) },
  5122: { n: 1, bytes: 2, get: (d, o) => d.getInt16(o, true) },
  5123: { n: 1, bytes: 2, get: (d, o) => d.getUint16(o, true) },
  5125: { n: 1, bytes: 4, get: (d, o) => d.getUint32(o, true) },
  5126: { n: 1, bytes: 4, get: (d, o) => d.getFloat32(o, true) },
};
const TYPE_N: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const NORM_DIV: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

export async function parseGlb(buf: ArrayBuffer): Promise<GlbModel> {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('glb: bad magic');
  if (dv.getUint32(4, true) !== 2) throw new Error('glb: unsupported version');
  let json: any = null, bin: ArrayBuffer | null = null;
  for (let o = 12; o + 8 <= buf.byteLength;) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
    const data = buf.slice(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === 0x004e4942 && !bin) bin = data;
    o += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json || !bin) throw new Error('glb: missing chunks');
  if ((json.extensionsRequired ?? []).some((e: string) => /draco|meshopt/i.test(e))) throw new Error('glb: compressed meshes are not supported');
  const binView = new DataView(bin);

  /** Read an accessor into a flat Float32Array (or Uint32 for indices). */
  const read = (idx: number, asIndex = false) => {
    const a = json.accessors[idx];
    const comp = COMP[a.componentType], n = TYPE_N[a.type], count: number = a.count;
    const out = asIndex ? new Uint32Array(count * n) : new Float32Array(count * n);
    if (a.bufferView === undefined) return out;
    const bv = json.bufferViews[a.bufferView];
    const stride = bv.byteStride || comp.bytes * n;
    const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const div = a.normalized && !asIndex ? NORM_DIV[a.componentType] : 0;
    for (let i = 0; i < count; i++) for (let k = 0; k < n; k++) {
      const v = comp.get(binView, base + i * stride + k * comp.bytes);
      out[i * n + k] = div ? Math.max(v / div, -1) : v;
    }
    return out;
  };

  const bitmapCache = new Map<number, Promise<ImageBitmap | undefined>>();
  const texture = (info: any): Promise<ImageBitmap | undefined> => {
    if (!info || info.index === undefined) return Promise.resolve(undefined);
    const tex = json.textures?.[info.index];
    const img = tex && json.images?.[tex.source];
    if (!img || img.bufferView === undefined) return Promise.resolve(undefined);
    if (!bitmapCache.has(tex.source)) {
      const bv = json.bufferViews[img.bufferView];
      const bytes = new Uint8Array(bin!, bv.byteOffset ?? 0, bv.byteLength);
      bitmapCache.set(tex.source, createImageBitmap(new Blob([bytes], { type: img.mimeType ?? 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).catch(() => undefined));
    }
    return bitmapCache.get(tex.source)!;
  };

  const matCache = new Map<number, Promise<GlbMaterial>>();
  const material = (idx: number | undefined): Promise<GlbMaterial> => {
    const key = idx ?? -1;
    if (!matCache.has(key)) {
      const m = idx === undefined ? {} : json.materials?.[idx] ?? {};
      const pbr = m.pbrMetallicRoughness ?? {};
      const strength = m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
      matCache.set(key, Promise.all([texture(pbr.baseColorTexture), texture(m.emissiveTexture), texture(pbr.metallicRoughnessTexture)]).then(([baseTex, emissiveTex, mrTex]) => ({
        baseColor: pbr.baseColorFactor ?? [1, 1, 1, 1],
        metallic: pbr.metallicFactor ?? 1,
        roughness: pbr.roughnessFactor ?? 1,
        emissive: ((m.emissiveFactor ?? [0, 0, 0]) as V3).map((x) => x * strength) as V3,
        baseTex, emissiveTex, mrTex,
      })));
    }
    return matCache.get(key)!;
  };

  // Walk the node tree of the default scene, accumulating world matrices.
  const jobs: Promise<GlbPrimitive[]>[] = [];
  const visit = (ni: number, parent: Mat4) => {
    const n = json.nodes[ni];
    const local: Mat4 = n.matrix ? new Float32Array(n.matrix) : m4.fromTRS(n.translation ?? [0, 0, 0], n.rotation ?? [0, 0, 0, 1], n.scale ?? [1, 1, 1]);
    const world = m4.mul(parent, local);
    if (n.mesh !== undefined) jobs.push(buildMesh(json.meshes[n.mesh], world));
    for (const c of n.children ?? []) visit(c, world);
  };

  const buildMesh = async (mesh: any, world: Mat4): Promise<GlbPrimitive[]> => {
    const res: GlbPrimitive[] = [];
    // normal matrix: inverse-transpose of the upper 3x3 (uniform scale or rigid is the common case; handle generally)
    const nm = normalMatrix(world);
    for (const p of mesh.primitives) {
      if ((p.mode ?? 4) !== 4 || p.attributes.POSITION === undefined) continue;
      const pos = read(p.attributes.POSITION) as Float32Array;
      const count = pos.length / 3;
      let idx: Uint32Array;
      if (p.indices !== undefined) idx = read(p.indices, true) as Uint32Array;
      else { idx = new Uint32Array(count); for (let i = 0; i < count; i++) idx[i] = i; }
      let nrm = p.attributes.NORMAL !== undefined ? (read(p.attributes.NORMAL) as Float32Array) : computeNormals(pos, idx);
      const uv = p.attributes.TEXCOORD_0 !== undefined ? (read(p.attributes.TEXCOORD_0) as Float32Array) : new Float32Array(count * 2);
      const verts = new Float32Array(count * 8);
      for (let i = 0; i < count; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        verts[i * 8] = world[0] * x + world[4] * y + world[8] * z + world[12];
        verts[i * 8 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
        verts[i * 8 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
        const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
        let tx = nm[0] * nx + nm[3] * ny + nm[6] * nz, ty = nm[1] * nx + nm[4] * ny + nm[7] * nz, tz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
        const l = Math.hypot(tx, ty, tz) || 1;
        verts[i * 8 + 3] = tx / l; verts[i * 8 + 4] = ty / l; verts[i * 8 + 5] = tz / l;
        verts[i * 8 + 6] = uv[i * 2]; verts[i * 8 + 7] = uv[i * 2 + 1];
      }
      // A transform with negative determinant mirrors the mesh: flip winding.
      if (det3(world) < 0) for (let i = 0; i + 2 < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      let max = 0;
      for (let i = 0; i < idx.length; i++) if (idx[i] > max) max = idx[i];
      res.push({ vertices: verts, indices: max > 65535 ? idx : new Uint16Array(idx), material: await material(p.material) });
    }
    return res;
  };

  const scene = json.scenes?.[json.scene ?? 0];
  const roots: number[] = scene?.nodes ?? json.nodes.map((_: unknown, i: number) => i).filter((i: number) => !json.nodes.some((n: any) => n.children?.includes(i)));
  for (const r of roots) visit(r, m4.identity());
  const prims = (await Promise.all(jobs)).flat();
  if (!prims.length) throw new Error('glb: no triangle meshes');

  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) for (let i = 0; i < p.vertices.length; i += 8) for (let k = 0; k < 3; k++) {
    const v = p.vertices[i + k];
    if (v < min[k]) min[k] = v;
    if (v > max[k]) max[k] = v;
  }
  return { prims, min, max };
}

const det3 = (m: Mat4) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);

/** Inverse-transpose of the upper 3x3, column-major. */
function normalMatrix(m: Mat4): number[] {
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  // cofactor matrix / det == inverse transpose
  return [A / det, B / det, C / det, (c * h - b * i) / det, (a * i - c * g) / det, (b * g - a * h) / det, (b * f - c * e) / det, (c * d - a * f) / det, (a * e - b * d) / det];
}

function computeNormals(pos: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
  }
  return n;
}
