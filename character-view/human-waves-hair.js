import {softenWaveEdge} from "./human-waves-root.js";
import * as T from "three";
import { hatHead } from "./human-hats.js";
import { hairline, settleFringe, surfaceBody, surfaceFrame } from "./human-fringe.js";
import { smoothHairCards } from "./human-hair-cards.js";
import { add, clamp, cross, dot, hash1, length, mix, smooth, sub, unit } from "./human-style-kit.js";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

function bodyReach(body, axis, top, low, k) {
  const cell = 0.012 * k;
  const rows = Math.max(2, Math.ceil((top - low) / cell) + 1);
  const cols = 48;
  const R = new Float32Array(rows * cols);
  const headNeck = body.weight(/^(head|neck)/);
  for (let v = 0; v < body.count; v++) {
    if (headNeck[v] < 0.2 && body.arm[v] > 0.25) continue;
    const p = body.point(v);
    if (p[1] > top || p[1] < low) continue;
    const dx = p[0] - axis[0], dz = p[2] - axis[1];
    const r = Math.hypot(dx, dz);
    if (headNeck[v] < 0.2 && Math.abs(dx) > 0.112 * k) continue;
    const row = clamp(Math.round((top - p[1]) / cell), 0, rows - 1);
    const col = Math.floor(((Math.atan2(dx, dz) + Math.PI) / TAU) * cols) % cols;
    if (r > R[row * cols + col]) R[row * cols + col] = r;
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (!R[row * cols + col]) {
          R[row * cols + col] = Math.max(
            R[row * cols + (col + 1) % cols],
            R[row * cols + (col + cols - 1) % cols],
          );
        }
      }
    }
  }
  return (y, bearing) => {
    const fr = clamp((top - y) / cell, 0, rows - 1.001);
    const fc = ((((bearing + Math.PI) / TAU) * cols - 0.5) % cols + cols) % cols;
    const r0 = Math.floor(fr), c0 = Math.floor(fc);
    const s = fr - r0, t = fc - c0, c1 = (c0 + 1) % cols;
    return mix(
      mix(R[r0 * cols + c0], R[r0 * cols + c1], t),
      mix(R[(r0 + 1) * cols + c0], R[(r0 + 1) * cols + c1], t),
      s,
    );
  };
}

function volumeNormal(pt, f, axis) {
  const k = f.k;
  const dx = pt[0] - f.centre[0];
  const dy = pt[1] - (f.centre[1] - 0.014 * k);
  const dz = pt[2] - f.centre[2];
  const sphere = unit([dx, dy, dz]);
  const cx = pt[0] - axis[0];
  const cz = pt[2] - axis[1];
  const cylLen = Math.hypot(cx, cz) || 1e-6;
  const cyl = unit([cx / cylLen, 0.17, cz / cylLen]);
  const hang = smooth(0.015 * k, -0.055 * k, pt[1] - f.centre[1]);
  return unit([
    mix(sphere[0], cyl[0], hang),
    mix(sphere[1], cyl[1], hang),
    mix(sphere[2], cyl[2], hang),
  ]);
}

function extractStrips(p, corners, uvCorners, uv) {
  const nuv = uv.length / 2;
  const parent = Int32Array.from({ length: nuv }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const uvToPos = new Int32Array(nuv).fill(-1);
  for (let c = 0; c < corners.length; c += 3) {
    const t0 = uvCorners[c], t1 = uvCorners[c + 1], t2 = uvCorners[c + 2];
    parent[find(t1)] = find(t0);
    parent[find(t2)] = find(t0);
    uvToPos[t0] = corners[c];
    uvToPos[t1] = corners[c + 1];
    uvToPos[t2] = corners[c + 2];
  }
  const groups = new Map();
  for (let t = 0; t < nuv; t++) {
    if (uvToPos[t] < 0) continue;
    const r = find(t);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  const strips = [];
  for (const verts of groups.values()) {
    const byV = new Map();
    for (const t of verts) {
      const vKey = Math.round((uv[t * 2 + 1] / 65535) * 100);
      if (!byV.has(vKey)) byV.set(vKey, []);
      byV.get(vKey).push(t);
    }
    const rowKeys = [...byV.keys()].sort((a, b) => b - a);
    const rows = rowKeys.map((vk) => {
      const list = byV.get(vk).sort((a, b) => uv[a * 2] - uv[b * 2]);
      return list.map((t) => {
        const vi = uvToPos[t];
        return {
          p: [p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2]],
          u: uv[t * 2] / 65535,
          v: uv[t * 2 + 1] / 65535,
        };
      });
    });
    if (rows.length >= 4 && rows.every((r) => r.length === 3)) strips.push(rows);
  }
  return strips;
}

function refitStrips(strips, body, f, hHead, reach, axis, style) {
  const k = f.k;
  const mm = k / 1000;
  const eyeY = f.eye[1];
  const neckY = body.joint("neck_01")[1];
  const shoulderY = body.joint("upperarm_l")[1];
  const skullAxisR = (bearing) => {
    const u = unit([Math.sin(bearing) * f.radii[0], 0, Math.cos(bearing) * f.radii[2]]);
    return Math.hypot(u[0], u[2]) * f.bone(u);
  };

  strips.forEach((rows, sIdx) => {
    const R = rows.length;
    const maxY = Math.max(...rows.map((row) => row[1].p[1] - f.centre[1]));
    const xs = rows.map((row) => row[1].p[0]);
    const isCrown = maxY > 0.062 * k || Math.max(...xs) - Math.min(...xs) > 0.095 * k;
    const rndA = hash1(sIdx * 37 + 11) - 0.5;
    const rndB = hash1(sIdx * 53 + 29) - 0.5;

    const C = rows.map((row) => [
      0.25 * row[0].p[0] + 0.5 * row[1].p[0] + 0.25 * row[2].p[0],
      0.25 * row[0].p[1] + 0.5 * row[1].p[1] + 0.25 * row[2].p[1],
      0.25 * row[0].p[2] + 0.5 * row[1].p[2] + 0.25 * row[2].p[2],
    ]);
    const hwAuth = rows.map((row) => 0.5 * length(sub(row[2].p, row[0].p)));

    const onForehead = C.map((pt) => {
      const a = f.aim(pt);
      return pt[2] > f.centre[2] + 0.22 * f.radii[2] && Math.abs(a.phi) < 54 * DEG && pt[1] > eyeY - 0.008 * k;
    });

    const smoothC = C.map((pt) => pt.slice());
    for (let r = 1; r < R - 1; r++) {
      if (onForehead[r]) continue;
      for (let d = 0; d < 3; d++) {
        smoothC[r][d] = 0.22 * C[r - 1][d] + 0.56 * C[r][d] + 0.22 * C[r + 1][d];
      }
    }
    for (let r = 0; r < R; r++) C[r] = smoothC[r];

    const endsHighBack = C[R - 1][1] - f.centre[1] > -0.125 * k && C[R - 1][2] - f.centre[2] < -0.05 * k;
    if (endsHighBack) {
      const y4 = C[4][1], z4 = C[4][2], x4 = C[4][0];
      const yBot = f.centre[1] - 0.195 * k;
      const zBot = f.centre[2] + 0.008 * k;
      for (let r = 5; r < R; r++) {
        const t = (r - 4) / (R - 5);
        C[r][0] = mix(x4, x4 + 0.012 * k, t);
        C[r][1] = mix(y4, yBot, t ** 0.95);
        C[r][2] = mix(z4, zBot, smooth(0, 1, t));
      }
    }

    const hemJitter = 8 * mm * rndA;
    for (let r = 5; r < R; r++) {
      C[r][1] += hemJitter * smooth(4, R - 1, r);
    }

    for (let r = 0; r < R; r++) {
      const pt = C[r];
      const o = hHead.over(pt);
      const t = r / (R - 1);
      const absPhi = Math.abs(o.phi);
      const isBack = smooth(95 * DEG, 150 * DEG, absPhi);
      const templeArch = smooth(25 * DEG, 58 * DEG, absPhi) * smooth(105 * DEG, 72 * DEG, absPhi) * smooth(10 * DEG, 36 * DEG, o.eps);
      const sweptBoost = smooth(-0.04 * k, 0.06 * k, pt[0]) * mix(4.5, 2.0, isBack) * mm;

      if (o.eps > 10 * DEG) {
        const knee = mix(isCrown ? 9.0 : 7.0, isCrown ? 7.5 : 5.5, isBack) * mm;
        const ceil = mix(isCrown ? 16.5 : 13.0, isCrown ? 12.2 : 10.0, isBack) * mm
          + templeArch * 3.2 * mm
          + sweptBoost * smooth(10 * DEG, 45 * DEG, o.eps);
        let h = o.h;
        if (onForehead[r]) {
          const archLift = 2.8 * mm * smooth(48 * DEG, 12 * DEG, absPhi);
          h = h > 6.5 * mm ? 6.5 * mm + 7.5 * mm * Math.tanh((h - 6.5 * mm) / (14 * mm)) : h;
          h += archLift;
        } else if (h > knee) {
          h = knee + (ceil - knee) * Math.tanh((h - knee) / (13 * mm));
        }
        const minH = (r === 0 ? 4.2 : 5.8) * mm + templeArch * 2.2 * mm;
        h = Math.max(minH, h);
        const nr = o.r - o.h + h;
        C[r] = [f.centre[0] + o.u[0] * nr, f.centre[1] + o.u[1] * nr, f.centre[2] + o.u[2] * nr];
      } else {
        const dx = pt[0] - axis[0];
        const dz = pt[2] - axis[1];
        const bearing = Math.atan2(dx, dz);
        const absB = Math.abs(bearing);
        const backMask = smooth(105 * DEG, 155 * DEG, absB);
        let rad = Math.hypot(dx, dz);
        const y = pt[1];
        const earZone = smooth(eyeY - 0.045 * k, eyeY - 0.01 * k, y) * smooth(eyeY + 0.045 * k, eyeY + 0.015 * k, y);
        const skullR = skullAxisR(bearing);
        const bodyR = Math.max(
          reach(y, bearing),
          y > neckY ? skullR * mix(0.84, 1.0, smooth(neckY, f.centre[1], y)) : 0,
        );
        const clear = (y > neckY ? 6.5 : 9.0) * mm + earZone * 4.0 * mm;
        const minR = bodyR + clear;
        const headBasedMax = skullR
          + mix(mix(16, 26, smooth(0.25, 0.85, t)), mix(11, 19, smooth(0.25, 0.85, t)), backMask) * mm
          + (isCrown ? 3.5 * mm : 0)
          + sweptBoost * 0.6;
        const maxR = Math.max(minR + 7 * mm, headBasedMax);
        const knee = minR + Math.min(7 * mm, 0.45 * (maxR - minR));
        if (rad > knee) {
          rad = knee + (maxR - knee) * Math.tanh((rad - knee) / (22 * mm));
        }
        rad = Math.max(minR, rad);
        C[r] = [axis[0] + rad * Math.sin(bearing), y, axis[1] + rad * Math.cos(bearing)];
      }
    }

    for (let r = R - 2; r >= 2; r--) {
      if (C[r][1] >= f.centre[1]) continue;
      const rCur = Math.hypot(C[r][0] - axis[0], C[r][2] - axis[1]);
      const rNext = Math.hypot(C[r + 1][0] - axis[0], C[r + 1][2] - axis[1]);
      const dy = Math.max(0, C[r][1] - C[r + 1][1]);
      const minSlopeR = rNext - 0.85 * dy;
      if (rCur < minSlopeR) {
        const b = Math.atan2(C[r][0] - axis[0], C[r][2] - axis[1]);
        C[r][0] = axis[0] + minSlopeR * Math.sin(b);
        C[r][2] = axis[1] + minSlopeR * Math.cos(b);
      }
    }

    let signVote = 0;
    for (let r = 1; r <= Math.min(4, R - 2); r++) {
      const Tdir = unit(sub(C[r + 1], C[r - 1]));
      const Nout = volumeNormal(C[r], f, axis);
      const Snat = unit(cross(Nout, Tdir));
      const Sauth = sub(rows[r][2].p, rows[r][0].p);
      signVote += dot(Snat, Sauth);
    }
    const sSign = signVote >= 0 ? 1 : -1;

    const midPt = C[Math.floor(R * 0.55)];
    const stripPhi = Math.atan2(midPt[0] - axis[0], midPt[2] - axis[1]);
    const wavePhase = stripPhi * 1.15 + (isCrown ? 0.55 : 0) + 0.35 * rndB;

    for (let r = 0; r < R; r++) {
      const t = r / (R - 1);
      const Tdir = unit(sub(C[Math.min(R - 1, r + 1)], C[Math.max(0, r - 1)]));
      let Nout = volumeNormal(C[r], f, axis);
      Nout = unit(add(Nout, Tdir, -dot(Nout, Tdir)));
      const Snat = unit(cross(Nout, Tdir)).map((x) => x * sSign);

      let Sauth = sub(rows[r][2].p, rows[r][0].p);
      Sauth = add(Sauth, Tdir, -dot(Sauth, Tdir));
      const SauthLen = length(Sauth);
      let roll = 0;
      if (SauthLen > 1e-5) {
        const su = Sauth.map((x) => x / SauthLen);
        const cosA = clamp(dot(su, Snat), -1, 1);
        const sinA = clamp(dot(su, Nout), -1, 1);
        const authRoll = Math.atan2(sinA, cosA);
        const maxRoll = mix(20 * DEG, 10 * DEG, smooth(0.25, 0.65, t));
        roll = clamp(authRoll, -maxRoll, maxRoll) * mix(0.65, 0.18, smooth(0.35, 0.75, t));
      }

      const absMidPhi = Math.abs(stripPhi);
      const backCalm = mix(1.0, 0.62, smooth(130 * DEG, 175 * DEG, absMidPhi));
      const waveRamp = smooth(0.24, 0.62, t);
      const waveAngle = wavePhase + t * TAU * 1.65;
      const swaySide = 10.8 * mm * backCalm * waveRamp * Math.sin(waveAngle);
      const swayOut = 6.8 * mm * waveRamp * Math.cos(waveAngle);
      const tipCurl = (-5.5 + 3.2 * Math.sin(stripPhi * 2.2)) * mm * smooth(0.74, 1.0, t);
      roll += 13 * DEG * waveRamp * Math.sin(waveAngle + 0.45);

      const S = unit(add(Snat.map((x) => x * Math.cos(roll)), Nout, Math.sin(roll)));
      const Nloc = unit(cross(Tdir, S)).map((x) => x * sSign);

      const tipTaper = 1 - 0.44 * (smooth(0.66, 1.0, t) ** 1.25);
      const hw = clamp(hwAuth[r], 24 * mm, 33 * mm) * tipTaper;
      const camber = 4.6 * mm * smooth(0.0, 0.22, t) * mix(1.0, 0.52, smooth(0.76, 1.0, t));

      const center = add(add(C[r], Snat, swaySide), Nout, swayOut + tipCurl);
      const pts = [
        add(center, S, -hw),
        add(center, Nloc, camber),
        add(center, S, hw),
      ];

      for (let c = 0; c < 3; c++) {
        let q = pts[c];
        const minGap = q[1] > neckY ? 3.8 * mm : q[1] > shoulderY - 0.04 * k ? 7.5 * mm : 9.0 * mm;
        q = body.clear(q, minGap);
        if (style.fringe && style.fringe !== "As cut" && q[2] > f.centre[2] + 0.35 * f.radii[2]) {
          const at = f.over(q);
          if (Math.abs(at.phi) < 42 * DEG && at.eps < hairline(at.phi) - 2 * DEG && q[1] > eyeY - 0.03 * k) {
            const pushSign = at.phi >= 0 ? 1 : -1;
            const outPhi = pushSign * mix(44 * DEG, 52 * DEG, smooth(eyeY + 0.03 * k, eyeY - 0.02 * k, q[1]));
            q = f.clear(f.place(outPhi, at.eps, Math.max(4.5 * mm, at.h)), 4.0 * mm);
          }
        }
        rows[r][c].p = q;
      }
    }

    let uMax = -Infinity;
    for (const row of rows) for (const v of row) uMax = Math.max(uMax, v.u);
    const uCeil = isCrown ? 0.556 : 0.528;
    const uShift = uMax > uCeil ? uCeil - uMax : 0;
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = rows[r][c];
        cell.u = clamp(cell.u + uShift, 0.015, uCeil);
        cell.v = clamp(0.33 + 0.655 * cell.v, 0.33, 0.988);
      }
    }
    rows.stripTone = 0.96 + 0.09 * hash1(sIdx * 71 + 5);
  });
}

function buildExteriorGeometry(strips, f, axis, style, plain) {
  const posList = [];
  const uvList = [];
  const triList = [];
  const uvTriList = [];
  const stripMeta = [];

  for (const rows of strips) {
    const base = posList.length / 3;
    const R = rows.length;
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < 3; c++) {
        posList.push(...rows[r][c].p);
        uvList.push(Math.round(rows[r][c].u * 65535), Math.round(rows[r][c].v * 65535));
      }
    }
    let outDot = 0;
    const a = new T.Vector3(), b = new T.Vector3(), d = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3(), fn = new T.Vector3();
    for (let r = 1; r < Math.min(6, R - 1); r++) {
      const i0 = base + r * 3, i1 = i0 + 1, i2 = i0 + 3;
      a.fromArray(posList, i0 * 3);
      b.fromArray(posList, i1 * 3);
      d.fromArray(posList, i2 * 3);
      e1.subVectors(b, a);
      e2.subVectors(d, a);
      fn.crossVectors(e1, e2);
      const vn = volumeNormal([a.x, a.y, a.z], f, axis);
      outDot += fn.x * vn[0] + fn.y * vn[1] + fn.z * vn[2];
    }
    const flip = outDot < 0;
    const triStart = triList.length / 3;
    for (let r = 0; r < R - 1; r++) {
      for (let c = 0; c < 2; c++) {
        const v00 = base + r * 3 + c;
        const v01 = v00 + 1;
        const v10 = v00 + 3;
        const v11 = v10 + 1;
        if (flip) {
          triList.push(v00, v10, v01, v01, v10, v11);
          uvTriList.push(v00, v10, v01, v01, v10, v11);
        } else {
          triList.push(v00, v01, v10, v01, v11, v10);
          uvTriList.push(v00, v01, v10, v01, v11, v10);
        }
      }
    }
    stripMeta.push({ triStart, triEnd: triList.length / 3, tone: rows.stripTone ?? 1 });
  }

  const posArr = new Float32Array(posList);
  if (style.fringe) settleFringe(posArr, f, style.fringe);
  const corners = Uint16Array.from(triList);
  const uvCorners = Uint16Array.from(uvTriList);
  const packedUV = Uint16Array.from(uvList);

  const geo = smoothHairCards(posArr, corners, uvCorners, packedUV);
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uvAttr = geo.attributes.uv;
  const idx = geo.index.array;

  const vertTone = new Float32Array(pos.count).fill(1);
  for (const { triStart, triEnd, tone } of stripMeta) {
    const start = triStart * 12, end = triEnd * 12;
    for (let i = start; i < end && i < idx.length; i++) vertTone[idx[i]] = tone;
  }

  const colors = plain ? null : new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const pt = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const vn = volumeNormal(pt, f, axis);
    let nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i);
    if (nx * vn[0] + ny * vn[1] + nz * vn[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const blended = unit([mix(nx, vn[0], 0.66), mix(ny, vn[1], 0.66), mix(nz, vn[2], 0.66)]);
    norm.setXYZ(i, blended[0], blended[1], blended[2]);
    if (colors) {
      const v = uvAttr.getY(i);
      const along = mix(0.95, 0.85, smooth(0.72, 0.98, v)) * mix(0.93, 1.02, smooth(0.33, 0.56, v));
      const ao = clamp(along * vertTone[i], 0.72, 1.0);
      colors[i * 3] = ao;
      colors[i * 3 + 1] = ao;
      colors[i * 3 + 2] = ao;
    }
  }
  if (colors) geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  return geo;
}

function buildInnerSurface(extGeo, body, f, hHead, reach, axis, style, plain) {
  const k = f.k;
  const mm = k / 1000;
  const eyeY = f.eye[1];
  const neckY = body.joint("neck_01")[1];
  const shoulderY = body.joint("upperarm_l")[1];

  const BINS = 36;
  const Y_BANDS = 14;
  const yTop = f.top + 0.025 * k;
  const yBot = f.centre[1] - 0.26 * k;
  const extR = new Float32Array(BINS * Y_BANDS);
  const extHemY = new Float32Array(BINS).fill(f.centre[1] - 0.14 * k);
  const extCapH = new Float32Array(BINS).fill(9 * mm);
  const capCount = new Float32Array(BINS);

  const ePos = extGeo.attributes.position;
  for (let i = 0; i < ePos.count; i++) {
    const pt = [ePos.getX(i), ePos.getY(i), ePos.getZ(i)];
    const dx = pt[0] - axis[0];
    const dz = pt[2] - axis[1];
    const phi = Math.atan2(dx, dz);
    const b = ((Math.floor(((phi + Math.PI) / TAU) * BINS) % BINS) + BINS) % BINS;
    const rad = Math.hypot(dx, dz);
    const yb = clamp(Math.floor(((yTop - pt[1]) / (yTop - yBot)) * Y_BANDS), 0, Y_BANDS - 1);
    if (rad > extR[b * Y_BANDS + yb]) extR[b * Y_BANDS + yb] = rad;
    if (pt[1] < extHemY[b]) extHemY[b] = pt[1];
    const o = hHead.over(pt);
    if (o.eps > 22 * DEG && o.h > 2 * mm && o.h < 35 * mm) {
      extCapH[b] = (extCapH[b] * capCount[b] + o.h) / (capCount[b] + 1);
      capCount[b]++;
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    const nextHem = extHemY.slice();
    const nextCap = extCapH.slice();
    const nextR = extR.slice();
    for (let b = 0; b < BINS; b++) {
      const bl = (b + BINS - 1) % BINS, br = (b + 1) % BINS;
      nextHem[b] = 0.25 * extHemY[bl] + 0.5 * extHemY[b] + 0.25 * extHemY[br];
      nextCap[b] = 0.25 * extCapH[bl] + 0.5 * extCapH[b] + 0.25 * extCapH[br];
      for (let yb = 0; yb < Y_BANDS; yb++) {
        const cur = extR[b * Y_BANDS + yb];
        const l = extR[bl * Y_BANDS + yb], r = extR[br * Y_BANDS + yb];
        nextR[b * Y_BANDS + yb] = cur > 0 ? 0.2 * l + 0.6 * cur + 0.2 * r : 0.5 * (l + r);
      }
    }
    extHemY.set(nextHem);
    extCapH.set(nextCap);
    extR.set(nextR);
  }

  const sampleBin = (arr, phi, stride = 1, offset = 0) => {
    const fc = ((((phi + Math.PI) / TAU) * BINS - 0.5) % BINS + BINS) % BINS;
    const b0 = Math.floor(fc) % BINS, b1 = (b0 + 1) % BINS, t = fc - Math.floor(fc);
    return mix(arr[b0 * stride + offset], arr[b1 * stride + offset], t);
  };
  const sampleExtR = (phi, y) => {
    const fy = clamp(((yTop - y) / (yTop - yBot)) * Y_BANDS - 0.5, 0, Y_BANDS - 1.001);
    const y0 = Math.floor(fy), y1 = y0 + 1, ty = fy - y0;
    return mix(sampleBin(extR, phi, Y_BANDS, y0), sampleBin(extR, phi, Y_BANDS, y1), ty);
  };

  const pos = [];
  const norm = [];
  const uv = [];
  const col = plain ? null : [];
  const idx = [];

  const pushVert = (pt, uCoord, vCoord, shade) => {
    const id = pos.length / 3;
    pos.push(pt[0], pt[1], pt[2]);
    const n = volumeNormal(pt, f, axis);
    norm.push(n[0], n[1], n[2]);
    uv.push(uCoord, vCoord);
    if (col) col.push(shade, shade, shade);
    return id;
  };

  {
    const COLS = 24, ROWS = 5;
    const partPhi = style.fringe === "Swept left" ? -20 * DEG : style.fringe === "Swept right" ? 20 * DEG : 0;
    const frontRecess = style.fringe === "Off the face" ? 15 * DEG : 12 * DEG;
    const grid = [];
    for (let r = 0; r <= ROWS; r++) {
      const tr = r / ROWS;
      const rowIds = [];
      for (let c = 0; c <= COLS; c++) {
        const tc = c / COLS;
        const phi = -Math.PI + tc * TAU;
        const absPhi = Math.abs(phi);
        const frontGuard = mix(frontRecess, 3 * DEG, smooth(28 * DEG, 76 * DEG, absPhi));
        const partDip = 4 * DEG * Math.exp(-(((phi - partPhi) / (20 * DEG)) ** 2)) * smooth(62 * DEG, 15 * DEG, absPhi);
        const edgeEps = Math.max(
          hairline(phi) + frontGuard + partDip,
          absPhi < 115 * DEG ? (f.earElevation ?? -4 * DEG) + 4 * DEG : -34 * DEG,
        );
        const eps = mix(89 * DEG, edgeEps, tr ** 0.92);
        const capAvg = clamp(sampleBin(extCapH, phi), 6.5 * mm, 12.5 * mm);
        const edgeTaper = smooth(1.0, 0.55, tr);
        const waveFlute = 1.0 * mm * Math.sin(phi * 11 + tr * 3.5) * smooth(0.15, 0.55, tr) * edgeTaper;
        const h = mix(1.2 * mm, Math.max(3.8 * mm, capAvg - 3.6 * mm), edgeTaper) + waveFlute;
        let pt = hHead.place(phi, eps, h);
        pt = body.clear(pt, 1.4 * mm);
        const uCycle = (tc * 3) % 2;
        const uCoord = mix(0.06, 0.44, uCycle <= 1 ? uCycle : 2 - uCycle);
        const vCoord = mix(0.95, 0.58, tr);
        const shade = mix(0.74, 0.62, smooth(0.15, 0.95, tr));
        rowIds.push(pushVert(pt, uCoord, vCoord, shade));
      }
      grid.push(rowIds);
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = grid[r][c], b = grid[r][c + 1], d = grid[r + 1][c], e = grid[r + 1][c + 1];
        idx.push(a, d, b, b, d, e);
      }
    }
  }

  {
    const COLS = 24, ROWS = 8;
    const openPhi = 62 * DEG;
    const phiSpan = TAU - 2 * openPhi;
    const skullAxisR = (bearing) => {
      const u = unit([Math.sin(bearing) * f.radii[0], 0, Math.cos(bearing) * f.radii[2]]);
      return Math.hypot(u[0], u[2]) * f.bone(u);
    };
    const grid = [];
    for (let c = 0; c <= COLS; c++) {
      const tc = c / COLS;
      let phi = openPhi + tc * phiSpan;
      if (phi > Math.PI) phi -= TAU;
      const sideEdge = Math.min(tc, 1 - tc);
      const edgeTuck = smooth(0, 0.16, sideEdge);
      const backMask = smooth(105 * DEG, 155 * DEG, Math.abs(phi));

      const topEps = mix(34 * DEG, 46 * DEG, smooth(60 * DEG, 150 * DEG, Math.abs(phi)));
      const topPt = hHead.place(phi, topEps, 4.5 * mm);
      const yStart = topPt[1];
      const outerHem = sampleBin(extHemY, phi);
      const waveScallop = 7 * mm * Math.sin(phi * 7 + 0.9);
      const yEnd = Math.min(yStart - 0.09 * k, outerHem + 28 * mm + waveScallop + (1 - edgeTuck) * 28 * mm);

      const colIds = [];
      for (let r = 0; r <= ROWS; r++) {
        const tr = r / ROWS;
        const y = mix(yStart, yEnd, tr);
        const swayPhi = phi + (2.5 * DEG) * Math.sin(tr * TAU * 1.2 + phi * 3) * smooth(0.2, 0.8, tr) * edgeTuck;

        let pt;
        if (tr < 0.28) {
          const eps = mix(topEps, 8 * DEG, tr / 0.28);
          const h = mix(4.2 * mm, 6.8 * mm, tr / 0.28) * mix(0.65, 1.0, edgeTuck);
          pt = hHead.place(swayPhi, eps, h);
        } else {
          const extRad = sampleExtR(swayPhi, y);
          const earZone = smooth(eyeY - 0.045 * k, eyeY - 0.01 * k, y) * smooth(eyeY + 0.045 * k, eyeY + 0.015 * k, y);
          const bodyR = reach(y, swayPhi);
          const clear = (y > neckY ? 5.0 : y > shoulderY - 0.04 * k ? 7.5 : 8.5) * mm + earZone * 4.0 * mm;
          const minR = bodyR + clear;
          const slimCap = Math.max(minR + 3 * mm, skullAxisR(swayPhi) + mix(14, 9, backMask) * mm);
          const recess = mix(5.5, 9.5, smooth(0.3, 0.9, tr)) * mm + (1 - edgeTuck) * 5.0 * mm + smooth(0.75, 1.0, tr) * 5.5 * mm;
          const flute = 1.8 * mm * Math.sin(phi * 13 + tr * 5.5) * edgeTuck * (1 - 0.5 * smooth(0.8, 1.0, tr));
          let rad = extRad > minR + 2 * mm ? Math.min(extRad - recess, slimCap) + flute : minR + 3.5 * mm + flute;
          rad = Math.max(minR, rad);
          if (extRad > minR + 3 * mm) rad = Math.min(rad, extRad - 3.2 * mm);
          pt = [axis[0] + rad * Math.sin(swayPhi), y, axis[1] + rad * Math.cos(swayPhi)];
        }
        pt = body.clear(pt, y > neckY ? 3.5 * mm : 6.8 * mm);

        const uCycle = (tc * 3.5) % 2;
        const uCoord = mix(0.05, 0.46, uCycle <= 1 ? uCycle : 2 - uCycle);
        const vCoord = mix(0.94, 0.48, tr);
        const shade = mix(0.72, 0.58, smooth(0.15, 0.85, tr)) * mix(0.88, 1.0, edgeTuck);
        colIds.push(pushVert(pt, uCoord, vCoord, shade));
      }
      grid.push(colIds);
    }
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const a = grid[c][r], b = grid[c + 1][r], d = grid[c][r + 1], e = grid[c + 1][r + 1];
        idx.push(a, d, b, b, d, e);
      }
    }
  }

  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new T.Float32BufferAttribute(norm, 3));
  geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  if (col) geo.setAttribute("color", new T.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

function mergeParts(a, b) {
  const names = ["position", "normal", "uv", ...(a.attributes.color ? ["color"] : [])];
  const out = new T.BufferGeometry();
  const aCount = a.attributes.position.count;
  for (const name of names) {
    const aa = a.attributes[name], ba = b.attributes[name];
    const data = new Float32Array(aa.array.length + ba.array.length);
    data.set(aa.array, 0);
    data.set(ba.array, aa.array.length);
    out.setAttribute(name, new T.Float32BufferAttribute(data, aa.itemSize));
  }
  const ai = a.index.array, bi = b.index.array;
  const index = new Uint32Array(ai.length + bi.length);
  index.set(ai, 0);
  for (let i = 0; i < bi.length; i++) index[ai.length + i] = bi[i] + aCount;
  out.setIndex(new T.BufferAttribute(index, 1));
  a.dispose();
  b.dispose();
  return out;
}

export function buildLooseWaves(surface, fittedPositions, corners, uvCorners, uv, style = {}, plain = false) {
  const body = surfaceBody(surface);
  const f = surfaceFrame(surface);
  const hHead = hatHead(f);
  const k = f.k;
  const neck = body.joint("neck_01");
  const axis = [0, (f.centre[2] + neck[2]) * 0.5];
  const reach = bodyReach(body, axis, f.centre[1] + 0.03 * k, body.joint("upperarm_l")[1] - 0.3 * k, k);

  const strips = extractStrips(fittedPositions, corners, uvCorners, uv);
  refitStrips(strips, body, f, hHead, reach, axis, style);
  const exterior = buildExteriorGeometry(strips, f, axis, style, plain);
  const inner = buildInnerSurface(exterior, body, f, hHead, reach, axis, style, plain);
  softenWaveEdge(exterior,f);
  return mergeParts(exterior, inner);
}
