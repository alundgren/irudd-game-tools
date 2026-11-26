import { boneNames } from "./catalogue.js";

const depth = {
  collarbone: 0.0036,
  pit: 0.0046,
  hollow: 0.003,
  under: 0.0012,
  trapezius: 0.0072,
  column: 0.012,
  pad: 0.011,
  back: 0.017,
} as const;
type Landmark = keyof typeof depth;
const landmarks: ReadonlyArray<Landmark> = [
  "collarbone",
  "pit",
  "hollow",
  "under",
  "trapezius",
  "column",
  "pad",
  "back",
];

const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x));
const ease = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const bell = (x: number, width: number) => Math.exp(-(x * x) / (2 * width * width));

function normals(
  positions: Float32Array,
  indices: Uint16Array,
  triangles: ReadonlyArray<number>,
  out: Float32Array,
): Float32Array {
  out.fill(0);
  const at = (i: number) => positions[i] ?? 0;
  for (const i of triangles) {
    const a = (indices[i] ?? 0) * 3,
      b = (indices[i + 1] ?? 0) * 3,
      c = (indices[i + 2] ?? 0) * 3;
    const ux = at(b) - at(a),
      uy = at(b + 1) - at(a + 1),
      uz = at(b + 2) - at(a + 2),
      vx = at(c) - at(a),
      vy = at(c + 1) - at(a + 1),
      vz = at(c + 2) - at(a + 2);
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      out[v] = (out[v] ?? 0) + nx;
      out[v + 1] = (out[v + 1] ?? 0) + ny;
      out[v + 2] = (out[v + 2] ?? 0) + nz;
    }
  }
  return out;
}

type P3 = readonly [number, number, number];
interface Along {
  gap: number;
  t: number;
  dx: number;
  dy: number;
  dz: number;
}
function along(line: ReadonlyArray<P3>, x: number, y: number, z: number): Along {
  let best: Along = {
    gap: Infinity,
    t: Number.NaN,
    dx: Number.NaN,
    dy: Number.NaN,
    dz: Number.NaN,
  };
  for (let k = 0; k < line.length - 1; k++) {
    const [ax, ay, az] = line[k] ?? [0, 0, 0],
      [bx, by, bz] = line[k + 1] ?? [0, 0, 0];
    const ex = bx - ax,
      ey = by - ay,
      ez = bz - az;
    const s = clamp(
      ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / (ex * ex + ey * ey + ez * ez),
      0,
      1,
    );
    const dx = x - ax - s * ex,
      dy = y - ay - s * ey,
      dz = z - az - s * ez,
      gap = Math.hypot(dx, dy, dz);
    if (gap < best.gap) best = { gap, t: (k + s) / (line.length - 1), dx, dy, dz };
  }
  return best;
}

export interface NeckLayout {
  readonly rest: Float32Array;
  readonly bodyVertices: number;
  readonly bodyTriangles: number;
  readonly indices: Uint16Array;
  readonly joints: number;
  readonly bones: Uint8Array;
  readonly weights: Uint16Array;
}

interface NeckFields {
  readonly ids: Uint16Array;
  readonly triangles: ReadonlyArray<number>;
  readonly weights: Readonly<Record<Landmark, Float32Array>>;
  readonly scratch: Float32Array;
}

const fieldCache = new WeakMap<Float32Array, NeckFields>();
const names: ReadonlyArray<string> = boneNames;

export function neckFields(layout: NeckLayout): NeckFields {
  const cached = fieldCache.get(layout.rest);
  if (cached) return cached;
  const { rest, bodyVertices, bodyTriangles, indices, joints, bones, weights } = layout;
  const r = (i: number) => rest[i] ?? 0;
  const joint = (name: string): P3 => {
    const i = (joints + names.indexOf(name)) * 3;
    return [Math.abs(r(i)), r(i + 1), r(i + 2)];
  };
  let floor = Infinity,
    top = -Infinity;
  for (let v = 0; v < bodyVertices; v++) {
    floor = Math.min(floor, r(v * 3 + 1));
    top = Math.max(top, r(v * 3 + 1));
  }
  const u = (top - floor) / 1.72,
    neck = joint("neck_01"),
    skull = joint("head"),
    collar = joint("clavicle_l"),
    arm = joint("upperarm_l");
  const each = bones.length / (rest.length / 3 - names.length),
    headBone = names.indexOf("head");
  const headShare = (v: number) => {
    let sum = 0;
    for (let k = v * each; k < (v + 1) * each; k++)
      if (bones[k] === headBone) sum += (weights[k] ?? 0) / 65535;
    return sum;
  };
  const all: number[] = [];
  for (let i = 0; i < bodyTriangles * 3; i += 3) all.push(i);
  const restNormals = normals(rest, indices, all, new Float32Array(bodyVertices * 3));
  const girdle: number[] = [];
  for (let v = 0; v < bodyVertices; v++) {
    const x = Math.abs(r(v * 3)),
      y = r(v * 3 + 1);
    if (y > collar[1] - 0.21 * u && y < neck[1] + 0.11 * u && x < arm[0] + 0.03 * u) girdle.push(v);
  }
  let pit: P3 | null = null;
  for (const v of girdle) {
    const x = r(v * 3),
      y = r(v * 3 + 1),
      z = r(v * 3 + 2);
    if (Math.abs(x) > 0.004 * u || z < neck[2] + 0.02 * u) continue;
    if (y < collar[1] + 0.01 * u || y > neck[1] + 0.005 * u) continue;
    if (!pit || z < pit[2]) pit = [0, y, z];
  }
  if (!pit) throw new Error("The rest body has no pit of the neck.");
  const thePit: P3 = pit;
  function support(x0: number, degrees: number, cap: number): P3 {
    const forward = Math.cos((degrees * Math.PI) / 180),
      up = Math.sin((degrees * Math.PI) / 180);
    const rows: [number, number, number, number][] = [];
    let best = -Infinity;
    for (const v of girdle) {
      const x = Math.abs(r(v * 3)),
        y = r(v * 3 + 1),
        z = r(v * 3 + 2);
      if (Math.abs(x - x0) > 0.02 * u || y > cap) continue;
      const score = z * forward + y * up;
      rows.push([x, y, z, score]);
      if (Math.abs(x - x0) < 0.012 * u) best = Math.max(best, score);
    }
    const sum = [0, 0, 0];
    let total = 0;
    for (const [x, y, z, score] of rows) {
      const w = bell(x - x0, 0.008 * u) * Math.exp((score - best) / (0.003 * u));
      total += w;
      sum[0] = (sum[0] ?? 0) + w * x;
      sum[1] = (sum[1] ?? 0) + w * y;
      sum[2] = (sum[2] ?? 0) + w * z;
    }
    return [(sum[0] ?? 0) / total, (sum[1] ?? 0) / total, (sum[2] ?? 0) / total];
  }
  function front(x0: number, y0: number): P3 {
    const sum = [0, 0, 0];
    let total = 0;
    for (const v of girdle) {
      const x = Math.abs(r(v * 3)),
        y = r(v * 3 + 1),
        z = r(v * 3 + 2);
      if (z < arm[2] - 0.012 * u || (restNormals[v * 3 + 2] ?? 0) < 0) continue;
      const w = bell(x - x0, 0.009 * u) * bell(y - y0, 0.006 * u);
      total += w;
      sum[0] = (sum[0] ?? 0) + w * x;
      sum[1] = (sum[1] ?? 0) + w * y;
      sum[2] = (sum[2] ?? 0) + w * z;
    }
    return [(sum[0] ?? 0) / total, (sum[1] ?? 0) / total, (sum[2] ?? 0) / total];
  }
  const outer = arm[0] - 0.012 * u,
    steps = 8,
    collarbone: P3[] = [],
    crest: P3[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const x0 = collar[0] * 0.95 + (outer - collar[0] * 0.95) * t;
    let high = -Infinity;
    for (const v of girdle)
      if (Math.abs(Math.abs(r(v * 3)) - x0) < 0.012 * u && r(v * 3 + 1) < neck[1] + 0.035 * u)
        high = Math.max(high, r(v * 3 + 1));
    collarbone.push(front(x0, Math.min(thePit[1] - 0.012 * u + 0.004 * u * t, high - 0.003 * u)));
    const x1 = 0.05 * u + (outer - 0.05 * u) * t;
    crest.push(support(x1, 104, neck[1] + 0.035 * u));
  }
  const ids: number[] = [];
  const fields: Record<Landmark, number[]> = {
    collarbone: [],
    pit: [],
    hollow: [],
    under: [],
    trapezius: [],
    column: [],
    pad: [],
    back: [],
  };
  for (const v of girdle) {
    const x = Math.abs(r(v * 3)),
      y = r(v * 3 + 1),
      z = r(v * 3 + 2);
    const n0 = restNormals[v * 3] ?? 0,
      n1 = restNormals[v * 3 + 1] ?? 0,
      n2 = restNormals[v * 3 + 2] ?? 0,
      size = Math.hypot(n0, n1, n2) || 1;
    const facing = ease(-0.15, 0.35, (0.45 * n1 + 0.89 * n2) / size);
    const c = along(collarbone, x, y, z);
    const above = c.dy * 0.76 - c.dz * 0.62 - c.dx * 0.18 > 0;
    const row: Record<Landmark, number> = {
      collarbone:
        facing * bell(c.gap, 0.0095 * u) * ease(1.02, 0.7, c.t) * (1 + 0.2 * ease(0.2, 0, c.t)),
      hollow: above
        ? facing * bell(c.gap - 0.026 * u, 0.01 * u) * ease(0.02, 0.3, c.t) * ease(0.85, 0.5, c.t)
        : 0,
      under: above
        ? 0
        : facing * bell(c.gap - 0.022 * u, 0.013 * u) * ease(0.4, 0.7, c.t) * ease(1.05, 0.85, c.t),
      pit:
        z > thePit[2] - 0.03 * u
          ? Math.exp(-((x / (0.011 * u)) ** 2) - ((y - thePit[1] - 0.003 * u) / (0.013 * u)) ** 2)
          : 0,
      trapezius: 0,
      column: 0,
      pad: 0,
      back: 0,
    };
    const k = along(crest, x, y, z);
    const reach = ease(0.04 * u, 0.085 * u, x) * (0.2 + 0.8 * ease(0.175 * u, 0.1 * u, x));
    row.trapezius = reach * bell(k.gap, k.dz < 0 ? 0.04 * u : 0.012 * u);
    const free = clamp(1 - 1.4 * headShare(v), 0, 1),
      rz =
        z - (neck[2] + ((y - neck[1]) * (skull[2] - neck[2])) / (skull[1] - neck[1]) + 0.015 * u),
      radius = Math.hypot(x, rz) || 1,
      forward = rz / radius,
      frontShare = Math.max(0, forward);
    row.column =
      free *
      ease(
        thePit[1] - (0.008 + 0.05 * frontShare) * u,
        thePit[1] + (0.03 + 0.015 * frontShare) * u,
        y,
      ) *
      ease((0.1 + 0.04 * frontShare) * u, 0.062 * u, radius) *
      (0.14 + 0.86 * frontShare ** 1.5 + 0.61 * Math.max(0, -forward) ** 1.5);
    row.pad =
      free *
      ease(-0.7, -0.15, n1 / size) *
      (0.45 + 0.55 * ease(-0.1, 0.5, n1 / size)) *
      (k.dz < 0 ? 1 : ease(0.03 * u, 0.055 * u, x)) *
      (1 - 0.75 * ease(0.09 * u, arm[0] - 0.01 * u, x)) *
      bell(k.gap, k.dz < 0 ? 0.06 * u : 0.035 * u);
    row.back =
      free *
      ease(0.35, -0.25, n2 / size) *
      ease(collar[1] - 0.2 * u, collar[1] - 0.07 * u, y) *
      ease(neck[1] + 0.035 * u, neck[1] - 0.02 * u, y) *
      ease(arm[0] + 0.01 * u, 0.06 * u, x) *
      (0.65 + 0.35 * bell(y - neck[1] + 0.05 * u, 0.05 * u) * bell(x, 0.07 * u));
    if (Object.values(row).some((w) => w > 0.004)) {
      ids.push(v);
      for (const key of landmarks) fields[key].push(row[key]);
    }
  }
  const member = new Uint8Array(bodyVertices);
  for (const v of ids) member[v] = 1;
  const triangles = all.filter(
    (i) => member[indices[i] ?? 0] || member[indices[i + 1] ?? 0] || member[indices[i + 2] ?? 0],
  );
  const out: NeckFields = {
    ids: Uint16Array.from(ids),
    triangles,
    weights: {
      collarbone: Float32Array.from(fields.collarbone),
      pit: Float32Array.from(fields.pit),
      hollow: Float32Array.from(fields.hollow),
      under: Float32Array.from(fields.under),
      trapezius: Float32Array.from(fields.trapezius),
      column: Float32Array.from(fields.column),
      pad: Float32Array.from(fields.pad),
      back: Float32Array.from(fields.back),
    },
    scratch: new Float32Array(bodyVertices * 3),
  };
  fieldCache.set(rest, out);
  return out;
}

export interface NeckBuildInput {
  readonly weight?: number;
  readonly muscle?: number;
  readonly frame?: number;
  readonly age?: number;
  readonly waist?: number;
  readonly belly?: number;
  readonly hips?: number;
  readonly shoulderLine?: number;
  readonly upperBack?: number;
}

export function neckBuild({
  weight = 0,
  muscle = 0,
  frame = 0,
  age = 0,
  waist = 0,
  belly = 0,
  hips = 0,
  shoulderLine = 0,
  upperBack = 0,
}: NeckBuildInput = {}): Record<Landmark, number> {
  const heavy = Math.max(weight, 0),
    thin = Math.max(-weight, 0),
    strong = Math.max(muscle, 0);
  const mass = clamp(
    0.6 * weight + 0.25 * Math.max(waist, 0) + 0.25 * Math.max(belly, 0) + 0.1 * Math.max(hips, 0),
    0,
    1.25,
  );
  const lean = clamp(1 - 0.65 * Math.max(heavy, mass) + 0.4 * thin, 0.15, 1.4);
  return {
    collarbone: lean * (1 - 0.2 * strong) * (1 + 0.2 * age),
    pit: lean * (1 + 0.15 * age),
    hollow: lean * (1 + 0.35 * age - 0.15 * strong),
    under: lean,
    trapezius: clamp(0.85 + 0.55 * muscle + 0.1 * frame + 0.1 * heavy, 0.3, 1.6),
    column: mass,
    pad: Math.min(0.6 * mass + shoulderLine, 1.2),
    back: Math.min(0.85 * mass + (upperBack < 0 ? 0.5 * upperBack : upperBack), 1.3),
  };
}

export function shapeNeck(
  vertices: Float32Array,
  parameters: NeckBuildInput,
  height: number,
  layout: NeckLayout,
): void {
  const fields = neckFields(layout),
    w = fields.weights,
    build = neckBuild(parameters),
    u = height / 1.72;
  const n = normals(vertices, layout.indices, fields.triangles, fields.scratch);
  for (let i = 0; i < fields.ids.length; i++) {
    const v = (fields.ids[i] ?? 0) * 3,
      nx = n[v] ?? 0,
      ny = n[v + 1] ?? 0,
      nz = n[v + 2] ?? 0,
      size = Math.hypot(nx, ny, nz);
    if (!size) continue;
    const at = (k: Landmark) => w[k][i] ?? 0;
    const move =
      (u *
        (depth.collarbone * build.collarbone * at("collarbone") -
          depth.pit * build.pit * at("pit") -
          depth.hollow * build.hollow * at("hollow") -
          depth.under * build.under * at("under") +
          depth.trapezius * build.trapezius * at("trapezius") +
          depth.column * build.column * at("column") +
          depth.pad * build.pad * at("pad") +
          depth.back * build.back * at("back"))) /
      size;
    vertices[v] = (vertices[v] ?? 0) + nx * move;
    vertices[v + 1] = (vertices[v + 1] ?? 0) + ny * move;
    vertices[v + 2] = (vertices[v + 2] ?? 0) + nz * move;
  }
}
