import * as T from "three";
import type { SkinCorrections, Vec3 } from "@irudd/document";
import type { HumanBody } from "./body.js";
import { evaluateHuman, type HumanSurface } from "./surface.js";

type Row = SkinCorrections["controls"][number];
const point = (positions: Float32Array, v: number) => new T.Vector3().fromArray(positions, v * 3);

function vectors(body: HumanBody, fit?: SkinCorrections) {
  const out = new Float32Array(body.arrays.u16("controlIds").length * 3);
  for (const [i, x, y, z] of fit?.controls ?? []) out.set([x / 10000, y / 10000, z / 10000], 3 * i);
  return out;
}

export function correctedSurface(
  body: HumanBody,
  source: HumanSurface,
  fit?: SkinCorrections,
): HumanSurface {
  if (!fit?.controls.length) return source;
  const delta = vectors(body, fit),
    refs = body.arrays.u16("controlRefs"),
    weights = body.arrays.u16("controlWeights");
  const positions = source.positions.slice(),
    scale = source.height / 1.72;
  const sum = new T.Vector3(),
    vector = new T.Vector3();
  for (let v = 0; v < source.ids.length; v++) {
    sum.set(0, 0, 0);
    let total = 0;
    for (let j = v * 4; j < v * 4 + 4; j++) {
      const w = weights[j] ?? 0;
      sum.addScaledVector(vector.fromArray(delta, 3 * (refs[j] ?? 0)), w);
      total += w;
    }
    if (total)
      vector
        .fromArray(positions, 3 * v)
        .addScaledVector(sum, scale / total)
        .toArray(positions, v * 3);
  }
  let top = -Infinity,
    floor = Infinity,
    oldTop = -Infinity,
    oldFloor = Infinity;
  for (let i = 1; i < source.bodyVertices * 3; i += 3) {
    const y = positions[i] ?? 0,
      old = source.positions[i] ?? 0;
    top = Math.max(top, y);
    floor = Math.min(floor, y);
    oldTop = Math.max(oldTop, old);
    oldFloor = Math.min(oldFloor, old);
  }
  const upper = top - 0.12 * source.height,
    lower = floor + 0.09 * source.height;
  for (let i = 1; i < positions.length; i += 3) {
    const y = positions[i] ?? 0;
    if (y > upper) positions[i] = y - (top - oldTop) * T.MathUtils.smoothstep(y, upper, top);
    else if (y < lower)
      positions[i] = y - (floor - oldFloor) * (1 - T.MathUtils.smoothstep(y, floor, lower));
  }
  return { ...source, positions };
}

const graphs = new WeakMap<HumanBody, Set<number>[]>();
function topology(body: HumanBody, s: HumanSurface) {
  const known = graphs.get(body);
  if (known) return known;
  const graph = Array.from({ length: s.bodyVertices }, () => new Set<number>());
  for (let j = 0; j < s.bodyTriangles * 3; j += 3)
    for (let k = 0; k < 3; k++) {
      const a = s.indices[j + k],
        b = s.indices[j + ((k + 1) % 3)];
      if (a === undefined || b === undefined || a >= graph.length || b >= graph.length) continue;
      graph[a]?.add(b);
      graph[b]?.add(a);
    }
  graphs.set(body, graph);
  return graph;
}
const neutrals = new WeakMap<HumanBody, HumanSurface>();
function opposite(body: HumanBody, v: number) {
  let neutral = neutrals.get(body);
  if (!neutral) neutrals.set(body, (neutral = evaluateHuman(body)));
  const target = point(neutral.positions, v);
  target.x *= -1;
  const p = new T.Vector3();
  let found = v,
    best = Infinity;
  for (let i = 0; i < neutral.bodyVertices; i++) {
    const d = p.fromArray(neutral.positions, 3 * i).distanceToSquared(target);
    if (d < best) {
      best = d;
      found = i;
    }
  }
  return found;
}

export function skinStroke(
  body: HumanBody,
  s: HumanSurface,
  fit: SkinCorrections | undefined,
  vertices: readonly number[],
  centre: Vec3,
  reach: number,
  mirror: boolean,
) {
  const ids = body.arrays.u16("controlIds"),
    refs = body.arrays.u16("controlRefs"),
    weights = body.arrays.u16("controlWeights");
  const graph = topology(body, s),
    start = vectors(body, fit),
    hit = new T.Vector3(...centre);
  const seeds = vertices.map((v) => ({ v, d: point(s.positions, v).distanceTo(hit) }));
  function field(touches: typeof seeds, center: T.Vector3, radius: number, widen: boolean) {
    const gain = new Float32Array(ids.length);
    for (let tries = 0; ; tries++, radius *= 1.1) {
      const distances = new Map(touches.map((t) => [t.v, t.d])),
        queue = touches.map((t) => t.v);
      for (let j = 0; j < queue.length; j++) {
        const v = queue[j] ?? 0,
          p = point(s.positions, v),
          base = distances.get(v) ?? 0;
        for (const u of graph[v] ?? []) {
          const d = base + p.distanceTo(point(s.positions, u));
          if (d < 1.2 * radius && d < (distances.get(u) ?? Infinity)) {
            distances.set(u, d);
            queue.push(u);
          }
        }
      }
      let mass = 0;
      ids.forEach((v, i) => {
        const d = Math.max(
          (distances.get(v) ?? Infinity) / 1.2,
          center.distanceTo(point(s.positions, v)),
        );
        gain[i] = d < radius ? (1 - (d / radius) ** 2) ** 2 : 0;
        mass += gain[i] ?? 0;
      });
      const response =
        touches.reduce((sum, { v }) => {
          let w = 0,
            total = 0;
          for (let j = v * 4; j < v * 4 + 4; j++) {
            const a = weights[j] ?? 0;
            w += a * (gain[refs[j] ?? 0] ?? 0);
            total += a;
          }
          return sum + (total ? w / total : 0);
        }, 0) / touches.length;
      if (!widen || tries === 24 || (mass >= 5 && response >= 0.65)) {
        if (response > 0)
          gain.forEach((g, i) => (gain[i] = Math.min(1, g / Math.max(0.5, response))));
        return { gain, radius };
      }
    }
  }
  const main = field(seeds, hit, reach, true);
  let twin: Float32Array | undefined;
  if (mirror) {
    const other = seeds.map((t) => ({ ...t, v: opposite(body, t.v) }));
    const middle = (list: typeof seeds) =>
      list
        .reduce((a, t) => a.add(point(s.positions, t.v)), new T.Vector3())
        .divideScalar(list.length);
    const c = hit.clone().sub(middle(seeds));
    c.x *= -1;
    twin = field(other, c.add(middle(other)), main.radius, false).gain;
  }
  return {
    radius: main.radius,
    apply(offset: Vec3 | number): SkinCorrections {
      const scale = s.height / 1.72;
      const move =
        typeof offset === "number"
          ? undefined
          : new T.Vector3(...offset)
              .divideScalar(scale)
              .clampLength(0, Math.min(0.05, (0.22 * main.radius) / scale));
      const controls: Row[] = [];
      main.gain.forEach((a, i) => {
        const b = twin?.[i] ?? 0,
          w = Math.max(a, b),
          v = point(start, i);
        if (w && move) {
          v.x += w * (twin ? (a - b) / (a + b) : 1) * move.x;
          v.y += w * move.y;
          v.z += w * move.z;
          v.clampLength(0, 0.0649);
        } else if (typeof offset === "number")
          v.multiplyScalar(1 - w * T.MathUtils.clamp(offset, 0, 1));
        const x = Math.round(v.x * 10000),
          y = Math.round(v.y * 10000),
          z = Math.round(v.z * 10000);
        if (x || y || z) controls.push([i, x, y, z]);
      });
      return { controls };
    },
  };
}
