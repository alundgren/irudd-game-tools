import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from "three";
import { randomStream } from "./random.js";

export const peltGame = {
  guardShare: 0.6,
  clumpSpans: 7,
  tuftLength: 0.34,
};
export const clumpTriangles = (spans) => 6 * spans + 2;
export const tuftTriangles = 9;

export function peltGuideIds(form, guides) {
  const parts = new Map(form.parts.map((p) => [p.id, p]));
  return new Set(
    guides
      .filter((p) => p.fibres.rooted && parts.get(p.parent)?.surface === "fur")
      .map((p) => p.id),
  );
}

export function peltGameDetail(guides, triangles) {
  if (!guides.length) return { detail: new Map(), tufts: 0 };
  const spans = Math.min(peltGame.clumpSpans, Math.floor((triangles / guides.length - 2) / 6));
  const total = guides.reduce((n, p) => n + p.fibres.count, 0);
  const clumps = Math.min(total, Math.max(
    guides.length,
    Math.floor((triangles * peltGame.guardShare) / clumpTriangles(spans)),
  ));
  const detail = new Map();
  let given = 0;
  guides.forEach((p, i) => {
    const remainingLocks = guides.length - i - 1;
    const available = clumps - given - remainingLocks;
    const share = remainingLocks ? Math.round((clumps * p.fibres.count) / total) : available;
    const count = Math.max(1, Math.min(p.fibres.count, available, share));
    given += count;
    detail.set(p.id, {
      count,
      spans,
      clump: Math.pow(p.fibres.count / count, 0.55),
    });
  });
  const used = [...detail.values()].reduce(
    (n, d) => n + d.count * clumpTriangles(spans),
    0,
  );
  return {
    detail,
    tufts: Math.max(0, Math.floor((triangles - used) / tuftTriangles)),
  };
}

export function undercoatTufts(undercoat, locks, count, seed, coatColour) {
  const out = new Map(locks.map((l) => [l.mesh, { pos: [], col: [], idx: [] }]));
  if (!count || !locks.length) return out;
  const g = undercoat.geometry,
    p = g.attributes.position,
    index = g.index,
    m = undercoat.matrixWorld;
  const up = new Vector3(0, 1, 0);
  const tris = [];
  let area = 0;
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    n = new Vector3();
  for (let i = 0, k = index?.count ?? p.count; i < k; i += 3) {
    const ids = [0, 1, 2].map((j) => (index ? index.getX(i + j) : i + j));
    a.fromBufferAttribute(p, ids[0]).applyMatrix4(m);
    b.fromBufferAttribute(p, ids[1]).applyMatrix4(m);
    c.fromBufferAttribute(p, ids[2]).applyMatrix4(m);
    n.subVectors(c, b).cross(new Vector3().subVectors(a, b));
    const s = n.length() / 2;
    if (s < 1e-12) continue;
    n.normalize();
    if (n.dot(up) < -0.15) continue;
    area += s;
    tris.push({ a: a.clone(), b: b.clone(), c: c.clone(), n: n.clone(), cum: area });
  }
  if (!tris.length) return out;
  const random = randomStream(seed),
    spacing = Math.sqrt(area / count),
    meanLength = locks.reduce((s, l) => s + l.length, 0) / locks.length,
    deep = new Color(coatColour).multiplyScalar(0.5),
    body = new Color(coatColour);
  const point = new Vector3(),
    flow = new Vector3(),
    across = new Vector3();
  for (let t = 0; t < count; t++) {
    const r = random() * area;
    let lo = 0,
      hi = tris.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tris[mid].cum < r) lo = mid + 1;
      else hi = mid;
    }
    const tri = tris[lo];
    let u = random(),
      v = random();
    if (u + v > 1) [u, v] = [1 - u, 1 - v];
    point
      .copy(tri.a)
      .addScaledVector(new Vector3().subVectors(tri.b, tri.a), u)
      .addScaledVector(new Vector3().subVectors(tri.c, tri.a), v);
    flow.set(0, 0, 0);
    let nearest = locks[0],
      best = Infinity;
    for (const l of locks) {
      const d2 = point.distanceToSquared(l.root) + 1e-8;
      flow.addScaledVector(l.flow, 1 / d2);
      if (d2 < best) {
        best = d2;
        nearest = l;
      }
    }
    flow.addScaledVector(tri.n, -flow.dot(tri.n)).normalize();
    if (!Number.isFinite(flow.x)) continue;
    across.crossVectors(flow, tri.n).normalize();
    const length = meanLength * peltGame.tuftLength * (0.65 + 0.7 * random()),
      width = spacing * (0.55 + 0.25 * random()),
      lift = 0.08 + 0.16 * random(),
      bend = (random() - 0.5) * 0.5,
      value = 0.88 + 0.24 * random();
    const dir = flow
      .clone()
      .multiplyScalar(Math.sqrt(1 - lift * lift))
      .addScaledVector(tri.n, lift)
      .addScaledVector(across, bend * 0.3)
      .normalize();
    const root = point.clone().addScaledVector(tri.n, -0.12 * width);
    const mid = point
      .clone()
      .addScaledVector(dir, length * 0.45)
      .addScaledVector(tri.n, length * 0.04);
    const tip = point
      .clone()
      .addScaledVector(dir, length)
      .addScaledVector(tri.n, -length * 0.06);
    const tipColour = body.clone().lerp(nearest.colour, 0.55).multiplyScalar(value * 1.06);
    const rings = [
      [root, width * 0.62, deep.clone().multiplyScalar(value)],
      [mid, width * 0.4, body.clone().lerp(nearest.colour, 0.25).multiplyScalar(value)],
    ];
    const target = out.get(nearest.mesh),
      local = nearest.mesh.matrixWorld.clone().invert(),
      base = target.pos.length / 3;
    for (const [centre, w, colour] of rings)
      for (let s = 0; s < 3; s++) {
        const angle = (s * 2 * Math.PI) / 3;
        const q = centre
          .clone()
          .addScaledVector(across, w * Math.cos(angle))
          .addScaledVector(tri.n, 0.45 * w * Math.sin(angle))
          .applyMatrix4(local);
        target.pos.push(q.x, q.y, q.z);
        target.col.push(colour.r, colour.g, colour.b);
      }
    const q = tip.clone().applyMatrix4(local);
    target.pos.push(q.x, q.y, q.z);
    target.col.push(tipColour.r, tipColour.g, tipColour.b);
    for (let s = 0; s < 3; s++) {
      const s1 = (s + 1) % 3;
      target.idx.push(base + s, base + s1, base + 3 + s, base + s1, base + 3 + s1, base + 3 + s);
      target.idx.push(base + 3 + s, base + 3 + s1, base + 6);
    }
  }
  return out;
}

export function appendTufts(geometry, owners, tufts) {
  if (!tufts?.idx.length) return { geometry, owners };
  const pos = [...geometry.attributes.position.array, ...tufts.pos],
    col = [...geometry.attributes.color.array, ...tufts.col],
    uv = [...geometry.attributes.uv.array, ...new Array((tufts.pos.length / 3) * 2).fill(0)],
    first = geometry.attributes.position.count,
    idx = [...geometry.index.array, ...tufts.idx.map((i) => i + first)];
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  geometry.dispose();
  if (!owners) return { geometry: g, owners };
  const extra = tufts.pos.length / 3,
    grow = (a, Type) => {
      const r = new Type(a.length + extra);
      r.set(a);
      r.fill(a[0], a.length);
      return r;
    };
  return {
    geometry: g,
    owners: {
      ids: owners.ids,
      first: grow(owners.first, Uint8Array),
      second: grow(owners.second, Uint8Array),
      weight: grow(owners.weight, Float32Array),
    },
  };
}
