import browLayout from "./human-brow-paint.json" with {type:"json"};
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import data from "./human-complexion-data.json" with { type: "json" };
import { evaluateHuman, smoothHumanSurface } from "./human-surface.js";

const layout = 2048,
  [left, top, right, bottom] = data.rect;
export const chartWidth = right - left,
  chartHeight = bottom - top,
  chartDensity = 2;
const W = chartWidth,
  H = chartHeight;

const smooth = (v, a, b) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function unpack(text) {
  const bytes = unzlibSync(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
  return Float32Array.from(
    new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2),
    (v) => v / 65535,
  );
}

function distanceFrom(marked) {
  const far = 1e6,
    d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = marked[i] ? 0 : far;
  const pass = (from, to, step) => {
    for (let y = from; y !== to; y += step)
      for (let x = from === 0 ? 0 : W - 1; x >= 0 && x < W; x += step) {
        const i = y * W + x;
        let best = d[i];
        if (x - step >= 0 && x - step < W) best = Math.min(best, d[i - step] + 1);
        const yy = y - step;
        if (yy >= 0 && yy < H) {
          best = Math.min(best, d[i - step * W] + 1);
          if (x - step >= 0 && x - step < W) best = Math.min(best, d[i - step * W - step] + 1.414);
          if (x + step >= 0 && x + step < W) best = Math.min(best, d[i - step * W + step] + 1.414);
        }
        d[i] = best;
      }
  };
  pass(0, H, 1);
  pass(H - 1, -1, -1);
  return d;
}

let charted;
export function faceChart() {
  if (charted) return charted;
  const s = smoothHumanSurface(evaluateHuman({}));
  const n = W * H,
    x = new Float32Array(n),
    y = new Float32Array(n),
    z = new Float32Array(n),
    lip = new Float32Array(n),
    lid = new Float32Array(n),
    hit = new Uint8Array(n);
  const P = [0, 0, 0, 0, 0, 0],
    Q = new Float32Array(15);
  for (let c = 0; c < s.bodyTriangles * 3; c += 3) {
    for (let k = 0; k < 3; k++) {
      const v = s.indices[c + k],
        t = s.uvFaces[c + k];
      P[k * 2] = (s.uv[t * 2] / 65535) * layout - left;
      P[k * 2 + 1] = (1 - s.uv[t * 2 + 1] / 65535) * layout - top;
      Q[k * 5] = s.positions[v * 3];
      Q[k * 5 + 1] = s.positions[v * 3 + 1];
      Q[k * 5 + 2] = s.positions[v * 3 + 2];
      Q[k * 5 + 3] = Math.max(s.pigments[t * 4], s.pigments[t * 4 + 2]) / 255;
      Q[k * 5 + 4] = s.pigments[t * 4 + 1] / 255;
    }
    const x0 = Math.max(0, Math.floor(Math.min(P[0], P[2], P[4]))),
      x1 = Math.min(W - 1, Math.ceil(Math.max(P[0], P[2], P[4]))),
      y0 = Math.max(0, Math.floor(Math.min(P[1], P[3], P[5]))),
      y1 = Math.min(H - 1, Math.ceil(Math.max(P[1], P[3], P[5])));
    if (x1 < x0 || y1 < y0) continue;
    const det = (P[2] - P[0]) * (P[5] - P[1]) - (P[4] - P[0]) * (P[3] - P[1]);
    if (Math.abs(det) < 1e-9) continue;
    for (let j = y0; j <= y1; j++)
      for (let i = x0; i <= x1; i++) {
        const gx = i + 0.5,
          gy = j + 0.5;
        const w1 = ((gx - P[0]) * (P[5] - P[1]) - (P[4] - P[0]) * (gy - P[1])) / det,
          w2 = ((P[2] - P[0]) * (gy - P[1]) - (gx - P[0]) * (P[3] - P[1])) / det,
          w0 = 1 - w1 - w2;
        if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue;
        const at = j * W + i;
        hit[at] = 1;
        x[at] = w0 * Q[0] + w1 * Q[5] + w2 * Q[10];
        y[at] = w0 * Q[1] + w1 * Q[6] + w2 * Q[11];
        z[at] = w0 * Q[2] + w1 * Q[7] + w2 * Q[12];
        lip[at] = w0 * Q[3] + w1 * Q[8] + w2 * Q[13];
        lid[at] = w0 * Q[4] + w1 * Q[9] + w2 * Q[14];
      }
  }
  const near = (px, py) => {
    const fx = Math.min(W - 1.001, Math.max(0, px - 0.5)),
      fy = Math.min(H - 1.001, Math.max(0, py - 0.5)),
      i = Math.floor(fx),
      j = Math.floor(fy),
      a = fx - i,
      b = fy - j;
    const out = [0, 0, 0];
    let total = 0;
    for (const [at, w] of [
      [j * W + i, (1 - a) * (1 - b)],
      [j * W + i + 1, a * (1 - b)],
      [(j + 1) * W + i, (1 - a) * b],
      [(j + 1) * W + i + 1, a * b],
    ]) {
      if (!hit[at]) continue;
      total += w;
      out[0] += w * x[at];
      out[1] += w * y[at];
      out[2] += w * z[at];
    }
    if (total < 1e-6) {
      let best = Infinity;
      for (let dj = -6; dj <= 6; dj++)
        for (let di = -6; di <= 6; di++) {
          const u = i + di,
            v = j + dj;
          if (u < 0 || v < 0 || u >= W || v >= H || !hit[v * W + u]) continue;
          const d = di * di + dj * dj;
          if (d < best) {
            best = d;
            out[0] = x[v * W + u];
            out[1] = y[v * W + u];
            out[2] = z[v * W + u];
          }
        }
      return out;
    }
    return out.map((v) => v / total);
  };

  const lines = data.lids.map((line) => {
    const p = unpack(line.points),
      points = [];
    for (let i = 0; i < p.length; i += 2) points.push([p[i] * W, p[i + 1] * H]);
    return { lower: line.lower, points, mean: points.reduce((sum, q) => sum + q[1], 0) / points.length };
  });
  const middle = lines.reduce((sum, line) => sum + line.mean, 0) / lines.length;
  const eyes = [-1, 1].map((sign) => {
    const mine = lines.filter((line) => Math.sign(line.mean - middle) === sign);
    return { upper: mine.find((line) => !line.lower).points, lower: mine.find((line) => line.lower).points };
  });
  const centre = (eye) => {
    const all = [...eye.upper, ...eye.lower].map(([px, py]) => near(px, py));
    return [0, 1, 2].map((k) => all.reduce((sum, p) => sum + p[k], 0) / all.length);
  };
  const centres = eyes.map(centre),
    eyeY = (centres[0][1] + centres[1][1]) / 2,
    unit = Math.abs(centres[0][0] - centres[1][0]) * 1000;
  for (let i = 0; i < n; i++) {
    x[i] *= 1000;
    y[i] = (y[i] - eyeY) * 1000;
    z[i] *= 1000;
  }
  const spot = near;

  const nx = new Float32Array(n),
    ny = new Float32Array(n),
    nz = new Float32Array(n).fill(1),
    area = new Float32Array(n);
  for (let j = 1; j < H - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      const at = j * W + i;
      if (!hit[at] || !hit[at - 1] || !hit[at + 1] || !hit[at - W] || !hit[at + W]) continue;
      const ax = (x[at + 1] - x[at - 1]) / 2,
        ay = (y[at + 1] - y[at - 1]) / 2,
        az = (z[at + 1] - z[at - 1]) / 2,
        bx = (x[at + W] - x[at - W]) / 2,
        by = (y[at + W] - y[at - W]) / 2,
        bz = (z[at + W] - z[at - W]) / 2;
      let cx = ay * bz - az * by,
        cy = az * bx - ax * bz,
        cz = ax * by - ay * bx;
      const size = Math.hypot(cx, cy, cz);
      area[at] = size;
      if (size < 1e-9) continue;
      if (cz < 0) (cx = -cx), (cy = -cy), (cz = -cz);
      nx[at] = cx / size;
      ny[at] = cy / size;
      nz[at] = cz / size;
    }

  const outside = new Uint8Array(n),
    stack = [];
  const push = (i) => {
    if (!hit[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let i = 0; i < W; i++) push(i), push((H - 1) * W + i);
  for (let j = 0; j < H; j++) push(j * W), push(j * W + W - 1);
  while (stack.length) {
    const i = stack.pop(),
      px = i % W;
    if (px > 0) push(i - 1);
    if (px < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < n - W) push(i + W);
  }
  const shore = distanceFrom(outside),
    skin = new Float32Array(n);
  const [patchX, patchY, patchHalf] = data.mouth.patch,
    keep = patchHalf + 10;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const at = j * W + i;
      if (!hit[at]) continue;
      if (Math.abs(i + 0.5 - patchX) < keep && Math.abs(j + 0.5 - patchY) < keep) continue;
      skin[at] = smooth(Math.min(i, j, W - 1 - i, H - 1 - j), 4, 16) * smooth(shore[at], 2, 9);
    }

  const eye = new Float32Array(n).fill(1e3);
  for (const { upper, lower } of eyes) {
    const ring = [...upper, ...[...lower].reverse()];
    const closed =
      Math.hypot(upper[0][0] - lower[0][0], upper[0][1] - lower[0][1]) <
      Math.hypot(upper[0][0] - lower.at(-1)[0], upper[0][1] - lower.at(-1)[1])
        ? ring
        : [...upper, ...lower];
    const xs = closed.map((p) => p[0]),
      ys = closed.map((p) => p[1]),
      pad = 12;
    for (let j = Math.max(0, Math.floor(Math.min(...ys)) - pad); j <= Math.min(H - 1, Math.ceil(Math.max(...ys)) + pad); j++)
      for (let i = Math.max(0, Math.floor(Math.min(...xs)) - pad); i <= Math.min(W - 1, Math.ceil(Math.max(...xs)) + pad); i++) {
        const px = i + 0.5,
          py = j + 0.5;
        let inside = false,
          best = Infinity;
        for (let k = 0, m = closed.length - 1; k < closed.length; m = k++) {
          const [ax, ay] = closed[k],
            [bx, by] = closed[m];
          if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
          const ex = bx - ax,
            ey = by - ay,
            t = Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1)));
          best = Math.min(best, Math.hypot(px - ax - ex * t, py - ay - ey * t));
        }
        const at = j * W + i;
        eye[at] = Math.min(eye[at], inside ? -best : best);
      }
  }

  const rim = new Float32Array(n),
    wet = new Float32Array(n);
  for (let at = 0; at < n; at++) if (eye[at] < 0 || (eye[at] < 11 && hit[at] && (nz[at] < 0.55 || area[at] === 0))) rim[at] = 1;
  for (let j = 1; j < H - 1; j++)
    for (let i = 1; i < W - 1; i++) {
      const at = j * W + i;
      if (eye[at] > 14) continue;
      let sum = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) sum += rim[at + dj * W + di];
      wet[at] = Math.max(rim[at], sum / 9);
    }

  const leftFirst = centres[0][0] > centres[1][0] ? [0, 1] : [1, 0];
  const sides = leftFirst.map((k) => {
    const { upper, lower } = eyes[k],
      ends = [upper[0], upper.at(-1)].map(([px, py]) => spot(px, py)),
      outerFirst = Math.abs(ends[0][0]) > Math.abs(ends[1][0]);
    return {
      centre: [centres[k][0] * 1000, (centres[k][1] - eyeY) * 1000],
      outer: (outerFirst ? ends[0] : ends[1]).slice(0, 2),
      inner: (outerFirst ? ends[1] : ends[0]).slice(0, 2),
      upper: outerFirst ? [...upper].reverse() : upper,
      lower: (Math.abs(spot(...lower[0])[0]) > Math.abs(spot(...lower.at(-1))[0])) ? [...lower].reverse() : lower,
    };
  });
  let noseTip = [0, 0, -Infinity],
    mouthTop = -Infinity,
    mouthBottom = Infinity,
    mouthCorner = 0,
    lipSum = 0,
    lipY = 0;
  for (let i = 0; i < n; i++) {
    if (!hit[i]) continue;
    if (lip[i] > 0.5) {
      lipSum++;
      lipY += y[i];
      mouthCorner = Math.max(mouthCorner, Math.abs(x[i]));
      if (Math.abs(x[i]) < 4) {
        mouthTop = Math.max(mouthTop, y[i]);
        mouthBottom = Math.min(mouthBottom, y[i]);
      }
    }
    if (Math.abs(x[i]) < 3 && y[i] < -0.2 * unit && y[i] > -1.2 * unit && z[i] > noseTip[2]) noseTip = [x[i], y[i], z[i]];
  }
  const strokes = unpack(data.brows.eyebrow001),
    bins = [[], []];
  for (let i = 0; i < strokes.length; i += 6) {
    const p = spot(strokes[i + 2] * W, strokes[i + 3] * H),
      side = p[0] > 0 ? 0 : 1,
      slot = Math.min(7, Math.floor((Math.abs(p[0]) / unit) * 8 - 0.4));
    if (slot < 0) continue;
    (bins[side][slot] ??= []).push(p);
  }
  const brows = bins.map((slots) =>
    slots.filter(Boolean).map((list) => [0, 1].map((k) => list.reduce((sum, p) => sum + p[k], 0) / list.length)),
  );
  const known = Uint8Array.from(hit);
  for (let round = 0; round < 4; round++) {
    const found = [];
    for (let j = 1; j < H - 1; j++)
      for (let i = 1; i < W - 1; i++) {
        const at = j * W + i;
        if (known[at]) continue;
        const from = [at - 1, at + 1, at - W, at + W].filter((k) => known[k]);
        if (from.length) found.push([at, from]);
      }
    for (const [at, from] of found) {
      known[at] = 1;
      for (const field of [x, y, z]) field[at] = from.reduce((sum, k) => sum + field[k], 0) / from.length;
    }
  }
  charted = {
    width: W, height: H, unit, x, y, z, nx, ny, nz, area, skin, lip, lid, eye, wet, hit,
    points: {
      eyes: sides,
      brows,
      noseTip: noseTip.slice(0, 2),
      mouth: { centre: [0, lipY / Math.max(1, lipSum)], top: mouthTop, bottom: mouthBottom, corner: mouthCorner },
    },
  };
  return charted;
}

export function browRoots(name = "eyebrow001") {
  const strokes = unpack(browLayout[name]?.strokes ?? data.brows[name] ?? data.brows.eyebrow001),
    roots = new Float32Array(strokes.length / 3);
  for (let i = 0, k = 0; i < strokes.length; i += 6) {
    roots[k++] = strokes[i] * W;
    roots[k++] = strokes[i + 1] * H;
  }
  return roots;
}

const browMasks = new Map();
export function browCover(name = "eyebrow001") {
  if (!browLayout[name]?.strokes && !data.brows[name]) name = "eyebrow001";
  if (browMasks.has(name)) return browMasks.get(name);
  const mask = new Float32Array(W * H),
    strokes = unpack(browLayout[name]?.strokes ?? data.brows[name]);
  for (let i = 0; i < strokes.length; i += 6)
    for (let t = 0; t <= 1; t += 0.125) {
      const a = (1 - t) * (1 - 2 * t),
        b = 4 * t * (1 - t),
        c = t * (2 * t - 1),
        px = (a * strokes[i] + b * strokes[i + 2] + c * strokes[i + 4]) * W,
        py = (a * strokes[i + 1] + b * strokes[i + 3] + c * strokes[i + 5]) * H;
      for (let dj = -3; dj <= 3; dj++)
        for (let di = -3; di <= 3; di++) {
          const u = Math.floor(px) + di,
            v = Math.floor(py) + dj;
          if (u < 0 || v < 0 || u >= W || v >= H) continue;
          const at = v * W + u;
          mask[at] = Math.min(1, mask[at] + 0.3 * Math.exp(-(di * di + dj * dj) / 3));
        }
    }
  browMasks.set(name, mask);
  return mask;
}

export function chartPoint(px, py) {
  const c = faceChart(),
    fx = Math.min(W - 1.001, Math.max(0, px - 0.5)),
    fy = Math.min(H - 1.001, Math.max(0, py - 0.5)),
    i = Math.floor(fx),
    j = Math.floor(fy),
    a = fx - i,
    b = fy - j,
    at = j * W + i;
  return [c.x, c.y, c.z].map(
    (f) => (f[at] * (1 - a) + f[at + 1] * a) * (1 - b) + (f[at + W] * (1 - a) + f[at + W + 1] * a) * b,
  );
}
export function chartPixel(mx, my) {
  const c = faceChart();
  let best = Infinity,
    found = -1;
  for (let at = 0; at < W * H; at++) {
    if (c.skin[at] < 0.5) continue;
    const dx = c.x[at] - mx,
      dy = c.y[at] - my,
      d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      found = at;
    }
  }
  return found;
}
