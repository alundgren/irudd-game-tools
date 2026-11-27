import { Matrix4, Quaternion, Vector3 } from "three";
import { required } from "./required.js";

function dominantEigenvector(a: number[][]) {
  const v = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) off += (required(a[i])[j] ?? 0) * (required(a[i])[j] ?? 0);
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(required(a[p])[q] ?? 0) < 1e-300) continue;
        const theta =
          ((required(a[q])[q] ?? 0) - (required(a[p])[p] ?? 0)) / (2 * (required(a[p])[q] ?? 0));
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1),
          s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = required(a[k])[p] ?? 0,
            akq = required(a[k])[q] ?? 0;
          required(a[k])[p] = c * akp - s * akq;
          required(a[k])[q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = required(a[p])[k] ?? 0,
            aqk = required(a[q])[k] ?? 0;
          required(a[p])[k] = c * apk - s * aqk;
          required(a[q])[k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = required(v[k])[p] ?? 0,
            vkq = required(v[k])[q] ?? 0;
          required(v[k])[p] = c * vkp - s * vkq;
          required(v[k])[q] = s * vkp + c * vkq;
        }
      }
  }
  let best = 0;
  for (let i = 1; i < 4; i++)
    if ((required(a[i])[i] ?? 0) > (required(a[best])[best] ?? 0)) best = i;
  return v.map((row) => row[best] ?? 0);
}

export function alignPoints(
  from: Float32Array,
  to: Float32Array,
  { weights, scale = false }: { weights?: Float32Array; scale?: boolean } = {},
) {
  const n = from.length / 3;
  if (n < 3 || to.length !== from.length)
    throw new Error("Alignment needs at least three matched points.");
  const a = [0, 0, 0],
    b = [0, 0, 0];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? (weights[i] ?? 0) : 1;
    total += w;
    for (let d = 0; d < 3; d++) {
      a[d] = (a[d] ?? 0) + w * (from[i * 3 + d] ?? 0);
      b[d] = (b[d] ?? 0) + w * (to[i * 3 + d] ?? 0);
    }
  }
  if (!(total > 0)) throw new Error("Alignment needs positive weights.");
  for (let d = 0; d < 3; d++) {
    a[d] = (a[d] ?? 0) / total;
    b[d] = (b[d] ?? 0) / total;
  }
  const s = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  let spread = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? (weights[i] ?? 0) : 1;
    for (let r = 0; r < 3; r++) {
      const x = (from[i * 3 + r] ?? 0) - (a[r] ?? 0);
      spread += w * x * x;
      for (let c = 0; c < 3; c++)
        required(s[r])[c] = (required(s[r])[c] ?? 0) + w * x * ((to[i * 3 + c] ?? 0) - (b[c] ?? 0));
    }
  }
  const [q0, q1, q2, q3] = dominantEigenvector([
    [
      (required(s[0])[0] ?? 0) + (required(s[1])[1] ?? 0) + (required(s[2])[2] ?? 0),
      (required(s[1])[2] ?? 0) - (required(s[2])[1] ?? 0),
      (required(s[2])[0] ?? 0) - (required(s[0])[2] ?? 0),
      (required(s[0])[1] ?? 0) - (required(s[1])[0] ?? 0),
    ],
    [
      (required(s[1])[2] ?? 0) - (required(s[2])[1] ?? 0),
      (required(s[0])[0] ?? 0) - (required(s[1])[1] ?? 0) - (required(s[2])[2] ?? 0),
      (required(s[0])[1] ?? 0) + (required(s[1])[0] ?? 0),
      (required(s[2])[0] ?? 0) + (required(s[0])[2] ?? 0),
    ],
    [
      (required(s[2])[0] ?? 0) - (required(s[0])[2] ?? 0),
      (required(s[0])[1] ?? 0) + (required(s[1])[0] ?? 0),
      -(required(s[0])[0] ?? 0) + (required(s[1])[1] ?? 0) - (required(s[2])[2] ?? 0),
      (required(s[1])[2] ?? 0) + (required(s[2])[1] ?? 0),
    ],
    [
      (required(s[0])[1] ?? 0) - (required(s[1])[0] ?? 0),
      (required(s[2])[0] ?? 0) + (required(s[0])[2] ?? 0),
      (required(s[1])[2] ?? 0) + (required(s[2])[1] ?? 0),
      -(required(s[0])[0] ?? 0) - (required(s[1])[1] ?? 0) + (required(s[2])[2] ?? 0),
    ],
  ]);
  const turn = new Quaternion(q1 ?? 0, q2 ?? 0, q3 ?? 0, q0 ?? 0).normalize();
  let size = 1;
  if (scale) {
    const p = new Vector3();
    let along = 0;
    for (let i = 0; i < n; i++) {
      p.set(
        (from[i * 3] ?? 0) - (a[0] ?? 0),
        (from[i * 3 + 1] ?? 0) - (a[1] ?? 0),
        (from[i * 3 + 2] ?? 0) - (a[2] ?? 0),
      ).applyQuaternion(turn);
      along +=
        (weights ? (weights[i] ?? 0) : 1) *
        (p.x * ((to[i * 3] ?? 0) - (b[0] ?? 0)) +
          p.y * ((to[i * 3 + 1] ?? 0) - (b[1] ?? 0)) +
          p.z * ((to[i * 3 + 2] ?? 0) - (b[2] ?? 0)));
    }
    size = along / spread;
  }
  const shift = new Vector3(...b).sub(new Vector3(...a).applyQuaternion(turn).multiplyScalar(size));
  return { matrix: new Matrix4().compose(shift, turn, new Vector3(size, size, size)), scale: size };
}

export function transformPoints(points: Float32Array, matrix: Matrix4) {
  const e = matrix.elements,
    out = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i] ?? 0,
      y = points[i + 1] ?? 0,
      z = points[i + 2] ?? 0;
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}
