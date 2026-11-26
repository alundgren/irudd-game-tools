import { capturedAxes } from "./human-captured-portraits.js";
import {
  applyHumanControls,
  applyHumanDetail,
  controlVectors,
  evaluateHuman,
  humanDetailFrom,
  humanDetailLimit,
  humanSmoothSources,
  smoothHumanSurface,
  humanFitAxes,
  humanControls,
  humanRange,
  validHuman,
} from "./human-surface.js";
import { transportHumanFit } from "./human-fit-frame.js";
import {
  alignPoints,
  contactPairs,
  foldedTriangles,
  familySurface,
  registerFamily,
  solveControls,
  transformPoints,
  transportDisplacements,
  vertexFrames,
  wrapFamilyMember,
} from "./family-transfer.js";

export { applyHumanDetail, validHumanDetail } from "./human-surface.js";


export const familyRegions = ["whole", "head", "trunk", "arms", "legs"];
const longest = 0.0649;

function partRegion(name) {
  if (name === "head" || name.startsWith("neck")) return "head";
  if (/thigh|calf|foot|ball/.test(name)) return "legs";
  if (/arm|hand|thumb|index|middle|ring|pinky/.test(name)) return "arms";
  return "trunk";
}
const boneOf = (surface, v) => surface.names[surface.boneIndices[v * 4]];
const inRegion = (surface, region) => (v) => region === "whole" || partRegion(boneOf(surface, v)) === region;
const regionShare = (surface, region) => (v) => {
  if (region === "whole") return 1;
  let share = 0;
  for (let j = v * 4; j < v * 4 + 4; j++) {
    const name = surface.names[surface.boneIndices[j]];
    if (region === "head" ? name === "head" : partRegion(name) === region) share += surface.weights[j];
  }
  return share;
};

function bodyMesh(surface) {
  return { positions: surface.positions, indices: surface.indices, triangles: surface.bodyTriangles };
}

export function registerHumanFamily(form, neutral, { reach = 0.012, agree = 0.5, refine = 0, damping = 0.02, smoothing = 0.05 } = {}) {
  if (!form?.human) throw new Error("Fit an editable adult to the family's neutral first.");
  const family = neutral.closest ? neutral : familySurface(neutral.positions, neutral.indices);
  const controls = humanControls();
  let human = { ...form.human }, fit = form.humanFit;
  let surface = evaluateHuman(human, fit);
  const scale = surface.height / 1.72;
  const vertices = Uint32Array.from({ length: surface.bodyVertices }, (_, i) => i);
  const register = () => registerFamily(family, bodyMesh(surface), { vertices, reach: reach * scale, agree, slip: 0.0005 * scale });
  const history = [];
  let registration = register();
  for (let pass = 0; pass < refine; pass++) {
    const rows = registration.vertex, goal = wrapFamilyMember(registration, family, 0);
    history.push(spread(registration.distance).meanMm);
    const rest = evaluateHuman(human), first = fit;
    const evaluate = (p) => evaluateHuman(p, first ? transportHumanFit(first, rest, evaluateHuman(p)) : undefined);
    human = fitMeasurements(human, evaluate, rows, new Float32Array(rows.length).fill(1), goal, null,
      regionMeasurements(human, "whole"), { passes: 2 });
    if (first) fit = transportHumanFit(first, rest, evaluateHuman(human));
    const plain = evaluateHuman(human), vectors = controlVectors(fit);
    surface = applyHumanControls(plain, vectors);
    const now = gather(surface.positions, rows), wanted = new Float32Array(now.length);
    for (let i = 0; i < now.length; i++) wanted[i] = goal[i] - now[i];
    const pairs = contactPairs(surface.positions, surface.indices, surface.bodyTriangles, vertices, 0.0022 * scale);
    const change = solveControls(controls, Array.from(rows, (vertex) => ({ vertex, weight: 1 })), wanted, { scale, damping, smoothing, pairs });
    const saved = [];
    for (let i = 0; i < controls.ids.length; i++) {
      const v = [0, 1, 2].map((d) => vectors[i * 3 + d] + change[i * 3 + d]), length = Math.hypot(...v);
      const q = v.map((x) => Math.round((length > longest ? (x * longest) / length : x) * 10000));
      if (q.some(Boolean)) saved.push([i, ...q]);
    }
    fit = { version: 1, strength: 1, controls: saved };
    surface = evaluateHuman(human, fit);
    registration = register();
  }
  history.push(spread(registration.distance).meanMm);
  const coverage = {};
  for (const region of familyRegions) {
    const member = inRegion(surface, region);
    let all = 0, kept = 0;
    for (let v = 0; v < surface.bodyVertices; v++) if (member(v)) all++;
    for (const v of registration.vertex) if (member(v)) kept++;
    coverage[region] = { vertices: all, registered: kept };
  }
  const gaps = Float32Array.from(registration.distance).sort();
  return {
    ...registration,
    human,
    ...(fit ? { humanFit: fit } : {}),
    report: {
      refineMeanGapMm: history,
      coverage,
      meanGapMm: (1000 * gaps.reduce((a, b) => a + b, 0)) / Math.max(1, gaps.length),
      p95GapMm: 1000 * (gaps[Math.floor(0.95 * (gaps.length - 1))] ?? 0),
    },
  };
}

function gather(positions, vertices) {
  const out = new Float32Array(vertices.length * 3);
  for (let i = 0; i < vertices.length; i++)
    for (let d = 0; d < 3; d++) out[i * 3 + d] = positions[vertices[i] * 3 + d];
  return out;
}
function spread(values) {
  const d = Float32Array.from(values).sort();
  if (!d.length) return { meanMm: 0, p95Mm: 0, maxMm: 0, samples: 0 };
  return {
    meanMm: (1000 * d.reduce((a, b) => a + b, 0)) / d.length,
    p95Mm: 1000 * d[Math.floor(0.95 * (d.length - 1))],
    maxMm: 1000 * d[d.length - 1],
    samples: d.length,
  };
}
function distances(a, b) {
  const out = new Float32Array(a.length / 3);
  for (let i = 0; i < out.length; i++)
    out[i] = Math.hypot(a[i * 3] - b[i * 3], a[i * 3 + 1] - b[i * 3 + 1], a[i * 3 + 2] - b[i * 3 + 2]);
  return out;
}
const sameRecipe = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function regionMeasurements(human, region) {
  const base = evaluateHuman(human), scale = base.height / 1.72, member = inRegion(base, region), keys = [];
  for (const key of humanFitAxes) {
    const [lo, hi, initial] = humanRange(key), value = human[key] ?? initial;
    const step = key === "height" ? 0.04 : 0.3, trial = value + step > hi ? value - step : value + step;
    if (trial < lo) continue;
    const moved = evaluateHuman({ ...human, [key]: trial });
    let inside = 0, outside = 0;
    for (let v = 0; v < base.bodyVertices; v++) {
      const d = Math.hypot(moved.positions[v * 3] - base.positions[v * 3],
        moved.positions[v * 3 + 1] - base.positions[v * 3 + 1], moved.positions[v * 3 + 2] - base.positions[v * 3 + 2]);
      if (member(v)) inside = Math.max(inside, d);
      else outside = Math.max(outside, d);
    }
    if (inside > 0.0003 * scale && (region === "whole" || outside < 0.0004 * scale)) keys.push(key);
  }
  return keys;
}

function solveDense(a, b, n) {
  const m = a.map((row, i) => [...row, b[i]]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let j = k + 1; j < n; j++) if (Math.abs(m[j][k]) > Math.abs(m[pivot][k])) pivot = j;
    [m[pivot], m[k]] = [m[k], m[pivot]];
    if (Math.abs(m[k][k]) < 1e-18) continue;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const f = m[i][k] / m[k][k];
      if (f) for (let j = k; j <= n; j++) m[i][j] -= f * m[k][j];
    }
  }
  return m.map((row, i) => (Math.abs(row[i]) < 1e-18 ? 0 : row[n] / row[i]));
}

function fitMeasurements(human, evaluate, rows, weights, target, placement, keys, { passes = 6, prior = 0.004 } = {}) {
  const params = { ...human };
  const read = (surface) => gather(surface.positions, rows);
  const place = (now) => (placement ? transformPoints(target, alignPoints(gather(target, placement), gather(now, placement)).matrix) : target);
  const loss = (now, goal) => {
    let sum = 0;
    for (let i = 0; i < now.length; i++) sum += weights[(i / 3) | 0] * (goal[i] - now[i]) ** 2;
    return sum;
  };
  let now = read(evaluate(params)), goal = place(now), error = loss(now, goal);
  const n = keys.length;
  for (let pass = 0; pass < passes && n; pass++) {
    const columns = keys.map((key) => {
      const [, hi, initial] = humanRange(key), value = params[key] ?? initial;
      const size = key === "height" ? 0.02 : 0.08, step = value + size > hi ? -size : size;
      const other = read(evaluate({ ...params, [key]: value + step }));
      for (let i = 0; i < other.length; i++) other[i] = (other[i] - now[i]) / step;
      return other;
    });
    const a = keys.map(() => new Float64Array(n)), b = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < now.length; i++) b[j] += weights[(i / 3) | 0] * columns[j][i] * (goal[i] - now[i]);
      for (let k = 0; k <= j; k++) {
        let sum = 0;
        for (let i = 0; i < now.length; i++) sum += weights[(i / 3) | 0] * columns[j][i] * columns[k][i];
        a[j][k] = a[k][j] = sum;
      }
    }
    let mean = 0;
    for (let j = 0; j < n; j++) mean += a[j][j] / n;
    for (let j = 0; j < n; j++) {
      const [, , initial] = humanRange(keys[j]);
      a[j][j] += prior * mean + 0.02 * a[j][j];
      b[j] -= prior * mean * ((params[keys[j]] ?? initial) - (human[keys[j]] ?? initial));
    }
    const step = solveDense(a, b, n);
    let accepted = false;
    for (const alpha of [1, 0.5, 0.25]) {
      const trial = { ...params };
      keys.forEach((key, j) => {
        const [lo, hi, initial] = humanRange(key), reach = key === "height" ? 0.2 : 0.6;
        trial[key] = +Math.min(hi, Math.max(lo, (params[key] ?? initial) + alpha * Math.max(-reach, Math.min(reach, step[j])))).toFixed(4);
      });
      const next = read(evaluate(trial)), nextGoal = place(next), nextError = loss(next, nextGoal);
      if (nextError < error * 0.9995) {
        Object.assign(params, trial);
        now = next; goal = nextGoal; error = nextError; accepted = true;
        break;
      }
    }
    if (!accepted) break;
  }
  return params;
}

function eyeGuard(surface) {
  const count = surface.positions.length / 3, scale = surface.height / 1.72, p = surface.positions;
  const free = new Float32Array(count).fill(1), eye = new Int8Array(count).fill(-1), balls = [];
  (surface.eyeGroups ?? []).forEach((group, e) => {
    const c = [0, 0, 0];
    for (const v of group) for (let d = 0; d < 3; d++) c[d] += p[v * 3 + d] / group.length;
    let radius = 0;
    for (const v of group) radius += Math.hypot(p[v * 3] - c[0], p[v * 3 + 1] - c[1], p[v * 3 + 2] - c[2]) / group.length;
    balls.push({ c, radius, group });
    for (let v = 0; v < count; v++) {
      const clearance = Math.hypot(p[v * 3] - c[0], p[v * 3 + 1] - c[1], p[v * 3 + 2] - c[2]) - radius;
      const t = Math.min(1, Math.max(0, (clearance - 0.001 * scale) / (0.005 * scale))), w = t * t * (3 - 2 * t);
      if (w < free[v]) { free[v] = w; eye[v] = e; }
    }
    for (const v of group) { free[v] = 0; eye[v] = e; }
  });
  return { free, eye, balls, scale };
}

let rings;
function cageRings(surface) {
  if (rings) return rings;
  const sets = Array.from({ length: surface.positions.length / 3 }, () => new Set());
  for (let t = 0; t < surface.indices.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = surface.indices[t + k], b = surface.indices[t + ((k + 1) % 3)];
      sets[a].add(b); sets[b].add(a);
    }
  return (rings = sets.map((set) => Uint32Array.from(set)));
}

function detailLengths(detail, scale) {
  return detail ? detail.vertices.map((_, i) => 0.00001 * scale * Math.hypot(detail.offsets[i * 3], detail.offsets[i * 3 + 1], detail.offsets[i * 3 + 2])) : [];
}
function fineCorrection(surface, rows, goal, weights, member, contacts = [], guard, strain = 0.5) {
  const count = surface.positions.length / 3, near = cageRings(surface), p = surface.positions;
  const offsets = new Float32Array(count * 3), state = new Uint8Array(count);
  const orbit = (guard?.balls ?? []).map(({ c, radius }) => {
    const mean = [0, 0, 0];
    let total = 0;
    rows.forEach((v, i) => {
      const clearance = Math.hypot(p[v * 3] - c[0], p[v * 3 + 1] - c[1], p[v * 3 + 2] - c[2]) - radius;
      if (clearance < 0.006 * guard.scale || clearance > 0.014 * guard.scale) return;
      total += weights[i];
      for (let d = 0; d < 3; d++) mean[d] += weights[i] * (goal[i * 3 + d] - p[v * 3 + d]);
    });
    return total ? mean.map((x) => x / total) : [0, 0, 0];
  });
  const guarded = (v, d, value) => (guard && guard.eye[v] >= 0 ? guard.free[v] * value + (1 - guard.free[v]) * orbit[guard.eye[v]][d] : value);
  rows.forEach((v, i) => {
    state[v] = 1;
    for (let d = 0; d < 3; d++) offsets[v * 3 + d] = weights[i] * guarded(v, d, goal[i * 3 + d] - p[v * 3 + d]);
  });
  if (guard)
    for (let v = 0; v < surface.bodyVertices; v++)
      if (!state[v] && member(v) && guard.eye[v] >= 0 && guard.free[v] < 0.5) {
        state[v] = 1;
        for (let d = 0; d < 3; d++) offsets[v * 3 + d] = orbit[guard.eye[v]][d];
      }
  const open = [];
  for (let v = 0; v < surface.bodyVertices; v++)
    if (!state[v]) {
      if (member(v)) { state[v] = 2; open.push(v); } else state[v] = 1;
    }
  for (let sweep = 0; sweep < 300; sweep++)
    for (const v of open) {
      const ring = near[v];
      if (!ring.length) continue;
      let x = 0, y = 0, z = 0;
      for (const u of ring) { x += offsets[u * 3]; y += offsets[u * 3 + 1]; z += offsets[u * 3 + 2]; }
      offsets[v * 3] = x / ring.length; offsets[v * 3 + 1] = y / ring.length; offsets[v * 3 + 2] = z / ring.length;
    }
  const reached = Uint8Array.from(state, (s) => (s === 1 ? 1 : 0)), queue = Array.from(rows);
  while (queue.length) {
    const v = queue.pop();
    for (const u of near[v]) if (!reached[u] && state[u] === 2) { reached[u] = 1; queue.push(u); }
  }
  const nearest = (v) => {
    const best = [[Infinity, 0], [Infinity, 0], [Infinity, 0], [Infinity, 0]];
    for (const r of rows) {
      const d = (p[r * 3] - p[v * 3]) ** 2 + (p[r * 3 + 1] - p[v * 3 + 1]) ** 2 + (p[r * 3 + 2] - p[v * 3 + 2]) ** 2;
      if (d < best[3][0]) { best[3] = [d, r]; best.sort((a, b) => a[0] - b[0]); }
    }
    let total = 0;
    const out = [0, 0, 0];
    for (const [d, r] of best) {
      const w = 1 / Math.max(d, 1e-8);
      total += w;
      for (let k = 0; k < 3; k++) out[k] += w * offsets[r * 3 + k];
    }
    return out.map((x) => x / total);
  };
  for (const v of open) if (!reached[v]) offsets.set(nearest(v), v * 3);
  const grouped = new Set();
  (surface.eyeGroups ?? []).forEach((group, e) => {
    let mean = orbit[e];
    if (!mean) {
      mean = [0, 0, 0];
      for (const v of group) { const o = nearest(v); for (let k = 0; k < 3; k++) mean[k] += o[k] / group.length; }
    }
    if (!member(group[0])) return;
    for (const v of group) { offsets.set(mean, v * 3); grouped.add(v); }
  });
  for (let v = surface.bodyVertices; v < count; v++) if (!grouped.has(v) && member(v)) offsets.set(nearest(v), v * 3);
  const hold = () => {
    for (let pass = 0; pass < 20 && contacts.length; pass++)
      for (const [a, b, length] of contacts) {
        const d = [0, 1, 2].map((k) => p[b * 3 + k] + offsets[b * 3 + k] - p[a * 3 + k] - offsets[a * 3 + k]);
        const now = Math.hypot(...d);
        if (now < 1e-9) continue;
        const move = (now - length) / (2 * now);
        for (let k = 0; k < 3; k++) { offsets[a * 3 + k] += move * d[k]; offsets[b * 3 + k] -= move * d[k]; }
      }
  };
  const stats = { strainedVertices: 0, worstStrain: 0 };
  const relax = () => {
    for (let pass = 0; pass < 80; pass++) {
      const hot = new Set();
      let worst = 0;
      for (let v = 0; v < surface.bodyVertices; v++)
        for (const u of near[v]) {
          if (u <= v || u >= surface.bodyVertices || !(member(v) || member(u))) continue;
          const edge = Math.hypot(p[u * 3] - p[v * 3], p[u * 3 + 1] - p[v * 3 + 1], p[u * 3 + 2] - p[v * 3 + 2]);
          const change = Math.hypot(offsets[u * 3] - offsets[v * 3], offsets[u * 3 + 1] - offsets[v * 3 + 1], offsets[u * 3 + 2] - offsets[v * 3 + 2]);
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
        let x = 0, y = 0, z = 0, n = 0;
        for (const u of near[v]) if (u < surface.bodyVertices) { x += prior[u * 3]; y += prior[u * 3 + 1]; z += prior[u * 3 + 2]; n++; }
        if (!n) continue;
        offsets[v * 3] = 0.5 * (prior[v * 3] + x / n); offsets[v * 3 + 1] = 0.5 * (prior[v * 3 + 1] + y / n); offsets[v * 3 + 2] = 0.5 * (prior[v * 3 + 2] + z / n);
      }
    }
  };
  for (let round = 0; round < 4; round++) {
    hold();
    if (strain > 0) relax();
  }
  return { offsets, stats };
}

function foldGuard(reference, member) {
  const smoothBefore = smoothHumanSurface(reference), { offsets, refs, factors } = humanSmoothSources();
  const count = smoothBefore.positions.length / 3, inside = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    let share = 0;
    for (let j = offsets[i]; j < offsets[i + 1]; j++) if (member(refs[j])) share += factors[j];
    inside[i] = share > 0.5 ? 1 : 0;
  }
  const cage = (t) => [0, 1, 2].every((k) => member(reference.indices[t * 3 + k]));
  const smooth = (t) => [0, 1, 2].every((k) => inside[smoothBefore.indices[t * 3 + k]]);
  const folds = (surface) => {
    const now = smoothHumanSurface(surface);
    return {
      cage: foldedTriangles(reference.positions, surface.positions, surface.indices, surface.bodyTriangles, cage).folded,
      drawn: foldedTriangles(smoothBefore.positions, now.positions, now.indices, now.indices.length / 3, smooth).folded,
    };
  };
  return {
    folds,
    turned(surface) {
      const found = folds(surface), out = new Set();
      for (const t of found.cage) for (let k = 0; k < 3; k++) out.add(surface.indices[t * 3 + k]);
      for (const t of found.drawn)
        for (let k = 0; k < 3; k++) {
          const i = smoothBefore.indices[t * 3 + k];
          for (let j = offsets[i]; j < offsets[i + 1]; j++) if (factors[j] > 0.01 && member(refs[j])) out.add(refs[j]);
        }
      return out;
    },
  };
}

export function eyeIntegrity(before, after) {
  const scale = before.height / 1.72, out = [];
  for (const group of before.eyeGroups ?? []) {
    const ball = (s) => {
      const c = [0, 0, 0];
      for (const v of group) for (let d = 0; d < 3; d++) c[d] += s.positions[v * 3 + d] / group.length;
      const reach = group.map((v) => Math.hypot(s.positions[v * 3] - c[0], s.positions[v * 3 + 1] - c[1], s.positions[v * 3 + 2] - c[2]));
      const radius = reach.reduce((a, b) => a + b, 0) / group.length;
      return { c, radius, reach };
    };
    const a = ball(before), b = ball(after);
    let stretch = 0;
    for (let i = 0; i < group.length; i++) stretch = Math.max(stretch, Math.abs(b.reach[i] - b.radius - (a.reach[i] - a.radius)));
    const clear = (s, { c, radius }, v) => Math.hypot(s.positions[v * 3] - c[0], s.positions[v * 3 + 1] - c[1], s.positions[v * 3 + 2] - c[2]) - radius;
    let was = Infinity, now = Infinity, change = 0, lids = 0;
    for (let v = 0; v < before.bodyVertices; v++) {
      const old = clear(before, a, v);
      if (old > 0.0025 * scale) continue;
      const next = clear(after, b, v);
      lids++; was = Math.min(was, old); now = Math.min(now, next); change = Math.max(change, Math.abs(next - old));
    }
    out.push({ lidVertices: lids, ballStretchMm: 1000 * stretch, deepestSkinBeforeMm: 1000 * was, deepestSkinAfterMm: 1000 * now,
      largestClearanceChangeMm: 1000 * change, ballShiftMm: 1000 * Math.hypot(b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]) });
  }
  return out;
}

function buildLayer(coarse, rows, goal, weights, member, held, guard, strain) {
  const { offsets: moves, stats } = fineCorrection(coarse, rows, goal, weights, member, held, guard, strain);
  let detail, surface;
  const build = () => {
    detail = humanDetailFrom(coarse, moves);
    surface = applyHumanDetail(coarse, detail);
  };
  build();
  const drawn = foldGuard(coarse, member);
  for (let pass = 0; pass < 10; pass++) {
    const eased = drawn.turned(surface);
    if (!eased.size) break;
    for (const v of eased) for (let d = 0; d < 3; d++) moves[v * 3 + d] *= pass < 7 ? 0.6 : 0;
    build();
    stats.easedDetailVertices = (stats.easedDetailVertices ?? 0) + eased.size;
  }
  return { detail, surface, stats };
}

export function keepHumanHead(was, next, { detailStrain = 0.5 } = {}) {
  if (!was?.humanDetail) return { metrics: null };
  const old = evaluateHuman(was.human, was.humanFit, was.humanDetail);
  const coarse = evaluateHuman(next.human, next.humanFit), scale = coarse.height / 1.72, size = coarse.height / old.height;
  const member = inRegion(coarse, "head"), share = regionShare(coarse, "head"), list = [], inside = [];
  for (let v = 0; v < coarse.bodyVertices; v++) {
    if (!member(v)) continue;
    inside.push(v);
    if (share(v) > 0.05) list.push(v);
  }
  const rows = Uint32Array.from(list), weights = Float32Array.from(rows, share), firm = [];
  rows.forEach((v, i) => weights[i] > 0.9 && firm.push(i));
  const joint = coarse.names.indexOf("head") * 3, goal = new Float32Array(rows.length * 3);
  rows.forEach((v, i) => {
    for (let d = 0; d < 3; d++) goal[i * 3 + d] = coarse.joints[joint + d] + size * (old.positions[v * 3 + d] - old.joints[joint + d]);
  });
  const held = contactPairs(old.positions, old.indices, old.bodyTriangles, inside, (0.0022 * old.height) / 1.72).map(([a, b]) => [a, b,
    size * Math.hypot(old.positions[a * 3] - old.positions[b * 3], old.positions[a * 3 + 1] - old.positions[b * 3 + 1], old.positions[a * 3 + 2] - old.positions[b * 3 + 2])]);
  const away = (surface) => spread(distances(gather(gather(surface.positions, rows), firm), gather(goal, firm)));
  const carried = away(applyHumanDetail(coarse, was.humanDetail));
  const made = buildLayer(coarse, rows, goal, weights, member, held, eyeGuard(coarse), detailStrain);
  const turned = foldGuard(coarse, member).folds(made.surface), lengths = detailLengths(made.detail, scale);
  return {
    detail: made.detail,
    metrics: {
      carried, kept: away(made.surface), folds: turned.cage.length, drawnFolds: turned.drawn.length,
      detail: { vertices: made.detail?.vertices.length ?? 0, ...spread(lengths), limited: lengths.filter((x) => x >= 0.00001 * scale * (humanDetailLimit - 1)).length },
    },
  };
}

export function transferHumanIdentity(registration, identity, {
  region = "head", form, measurements = true, controls: useControls = true, detail: useDetail = false,
  size = "source", keepContacts = true, guardEyes = true, damping = 0.02, smoothing = 0.05, keepOffset = 0, detailStrain = 0.5,
} = {}) {
  if (!familyRegions.includes(region)) throw new Error("Unknown transfer region.");
  const base = { human: registration.human, ...(registration.humanFit ? { humanFit: registration.humanFit } : {}) };
  const start = form?.human ? { human: form.human, ...(form.humanFit ? { humanFit: form.humanFit } : {}) } : base;
  if (!validHuman(start.human)) throw new Error("Choose supported adult human measurements.");
  const controls = humanControls();
  const before = evaluateHuman(start.human, start.humanFit), scale = before.height / 1.72;
  const member = inRegion(before, region), share = regionShare(before, region);

  const picks = [];
  for (let i = 0; i < registration.vertex.length; i++) {
    const v = registration.vertex[i];
    if (member(v) && share(v) > 0.05) picks.push(i);
  }
  if (picks.length < 30) throw new Error("Too little of this region is registered against the family.");
  const rows = Uint32Array.from(picks, (i) => registration.vertex[i]);
  const lids = guardEyes ? eyeGuard(before).free : null;
  const weights = Float32Array.from(rows, (v) => share(v) * (lids ? lids[v] : 1));
  const placement = [], core = [];
  rows.forEach((v, i) => {
    if (weights[i] > 0.9) placement.push(i);
    if (weights[i] > 0.5) core.push(i);
  });
  if (placement.length < 30) throw new Error("Too little of this region is registered against the family.");
  const wrapped = wrapFamilyMember(registration, identity, keepOffset), source = new Float32Array(rows.length * 3);
  picks.forEach((i, r) => source.set(wrapped.subarray(i * 3, i * 3 + 3), r * 3));
  const registered = gather(registration.base, rows);
  const fitted = alignPoints(gather(source, placement), gather(registered, placement), { scale: size === "native" });
  const placed = transformPoints(source, fitted.matrix);

  let target;
  if (sameRecipe(start, base) || keepOffset !== 1) target = placed;
  else {
    const moves = new Float32Array(placed.length);
    for (let i = 0; i < moves.length; i++) moves[i] = placed[i] - registered[i];
    const from = vertexFrames(registration.base, before.indices, before.bodyTriangles);
    const to = vertexFrames(before.positions, before.indices, before.bodyTriangles, from.partner);
    const baseHeight = registration.human.height ?? 1.72;
    const carried = transportDisplacements(rows, moves, from.frames, to.frames, size === "native" ? before.height / baseHeight : 1);
    target = gather(before.positions, rows);
    for (let i = 0; i < target.length; i++) target[i] += carried[i];
  }
  const residual = (surface, goal) => spread(distances(gather(gather(surface.positions, rows), core), gather(goal, core)));
  const replace = region === "whole" ? null : placement;
  const settle = (surface) =>
    replace ? transformPoints(target, alignPoints(gather(target, replace), gather(gather(surface.positions, rows), replace)).matrix) : target;
  const metrics = { region, registered: rows.length, sourceScale: fitted.scale, start: residual(before, settle(before)) };

  let human = start.human, fit = start.humanFit;
  const rest = evaluateHuman(start.human);
  const carry = (p) => (region === "whole" ? transportHumanFit(start.humanFit, rest, evaluateHuman(p)) : start.humanFit);
  const evaluate = (p) => evaluateHuman(p, fit ? carry(p) : undefined);
  if (measurements) {
    const keys = regionMeasurements(start.human, region);
    if (region === "head" && keepOffset === 0) {
      keys.push(...capturedAxes.filter(axis => start.human[axis] > 0));
    }
    human = fitMeasurements(start.human, evaluate, rows, weights, target, replace, keys);
    if (fit) fit = carry(human);
    metrics.measurementKeys = keys;
  }
  let surface = evaluateHuman(human, fit), goal = settle(surface);
  metrics.afterMeasurements = residual(surface, goal);
  const shaped = surface;

  if (useControls) {
    const plain = evaluateHuman(human);
    const free = Uint8Array.from(controls.ids, (v) => (member(v) ? 1 : 0));
    const list = Array.from(rows, (vertex, i) => ({ vertex, weight: weights[i] }));
    const outside = [];
    for (let v = 0; v < plain.bodyVertices; v++) {
      if (member(v)) continue;
      for (let j = v * 4; j < v * 4 + 4; j++)
        if (controls.weights[j] && free[controls.refs[j]]) { outside.push(v); break; }
    }
    for (const vertex of outside) list.push({ vertex, weight: 2 });
    const regionVertices = [];
    for (let v = 0; v < plain.bodyVertices; v++) if (member(v)) regionVertices.push(v);
    const pairs = keepContacts
      ? contactPairs(surface.positions, surface.indices, surface.bodyTriangles, regionVertices, 0.0022 * scale)
      : [];
    const first = controlVectors(fit), vectors = first.slice();
    const clamp = () => {
      let limited = 0;
      for (let i = 0; i < vectors.length; i += 3) {
        const length = Math.hypot(vectors[i], vectors[i + 1], vectors[i + 2]);
        if (length > longest) {
          for (let d = 0; d < 3; d++) vectors[i + d] *= longest / length;
          limited++;
        }
        for (let d = 0; d < 3; d++) vectors[i + d] = Math.round(vectors[i + d] * 10000) / 10000;
      }
      return limited;
    };
    for (let pass = 0; pass < 3; pass++) {
      const wanted = new Float32Array(list.length * 3), now = gather(surface.positions, rows);
      for (let i = 0; i < now.length; i++) wanted[i] = goal[i] - now[i];
      outside.forEach((v, k) => {
        for (let d = 0; d < 3; d++) wanted[(rows.length + k) * 3 + d] = shaped.positions[v * 3 + d] - surface.positions[v * 3 + d];
      });
      const change = solveControls(controls, list, wanted, { free, scale, damping, smoothing, pairs });
      for (let i = 0; i < vectors.length; i++) vectors[i] += change[i];
      metrics.limitedAnchors = clamp();
      surface = applyHumanControls(plain, vectors);
      goal = settle(surface);
    }
    metrics.contactPairs = pairs.length;
    const counted = (t) => [0, 1, 2].every((k) => member(surface.indices[t * 3 + k]));
    for (let pass = 0; pass < 12; pass++) {
      const { folded } = foldedTriangles(shaped.positions, surface.positions, surface.indices, surface.bodyTriangles, counted);
      if (!folded.length) break;
      const affected = new Set();
      for (const t of folded)
        for (let k = 0; k < 3; k++) {
          const v = surface.indices[t * 3 + k];
          for (let j = v * 4; j < v * 4 + 4; j++) if (controls.weights[j] && free[controls.refs[j]]) affected.add(controls.refs[j]);
        }
      for (const i of affected)
        for (let d = 0; d < 3; d++) {
          const k = i * 3 + d;
          vectors[k] = first[k] + (pass < 8 ? 0.62 : 0) * (vectors[k] - first[k]);
        }
      clamp();
      surface = applyHumanControls(plain, vectors);
      metrics.withdrawnAnchors = (metrics.withdrawnAnchors ?? 0) + affected.size;
    }
    const saved = [];
    for (let i = 0; i < controls.ids.length; i++) {
      const q = [0, 1, 2].map((d) => Math.round(vectors[i * 3 + d] * 10000));
      if (q.some(Boolean)) saved.push([i, ...q]);
    }
    fit = { version: 1, strength: 1, controls: saved };
    surface = evaluateHuman(human, fit);
    goal = settle(surface);
    metrics.afterControls = residual(surface, goal);
  }

  let detail;
  if (useDetail) {
    const coarse = surface;
    const held = [];
    if (keepContacts) {
      const inside = [];
      for (let v = 0; v < before.bodyVertices; v++) if (member(v)) inside.push(v);
      for (const [a, b] of contactPairs(before.positions, before.indices, before.bodyTriangles, inside, 0.0022 * scale))
        held.push([a, b, (coarse.height / before.height) * Math.hypot(before.positions[a * 3] - before.positions[b * 3],
          before.positions[a * 3 + 1] - before.positions[b * 3 + 1], before.positions[a * 3 + 2] - before.positions[b * 3 + 2])]);
    }
    const made = buildLayer(coarse, rows, goal, Float32Array.from(rows, share), member, held, guardEyes ? eyeGuard(coarse) : undefined, detailStrain);
    Object.assign(metrics, made.stats);
    ({ detail, surface } = made);
    metrics.afterDetail = residual(surface, goal);
    const lengths = detailLengths(detail, scale);
    metrics.detail = { vertices: detail?.vertices.length ?? 0, ...spread(lengths), limited: lengths.filter((x) => x >= 0.00001 * scale * (humanDetailLimit - 1)).length };
  }

  const turned = foldGuard(shaped, member).folds(surface);
  metrics.folds = turned.cage.length;
  metrics.drawnFolds = turned.drawn.length;
  const regionVertices = [];
  for (let v = 0; v < surface.bodyVertices; v++) if (member(v)) regionVertices.push(v);
  const touching = contactPairs(before.positions, before.indices, before.bodyTriangles, regionVertices, 0.0022 * scale);
  if (touching.length) {
    const gap = (s) => touching.map(([a, b]) => Math.hypot(s.positions[a * 3] - s.positions[b * 3],
      s.positions[a * 3 + 1] - s.positions[b * 3 + 1], s.positions[a * 3 + 2] - s.positions[b * 3 + 2]));
    const was = spread(gap(before)), now = spread(gap(surface));
    metrics.contacts = { pairs: touching.length, beforeMeanMm: was.meanMm, afterMeanMm: now.meanMm, beforeMaxMm: was.maxMm, afterMaxMm: now.maxMm };
  }
  let drift = 0;
  for (let v = 0; v < surface.bodyVertices; v++)
    if (!member(v))
      drift = Math.max(drift, Math.hypot(surface.positions[v * 3] - shaped.positions[v * 3],
        surface.positions[v * 3 + 1] - shaped.positions[v * 3 + 1], surface.positions[v * 3 + 2] - shaped.positions[v * 3 + 2]));
  metrics.outsideRegionMaxMm = 1000 * drift;
  let neck = 0, body = 0;
  if (surface.height === before.height)
    for (let v = 0; v < surface.bodyVertices; v++) {
      if (member(v)) continue;
      const d = Math.hypot(surface.positions[v * 3] - before.positions[v * 3], surface.positions[v * 3 + 1] - before.positions[v * 3 + 1],
        surface.positions[v * 3 + 2] - before.positions[v * 3 + 2]);
      neck = Math.max(neck, d);
      if (before.positions[v * 3 + 1] < 0.75 * before.height) body = Math.max(body, d);
    }
  metrics.outsideFromStart = { maxMm: 1000 * neck, belowShouldersMaxMm: 1000 * body };
  if (region === "head" || region === "whole") metrics.eyes = eyeIntegrity(before, surface);
  return {
    form: { human, ...(fit ? { humanFit: fit } : {}) },
    ...(detail ? { detail } : {}),
    metrics,
    rows,
    target: goal,
    surface,
  };
}
