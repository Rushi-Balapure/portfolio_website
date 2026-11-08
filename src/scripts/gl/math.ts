// Minimal column-major math for the Starfield scene: vec3 helpers, mat4 and quaternions. No dependencies.
export type V3 = [number, number, number];
export type Mat4 = Float32Array;
export type Quat = [number, number, number, number]; // x, y, z, w

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
/** Shortest signed angular difference b - a in (-PI, PI]. */
export const angDiff = (a: number, b: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: V3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  madd: (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
};

export const m4 = {
  identity: (): Mat4 => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  /** Perspective with an optional NDC shift (shiftX/shiftY move the view centre on screen). */
  perspective(fovy: number, aspect: number, near: number, far: number, shiftX = 0, shiftY = 0): Mat4 {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, -shiftX, -shiftY, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookAt(eye: V3, target: V3, up: V3 = [0, 1, 0]): Mat4 {
    const z = v3.norm(v3.sub(eye, target)), x = v3.norm(v3.cross(up, z)), y = v3.cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3.dot(x, eye), -v3.dot(y, eye), -v3.dot(z, eye), 1]);
  },
  mul(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return out;
  },
  rotY(a: number): Mat4 { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
  translation(t: V3): Mat4 { const m = m4.identity(); m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; return m; },
  scaling(s: number | V3): Mat4 { const k = typeof s === 'number' ? [s, s, s] : s; const m = m4.identity(); m[0] = k[0]; m[5] = k[1]; m[10] = k[2]; return m; },
  /** Model matrix from a rotation matrix (3x3 column-major array of 9), a uniform scale and a translation. */
  fromRotScaleTrans(r: ArrayLike<number>, s: number, t: V3): Mat4 {
    return new Float32Array([r[0] * s, r[1] * s, r[2] * s, 0, r[3] * s, r[4] * s, r[5] * s, 0, r[6] * s, r[7] * s, r[8] * s, 0, t[0], t[1], t[2], 1]);
  },
  fromTRS(t: ArrayLike<number>, q: ArrayLike<number>, s: ArrayLike<number>): Mat4 {
    const r = quat.toMat3([q[0], q[1], q[2], q[3]]);
    return new Float32Array([r[0] * s[0], r[1] * s[0], r[2] * s[0], 0, r[3] * s[1], r[4] * s[1], r[5] * s[1], 0, r[6] * s[2], r[7] * s[2], r[8] * s[2], 0, t[0], t[1], t[2], 1]);
  },
  /** Transform a point; returns [x, y, z, w]. */
  point(m: ArrayLike<number>, p: V3): [number, number, number, number] {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14], m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
    ];
  },
  dir(m: ArrayLike<number>, p: V3): V3 {
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];
  },
  /** Inverse of a rigid (rotation + translation) view matrix. */
  invertRigid(m: Mat4): Mat4 {
    const o = new Float32Array(16);
    o[0] = m[0]; o[1] = m[4]; o[2] = m[8]; o[4] = m[1]; o[5] = m[5]; o[6] = m[9]; o[8] = m[2]; o[9] = m[6]; o[10] = m[10]; o[15] = 1;
    o[12] = -(o[0] * m[12] + o[4] * m[13] + o[8] * m[14]);
    o[13] = -(o[1] * m[12] + o[5] * m[13] + o[9] * m[14]);
    o[14] = -(o[2] * m[12] + o[6] * m[13] + o[10] * m[14]);
    return o;
  },
};

export const quat = {
  identity: (): Quat => [0, 0, 0, 1],
  mul(a: Quat, b: Quat): Quat {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  },
  norm(q: Quat): Quat { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; },
  conj: (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]],
  fromAxisAngle(axis: V3, a: number): Quat { const s = Math.sin(a / 2), n = v3.norm(axis); return [n[0] * s, n[1] * s, n[2] * s, Math.cos(a / 2)]; },
  slerp(a: Quat, b: Quat, t: number): Quat {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let bb = b;
    if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
    if (d > 0.9995) return quat.norm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
    const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
  },
  /** Column-major 3x3 (9 floats). */
  toMat3(q: Quat): Float32Array {
    const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return new Float32Array([1 - (yy + zz), xy + wz, xz - wy, xy - wz, 1 - (xx + zz), yz + wx, xz + wy, yz - wx, 1 - (xx + yy)]);
  },
  /** Rotation whose columns are the given orthonormal basis (right, up, back). */
  fromBasis(x: V3, y: V3, z: V3): Quat {
    const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
    const tr = m00 + m11 + m22;
    let q: Quat;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
    return quat.norm(q);
  },
  fromEuler(x: number, y: number, z: number): Quat {
    const qx = quat.fromAxisAngle([1, 0, 0], x), qy = quat.fromAxisAngle([0, 1, 0], y), qz = quat.fromAxisAngle([0, 0, 1], z);
    return quat.mul(qz, quat.mul(qy, qx));
  },
};

/** Rotation matrix (3x3 column-major) taking unit vector a onto unit vector b. */
export const rotationBetween = (a: V3, b: V3): Quat => {
  const d = v3.dot(a, b);
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) { const ax = Math.abs(a[0]) < 0.9 ? v3.cross(a, [1, 0, 0]) : v3.cross(a, [0, 1, 0]); return quat.fromAxisAngle(ax, Math.PI); }
  const c = v3.cross(a, b);
  return quat.norm([c[0], c[1], c[2], 1 + d]);
};

/** Seeded PRNG (mulberry32) so the galaxy is identical on every visit. */
export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
