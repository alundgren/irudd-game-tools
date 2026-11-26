import * as T from "three";
import type { CreaturePlan, FigureMarkings } from "@irudd/document";
import { context2d, type Raster } from "../raster.js";
import { isMesh } from "../mesh.js";
import type { BuildPart } from "../view.js";
import type { BlendOwners } from "../surfaces/blend.js";
import type { Digit } from "../surfaces/hand.js";
import { classifyCreatureRelief, evaluateBiologicalRelief, type ReliefContext } from "./relief.js";
import { hash3, noise3, slot, worley3 } from "./noise.js";
import { flankPaint } from "./flank.js";
import { faceCoat, type FaceCoat } from "./face-coat.js";
import { creatureCoatField, spineOf } from "./coat.js";
import type { LimbTint } from "./limb-colour.js";

const { clamp, smoothstep } = T.MathUtils;
const HIDE_SIZE = 1024;
const CHART_MARGIN = 4;

const LIN_TO_SRGB = Uint8Array.from({ length: 4096 }, (_, i) => {
  const x = i / 4095;
  const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(s * 255)));
});
const toSrgbByte = (v: number): number =>
  LIN_TO_SRGB[v <= 0 ? 0 : v >= 1 ? 4095 : (v * 4095 + 0.5) | 0] ?? 0;

export interface HideScene {
  readonly plan: CreaturePlan;
  readonly parts: ReadonlyArray<BuildPart>;
  readonly objectOf: (id: string) => T.Object3D | undefined;
  readonly owners: (mesh: T.Mesh) => BlendOwners | undefined;
  readonly hands: Map<T.Mesh, ReadonlyArray<Digit>>;
  readonly skinShows: (part: BuildPart) => boolean;
  readonly raster: Raster;
}

function legacyShape(part: BuildPart): string {
  if (part.sweep) return "sweep";
  if (part.cage) return "cage";
  if (part.hand) return "hand";
  if (part.scute || part.volume || part.mantle || part.wing || part.piece) return "other";
  return part.shape;
}

const HIDE_SHAPES = new Set(["sweep", "ellipsoid", "cage", "hand", "box", "cone", "cylinder"]);

export function isCreatureHidePart(part: BuildPart, skin: CreaturePlan["skin"]): boolean {
  if (part.paint || part.volume || part.fibres || part.fitted) return false;
  if (!HIDE_SHAPES.has(legacyShape(part))) return false;
  if (part.finish !== skin.surface) return false;
  if (part.organ.hide === "kit") return false;
  return Boolean(
    part.blend || part.markings || part.undercoat || part.coatZone || part.organ.hide === "core",
  );
}

export function patternVisibility(skin: CreaturePlan["skin"]): number {
  const m = skin.markings;
  if (!m) return 0;
  if (m.kind === "Countershade") return 0.14;
  const a = new T.Color(skin.base);
  const b = new T.Color(m.color);
  const ar = toSrgbByte(a.r) / 255;
  const ag = toSrgbByte(a.g) / 255;
  const ab = toSrgbByte(a.b) / 255;
  const br = toSrgbByte(b.r) / 255;
  const bg = toSrgbByte(b.g) / 255;
  const bb = toSrgbByte(b.b) / 255;
  const dr = ar - br;
  const dg = ag - bg;
  const db = ab - bb;
  const dist = Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
  const avgL = 0.5 * (0.299 * (ar + br) + 0.587 * (ag + bg) + 0.114 * (ab + bb));
  const brightPenalty = avgL > 0.72 ? 1 - 0.38 * clamp((avgL - 0.72) / 0.22, 0, 1) : 1;
  return clamp((dist * brightPenalty) / 0.28, 0, 1);
}

interface MarkingSampler {
  readonly kind: FigureMarkings["kind"];
  readonly r: number;
  readonly g: number;
  readonly b: number;
  sample(
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    organicWarp: boolean,
  ): number;
}

function makeMarkingSampler(m: FigureMarkings): MarkingSampler {
  const phase = hash3(1, 2, 3, m.seed) * 6.2831853;
  const angle = (m.angle * Math.PI) / 180;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const invS = 1 / m.spacing;
  const kind = m.kind;
  const cov = m.coverage;
  const seed = m.seed;
  const col = new T.Color(m.color);
  const wBuf = new Float64Array(3);
  return {
    kind,
    r: col.r,
    g: col.g,
    b: col.b,
    sample(px, py, pz, _nx, ny, nz, organicWarp) {
      let x = px * invS;
      let y = (py * cos - pz * sin) * invS;
      let z = (pz * cos + py * sin) * invS;
      if (kind === "Countershade") {
        const nWarp = organicWarp
          ? (noise3(x * 1.4, y * 1.4, z * 1.4, seed ^ 0x41a7) - 0.5) * 0.1
          : 0;
        const underside = -(ny * cos - nz * sin) + 0.07 * Math.sin(phase + 2 * z + 0.3 * x) + nWarp;
        return smoothstep(underside, 0.66 - 1.6 * cov, 1.22 - 1.6 * cov);
      }
      if (organicWarp) {
        const wf = 1.35;
        const wa = kind === "Bands" ? 0.06 : 0.055;
        x += (noise3(x * wf, y * wf, z * wf, seed ^ 0x1337) - 0.5) * 2 * wa;
        y += (noise3(x * wf + 7.1, y * wf, z * wf, seed ^ 0x517cc1) - 0.5) * 2 * wa;
        z += (noise3(x * wf, y * wf + 5.3, z * wf, seed ^ 0x9e3779) - 0.5) * 2 * wa;
      }
      if (kind === "Bands") {
        const wave = Math.cos(
          Math.PI *
            2 *
            (z +
              0.16 * Math.sin(phase + 0.9 * x + 1.2 * y) +
              0.08 * Math.sin(0.74 * z - 0.8 * x + phase)),
        );
        const cutoff = Math.cos(Math.PI * cov);
        return smoothstep(wave, cutoff - 0.15, cutoff + 0.15);
      }
      if (kind === "Marbled") {
        const drift =
          0.67 * Math.sin(1.8 * z + 1.2 * x + phase) +
          0.26 * Math.sin(2.7 * y - 1.3 * z + 0.7 * phase);
        const vein = Math.abs(Math.sin(Math.PI * (0.65 * y + 0.3 * x + drift)));
        const width = Math.sin(0.5 * Math.PI * cov);
        return 1 - smoothstep(vein, width - 0.07, width + 0.07);
      }
      worley3(wBuf, x, y, z, seed);
      const r = slot(wBuf, 0);
      if (kind === "Reticulated") {
        const gap = slot(wBuf, 1) - r;
        const width = 0.018 + 0.4 * cov;
        return 1 - smoothstep(gap, width * 0.72, width * 1.24);
      }
      const outer = 0.26 + 0.48 * cov;
      const spot = 1 - smoothstep(r, outer - 0.055, outer + 0.042);
      if (kind === "Spots") return spot;
      return spot * smoothstep(r, outer * 0.52 - 0.035, outer * 0.62);
    },
  };
}

function heroWeight(part: BuildPart): number {
  const rank = part.organ.rank;
  return rank === "head"
    ? 3.4
    : rank === "throat"
      ? 2.25
      : rank === "spine"
        ? 1.4
        : rank === "haunch"
          ? 0.92
          : 0.68;
}

interface KnotSegment {
  readonly a: T.Vector3;
  readonly dir: T.Vector3;
  readonly up: T.Vector3;
  readonly side: T.Vector3;
  readonly len: number;
  readonly start: number;
}

function knotSegments(
  knots: ReadonlyArray<readonly number[]>,
  matrixWorld: T.Matrix4,
): { readonly segs: KnotSegment[]; readonly total: number } {
  const pts = knots.map((k) => new T.Vector3(k[0], k[1], k[2]).applyMatrix4(matrixWorld));
  const segs: KnotSegment[] = [];
  let total = 0;
  let prevUp: T.Vector3 | undefined;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-6) continue;
    dir.divideScalar(len);
    const up = prevUp
      ? prevUp.clone()
      : Math.abs(dir.y) < 0.85
        ? new T.Vector3(0, 1, 0)
        : new T.Vector3(0, 0, 1);
    up.addScaledVector(dir, -up.dot(dir));
    if (up.lengthSq() < 1e-6) up.set(1, 0, 0).addScaledVector(dir, -dir.x);
    up.normalize();
    const side = new T.Vector3().crossVectors(dir, up).normalize();
    prevUp = up;
    segs.push({ a, dir, up, side, len, start: total });
    total += len;
  }
  return { segs, total };
}

type NumberArray =
  | Float32Array
  | Float64Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array;

function sameKind(array: unknown, length: number): NumberArray {
  if (array instanceof Float32Array) return new Float32Array(length);
  if (array instanceof Float64Array) return new Float64Array(length);
  if (array instanceof Uint8Array) return new Uint8Array(length);
  if (array instanceof Uint16Array) return new Uint16Array(length);
  if (array instanceof Uint32Array) return new Uint32Array(length);
  if (array instanceof Int8Array) return new Int8Array(length);
  if (array instanceof Int16Array) return new Int16Array(length);
  if (array instanceof Int32Array) return new Int32Array(length);
  throw new Error("A hide organ has an attribute the hide cannot chart.");
}

const corner = (index: T.BufferAttribute | null, t: number, k: number): number =>
  index ? index.getX(3 * t + k) : 3 * t + k;

function assignChartTriangles(
  scene: HideScene,
  mesh: T.Mesh,
  triChartIds: Uint8Array,
  numCharts: number,
): { readonly buckets: number[][]; readonly srcOrder: number[] | undefined } {
  const geometry = mesh.geometry;
  const pos = geometry.getAttribute("position");
  const idx = geometry.index;
  const triCount = (idx ? idx.count : pos.count) / 3;
  const buckets = Array.from({ length: numCharts }, (): number[] => []);
  if (!idx) {
    for (let t = 0; t < triCount; t++) buckets[triChartIds[t] ?? 0]?.push(t);
    return { buckets, srcOrder: undefined };
  }
  const map = new Map<number, number>();
  const srcOrder: number[] = [];
  const newIndices = new Uint32Array(idx.count);
  const oldIdx = idx.array;
  for (let t = 0; t < triCount; t++) {
    const cid = triChartIds[t] ?? 0;
    buckets[cid]?.push(t);
    for (let k = 0; k < 3; k++) {
      const ov = oldIdx[3 * t + k] ?? 0;
      const key = ov * numCharts + cid;
      let nv = map.get(key);
      if (nv === undefined) {
        nv = srcOrder.length;
        map.set(key, nv);
        srcOrder.push(ov);
      }
      newIndices[3 * t + k] = nv;
    }
  }
  if (srcOrder.length !== pos.count) {
    for (const [name, attr] of Object.entries(geometry.attributes)) {
      if (name === "uv") continue;
      if (!(attr instanceof T.BufferAttribute))
        throw new Error("A hide organ has an interleaved attribute.");
      const sz = attr.itemSize;
      const source = attr.array;
      const out = sameKind(source, srcOrder.length * sz);
      for (let i = 0; i < srcOrder.length; i++) {
        const s = (srcOrder[i] ?? 0) * sz;
        const d = i * sz;
        for (let j = 0; j < sz; j++) out[d + j] = source[s + j] ?? 0;
      }
      geometry.setAttribute(name, new T.BufferAttribute(out, sz, attr.normalized));
    }
    geometry.setIndex(new T.BufferAttribute(newIndices, 1));
    const digits = scene.hands.get(mesh);
    if (digits) {
      const oldToNew = Array.from({ length: pos.count }, (): number[] => []);
      for (let nv = 0; nv < srcOrder.length; nv++) oldToNew[srcOrder[nv] ?? 0]?.push(nv);
      scene.hands.set(
        mesh,
        digits.map((digit) => {
          const vertices: number[] = [];
          const parameters: number[] = [];
          for (let i = 0; i < digit.vertices.length; i++) {
            const targets = oldToNew[digit.vertices[i] ?? -1];
            const param = digit.parameters[i] ?? 0;
            if (!targets) continue;
            for (const target of targets) {
              vertices.push(target);
              parameters.push(param);
            }
          }
          return { ...digit, vertices, parameters };
        }),
      );
    }
  }
  return { buckets, srcOrder };
}

function triangleArea3D(a: T.Vector3, b: T.Vector3, c: T.Vector3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const rx = aby * acz - abz * acy;
  const ry = abz * acx - abx * acz;
  const rz = abx * acy - aby * acx;
  return 0.5 * Math.hypot(rx, ry, rz);
}

interface Chart {
  readonly mesh: T.Mesh;
  readonly part: BuildPart;
  readonly tris: Int32Array;
  readonly u: Float32Array;
  readonly v: Float32Array;
  readonly area: number;
  readonly weight: number;
  readonly aspect: number;
  rect: readonly [number, number, number, number];
}

function buildHideCharts(
  scene: HideScene,
  entries: ReadonlyArray<{ readonly part: BuildPart; readonly mesh: T.Mesh }>,
): Chart[] {
  const charts: Chart[] = [];
  const p = new T.Vector3();
  const pA = new T.Vector3();
  const pB = new T.Vector3();
  const pC = new T.Vector3();
  const nTmp = new T.Vector3();
  const rel = new T.Vector3();
  const unplaced = [0, 0, 0, 0] as const;
  const push = (
    mesh: T.Mesh,
    part: BuildPart,
    tris: Int32Array,
    u: Float32Array,
    v: Float32Array,
    area: number,
    aspect: number,
  ): void => {
    charts.push({
      mesh,
      part,
      tris,
      u,
      v,
      area: Math.max(1e-5, area),
      weight: Math.max(1e-5, area) * heroWeight(part),
      aspect,
      rect: unplaced,
    });
  };
  const chartArea = (
    mesh: T.Mesh,
    tris: ReadonlyArray<number>,
    project: (vi: number) => readonly [number, number],
    uArr: Float32Array,
    vArr: Float32Array,
    single = false,
  ): number => {
    const geo = mesh.geometry;
    const newPos = geo.getAttribute("position");
    const newIdx = geo.index;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    let area = 0;
    const raw = new Map<number, readonly [number, number]>();
    for (const t of tris) {
      const i0 = corner(newIdx, t, 0);
      const i1 = corner(newIdx, t, 1);
      const i2 = corner(newIdx, t, 2);
      pA.fromBufferAttribute(newPos, i0).applyMatrix4(mesh.matrixWorld);
      pB.fromBufferAttribute(newPos, i1).applyMatrix4(mesh.matrixWorld);
      pC.fromBufferAttribute(newPos, i2).applyMatrix4(mesh.matrixWorld);
      area += triangleArea3D(pA, pB, pC);
      for (const vi of [i0, i1, i2]) {
        if (raw.has(vi)) continue;
        const [ru, rv] = project(vi);
        raw.set(vi, single ? [Math.fround(ru), Math.fround(rv)] : [ru, rv]);
        if (ru < minU) minU = ru;
        if (ru > maxU) maxU = ru;
        if (rv < minV) minV = rv;
        if (rv > maxV) maxV = rv;
      }
    }
    const spanU = Math.max(1e-5, maxU - minU);
    const spanV = Math.max(1e-5, maxV - minV);
    for (const [vi, [ru, rv]] of raw) {
      uArr[vi] = (ru - minU) / spanU;
      vArr[vi] = (rv - minV) / spanV;
    }
    return area;
  };

  for (const { mesh, part } of entries) {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry;
    const pos = geo.getAttribute("position");
    if (pos.count < 3) continue;
    const idx = geo.index;
    const triCount = (idx ? idx.count : pos.count) / 3;
    const owners = scene.owners(mesh);
    const hand = scene.hands.has(mesh);
    const shape = legacyShape(part);

    const uv = geo.getAttribute("uv");
    if (
      !owners &&
      !hand &&
      uv !== undefined &&
      ["sweep", "ellipsoid", "cone", "cylinder"].includes(shape)
    ) {
      let area = 0;
      const tris = new Int32Array(triCount);
      for (let t = 0; t < triCount; t++) {
        tris[t] = t;
        pA.fromBufferAttribute(pos, corner(idx, t, 0)).applyMatrix4(mesh.matrixWorld);
        pB.fromBufferAttribute(pos, corner(idx, t, 1)).applyMatrix4(mesh.matrixWorld);
        pC.fromBufferAttribute(pos, corner(idx, t, 2)).applyMatrix4(mesh.matrixWorld);
        area += triangleArea3D(pA, pB, pC);
      }
      const uArr = new Float32Array(pos.count);
      const vArr = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        uArr[i] = clamp(uv.getX(i), 0, 1);
        vArr[i] = clamp(uv.getY(i), 0, 1);
      }
      push(mesh, part, tris, uArr, vArr, area, 1);
      continue;
    }

    const knots = part.sweep?.knots;
    if (owners && knots && knots.length > 1) {
      const { segs, total } = knotSegments(knots, mesh.matrixWorld);
      if (segs.length && total > 1e-5) {
        const vAlong = new Float32Array(pos.count);
        const vUp = new Float32Array(pos.count);
        const vSide = new Float32Array(pos.count);
        let maxR = 0.02;
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          let best = Infinity;
          let bAlong = 0;
          let bUp = 0;
          let bSide = 0;
          let bR = 0;
          for (let sIdx = 0; sIdx < segs.length; sIdx++) {
            const s = segs[sIdx];
            if (!s) continue;
            rel.subVectors(p, s.a);
            let proj = rel.dot(s.dir);
            if (sIdx > 0) proj = Math.max(0, proj);
            if (sIdx + 1 < segs.length) proj = Math.min(s.len, proj);
            const rx = rel.x - s.dir.x * proj;
            const ry = rel.y - s.dir.y * proj;
            const rz = rel.z - s.dir.z * proj;
            const distSq = rx * rx + ry * ry + rz * rz;
            if (distSq < best) {
              best = distSq;
              bAlong = s.start + proj;
              bUp = rx * s.up.x + ry * s.up.y + rz * s.up.z;
              bSide = rx * s.side.x + ry * s.side.y + rz * s.side.z;
              bR = Math.sqrt(distSq);
            }
          }
          vAlong[i] = bAlong;
          vUp[i] = bUp;
          vSide[i] = bSide;
          if (bR > maxR) maxR = bR;
        }
        const triChart = new Uint8Array(triCount);
        for (let t = 0; t < triCount; t++) {
          const side =
            (vSide[corner(idx, t, 0)] ?? 0) +
            (vSide[corner(idx, t, 1)] ?? 0) +
            (vSide[corner(idx, t, 2)] ?? 0);
          triChart[t] = side >= 0 ? 0 : 1;
        }
        const { buckets, srcOrder } = assignChartTriangles(scene, mesh, triChart, 2);
        const count = geo.getAttribute("position").count;
        const uArr = new Float32Array(count);
        const vArr = new Float32Array(count);
        const aspect = clamp(total / (Math.PI * maxR), 0.38, 2.6);
        for (let c = 0; c < 2; c++) {
          const tris = buckets[c] ?? [];
          if (!tris.length) continue;
          const sign = c === 0 ? 1 : -1;
          const area = chartArea(
            mesh,
            tris,
            (vi) => {
              const si = srcOrder ? (srcOrder[vi] ?? 0) : vi;
              let ang = Math.atan2((vSide[si] ?? 0) * sign, vUp[si] ?? 0);
              if (ang < -Math.PI * 0.5) ang += Math.PI * 2;
              return [vAlong[si] ?? 0, ang];
            },
            uArr,
            vArr,
            true,
          );
          push(mesh, part, Int32Array.from(tris), uArr, vArr, area, aspect);
        }
        continue;
      }
    }

    if (hand || shape === "box" || part.organ.extremity) {
      geo.computeBoundingBox();
      const box = geo.boundingBox;
      if (!box) continue;
      const bMin = box.min;
      const bSize = box.getSize(new T.Vector3());
      const sx = Math.max(1e-4, bSize.x);
      const sy = Math.max(1e-4, bSize.y);
      const sz = Math.max(1e-4, bSize.z);
      const flat = sy < Math.max(sx, sz) * 0.9;
      const triChart = new Uint8Array(triCount);
      for (let t = 0; t < triCount; t++) {
        pA.fromBufferAttribute(pos, corner(idx, t, 0));
        pB.fromBufferAttribute(pos, corner(idx, t, 1));
        pC.fromBufferAttribute(pos, corner(idx, t, 2));
        nTmp.crossVectors(pB.clone().sub(pA), pC.clone().sub(pA));
        const ax = Math.abs(nTmp.x);
        const ay = Math.abs(nTmp.y);
        const az = Math.abs(nTmp.z);
        if (flat) {
          if (ay >= ax * 0.65 && ay >= az * 0.65) triChart[t] = nTmp.y >= 0 ? 0 : 1;
          else triChart[t] = nTmp.x >= 0 ? 2 : 3;
        } else if (az >= ax * 0.75) triChart[t] = nTmp.z >= 0 ? 0 : 1;
        else triChart[t] = nTmp.x >= 0 ? 2 : 3;
      }
      const { buckets } = assignChartTriangles(scene, mesh, triChart, 4);
      const newPos = geo.getAttribute("position");
      const uArr = new Float32Array(newPos.count);
      const vArr = new Float32Array(newPos.count);
      for (let c = 0; c < 4; c++) {
        const tris = buckets[c] ?? [];
        if (!tris.length) continue;
        const area = chartArea(
          mesh,
          tris,
          (vi) => {
            const lx = (newPos.getX(vi) - bMin.x) / sx;
            const ly = (newPos.getY(vi) - bMin.y) / sy;
            const lz = (newPos.getZ(vi) - bMin.z) / sz;
            return c < 2 ? [lx, flat ? lz : ly] : [lz, ly];
          },
          uArr,
          vArr,
        );
        push(mesh, part, Int32Array.from(tris), uArr, vArr, area, 1);
      }
      continue;
    }

    geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) continue;
    const center = box.getCenter(new T.Vector3());
    const half = box.getSize(new T.Vector3()).multiplyScalar(0.5);
    const rx = Math.max(1e-4, half.x);
    const ry = Math.max(1e-4, half.y);
    const rz = Math.max(1e-4, half.z);
    const triChart = new Uint8Array(triCount);
    for (let t = 0; t < triCount; t++) {
      const i0 = corner(idx, t, 0);
      const i1 = corner(idx, t, 1);
      const i2 = corner(idx, t, 2);
      const cx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3 - center.x;
      triChart[t] = cx >= 0 ? 0 : 1;
    }
    const { buckets } = assignChartTriangles(scene, mesh, triChart, 2);
    const newPos = geo.getAttribute("position");
    const uArr = new Float32Array(newPos.count);
    const vArr = new Float32Array(newPos.count);
    const aspect = clamp(rz / ry, 0.55, 1.85);
    for (let c = 0; c < 2; c++) {
      const tris = buckets[c] ?? [];
      if (!tris.length) continue;
      const sign = c === 0 ? 1 : -1;
      const area = chartArea(
        mesh,
        tris,
        (vi) => {
          let dx = (newPos.getX(vi) - center.x) / rx;
          let dy = (newPos.getY(vi) - center.y) / ry;
          let dz = (newPos.getZ(vi) - center.z) / rz;
          const len = Math.hypot(dx, dy, dz) || 1;
          dx /= len;
          dy /= len;
          dz /= len;
          const k = Math.sqrt(2 / Math.max(0.08, 1 + sign * dx));
          return [sign * dz * k, dy * k];
        },
        uArr,
        vArr,
      );
      push(mesh, part, Int32Array.from(tris), uArr, vArr, area, aspect);
    }
  }
  return charts;
}

function packHideCharts(charts: Chart[], size = HIDE_SIZE): void {
  if (!charts.length) return;
  const totalW = charts.reduce((s, c) => s + c.weight, 0);
  const floorW = totalW * 0.0028;
  const items = charts
    .map((c) => ({ chart: c, w: Math.max(floorW, c.weight) }))
    .sort((a, b) => b.w - a.w);
  const split = (list: typeof items, rect: readonly [number, number, number, number]): void => {
    const head = list[0];
    if (!head) return;
    if (list.length === 1) {
      head.chart.rect = rect;
      return;
    }
    const sum = list.reduce((s, e) => s + e.w, 0);
    let acc = head.w;
    let k = 1;
    while (
      k < list.length - 1 &&
      Math.abs(acc + (list[k]?.w ?? 0) - sum * 0.5) < Math.abs(acc - sum * 0.5)
    )
      acc += list[k++]?.w ?? 0;
    const [x, y, w, h] = rect;
    const frac = clamp(acc / sum, 0.14, 0.86);
    if (w >= h) {
      const cut = Math.max(10, Math.min(w - 10, Math.round(w * frac)));
      split(list.slice(0, k), [x, y, cut, h]);
      split(list.slice(k), [x + cut, y, w - cut, h]);
    } else {
      const cut = Math.max(10, Math.min(h - 10, Math.round(h * frac)));
      split(list.slice(0, k), [x, y, w, cut]);
      split(list.slice(k), [x, y + cut, w, h - cut]);
    }
  };
  split(items, [0, 0, size, size]);
}

interface ReliefAxis {
  readonly start: T.Vector3;
  readonly dir: T.Vector3;
  readonly length: number;
  readonly cross: T.Vector3;
  readonly up: T.Vector3;
  readonly radius: number;
}

function reliefAxis(part: BuildPart, object: T.Object3D | undefined): ReliefAxis | undefined {
  const knots = part.sweep?.knots;
  const first = knots?.[0];
  const last = knots?.at(-1);
  if (!object || !knots || !first || !last || knots.length < 2 || part.organ.rank === "spine")
    return undefined;
  object.updateWorldMatrix(true, false);
  const start = new T.Vector3(first[0], first[1], first[2]).applyMatrix4(object.matrixWorld);
  const end = new T.Vector3(last[0], last[1], last[2]).applyMatrix4(object.matrixWorld);
  const dir = end.sub(start);
  const length = dir.length();
  if (length < 0.001) return undefined;
  dir.divideScalar(length);
  const cross = new T.Vector3(0, 1, 0).cross(dir);
  if (cross.lengthSq() < 0.001) cross.set(1, 0, 0).cross(dir);
  cross.normalize();
  const up = dir.clone().cross(cross);
  const radius = Math.max(0.01, ...knots.map((k) => Math.max(k[3], k[4])));
  return { start, dir, length, cross, up, radius };
}

interface Tones {
  readonly veryPale: boolean;
  readonly dr: number;
  readonly dg: number;
  readonly db: number;
  readonly mr: number;
  readonly mg: number;
  readonly mb: number;
}

interface Layer {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly face: FaceCoat | undefined;
  readonly flank: boolean;
  readonly part: BuildPart;
  readonly axis: ReliefAxis | undefined;
  readonly isTail: boolean;
  readonly isTentacle: boolean;
  readonly isMuzzle: boolean;
  readonly isExtremity: boolean;
  readonly isBirdLeg: boolean;
  readonly tones: Tones;
  readonly isHead: boolean;
  readonly isLimb: boolean;
  readonly under: MarkingSampler | undefined;
  readonly mark: MarkingSampler | undefined;
  readonly tint: LimbTint | undefined;
}

interface Evaluator {
  readonly skin: CreaturePlan["skin"];
  readonly bumpMetres: number;
  readonly isScales: boolean;
  readonly layers: ReadonlyMap<string, Layer>;
  evaluate(
    out: Float64Array,
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    layerA: Layer,
    layerB: Layer | undefined,
    wA: number,
  ): void;
}

interface SpineSegment {
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly len: number;
  readonly at: number;
}

const limbRoles: ReadonlySet<string> = new Set([
  "thigh",
  "shin",
  "foot",
  "upper arm",
  "forearm",
  "hand",
]);

function createHideEvaluator(
  scene: HideScene,
  limbTints: ReadonlyMap<string, LimbTint>,
): Evaluator {
  const { plan, parts, objectOf } = scene;
  const skin = plan.skin;
  const spine = spineOf(parts, objectOf);
  const segments: SpineSegment[] = [];
  let spineLen = 0.8;
  let spineRadius = 0.2;
  const spineKnots = spine?.part.sweep?.knots;
  const bodyObj = spine?.object;
  if (spineKnots && spineKnots.length > 1 && bodyObj) {
    bodyObj.updateWorldMatrix(true, false);
    const knots = spineKnots.map((k) => ({
      p: new T.Vector3(k[0], k[1], k[2]).applyMatrix4(bodyObj.matrixWorld),
      r: Math.max(k[3], k[4]),
    }));
    let lenAcc = 0;
    spineRadius = Math.max(0.05, ...knots.map((k) => k.r));
    for (let i = 1; i < knots.length; i++) {
      const a = knots[i - 1]?.p;
      const b = knots[i]?.p;
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-6) continue;
      segments.push({
        ax: a.x,
        ay: a.y,
        az: a.z,
        dx: dx / len,
        dy: dy / len,
        dz: dz / len,
        len,
        at: lenAcc,
      });
      lenAcc += len;
    }
    if (lenAcc > 1e-4) spineLen = lenAcc;
  }

  const eyes = parts.flatMap((part) => {
    if (!part.organ.eye) return [];
    const obj = objectOf(part.id);
    if (!obj) return [];
    const wp = obj.getWorldPosition(new T.Vector3());
    return [{ x: wp.x, y: wp.y, z: wp.z, r: Math.max(0.015, ...part.size) }];
  });

  const seedStr = `${skin.base}|${skin.accent}|${skin.pale}|${skin.markings?.seed ?? 0}`;
  let hideSeed = 0x51a7c3d1;
  for (let i = 0; i < seedStr.length; i++)
    hideSeed = Math.imul(hideSeed ^ seedStr.charCodeAt(i), 0x01000193) >>> 0;

  const baseCol = new T.Color(skin.base);
  const accentCol = new T.Color(skin.accent);
  const paleCol = new T.Color(skin.pale);
  const flank = flankPaint(skin.flankMarking, accentCol, paleCol, baseCol);
  const softPaleCol = paleCol.clone().lerp(baseCol, 0.16);
  const accentWashCol = baseCol.clone().lerp(accentCol, 0.54);
  const baseLuma = 0.2126 * baseCol.r + 0.7152 * baseCol.g + 0.0722 * baseCol.b;
  const markColor = skin.markings ? new T.Color(skin.markings.color) : undefined;
  const markLuma = markColor
    ? 0.2126 * markColor.r + 0.7152 * markColor.g + 0.0722 * markColor.b
    : baseLuma;
  const darkCountershade = skin.markings?.kind === "Countershade" && markLuma < baseLuma * 1.05;

  const toneCache = new Map<string, Tones>();
  const deriveTones = (hex: string): Tones => {
    const cached = toneCache.get(hex);
    if (cached) return cached;
    const c = new T.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    const veryPale = hsl.l > 0.66;
    const deep = new T.Color().setHSL(
      (hsl.h + (veryPale ? -0.022 : -0.028) + 1) % 1,
      clamp(hsl.s * 1.2 + (veryPale ? 0.18 : 0.08), 0.16, 0.88),
      clamp(hsl.l * (veryPale ? 0.6 : 0.48), 0.05, 0.52),
    );
    const mid = new T.Color().setHSL(
      (hsl.h + 0.018) % 1,
      clamp(hsl.s * 1.12 + (veryPale ? 0.12 : 0.04), 0.14, 0.85),
      clamp(hsl.l * (veryPale ? 0.76 : 0.7), 0.08, 0.68),
    );
    const sameAsSkin = hex.toLowerCase() === skin.base.toLowerCase();
    const wash = sameAsSkin ? accentWashCol : c.clone().lerp(mid, 0.45);
    const t: Tones = {
      veryPale,
      dr: deep.r,
      dg: deep.g,
      db: deep.b,
      mr: mid.r * 0.52 + wash.r * 0.48,
      mg: mid.g * 0.52 + wash.g * 0.48,
      mb: mid.b * 0.52 + wash.b * 0.48,
    };
    toneCache.set(hex, t);
    return t;
  };

  const pVis = patternVisibility(skin);
  const flatBoost = 1 - 0.72 * pVis;
  const scaleRef = clamp(spineLen, 0.55, 1.55);
  const profile = classifyCreatureRelief(plan);
  const coat = creatureCoatField(plan, parts, objectOf);
  const relief: ReliefContext = {
    profile,
    scaleRef,
    seed: hideSeed,
    px: 0,
    py: 0,
    pz: 0,
    tSpine: 0,
    sAlong: 0,
    uAcross: 0,
    flankNorm: 0,
    dorsal: 0,
    ventral: 0,
    dorsalCoord: 0,
    shoulder: 0,
    fbmMac: 0,
    nMac2: 0,
    markGuard: 0,
    mAlpha: 0,
    isHead: false,
    isMuzzle: false,
    isLimb: false,
    isTail: false,
    isTentacle: false,
    isBirdLeg: false,
    isExtremity: false,
    hasAxis: false,
    limbT: 0,
    limbAlong: 0,
    limbArc: 0,
    limbUp: 0,
    jointProx: 0,
  };
  const sample = new Float64Array(4);
  const cell = new Float64Array(5);
  const surfaceNormal = new T.Vector3();
  const hasBirdLeg = plan.limbs.some((limb) => limb.kind === "leg" && limb.style === "bird");

  const markCache = new Map<string, MarkingSampler>();
  const getMark = (m: FigureMarkings | undefined): MarkingSampler | undefined => {
    if (!m) return undefined;
    const key = `${m.kind}|${m.color}|${m.spacing}|${m.coverage}|${m.angle}|${m.seed}`;
    let fn = markCache.get(key);
    if (!fn) {
      fn = makeMarkingSampler(m);
      markCache.set(key, fn);
    }
    return fn;
  };
  const layers = new Map<string, Layer>();
  for (const part of parts) {
    const pc = new T.Color(part.color);
    const object = objectOf(part.id);
    const role = part.motion ?? "";
    layers.set(part.id, {
      r: pc.r,
      g: pc.g,
      b: pc.b,
      face: faceCoat(part, object, plan),
      flank: part.organ.rank === "spine" && part.color.toLowerCase() === skin.base.toLowerCase(),
      part,
      axis: reliefAxis(part, object),
      isTail: Boolean(part.organ.tail),
      isTentacle: Boolean(part.organ.tentacle),
      isMuzzle: Boolean(part.organ.snout),
      isExtremity: role === "hand" || role === "foot",
      isBirdLeg: hasBirdLeg && Boolean(part.organ.leg),
      tones: deriveTones(part.color),
      isHead: role === "head" || Boolean(part.organ.head),
      isLimb: limbRoles.has(role),
      under: getMark(part.undercoat),
      mark: getMark(part.markings),
      tint: limbTints.get(part.id),
    });
  }

  const scratchColor = new T.Color();
  const scratchVec = new T.Vector3();
  const wBuf = new Float64Array(3);
  const baseOutA = new Float64Array(4);
  const baseOutB = new Float64Array(4);

  const evalLayer = (
    dst: Float64Array,
    layer: Layer,
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
  ): void => {
    let r = layer.r;
    let g = layer.g;
    let b = layer.b;
    if (layer.under) {
      const u = layer.under.sample(px, py, pz, nx, ny, nz, true);
      r += (layer.under.r - r) * u;
      g += (layer.under.g - g) * u;
      b += (layer.under.b - b) * u;
    }
    if (coat && layer.part.coatZone) {
      scratchColor.setRGB(r, g, b);
      coat.sample(
        scratchColor,
        scratchColor,
        scratchVec.set(px, py, pz),
        surfaceNormal.set(nx, ny, nz),
        layer.part,
      );
      r = scratchColor.r;
      g = scratchColor.g;
      b = scratchColor.b;
    }
    if (layer.tint) {
      scratchColor.setRGB(r, g, b);
      scratchVec.set(px, py, pz);
      layer.tint(scratchColor, scratchVec);
      r = scratchColor.r;
      g = scratchColor.g;
      b = scratchColor.b;
    }
    let mAlpha = 0;
    if (layer.mark) {
      mAlpha = layer.mark.sample(px, py, pz, nx, ny, nz, true);
      r += (layer.mark.r - r) * mAlpha;
      g += (layer.mark.g - g) * mAlpha;
      b += (layer.mark.b - b) * mAlpha;
    }
    dst[0] = r;
    dst[1] = g;
    dst[2] = b;
    dst[3] = mAlpha;
  };

  const evaluate: Evaluator["evaluate"] = (out, px, py, pz, nx, ny, nz, layerA, layerB, wA) => {
    evalLayer(baseOutA, layerA, px, py, pz, nx, ny, nz);
    let r = slot(baseOutA, 0);
    let g = slot(baseOutA, 1);
    let b = slot(baseOutA, 2);
    let mAlpha = slot(baseOutA, 3);
    if (layerB && wA < 0.999) {
      evalLayer(baseOutB, layerB, px, py, pz, nx, ny, nz);
      const wB = 1 - wA;
      r = r * wA + slot(baseOutB, 0) * wB;
      g = g * wA + slot(baseOutB, 1) * wB;
      b = b * wA + slot(baseOutB, 2) * wB;
      mAlpha = mAlpha * wA + slot(baseOutB, 3) * wB;
    }

    let tSpine = 0.5;
    let vertical = 0;
    let upAlign = ny;
    if (segments.length) {
      let near = Infinity;
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (!s) continue;
        const rx = px - s.ax;
        const ry = py - s.ay;
        const rz = pz - s.az;
        let travel = rx * s.dx + ry * s.dy + rz * s.dz;
        if (i > 0 && travel < 0) travel = 0;
        if (i + 1 < segments.length && travel > s.len) travel = s.len;
        const dy = py - (s.ay + s.dy * travel);
        const dz = pz - (s.az + s.dz * travel);
        const q = dy * dy + dz * dz;
        if (q < near) {
          near = q;
          tSpine = (s.at + travel) / spineLen;
          vertical = (dy * s.dz - dz * s.dy) / spineRadius;
          upAlign = ny * s.dz - nz * s.dy;
        }
      }
    }

    const mf = 2.6 / scaleRef;
    const nMac1 = noise3(px * mf, py * mf, pz * mf, hideSeed ^ 0x19a3);
    const nMac2 = noise3(px * mf * 2.1, py * mf * 2.1, pz * mf * 2.1, hideSeed ^ 0x62b1);
    const fbmMac = 0.68 * nMac1 + 0.32 * nMac2 - 0.5;

    const upMix = layerA.isHead
      ? ny * 0.78 + clamp(vertical, -1, 1) * 0.22
      : upAlign * 0.54 + clamp(vertical, -1.2, 1.2) * 0.46;
    const dorsalCoord = upMix + fbmMac * 0.26;
    const dorsal = smoothstep(dorsalCoord, 0.08, 0.76);
    const ventral = smoothstep(-dorsalCoord, 0.22, 0.82);
    const shoulder = smoothstep(tSpine, 0.44, 0.72) * (1 - smoothstep(tSpine, 1.08, 1.48));

    const markGuard = layerA.mark?.kind === "Countershade" ? 1 - 0.35 * mAlpha : 1 - 0.58 * mAlpha;

    const tones = layerA.tones;
    const dorsalStrength = (0.14 + 0.4 * flatBoost) * markGuard;
    const dMix = dorsal * dorsalStrength * (0.86 + 0.22 * shoulder);
    r += (tones.dr - r) * dMix;
    g += (tones.dg - g) * dMix;
    b += (tones.db - b) * dMix;

    if (darkCountershade && !layerA.under && skin.belly > 0.04) {
      const vLift = ventral * 0.28 * skin.belly;
      r += (softPaleCol.r - r) * vLift;
      g += (softPaleCol.g - g) * vLift;
      b += (softPaleCol.b - b) * vLift;
    }

    if (flatBoost > 0.42 && !layerA.isLimb) {
      const fb = clamp((flatBoost - 0.42) / 0.58, 0, 1);
      const flankBand =
        smoothstep(dorsalCoord, -0.26, 0.22) * (1 - smoothstep(dorsalCoord, 0.48, 0.92));
      const df = 5.6 / scaleRef;
      const dNoise =
        0.64 * noise3(px * df + fbmMac * 1.1, py * df, pz * df, hideSeed ^ 0x83d9) +
        0.36 * noise3(px * df * 1.95, py * df * 1.95, pz * df * 1.95, hideSeed ^ 0x2c47);
      const dapple = smoothstep(dNoise, 0.44, 0.65) * flankBand * fb * markGuard;
      const ff = 9.5 / scaleRef;
      worley3(wBuf, px * ff + fbmMac * 0.8, py * ff, pz * ff, hideSeed ^ 0x55a9);
      const fleck =
        (1 - smoothstep(slot(wBuf, 0), 0.22, 0.36)) *
        flankBand *
        smoothstep(nMac1, 0.36, 0.62) *
        fb *
        markGuard;
      const wMix = dapple * (0.36 + 0.18 * shoulder);
      r += (tones.mr - r) * wMix;
      g += (tones.mg - g) * wMix;
      b += (tones.mb - b) * wMix;
      const fMix = fleck * (tones.veryPale ? 0.46 : 0.34);
      r += (tones.dr - r) * fMix;
      g += (tones.dg - g) * fMix;
      b += (tones.db - b) * fMix;
    }

    for (const eye of eyes) {
      const dx = px - eye.x;
      const dy = (py - eye.y) * 1.25;
      const dz = (pz - eye.z) * 0.85;
      const q = Math.sqrt(dx * dx + dy * dy + dz * dz) / eye.r;
      if (q < 2.2) {
        const ring = (1 - smoothstep(q, 0.95, 1.55)) * (0.18 + 0.1 * flatBoost) * markGuard;
        r += (tones.dr - r) * ring;
        g += (tones.dg - g) * ring;
        b += (tones.db - b) * ring;
        const halo =
          smoothstep(q, 1.22, 1.65) *
          (1 - smoothstep(q, 1.65, 2.2)) *
          0.08 *
          (0.5 + 0.5 * flatBoost);
        r += (softPaleCol.r - r) * halo;
        g += (softPaleCol.g - g) * halo;
        b += (softPaleCol.b - b) * halo;
      }
    }

    const layer = layerB && wA < 0.5 ? layerB : layerA;
    relief.px = px;
    relief.py = py;
    relief.pz = pz;
    relief.tSpine = tSpine;
    relief.sAlong = tSpine * spineLen;
    relief.uAcross = Math.atan2(px, vertical * spineRadius) * spineRadius;
    relief.flankNorm = Math.abs(px) / spineRadius;
    relief.dorsal = dorsal;
    relief.ventral = ventral;
    relief.dorsalCoord = dorsalCoord;
    relief.shoulder = shoulder;
    relief.fbmMac = fbmMac;
    relief.nMac2 = nMac2;
    relief.markGuard = markGuard;
    relief.mAlpha = mAlpha;
    relief.isHead = layer.isHead;
    relief.isLimb = layer.isLimb;
    relief.isTail = layer.isTail;
    relief.isMuzzle = layer.isMuzzle;
    relief.isTentacle = layer.isTentacle;
    relief.isBirdLeg = layer.isBirdLeg;
    relief.isExtremity = layer.isExtremity;
    const axis = layer.axis;
    relief.hasAxis = Boolean(axis);
    relief.limbT = 0;
    relief.limbAlong = 0;
    relief.limbArc = 0;
    relief.jointProx = 0;
    relief.limbUp = ny;
    if (axis) {
      scratchVec.set(px, py, pz).sub(axis.start);
      relief.limbAlong = scratchVec.dot(axis.dir);
      relief.limbT = clamp(relief.limbAlong / axis.length, 0, 1);
      relief.limbArc =
        Math.atan2(scratchVec.dot(axis.cross), scratchVec.dot(axis.up)) * axis.radius;
      relief.limbUp = nx * axis.up.x + ny * axis.up.y + nz * axis.up.z;
      relief.jointProx = 1 - Math.min(1, 6 * Math.min(relief.limbT, 1 - relief.limbT));
    }
    evaluateBiologicalRelief(sample, relief, cell, wBuf);
    if (flank && (layerA.flank || layerB?.flank)) {
      const coverage = layerB ? Number(layerA.flank) * wA + Number(layerB.flank) * (1 - wA) : 1;
      scratchColor.setRGB(r, g, b);
      flank(scratchColor, tSpine, dorsalCoord, fbmMac, coverage);
      r = scratchColor.r;
      g = scratchColor.g;
      b = scratchColor.b;
    }
    if (layerA.face || layerB?.face) {
      scratchColor.setRGB(r, g, b);
      layerA.face?.world(scratchColor, px, py, pz, layerB ? wA : 1);
      layerB?.face?.world(scratchColor, px, py, pz, 1 - wA);
      r = scratchColor.r;
      g = scratchColor.g;
      b = scratchColor.b;
    }
    const shade = slot(sample, 2);
    const lift = slot(sample, 3);
    out[0] = clamp(r * shade + (softPaleCol.r - r) * lift, 0, 1);
    out[1] = clamp(g * shade + (softPaleCol.g - g) * lift, 0, 1);
    out[2] = clamp(b * shade + (softPaleCol.b - b) * lift, 0, 1);
    out[3] = slot(sample, 0);
    out[4] = slot(sample, 1);
  };

  return {
    skin,
    bumpMetres: profile.bumpMetres * scaleRef,
    isScales: skin.surface === "scales",
    layers,
    evaluate,
  };
}

function owned(array: Uint8Array | Float32Array, i: number): number {
  const value = array[i];
  if (value === undefined) throw new Error("A charted hide vertex has no blend owner.");
  return value;
}

function layerAt(layers: ReadonlyArray<Layer | undefined>, i: number): Layer {
  const layer = layers[i];
  if (!layer) throw new Error("A joined hide vertex has an owner without a layer.");
  return layer;
}

function rasterizeHideAtlas(
  scene: HideScene,
  charts: ReadonlyArray<Chart>,
  evaluator: Evaluator,
  size = HIDE_SIZE,
): {
  readonly albedo: Uint8ClampedArray;
  readonly roughData: Uint8ClampedArray;
  readonly normalData: Uint8ClampedArray;
} {
  const count = size * size;
  const albedo = new Uint8ClampedArray(count * 4);
  const roughData = new Uint8ClampedArray(count * 4);
  const heightBuf = new Float32Array(count).fill(0.5);
  const mppBuf = new Float32Array(count).fill(0.002);
  const filled = new Uint8Array(count);

  const bgCol = new T.Color(evaluator.skin.base);
  const bgR = toSrgbByte(bgCol.r);
  const bgG = toSrgbByte(bgCol.g);
  const bgB = toSrgbByte(bgCol.b);
  const bgRough = Math.round(255 * (evaluator.isScales ? 0.68 : 0.72));
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    albedo[o] = bgR;
    albedo[o + 1] = bgG;
    albedo[o + 2] = bgB;
    albedo[o + 3] = 255;
    roughData[o] = 255;
    roughData[o + 1] = bgRough;
    roughData[o + 2] = 0;
    roughData[o + 3] = 255;
  }

  const evalOut = new Float64Array(5);
  const p0 = new T.Vector3();
  const p1 = new T.Vector3();
  const p2 = new T.Vector3();
  const n0 = new T.Vector3();
  const n1 = new T.Vector3();
  const n2 = new T.Vector3();
  const nm = new T.Matrix3();

  const meshUvs = new Map<T.Mesh, Float32Array>();
  for (const ch of charts)
    if (!meshUvs.has(ch.mesh))
      meshUvs.set(ch.mesh, new Float32Array(ch.mesh.geometry.getAttribute("position").count * 2));

  for (const ch of charts) {
    const { mesh, part, tris, u: locU, v: locV, rect } = ch;
    const [rx, ry, rw, rh] = rect;
    const pad = Math.min(CHART_MARGIN, Math.floor((Math.min(rw, rh) - 2) / 3));
    const ix = rx + pad;
    const iy = ry + pad;
    const iw = Math.max(2, rw - 2 * pad);
    const ih = Math.max(2, rh - 2 * pad);
    const geo = mesh.geometry;
    const pos = geo.getAttribute("position");
    const norm = geo.getAttribute("normal");
    const idx = geo.index;
    const finalUv = meshUvs.get(mesh);
    if (!finalUv) continue;
    nm.getNormalMatrix(mesh.matrixWorld);
    const owners = scene.owners(mesh);
    const ownerLayers = owners?.ids.map(
      (id) => evaluator.layers.get(id) ?? evaluator.layers.get(part.id),
    );
    const selfLayer = evaluator.layers.get(part.id);
    if (!selfLayer) continue;

    for (let ti = 0; ti < tris.length; ti++) {
      const t = tris[ti] ?? 0;
      const i0 = corner(idx, t, 0);
      const i1 = corner(idx, t, 1);
      const i2 = corner(idx, t, 2);
      const x0 = ix + (locU[i0] ?? 0) * (iw - 1);
      const y0 = iy + (1 - (locV[i0] ?? 0)) * (ih - 1);
      const x1 = ix + (locU[i1] ?? 0) * (iw - 1);
      const y1 = iy + (1 - (locV[i1] ?? 0)) * (ih - 1);
      const x2 = ix + (locU[i2] ?? 0) * (iw - 1);
      const y2 = iy + (1 - (locV[i2] ?? 0)) * (ih - 1);
      finalUv[2 * i0] = (x0 + 0.5) / size;
      finalUv[2 * i0 + 1] = 1 - (y0 + 0.5) / size;
      finalUv[2 * i1] = (x1 + 0.5) / size;
      finalUv[2 * i1 + 1] = 1 - (y1 + 0.5) / size;
      finalUv[2 * i2] = (x2 + 0.5) / size;
      finalUv[2 * i2 + 1] = 1 - (y2 + 0.5) / size;
      p0.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      p1.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      p2.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      n0.fromBufferAttribute(norm, i0).applyNormalMatrix(nm).normalize();
      n1.fromBufferAttribute(norm, i1).applyNormalMatrix(nm).normalize();
      n2.fromBufferAttribute(norm, i2).applyNormalMatrix(nm).normalize();

      const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(det) < 1e-6) continue;
      const invDet = 1 / det;
      const area3d = triangleArea3D(p0, p1, p2);
      const areaPx = 0.5 * Math.abs(det);
      const mpp = clamp(Math.sqrt(area3d / Math.max(0.25, areaPx)), 0.0004, 0.025);
      const minX = Math.max(ix, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(ix + iw - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(iy, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(iy + ih - 1, Math.ceil(Math.max(y0, y1, y2)));

      let lA = selfLayer;
      let sameOwner = true;
      let w0a = 1;
      let w1a = 1;
      let w2a = 1;
      if (owners && ownerLayers) {
        const o0a = owned(owners.first, i0);
        const o1a = owned(owners.first, i1);
        const o2a = owned(owners.first, i2);
        w0a = owned(owners.weight, i0);
        w1a = owned(owners.weight, i1);
        w2a = owned(owners.weight, i2);
        if (o0a === o1a && o1a === o2a && w0a > 0.99 && w1a > 0.99 && w2a > 0.99)
          lA = layerAt(ownerLayers, o0a);
        else sameOwner = false;
      }

      for (let py = minY; py <= maxY; py++) {
        const dy = py - y0;
        const row = py * size;
        for (let px = minX; px <= maxX; px++) {
          const dx = px - x0;
          const b1 = (dx * (y2 - y0) - dy * (x2 - x0)) * invDet;
          const b2 = ((x1 - x0) * dy - (y1 - y0) * dx) * invDet;
          const b0 = 1 - b1 - b2;
          if (b0 < -0.015 || b1 < -0.015 || b2 < -0.015) continue;
          const c0 = b0 < 0 ? 0 : b0;
          const c1 = b1 < 0 ? 0 : b1;
          const c2 = b2 < 0 ? 0 : b2;
          const cs = c0 + c1 + c2 || 1;
          const k0 = c0 / cs;
          const k1 = c1 / cs;
          const k2 = c2 / cs;
          const wx = p0.x * k0 + p1.x * k1 + p2.x * k2;
          const wy = p0.y * k0 + p1.y * k1 + p2.y * k2;
          const wz = p0.z * k0 + p1.z * k1 + p2.z * k2;
          let wnx = n0.x * k0 + n1.x * k1 + n2.x * k2;
          let wny = n0.y * k0 + n1.y * k1 + n2.y * k2;
          let wnz = n0.z * k0 + n1.z * k1 + n2.z * k2;
          const nLen = Math.hypot(wnx, wny, wnz) || 1;
          wnx /= nLen;
          wny /= nLen;
          wnz /= nLen;
          let layerA = lA;
          let layerB: Layer | undefined;
          let wA = 1;
          if (!sameOwner && owners && ownerLayers) {
            const dom = k0 >= k1 && k0 >= k2 ? i0 : k1 >= k2 ? i1 : i2;
            const firstOwner = owned(owners.first, dom);
            layerA = layerAt(ownerLayers, firstOwner);
            const sec = owned(owners.second, dom);
            if (sec !== firstOwner) {
              layerB = layerAt(ownerLayers, sec);
              wA = clamp(w0a * k0 + w1a * k1 + w2a * k2, 0, 1);
            }
          }
          evaluator.evaluate(evalOut, wx, wy, wz, wnx, wny, wnz, layerA, layerB, wA);
          const idxPix = row + px;
          const off = idxPix * 4;
          albedo[off] = toSrgbByte(slot(evalOut, 0));
          albedo[off + 1] = toSrgbByte(slot(evalOut, 1));
          albedo[off + 2] = toSrgbByte(slot(evalOut, 2));
          albedo[off + 3] = 255;
          heightBuf[idxPix] = slot(evalOut, 3);
          roughData[off + 1] = Math.round(255 * slot(evalOut, 4));
          mppBuf[idxPix] = mpp;
          filled[idxPix] = 1;
        }
      }
    }
  }

  for (const [mesh, uvs] of meshUvs)
    mesh.geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));

  const nextFilled = new Uint8Array(filled);
  const at = (a: ArrayLike<number>, i: number): number => a[i] ?? 0;
  for (let pass = 0; pass < 6; pass++) {
    let any = false;
    for (let y = 0; y < size; y++) {
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const i = row + x;
        if (filled[i]) continue;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let hSum = 0;
        let rgSum = 0;
        let mSum = 0;
        let cnt = 0;
        const take = (j: number): void => {
          const o = j * 4;
          rSum += at(albedo, o);
          gSum += at(albedo, o + 1);
          bSum += at(albedo, o + 2);
          hSum += at(heightBuf, j);
          rgSum += at(roughData, o + 1);
          mSum += at(mppBuf, j);
          cnt++;
        };
        if (x > 0 && filled[i - 1]) take(i - 1);
        if (x + 1 < size && filled[i + 1]) take(i + 1);
        if (y > 0 && filled[i - size]) take(i - size);
        if (y + 1 < size && filled[i + size]) take(i + size);
        if (cnt) {
          const o = i * 4;
          albedo[o] = Math.round(rSum / cnt);
          albedo[o + 1] = Math.round(gSum / cnt);
          albedo[o + 2] = Math.round(bSum / cnt);
          heightBuf[i] = hSum / cnt;
          roughData[o + 1] = Math.round(rgSum / cnt);
          mppBuf[i] = mSum / cnt;
          nextFilled[i] = 1;
          any = true;
        }
      }
    }
    filled.set(nextFilled);
    if (!any) break;
  }

  const normalData = new Uint8ClampedArray(count * 4);
  const bumpMetres = evaluator.bumpMetres;
  for (let y = 0; y < size; y++) {
    const top = y > 0 ? y - 1 : 0;
    const bot = y + 1 < size ? y + 1 : size - 1;
    const dySpan = Math.max(1, bot - top);
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const left = x > 0 ? x - 1 : 0;
      const right = x + 1 < size ? x + 1 : size - 1;
      const dxSpan = Math.max(1, right - left);
      const i = row + x;
      const o = i * 4;
      if (!filled[i]) {
        normalData[o] = 128;
        normalData[o + 1] = 128;
        normalData[o + 2] = 255;
        normalData[o + 3] = 255;
        continue;
      }
      const slopeGain = bumpMetres / Math.max(0.0005, at(mppBuf, i));
      const nx = (slopeGain * (at(heightBuf, row + left) - at(heightBuf, row + right))) / dxSpan;
      const ny =
        (slopeGain * (at(heightBuf, bot * size + x) - at(heightBuf, top * size + x))) / dySpan;
      const len = Math.hypot(nx, ny, 1);
      normalData[o] = Math.round(127.5 + (127.5 * nx) / len);
      normalData[o + 1] = Math.round(127.5 + (127.5 * ny) / len);
      normalData[o + 2] = Math.round(127.5 + 127.5 / len);
      normalData[o + 3] = 255;
    }
  }
  return { albedo, roughData, normalData };
}

function canvasFromPixels(
  raster: Raster,
  data: Uint8ClampedArray,
  size: number,
): HTMLCanvasElement {
  const c = raster.canvas(size, size);
  const ctx = context2d(c);
  const img = ctx.createImageData(size, size);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  return c;
}

export function bakeCreatureHide(
  scene: HideScene,
  limbTints: ReadonlyMap<string, LimbTint>,
  textures: T.Texture[],
): Set<string> {
  const handled = new Set<string>();
  const { plan } = scene;
  const skin = plan.skin;
  if (skin.coat && !skin.coat.graded && !skin.flankMarking && plan.anatomyRevision !== 2)
    return handled;
  const entries: Array<{ readonly part: BuildPart; readonly mesh: T.Mesh }> = [];
  for (const part of scene.parts) {
    const object = scene.objectOf(part.id);
    if (!object || !isMesh(object) || !object.visible) continue;
    if (!scene.skinShows(part)) continue;
    if (!isCreatureHidePart(part, skin)) continue;
    entries.push({ part, mesh: object });
  }
  if (!entries.length) return handled;
  const charts = buildHideCharts(scene, entries);
  if (!charts.length) return handled;
  packHideCharts(charts, HIDE_SIZE);
  const evaluator = createHideEvaluator(scene, limbTints);
  const { albedo, roughData, normalData } = rasterizeHideAtlas(scene, charts, evaluator, HIDE_SIZE);
  const map = new T.CanvasTexture(canvasFromPixels(scene.raster, albedo, HIDE_SIZE));
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  const normalMap = new T.CanvasTexture(canvasFromPixels(scene.raster, normalData, HIDE_SIZE));
  normalMap.anisotropy = 4;
  const roughnessMap = new T.CanvasTexture(canvasFromPixels(scene.raster, roughData, HIDE_SIZE));
  roughnessMap.anisotropy = 4;
  textures.push(map, normalMap, roughnessMap);
  const hideMaterial = new T.MeshStandardMaterial({
    color: 0xffffff,
    map,
    normalMap,
    roughnessMap,
    roughness: 1,
    metalness: 0,
  });
  hideMaterial.name = "Creature hide";
  hideMaterial.userData["creatureHide"] = true;
  hideMaterial.userData["ownedHideTextures"] = true;
  for (const { part, mesh } of entries) {
    mesh.geometry.deleteAttribute("color");
    mesh.material = hideMaterial;
    handled.add(part.id);
  }
  return handled;
}
