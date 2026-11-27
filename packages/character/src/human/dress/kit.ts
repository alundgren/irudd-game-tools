import * as T from "three";
import { meet, raycaster as gridRaycaster, type Ray } from "../../game/raycast.js";
import { boneNames } from "../catalogue.js";
import type { HumanSurface } from "../surface.js";
import type { ClothJoints } from "../cloth-joints.js";

export type Vec = readonly [number, number, number];
export type Skin = readonly [ReadonlyArray<number>, ReadonlyArray<number>];

const bodySourceVertices = 13380;

export const at = (a: ArrayLike<number>, i: number): number => a[i] ?? 0;
export const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x));
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const add = (a: Vec, b: Vec, s = 1): Vec => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec): Vec => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp3 = (a: Vec, b: Vec, t: number): Vec => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];
export const vec = (a: ArrayLike<number>, k: number): Vec => [at(a, k), at(a, k + 1), at(a, k + 2)];

export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  const fx = x - xi,
    fy = y - yi,
    fz = z - zi;
  const u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy),
    w = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const along = (dz: number) =>
    mix(
      mix(h(xi, yi, zi + dz), h(xi + 1, yi, zi + dz), u),
      mix(h(xi, yi + 1, zi + dz), h(xi + 1, yi + 1, zi + dz), u),
      v,
    );
  return mix(along(0), along(1), w);
}

export { hash1 } from "../identity.js";

export function mergeSkin(pairs: ReadonlyArray<readonly [number, number]>): [number[], number[]] {
  const sum = new Map<number, number>();
  for (const [bone, weight] of pairs) if (weight > 0) sum.set(bone, (sum.get(bone) ?? 0) + weight);
  const best = [...sum].sort((a, b) => b[1] - a[1]).slice(0, 4),
    total = best.reduce((s, x) => s + x[1], 0) || 1;
  const bones = [0, 0, 0, 0],
    weights = [0, 0, 0, 0];
  best.forEach(([bone, weight], i) => {
    bones[i] = bone;
    weights[i] = weight / total;
  });
  if (!best.length) weights[0] = 1;
  return [bones, weights];
}

export interface Landmarks {
  readonly k: number;
  readonly neck: Vec;
  readonly head: Vec;
  readonly pelvis: Vec;
  readonly chest: Vec;
  readonly waist: number;
  readonly belly: number;
  readonly shoulder: number;
  readonly shoulderWidth: number;
  readonly hip: number;
  readonly knee: number;
  readonly ankle: number;
  readonly crotch: number;
  readonly waistband: number;
}

export interface DressBody {
  readonly surface: HumanSurface;
  readonly P: Float32Array;
  readonly N: Float32Array;
  readonly tri: ReadonlyArray<number>;
  readonly count: number;
  readonly names: ReadonlyArray<string>;
  readonly floor: number;
  readonly top: number;
  readonly scale: number;
  bone(name: string): number;
  joint(name: string): Vec;
  weight(pattern: RegExp): Float32Array;
  point(v: number): Vec;
  nearest(p: Vec, reach?: number, skip?: ArrayLike<number> | null): number;
  skinAt(p: Vec): Skin;
  trunkAt(p: Vec): Skin;
  skinOf(v: number): Skin;
  rigid(name: string): Skin;
  clear(p: Vec, gap: number): Vec;
  blend(parts: ReadonlyArray<readonly [string, number]>): Skin;
  readonly arm: Float32Array;
  readonly leg: Float32Array;
}

export function analyse(surface: HumanSurface): DressBody {
  const { positions: P, ids } = surface,
    names: ReadonlyArray<string> = boneNames;
  let count = 0;
  while (count < ids.length && at(ids, count) < bodySourceVertices) count++;
  const tri: number[] = [];
  for (let i = 0; i < surface.indices.length; i += 3) {
    const a = at(surface.indices, i),
      b = at(surface.indices, i + 1),
      c = at(surface.indices, i + 2);
    if (a < count && b < count && c < count) tri.push(a, b, c);
  }
  const N = new Float32Array(count * 3);
  for (let t = 0; t < tri.length; t += 3) {
    const a = at(tri, t) * 3,
      b = at(tri, t + 1) * 3,
      c = at(tri, t + 2) * 3;
    const ux = at(P, b) - at(P, a),
      uy = at(P, b + 1) - at(P, a + 1),
      uz = at(P, b + 2) - at(P, a + 2),
      vx = at(P, c) - at(P, a),
      vy = at(P, c + 1) - at(P, a + 1),
      vz = at(P, c + 2) - at(P, a + 2);
    const x = uy * vz - uz * vy,
      y = uz * vx - ux * vz,
      z = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      N[k] = at(N, k) + x;
      N[k + 1] = at(N, k + 1) + y;
      N[k + 2] = at(N, k + 2) + z;
    }
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(at(N, i), at(N, i + 1), at(N, i + 2)) || 1;
    N[i] = at(N, i) / l;
    N[i + 1] = at(N, i + 1) / l;
    N[i + 2] = at(N, i + 2) / l;
  }
  let floor = Infinity,
    top = -Infinity;
  for (let i = 0; i < count; i++) {
    floor = Math.min(floor, at(P, i * 3 + 1));
    top = Math.max(top, at(P, i * 3 + 1));
  }
  const bone = (name: string) => {
    const i = names.indexOf(name);
    if (i < 0) throw new Error("The human rig has no " + name + " joint.");
    return i;
  };
  const joint = (name: string) => vec(surface.joints, bone(name) * 3);
  const fields = new Map<string, Float32Array>();
  function weight(pattern: RegExp): Float32Array {
    const key = String(pattern);
    let out = fields.get(key);
    if (!out) {
      const pick = names.map((name) => pattern.test(name));
      out = new Float32Array(count);
      for (let v = 0; v < count; v++)
        for (let j = v * 4; j < v * 4 + 4; j++)
          if (pick[at(surface.boneIndices, j)]) out[v] = at(out, v) + at(surface.weights, j);
      fields.set(key, out);
    }
    return out;
  }
  const point = (v: number) => vec(P, v * 3);
  function limb(rootName: string, middleName: string, endName: string, tipPattern: string) {
    const out = new Float32Array(count).fill(-0.3),
      most = new Float32Array(count);
    for (const side of ["l", "r"]) {
      const root = joint(rootName + "_" + side),
        middle = joint(middleName + "_" + side),
        end = joint(endName + "_" + side);
      const a = sub(middle, root),
        b = sub(end, middle),
        la = dot(a, a),
        lb = dot(b, b);
      const wa = weight(new RegExp("^" + rootName + "_" + side)),
        wb = weight(new RegExp("^" + middleName + "_" + side));
      const wc = weight(new RegExp("^(" + endName + "|" + tipPattern + ")_?.*_" + side + "$"));
      for (let v = 0; v < count; v++) {
        const total = at(wa, v) + at(wb, v) + at(wc, v);
        if (total <= at(most, v)) continue;
        most[v] = total;
        const p = point(v),
          ta = dot(sub(p, root), a) / la,
          tb = dot(sub(p, middle), b) / lb;
        const along =
          (at(wa, v) * Math.min(ta, 1.1) +
            at(wb, v) * (1 + clamp(tb, -0.1, 1.1)) +
            at(wc, v) * (2 + Math.max(0, tb - 1))) /
          total;
        out[v] = mix(-0.3, along, smooth(0, 0.55, total));
      }
    }
    return out;
  }
  const scale = (top - floor) / 1.72;
  const cell = 0.03 * scale,
    grid = new Map<number, number[]>();
  const key = (x: number, y: number, z: number) =>
    Math.floor(x / cell) +
    512 +
    (Math.floor(y / cell) + 512) * 1024 +
    (Math.floor(z / cell) + 512) * 1048576;
  for (let v = 0; v < count; v++) {
    const k = key(at(P, v * 3), at(P, v * 3 + 1), at(P, v * 3 + 2));
    const list = grid.get(k);
    if (list) list.push(v);
    else grid.set(k, [v]);
  }
  function nearest(p: Vec, reach = 3, skip: ArrayLike<number> | null = null): number {
    let best = -1,
      distance = Infinity;
    const cx = Math.floor(p[0] / cell),
      cy = Math.floor(p[1] / cell),
      cz = Math.floor(p[2] / cell);
    for (
      let ring = 0;
      ring <= reach && (best < 0 || ring <= 1 || distance > ((ring - 1) * cell) ** 2);
      ring++
    )
      for (let x = -ring; x <= ring; x++)
        for (let y = -ring; y <= ring; y++)
          for (let z = -ring; z <= ring; z++) {
            if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== ring) continue;
            const list = grid.get(cx + x + 512 + (cy + y + 512) * 1024 + (cz + z + 512) * 1048576);
            if (list)
              for (const v of list) {
                if (skip?.[v]) continue;
                const d =
                  (at(P, v * 3) - p[0]) ** 2 +
                  (at(P, v * 3 + 1) - p[1]) ** 2 +
                  (at(P, v * 3 + 2) - p[2]) ** 2;
                if (d < distance) {
                  distance = d;
                  best = v;
                }
              }
          }
    return best;
  }
  const skinOf = (v: number): Skin => [
    [...surface.boneIndices.subarray(v * 4, v * 4 + 4)],
    [...surface.weights.subarray(v * 4, v * 4 + 4)],
  ];
  const rigid = (name: string): Skin => [
    [bone(name), 0, 0, 0],
    [1, 0, 0, 0],
  ];
  function skinAt(p: Vec): Skin {
    const v = nearest(p, 8);
    return v < 0 ? rigid("spine_02") : skinOf(v);
  }
  let arms: Float32Array | null = null;
  function trunkAt(p: Vec): Skin {
    arms ??= weight(/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/).map((w) =>
      w > 0.05 ? 1 : 0,
    );
    const v = nearest(p, 8, arms);
    return v < 0 ? rigid("spine_02") : skinOf(v);
  }
  function clear(p: Vec, gap: number): Vec {
    const v = nearest(p, 2);
    if (v < 0) return p;
    const n = vec(N, v * 3),
      d = dot(sub(p, point(v)), n);
    return d < gap && d > -0.08 * scale ? add(p, n, gap - d) : p;
  }
  const arm = limb("upperarm", "lowerarm", "hand", "thumb|index|middle|ring|pinky");
  const leg = limb("thigh", "calf", "foot", "ball");
  return {
    surface,
    P,
    N,
    tri,
    count,
    names,
    floor,
    top,
    scale,
    bone,
    joint,
    weight,
    point,
    nearest,
    skinAt,
    trunkAt,
    skinOf,
    rigid,
    clear,
    blend: (parts) => mergeSkin(parts.flatMap(([name, w]) => [[bone(name), w] as const])),
    arm,
    leg,
  };
}

export type Field = number[] | Float32Array;

export class Shell {
  pos: number[] = [];
  anc: number[] = [];
  nrm: number[] = [];
  bones: number[] = [];
  weights: number[] = [];
  tri: number[] = [];
  f: Record<string, Field> = {};
  get count(): number {
    return this.pos.length / 3;
  }
  at(i: number): Vec {
    return vec(this.pos, i * 3);
  }
  anchor(i: number): Vec {
    return vec(this.anc, i * 3);
  }
  normal(i: number): Vec {
    return vec(this.nrm, i * 3);
  }
  set(i: number, p: Vec): void {
    this.pos[i * 3] = p[0];
    this.pos[i * 3 + 1] = p[1];
    this.pos[i * 3 + 2] = p[2];
  }
  skin(i: number): Skin {
    return [this.bones.slice(i * 4, i * 4 + 4), this.weights.slice(i * 4, i * 4 + 4)];
  }
  value(name: string, i: number): number {
    return this.f[name]?.[i] ?? 0;
  }
}

export function bodyShell(
  body: DressBody,
  fields: Readonly<Record<string, ArrayLike<number>>> = {},
): Shell {
  const s = new Shell();
  s.pos = Array.from(body.P.subarray(0, body.count * 3));
  s.anc = s.pos.slice();
  s.nrm = Array.from(body.N);
  s.bones = Array.from(body.surface.boneIndices.subarray(0, body.count * 4));
  s.weights = Array.from(body.surface.weights.subarray(0, body.count * 4));
  s.tri = body.tri.slice();
  s.f = {
    arm: Array.from(body.arm),
    leg: Array.from(body.leg),
    wArm: Array.from(body.weight(/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/)),
    wLeg: Array.from(body.weight(/^(thigh|calf|foot|ball)/)),
    wHead: Array.from(body.weight(/^(head|neck)/)),
    ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Array.from(v)])),
  };
  return s;
}

const triples = ["pos", "anc", "nrm"] as const;

export function cut(s: Shell, value: (i: number) => number): Shell {
  const n = s.count,
    f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = value(i);
  const out = new Shell(),
    names = Object.keys(s.f),
    map = new Int32Array(n).fill(-1),
    edges = new Map<number, number>();
  const fields: Record<string, number[]> = {};
  for (const name of names) fields[name] = [];
  const edge: number[] = [];
  fields["edge"] = edge;
  out.f = fields;
  const lanes = names.map((name) => [s.f[name] ?? [], fields[name] ?? []] as const);
  function keep(i: number): number {
    if (at(map, i) < 0) {
      map[i] = out.count;
      for (const key of triples)
        out[key].push(at(s[key], i * 3), at(s[key], i * 3 + 1), at(s[key], i * 3 + 2));
      for (let j = 0; j < 4; j++) {
        out.bones.push(at(s.bones, i * 4 + j));
        out.weights.push(at(s.weights, i * 4 + j));
      }
      for (const [from, to] of lanes) to.push(at(from, i));
      edge.push(s.f["edge"]?.[i] ?? 0);
    }
    return at(map, i);
  }
  function split(a: number, b: number): number {
    const key = a < b ? a * n + b : b * n + a;
    let made = edges.get(key);
    if (made === undefined) {
      const t = at(f, a) / (at(f, a) - at(f, b));
      made = out.count;
      edges.set(key, made);
      for (const k of triples)
        for (let d = 0; d < 3; d++) out[k].push(mix(at(s[k], a * 3 + d), at(s[k], b * 3 + d), t));
      const pairs: Array<readonly [number, number]> = [];
      for (let j = 0; j < 4; j++)
        pairs.push(
          [at(s.bones, a * 4 + j), at(s.weights, a * 4 + j) * (1 - t)],
          [at(s.bones, b * 4 + j), at(s.weights, b * 4 + j) * t],
        );
      const [bones, weights] = mergeSkin(pairs);
      out.bones.push(...bones);
      out.weights.push(...weights);
      for (const [from, to] of lanes) to.push(mix(at(from, a), at(from, b), t));
      edge.push(1);
    }
    return made;
  }
  for (let t = 0; t < s.tri.length; t += 3) {
    const v = [at(s.tri, t), at(s.tri, t + 1), at(s.tri, t + 2)] as const,
      inside = v.map((i) => at(f, i) > 0),
      total = inside.filter(Boolean).length;
    if (total === 3) out.tri.push(keep(v[0]), keep(v[1]), keep(v[2]));
    else if (total === 1) {
      const k = inside.indexOf(true),
        a = at(v, k),
        b = at(v, (k + 1) % 3),
        c = at(v, (k + 2) % 3);
      out.tri.push(keep(a), split(a, b), split(a, c));
    } else if (total === 2) {
      const k = inside.indexOf(false),
        c = at(v, k),
        a = at(v, (k + 1) % 3),
        b = at(v, (k + 2) % 3);
      const ka = keep(a),
        kb = keep(b),
        bc = split(b, c),
        ac = split(a, c);
      out.tri.push(ka, kb, bc, ka, bc, ac);
    }
  }
  return out;
}

export function connected(s: Shell, near: Vec): Shell {
  const parent = Array.from({ length: s.count }, (_, i) => i);
  const find = (i: number) => {
    while (at(parent, i) !== i) i = parent[i] = at(parent, at(parent, i));
    return i;
  };
  for (let t = 0; t < s.tri.length; t += 3) {
    parent[find(at(s.tri, t))] = find(at(s.tri, t + 1));
    parent[find(at(s.tri, t + 1))] = find(at(s.tri, t + 2));
  }
  let best = 0,
    distance = Infinity;
  for (let i = 0; i < s.count; i++) {
    const d = length(sub(s.anchor(i), near));
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  const root = find(best);
  return cut(s, (i) => (find(i) === root ? 1 : -1));
}

interface Topology {
  readonly neighbours: ReadonlyArray<ReadonlyArray<number>>;
  readonly next: Int32Array;
  readonly prev: Int32Array;
}
const topologies = new WeakMap<
  Shell,
  { readonly tri: number[]; readonly size: number; readonly count: number; readonly made: Topology }
>();

export function topology(s: Shell): Topology {
  const known = topologies.get(s);
  if (known && known.tri === s.tri && known.size === s.tri.length && known.count === s.count)
    return known.made;
  const n = s.count,
    tri = s.tri,
    half = new Set<number>(),
    fill = new Int32Array(n + 1);
  for (let t = 0; t < tri.length; t += 3)
    for (let k = 0; k < 3; k++) half.add(at(tri, t + k) * n + at(tri, t + ((k + 1) % 3)));
  const next = new Int32Array(n).fill(-1),
    prev = new Int32Array(n).fill(-1),
    pairs: number[] = [];
  for (const key of half) {
    const a = Math.floor(key / n),
      b = key % n,
      twin = half.has(b * n + a);
    if (!twin) {
      next[a] = b;
      prev[b] = a;
    }
    if (!twin || a < b) pairs.push(a, b);
  }
  for (const v of pairs) fill[v + 1] = at(fill, v + 1) + 1;
  for (let i = 0; i < n; i++) fill[i + 1] = at(fill, i + 1) + at(fill, i);
  const flat = new Int32Array(pairs.length),
    cursor = fill.slice(0, n);
  for (let e = 0; e < pairs.length; e += 2) {
    const a = at(pairs, e),
      b = at(pairs, e + 1);
    flat[at(cursor, a)] = b;
    cursor[a] = at(cursor, a) + 1;
    flat[at(cursor, b)] = a;
    cursor[b] = at(cursor, b) + 1;
  }
  const neighbours = Array.from({ length: n }, (_, i) =>
    Array.from(flat.subarray(at(fill, i), at(fill, i + 1))),
  );
  const made = { neighbours, next, prev };
  topologies.set(s, { tri, size: tri.length, count: n, made });
  return made;
}

export function loops(s: Shell): number[][] {
  const { next } = topology(s),
    seen = new Uint8Array(s.count),
    out: number[][] = [];
  for (let i = 0; i < s.count; i++) {
    if (at(next, i) < 0 || seen[i]) continue;
    const loop: number[] = [];
    for (let v = i; v >= 0 && !seen[v]; v = at(next, v)) {
      seen[v] = 1;
      loop.push(v);
    }
    if (loop.length > 2) out.push(loop);
  }
  return out;
}

export function lift(s: Shell, distance: number | ((i: number) => number)): Shell {
  for (let i = 0; i < s.count; i++) {
    const d = typeof distance === "function" ? distance(i) : distance;
    s.set(i, add(s.anchor(i), s.normal(i), d));
  }
  return s;
}

export interface RelaxOptions {
  readonly passes?: number;
  readonly strength?: number;
  readonly gap?: number | ((i: number) => number);
  readonly edge?: number;
  readonly hold?: ((i: number) => number) | undefined;
  readonly alongNormal?: boolean;
  readonly apart?: boolean;
}

export function relax(s: Shell, options: RelaxOptions = {}): Shell {
  const {
    passes = 6,
    strength = 0.5,
    gap = 0.003,
    edge = 0.5,
    hold,
    alongNormal = false,
    apart = false,
  } = options;
  const { neighbours, next, prev } = topology(s),
    n = s.count;
  for (let pass = 0; pass < passes; pass++) {
    const fresh = s.pos.slice();
    for (let i = 0; i < n; i++) {
      const open = at(next, i) >= 0 && at(prev, i) >= 0,
        list = open ? [at(next, i), at(prev, i)] : (neighbours[i] ?? []);
      if (!list.length) continue;
      const k = (open ? edge : strength) * (hold ? hold(i) : 1);
      if (!k) continue;
      let x = 0,
        y = 0,
        z = 0;
      for (const j of list) {
        x += at(s.pos, j * 3);
        y += at(s.pos, j * 3 + 1);
        z += at(s.pos, j * 3 + 2);
      }
      fresh[i * 3] = mix(at(s.pos, i * 3), x / list.length, k);
      fresh[i * 3 + 1] = mix(at(s.pos, i * 3 + 1), y / list.length, k);
      fresh[i * 3 + 2] = mix(at(s.pos, i * 3 + 2), z / list.length, k);
    }
    s.pos = fresh;
    const p = s.pos,
      a = s.anc;
    for (let i = 0; i < n; i++) {
      const g = typeof gap === "function" ? gap(i) : gap,
        nx = at(s.nrm, i * 3),
        ny = at(s.nrm, i * 3 + 1),
        nz = at(s.nrm, i * 3 + 2);
      const d =
        (at(p, i * 3) - at(a, i * 3)) * nx +
        (at(p, i * 3 + 1) - at(a, i * 3 + 1)) * ny +
        (at(p, i * 3 + 2) - at(a, i * 3 + 2)) * nz;
      if (alongNormal) {
        p[i * 3] = at(a, i * 3) + nx * d;
        p[i * 3 + 1] = at(a, i * 3 + 1) + ny * d;
        p[i * 3 + 2] = at(a, i * 3 + 2) + nz * d;
      }
      if (apart && Math.abs(at(a, i * 3)) > 0.0002 && at(p, i * 3) * at(a, i * 3) < 0) p[i * 3] = 0;
      if (d < g) {
        p[i * 3] = at(p, i * 3) + nx * (g - d);
        p[i * 3 + 1] = at(p, i * 3 + 1) + ny * (g - d);
        p[i * 3 + 2] = at(p, i * 3 + 2) + nz * (g - d);
      }
      if (apart && Math.abs(at(a, i * 3)) > 0.0002 && at(p, i * 3) * at(a, i * 3) < 0) p[i * 3] = 0;
    }
  }
  return s;
}

export function subdivide(s: Shell): Shell {
  const out = new Shell(),
    n = s.count,
    names = Object.keys(s.f),
    edges = new Map<number, number>();
  out.pos = s.pos.slice();
  out.anc = s.anc.slice();
  out.nrm = s.nrm.slice();
  out.bones = s.bones.slice();
  out.weights = s.weights.slice();
  const lanes = names.map((name) => {
    const from = s.f[name] ?? [],
      to = Array.from(from);
    out.f[name] = to;
    return [from, to] as const;
  });
  function middle(a: number, b: number): number {
    const key = a < b ? a * n + b : b * n + a;
    let made = edges.get(key);
    if (made === undefined) {
      made = out.count;
      edges.set(key, made);
      for (const k of triples)
        for (let d = 0; d < 3; d++) out[k].push((at(s[k], a * 3 + d) + at(s[k], b * 3 + d)) / 2);
      const pairs: Array<readonly [number, number]> = [];
      for (let j = 0; j < 4; j++)
        pairs.push(
          [at(s.bones, a * 4 + j), at(s.weights, a * 4 + j)],
          [at(s.bones, b * 4 + j), at(s.weights, b * 4 + j)],
        );
      const [bones, weights] = mergeSkin(pairs);
      out.bones.push(...bones);
      out.weights.push(...weights);
      for (const [from, to] of lanes) to.push((at(from, a) + at(from, b)) / 2);
    }
    return made;
  }
  for (let t = 0; t < s.tri.length; t += 3) {
    const a = at(s.tri, t),
      b = at(s.tri, t + 1),
      c = at(s.tri, t + 2),
      ab = middle(a, b),
      bc = middle(b, c),
      ca = middle(c, a);
    out.tri.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const nrm = out.nrm;
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(at(nrm, i), at(nrm, i + 1), at(nrm, i + 2)) || 1;
    nrm[i] = at(nrm, i) / l;
    nrm[i + 1] = at(nrm, i + 1) / l;
    nrm[i + 2] = at(nrm, i + 2) / l;
  }
  return out;
}

export class Envelope {
  readonly o: Vec;
  readonly a: Vec;
  readonly u: Vec;
  readonly v: Vec;
  readonly r: Float32Array;
  readonly cu: Float32Array;
  readonly cv: Float32Array;
  fixed = false;
  readonly h0: number;
  readonly h1: number;
  readonly rows: number;
  readonly cols: number;
  constructor(origin: Vec, axis: Vec, h0: number, h1: number, rows: number, cols = 48) {
    this.h0 = h0;
    this.h1 = h1;
    this.rows = rows;
    this.cols = cols;
    this.o = origin;
    this.a = unit(axis);
    const front: Vec = Math.abs(this.a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    this.u = unit(
      sub(front, [
        this.a[0] * dot(front, this.a),
        this.a[1] * dot(front, this.a),
        this.a[2] * dot(front, this.a),
      ]),
    );
    this.v = cross(this.a, this.u);
    this.r = new Float32Array(rows * cols).fill(-1);
    this.cu = new Float32Array(rows);
    this.cv = new Float32Array(rows);
  }
  row(h: number): number {
    return clamp((h - this.h0) / (this.h1 - this.h0), 0, 1) * (this.rows - 1);
  }
  local(p: Vec): Vec {
    const d = sub(p, this.o);
    return [dot(d, this.a), dot(d, this.u), dot(d, this.v)];
  }
  centre(h: number): readonly [number, number] {
    const f = this.row(h),
      i = Math.min(this.rows - 2, Math.floor(f)),
      t = f - i;
    return [mix(at(this.cu, i), at(this.cu, i + 1), t), mix(at(this.cv, i), at(this.cv, i + 1), t)];
  }
  polar(p: Vec): Vec {
    const [h, x, y] = this.local(p),
      [cx, cy] = this.centre(h);
    return [h, Math.atan2(y - cy, x - cx), Math.hypot(x - cx, y - cy)];
  }
  point(h: number, angle: number, radius: number): Vec {
    const [cx, cy] = this.centre(h),
      x = cx + Math.cos(angle) * radius,
      y = cy + Math.sin(angle) * radius;
    return [
      this.o[0] + this.a[0] * h + this.u[0] * x + this.v[0] * y,
      this.o[1] + this.a[1] * h + this.u[1] * x + this.v[1] * y,
      this.o[2] + this.a[2] * h + this.u[2] * x + this.v[2] * y,
    ];
  }
  measure(points: ReadonlyArray<Vec>): this {
    const { rows, cols } = this,
      lo = Array.from({ length: rows }, () => [Infinity, Infinity]),
      hi = Array.from({ length: rows }, () => [-Infinity, -Infinity]);
    const slack = (this.h1 - this.h0) / rows;
    const locals = points
      .map((p) => this.local(p))
      .filter(([h]) => h >= this.h0 - slack && h <= this.h1 + slack);
    for (const [h, x, y] of locals) {
      const i = Math.round(this.row(h)),
        l = lo[i] ?? [],
        u = hi[i] ?? [];
      l[0] = Math.min(at(l, 0), x);
      l[1] = Math.min(at(l, 1), y);
      u[0] = Math.max(at(u, 0), x);
      u[1] = Math.max(at(u, 1), y);
    }
    const known: number[] = [];
    for (let i = 0; i < rows; i++) {
      const l = lo[i] ?? [],
        u = hi[i] ?? [];
      if (at(l, 0) < Infinity) {
        known.push(i);
        this.cu[i] = (at(l, 0) + at(u, 0)) / 2;
        this.cv[i] = (at(l, 1) + at(u, 1)) / 2;
      }
    }
    if (!known.length) return this;
    for (let i = 0; i < rows; i++)
      if (at(lo[i] ?? [], 0) === Infinity) {
        const k = known.reduce((a, b) => (Math.abs(b - i) < Math.abs(a - i) ? b : a));
        this.cu[i] = at(this.cu, k);
        this.cv[i] = at(this.cv, k);
      }
    for (let pass = 0; pass < 3; pass++)
      for (const c of [this.cu, this.cv]) {
        const old = c.slice();
        for (let i = 1; i < rows - 1; i++)
          c[i] = (at(old, i - 1) + 2 * at(old, i) + at(old, i + 1)) / 4;
      }
    if (this.fixed) {
      this.cu.fill(0);
      this.cv.fill(0);
    }
    for (const [h, x, y] of locals) {
      const [cx, cy] = this.centre(h),
        radius = Math.hypot(x - cx, y - cy),
        fr = this.row(h),
        fc = ((Math.atan2(y - cy, x - cx) / (2 * Math.PI) + 1) % 1) * cols;
      for (const i of [Math.floor(fr), Math.min(rows - 1, Math.floor(fr) + 1)])
        for (const j of [Math.floor(fc) % cols, (Math.floor(fc) + 1) % cols])
          this.r[i * cols + j] = Math.max(at(this.r, i * cols + j), radius);
    }
    const full: number[] = [];
    for (let i = 0; i < rows; i++) {
      const row = this.r.subarray(i * cols, (i + 1) * cols),
        old = row.slice(),
        filled: number[] = [];
      for (let j = 0; j < cols; j++) if (at(old, j) >= 0) filled.push(j);
      if (!filled.length) continue;
      full.push(i);
      for (let j = 0; j < cols; j++)
        if (at(old, j) < 0) {
          let da = 1,
            db = 1;
          while (at(old, (j + cols - da) % cols) < 0) da++;
          while (at(old, (j + db) % cols) < 0) db++;
          row[j] = mix(at(old, (j + cols - da) % cols), at(old, (j + db) % cols), da / (da + db));
        }
    }
    for (let i = 0; i < rows; i++)
      if (!full.includes(i)) {
        const k = full.reduce((a, b) => (Math.abs(b - i) < Math.abs(a - i) ? b : a), -1);
        for (let j = 0; j < cols; j++) this.r[i * cols + j] = k < 0 ? 0 : at(this.r, k * cols + j);
      }
    return this;
  }
  taut(tension = 1, span = Math.PI): this {
    const { rows, cols } = this,
      reach = Math.max(1, Math.round(((span / (2 * Math.PI)) * cols) / 2)),
      step = (2 * Math.PI) / cols;
    for (let i = 0; i < rows; i++) {
      const row = this.r.subarray(i * cols, (i + 1) * cols),
        hull = row.slice();
      for (let j = 0; j < cols; j++)
        for (let a = 1; a <= reach; a++)
          for (let b = 1; b <= reach && a + b < cols / 2; b++) {
            const r1 = at(row, (j + cols - a) % cols),
              r2 = at(row, (j + b) % cols);
            const chord =
              (r1 * r2 * Math.sin((a + b) * step)) /
              (r1 * Math.sin(b * step) + r2 * Math.sin(a * step));
            if (chord > at(hull, j)) hull[j] = chord;
          }
      for (let j = 0; j < cols; j++) row[j] = mix(at(row, j), at(hull, j), tension);
    }
    return this;
  }
  hang(fall = 0.2, rise = 1): this {
    const { rows, cols } = this,
      dh = (this.h1 - this.h0) / (rows - 1),
      r = this.r;
    for (let j = 0; j < cols; j++) {
      for (let i = 1; i < rows; i++)
        r[i * cols + j] = Math.max(at(r, i * cols + j), at(r, (i - 1) * cols + j) - fall * dh);
      for (let i = rows - 2; i >= 0; i--)
        r[i * cols + j] = Math.max(at(r, i * cols + j), at(r, (i + 1) * cols + j) - rise * dh);
    }
    return this;
  }
  soften(passes = 1): this {
    const { rows, cols } = this;
    for (let pass = 0; pass < passes; pass++) {
      const old = this.r.slice();
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++) {
          const up = Math.max(0, i - 1),
            down = Math.min(rows - 1, i + 1),
            left = (j + cols - 1) % cols,
            right = (j + 1) % cols;
          this.r[i * cols + j] = Math.max(
            at(old, i * cols + j),
            (4 * at(old, i * cols + j) +
              at(old, up * cols + j) +
              at(old, down * cols + j) +
              at(old, i * cols + left) +
              at(old, i * cols + right)) /
              8,
          );
        }
    }
    return this;
  }
  sample(h: number, angle: number): number {
    const { rows, cols } = this,
      fr = this.row(h),
      i = Math.min(rows - 2, Math.floor(fr)),
      t = fr - i;
    const fc = ((((angle / (2 * Math.PI)) % 1) + 1) % 1) * cols,
      j = Math.floor(fc) % cols,
      s = fc - Math.floor(fc),
      k = (j + 1) % cols;
    const r = this.r;
    return mix(
      mix(at(r, i * cols + j), at(r, i * cols + k), s),
      mix(at(r, (i + 1) * cols + j), at(r, (i + 1) * cols + k), s),
      t,
    );
  }
  drape(
    s: Shell,
    mask: ((i: number) => number) | null,
    extra: number | ((i: number, h: number, angle: number) => number) = 0,
  ): Shell {
    for (let i = 0; i < s.count; i++) {
      const m = mask ? mask(i) : 1;
      if (m <= 0) continue;
      const [h, angle] = this.polar(s.anchor(i));
      if (h < this.h0 || h > this.h1) continue;
      const now = this.polar(s.at(i))[2],
        want = this.sample(h, angle) + (typeof extra === "function" ? extra(i, h, angle) : extra);
      if (want <= now) continue;
      const p = s.at(i),
        [hp, ap] = this.polar(p),
        q = this.point(hp, ap, mix(now, want, m));
      s.set(i, q);
    }
    return s;
  }
}

export interface DressMesh {
  readonly mesh: T.Mesh;
  readonly region: string;
  readonly boneIndices: Uint8Array;
  readonly weights: Float32Array;
  readonly foldMetres?: Float32Array;
  readonly clothJoints?: ClothJoints;
  readonly draped?: boolean;
}

export interface ShellOptions {
  readonly thickness?: number;
  readonly close?: boolean;
  readonly flip?: boolean;
}
export interface LoftOptions {
  readonly closed?: boolean;
  readonly capStart?: boolean;
  readonly capEnd?: boolean;
  readonly flip?: boolean;
}
type SkinFor = Skin | ((p: Vec, i: number, j: number) => Skin);

export class Piece {
  mantleUV?: number[];
  mailUV?: number[];
  plateUV?: number[];
  pos: number[] = [];
  bones: number[] = [];
  weights: number[] = [];
  tri: number[] = [];
  shells: Shell[] = [];
  foldBands: Array<readonly [number, ArrayLike<number>]> = [];
  shoeUV: number[] | undefined = undefined;
  clothJoints: ClothJoints | undefined = undefined;
  draped = false;
  get count(): number {
    return this.pos.length / 3;
  }
  vertex(p: Vec, skin: Skin): number {
    this.pos.push(p[0], p[1], p[2]);
    this.bones.push(...skin[0]);
    this.weights.push(...skin[1]);
    return this.count - 1;
  }
  shell(s: Shell, options: ShellOptions = {}): this {
    const { thickness = 0.004, close = true, flip = false } = options;
    const base = this.count;
    this.shells.push(s);
    const folds = s.f["foldMetres"];
    if (folds) this.foldBands.push([base, folds]);
    for (let i = 0; i < s.count; i++) this.vertex(s.at(i), s.skin(i));
    for (let t = 0; t < s.tri.length; t += 3)
      if (flip)
        this.tri.push(base + at(s.tri, t), base + at(s.tri, t + 2), base + at(s.tri, t + 1));
      else this.tri.push(base + at(s.tri, t), base + at(s.tri, t + 1), base + at(s.tri, t + 2));
    if (!close) return this;
    const { neighbours, next, prev } = topology(s),
      ring = new Map<number, readonly [number, number, number, number]>();
    for (let i = 0; i < s.count; i++) {
      if (at(next, i) < 0) continue;
      const p = s.at(i),
        a = s.anchor(i),
        n = s.normal(i),
        skin = s.skin(i),
        gap = length(sub(p, a));
      const inner =
        gap > thickness + 0.001 ? add(p, unit(sub(a, p)), thickness) : add(a, n, 0.0008);
      let deep: Vec = [0, 0, 0],
        total = 0;
      for (const j of neighbours[i] ?? [])
        if (at(next, j) < 0 && at(prev, j) < 0) {
          deep = add(deep, s.anchor(j));
          total++;
        }
      const sunk = gap > 0.012 ? -Math.min(0.012, (gap - 0.012) * 0.6) : 0.0006;
      deep = total
        ? add(lerp3(a, [deep[0] / total, deep[1] / total, deep[2] / total], 0.8), n, sunk)
        : add(a, n, sunk);
      ring.set(i, [
        this.vertex(p, skin),
        this.vertex(inner, skin),
        this.vertex(deep, skin),
        Math.min(1, Math.max(0, (gap - 0.012) / 0.02)),
      ]);
    }
    for (let pass = 0; pass < 16; pass++) {
      const old = this.pos.slice();
      for (const [i, [, , deep, clear]] of ring) {
        const a = ring.get(at(prev, i)),
          b = ring.get(at(next, i));
        if (!a || !b || clear <= 0) continue;
        for (let d = 0; d < 3; d++)
          this.pos[deep * 3 + d] = mix(
            at(old, deep * 3 + d),
            (at(old, a[2] * 3 + d) + at(old, b[2] * 3 + d)) / 2,
            0.6 * clear,
          );
      }
    }
    for (const [a, [a0, a1, a2]] of ring) {
      const after = ring.get(at(next, a));
      if (!after) continue;
      const [b0, b1, b2] = after;
      const quad = (p: number, q: number, r: number, t: number) => {
        if (flip) this.tri.push(p, r, q, p, t, r);
        else this.tri.push(p, q, r, p, r, t);
      };
      quad(b0, a0, a1, b1);
      quad(b1, a1, a2, b2);
    }
    return this;
  }
  loft(rings: ReadonlyArray<ReadonlyArray<Vec>>, skin: SkinFor, options: LoftOptions = {}): this {
    const { closed = true, capStart = false, capEnd = false, flip = false } = options;
    const base = this.count,
      m = rings[0]?.length ?? 0;
    const weigh = (p: Vec, i: number, j: number) =>
      typeof skin === "function" ? skin(p, i, j) : skin;
    rings.forEach((ring, i) => ring.forEach((p, j) => this.vertex(p, weigh(p, i, j))));
    const push = (a: number, b: number, c: number) => {
      if (flip) this.tri.push(a, c, b);
      else this.tri.push(a, b, c);
    };
    for (let i = 0; i + 1 < rings.length; i++)
      for (let j = 0; j < (closed ? m : m - 1); j++) {
        const a = base + i * m + j,
          b = base + i * m + ((j + 1) % m),
          c = base + (i + 1) * m + j,
          d = base + (i + 1) * m + ((j + 1) % m);
        push(a, c, b);
        push(b, c, d);
      }
    for (const [on, i, order] of [
      [capStart, 0, false],
      [capEnd, rings.length - 1, true],
    ] as const) {
      if (!on) continue;
      const ring = rings[i] ?? [],
        sum = ring.reduce<Vec>((s, p) => add(s, p), [0, 0, 0]),
        centre: Vec = [sum[0] / m, sum[1] / m, sum[2] / m];
      const hub = this.vertex(centre, weigh(centre, i, 0)),
        first = this.count;
      ring.forEach((p, j) => this.vertex(p, weigh(p, i, j)));
      for (let j = 0; j < (closed ? m : m - 1); j++)
        if (order) push(hub, first + ((j + 1) % m), first + j);
        else push(hub, first + j, first + ((j + 1) % m));
    }
    return this;
  }
  slab(
    outer: ReadonlyArray<ReadonlyArray<Vec>>,
    inner: ReadonlyArray<ReadonlyArray<Vec>>,
    skin: SkinFor,
  ): this {
    const rows = outer.length,
      cols = outer[0]?.length ?? 0,
      base = this.count,
      index = (grid: number, i: number, j: number) =>
        base + (grid ? rows * cols : 0) + i * cols + j;
    const weigh = (p: Vec, i: number, j: number) =>
      typeof skin === "function" ? skin(p, i, j) : skin;
    for (const grid of [outer, inner])
      grid.forEach((row, i) => row.forEach((p, j) => this.vertex(p, weigh(p, i, j))));
    const P = (n: number) => vec(this.pos, n * 3);
    const quad = (a: number, b: number, c: number, d: number, from: Vec) => {
      const pa = P(a),
        n = cross(sub(P(b), pa), sub(P(d), pa)),
        centre: Vec = [
          (pa[0] + P(b)[0] + P(c)[0] + P(d)[0]) / 4,
          (pa[1] + P(b)[1] + P(c)[1] + P(d)[1]) / 4,
          (pa[2] + P(b)[2] + P(c)[2] + P(d)[2]) / 4,
        ];
      if (dot(n, sub(centre, from)) >= 0) this.tri.push(a, b, c, a, c, d);
      else this.tri.push(a, c, b, a, d, c);
    };
    const cell = (grid: ReadonlyArray<ReadonlyArray<Vec>>, i: number, j: number): Vec =>
      grid[i]?.[j] ?? [0, 0, 0];
    const middle = (i: number, j: number) => lerp3(cell(outer, i, j), cell(inner, i, j), 0.5);
    for (let i = 0; i + 1 < rows; i++)
      for (let j = 0; j + 1 < cols; j++) {
        const core = lerp3(
          lerp3(middle(i, j), middle(i, j + 1), 0.5),
          lerp3(middle(i + 1, j), middle(i + 1, j + 1), 0.5),
          0.5,
        );
        quad(index(0, i, j), index(0, i, j + 1), index(0, i + 1, j + 1), index(0, i + 1, j), core);
        quad(index(1, i, j), index(1, i, j + 1), index(1, i + 1, j + 1), index(1, i + 1, j), core);
      }
    const mean = (list: ReadonlyArray<Vec>): Vec => {
      const s = list.reduce<Vec>((t, p) => add(t, p), [0, 0, 0]);
      return [s[0] / list.length, s[1] / list.length, s[2] / list.length];
    };
    for (let j = 0; j + 1 < cols; j++) {
      const lane = mean(outer.flatMap((_, i) => [middle(i, j), middle(i, j + 1)]));
      for (const i of [0, rows - 1])
        quad(index(0, i, j), index(0, i, j + 1), index(1, i, j + 1), index(1, i, j), lane);
    }
    for (let i = 0; i + 1 < rows; i++) {
      const band = mean((outer[i] ?? []).flatMap((_, j) => [middle(i, j), middle(i + 1, j)]));
      for (const j of [0, cols - 1])
        quad(index(0, i, j), index(0, i + 1, j), index(1, i + 1, j), index(1, i, j), band);
    }
    return this;
  }
  mesh(material: T.Material, region: string, name: string): DressMesh {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.tri);
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.userData["styleRegion"] = region;
    let foldMetres: Float32Array | undefined;
    if (this.foldBands.length) {
      foldMetres = new Float32Array(this.count);
      for (const [start, heights] of this.foldBands) foldMetres.set(heights, start);
    }
    return {
      mesh,
      region,
      boneIndices: Uint8Array.from(this.bones),
      weights: Float32Array.from(this.weights),
      ...(foldMetres ? { foldMetres } : {}),
      ...(this.clothJoints ? { clothJoints: this.clothJoints } : {}),
      ...(this.draped ? { draped: true } : {}),
    };
  }
}

export function hull2(
  points: ReadonlyArray<readonly [number, number]>,
): Array<readonly [number, number]> {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const turn = (
    o: readonly [number, number],
    a: readonly [number, number],
    b: readonly [number, number],
  ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<readonly [number, number]> = [],
    upper: Array<readonly [number, number]> = [];
  const grow = (list: Array<readonly [number, number]>, q: readonly [number, number]) => {
    for (;;) {
      const a = list.at(-2),
        b = list.at(-1);
      if (list.length > 1 && a && b && turn(a, b, q) <= 0) list.pop();
      else break;
    }
    list.push(q);
  };
  for (const q of p) grow(lower, q);
  for (const q of p.reverse()) grow(upper, q);
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function reach2(
  outline: ReadonlyArray<readonly [number, number]>,
  centre: readonly [number, number],
  angle: number,
): number {
  const dx = Math.cos(angle),
    dy = Math.sin(angle);
  let best = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i],
      b = outline[(i + 1) % outline.length];
    if (!a || !b) continue;
    const ex = b[0] - a[0],
      ey = b[1] - a[1],
      det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-12) continue;
    const t = ((a[0] - centre[0]) * ey - (a[1] - centre[1]) * ex) / det,
      s = ((a[0] - centre[0]) * dy - (a[1] - centre[1]) * dx) / det;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.max(best, t);
  }
  return best;
}

export function raycast(
  pos: ArrayLike<number>,
  tri: ArrayLike<number>,
  origin: Vec,
  direction: Vec,
): number {
  let best = Infinity;
  const [ox, oy, oz] = origin,
    [dx, dy, dz] = direction;
  for (let t = 0; t < tri.length; t += 3) {
    const d = meet(
      pos,
      at(tri, t) * 3,
      at(tri, t + 1) * 3,
      at(tri, t + 2) * 3,
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
    );
    if (d < best) best = d;
  }
  return best;
}

export function raycaster(pos: ArrayLike<number>, tri: ArrayLike<number>, cell = 0.03): Ray {
  return gridRaycaster(pos, tri, cell);
}
