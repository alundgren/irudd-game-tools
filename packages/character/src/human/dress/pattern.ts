import { at, clamp, cross, dot, hash1, hull2, length, mix, sub, unit } from "./kit.js";
import type { DressBody, Landmarks, Vec } from "./kit.js";

export type P2 = readonly [number, number];

export interface PanelEdge {
  readonly id: string;
  readonly curve: ReadonlyArray<P2>;
  readonly free: boolean;
}

export interface PanelDraft {
  readonly name: string;
  readonly edges: ReadonlyArray<PanelEdge>;
  readonly chart: P2;
}

export interface SeamDraft {
  readonly a: readonly [string, string];
  readonly b: readonly [string, string];
}

export interface ShirtDraft {
  readonly panels: ReadonlyArray<PanelDraft>;
  readonly seams: ReadonlyArray<SeamDraft>;
  readonly hemY: number;
  readonly underarmY: number;
  readonly snpY: number;
  readonly sleeveEnd: number;
  readonly capBase: number;
  readonly chest: number;
}

export interface ShirtSpec {
  readonly length: number;
  readonly room: number;
  readonly sleeve: number;
  readonly neck: string;
  readonly depth: number;
}

const ARM = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;

function perimeter(points: ReadonlyArray<P2>): number {
  const h = hull2(points);
  let total = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i],
      b = h[(i + 1) % h.length];
    if (a && b) total += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  return total;
}

export function polylineLength(points: ReadonlyArray<P2>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (a && b) total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

export function resample(points: ReadonlyArray<P2>, segments: number): P2[] {
  const total = polylineLength(points),
    out: P2[] = [];
  let walked = 0,
    i = 1;
  for (let s = 0; s <= segments; s++) {
    const target = (total * s) / segments;
    while (i < points.length - 1) {
      const a = points[i - 1],
        b = points[i];
      const step = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
      if (walked + step >= target) break;
      walked += step;
      i++;
    }
    const a = points[i - 1] ?? [0, 0],
      b = points[i] ?? a,
      step = Math.hypot(b[0] - a[0], b[1] - a[1]),
      t = step > 0 ? clamp((target - walked) / step) : 0;
    out.push([mix(a[0], b[0], t), mix(a[1], b[1], t)]);
  }
  return out;
}

function bezier(p0: P2, p1: P2, p2: P2, p3: P2, n = 48): P2[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n,
      s = 1 - t;
    return [
      s * s * s * p0[0] + 3 * s * s * t * p1[0] + 3 * s * t * t * p2[0] + t * t * t * p3[0],
      s * s * s * p0[1] + 3 * s * s * t * p1[1] + 3 * s * t * t * p2[1] + t * t * t * p3[1],
    ];
  });
}

const line = (a: P2, b: P2): P2[] => [a, b];
const flipX = (points: ReadonlyArray<P2>): P2[] => points.map(([x, y]) => [-x, y]);
const backwards = (points: ReadonlyArray<P2>): P2[] => points.slice().reverse();

interface Measure {
  readonly girth: (y: number) => number;
  readonly halfX: (y: number) => number;
  readonly armIn: (y: number) => number;
}

function measure(body: DressBody): Measure {
  const arm = body.weight(ARM),
    head = body.weight(/^(head|neck)/),
    band = 0.014 * body.scale;
  const slice = (y: number) => {
    const pts: P2[] = [];
    let half = 0,
      inner = Infinity;
    for (let v = 0; v < body.count; v++) {
      const py = at(body.P, v * 3 + 1);
      if (Math.abs(py - y) > band) continue;
      const x = at(body.P, v * 3),
        z = at(body.P, v * 3 + 2);
      if (at(arm, v) > 0.5) {
        inner = Math.min(inner, Math.abs(x));
        continue;
      }
      if (at(arm, v) > 0.2 || at(head, v) > 0.5) continue;
      pts.push([x, z]);
      half = Math.max(half, Math.abs(x));
    }
    return { girth: pts.length > 2 ? perimeter(pts) : 0, half, inner };
  };
  return {
    girth: (y) => slice(y).girth,
    halfX: (y) => slice(y).half,
    armIn: (y) => slice(y).inner,
  };
}

function armGirth(body: DressBody, side: string, from: Vec, to: Vec, along: number): number {
  const w = body.weight(new RegExp("^(upperarm|lowerarm|hand)_" + side + "$")),
    axis = unit(sub(to, from)),
    span = length(sub(to, from)),
    a = unit(cross(axis, [0, 0, 1])),
    b = cross(axis, a),
    pts: P2[] = [];
  for (let v = 0; v < body.count; v++) {
    if (at(w, v) < 0.5) continue;
    const d = sub(body.point(v), from),
      t = dot(d, axis);
    if (t < 0 || t > span || Math.abs(t - along) > 0.012 * body.scale) continue;
    pts.push([dot(d, a), dot(d, b)]);
  }
  return pts.length > 2 ? perimeter(pts) : 0.28 * body.scale;
}

export function draftShirt(body: DressBody, m: Landmarks, spec: ShirtSpec): ShirtDraft {
  const k = m.k,
    meas = measure(body),
    arm = body.weight(ARM),
    head = body.weight(/^(head|neck)/);
  let armpit = m.shoulder - 0.12 * k;
  const open = (y: number) => meas.armIn(y) - meas.halfX(y) >= 0.015 * k;
  for (let y = m.shoulder - 0.04 * k; y > m.chest[1]; y -= 0.005 * k)
    if (open(y) && open(y - 0.015 * k) && open(y - 0.03 * k)) {
      armpit = y;
      break;
    }
  const underarmY = armpit - 0.03 * k,
    hemY = mix(m.waist, m.crotch + 0.02 * k, spec.length);
  let chest = 0;
  for (let y = m.chest[1]; y <= armpit; y += 0.01 * k) chest = Math.max(chest, meas.girth(y));
  let hip = 0;
  for (let y = hemY; y <= m.waist; y += 0.01 * k) hip = Math.max(hip, meas.girth(y));
  let neckHalf = 0.05 * k;
  let shoulderHalf = 0;
  for (let v = 0; v < body.count; v++) {
    const [x, y] = body.point(v);
    if (at(head, v) > 0.5 && Math.abs(y - (m.neck[1] - 0.02 * k)) < 0.01 * k)
      neckHalf = Math.max(neckHalf, Math.abs(x));
    if (at(arm, v) < 0.5 && at(head, v) < 0.3 && y > armpit + 0.05 * k)
      shoulderHalf = Math.max(shoulderHalf, Math.abs(x));
  }
  const nw = neckHalf + 0.01 * k;
  let snpY = m.neck[1] - 0.05 * k,
    spY = m.shoulder;
  for (let v = 0; v < body.count; v++) {
    const [x, y] = body.point(v);
    if (Math.abs(Math.abs(x) - nw) < 0.01 * k && at(head, v) < 0.5 && at(arm, v) < 0.2)
      snpY = Math.max(snpY, y);
    if (Math.abs(Math.abs(x) - shoulderHalf) < 0.015 * k) spY = Math.max(spY, y);
  }
  const ease = 0.1 * k + 2 * Math.PI * spec.room * k,
    wc = (chest + ease) / 4,
    wh = Math.max(wc, (hip + 0.06 * k + 2 * Math.PI * spec.room * k) / 4),
    shW = shoulderHalf + 0.012 * k,
    vua = underarmY - hemY;
  const outline = (lift: number, neckDepth: number, vNeck: boolean) => {
    const vsnp = snpY - hemY + lift,
      vsp = spY - hemY + lift * 0.8;
    const xa = shW - 0.014 * k;
    const armL = bezier([wc, vua], [mix(wc, xa, 0.55), vua], [xa, mix(vua, vsp, 0.45)], [shW, vsp]);
    const neckL = vNeck
      ? line([nw, vsnp], [0, vsnp - neckDepth])
      : bezier(
          [nw, vsnp],
          [nw, vsnp - 0.55 * neckDepth],
          [0.55 * nw, vsnp - neckDepth],
          [0, vsnp - neckDepth],
        );
    return {
      edges: [
        { id: "hem", curve: line([-wh, 0], [wh, 0]), free: true },
        { id: "side_l", curve: line([wh, 0], [wc, vua]), free: false },
        { id: "arm_l", curve: armL, free: false },
        { id: "shoulder_l", curve: line([shW, vsp], [nw, vsnp]), free: false },
        { id: "neck", curve: neckL.concat(backwards(flipX(neckL)).slice(1)), free: true },
        { id: "shoulder_r", curve: line([-nw, vsnp], [-shW, vsp]), free: false },
        { id: "arm_r", curve: backwards(flipX(armL)), free: false },
        { id: "side_r", curve: line([-wc, vua], [-wh, 0]), free: false },
      ],
      armLength: polylineLength(armL),
    };
  };
  const frontNeck = spec.neck === "v" ? Math.max(0.07 * k, spec.depth * k) : 0.075 * k,
    front = outline(0.04 * k, frontNeck, spec.neck === "v"),
    back = outline(0.03 * k, 0.02 * k, false);
  const S = body.joint("upperarm_l"),
    E = body.joint("lowerarm_l"),
    W = body.joint("hand_l"),
    upper = length(sub(E, S)),
    fore = length(sub(W, E)),
    capBase = Math.max(0.04 * k, S[1] - underarmY),
    sleeveEnd = spec.sleeve <= 1 ? spec.sleeve * upper : upper + (spec.sleeve - 1) * fore,
    vb = Math.max(0.03 * k, sleeveEnd - capBase);
  const girthAt = (d: number) =>
    d <= upper ? armGirth(body, "l", S, E, d) : armGirth(body, "l", E, W, d - upper);
  const bicep = Math.max(girthAt(Math.min(capBase + 0.02 * k, upper)), girthAt(upper * 0.45)),
    sleeveEase = 0.08 * k + 2 * Math.PI * spec.room * k,
    bw = (bicep + sleeveEase) / 2,
    endGirth = girthAt(clamp(sleeveEnd, 0.02 * k, upper + fore - 0.01 * k)),
    ce = Math.min(bw, (endGirth + 0.07 * k + 2 * Math.PI * spec.room * k) / 2);
  const armhole = front.armLength + back.armLength;
  const cap = (h: number) =>
    bezier([bw, vb], [bw * 0.62, vb + h * 0.08], [bw * 0.42, vb + h], [0, vb + h]);
  let lo = 0.01 * k,
    hi = 0.3 * k;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (polylineLength(cap(mid)) * 2 < armhole * 1.01) lo = mid;
    else hi = mid;
  }
  const capCurve = cap(lo);
  const sleeveEdges: PanelEdge[] = [
    { id: "cuff", curve: line([-ce, 0], [ce, 0]), free: true },
    { id: "under_a", curve: line([ce, 0], [bw, vb]), free: false },
    { id: "cap_a", curve: capCurve, free: false },
    { id: "cap_b", curve: backwards(flipX(capCurve)), free: false },
    { id: "under_b", curve: line([-bw, vb], [-ce, 0]), free: false },
  ];
  const sleeveChart: P2 = [Math.max(wh, wc, shW) + bw + 0.05 * k, 0];
  const panels: PanelDraft[] = [
    { name: "front", edges: front.edges, chart: [0, 0] },
    { name: "back", edges: back.edges, chart: [0, 0] },
    { name: "sleeve_l", edges: sleeveEdges, chart: sleeveChart },
    { name: "sleeve_r", edges: sleeveEdges, chart: sleeveChart },
  ];
  const seams: SeamDraft[] = [];
  for (const side of ["l", "r"]) {
    seams.push({ a: ["front", "side_" + side], b: ["back", "side_" + side] });
    seams.push({ a: ["front", "shoulder_" + side], b: ["back", "shoulder_" + side] });
    seams.push({ a: ["front", "arm_" + side], b: ["sleeve_" + side, "cap_a"] });
    seams.push({ a: ["back", "arm_" + side], b: ["sleeve_" + side, "cap_b"] });
    seams.push({ a: ["sleeve_" + side, "under_a"], b: ["sleeve_" + side, "under_b"] });
  }
  return {
    panels,
    seams,
    hemY,
    underarmY,
    snpY,
    sleeveEnd,
    capBase,
    chest,
  };
}

export interface PanelMesh {
  readonly name: string;
  readonly uv: P2[];
  readonly tri: number[];
  readonly edges: ReadonlyMap<string, ReadonlyArray<number>>;
  readonly free: ReadonlyArray<string>;
  readonly chart: P2;
}

function inside(poly: ReadonlyArray<P2>, p: P2): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (!a || !b) continue;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      hit = !hit;
  }
  return hit;
}

function segmentDistance(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l2 = dx * dx + dy * dy,
    t = l2 > 0 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function delaunay(points: ReadonlyArray<P2>): number[] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const span = Math.max(maxX - minX, maxY - minY) * 20,
    cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2;
  const pts: P2[] = [...points, [cx - span, cy - span], [cx + span, cy - span], [cx, cy + span]];
  const n = points.length;
  type Tri = { a: number; b: number; c: number; x: number; y: number; r: number };
  const circle = (a: number, b: number, c: number): Tri => {
    const [ax, ay] = pts[a] ?? [0, 0],
      [bx, by] = pts[b] ?? [0, 0],
      [qx, qy] = pts[c] ?? [0, 0];
    const d = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by)) || 1e-30;
    const ux =
      ((ax * ax + ay * ay) * (by - qy) +
        (bx * bx + by * by) * (qy - ay) +
        (qx * qx + qy * qy) * (ay - by)) /
      d;
    const uy =
      ((ax * ax + ay * ay) * (qx - bx) +
        (bx * bx + by * by) * (ax - qx) +
        (qx * qx + qy * qy) * (bx - ax)) /
      d;
    return { a, b, c, x: ux, y: uy, r: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris: Tri[] = [circle(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[i] ?? [0, 0];
    const bad: Tri[] = [],
      good: Tri[] = [];
    for (const t of tris) ((px - t.x) ** 2 + (py - t.y) ** 2 < t.r ? bad : good).push(t);
    const count = new Map<string, number>(),
      edges: Array<readonly [number, number]> = [];
    for (const t of bad)
      for (const [u, v] of [
        [t.a, t.b],
        [t.b, t.c],
        [t.c, t.a],
      ] as const) {
        const key = Math.min(u, v) + ":" + Math.max(u, v);
        count.set(key, (count.get(key) ?? 0) + 1);
        edges.push([u, v]);
      }
    for (const [u, v] of edges)
      if (count.get(Math.min(u, v) + ":" + Math.max(u, v)) === 1) good.push(circle(u, v, i));
    tris = good;
  }
  const out: number[] = [];
  for (const t of tris) {
    if (t.a >= n || t.b >= n || t.c >= n) continue;
    const [ax, ay] = pts[t.a] ?? [0, 0],
      [bx, by] = pts[t.b] ?? [0, 0],
      [qx, qy] = pts[t.c] ?? [0, 0];
    const area = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
    if (area > 0) out.push(t.a, t.b, t.c);
    else out.push(t.a, t.c, t.b);
  }
  return out;
}

export function meshPanels(draft: ShirtDraft, spacing: number): PanelMesh[] {
  const counts = new Map<string, number>();
  const edgeOf = (panel: string, id: string) =>
    draft.panels.find((p) => p.name === panel)?.edges.find((e) => e.id === id);
  for (const seam of draft.seams) {
    const a = edgeOf(...seam.a),
      b = edgeOf(...seam.b);
    if (!a || !b) throw new Error("A seam names a missing panel edge.");
    const n = Math.max(
      2,
      Math.round((polylineLength(a.curve) + polylineLength(b.curve)) / 2 / spacing),
    );
    counts.set(seam.a.join("/"), n);
    counts.set(seam.b.join("/"), n);
  }
  return draft.panels.map((panel) => {
    const uv: P2[] = [],
      edges = new Map<string, number[]>(),
      ring: P2[] = [];
    for (const edge of panel.edges) {
      const n =
        counts.get(panel.name + "/" + edge.id) ??
        Math.max(2, Math.round(polylineLength(edge.curve) / spacing));
      const pts = resample(edge.curve, n),
        ids: number[] = [];
      pts.forEach((p, i) => {
        if (i === pts.length - 1) return;
        ids.push(uv.length);
        uv.push(p);
        ring.push(p);
      });
      edges.set(edge.id, ids);
    }
    const order = panel.edges.map((e) => edges.get(e.id) ?? []);
    order.forEach((ids, i) => {
      const next = order[(i + 1) % order.length]?.[0];
      if (next !== undefined) ids.push(next);
    });
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const rowH = (spacing * Math.sqrt(3)) / 2;
    let row = 0;
    for (let y = minY + rowH * 0.5; y < maxY; y += rowH, row++)
      for (let x = minX + (row % 2 ? spacing / 2 : 0); x < maxX; x += spacing) {
        const p: P2 = [
          x + (hash1(row * 7919 + Math.round(x * 1e4)) - 0.5) * spacing * 0.02,
          y + (hash1(row * 104729 + Math.round(x * 1e4) * 3) - 0.5) * spacing * 0.02,
        ];
        if (!inside(ring, p)) continue;
        let near = Infinity;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i],
            b = ring[(i + 1) % ring.length];
          if (a && b) near = Math.min(near, segmentDistance(p, a, b));
        }
        if (near > spacing * 0.6) uv.push(p);
      }
    const tri: number[] = [];
    const all = delaunay(uv);
    for (let t = 0; t < all.length; t += 3) {
      const a = uv[at(all, t)] ?? [0, 0],
        b = uv[at(all, t + 1)] ?? [0, 0],
        c = uv[at(all, t + 2)] ?? [0, 0];
      const centre: P2 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      if (inside(ring, centre)) tri.push(at(all, t), at(all, t + 1), at(all, t + 2));
    }
    return {
      name: panel.name,
      uv,
      tri,
      edges,
      free: panel.edges.filter((e) => e.free).map((e) => e.id),
      chart: panel.chart,
    };
  });
}
