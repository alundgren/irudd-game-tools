// The inside of the mouth (character-view/human-mouth.js at 2761eb1). The
// lining of the head skin becomes a shallow pocket that hangs from the lips
// and moves with them, and two short rows of teeth stand inside it. Closed
// lips hide both rows; an expression that parts the lips slides the rows into
// the opening, the upper row showing most.

import * as T from "three";

/** The lining's island in the 2048 px skin layout (human-complexion-data.json `mouth.island`). */
const layout = 2048;
const [boxLeft, boxTop, boxRight, boxBottom] = [1549, 1847, 1894, 2026] as const;

const smooth = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const found = new WeakMap<T.BufferGeometry, Uint8Array>();

/** Which vertices of the head skin line the mouth: its own island of the skin layout. */
export function mouthLining(geometry: T.BufferGeometry): Uint8Array {
  const hit = found.get(geometry);
  if (hit) return hit;
  const uv = geometry.getAttribute("uv"),
    index = geometry.getIndex()?.array ?? [],
    count = uv.count;
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (start: number) => {
    let i = start;
    while (parent[i] !== i) {
      const up = parent[parent[i] ?? i] ?? i;
      parent[i] = up;
      i = up;
    }
    return i;
  };
  for (let t = 0; t < index.length; t += 3) {
    const a = find(index[t] ?? 0);
    parent[find(index[t + 1] ?? 0)] = a;
    parent[find(index[t + 2] ?? 0)] = a;
  }
  const size = new Map<number, number>(),
    within = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const root = find(i),
      x = uv.getX(i) * layout,
      y = (1 - uv.getY(i)) * layout;
    size.set(root, (size.get(root) ?? 0) + 1);
    if (x > boxLeft && x < boxRight && y > boxTop && y < boxBottom)
      within.set(root, (within.get(root) ?? 0) + 1);
  }
  const flags = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const root = find(i);
    if ((within.get(root) ?? 0) > 0.5 * (size.get(root) ?? 0)) flags[i] = 1;
  }
  found.set(geometry, flags);
  return flags;
}

// Crown widths and heights in millimetres from the middle outward.
const upperTeeth = [
  [8.6, 10],
  [6.8, 8.8],
  [7.6, 9.8],
  [7, 7.8],
  [6.8, 7.2],
] as const;
const lowerTeeth = [
  [5.4, 7],
  [6, 7],
  [6.8, 7.4],
  [7, 6.4],
  [7, 6],
] as const;

type Pair = [number, number];

/** Reshape the skin's lining into a pocket and return the teeth, or null without a lining. */
export function mouthInterior(
  skin: T.Mesh,
  height: number,
  material: (color: string) => T.Material,
  plain: boolean,
): T.Mesh | null {
  const g = skin.geometry,
    p = g.getAttribute("position"),
    index = g.getIndex()?.array ?? [],
    moves = g.morphAttributes["position"] ?? [];
  const lining = mouthLining(g),
    mm = height / 1.72 / 1000;
  const key = (i: number) =>
    Math.round(p.getX(i) * 2e5) +
    "/" +
    Math.round(p.getY(i) * 2e5) +
    "/" +
    Math.round(p.getZ(i) * 2e5);
  const lips = new Set<string>(),
    seam: number[] = [],
    inner: number[] = [];
  let any = false;
  for (let i = 0; i < p.count; i++)
    if (lining[i]) any = true;
    else lips.add(key(i));
  if (!any) return null;
  for (let i = 0; i < p.count; i++) if (lining[i]) (lips.has(key(i)) ? seam : inner).push(i);
  if (seam.length < 12) return null;
  let corner = 0,
    widest = 0,
    tallest = 0;
  for (const i of seam) corner = Math.max(corner, Math.abs(p.getX(i)));
  const bins = Math.max(4, Math.round(corner / (3 * mm))),
    sum = Array.from({ length: bins + 1 }, () => [0, 0, 0]);
  for (const i of seam) {
    const at = (Math.abs(p.getX(i)) / corner) * bins,
      k = Math.min(bins - 1, Math.floor(at)),
      f = at - k;
    for (const [slot, weight] of [
      [k, 1 - f],
      [k + 1, f],
    ] as const) {
      const row = sum[slot];
      if (!row) continue;
      row[0] = (row[0] ?? 0) + weight;
      row[1] = (row[1] ?? 0) + weight * p.getY(i);
      row[2] = (row[2] ?? 0) + weight * p.getZ(i);
    }
  }
  const raw: (Pair | null)[] = sum.map(([weight = 0, y = 0, z = 0]) =>
    weight > 1e-6 ? [y / weight, z / weight] : null,
  );
  for (let k = 0; k <= bins; k++)
    raw[k] ??=
      raw
        .slice(0, k)
        .reverse()
        .find((v): v is Pair => Boolean(v)) ??
      raw.find((v): v is Pair => Boolean(v)) ??
      null;
  const knots: Pair[] = raw.map((v) => v ?? [0, 0]);
  const knot = (k: number, axis: 0 | 1) => knots[k]?.[axis] ?? 0;
  const line = (across: number, axis: 0 | 1) => {
    const at = Math.min(1, Math.abs(across) / corner) * bins,
      k = Math.min(bins - 1, Math.floor(at));
    return mix(knot(k, axis), knot(k + 1, axis), at - k);
  };
  const depthOf = (i: number) => Math.max(0, line(p.getX(i), 1) - p.getZ(i)),
    heightOf = (i: number) => p.getY(i) - line(p.getX(i), 0);
  for (const i of inner) {
    widest = Math.max(widest, Math.abs(p.getX(i)));
    tallest = Math.max(tallest, Math.abs(heightOf(i)));
  }
  const narrow = Math.min(1, (corner - 1.5 * mm) / Math.max(widest, 1e-6)),
    flat = Math.min(1, (8 * mm) / Math.max(tallest, 1e-6));
  const settle = 5 * mm,
    deep = new Float32Array(p.count),
    high = new Float32Array(p.count),
    across = new Float32Array(p.count);
  for (const i of seam) {
    high[i] = heightOf(i);
    across[i] = p.getX(i);
  }
  for (const i of inner) {
    const d = depthOf(i),
      e = heightOf(i),
      t = smooth(d, 0, 7 * mm);
    const x = p.getX(i) * mix(1, narrow, t),
      out = Math.min(1, Math.abs(x) / corner);
    deep[i] = settle * (1 - Math.exp(-d / settle)) + 0.09 * d;
    high[i] = e * mix(1, flat * (1 - 0.55 * out * out), t);
    across[i] = x;
    p.setXYZ(i, x, line(x, 0) + (high[i] ?? 0), line(x, 1) - (deep[i] ?? 0));
  }
  // The pocket rides with the lips: its roof with the upper lip, its floor with the lower.
  for (const move of moves) {
    const from = seam.map((i) => [move.getX(i), move.getY(i), move.getZ(i)] as const);
    for (const i of inner) {
      let total = 0,
        x = 0,
        y = 0,
        z = 0;
      seam.forEach((j, n) => {
        const dx = ((across[i] ?? 0) - (across[j] ?? 0)) / mm,
          dy = (2.5 * ((high[i] ?? 0) - (high[j] ?? 0))) / mm,
          weight = 1 / (0.05 + (dx * dx + dy * dy) ** 2);
        const f = from[n];
        total += weight;
        x += weight * (f?.[0] ?? 0);
        y += weight * (f?.[1] ?? 0);
        z += weight * (f?.[2] ?? 0);
      });
      move.setXYZ(i, x / total, y / total, z / total);
    }
    move.needsUpdate = true;
  }
  // Light the pocket by its own shape; it turns away into the head as it deepens.
  const normal = g.getAttribute("normal"),
    added = new Float32Array(p.count * 3);
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3();
  for (let t = 0; t < index.length; t += 3) {
    const ids = [index[t] ?? 0, index[t + 1] ?? 0, index[t + 2] ?? 0] as const;
    if (!ids.every((i) => lining[i])) continue;
    a.fromBufferAttribute(p, ids[0]);
    b.fromBufferAttribute(p, ids[1]).sub(a);
    c.fromBufferAttribute(p, ids[2]).sub(a);
    b.cross(c);
    for (const i of ids) {
      added[i * 3] = (added[i * 3] ?? 0) + b.x;
      added[i * 3 + 1] = (added[i * 3 + 1] ?? 0) + b.y;
      added[i * 3 + 2] = (added[i * 3 + 2] ?? 0) + b.z;
    }
  }
  const colour = g.getAttribute("color");
  for (let i = 0; i < p.count; i++) {
    if (!lining[i]) continue;
    const ax = added[i * 3] ?? 0,
      ay = added[i * 3 + 1] ?? 0,
      az = added[i * 3 + 2] ?? 0;
    const length = Math.hypot(ax, ay, az);
    if (length > 1e-14) {
      const hide = smooth(deep[i] ?? 0, 0.6 * mm, 3.5 * mm),
        x = (ax / length) * (1 - hide),
        y = (ay / length) * (1 - hide),
        z = (az / length) * (1 - hide) - hide,
        size = Math.hypot(x, y, z) || 1;
      normal.setXYZ(i, x / size, y / size, z / size);
    }
    if (colour) {
      const dim = mix(1, 0.4, smooth(deep[i] ?? 0, 1 * mm, 8 * mm));
      colour.setXYZ(i, colour.getX(i) * dim, colour.getY(i) * dim, colour.getZ(i) * dim);
    }
  }
  p.needsUpdate = normal.needsUpdate = true;
  if (colour) colour.needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();

  // The teeth stand on an arch that clears the lips at rest and in every expression.
  const scale = (corner / (24.5 * mm)) * mm,
    points: Pair[] = [];
  for (const i of seam) {
    points.push([Math.abs(p.getX(i)), p.getZ(i)]);
    for (const move of moves)
      points.push([Math.abs(p.getX(i) + move.getX(i)), p.getZ(i) + move.getZ(i)]);
  }
  let front = Infinity,
    bend = 14;
  for (const [x, z] of points) if (x < 0.25 * corner) front = Math.min(front, z - 2.6 * scale);
  for (const [x, z] of points)
    if (x > 0.3 * corner) bend = Math.max(bend, (front - (z - 2.6 * scale)) / (x * x));
  const arch = (x: number) => front - bend * x * x;
  const middle = seam.filter((i) => Math.abs(p.getX(i)) < 0.2 * corner),
    mean = (ids: ReadonlyArray<number>, of: (i: number) => number) =>
      ids.reduce((total, i) => total + of(i), 0) / Math.max(1, ids.length);
  const above = middle.filter((i) => (high[i] ?? 0) > 0),
    below = middle.filter((i) => (high[i] ?? 0) <= 0);
  const upperLip = mean(above, (i) => p.getY(i)),
    lowerLip = mean(below, (i) => p.getY(i));
  const edges = [upperLip + 1.8 * scale, lowerLip - 1.8 * scale] as const;
  const lipLine = [above, below].map((_, which) => {
    const total = Array.from({ length: bins + 1 }, () => [0, 0]);
    for (const i of seam) {
      if ((high[i] ?? 0) > 0 !== (which === 0)) continue;
      const at = (Math.abs(p.getX(i)) / corner) * bins,
        k = Math.min(bins - 1, Math.floor(at)),
        f = at - k;
      const lo = total[k],
        hi = total[k + 1];
      if (!lo || !hi) continue;
      lo[0] = (lo[0] ?? 0) + (1 - f);
      lo[1] = (lo[1] ?? 0) + (1 - f) * p.getY(i);
      hi[0] = (hi[0] ?? 0) + f;
      hi[1] = (hi[1] ?? 0) + f * p.getY(i);
    }
    const centre = which ? lowerLip : upperLip,
      offsets = total.map(([weight = 0, y = 0], k) =>
        weight > 0.5 ? y / weight - centre : line((k / bins) * corner, 0) - line(0, 0),
      );
    return (along: number) => {
      const at = Math.min(1, Math.abs(along) / corner) * bins,
        k = Math.min(bins - 1, Math.floor(at));
      return mix(offsets[k] ?? 0, offsets[k + 1] ?? 0, at - k);
    };
  });
  const slides = moves.map((move) => {
    const top = mean(above, (i) => p.getY(i) + move.getY(i)),
      bottom = mean(below, (i) => p.getY(i) + move.getY(i));
    const opening = top - bottom,
      parted = smooth(opening - (upperLip - lowerLip), 0.5 * mm, 3 * mm);
    return [
      parted * (top - 0.5 * opening - edges[0]),
      parted * Math.min(0, top - 0.62 * opening - edges[1]),
    ] as const;
  });
  const position: number[] = [],
    colours: number[] = [],
    triangles: number[] = [],
    row: number[] = [];
  const rows = (
    teeth: ReadonlyArray<readonly [number, number]>,
    up: number,
    back: number,
    lean: number,
    enamel: readonly [number, number, number],
  ) => {
    const followLip = lipLine[up > 0 ? 0 : 1] ?? (() => 0);
    const edge0 = edges[up > 0 ? 0 : 1];
    for (const side of [1, -1]) {
      const stations: { x: number; u: number; height: number; tooth: number }[] = [];
      let x = 0;
      teeth.forEach(([width, height], tooth) => {
        for (const u of tooth ? [0.25, 0.75, 1] : [0, 0.25, 0.75, 1])
          stations.push({
            x: x + (u * width * scale) / Math.hypot(1, 2 * bend * (x + 0.5 * width * scale)),
            u,
            height: height * scale,
            tooth,
          });
        x = stations.at(-1)?.x ?? x;
      });
      const reach = x,
        start = position.length / 3,
        levels = 7;
      for (const { x: along, u, height, tooth } of stations) {
        const edge = u === 0 || u === 1,
          slope = 2 * bend * along,
          unit = Math.hypot(1, slope);
        const round =
          (edge ? (tooth === 2 ? 0.7 : 0.3) : 0) * scale + (tooth === 1 ? 0.4 * scale : 0);
        const neck = height - (edge ? 1.9 * scale : 0),
          bulge = edge ? -0.9 * scale : 0;
        const shade = 1 - 0.7 * (along / reach) ** 1.3;
        const level = [
          [neck + 2.2 * scale, bulge - 0.5 * scale, "gum", 0.7],
          [neck, bulge + 0.45 * scale, "gum", 1],
          [neck, bulge + 0.45 * scale, "enamel", 0.9],
          [0.6 * height, bulge + 0.2 * scale, "enamel", 1],
          [0.15 * height + round, bulge, "enamel", 1],
          [round, bulge - 0.5 * scale, "enamel", 0.92],
          [round + 0.2 * scale, bulge - 2 * scale, "enamel", 0.5],
        ] as const;
        for (const [rise, out, kind, light] of level) {
          const push = out - back * scale - lean * rise;
          position.push(
            side * (along + (push * slope) / unit),
            edge0 + followLip(along) + up * rise,
            arch(along) + push / unit,
          );
          row.push(up > 0 ? 0 : 1);
          const tone = kind === "gum" ? ([0.5, 0.26, 0.27] as const) : enamel;
          const gap =
              edge && kind === "enamel"
                ? rise > 0.5 * height
                  ? 0.42
                  : rise > 0.2 * height
                    ? 0.6
                    : 0.8
                : 1,
            tip = kind === "enamel" && rise < 0.2 * height ? 0.93 : 1;
          colours.push(
            ...tone.map((value, k) => value * light * shade * gap * (k === 2 ? tip : 1)),
          );
        }
      }
      const flip = side * up < 0;
      for (let s = 0; s + 1 < stations.length; s++)
        for (let r = 0; r + 1 < levels; r++) {
          if (r === 1) continue;
          const q = start + s * levels + r,
            n = q + levels;
          if (flip) triangles.push(q, n, q + 1, q + 1, n, n + 1);
          else triangles.push(q, q + 1, n, q + 1, n + 1, n);
        }
    }
  };
  rows(upperTeeth, 1, 0, 0.12, [0.8, 0.74, 0.62]);
  rows(lowerTeeth, -1, 1.5, 0.3, [0.7, 0.65, 0.55]);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute(
    "uv",
    new T.BufferAttribute(new Float32Array((position.length / 3) * 2).fill(0.5), 2),
  );
  if (!plain) geometry.setAttribute("color", new T.Float32BufferAttribute(colours, 3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  if (moves.length) {
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes["position"] = moves.map((move, e) => {
      const values = new Float32Array(position.length);
      row.forEach((which, i) => {
        values[i * 3 + 1] = slides[e]?.[which === 0 ? 0 : 1] ?? 0;
      });
      const attr = new T.BufferAttribute(values, 3);
      attr.name = move.name;
      return attr;
    });
  }
  const m = material("#ffffff").clone();
  if (!plain && m instanceof T.MeshStandardMaterial) {
    m.vertexColors = true;
    m.roughness = 0.5;
  }
  // Every triangle of the teeth is kept in a game export: there are few and each one shows.
  m.userData = { ...m.userData, fibreLOD: true };
  const mesh = new T.Mesh(geometry, m);
  mesh.name = "teeth";
  mesh.receiveShadow = true;
  mesh.updateMorphTargets();
  return mesh;
}
