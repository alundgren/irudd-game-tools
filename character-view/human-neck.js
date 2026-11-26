
const depth = {
  collarbone: 0.0036,
  pit: 0.0046,
  hollow: 0.003,
  under: 0.0012,
  trapezius: 0.0072,
  column: 0.012,
  pad: 0.011,
  back: 0.017,
};
export const neckSettings = { strength: 1 };

const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
const ease = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const bell = (x, width) => Math.exp(-(x * x) / (2 * width * width));

function normals(positions, indices, triangles, out) {
  out.fill(0);
  for (const i of triangles) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a],
      uy = positions[b + 1] - positions[a + 1],
      uz = positions[b + 2] - positions[a + 2],
      vx = positions[c] - positions[a],
      vy = positions[c + 1] - positions[a + 1],
      vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      out[v] += nx;
      out[v + 1] += ny;
      out[v + 2] += nz;
    }
  }
  return out;
}
function along(line, x, y, z) {
  let best = { gap: Infinity };
  for (let k = 0; k < line.length - 1; k++) {
    const [ax, ay, az] = line[k],
      [bx, by, bz] = line[k + 1];
    const ex = bx - ax,
      ey = by - ay,
      ez = bz - az;
    const s = clamp(
      ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) /
        (ex * ex + ey * ey + ez * ez),
      0,
      1,
    );
    const dx = x - ax - s * ex,
      dy = y - ay - s * ey,
      dz = z - az - s * ez,
      gap = Math.hypot(dx, dy, dz);
    if (gap < best.gap)
      best = { gap, t: (k + s) / (line.length - 1), dx, dy, dz };
  }
  return best;
}

let cache;
export function neckFields({
  rest,
  names,
  bodyVertices,
  bodyTriangles,
  indices,
  joints,
  bones,
  weights,
}) {
  if (cache?.rest === rest) return cache;
  const joint = (name) => {
    const i = (joints + names.indexOf(name)) * 3;
    return [Math.abs(rest[i]), rest[i + 1], rest[i + 2]];
  };
  let floor = Infinity,
    top = -Infinity;
  for (let v = 0; v < bodyVertices; v++) {
    floor = Math.min(floor, rest[v * 3 + 1]);
    top = Math.max(top, rest[v * 3 + 1]);
  }
  const u = (top - floor) / 1.72,
    neck = joint("neck_01"),
    skull = joint("head"),
    collar = joint("clavicle_l"),
    arm = joint("upperarm_l");
  const each = bones.length / (rest.length / 3 - names.length),
    headBone = names.indexOf("head");
  const headShare = (v) => {
    let sum = 0;
    for (let k = v * each; k < (v + 1) * each; k++)
      if (bones[k] === headBone) sum += weights[k] / 65535;
    return sum;
  };
  const all = [];
  for (let i = 0; i < bodyTriangles * 3; i += 3) all.push(i);
  const restNormals = normals(
    rest,
    indices,
    all,
    new Float32Array(bodyVertices * 3),
  );
  const girdle = [];
  for (let v = 0; v < bodyVertices; v++) {
    const x = Math.abs(rest[v * 3]),
      y = rest[v * 3 + 1];
    if (
      y > collar[1] - 0.21 * u &&
      y < neck[1] + 0.11 * u &&
      x < arm[0] + 0.03 * u
    )
      girdle.push(v);
  }
  let pit = null;
  for (const v of girdle) {
    const [x, y, z] = rest.subarray(v * 3, v * 3 + 3);
    if (Math.abs(x) > 0.004 * u || z < neck[2] + 0.02 * u) continue;
    if (y < collar[1] + 0.01 * u || y > neck[1] + 0.005 * u) continue;
    if (!pit || z < pit[2]) pit = [0, y, z];
  }
  function support(x0, degrees, cap) {
    const forward = Math.cos((degrees * Math.PI) / 180),
      up = Math.sin((degrees * Math.PI) / 180);
    const rows = [];
    let best = -Infinity;
    for (const v of girdle) {
      const x = Math.abs(rest[v * 3]),
        y = rest[v * 3 + 1],
        z = rest[v * 3 + 2];
      if (Math.abs(x - x0) > 0.02 * u || y > cap) continue;
      const score = z * forward + y * up;
      rows.push([x, y, z, score]);
      if (Math.abs(x - x0) < 0.012 * u) best = Math.max(best, score);
    }
    const sum = [0, 0, 0];
    let total = 0;
    for (const [x, y, z, score] of rows) {
      const w =
        bell(x - x0, 0.008 * u) * Math.exp((score - best) / (0.003 * u));
      total += w;
      sum[0] += w * x;
      sum[1] += w * y;
      sum[2] += w * z;
    }
    return sum.map((value) => value / total);
  }
  function front(x0, y0) {
    const sum = [0, 0, 0];
    let total = 0;
    for (const v of girdle) {
      const x = Math.abs(rest[v * 3]),
        y = rest[v * 3 + 1],
        z = rest[v * 3 + 2];
      if (z < arm[2] - 0.012 * u || restNormals[v * 3 + 2] < 0) continue;
      const w = bell(x - x0, 0.009 * u) * bell(y - y0, 0.006 * u);
      total += w;
      sum[0] += w * x;
      sum[1] += w * y;
      sum[2] += w * z;
    }
    return sum.map((value) => value / total);
  }
  const outer = arm[0] - 0.012 * u,
    steps = 8,
    collarbone = [],
    crest = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const x0 = collar[0] * 0.95 + (outer - collar[0] * 0.95) * t;
    let high = -Infinity;
    for (const v of girdle)
      if (
        Math.abs(Math.abs(rest[v * 3]) - x0) < 0.012 * u &&
        rest[v * 3 + 1] < neck[1] + 0.035 * u
      )
        high = Math.max(high, rest[v * 3 + 1]);
    collarbone.push(
      front(x0, Math.min(pit[1] - 0.012 * u + 0.004 * u * t, high - 0.003 * u)),
    );
    const x1 = 0.05 * u + (outer - 0.05 * u) * t;
    crest.push(support(x1, 104, neck[1] + 0.035 * u));
  }
  const ids = [],
    fields = {
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
    const x = Math.abs(rest[v * 3]),
      y = rest[v * 3 + 1],
      z = rest[v * 3 + 2];
    const n = restNormals.subarray(v * 3, v * 3 + 3),
      size = Math.hypot(n[0], n[1], n[2]) || 1;
    const facing = ease(-0.15, 0.35, (0.45 * n[1] + 0.89 * n[2]) / size);
    const c = along(collarbone, x, y, z);
    const above = c.dy * 0.76 - c.dz * 0.62 - c.dx * 0.18 > 0;
    const row = {
      collarbone:
        facing *
        bell(c.gap, 0.0095 * u) *
        ease(1.02, 0.7, c.t) *
        (1 + 0.2 * ease(0.2, 0, c.t)),
      hollow: above
        ? facing *
          bell(c.gap - 0.026 * u, 0.01 * u) *
          ease(0.02, 0.3, c.t) *
          ease(0.85, 0.5, c.t)
        : 0,
      under: above
        ? 0
        : facing *
          bell(c.gap - 0.022 * u, 0.013 * u) *
          ease(0.4, 0.7, c.t) *
          ease(1.05, 0.85, c.t),
      pit:
        z > pit[2] - 0.03 * u
          ? Math.exp(
              -((x / (0.011 * u)) ** 2) -
                ((y - pit[1] - 0.003 * u) / (0.013 * u)) ** 2,
            )
          : 0,
      trapezius: 0,
    };
    const k = along(crest, x, y, z);
    const reach =
      ease(0.04 * u, 0.085 * u, x) * (0.2 + 0.8 * ease(0.175 * u, 0.1 * u, x));
    row.trapezius = reach * bell(k.gap, k.dz < 0 ? 0.04 * u : 0.012 * u);
    const free = clamp(1 - 1.4 * headShare(v), 0, 1),
      rz =
        z -
        (neck[2] +
          ((y - neck[1]) * (skull[2] - neck[2])) / (skull[1] - neck[1]) +
          0.015 * u),
      radius = Math.hypot(x, rz) || 1,
      forward = rz / radius,
      front = Math.max(0, forward);
    row.column =
      free *
      ease(
        pit[1] - (0.008 + 0.05 * front) * u,
        pit[1] + (0.03 + 0.015 * front) * u,
        y,
      ) *
      ease((0.1 + 0.04 * front) * u, 0.062 * u, radius) *
      (0.14 + 0.86 * front ** 1.5 + 0.61 * Math.max(0, -forward) ** 1.5);
    row.pad =
      free *
      ease(-0.7, -0.15, n[1] / size) *
      (0.45 + 0.55 * ease(-0.1, 0.5, n[1] / size)) *
      (k.dz < 0 ? 1 : ease(0.03 * u, 0.055 * u, x)) *
      (1 - 0.75 * ease(0.09 * u, arm[0] - 0.01 * u, x)) *
      bell(k.gap, k.dz < 0 ? 0.06 * u : 0.035 * u);
    row.back =
      free *
      ease(0.35, -0.25, n[2] / size) *
      ease(collar[1] - 0.2 * u, collar[1] - 0.07 * u, y) *
      ease(neck[1] + 0.035 * u, neck[1] - 0.02 * u, y) *
      ease(arm[0] + 0.01 * u, 0.06 * u, x) *
      (0.65 +
        0.35 * bell(y - neck[1] + 0.05 * u, 0.05 * u) * bell(x, 0.07 * u));
    if (Object.values(row).some((w) => w > 0.004)) {
      ids.push(v);
      for (const key in fields) fields[key].push(row[key]);
    }
  }
  const member = new Uint8Array(bodyVertices);
  for (const v of ids) member[v] = 1;
  const triangles = all.filter(
    (i) =>
      member[indices[i]] || member[indices[i + 1]] || member[indices[i + 2]],
  );
  cache = {
    rest,
    ids: Uint16Array.from(ids),
    triangles,
    landmarks: { pit, collarbone, crest },
    weights: Object.fromEntries(
      Object.entries(fields).map(([k, w]) => [k, Float32Array.from(w)]),
    ),
  };
  return cache;
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
} = {}) {
  const heavy = Math.max(weight, 0),
    thin = Math.max(-weight, 0),
    strong = Math.max(muscle, 0);
  const mass = clamp(
    0.6 * weight +
      0.25 * Math.max(waist, 0) +
      0.25 * Math.max(belly, 0) +
      0.1 * Math.max(hips, 0),
    0,
    1.25,
  );
  const lean = clamp(1 - 0.65 * Math.max(heavy, mass) + 0.4 * thin, 0.15, 1.4);
  return {
    collarbone: lean * (1 - 0.2 * strong) * (1 + 0.2 * age),
    pit: lean * (1 + 0.15 * age),
    hollow: lean * (1 + 0.35 * age - 0.15 * strong),
    under: lean,
    trapezius: clamp(
      0.85 + 0.55 * muscle + 0.1 * frame + 0.1 * heavy,
      0.3,
      1.6,
    ),
    column: mass,
    pad: Math.min(0.6 * mass + shoulderLine, 1.2),
    back: Math.min(
      0.85 * mass + (upperBack < 0 ? 0.5 * upperBack : upperBack),
      1.3,
    ),
  };
}

export function shapeNeck(vertices, parameters, height, layout) {
  const amount = neckSettings.strength;
  if (!amount) return;
  const fields = neckFields(layout),
    w = fields.weights,
    build = neckBuild(parameters),
    u = (height / 1.72) * amount;
  fields.scratch ??= new Float32Array(layout.bodyVertices * 3);
  const n = normals(vertices, layout.indices, fields.triangles, fields.scratch);
  for (let i = 0; i < fields.ids.length; i++) {
    const v = fields.ids[i] * 3,
      size = Math.hypot(n[v], n[v + 1], n[v + 2]);
    if (!size) continue;
    const move =
      (u *
        (depth.collarbone * build.collarbone * w.collarbone[i] -
          depth.pit * build.pit * w.pit[i] -
          depth.hollow * build.hollow * w.hollow[i] -
          depth.under * build.under * w.under[i] +
          depth.trapezius * build.trapezius * w.trapezius[i] +
          depth.column * build.column * w.column[i] +
          depth.pad * build.pad * w.pad[i] +
          depth.back * build.back * w.back[i])) /
      size;
    vertices[v] += n[v] * move;
    vertices[v + 1] += n[v + 1] * move;
    vertices[v + 2] += n[v + 2] * move;
  }
}
