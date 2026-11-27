import { required } from "./required.js";
import type { HumanBody } from "./body.js";
import type { HumanSurface } from "./surface.js";
import { smoothHumanSurface } from "./smooth.js";
import { boneNames } from "./catalogue.js";
import { applyHeadLayer } from "./fine-head.js";
import { encodeHeadLayer } from "./fine-head.js";
type Member = (v: number) => boolean;
type Contact = readonly [number, number, number];
export function contactPairs(
  positions: Float32Array,
  indices: Uint16Array,
  triangles: number,
  vertices: number[],
  reach: number,
) {
  const near = new Map<string, number[]>(),
    key = (x: number, y: number, z: number) => x + "," + y + "," + z,
    cell = (x: number) => Math.floor(x / reach);
  const adjacent = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!adjacent.has(a)) adjacent.set(a, new Set());
    required(adjacent.get(a)).add(b);
  };
  const wanted = new Set(vertices);
  for (let t = 0; t < triangles * 3; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k] ?? 0,
        b = indices[t + ((k + 1) % 3)] ?? 0;
      if (wanted.has(a) && wanted.has(b)) {
        link(a, b);
        link(b, a);
      }
    }
  for (const v of vertices) {
    const k = key(
      cell(positions[v * 3] ?? 0),
      cell(positions[v * 3 + 1] ?? 0),
      cell(positions[v * 3 + 2] ?? 0),
    );
    if (!near.has(k)) near.set(k, []);
    required(near.get(k)).push(v);
  }
  const close = (a: number, b: number) => {
    const ring = adjacent.get(a);
    if (!ring) return true;
    if (ring.has(b)) return false;
    for (const m of ring) if (adjacent.get(m)?.has(b)) return false;
    return true;
  };
  const pairs: [number, number][] = [];
  for (const v of vertices) {
    const cx = cell(positions[v * 3] ?? 0),
      cy = cell(positions[v * 3 + 1] ?? 0),
      cz = cell(positions[v * 3 + 2] ?? 0);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const u of near.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
            if (u <= v) continue;
            const d = Math.hypot(
              (positions[u * 3] ?? 0) - (positions[v * 3] ?? 0),
              (positions[u * 3 + 1] ?? 0) - (positions[v * 3 + 1] ?? 0),
              (positions[u * 3 + 2] ?? 0) - (positions[v * 3 + 2] ?? 0),
            );
            if (d < reach && close(v, u)) pairs.push([v, u]);
          }
  }
  return pairs;
}

export function foldedTriangles(
  before: Float32Array,
  after: Float32Array,
  indices: Uint16Array | Uint32Array,
  triangles: number,
  counted: Member,
) {
  const folded = [];
  let tested = 0;
  for (let t = 0; t < triangles; t++) {
    if (counted && !counted(t)) continue;
    const i = (indices[t * 3] ?? 0) * 3,
      j = (indices[t * 3 + 1] ?? 0) * 3,
      k = (indices[t * 3 + 2] ?? 0) * 3;
    const cross = (p: Float32Array) => {
      const ux = (p[j] ?? 0) - (p[i] ?? 0),
        uy = (p[j + 1] ?? 0) - (p[i + 1] ?? 0),
        uz = (p[j + 2] ?? 0) - (p[i + 2] ?? 0);
      const vx = (p[k] ?? 0) - (p[i] ?? 0),
        vy = (p[k + 1] ?? 0) - (p[i + 1] ?? 0),
        vz = (p[k + 2] ?? 0) - (p[i + 2] ?? 0);
      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    };
    const old = cross(before);
    if (Math.hypot(...old) < 2 * 0.25e-6) continue;
    const now = cross(after);
    tested++;
    if (
      (old[0] ?? 0) * (now[0] ?? 0) +
        (old[1] ?? 0) * (now[1] ?? 0) +
        (old[2] ?? 0) * (now[2] ?? 0) <=
      0
    )
      folded.push(t);
  }
  return { tested, folded };
}
export function eyeGuard(surface: HumanSurface) {
  const count = surface.positions.length / 3,
    scale = surface.height / 1.72,
    p = surface.positions;
  const free = new Float32Array(count).fill(1),
    eye = new Int8Array(count).fill(-1),
    balls: { c: number[]; radius: number; group: Uint16Array }[] = [];
  (surface.eyeGroups ?? []).forEach((group, e) => {
    const c = [0, 0, 0];
    for (const v of group)
      for (let d = 0; d < 3; d++) c[d] = (c[d] ?? 0) + (p[v * 3 + d] ?? 0) / group.length;
    let radius = 0;
    for (const v of group)
      radius +=
        Math.hypot(
          (p[v * 3] ?? 0) - (c[0] ?? 0),
          (p[v * 3 + 1] ?? 0) - (c[1] ?? 0),
          (p[v * 3 + 2] ?? 0) - (c[2] ?? 0),
        ) / group.length;
    balls.push({ c, radius, group });
    for (let v = 0; v < count; v++) {
      const clearance =
        Math.hypot(
          (p[v * 3] ?? 0) - (c[0] ?? 0),
          (p[v * 3 + 1] ?? 0) - (c[1] ?? 0),
          (p[v * 3 + 2] ?? 0) - (c[2] ?? 0),
        ) - radius;
      const t = Math.min(1, Math.max(0, (clearance - 0.001 * scale) / (0.005 * scale))),
        w = t * t * (3 - 2 * t);
      if (w < (free[v] ?? 0)) {
        free[v] = w;
        eye[v] = e;
      }
    }
    for (const v of group) {
      free[v] = 0;
      eye[v] = e;
    }
  });
  return { free, eye, balls, scale };
}

const rings = new WeakMap<Uint16Array, Uint32Array[]>();
function cageRings(surface: HumanSurface) {
  const existing = rings.get(surface.indices);
  if (existing) return existing;
  const sets = Array.from({ length: surface.positions.length / 3 }, () => new Set<number>());
  for (let t = 0; t < surface.indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = surface.indices[t + k] ?? 0,
        b = surface.indices[t + ((k + 1) % 3)] ?? 0;
      required(sets[a]).add(b);
      required(sets[b]).add(a);
    }
  const result = sets.map((set) => Uint32Array.from(set));
  rings.set(surface.indices, result);
  return result;
}

function fineCorrection(
  surface: HumanSurface,
  rows: Uint32Array,
  goal: Float32Array,
  weights: Float32Array,
  member: Member,
  contacts: Contact[],
  guard: ReturnType<typeof eyeGuard>,
  strain = 0.5,
) {
  const count = surface.positions.length / 3,
    near = cageRings(surface),
    p = surface.positions;
  const offsets = new Float32Array(count * 3),
    state = new Uint8Array(count);
  const orbit = (guard?.balls ?? []).map(({ c, radius }) => {
    const mean = [0, 0, 0];
    let total = 0;
    rows.forEach((v, i) => {
      const clearance =
        Math.hypot(
          (p[v * 3] ?? 0) - (c[0] ?? 0),
          (p[v * 3 + 1] ?? 0) - (c[1] ?? 0),
          (p[v * 3 + 2] ?? 0) - (c[2] ?? 0),
        ) - radius;
      if (clearance < 0.006 * guard.scale || clearance > 0.014 * guard.scale) return;
      total += weights[i] ?? 0;
      for (let d = 0; d < 3; d++)
        mean[d] =
          (mean[d] ?? 0) + (weights[i] ?? 0) * ((goal[i * 3 + d] ?? 0) - (p[v * 3 + d] ?? 0));
    });
    return total ? mean.map((x) => x / total) : [0, 0, 0];
  });
  const guarded = (v: number, d: number, value: number) =>
    guard && (guard.eye[v] ?? 0) >= 0
      ? (guard.free[v] ?? 0) * value +
        (1 - (guard.free[v] ?? 0)) * (required(orbit[guard.eye[v] ?? 0])[d] ?? 0)
      : value;
  rows.forEach((v, i) => {
    state[v] = 1;
    for (let d = 0; d < 3; d++)
      offsets[v * 3 + d] =
        (weights[i] ?? 0) * guarded(v, d, (goal[i * 3 + d] ?? 0) - (p[v * 3 + d] ?? 0));
  });
  if (guard)
    for (let v = 0; v < surface.bodyVertices; v++)
      if (!state[v] && member(v) && (guard.eye[v] ?? 0) >= 0 && (guard.free[v] ?? 0) < 0.5) {
        state[v] = 1;
        for (let d = 0; d < 3; d++) offsets[v * 3 + d] = required(orbit[guard.eye[v] ?? 0])[d] ?? 0;
      }
  const open = [];
  for (let v = 0; v < surface.bodyVertices; v++)
    if (!state[v]) {
      if (member(v)) {
        state[v] = 2;
        open.push(v);
      } else state[v] = 1;
    }
  for (let sweep = 0; sweep < 300; sweep++)
    for (const v of open) {
      const ring = required(near[v]);
      if (!ring.length) continue;
      let x = 0,
        y = 0,
        z = 0;
      for (const u of ring) {
        x += offsets[u * 3] ?? 0;
        y += offsets[u * 3 + 1] ?? 0;
        z += offsets[u * 3 + 2] ?? 0;
      }
      offsets[v * 3] = x / ring.length;
      offsets[v * 3 + 1] = y / ring.length;
      offsets[v * 3 + 2] = z / ring.length;
    }
  const reached = Uint8Array.from(state, (s) => (s === 1 ? 1 : 0)),
    queue = Array.from(rows);
  while (queue.length) {
    const v = queue.pop() ?? 0;
    for (const u of required(near[v]))
      if (!reached[u] && state[u] === 2) {
        reached[u] = 1;
        queue.push(u);
      }
  }
  const nearest = (v: number) => {
    const best: [number, number][] = [
      [Infinity, 0],
      [Infinity, 0],
      [Infinity, 0],
      [Infinity, 0],
    ];
    for (const r of rows) {
      const d =
        ((p[r * 3] ?? 0) - (p[v * 3] ?? 0)) ** 2 +
        ((p[r * 3 + 1] ?? 0) - (p[v * 3 + 1] ?? 0)) ** 2 +
        ((p[r * 3 + 2] ?? 0) - (p[v * 3 + 2] ?? 0)) ** 2;
      if (d < (required(best[3])[0] ?? 0)) {
        best[3] = [d, r];
        best.sort((a, b) => a[0] - b[0]);
      }
    }
    let total = 0;
    const out = [0, 0, 0];
    for (const [d, r] of best) {
      const w = 1 / Math.max(d, 1e-8);
      total += w;
      for (let k = 0; k < 3; k++) out[k] = (out[k] ?? 0) + w * (offsets[r * 3 + k] ?? 0);
    }
    return out.map((x) => x / total);
  };
  for (const v of open) if (!reached[v]) offsets.set(nearest(v), v * 3);
  const grouped = new Set<number>();
  (surface.eyeGroups ?? []).forEach((group, e) => {
    let mean = required(orbit[e]);
    if (!mean) {
      mean = [0, 0, 0];
      for (const v of group) {
        const o = nearest(v);
        for (let k = 0; k < 3; k++) mean[k] = (mean[k] ?? 0) + (o[k] ?? 0) / group.length;
      }
    }
    if (!member(group[0] ?? 0)) return;
    for (const v of group) {
      offsets.set(mean, v * 3);
      grouped.add(v);
    }
  });
  for (let v = surface.bodyVertices; v < count; v++)
    if (!grouped.has(v) && member(v)) offsets.set(nearest(v), v * 3);
  const hold = () => {
    for (let pass = 0; pass < 20 && contacts.length; pass++)
      for (const [a, b, length] of contacts) {
        const d = [0, 1, 2].map(
          (k) =>
            (p[b * 3 + k] ?? 0) +
            (offsets[b * 3 + k] ?? 0) -
            (p[a * 3 + k] ?? 0) -
            (offsets[a * 3 + k] ?? 0),
        );
        const now = Math.hypot(...d);
        if (now < 1e-9) continue;
        const move = (now - length) / (2 * now);
        for (let k = 0; k < 3; k++) {
          offsets[a * 3 + k] = (offsets[a * 3 + k] ?? 0) + move * (d[k] ?? 0);
          offsets[b * 3 + k] = (offsets[b * 3 + k] ?? 0) - move * (d[k] ?? 0);
        }
      }
  };
  const stats = { strainedVertices: 0, worstStrain: 0, worstStrainAfter: 0 };
  const relax = () => {
    for (let pass = 0; pass < 80; pass++) {
      const hot = new Set<number>();
      let worst = 0;
      for (let v = 0; v < surface.bodyVertices; v++)
        for (const u of required(near[v])) {
          if (u <= v || u >= surface.bodyVertices || !(member(v) || member(u))) continue;
          const edge = Math.hypot(
            (p[u * 3] ?? 0) - (p[v * 3] ?? 0),
            (p[u * 3 + 1] ?? 0) - (p[v * 3 + 1] ?? 0),
            (p[u * 3 + 2] ?? 0) - (p[v * 3 + 2] ?? 0),
          );
          const change = Math.hypot(
            (offsets[u * 3] ?? 0) - (offsets[v * 3] ?? 0),
            (offsets[u * 3 + 1] ?? 0) - (offsets[v * 3 + 1] ?? 0),
            (offsets[u * 3 + 2] ?? 0) - (offsets[v * 3 + 2] ?? 0),
          );
          worst = Math.max(worst, change / Math.max(edge, 1e-9));
          if (change > strain * edge) {
            if (member(v)) hot.add(v);
            if (member(u)) hot.add(u);
          }
        }
      if (!pass) stats.worstStrain = worst;
      stats.worstStrainAfter = worst;
      if (!hot.size) break;
      if (!pass) stats.strainedVertices = hot.size;
      const prior = offsets.slice();
      for (const v of hot) {
        let x = 0,
          y = 0,
          z = 0,
          n = 0;
        for (const u of required(near[v]))
          if (u < surface.bodyVertices) {
            x += prior[u * 3] ?? 0;
            y += prior[u * 3 + 1] ?? 0;
            z += prior[u * 3 + 2] ?? 0;
            n++;
          }
        if (!n) continue;
        offsets[v * 3] = 0.5 * ((prior[v * 3] ?? 0) + x / n);
        offsets[v * 3 + 1] = 0.5 * ((prior[v * 3 + 1] ?? 0) + y / n);
        offsets[v * 3 + 2] = 0.5 * ((prior[v * 3 + 2] ?? 0) + z / n);
      }
    }
  };
  for (let round = 0; round < 4; round++) {
    hold();
    if (strain > 0) relax();
  }
  return { offsets, stats };
}

function foldGuard(body: HumanBody, reference: HumanSurface, member: Member) {
  const smoothBefore = smoothHumanSurface(body, reference),
    offsets = body.arrays.u32("subOffsets"),
    refs = body.arrays.u16("subRefs"),
    factors = body.arrays.f32("subFactors");
  const count = smoothBefore.positions.length / 3,
    inside = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    let share = 0;
    for (let j = offsets[i] ?? 0; j < (offsets[i + 1] ?? 0); j++)
      if (member(refs[j] ?? 0)) share += factors[j] ?? 0;
    inside[i] = share > 0.5 ? 1 : 0;
  }
  const cage = (t: number) => [0, 1, 2].every((k) => member(reference.indices[t * 3 + k] ?? 0));
  const smooth = (t: number) =>
    [0, 1, 2].every((k) => inside[smoothBefore.indices[t * 3 + k] ?? 0] ?? 0);
  const folds = (surface: HumanSurface) => {
    const now = smoothHumanSurface(body, surface);
    return {
      cage: foldedTriangles(
        reference.positions,
        surface.positions,
        surface.indices,
        surface.bodyTriangles,
        cage,
      ).folded,
      drawn: foldedTriangles(
        smoothBefore.positions,
        now.positions,
        now.indices,
        now.indices.length / 3,
        smooth,
      ).folded,
    };
  };
  return {
    folds,
    turned(surface: HumanSurface) {
      const found = folds(surface),
        out = new Set<number>();
      for (const t of found.cage)
        for (let k = 0; k < 3; k++) out.add(surface.indices[t * 3 + k] ?? 0);
      for (const t of found.drawn)
        for (let k = 0; k < 3; k++) {
          const i = smoothBefore.indices[t * 3 + k] ?? 0;
          for (let j = offsets[i] ?? 0; j < (offsets[i + 1] ?? 0); j++)
            if ((factors[j] ?? 0) > 0.01 && member(refs[j] ?? 0)) out.add(refs[j] ?? 0);
        }
      return out;
    },
  };
}

export function headShare(surface: HumanSurface, v: number) {
  const head = boneNames.indexOf("head");
  let share = 0;
  for (let j = 4 * v; j < 4 * v + 4; j++)
    if (surface.boneIndices[j] === head) share += surface.weights[j] ?? 0;
  return share;
}
function headContacts(before: HumanSurface) {
  const member = (v: number) => {
    const bone = boneNames[before.boneIndices[v * 4] ?? -1];
    return bone === "head" || !!bone?.startsWith("neck");
  };
  const inside = Array.from({ length: before.bodyVertices }, (_, i) => i).filter(member);
  const gap = (s: HumanSurface, a: number, b: number) =>
    Math.hypot(
      ...[0, 1, 2].map((k) => (s.positions[3 * a + k] ?? 0) - (s.positions[3 * b + k] ?? 0)),
    );
  const original = contactPairs(
    before.positions,
    before.indices,
    before.bodyTriangles,
    inside,
    (0.0022 * before.height) / 1.72,
  );
  const maxGap = (surface: HumanSurface) =>
    original.reduce((max, [a, b]) => Math.max(max, 1000 * gap(surface, a, b)), 0);
  return { original, member, gap, maxGap };
}

export function measuredHeadIntegrity(before: HumanSurface, measured: HumanSurface) {
  const { maxGap } = headContacts(before);
  return { folds: 0, contactBefore: maxGap(before), contactAfter: maxGap(measured) };
}

export function fittedHeadLayer(
  body: HumanBody,
  before: HumanSurface,
  coarse: HumanSurface,
  rows: Uint32Array,
  goal: Float32Array,
) {
  const { original, member, gap, maxGap } = headContacts(before);
  const contacts: Contact[] = original.map(([a, b]) => [
    a,
    b,
    (coarse.height / before.height) * gap(before, a, b),
  ]);
  const { offsets } = fineCorrection(
    coarse,
    rows,
    goal,
    Float32Array.from(rows, (v) => headShare(coarse, v)),
    member,
    contacts,
    eyeGuard(coarse),
  );
  const guard = foldGuard(body, coarse, member);
  let encoded = encodeHeadLayer(body, coarse, offsets),
    surface = applyHeadLayer(body, coarse, encoded.layer);
  for (let pass = 0; pass < 10; pass++) {
    const turned = guard.turned(surface);
    if (!turned.size) break;
    for (const v of turned)
      for (let k = 0; k < 3; k++)
        offsets[3 * v + k] = (offsets[3 * v + k] ?? 0) * (pass < 7 ? 0.6 : 0);
    encoded = encodeHeadLayer(body, coarse, offsets);
    surface = applyHeadLayer(body, coarse, encoded.layer);
  }
  const folds = guard.folds(surface);
  return {
    ...encoded,
    folds: folds.cage.length + folds.drawn.length,
    contactBefore: maxGap(before),
    contactAfter: maxGap(surface),
  };
}
