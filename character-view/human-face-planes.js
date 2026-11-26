import { clamp, cross, dot, length, mix, smooth, sub, unit } from "./human-style-kit.js";
import { surfaceFrame } from "./human-fringe.js";

export const facePlaneStyles = ["None", "Subtle", "Sculpted"];

const MODE_STRENGTH = {
  Subtle: { normal: 0.42, shade: 0.045, planeContrast: 0.028 },
  Sculpted: { normal: 0.68, shade: 0.078, planeContrast: 0.048 },
};

const DEG = Math.PI / 180;

function landmarkWeights(positions, origin, f) {
  const count = positions.length / 3;
  const weights = new Float32Array(count);
  const k = f.k;
  const eyeY = f.eye[1];
  const eyeZ = f.eye[2];
  const eyes = f.eyes;

  for (let i = 0; i < count; i++) {
    const wx = positions[i * 3] + origin[0];
    const wy = positions[i * 3 + 1] + origin[1];
    const wz = positions[i * 3 + 2] + origin[2];
    const at = f.aim([wx, wy, wz]);
    const absPhi = Math.abs(at.phi) / DEG;
    const eps = at.eps / DEG;

    const frontMask = smooth(84, 58, absPhi) * smooth(-68, -42, eps) * smooth(42, 22, eps);
    if (frontMask <= 1e-4) continue;

    let eyeClear = 1.0;
    for (const e of eyes) {
      const dPhi = (at.phi - e.phi) / Math.max(5 * DEG, e.wide * 1.95);
      const dEps = (at.eps - e.eps) / Math.max(4.5 * DEG, e.tall * 2.15);
      const dist = Math.hypot(dPhi, dEps);
      eyeClear *= smooth(0.85, 1.38, dist);
    }
    if (eyeClear <= 1e-4) continue;

    const mouthY = eyeY - 0.064 * k;
    const dxMouth = Math.abs(wx) / (0.036 * k);
    const dyMouth = (wy - mouthY) / (0.020 * k);
    const mouthClear = smooth(0.85, 1.42, Math.hypot(dxMouth, dyMouth));

    const brow = Math.exp(-(((wy - (eyeY + 0.020 * k)) / (0.017 * k)) ** 2)) * smooth(62, 12, absPhi);
    const nose =
      smooth(0.024 * k, 0.008 * k, Math.abs(wx)) *
      smooth(eyeY - 0.044 * k, eyeY - 0.022 * k, wy) *
      smooth(eyeY + 0.022 * k, eyeY + 0.004 * k, wy) *
      smooth(eyeZ - 0.01 * k, eyeZ + 0.01 * k, wz);
    const cheek =
      Math.exp(-(((Math.abs(wx) - 0.048 * k) / (0.024 * k)) ** 2)) *
      Math.exp(-(((wy - (eyeY - 0.024 * k)) / (0.022 * k)) ** 2));
    const jaw =
      smooth(eyeY - 0.042 * k, eyeY - 0.072 * k, wy) *
      smooth(eyeY - 0.132 * k, eyeY - 0.100 * k, wy) *
      smooth(78, 38, absPhi);

    const structural = clamp(0.28 + 0.85 * Math.max(brow, nose, cheek, jaw), 0, 1);
    weights[i] = frontMask * eyeClear * mouthClear * structural;
  }
  return weights;
}

export function applyFacePlanes(geometry, cage, origin, mode = "None", tinted = true) {
  const cfg = MODE_STRENGTH[mode];
  if (!cfg || !geometry?.attributes?.position || !geometry?.attributes?.normal || !geometry?.index) return false;

  const f = surfaceFrame(cage);
  const pos = geometry.attributes.position.array;
  const nrm = geometry.attributes.normal.array;
  const col = tinted ? geometry.attributes.color?.array : null;
  const idx = geometry.index.array;
  const count = pos.length / 3;

  const mask = landmarkWeights(pos, origin, f);

  const planeN = new Float32Array(count * 3);
  const avgPos = new Float32Array(count * 3);
  const deg = new Float32Array(count);

  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    const fn = cross([bx - ax, by - ay, bz - az], [cx - ax, cy - ay, cz - az]);
    const area2 = length(fn);
    if (area2 < 1e-12) continue;
    const ufn = [fn[0] / area2, fn[1] / area2, fn[2] / area2];

    const verts = [a, b, c];
    for (let m = 0; m < 3; m++) {
      const v = verts[m];
      if (mask[v] <= 1e-4) continue;
      const vn = [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]];
      const align = Math.max(0, dot(ufn, vn));
      const w = area2 * (align ** 5 + 0.02);
      planeN[v * 3] += ufn[0] * w;
      planeN[v * 3 + 1] += ufn[1] * w;
      planeN[v * 3 + 2] += ufn[2] * w;

      const nb = verts[(m + 1) % 3];
      avgPos[v * 3] += pos[nb * 3];
      avgPos[v * 3 + 1] += pos[nb * 3 + 1];
      avgPos[v * 3 + 2] += pos[nb * 3 + 2];
      deg[v] += 1;
    }
  }

  const k = f.k;
  for (let i = 0; i < count; i++) {
    const w = mask[i];
    if (w <= 1e-4) continue;

    const sn = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
    const pnLen = Math.hypot(planeN[i * 3], planeN[i * 3 + 1], planeN[i * 3 + 2]);
    let outN = sn;
    if (pnLen > 1e-9) {
      const pn = [planeN[i * 3] / pnLen, planeN[i * 3 + 1] / pnLen, planeN[i * 3 + 2] / pnLen];
      const qn = unit([
        Math.sign(pn[0]) * Math.abs(pn[0]) ** 0.82,
        Math.sign(pn[1]) * Math.abs(pn[1]) ** 0.85,
        Math.sign(pn[2]) * Math.abs(pn[2]) ** 0.86,
      ]);
      const blend = w * cfg.normal;
      outN = unit([
        mix(sn[0], qn[0], blend),
        mix(sn[1], qn[1], blend),
        mix(sn[2], qn[2], blend),
      ]);
      nrm[i * 3] = outN[0];
      nrm[i * 3 + 1] = outN[1];
      nrm[i * 3 + 2] = outN[2];
    }

    if (col && deg[i] > 0) {
      const dx = pos[i * 3] - avgPos[i * 3] / deg[i];
      const dy = pos[i * 3 + 1] - avgPos[i * 3 + 1] / deg[i];
      const dz = pos[i * 3 + 2] - avgPos[i * 3 + 2] / deg[i];
      const curv = clamp(((dx * sn[0] + dy * sn[1] + dz * sn[2]) / (0.0022 * k)), -1, 1);

      const sideTurn = smooth(0.32, 0.78, Math.abs(outN[0]));
      const underTurn = smooth(-0.08, -0.58, outN[1]);
      const delta = w * (cfg.shade * curv - cfg.planeContrast * (0.45 * sideTurn + 0.85 * underTurn));

      const rMul = 1 + delta * 1.06;
      const gMul = 1 + delta * 0.98;
      const bMul = 1 + delta * 0.88;
      col[i * 3] = clamp(col[i * 3] * rMul, 0, 1);
      col[i * 3 + 1] = clamp(col[i * 3 + 1] * gMul, 0, 1);
      col[i * 3 + 2] = clamp(col[i * 3 + 2] * bMul, 0, 1);
    }
  }

  geometry.attributes.normal.needsUpdate = true;
  if (col) geometry.attributes.color.needsUpdate = true;
  return true;
}
