import { BufferAttribute, BufferGeometry, Triangle, Vector3 } from "three";

// World-space triangles of every visible mesh, with skinning and morph targets applied.
export function bakeScene(root) {
  root.updateMatrixWorld(true);
  const positions = [],
    indices = [],
    v = new Vector3();
  let meshes = 0;
  root.traverseVisible((o) => {
    const p = o.isMesh && o.geometry?.attributes?.position;
    if (!p) return;
    const base = positions.length / 3,
      index = o.geometry.index,
      n = index ? index.count : p.count,
      flip = o.matrixWorld.determinant() < 0;
    for (let i = 0; i < p.count; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
      positions.push(v.x, v.y, v.z);
    }
    for (let i = 0; i + 2 < n; i += 3)
      for (const k of flip ? [0, 2, 1] : [0, 1, 2])
        indices.push(base + (index ? index.getX(i + k) : i + k));
    meshes++;
  });
  if (!indices.length) throw new Error("This file has no triangle surface.");
  if (positions.some((x) => !Number.isFinite(x)))
    throw new Error("This file contains positions that are not numbers.");
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    meshes,
  };
}

function box(positions, keep) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (let i = 0; i < positions.length; i += 3) {
    if (keep && !keep(positions[i], positions[i + 1], positions[i + 2]))
      continue;
    count++;
    for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d], positions[i + d]);
      max[d] = Math.max(max[d], positions[i + d]);
    }
  }
  return {
    count,
    min,
    max,
    size: max.map((x, d) => x - min[d]),
    centre: max.map((x, d) => (x + min[d]) / 2),
  };
}
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : 0;
};

// Slab centres up a standing body. Medians of these resist arms, bellies and hair.
const slabs = [0.06, 0.28, 0.53, 0.72, 0.93];
export function bodyColumn(positions) {
  const all = box(positions),
    h = all.size[1];
  return slabs.map((f) => {
    const b = box(
      positions,
      (x, y) => Math.abs(y - all.min[1] - f * h) < 0.02 * h,
    );
    return b.count ? [b.centre[0], b.centre[2]] : null;
  });
}

// Pose readings of an aligned body: floor at its lowest point, facing +Z, metres.
export function poseReadings(positions) {
  const all = box(positions),
    h = all.size[1],
    floor = all.min[1],
    x0 = median(
      bodyColumn(positions)
        .filter(Boolean)
        .map((c) => c[0]),
    );
  const arms = [-1, 1].map((side) => {
    let n = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      syy = 0,
      sxy = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const x = (positions[i] - x0) * side,
        y = positions[i + 1] - floor;
      if (x < 0.14 * h || y < 0.33 * h) continue;
      n++;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
    if (n < 30) return null;
    const mx = sx / n,
      my = sy / n,
      angle =
        (0.5 *
          Math.atan2(2 * (sxy / n - mx * my), sxx / n - mx * mx - (syy / n - my * my)) *
          180) /
        Math.PI;
    // A near-vertical line below the shoulders is a hanging arm.
    return Math.abs(angle) > 70 && my < 0.72 * h ? Math.abs(angle) : -angle;
  });
  const feet = [-1, 1].map((side) =>
    box(
      positions,
      (x, y) => (x - x0) * side > 0 && y - floor < 0.05 * h,
    ),
  );
  return {
    stature: h,
    armsBelowHorizontal: arms.every((a) => a !== null)
      ? (arms[0] + arms[1]) / 2
      : null,
    armDifference: arms.every((a) => a !== null)
      ? Math.abs(arms[0] - arms[1])
      : null,
    footSpacing:
      feet[0].count && feet[1].count
        ? feet[1].centre[0] - feet[0].centre[0]
        : null,
  };
}

export const unitChoices = {
  m: ["metres", 1],
  cm: ["centimetres", 0.01],
  mm: ["millimetres", 0.001],
  in: ["inches", 0.0254],
  ft: ["feet", 0.3048],
};
const adult = [1.2, 2.3];
function facesBack(positions) {
  const all = box(positions),
    h = all.size[1],
    y0 = all.min[1];
  const foot = box(positions, (x, y) => y - y0 < 0.035 * h),
    ankle = box(positions, (x, y) => y - y0 > 0.07 * h && y - y0 < 0.12 * h);
  return ankle.count > 0 && foot.centre[2] < ankle.centre[2];
}

/* Stands an imported body in the workshop's space: metres, Y up, facing +Z,
   feet on the floor and its column over `column` (see bodyColumn). */
export function alignReference(raw, options = {}, template = {}) {
  const { up = "auto", units = "auto", turn = "auto", nudge = [0, 0, 0] } = options;
  const positions = raw.positions.slice(),
    notes = [];
  const source = box(positions);
  const zUp = up === "z" || (up === "auto" && source.size[2] > source.size[1] * 1.2);
  if (zUp)
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      positions[i + 1] = positions[i + 2];
      positions[i + 2] = -y;
    }
  const tall = box(positions).size[1];
  let unit = units,
    factor;
  if (units === "auto") {
    unit = Object.keys(unitChoices).find((key) => {
      const metres = tall * unitChoices[key][1];
      return metres >= adult[0] && metres <= adult[1];
    });
    if (!unit) {
      unit = "stature";
      notes.push(
        "No common unit makes this an adult height, so it was scaled to the template stature. Choose the source units if you know them.",
      );
    }
  }
  if (unit === "stature") factor = (template.stature ?? 1.72) / tall;
  else factor = unitChoices[unit][1];
  for (let i = 0; i < positions.length; i++) positions[i] *= factor;
  let degrees = Number(turn),
    turnReason = "chosen";
  if (turn === "auto") {
    const size = box(positions).size;
    degrees = size[2] > size[0] ? 90 : 0;
    turnReason = "width";
  }
  const spin = (angle) => {
    const c = Math.round(Math.cos((angle * Math.PI) / 180)),
      s = Math.round(Math.sin((angle * Math.PI) / 180));
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i],
        z = positions[i + 2];
      positions[i] = x * c + z * s;
      positions[i + 2] = -x * s + z * c;
    }
  };
  if (degrees) spin(degrees);
  if (turn === "auto" && facesBack(positions)) {
    spin(180);
    degrees = (degrees + 180) % 360;
    turnReason = "feet";
  }
  if (turn !== "auto") {
    const size = box(positions).size;
    if (size[2] > size[0])
      notes.push(
        "The reference is deeper than it is wide, so it is probably standing sideways. Let the turn be detected.",
      );
    else if (facesBack(positions))
      notes.push(
        "The feet point backwards, so the reference is probably facing away. Let the turn be detected.",
      );
  }
  const stood = box(positions),
    here = bodyColumn(positions),
    there = template.column ?? [];
  const pairs = here
    .map((c, i) => c && there[i] && [there[i][0] - c[0], there[i][1] - c[1]])
    .filter(Boolean);
  const shift = [
    (pairs.length ? median(pairs.map((p) => p[0])) : -stood.centre[0]) + nudge[0],
    -stood.min[1] + nudge[1],
    (pairs.length ? median(pairs.map((p) => p[1])) : -stood.centre[2]) + nudge[2],
  ];
  for (let i = 0; i < positions.length; i += 3)
    for (let d = 0; d < 3; d++) positions[i + d] += shift[d];
  if (stood.size[1] < adult[0] || stood.size[1] > adult[1])
    notes.push(
      "At " + stood.size[1].toFixed(2) + " m this is outside adult stature. Check the source units.",
    );
  return {
    positions,
    report: {
      sourceSize: source.size,
      sourceHeight: tall,
      up: zUp ? "Z" : "Y",
      upAuto: up === "auto",
      unit,
      unitAuto: units === "auto",
      factor,
      turn: degrees,
      turnReason,
      stature: stood.size[1],
      notes,
    },
  };
}

export function referenceGeometry(positions, indices) {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(indices, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// Signed distance to a triangle surface. Positive is outside its front faces.
export function surfaceIndex(positions, indices) {
  const n = indices.length / 3,
    order = Uint32Array.from({ length: n }, (_, i) => i),
    centres = [0, 1, 2].map(() => new Float32Array(n));
  for (let f = 0; f < n; f++)
    for (let d = 0; d < 3; d++)
      centres[d][f] =
        (positions[indices[f * 3] * 3 + d] +
          positions[indices[f * 3 + 1] * 3 + d] +
          positions[indices[f * 3 + 2] * 3 + d]) /
        3;
  const capacity = n + 2,
    bounds = new Float32Array(capacity * 6),
    start = new Uint32Array(capacity),
    count = new Uint32Array(capacity),
    right = new Uint32Array(capacity);
  let used = 0;
  function select(key, lo, hi, k) {
    hi--;
    while (lo < hi) {
      const pivot = key[order[(lo + hi) >> 1]];
      let i = lo,
        j = hi;
      while (i <= j) {
        while (key[order[i]] < pivot) i++;
        while (key[order[j]] > pivot) j--;
        if (i <= j) {
          const t = order[i];
          order[i] = order[j];
          order[j] = t;
          i++;
          j--;
        }
      }
      if (k <= j) hi = j;
      else if (k >= i) lo = i;
      else return;
    }
  }
  function build(lo, hi) {
    const node = used++,
      b = node * 6;
    bounds.fill(Infinity, b, b + 3);
    bounds.fill(-Infinity, b + 3, b + 6);
    for (let i = lo; i < hi; i++)
      for (let k = 0; k < 3; k++) {
        const v = indices[order[i] * 3 + k] * 3;
        for (let d = 0; d < 3; d++) {
          bounds[b + d] = Math.min(bounds[b + d], positions[v + d]);
          bounds[b + 3 + d] = Math.max(bounds[b + 3 + d], positions[v + d]);
        }
      }
    if (hi - lo <= 8) {
      start[node] = lo;
      count[node] = hi - lo;
      return node;
    }
    let axis = 0;
    for (let d = 1; d < 3; d++)
      if (bounds[b + 3 + d] - bounds[b + d] > bounds[b + 3 + axis] - bounds[b + axis])
        axis = d;
    const mid = (lo + hi) >> 1;
    select(centres[axis], lo, hi, mid);
    build(lo, mid);
    right[node] = build(mid, hi);
    return node;
  }
  build(0, n);
  const tri = new Triangle(),
    best = new Triangle(),
    hit = new Vector3(),
    near = new Vector3(),
    normal = new Vector3(),
    stack = new Uint32Array(128);
  const gap = (node, p) => {
    const b = node * 6;
    let sum = 0;
    for (let d = 0; d < 3; d++) {
      const x = p.getComponent(d),
        e = Math.max(bounds[b + d] - x, 0, x - bounds[b + 3 + d]);
      sum += e * e;
    }
    return sum;
  };
  return function distance(p) {
    let closest = Infinity,
      top = 0;
    stack[top++] = 0;
    while (top) {
      const node = stack[--top];
      if (gap(node, p) >= closest) continue;
      if (count[node]) {
        for (let i = start[node]; i < start[node] + count[node]; i++) {
          const f = order[i] * 3;
          tri.a.fromArray(positions, indices[f] * 3);
          tri.b.fromArray(positions, indices[f + 1] * 3);
          tri.c.fromArray(positions, indices[f + 2] * 3);
          const d = tri.closestPointToPoint(p, hit).distanceToSquared(p);
          if (d < closest) {
            closest = d;
            near.copy(hit);
            best.copy(tri);
          }
        }
      } else {
        const a = node + 1,
          b = right[node];
        // Visit the nearer child first so the farther is usually pruned.
        if (gap(a, p) < gap(b, p)) {
          stack[top++] = b;
          stack[top++] = a;
        } else {
          stack[top++] = a;
          stack[top++] = b;
        }
      }
    }
    const d = Math.sqrt(closest);
    return best.getNormal(normal).dot(hit.copy(p).sub(near)) < 0 ? -d : d;
  };
}

export function summarise(distances) {
  if (!distances.length) return null;
  const size = Float32Array.from(distances, Math.abs).sort();
  let sum = 0,
    signed = 0;
  for (let i = 0; i < size.length; i++) {
    sum += size[i];
    signed += distances[i];
  }
  return {
    meanMm: (1000 * sum) / size.length,
    p95Mm: 1000 * size[Math.min(size.length - 1, Math.floor(0.95 * size.length))],
    biasMm: (1000 * signed) / size.length,
    samples: size.length,
  };
}
