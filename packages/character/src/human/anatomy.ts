import * as T from "three";
import type { HumanBody } from "./body.js";
import { boneNames } from "./catalogue.js";
import { smoothHumanSurface, type SmoothSurface } from "./smooth.js";
import { evaluateHuman } from "./surface.js";

export const faceAnatomy = {
  seam: 1540.8,
  upper: 1549.6,
  lower: 1534.5,
  corner: [23.5, 1539.6],
  upperBack: 2.3,
  lowerBack: 1.4,
  seamForward: 1.6,
  cornerBack: 1.3,
  philtrum: 0.75,
  columns: 0.35,
  bow: 0.7,
  nostril: [10.6, 1567.6, 154],
  nostrilDeepen: 1.3,
  upperRim: [0.72, 0.16],
  tarsal: 0.38,
  upperCrease: [1.32, 0.24],
  upperHood: [0.42, 0.22],
  lowerRim: [0.82, 0.16],
  lowerGroove: 0.32,
  shade: { nostril: 0.66, seam: 0.3, corner: 0.24, lash: 0.56, crease: 0.28, lowerRim: 0.1 },
  smileLift: 0.34,
  smileLiftMost: 3.2,
  blinkUnwind: 0.65,
} as const;

const smooth = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bell = (v: number, at: number, width: number) => Math.exp(-(((v - at) / width) ** 2));

export interface FaceFields {
  readonly move: Float32Array;
  readonly shade: Float32Array;
  readonly lower: Float32Array;
  readonly crease: Float32Array;
  readonly lidAnchors: Uint8Array;
  readonly upperEdge: ReadonlyArray<number>;
  readonly lowerEdge: ReadonlyArray<number>;
  readonly count: number;
}

const cache = new WeakMap<HumanBody, FaceFields>();

export function faceAnatomyFields(body: HumanBody): FaceFields {
  const hit = cache.get(body);
  if (hit) return hit;
  const A = faceAnatomy;
  const cage = evaluateHuman(body, {});
  const s = smoothHumanSurface(body, cage);
  const p = s.positions,
    count = p.length / 3,
    corners = s.bodyTriangles * 3;
  const at = (i: number) => p[i] ?? 0;
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(p, 3));
  g.setIndex(new T.BufferAttribute(s.indices, 1));
  g.computeVertexNormals();
  const normal = g.getAttribute("normal").array;
  const n = (i: number) => normal[i] ?? 0;
  const lip = new Uint8Array(count),
    lid = new Uint8Array(count),
    head = new Uint8Array(count);
  const bone = boneNames.indexOf("head");
  for (let c = 0; c < s.indices.length; c++) {
    const v = s.indices[c] ?? 0,
      t = (s.uvFaces[c] ?? 0) * 4;
    lip[v] = Math.max(lip[v] ?? 0, s.pigments[t] ?? 0);
    lid[v] = Math.max(lid[v] ?? 0, s.pigments[t + 1] ?? 0);
  }
  for (let v = 0; v < count; v++)
    for (let j = v * 4; j < v * 4 + 4; j++)
      if (s.boneIndices[j] === bone && (s.weights[j] ?? 0) > 0.5) head[v] = 1;
  const eye = [0, 0, 0];
  let eyes = 0;
  const cp = cage.positions;
  const eyeCentres = cage.eyeGroups.map((ids) => {
    const c = [0, 0, 0];
    for (const id of ids) {
      for (let d = 0; d < 3; d++) c[d] = (c[d] ?? 0) + (cp[id * 3 + d] ?? 0) / ids.length;
      eye[0] = (eye[0] ?? 0) + Math.abs(at(id * 3));
      eye[1] = (eye[1] ?? 0) + at(id * 3 + 1);
      eye[2] = (eye[2] ?? 0) + at(id * 3 + 2);
      eyes++;
    }
    let reach = 0;
    for (const id of ids)
      reach = Math.max(
        reach,
        Math.hypot(
          (cp[id * 3] ?? 0) - (c[0] ?? 0),
          (cp[id * 3 + 1] ?? 0) - (c[1] ?? 0),
          (cp[id * 3 + 2] ?? 0) - (c[2] ?? 0),
        ),
      );
    return { c, reach };
  });
  const toMillimetres = 1000 / eyes;
  for (let d = 0; d < 3; d++) eye[d] = (eye[d] ?? 0) * toMillimetres;
  const eyeY = eye[1] ?? 0,
    eyeZ = eye[2] ?? 0;
  const adj = Array.from({ length: count }, () => new Set<number>());
  const link = (a: number, b: number) => adj[a]?.add(b);
  for (let c = 0; c < corners; c += 3) {
    const a = s.indices[c] ?? 0,
      b = s.indices[c + 1] ?? 0,
      d = s.indices[c + 2] ?? 0;
    link(a, b);
    link(a, d);
    link(b, a);
    link(b, d);
    link(d, a);
    link(d, b);
  }
  const neighbours = (v: number): Set<number> => adj[v] ?? new Set();
  const lidCage = (v: number) => (v >= 6756 && v < 6784) || (v >= 13352 && v < 13380);
  const ring0 = new Uint8Array(count);
  for (let v = 0; v < count; v++) if (lidCage(v)) ring0[v] = 1;
  for (let v = 0; v < count; v++) {
    if (ring0[v]) continue;
    const nbrs = [...neighbours(v)].filter(lidCage);
    if (nbrs.length !== 2) continue;
    const u = nbrs[0] ?? 0,
      w = nbrs[1] ?? 0;
    const d = Math.hypot(
      at(v * 3) - 0.5 * (at(u * 3) + at(w * 3)),
      at(v * 3 + 1) - 0.5 * (at(u * 3 + 1) + at(w * 3 + 1)),
      at(v * 3 + 2) - 0.5 * (at(u * 3 + 2) + at(w * 3 + 2)),
    );
    const seg = Math.hypot(
      at(u * 3) - at(w * 3),
      at(u * 3 + 1) - at(w * 3 + 1),
      at(u * 3 + 2) - at(w * 3 + 2),
    );
    if (d < 0.22 * seg) ring0[v] = 1;
  }
  const uvParent = Int32Array.from({ length: s.uv.length / 2 }, (_, i) => i);
  const findUv = (start: number) => {
    let i = start;
    while (uvParent[i] !== i) {
      const up = uvParent[uvParent[i] ?? i] ?? i;
      uvParent[i] = up;
      i = up;
    }
    return i;
  };
  for (let t = 0; t < corners; t += 3) {
    const a = findUv(s.uvFaces[t] ?? 0);
    uvParent[findUv(s.uvFaces[t + 1] ?? 0)] = a;
    uvParent[findUv(s.uvFaces[t + 2] ?? 0)] = a;
  }
  const firstIsl = new Int32Array(count).fill(-1),
    sharedSeam = new Uint8Array(count),
    islands = new Map<number, Set<number>>();
  for (let i = 0; i < corners; i++) {
    const isl = findUv(s.uvFaces[i] ?? 0),
      v = s.indices[i] ?? 0;
    const first = firstIsl[v] ?? -1;
    if (first < 0) firstIsl[v] = isl;
    else if (first !== isl) sharedSeam[v] = 1;
    let members = islands.get(isl);
    if (!members) {
      members = new Set();
      islands.set(isl, members);
    }
    members.add(v);
  }
  const innerSocket = new Uint8Array(count),
    qIn: number[] = [];
  for (const { c, reach } of eyeCentres) {
    const [cx = 0, cy = 0, cz = 0] = c;
    for (const members of islands.values()) {
      let wraps = true;
      const mid = [0, 0, 0];
      for (const v of members) {
        if (Math.hypot(at(v * 3) - cx, at(v * 3 + 1) - cy, at(v * 3 + 2) - cz) > 1.8 * reach) {
          wraps = false;
          break;
        }
        for (let d = 0; d < 3; d++) mid[d] = (mid[d] ?? 0) + at(v * 3 + d) / members.size;
      }
      if (
        !wraps ||
        Math.hypot((mid[0] ?? 0) - cx, (mid[1] ?? 0) - cy, (mid[2] ?? 0) - cz) > 0.6 * reach
      )
        continue;
      for (const v of members)
        if (!sharedSeam[v] && !ring0[v] && !innerSocket[v]) {
          innerSocket[v] = 1;
          qIn.push(v);
        }
    }
  }
  for (let h = 0; h < qIn.length; h++)
    for (const w of neighbours(qIn[h] ?? 0))
      if (!innerSocket[w] && !ring0[w]) {
        innerSocket[w] = 1;
        qIn.push(w);
      }
  const lidRing = new Int16Array(count).fill(-1),
    qOut: number[] = [];
  for (let v = 0; v < count; v++)
    if (ring0[v]) {
      lidRing[v] = 0;
      qOut.push(v);
    }
  for (let h = 0; h < qOut.length; h++) {
    const u = qOut[h] ?? 0,
      ru = lidRing[u] ?? -1;
    if (ru >= 16) continue;
    for (const w of neighbours(u))
      if ((lidRing[w] ?? 0) < 0 && !innerSocket[w]) {
        lidRing[w] = ru + 1;
        qOut.push(w);
      }
  }
  const lidDist = new Float32Array(count).fill(Infinity);
  for (let v = 0; v < count; v++) if (ring0[v]) lidDist[v] = 0;
  for (let iter = 0; iter < 18; iter++) {
    let changed = false;
    for (let v = 0; v < count; v++) {
      if ((lidRing[v] ?? -1) < 0 || innerSocket[v]) continue;
      for (const w of neighbours(v)) {
        if ((lidRing[w] ?? -1) < 0 || innerSocket[w]) continue;
        const e =
          1000 *
          Math.hypot(
            at(v * 3) - at(w * 3),
            at(v * 3 + 1) - at(w * 3 + 1),
            at(v * 3 + 2) - at(w * 3 + 2),
          );
        const dv = lidDist[v] ?? Infinity;
        if (dv + e < (lidDist[w] ?? Infinity) - 1e-5) {
          lidDist[w] = dv + e;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  let minAx = Infinity,
    maxAx = -Infinity,
    innerY = 0,
    outerY = 0;
  for (let v = 13352; v < 13380; v++) {
    const ax = Math.abs(at(v * 3)),
      y = at(v * 3 + 1);
    if (ax < minAx) {
      minAx = ax;
      innerY = y;
    }
    if (ax > maxAx) {
      maxAx = ax;
      outerY = y;
    }
  }
  const cornerY = (ax: number) => {
    const t = Math.min(1, Math.max(0, (ax - minAx) / (maxAx - minAx)));
    return (innerY + (outerY - innerY) * t) * 1000;
  };
  const move = new Float32Array(count * 3),
    shade = new Float32Array(count),
    lower = new Float32Array(count),
    crease = new Float32Array(count),
    lidAnchors = new Uint8Array(count);
  const upperEdge: number[] = [],
    lowerEdge: number[] = [];
  for (let v = 0; v < count; v++) {
    if (ring0[v]) {
      lidAnchors[v] = 1;
      continue;
    }
    if (innerSocket[v] && v < cage.bodyVertices) {
      for (const w of neighbours(v))
        if (ring0[w]) {
          lidAnchors[v] = 1;
          break;
        }
      continue;
    }
    const r = lidRing[v] ?? -1;
    if (r < 1) continue;
    const y = at(v * 3 + 1) * 1000,
      cY = cornerY(Math.abs(at(v * 3)));
    if (r === 2) lidAnchors[v] = 1;
    else if (r === 10 && y > cY) lidAnchors[v] = 1;
    else if ((r === 6 || r === 12) && y > cY && v < cage.bodyVertices) lidAnchors[v] = 1;
    else if (r === 3 && y <= cY && v < cage.bodyVertices) lidAnchors[v] = 1;
  }
  const [cornerX, cornerYAt] = A.corner;
  const [nx, ny, nz] = A.nostril;
  for (let v = 0; v < count; v++) {
    if (!head[v]) continue;
    const x = 1000 * at(v * 3),
      y = 1000 * at(v * 3 + 1),
      z = 1000 * at(v * 3 + 2),
      ax = Math.abs(x),
      side = x < 0 ? -1 : 1;
    if (z < 118 || y < 1505 || y > 1640) continue;
    let dx = 0,
      dy = 0,
      dz = 0,
      dark = 0;
    if (y < 1568 && y > 1518 && ax < 34) {
      const front = smooth(z, 144, 148.5),
        across = 1 - smooth(ax / cornerX, 0.5, 1.02);
      const up = bell(y, A.upper, y > A.upper ? 3.6 : 3.3),
        low = bell(y, A.lower, 4.2),
        meet = bell(y, A.seam, 1.7);
      dz +=
        front * across * (-A.upperBack * up - A.lowerBack * low) +
        smooth(z, 143, 147) * across * A.seamForward * meet;
      const corner =
        Math.exp(-(((ax - cornerX) / 5.2) ** 2 + ((y - cornerYAt) / 4.6) ** 2)) *
        smooth(z, 128, 138);
      dz -= A.cornerBack * corner;
      const run = smooth(y, A.upper - 0.5, A.upper + 2.5) * (1 - smooth(y, 1559, 1563)) * front;
      dz += run * (-A.philtrum * bell(x, 0, 2.8) + A.columns * bell(ax, 5, 1.9));
      const border = bell(y, A.upper + 0.6, 2.2) * front;
      dy += border * A.bow * (-bell(x, 0, 2.6) + 0.6 * bell(ax, 5.2, 2.4));
      const lips = (lip[v] ?? 0) / 255;
      dark = Math.max(
        dark,
        A.shade.seam *
          lips *
          bell(y, A.seam - 0.25 * (ax / cornerX) ** 2, 1.15) *
          smooth(z, 140, 146),
        A.shade.corner * corner * smooth(z, 134, 140),
      );
    }
    if (y < A.seam + 1.2 && y > A.seam - 22 && ax < 26 && z > 126) {
      const facing = y > A.seam - 2.2 ? smooth(n(v * 3 + 1), -0.05, 0.3) : 1;
      lower[v] =
        facing *
        (1 - smooth(ax / cornerX, 0.3, 0.98)) *
        (1 - smooth(A.seam - y, 8, 21)) *
        smooth(z, 128, 140);
    }
    if (ax < 5 && Math.abs(y - A.seam) < 1.7 && z > 147.5 && (lip[v] ?? 0) > 128) {
      if (n(v * 3 + 1) > 0.25) lowerEdge.push(v);
      else if (n(v * 3 + 1) < -0.25) upperEdge.push(v);
    }
    const down = smooth(-n(v * 3 + 1), -0.35, 0.7);
    const hole = Math.exp(
      -(((ax - nx) / 3.6) ** 2 + ((y - ny) / 2.6) ** 2 + ((z - nz) / 4.8) ** 2),
    );
    if (hole > 0.01) {
      dy += A.nostrilDeepen * hole * down;
      dz -= 0.5 * A.nostrilDeepen * hole * down;
      const wide = Math.exp(
        -(((ax - nx) / 4.1) ** 2 + ((y - ny) / 2.9) ** 2 + ((z - nz) / 5.3) ** 2),
      );
      dark = Math.max(dark, A.shade.nostril * Math.min(1, 1.25 * wide) * down);
    }
    const d = lidDist[v] ?? Infinity;
    if (Number.isFinite(d) && d > 0 && d < 12.5 && !innerSocket[v]) {
      const cY = cornerY(Math.abs(at(v * 3))),
        tAcross = (Math.abs(at(v * 3)) - minAx) / (maxAx - minAx);
      const acrossU = smooth(tAcross, -0.05, 0.24) * (1 - smooth(tAcross, 0.78, 1.15));
      const acrossL = smooth(tAcross, -0.04, 0.2) * (1 - smooth(tAcross, 0.78, 1.1));
      const isUpper = smooth(y - cY, -0.5, 0.7),
        isLower = 1 - isUpper;
      const uRim = bell(d, 2.2, 1.4) * smooth(d, 0.15, 1);
      dz += isUpper * acrossU * A.upperRim[0] * uRim;
      dy -= isUpper * acrossU * A.upperRim[1] * uRim;
      dz += isUpper * acrossU * A.tarsal * bell(d, 3.5, 1.3);
      const creaseW = isUpper * acrossU * bell(d, 5.9, 1.65);
      dz -= A.upperCrease[0] * creaseW;
      dy += A.upperCrease[1] * creaseW;
      crease[v] = creaseW;
      const hood = bell(d, 8.4, 1.65);
      dz += isUpper * acrossU * A.upperHood[0] * hood;
      dy -= isUpper * acrossU * A.upperHood[1] * hood;
      const lRim = bell(d, 1.65, 1.1) * smooth(d, 0.15, 0.8);
      dz += isLower * acrossL * A.lowerRim[0] * lRim;
      dy += isLower * acrossL * A.lowerRim[1] * lRim;
      dz -= isLower * acrossL * A.lowerGroove * bell(d, 4.6, 1.5);
      dark = Math.max(
        dark,
        A.shade.crease * creaseW,
        A.shade.lowerRim *
          isLower *
          acrossL *
          bell(d, 3.5, 1.15) *
          smooth(-n(v * 3 + 1), -0.05, 0.35),
      );
    }
    if ((lid[v] ?? 0) > 100 && Math.abs(y - eyeY) < 14) {
      const margin = ((lid[v] ?? 0) / 255) * smooth(z, eyeZ - 6, eyeZ - 1);
      if (y > eyeY) dark = Math.max(dark, margin * A.shade.lash * smooth(-n(v * 3 + 1), 0.05, 0.5));
    }
    move[v * 3] = side * dx;
    move[v * 3 + 1] = dy;
    move[v * 3 + 2] = dz;
    shade[v] = dark;
  }
  g.dispose();
  const fields = { move, shade, lower, crease, lidAnchors, upperEdge, lowerEdge, count };
  cache.set(body, fields);
  return fields;
}

export function refineFaceForm(body: HumanBody, surface: SmoothSurface): SmoothSurface {
  const { move, count } = faceAnatomyFields(body);
  const p = surface.positions;
  if (p.length !== count * 3) return surface;
  const unit = (0.001 * (surface.height ?? 1.72)) / 1.72;
  for (let i = 0; i < move.length; i++) {
    const m = move[i] ?? 0;
    if (m) p[i] = (p[i] ?? 0) + unit * m;
  }
  return surface;
}

export function facialMorphNormals(
  geometry: T.BufferGeometry,
  vertexIds: ReadonlyArray<number>,
): void {
  const distinct = new Map<number, number>(),
    representatives: number[] = [];
  const welded = vertexIds.map((v, i) => {
    let k = distinct.get(v);
    if (k === undefined) {
      k = representatives.length;
      distinct.set(v, k);
      representatives.push(i);
    }
    return k;
  });
  const positions = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (!index) throw new Error("Expression normals need an indexed surface.");
  const probe = new T.BufferGeometry();
  probe.setIndex(Array.from(index.array, (i) => welded[i] ?? 0));
  const posed = new T.Float32BufferAttribute(new Float32Array(representatives.length * 3), 3);
  probe.setAttribute("position", posed);
  const sample = (target?: T.BufferAttribute | T.InterleavedBufferAttribute) => {
    for (let j = 0; j < representatives.length; j++) {
      const i = representatives[j] ?? 0;
      posed.setXYZ(
        j,
        positions.getX(i) + (target?.getX(i) ?? 0),
        positions.getY(i) + (target?.getY(i) ?? 0),
        positions.getZ(i) + (target?.getZ(i) ?? 0),
      );
    }
    probe.computeVertexNormals();
    return probe.getAttribute("normal").array;
  };
  const rest = sample().slice();
  geometry.morphAttributes["normal"] = (geometry.morphAttributes["position"] ?? []).map(
    (target) => {
      const now = sample(target),
        delta = new Float32Array(positions.count * 3);
      for (let i = 0; i < welded.length; i++) {
        const j = (welded[i] ?? 0) * 3;
        for (let d = 0; d < 3; d++) delta[3 * i + d] = (now[j + d] ?? 0) - (rest[j + d] ?? 0);
      }
      const attribute = new T.BufferAttribute(delta, 3);
      attribute.name = target.name;
      return attribute;
    },
  );
  probe.dispose();
}

export function shadeFaceForm(
  body: HumanBody,
  geometry: T.BufferGeometry,
  vertexIds: ReadonlyArray<number>,
): void {
  const colour = geometry.getAttribute("color");
  if (!colour) return;
  const { shade } = faceAnatomyFields(body);
  for (let i = 0; i < vertexIds.length; i++) {
    const dark = shade[vertexIds[i] ?? 0] ?? 0;
    if (!dark) continue;
    colour.setXYZ(
      i,
      colour.getX(i) * (1 - 0.86 * dark),
      colour.getY(i) * (1 - dark),
      colour.getZ(i) * (1 - dark),
    );
  }
  colour.needsUpdate = true;
}

const unwound = new WeakSet<object>();

export function refineExpressions(
  body: HumanBody,
  geometry: T.BufferGeometry,
  vertexIds: ReadonlyArray<number>,
  scale = 1,
): number {
  const targets = geometry.morphAttributes["position"] ?? [];
  const blink = targets.find((attr) => attr.name === "Blink");
  const { lower, crease, upperEdge, lowerEdge } = faceAnatomyFields(body);
  if (blink && !unwound.has(blink)) {
    const unit = 0.001 * scale * faceAnatomy.blinkUnwind;
    for (let i = 0; i < vertexIds.length; i++) {
      const w = crease[vertexIds[i] ?? 0] ?? 0;
      if (w)
        blink.setXYZ(
          i,
          blink.getX(i),
          blink.getY(i) - unit * faceAnatomy.upperCrease[1] * w,
          blink.getZ(i) + unit * faceAnatomy.upperCrease[0] * w,
        );
    }
    unwound.add(blink);
    blink.needsUpdate = true;
  }
  const smile = targets.find((attr) => attr.name === "Smile");
  if (!smile) return 0;
  const p = geometry.getAttribute("position"),
    at = new Map<number, number>();
  vertexIds.forEach((v, i) => {
    if (!at.has(v)) at.set(v, i);
  });
  const height = (ids: ReadonlyArray<number>, posed: boolean) => {
    let total = 0,
      n = 0;
    for (const v of ids) {
      const i = at.get(v);
      if (i === undefined) continue;
      total += p.getY(i) + (posed ? smile.getY(i) : 0);
      n++;
    }
    return n ? total / n : null;
  };
  const top = height(upperEdge, true),
    bottom = height(lowerEdge, true),
    restTop = height(upperEdge, false),
    restBottom = height(lowerEdge, false);
  if (top === null || bottom === null || restTop === null || restBottom === null) return 0;
  const parted = Math.max(0, top - bottom - (restTop - restBottom));
  const lift = Math.min(faceAnatomy.smileLift * parted, 0.001 * scale * faceAnatomy.smileLiftMost);
  if (lift <= 0) return 0;
  for (let i = 0; i < vertexIds.length; i++) {
    const w = lower[vertexIds[i] ?? 0] ?? 0;
    if (w) smile.setXYZ(i, smile.getX(i), smile.getY(i) + lift * w, smile.getZ(i) + 0.2 * lift * w);
  }
  smile.needsUpdate = true;
  return lift;
}
