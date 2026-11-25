import {
  BufferAttribute,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  MathUtils,
  Matrix3,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";

import { classifyCreatureRelief, evaluateBiologicalRelief } from "./creature-relief.js";
import { flankPaint } from "./creature-flank-markings.js";
import { faceCoat } from "./creature-face-coat.js";
import { creatureCoatField } from "./creature-coat.js";

const { clamp, smoothstep } = MathUtils;
const HIDE_SIZE = 1024;
const CHART_MARGIN = 4;

// Fast exact linear [0..1] -> sRGB [0..255] lookup table.
const LIN_TO_SRGB = Uint8Array.from({ length: 4096 }, (_, i) => {
  const x = i / 4095;
  const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(s * 255)));
});

const toSrgbByte = (v) =>
  LIN_TO_SRGB[v <= 0 ? 0 : v >= 1 ? 4095 : (v * 4095 + 0.5) | 0];

function hash3(x, y, z, seed) {
  let h =
    Math.imul(x | 0, 73856093) ^
    Math.imul(y | 0, 19349663) ^
    Math.imul(z | 0, 83492791) ^
    (seed | 0);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth 3D value noise in [0, 1], zero allocations.
function noise3(x, y, z, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

// 3D Worley cellular distances (f1, f2) into a 2-element scratch array.
function worley3(out, x, y, z, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  let d1 = 1e9,
    d2 = 1e9,
    cellId = 0;
  for (let dz = -1; dz <= 1; dz++) {
    const cz = iz + dz;
    for (let dy = -1; dy <= 1; dy++) {
      const cy = iy + dy;
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const jx = cx + 0.16 + 0.68 * hash3(cx, cy, cz, seed) - x;
        const jy = cy + 0.16 + 0.68 * hash3(cx, cy, cz, seed ^ 1543) - y;
        const jz = cz + 0.16 + 0.68 * hash3(cx, cy, cz, seed ^ 9377) - z;
        const q = jx * jx + jy * jy + jz * jz;
        if (q < d1) {
          d2 = d1;
          d1 = q;
          cellId = hash3(cx, cy, cz, seed ^ 31337);
        } else if (q < d2) {
          d2 = q;
        }
      }
    }
  }
  out[0] = Math.sqrt(d1);
  out[1] = Math.sqrt(d2);
  out[2] = cellId;
}

const HIDE_SHAPES = new Set([
  "sweep",
  "ellipsoid",
  "cage",
  "hand",
  "box",
  "cone",
  "cylinder",
]);
const CORE_HIDE_ID = /^(?:body|head|neck|muzzle|jaw|tail|shoulders|pelvis)(?: \d+)?$/;

export function isCreatureHidePart(part, skin) {
  if (!part || !skin) return false;
  if (part.paint || part.hull || part.fibres || part.wearFit || part.drape)
    return false;
  if (!HIDE_SHAPES.has(part.shape)) return false;
  if (part.surface !== skin.surface) return false;
  if (part.id.startsWith("dress ") || part.id.startsWith("gear ")) return false;
  return Boolean(
    part.blendSkin ||
      part.markings ||
      part.undercoat ||
      part.coatZone ||
      CORE_HIDE_ID.test(part.id),
  );
}

// Perceptual visibility [0..1] of a creature's authored marking pattern.
// Returns 0 for unpatterned skin, ~0.14 for Countershade-only, and scales with
// perceptual sRGB luminance + chroma contrast for patterned kinds.
export function patternVisibility(skin) {
  const m = skin?.markings;
  if (!m) return 0;
  if (m.kind === "Countershade") return 0.14;
  const a = new Color(skin.base),
    b = new Color(m.color);
  const ar = toSrgbByte(a.r) / 255,
    ag = toSrgbByte(a.g) / 255,
    ab = toSrgbByte(a.b) / 255;
  const br = toSrgbByte(b.r) / 255,
    bg = toSrgbByte(b.g) / 255,
    bb = toSrgbByte(b.b) / 255;
  const dr = ar - br,
    dg = ag - bg,
    db = ab - bb;
  const dist = Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
  // Very light-on-light markings (e.g. #f0eee6 on #d4c3a6) read softer in bright lit scenes.
  const avgL = 0.5 * (0.299 * (ar + br) + 0.587 * (ag + bg) + 0.114 * (ab + bb));
  const brightPenalty = avgL > 0.72 ? 1 - 0.38 * clamp((avgL - 0.72) / 0.22, 0, 1) : 1;
  return clamp((dist * brightPenalty) / 0.28, 0, 1);
}

function makeMarkingSampler(m) {
  if (!m) return null;
  const phase = hash3(1, 2, 3, m.seed) * 6.2831853;
  const angle = (m.angle * Math.PI) / 180;
  const sin = Math.sin(angle),
    cos = Math.cos(angle);
  const invS = 1 / m.spacing;
  const kind = m.kind;
  const cov = m.coverage;
  const seed = m.seed;
  const col = new Color(m.color);
  const rC = col.r,
    gC = col.g,
    bC = col.b;
  const wBuf = new Float64Array(3);

  function sample(px, py, pz, nx, ny, nz, organicWarp) {
    let x = px * invS;
    let y = (py * cos - pz * sin) * invS;
    let z = (pz * cos + py * sin) * invS;

    if (kind === "Countershade") {
      const nWarp = organicWarp
        ? (noise3(x * 1.4, y * 1.4, z * 1.4, seed ^ 0x41a7) - 0.5) * 0.1
        : 0;
      const underside =
        -(ny * cos - nz * sin) +
        0.07 * Math.sin(phase + 2 * z + 0.3 * x) +
        nWarp;
      const lo = 0.66 - 1.6 * cov;
      const hi = 1.22 - 1.6 * cov;
      return smoothstep(underside, lo, hi);
    }

    // Subtle organic 3D domain warp gives hand-painted biological curves
    // without moving spot centres or introducing high-frequency noise.
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
    const r = wBuf[0];
    if (kind === "Reticulated") {
      const gap = wBuf[1] - r;
      const width = 0.018 + 0.4 * cov;
      return 1 - smoothstep(gap, width * 0.72, width * 1.24);
    }
    const outer = 0.26 + 0.48 * cov;
    const spot = 1 - smoothstep(r, outer - 0.055, outer + 0.042);
    if (kind === "Spots") return spot;
    return spot * smoothstep(r, outer * 0.52 - 0.035, outer * 0.62);
  }

  return { kind, r: rC, g: gC, b: bC, sample };
}

function heroWeight(partId) {
  if (/^head(?: \d+)?$/.test(partId)) return 3.4;
  if (/^(?:neck|muzzle|jaw)(?: \d+)?$/.test(partId)) return 2.25;
  if (partId === "body") return 1.4;
  if (/^(?:tail|shoulders|pelvis)$/.test(partId) || /(?:haunch|thigh|upper)$/.test(partId))
    return 0.92;
  return 0.68;
}

// Build parallel-transported polyline segments for a sweep's knots in world space.
function knotSegments(part, matrixWorld) {
  const pts = part.knots.map((k) =>
    new Vector3(k[0], k[1], k[2]).applyMatrix4(matrixWorld),
  );
  const segs = [];
  let total = 0;
  let prevUp = null;
  for (let i = 1; i < pts.length; i++) {
    const dir = pts[i].clone().sub(pts[i - 1]);
    const len = dir.length();
    if (len < 1e-6) continue;
    dir.divideScalar(len);
    let up;
    if (!prevUp) {
      up = Math.abs(dir.y) < 0.85 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    } else {
      up = prevUp.clone();
    }
    up.addScaledVector(dir, -up.dot(dir));
    if (up.lengthSq() < 1e-6) {
      up.set(1, 0, 0).addScaledVector(dir, -dir.x);
    }
    up.normalize();
    const side = new Vector3().crossVectors(dir, up).normalize();
    prevUp = up;
    segs.push({ a: pts[i - 1], dir, up, side, len, start: total });
    total += len;
  }
  return { segs, total };
}

// Split an indexed geometry so vertices belonging to multiple charts are duplicated
// cleanly along chart boundaries. If mesh.handRig is present, clone and remap its
// per-digit vertex indices so finger skinning stays exact on every seam vertex.
function assignChartTriangles(mesh, triChartIds, numCharts) {
  const geometry = mesh.geometry;
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const triCount = (idx ? idx.count : pos.count) / 3;
  if (!idx) {
    const buckets = Array.from({ length: numCharts }, () => []);
    for (let t = 0; t < triCount; t++) buckets[triChartIds[t]].push(t);
    return { geometry, buckets, srcOrder: null, isIndexed: false };
  }

  // Remap (oldVertex, chartId) -> newVertex so vertices inside a chart stay shared.
  const map = new Map();
  const srcOrder = [];
  const newIndices = new Uint32Array(idx.count);
  const buckets = Array.from({ length: numCharts }, () => []);
  const oldIdx = idx.array;
  for (let t = 0; t < triCount; t++) {
    const cid = triChartIds[t];
    buckets[cid].push(t);
    for (let k = 0; k < 3; k++) {
      const ov = oldIdx[3 * t + k];
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
      const out = new attr.array.constructor(srcOrder.length * attr.itemSize);
      const sz = attr.itemSize;
      for (let i = 0; i < srcOrder.length; i++) {
        const s = srcOrder[i] * sz;
        const d = i * sz;
        for (let j = 0; j < sz; j++) out[d + j] = attr.array[s + j];
      }
      geometry.setAttribute(name, new BufferAttribute(out, sz, attr.normalized));
    }
    geometry.setIndex(new BufferAttribute(newIndices, 1));
    if (mesh.handRig) {
      const oldToNew = Array.from({ length: pos.count }, () => []);
      for (let nv = 0; nv < srcOrder.length; nv++) oldToNew[srcOrder[nv]].push(nv);
      mesh.handRig = mesh.handRig.map((digit) => {
        const vertices = [];
        const parameters = [];
        for (let i = 0; i < digit.vertices.length; i++) {
          const targets = oldToNew[digit.vertices[i]];
          const param = digit.parameters[i];
          if (!targets) continue;
          for (let j = 0; j < targets.length; j++) {
            vertices.push(targets[j]);
            parameters.push(param);
          }
        }
        return { ...digit, vertices, parameters };
      });
    }
  }
  return { geometry, buckets, srcOrder, isIndexed: true };
}

function triangleArea3D(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const rx = aby * acz - abz * acy;
  const ry = abz * acx - abx * acz;
  const rz = abx * acy - aby * acx;
  return 0.5 * Math.hypot(rx, ry, rz);
}

// Compute clean non-overlapping UV charts for every hide mesh.
// Each chart returns { mesh, part, tris, localU, localV, area, weight, aspect }.
export function buildHideCharts(entries) {
  const charts = [];
  const p = new Vector3(),
    pA = new Vector3(),
    pB = new Vector3(),
    pC = new Vector3(),
    nTmp = new Vector3(),
    rel = new Vector3();

  for (const { mesh, part } of entries) {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if (!pos || pos.count < 3) continue;
    const idx = geo.index;
    const triCount = (idx ? idx.count : pos.count) / 3;
    const hw = heroWeight(part.id);

    // Case 1: Non-blended sweep / ellipsoid / cone / cylinder already have bijective UVs.
    const nativeUv =
      !mesh.blendOwners &&
      !mesh.handRig &&
      geo.attributes.uv &&
      ["sweep", "ellipsoid", "cone", "cylinder"].includes(part.shape);

    if (nativeUv) {
      const uv = geo.attributes.uv;
      let area = 0;
      const tris = new Int32Array(triCount);
      for (let t = 0; t < triCount; t++) {
        tris[t] = t;
        const i0 = idx ? idx.getX(3 * t) : 3 * t;
        const i1 = idx ? idx.getX(3 * t + 1) : 3 * t + 1;
        const i2 = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
        pA.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
        pB.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
        pC.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
        area += triangleArea3D(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z, pC.x, pC.y, pC.z);
      }
      const uArr = new Float32Array(pos.count);
      const vArr = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        uArr[i] = clamp(uv.getX(i), 0, 1);
        vArr[i] = clamp(uv.getY(i), 0, 1);
      }
      charts.push({
        mesh,
        part,
        tris,
        u: uArr,
        v: vArr,
        area: Math.max(1e-5, area),
        weight: Math.max(1e-5, area) * hw,
        aspect: 1,
      });
      continue;
    }

    // Case 2: Blended sweep patches (body, neck, muzzle, thigh, shin, tail, etc.)
    // -> Left/Right half-cylinder unwrap along parallel-transported part.knots.
    if (mesh.blendOwners && part.knots?.length > 1) {
      const { segs, total } = knotSegments(part, mesh.matrixWorld);
      if (segs.length && total > 1e-5) {
        const vAlong = new Float32Array(pos.count);
        const vUp = new Float32Array(pos.count);
        const vSide = new Float32Array(pos.count);
        let maxR = 0.02;
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          let best = Infinity,
            bAlong = 0,
            bUp = 0,
            bSide = 0,
            bR = 0;
          for (let sIdx = 0; sIdx < segs.length; sIdx++) {
            const s = segs[sIdx];
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
          const i0 = idx ? idx.getX(3 * t) : 3 * t;
          const i1 = idx ? idx.getX(3 * t + 1) : 3 * t + 1;
          const i2 = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
          triChart[t] = vSide[i0] + vSide[i1] + vSide[i2] >= 0 ? 0 : 1;
        }
        const { buckets, srcOrder } = assignChartTriangles(mesh, triChart, 2);
        const newPos = geo.attributes.position;
        const newIdx = geo.index;
        const uArr = new Float32Array(newPos.count);
        const vArr = new Float32Array(newPos.count);
        const rawU = new Float32Array(newPos.count);
        const rawV = new Float32Array(newPos.count);
        const aspect = clamp(total / (Math.PI * maxR), 0.38, 2.6);

        for (let c = 0; c < 2; c++) {
          const tris = buckets[c];
          if (!tris.length) continue;
          const sign = c === 0 ? 1 : -1;
          let minU = Infinity,
            maxU = -Infinity,
            minV = Infinity,
            maxV = -Infinity,
            area = 0;
          const touched = new Set();
          for (const t of tris) {
            const i0 = newIdx ? newIdx.getX(3 * t) : 3 * t;
            const i1 = newIdx ? newIdx.getX(3 * t + 1) : 3 * t + 1;
            const i2 = newIdx ? newIdx.getX(3 * t + 2) : 3 * t + 2;
            pA.fromBufferAttribute(newPos, i0).applyMatrix4(mesh.matrixWorld);
            pB.fromBufferAttribute(newPos, i1).applyMatrix4(mesh.matrixWorld);
            pC.fromBufferAttribute(newPos, i2).applyMatrix4(mesh.matrixWorld);
            area += triangleArea3D(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z, pC.x, pC.y, pC.z);
            for (const vi of [i0, i1, i2]) {
              if (touched.has(vi)) continue;
              touched.add(vi);
              const si = srcOrder ? srcOrder[vi] : vi;
              let ang = Math.atan2(vSide[si] * sign, vUp[si]);
              if (ang < -Math.PI * 0.5) ang += Math.PI * 2;
              const ru = vAlong[si];
              const rv = ang;
              rawU[vi] = ru;
              rawV[vi] = rv;
              if (ru < minU) minU = ru;
              if (ru > maxU) maxU = ru;
              if (rv < minV) minV = rv;
              if (rv > maxV) maxV = rv;
            }
          }
          const spanU = Math.max(1e-5, maxU - minU);
          const spanV = Math.max(1e-5, maxV - minV);
          for (const vi of touched) {
            uArr[vi] = (rawU[vi] - minU) / spanU;
            vArr[vi] = (rawV[vi] - minV) / spanV;
          }
          charts.push({
            mesh,
            part,
            tris: Int32Array.from(tris),
            u: uArr,
            v: vArr,
            area: Math.max(1e-5, area),
            weight: Math.max(1e-5, area) * hw,
            aspect,
          });
        }
        continue;
      }
    }

    // Case 3: Branching / flat cages & hands (foot, toes, hand, box, trunk tip)
    // -> 4-chart dominant-normal projection (Top/+Y, Bottom/-Y, Right/+X, Left/-X)
    //    so splayed toes and fingers never overlap in UV.
    const isExtremity =
      mesh.handRig ||
      part.shape === "box" ||
      /(?:foot|toes|hand|trunk tip|claw|pad|paddle|hoof)/.test(part.id);

    if (isExtremity) {
      geo.computeBoundingBox();
      const box = geo.boundingBox;
      const bMin = box.min,
        bSize = box.getSize(new Vector3());
      const sx = Math.max(1e-4, bSize.x),
        sy = Math.max(1e-4, bSize.y),
        sz = Math.max(1e-4, bSize.z);
      const flat = sy < Math.max(sx, sz) * 0.9;
      const triChart = new Uint8Array(triCount);
      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx.getX(3 * t) : 3 * t;
        const i1 = idx ? idx.getX(3 * t + 1) : 3 * t + 1;
        const i2 = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
        pA.fromBufferAttribute(pos, i0);
        pB.fromBufferAttribute(pos, i1);
        pC.fromBufferAttribute(pos, i2);
        nTmp.crossVectors(pB.clone().sub(pA), pC.clone().sub(pA));
        const ax = Math.abs(nTmp.x),
          ay = Math.abs(nTmp.y),
          az = Math.abs(nTmp.z);
        if (flat) {
          if (ay >= ax * 0.65 && ay >= az * 0.65) triChart[t] = nTmp.y >= 0 ? 0 : 1;
          else triChart[t] = nTmp.x >= 0 ? 2 : 3;
        } else {
          if (az >= ax * 0.75) triChart[t] = nTmp.z >= 0 ? 0 : 1;
          else triChart[t] = nTmp.x >= 0 ? 2 : 3;
        }
      }
      const { buckets } = assignChartTriangles(mesh, triChart, 4);
      const newPos = geo.attributes.position;
      const newIdx = geo.index;
      const uArr = new Float32Array(newPos.count);
      const vArr = new Float32Array(newPos.count);
      for (let c = 0; c < 4; c++) {
        const tris = buckets[c];
        if (!tris.length) continue;
        let minU = Infinity,
          maxU = -Infinity,
          minV = Infinity,
          maxV = -Infinity,
          area = 0;
        const touched = new Set();
        const rawU = new Map(),
          rawV = new Map();
        for (const t of tris) {
          const i0 = newIdx ? newIdx.getX(3 * t) : 3 * t;
          const i1 = newIdx ? newIdx.getX(3 * t + 1) : 3 * t + 1;
          const i2 = newIdx ? newIdx.getX(3 * t + 2) : 3 * t + 2;
          pA.fromBufferAttribute(newPos, i0).applyMatrix4(mesh.matrixWorld);
          pB.fromBufferAttribute(newPos, i1).applyMatrix4(mesh.matrixWorld);
          pC.fromBufferAttribute(newPos, i2).applyMatrix4(mesh.matrixWorld);
          area += triangleArea3D(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z, pC.x, pC.y, pC.z);
          for (const vi of [i0, i1, i2]) {
            if (touched.has(vi)) continue;
            touched.add(vi);
            const lx = (newPos.getX(vi) - bMin.x) / sx;
            const ly = (newPos.getY(vi) - bMin.y) / sy;
            const lz = (newPos.getZ(vi) - bMin.z) / sz;
            let ru, rv;
            if (c < 2) {
              ru = lx;
              rv = flat ? lz : ly;
            } else {
              ru = lz;
              rv = ly;
            }
            rawU.set(vi, ru);
            rawV.set(vi, rv);
            if (ru < minU) minU = ru;
            if (ru > maxU) maxU = ru;
            if (rv < minV) minV = rv;
            if (rv > maxV) maxV = rv;
          }
        }
        const spanU = Math.max(1e-5, maxU - minU);
        const spanV = Math.max(1e-5, maxV - minV);
        for (const vi of touched) {
          uArr[vi] = (rawU.get(vi) - minU) / spanU;
          vArr[vi] = (rawV.get(vi) - minV) / spanV;
        }
        charts.push({
          mesh,
          part,
          tris: Int32Array.from(tris),
          u: uArr,
          v: vArr,
          area: Math.max(1e-5, area),
          weight: Math.max(1e-5, area) * hw,
          aspect: 1,
        });
      }
      continue;
    }

    // Case 4: Head skullCage & ellipsoidal / convex organic blobs (haunch, pelvis, shoulders, brow, lid, etc.)
    // -> Two Sagittal Lambert Azimuthal Equal-Area Hemispheres (+X Right and -X Left).
    //    Unbroken cheeks/brow/snout/crown on each side with near-1:1 area fidelity and zero pole pinching!
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    const center = box.getCenter(new Vector3());
    const half = box.getSize(new Vector3()).multiplyScalar(0.5);
    const rx = Math.max(1e-4, half.x),
      ry = Math.max(1e-4, half.y),
      rz = Math.max(1e-4, half.z);

    const triChart = new Uint8Array(triCount);
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(3 * t) : 3 * t;
      const i1 = idx ? idx.getX(3 * t + 1) : 3 * t + 1;
      const i2 = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
      const cx =
        (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3 - center.x;
      triChart[t] = cx >= 0 ? 0 : 1;
    }
    const { buckets } = assignChartTriangles(mesh, triChart, 2);
    const newPos = geo.attributes.position;
    const newIdx = geo.index;
    const uArr = new Float32Array(newPos.count);
    const vArr = new Float32Array(newPos.count);
    const aspect = clamp(rz / ry, 0.55, 1.85);

    for (let c = 0; c < 2; c++) {
      const tris = buckets[c];
      if (!tris.length) continue;
      const sign = c === 0 ? 1 : -1;
      let minU = Infinity,
        maxU = -Infinity,
        minV = Infinity,
        maxV = -Infinity,
        area = 0;
      const touched = new Set();
      const rawU = new Map(),
        rawV = new Map();
      for (const t of tris) {
        const i0 = newIdx ? newIdx.getX(3 * t) : 3 * t;
        const i1 = newIdx ? newIdx.getX(3 * t + 1) : 3 * t + 1;
        const i2 = newIdx ? newIdx.getX(3 * t + 2) : 3 * t + 2;
        pA.fromBufferAttribute(newPos, i0).applyMatrix4(mesh.matrixWorld);
        pB.fromBufferAttribute(newPos, i1).applyMatrix4(mesh.matrixWorld);
        pC.fromBufferAttribute(newPos, i2).applyMatrix4(mesh.matrixWorld);
        area += triangleArea3D(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z, pC.x, pC.y, pC.z);
        for (const vi of [i0, i1, i2]) {
          if (touched.has(vi)) continue;
          touched.add(vi);
          let dx = (newPos.getX(vi) - center.x) / rx;
          let dy = (newPos.getY(vi) - center.y) / ry;
          let dz = (newPos.getZ(vi) - center.z) / rz;
          const len = Math.hypot(dx, dy, dz) || 1;
          dx /= len;
          dy /= len;
          dz /= len;
          const k = Math.sqrt(2 / Math.max(0.08, 1 + sign * dx));
          const ru = sign * dz * k;
          const rv = dy * k;
          rawU.set(vi, ru);
          rawV.set(vi, rv);
          if (ru < minU) minU = ru;
          if (ru > maxU) maxU = ru;
          if (rv < minV) minV = rv;
          if (rv > maxV) maxV = rv;
        }
      }
      const spanU = Math.max(1e-5, maxU - minU);
      const spanV = Math.max(1e-5, maxV - minV);
      for (const vi of touched) {
        uArr[vi] = (rawU.get(vi) - minU) / spanU;
        vArr[vi] = (rawV.get(vi) - minV) / spanV;
      }
      charts.push({
        mesh,
        part,
        tris: Int32Array.from(tris),
        u: uArr,
        v: vArr,
        area: Math.max(1e-5, area),
        weight: Math.max(1e-5, area) * hw,
        aspect,
      });
    }
  }
  return charts;
}

// Binary-split area-proportional rectangle packer (same proven scheme as game-export.js).
export function packHideCharts(charts, size = HIDE_SIZE) {
  if (!charts.length) return [];
  const totalW = charts.reduce((s, c) => s + c.weight, 0);
  const floorW = totalW * 0.0028;
  const items = charts
    .map((c) => ({ chart: c, w: Math.max(floorW, c.weight) }))
    .sort((a, b) => b.w - a.w);

  function split(list, rect) {
    if (list.length === 1) {
      list[0].chart.rect = rect;
      return;
    }
    const sum = list.reduce((s, e) => s + e.w, 0);
    let acc = list[0].w,
      k = 1;
    while (
      k < list.length - 1 &&
      Math.abs(acc + list[k].w - sum * 0.5) < Math.abs(acc - sum * 0.5)
    ) {
      acc += list[k++].w;
    }
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
  }

  split(items, [0, 0, size, size]);
  return charts;
}

// Pure scalar 3D creature hide evaluator (albedo RGB, micro-height, roughness).
// Zero allocations per sample.
// A swept limb has its own proximal/distal frame, even when its skin is
// joined to the body. Project in metres so the rows retain their size.
function reliefAxis(part, object) {
  if (!object || !part.knots || part.knots.length < 2 || part.id === "body") return null;
  object.updateWorldMatrix(true, false);
  const start = new Vector3(...part.knots[0].slice(0, 3)).applyMatrix4(object.matrixWorld);
  const end = new Vector3(...part.knots.at(-1).slice(0, 3)).applyMatrix4(object.matrixWorld);
  const dir = end.sub(start);
  const length = dir.length();
  if (length < 0.001) return null;
  dir.divideScalar(length);
  const cross = new Vector3(0, 1, 0).cross(dir);
  if (cross.lengthSq() < 0.001) cross.set(1, 0, 0).cross(dir);
  cross.normalize();
  const up = dir.clone().cross(cross);
  const radius = Math.max(0.01, ...part.knots.map(k => Math.max(k[3], k[4])));
  return { start, dir, length, cross, up, radius };
}

export function createHideEvaluator(form, objects, limbTints) {
  const skin = form.origin.plan.skin;
  const bodyPart = form.parts.find((p) => p.id === "body");
  const bodyObj = objects.get("body");
  const segments = [];
  let spineLen = 0.8;
  let spineRadius = 0.2;

  if (bodyPart?.knots?.length > 1 && bodyObj) {
    bodyObj.updateWorldMatrix(true, false);
    const knots = bodyPart.knots.map((k) => ({
      p: new Vector3(k[0], k[1], k[2]).applyMatrix4(bodyObj.matrixWorld),
      r: Math.max(k[3], k[4]),
    }));
    let lenAcc = 0;
    spineRadius = Math.max(0.05, ...knots.map((k) => k.r));
    for (let i = 1; i < knots.length; i++) {
      const a = knots[i - 1].p,
        b = knots[i].p;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        dz = b.z - a.z;
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

  // Collect eye world positions for restrained orbital framing on the head.
  const eyes = [];
  for (const part of form.parts) {
    if (!/(?:^| )eye(?: \d+)?$/.test(part.id)) continue;
    const obj = objects.get(part.id);
    if (!obj) continue;
    const wp = obj.getWorldPosition(new Vector3());
    eyes.push({
      x: wp.x,
      y: wp.y,
      z: wp.z,
      r: Math.max(0.015, ...part.size),
    });
  }

  // Deterministic seed derived from creature palette & markings.
  const seedStr = `${skin.base}|${skin.accent}|${skin.pale}|${skin.markings?.seed ?? 0}`;
  let hideSeed = 0x51a7c3d1;
  for (let i = 0; i < seedStr.length; i++) {
    hideSeed = Math.imul(hideSeed ^ seedStr.charCodeAt(i), 0x01000193) >>> 0;
  }

  const baseCol = new Color(skin.base);
  const accentCol = new Color(skin.accent);
  const paleCol = new Color(skin.pale);
  const flank = flankPaint(skin.flankMarking, accentCol, paleCol, baseCol);
  const softPaleCol = paleCol.clone().lerp(baseCol, 0.16);
  const accentWashCol = baseCol.clone().lerp(accentCol, 0.54);
  const baseLuma = 0.2126 * baseCol.r + 0.7152 * baseCol.g + 0.0722 * baseCol.b;
  const markLuma = skin.markings
    ? (() => {
        const mc = new Color(skin.markings.color);
        return 0.2126 * mc.r + 0.7152 * mc.g + 0.0722 * mc.b;
      })()
    : baseLuma;
  const darkCountershade =
    skin.markings?.kind === "Countershade" && markLuma < baseLuma * 1.05;

  // Derive harmonious deeper & mid tones per base hex so artist-recoloured parts
  // keep their own hue rather than pulling toward skin.base.
  const toneCache = new Map();
  const deriveTones = (hex) => {
    let t = toneCache.get(hex);
    if (t) return t;
    const c = new Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    const veryPale = hsl.l > 0.66;
    const deep = new Color().setHSL(
      (hsl.h + (veryPale ? -0.022 : -0.028) + 1) % 1,
      clamp(hsl.s * 1.2 + (veryPale ? 0.18 : 0.08), 0.16, 0.88),
      clamp(hsl.l * (veryPale ? 0.60 : 0.48), 0.05, 0.52),
    );
    const mid = new Color().setHSL(
      (hsl.h + 0.018) % 1,
      clamp(hsl.s * 1.12 + (veryPale ? 0.12 : 0.04), 0.14, 0.85),
      clamp(hsl.l * (veryPale ? 0.76 : 0.70), 0.08, 0.68),
    );
    const sameAsSkin = hex.toLowerCase() === skin.base.toLowerCase();
    const wash = sameAsSkin ? accentWashCol : c.clone().lerp(mid, 0.45);
    t = {
      veryPale,
      dr: deep.r, dg: deep.g, db: deep.b,
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
  const isScales = skin.surface === "scales";
  const profile = classifyCreatureRelief(form.origin.plan);
  const coat = creatureCoatField(form, objects);
  const relief = {profile, scaleRef, seed: hideSeed};
  const sample = new Float64Array(4);
  const cell = new Float64Array(5);
  const surfaceNormal = new Vector3();
  const hasBirdLeg = form.origin.plan.limbs?.some(limb => limb.style === "bird");


  // Precompile per-part colour/marking layers (respecting per-part artist edits!).
  const partMap = new Map(form.parts.map((p) => [p.id, p]));
  const partLayers = new Map();
  const markCache = new Map();
  const getMark = (m) => {
    if (!m) return null;
    const key = `${m.kind}|${m.color}|${m.spacing}|${m.coverage}|${m.angle}|${m.seed}`;
    let fn = markCache.get(key);
    if (!fn) {
      fn = makeMarkingSampler(m);
      markCache.set(key, fn);
    }
    return fn;
  };
  for (const part of form.parts) {
    const pc = new Color(part.color);
    const tintFn = limbTints?.get(part.id) ?? null;
    partLayers.set(part.id, {
      r: pc.r,
      g: pc.g,
      b: pc.b,
      face: faceCoat(part, objects.get(part.id), form.origin.plan),
      flank: part.id === "body" && part.color.toLowerCase() === skin.base.toLowerCase(),
      part, axis: reliefAxis(part, objects.get(part.id)),
      isTail: part.id.startsWith("tail"),
      isTentacle: part.id.includes("tentacle"),
      isMuzzle: /muzzle|bill|snout/.test(part.id),
      isExtremity: ["hand", "foot"].includes(part.motionRole),
      isBirdLeg: hasBirdLeg && part.id.includes("leg"),
      tones: deriveTones(part.color),
      isHead: part.motionRole === "head" || /^(?:head|muzzle|jaw|brow|lid)/.test(part.id),
      isLimb: ["thigh", "shin", "foot", "upper arm", "forearm", "hand"].includes(part.motionRole),
      under: getMark(part.undercoat),
      mark: getMark(part.markings),
      tint: tintFn,
    });
  }

  const scratchColor = new Color();
  const scratchVec = new Vector3();
  const wBuf = new Float64Array(3);
  const baseOutA = new Float64Array(4); // r, g, b, markAlpha
  const baseOutB = new Float64Array(4);

  function evalLayer(dst, layer, px, py, pz, nx, ny, nz) {
    let r = layer.r,
      g = layer.g,
      b = layer.b;
    if (layer.under) {
      const u = layer.under.sample(px, py, pz, nx, ny, nz, true);
      r += (layer.under.r - r) * u;
      g += (layer.under.g - g) * u;
      b += (layer.under.b - b) * u;
    }
    if (coat && layer.part.coatZone) {
      scratchColor.setRGB(r, g, b);
      coat.sample(scratchColor, scratchColor, scratchVec.set(px,py,pz), surfaceNormal.set(nx,ny,nz), layer.part);
      r = scratchColor.r; g = scratchColor.g; b = scratchColor.b;
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
  }

  function evaluate(out, px, py, pz, nx, ny, nz, layerA, layerB, wA) {
    evalLayer(baseOutA, layerA, px, py, pz, nx, ny, nz);
    let r = baseOutA[0],
      g = baseOutA[1],
      b = baseOutA[2],
      mAlpha = baseOutA[3];
    if (layerB && wA < 0.999) {
      evalLayer(baseOutB, layerB, px, py, pz, nx, ny, nz);
      const wB = 1 - wA;
      r = r * wA + baseOutB[0] * wB;
      g = g * wA + baseOutB[1] * wB;
      b = b * wA + baseOutB[2] * wB;
      mAlpha = mAlpha * wA + baseOutB[3] * wB;
    }

    // 1. Spine-relative dorsal/ventral coordinates (continuous across all parts).
    let tSpine = 0.5,
      vertical = 0,
      upAlign = ny;
    if (segments.length) {
      let near = Infinity;
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        const rx = px - s.ax,
          ry = py - s.ay,
          rz = pz - s.az;
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

    // Macro organic 3D fBm (clean, low frequency — zero granite/speckle).
    const mf = 2.6 / scaleRef;
    const nMac1 = noise3(px * mf, py * mf, pz * mf, hideSeed ^ 0x19a3);
    const nMac2 = noise3(px * mf * 2.1, py * mf * 2.1, pz * mf * 2.1, hideSeed ^ 0x62b1);
    const fbmMac = 0.68 * nMac1 + 0.32 * nMac2 - 0.5;

    // On the head/neck (which sit above upright spines), use world-up normal
    // directly so the crown, brow ridge, and upper cheeks articulate clearly.
    const upMix = layerA.isHead ? ny * 0.78 + clamp(vertical, -1, 1) * 0.22 : upAlign * 0.54 + clamp(vertical, -1.2, 1.2) * 0.46;
    const dorsalCoord = upMix + fbmMac * 0.26;
    const dorsal = smoothstep(dorsalCoord, 0.08, 0.76);
    const ventral = smoothstep(-dorsalCoord, 0.22, 0.82);
    const shoulder = smoothstep(tSpine, 0.44, 0.72) * (1 - smoothstep(tSpine, 1.08, 1.48));

    // Preserve authored markings strongly wherever a pattern mark is present.
    // For Countershade, do not block dorsal articulation on the unshaded upper body.
    const markGuard =
      layerA.mark?.kind === "Countershade"
        ? 1 - 0.35 * mAlpha
        : 1 - 0.58 * mAlpha;

    // 2. Continuous anatomical tonal depth (strongest on barely-patterned hides).
    const tones = layerA.tones;
    const dorsalStrength = (0.14 + 0.40 * flatBoost) * markGuard;
    const dMix = dorsal * dorsalStrength * (0.86 + 0.22 * shoulder);
    r += (tones.dr - r) * dMix;
    g += (tones.dg - g) * dMix;
    b += (tones.db - b) * dMix;

    // Soft pale throat/belly recovery ONLY when a dark Countershade (e.g. 12116)
    // suppressed the pale belly undercoat. Avoid washing out already-pale Countershade (12115).
    if (darkCountershade && !layerA.under && skin.belly > 0.04) {
      const vLift = ventral * 0.28 * skin.belly;
      r += (softPaleCol.r - r) * vLift;
      g += (softPaleCol.g - g) * vLift;
      b += (softPaleCol.b - b) * vLift;
    }

    // 3. Harmonious organic crown/shoulder/flank mottling & accent wash for barely-patterned
    //    hides (12104, 12105, 12115, 12116, 12118, and unpatterned untouched draws).
    if (flatBoost > 0.42 && !layerA.isLimb) {
      const fb = clamp((flatBoost - 0.42) / 0.58, 0, 1);
      // Organic flank/cheek transition band where dorsal mantle breaks into soft dapples.
      const flankBand =
        smoothstep(dorsalCoord, -0.26, 0.22) *
        (1 - smoothstep(dorsalCoord, 0.48, 0.92));
      const df = 5.6 / scaleRef;
      const dNoise =
        0.64 * noise3(px * df + fbmMac * 1.1, py * df, pz * df, hideSeed ^ 0x83d9) +
        0.36 * noise3(px * df * 1.95, py * df * 1.95, pz * df * 1.95, hideSeed ^ 0x2c47);
      const dapple = smoothstep(dNoise, 0.44, 0.65) * flankBand * fb * markGuard;
      // Soft organic biological flecks near the dorsal-to-flank edge (3D Worley, zero blocks).
      const ff = 9.5 / scaleRef;
      worley3(wBuf, px * ff + fbmMac * 0.8, py * ff, pz * ff, hideSeed ^ 0x55a9);
      const fleck =
        (1 - smoothstep(wBuf[0], 0.22, 0.36)) *
        flankBand *
        smoothstep(nMac1, 0.36, 0.62) *
        fb *
        markGuard;
      // Cohesive tonal blend: deeper species hue + restrained accent wash on cheek/shoulder.
      const wMix = dapple * (0.36 + 0.18 * shoulder);
      r += (tones.mr - r) * wMix;
      g += (tones.mg - g) * wMix;
      b += (tones.mb - b) * wMix;
      // Subtle deeper organic dapple flecks along the mantle border (visible at 128px & 320px).
      const fMix = fleck * (tones.veryPale ? 0.46 : 0.34);
      r += (tones.dr - r) * fMix;
      g += (tones.dg - g) * fMix;
      b += (tones.db - b) * fMix;
    }

    // 4. Restrained orbital / eye-socket framing on the head (living brow/socket depth).
    if (eyes.length) {
      for (let e = 0; e < eyes.length; e++) {
        const eye = eyes[e];
        const dx = px - eye.x,
          dy = (py - eye.y) * 1.25,
          dz = (pz - eye.z) * 0.85;
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
    }

    // Sample the material on the animal's own longitudinal and lateral axes.
    const layer = layerB && wA < 0.5 ? layerB : layerA;
    relief.px = px; relief.py = py; relief.pz = pz;
    relief.tSpine = tSpine; relief.sAlong = tSpine * spineLen;
    relief.uAcross = Math.atan2(px, vertical * spineRadius) * spineRadius;
    relief.flankNorm = Math.abs(px) / spineRadius;
    relief.dorsal = dorsal; relief.ventral = ventral; relief.dorsalCoord = dorsalCoord;
    relief.shoulder = shoulder; relief.fbmMac = fbmMac; relief.nMac2 = nMac2;
    relief.markGuard = markGuard; relief.mAlpha = mAlpha;
    relief.isHead = layer.isHead; relief.isLimb = layer.isLimb;
    relief.isTail = layer.isTail; relief.isMuzzle = layer.isMuzzle;
    relief.isTentacle = layer.isTentacle; relief.isBirdLeg = layer.isBirdLeg;
    relief.isExtremity = layer.isExtremity;
    const axis = layer.axis;
    relief.hasAxis = Boolean(axis);
    relief.limbT = 0; relief.limbAlong = 0; relief.limbArc = 0;
    relief.jointProx = 0; relief.limbUp = ny;
    if (axis) {
      scratchVec.set(px, py, pz).sub(axis.start);
      relief.limbAlong = scratchVec.dot(axis.dir);
      relief.limbT = clamp(relief.limbAlong / axis.length, 0, 1);
      relief.limbArc = Math.atan2(scratchVec.dot(axis.cross), scratchVec.dot(axis.up)) * axis.radius;
      relief.limbUp = nx * axis.up.x + ny * axis.up.y + nz * axis.up.z;
      relief.jointProx = 1 - Math.min(1, 6 * Math.min(relief.limbT, 1 - relief.limbT));
    }
    evaluateBiologicalRelief(sample, relief, cell, wBuf);
    if (flank && (layerA.flank || layerB?.flank)) {
      const coverage = layerB ? Number(layerA.flank) * wA + Number(layerB.flank) * (1 - wA) : 1;
      scratchColor.setRGB(r, g, b);
      flank(scratchColor, tSpine, dorsalCoord, fbmMac, coverage);
      r = scratchColor.r; g = scratchColor.g; b = scratchColor.b;
    }
    if (layerA.face || layerB?.face) {
      scratchColor.setRGB(r,g,b);
      layerA.face?.world(scratchColor,px,py,pz,layerB ? wA : 1);
      layerB?.face?.world(scratchColor,px,py,pz,1-wA);
      r = scratchColor.r; g = scratchColor.g; b = scratchColor.b;
    }
    const shade = sample[2];
    const lift = sample[3];
    out[0] = clamp(r * shade + (softPaleCol.r - r) * lift, 0, 1);
    out[1] = clamp(g * shade + (softPaleCol.g - g) * lift, 0, 1);
    out[2] = clamp(b * shade + (softPaleCol.b - b) * lift, 0, 1);
    out[3] = sample[0];
    out[4] = sample[1];
  }

  return {
    skin,
    profile,
    isScales,
    scaleRef,
    pVis,
    flatBoost,
    partLayers,
    partMap,
    evaluate,
  };
}

// Rasterize all packed charts into albedo, roughness, height, and tangent-space normal maps.
function rasterizeHideAtlas(charts, evaluator, size = HIDE_SIZE) {
  const count = size * size;
  const albedo = new Uint8ClampedArray(count * 4);
  const roughData = new Uint8ClampedArray(count * 4);
  const heightBuf = new Float32Array(count).fill(0.5);
  const mppBuf = new Float32Array(count).fill(0.002); // metres per texel
  const filled = new Uint8Array(count);

  // Fill background with creature's base skin colour & default roughness so
  // even extreme mipmap levels can never show black or white bleeding halos.
  const bgCol = new Color(evaluator.skin.base);
  const bgR = toSrgbByte(bgCol.r),
    bgG = toSrgbByte(bgCol.g),
    bgB = toSrgbByte(bgCol.b);
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
  const p0 = new Vector3(),
    p1 = new Vector3(),
    p2 = new Vector3();
  const n0 = new Vector3(),
    n1 = new Vector3(),
    n2 = new Vector3();
  const nm = new Matrix3();

  // Map each mesh's final atlas UV buffer so charts sharing one mesh write to the same attribute.
  const meshUvs = new Map();
  for (const ch of charts) {
    if (!meshUvs.has(ch.mesh)) {
      meshUvs.set(ch.mesh, new Float32Array(ch.mesh.geometry.attributes.position.count * 2));
    }
  }

  for (const ch of charts) {
    const { mesh, part, tris, u: locU, v: locV, rect } = ch;
    const [rx, ry, rw, rh] = rect;
    const pad = Math.min(CHART_MARGIN, Math.floor((Math.min(rw, rh) - 2) / 3));
    const ix = rx + pad,
      iy = ry + pad,
      iw = Math.max(2, rw - 2 * pad),
      ih = Math.max(2, rh - 2 * pad);

    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    const idx = geo.index;
    const finalUv = meshUvs.get(mesh);
    nm.getNormalMatrix(mesh.matrixWorld);

    const owners = mesh.blendOwners;
    const ownerLayers = owners
      ? owners.ids.map((id) => evaluator.partLayers.get(id) ?? evaluator.partLayers.get(part.id))
      : null;
    const selfLayer = evaluator.partLayers.get(part.id);

    for (let ti = 0; ti < tris.length; ti++) {
      const t = tris[ti];
      const i0 = idx ? idx.getX(3 * t) : 3 * t;
      const i1 = idx ? idx.getX(3 * t + 1) : 3 * t + 1;
      const i2 = idx ? idx.getX(3 * t + 2) : 3 * t + 2;

      // Pixel coordinates in canvas space (y=0 at top, corresponding to uv.y = 1 in Three.js).
      const x0 = ix + locU[i0] * (iw - 1);
      const y0 = iy + (1 - locV[i0]) * (ih - 1);
      const x1 = ix + locU[i1] * (iw - 1);
      const y1 = iy + (1 - locV[i1]) * (ih - 1);
      const x2 = ix + locU[i2] * (iw - 1);
      const y2 = iy + (1 - locV[i2]) * (ih - 1);

      // Write exact Three.js UVs [0..1] (with +0.5 texel center alignment!).
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

      // Metres per texel for this triangle (for physically consistent normal slope).
      const area3d = triangleArea3D(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      const areaPx = 0.5 * Math.abs(det);
      const mpp = clamp(Math.sqrt(area3d / Math.max(0.25, areaPx)), 0.0004, 0.025);

      const minX = Math.max(ix, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(ix + iw - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(iy, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(iy + ih - 1, Math.ceil(Math.max(y0, y1, y2)));

      // Determine owner layers for this triangle.
      let lA = selfLayer,
        lB = null,
        sameOwner = true;
      let o0a = 0, o1a = 0, o2a = 0, w0a = 1, w1a = 1, w2a = 1;
      if (owners) {
        o0a = owners.first[i0];
        o1a = owners.first[i1];
        o2a = owners.first[i2];
        w0a = owners.weight[i0];
        w1a = owners.weight[i1];
        w2a = owners.weight[i2];
        if (o0a === o1a && o1a === o2a && w0a > 0.99 && w1a > 0.99 && w2a > 0.99) {
          lA = ownerLayers[o0a];
        } else {
          sameOwner = false;
        }
      }

      for (let py = minY; py <= maxY; py++) {
        const dy = py - y0;
        const row = py * size;
        for (let px = minX; px <= maxX; px++) {
          const dx = px - x0;
          const b1 = (dx * (y2 - y0) - dy * (x2 - x0)) * invDet;
          const b2 = ((x1 - x0) * dy - (y1 - y0) * dx) * invDet;
          const b0 = 1 - b1 - b2;
          // Small conservative edge tolerance (-0.015) prevents hairline cracks
          // between adjacent triangles before dilation.
          if (b0 < -0.015 || b1 < -0.015 || b2 < -0.015) continue;

          const c0 = b0 < 0 ? 0 : b0;
          const c1 = b1 < 0 ? 0 : b1;
          const c2 = b2 < 0 ? 0 : b2;
          const cs = c0 + c1 + c2 || 1;
          const k0 = c0 / cs,
            k1 = c1 / cs,
            k2 = c2 / cs;

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

          let layerA = lA,
            layerB = lB,
            wA = 1;
          if (!sameOwner) {
            // Interpolate dominant & secondary blend owner at boundary triangles.
            const dom = k0 >= k1 && k0 >= k2 ? i0 : k1 >= k2 ? i1 : i2;
            layerA = ownerLayers[owners.first[dom]];
            const sec = owners.second[dom];
            if (sec !== owners.first[dom]) {
              layerB = ownerLayers[sec];
              wA = clamp(w0a * k0 + w1a * k1 + w2a * k2, 0, 1);
            }
          }

          evaluator.evaluate(evalOut, wx, wy, wz, wnx, wny, wnz, layerA, layerB, wA);
          const idxPix = row + px;
          const off = idxPix * 4;
          albedo[off] = toSrgbByte(evalOut[0]);
          albedo[off + 1] = toSrgbByte(evalOut[1]);
          albedo[off + 2] = toSrgbByte(evalOut[2]);
          albedo[off + 3] = 255;
          heightBuf[idxPix] = evalOut[3];
          roughData[off + 1] = Math.round(255 * evalOut[4]);
          mppBuf[idxPix] = mpp;
          filled[idxPix] = 1;
        }
      }
    }
  }

  for (const [mesh, uvs] of meshUvs) {
    mesh.geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  }

  // Dilate covered texels outward into chart gutters (6 passes) so bilinear
  // filtering, mipmapping, and 24K Meshopt simplification never sample empty gutter.
  const nextFilled = new Uint8Array(filled);
  for (let pass = 0; pass < 6; pass++) {
    let any = false;
    for (let y = 0; y < size; y++) {
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const i = row + x;
        if (filled[i]) continue;
        let rSum = 0,
          gSum = 0,
          bSum = 0,
          hSum = 0,
          rgSum = 0,
          mSum = 0,
          cnt = 0;
        if (x > 0 && filled[i - 1]) {
          const j = i - 1, o = j * 4;
          rSum += albedo[o]; gSum += albedo[o + 1]; bSum += albedo[o + 2];
          hSum += heightBuf[j]; rgSum += roughData[o + 1]; mSum += mppBuf[j]; cnt++;
        }
        if (x + 1 < size && filled[i + 1]) {
          const j = i + 1, o = j * 4;
          rSum += albedo[o]; gSum += albedo[o + 1]; bSum += albedo[o + 2];
          hSum += heightBuf[j]; rgSum += roughData[o + 1]; mSum += mppBuf[j]; cnt++;
        }
        if (y > 0 && filled[i - size]) {
          const j = i - size, o = j * 4;
          rSum += albedo[o]; gSum += albedo[o + 1]; bSum += albedo[o + 2];
          hSum += heightBuf[j]; rgSum += roughData[o + 1]; mSum += mppBuf[j]; cnt++;
        }
        if (y + 1 < size && filled[i + size]) {
          const j = i + size, o = j * 4;
          rSum += albedo[o]; gSum += albedo[o + 1]; bSum += albedo[o + 2];
          hSum += heightBuf[j]; rgSum += roughData[o + 1]; mSum += mppBuf[j]; cnt++;
        }
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

  // Derive physically scaled tangent-space normals from the dilated micro-height field.
  // Matches game-surface.js heightNormals sign convention (+X right, +Y down in canvas).
  const normalData = new Uint8ClampedArray(count * 4);
  const bumpMetres = evaluator.profile.bumpMetres * evaluator.scaleRef;

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
      const slopeGain = bumpMetres / Math.max(0.0005, mppBuf[i]);
      const nx = slopeGain * (heightBuf[row + left] - heightBuf[row + right]) / dxSpan;
      const ny = slopeGain * (heightBuf[bot * size + x] - heightBuf[top * size + x]) / dySpan;
      const len = Math.hypot(nx, ny, 1);
      normalData[o] = Math.round(127.5 + (127.5 * nx) / len);
      normalData[o + 1] = Math.round(127.5 + (127.5 * ny) / len);
      normalData[o + 2] = Math.round(127.5 + 127.5 / len);
      normalData[o + 3] = 255;
    }
  }

  return { albedo, roughData, normalData, size };
}

function canvasFromPixels(data, size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  return c;
}

// Bake a unified, high-resolution continuous creature hide texture set
// (albedo + tangent normal + roughness) shared by all organic hide parts of a
// creature-plan form. Returns the Set of handled part IDs (empty if ineligible).
export function bakeCreatureHide(form, objects, limbTints, fitWardrobe) {
  const handled = new Set();
  if (typeof document === "undefined") return handled;
  if (form.origin?.kind !== "creature plan" || !form.origin?.plan?.skin)
    return handled;
  const skin = form.origin.plan.skin;
  // Older saved coats retain their original material and UVs.
  if (skin.coat && !skin.coat.graded && !skin.flankMarking && form.origin.plan.anatomyRevision !== 2) return handled;

  const entries = [];
  for (const part of form.parts) {
    const mesh = objects.get(part.id);
    if (!mesh?.isMesh || !mesh.visible) continue;
    const fit = fitWardrobe ? fitWardrobe(part, form) : null;
    if (fit && !fit.preserve && !fit.bare) continue;
    if (!isCreatureHidePart(part, skin)) continue;
    entries.push({ part, mesh });
  }
  if (!entries.length) return handled;

  const charts = buildHideCharts(entries);
  if (!charts.length) return handled;
  packHideCharts(charts, HIDE_SIZE);

  const evaluator = createHideEvaluator(form, objects, limbTints);
  const { albedo, roughData, normalData, size } = rasterizeHideAtlas(
    charts,
    evaluator,
    HIDE_SIZE,
  );

  const map = new CanvasTexture(canvasFromPixels(albedo, size));
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;

  const normalMap = new CanvasTexture(canvasFromPixels(normalData, size));
  normalMap.anisotropy = 4;

  const roughnessMap = new CanvasTexture(canvasFromPixels(roughData, size));
  roughnessMap.anisotropy = 4;

  const hideMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    map,
    normalMap,
    roughnessMap,
    roughness: 1,
    metalness: 0,
  });
  hideMaterial.name = "Creature hide";
  hideMaterial.userData.creatureHide = true;
  hideMaterial.userData.ownedHideTextures = true;

  for (const { part, mesh } of entries) {
    mesh.geometry.deleteAttribute("color");
    mesh.material = hideMaterial;
    handled.add(part.id);
  }
  return handled;
}
