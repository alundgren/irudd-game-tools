import * as T from "three";
import {
  add,
  bodyShell,
  clamp,
  connected,
  cross,
  cut,
  dot,
  hash1,
  length,
  mix,
  noise3,
  smooth,
  sub,
  subdivide,
  unit,
} from "./human-style-kit.js";
import { surfaceBody, surfaceFrame } from "./human-fringe.js";
import { evaluateHuman } from "./human-surface.js";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const sculptedStyles = ["Sculpted crop", "Sculpted bob", "Sculpted tie-back"];


let earSource = null;
function earSources() {
  if (earSource) return earSource;
  const s = evaluateHuman({ height: 1.72 });
  const body = surfaceBody(s);
  const f = surfaceFrame(s);
  const head = body.weight(/^head/);
  const folded = new Uint8Array(body.count);
  for (let v = 0; v < body.count; v++) {
    if (head[v] < 0.5) continue;
    const p = body.point(v);
    const at = f.aim(p);
    const side = Math.abs(at.phi) / DEG;
    const up = at.eps / DEG;
    if (side < 62 || side > 132 || up < -50 || up > 12) continue;
    const d = sub(p, f.centre);
    if ((body.N[v * 3] * d[0] + body.N[v * 3 + 1] * d[1] + body.N[v * 3 + 2] * d[2]) / length(d) < 0.2) {
      folded[v] = 1;
    }
  }
  earSource = new Set();
  for (let t = 0; t < body.tri.length; t += 3) {
    const a = body.tri[t], b = body.tri[t + 1], c = body.tri[t + 2];
    if (folded[a] || folded[b] || folded[c]) {
      earSource.add(s.ids[a]);
      earSource.add(s.ids[b]);
      earSource.add(s.ids[c]);
    }
  }
  return earSource;
}

function measureEars(body, f) {
  const source = earSources();
  const ids = body.surface.ids;
  const mark = new Uint8Array(body.count);
  const box = () => ({ front: Infinity, back: -Infinity, top: -Infinity, low: Infinity });
  const sides = [box(), box()];
  for (let v = 0; v < body.count; v++) {
    if (!source.has(ids[v])) continue;
    mark[v] = 1;
    const at = f.aim(body.point(v));
    const e = sides[at.phi > 0 ? 0 : 1];
    const side = Math.abs(at.phi);
    e.front = Math.min(e.front, side);
    e.back = Math.max(e.back, side);
    e.top = Math.max(e.top, at.eps);
    e.low = Math.min(e.low, at.eps);
  }
  for (const e of sides) {
    if (!Number.isFinite(e.front)) {
      Object.assign(e, { front: 84 * DEG, back: 106 * DEG, top: -10 * DEG, low: -46 * DEG });
    }
  }
  return { mark, sides };
}

function curve(knots) {
  const n = knots.length;
  const x = knots.map((k) => k[0]);
  const y = knots.map((k) => k[1]);
  const d = [];
  const m = new Array(n).fill(0);
  for (let i = 0; i + 1 < n; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i + 1 < n; i++) {
    if (d[i - 1] * d[i] > 0) {
      const a = x[i] - x[i - 1], b = x[i + 1] - x[i];
      m[i] = (3 * (a + b)) / ((2 * b + a) / d[i - 1] + (b + 2 * a) / d[i]);
    }
  }
  return (at) => {
    if (at <= x[0]) return y[0];
    if (at >= x[n - 1]) return y[n - 1];
    let i = 0;
    while (at > x[i + 1]) i++;
    const h = x[i + 1] - x[i], t = (at - x[i]) / h;
    return (
      (2 * t ** 3 - 3 * t * t + 1) * y[i] +
      (t ** 3 - 2 * t * t + t) * h * m[i] +
      (3 * t * t - 2 * t ** 3) * y[i + 1] +
      (t ** 3 - t * t) * h * m[i + 1]
    );
  };
}

function sideLine(ear, { forehead = 22.8, burnFrac = 0.45, nape = -48 } = {}) {
  const F = clamp(ear.front / DEG, 76, 96);
  const B = clamp(ear.back / DEG, F + 12, 118);
  const top = ear.top / DEG;
  const low = ear.low / DEG;
  const burn = mix(top, low, burnFrac);
  return curve([
    [0, forehead - 0.8],
    [22, forehead + 0.6],
    [44, forehead + 2.8],
    [F - 24, forehead + 1.5],
    [F - 17.5, 10],
    [F - 14.5, burn + 7],
    [F - 12, burn],
    [F - 5.5, burn + 0.5],
    [F - 3.0, burn + 5.0],
    [F - 0.8, top + 2.6],
    [B + 1.2, top + 2.6],
    [B + 6.5, top - 3.0],
    [B + 13.5, mix(top, low, 0.52)],
    [B + 24, low + 2.5],
    [Math.max(B + 34, 147), nape + 3],
    [165, nape - 2],
    [180, nape],
  ]);
}

function scalpMap(body, f, ears) {
  const A = 200, B = 100;
  const R = new Float32Array(A * B);
  const N = new Float32Array(A * B * 3);
  const V = new Int32Array(A * B).fill(-1);
  const scalp = body.weight(/^(head|neck)/);
  const P = body.P, c = f.centre;
  const at = new Float32Array(body.count * 3);
  const used = new Uint8Array(body.count);
  for (let v = 0; v < body.count; v++) {
    if (scalp[v] < 0.3 || ears.mark[v]) continue;
    const dx = P[v * 3] - c[0], dy = P[v * 3 + 1] - c[1], dz = P[v * 3 + 2] - c[2];
    const r = Math.hypot(dx, dy, dz);
    let a = Math.atan2(dy, dz);
    if (a < -Math.PI / 2) a += TAU;
    at[v * 3] = ((a + Math.PI / 2) / TAU) * A;
    at[v * 3 + 1] = ((Math.asin(clamp(dx / r, -1, 1)) + Math.PI / 2) / Math.PI) * B;
    at[v * 3 + 2] = r;
    used[v] = 1;
  }
  for (let t = 0; t < body.tri.length; t += 3) {
    const i = body.tri[t], j = body.tri[t + 1], k = body.tri[t + 2];
    if (!used[i] || !used[j] || !used[k]) continue;
    const x0 = at[i * 3], y0 = at[i * 3 + 1];
    const x1 = at[j * 3], y1 = at[j * 3 + 1];
    const x2 = at[k * 3], y2 = at[k * 3 + 1];
    const lo = Math.min(x0, x1, x2), hi = Math.max(x0, x1, x2);
    if (hi - lo > A / 2) continue;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    const mx = (P[i * 3] + P[j * 3] + P[k * 3]) / 3 - c[0];
    const my = (P[i * 3 + 1] + P[j * 3 + 1] + P[k * 3 + 1]) / 3 - c[1];
    const mz = (P[i * 3 + 2] + P[j * 3 + 2] + P[k * 3 + 2]) / 3 - c[2];
    if (
      (body.N[i * 3] + body.N[j * 3] + body.N[k * 3]) * mx +
      (body.N[i * 3 + 1] + body.N[j * 3 + 1] + body.N[k * 3 + 1]) * my +
      (body.N[i * 3 + 2] + body.N[j * 3 + 2] + body.N[k * 3 + 2]) * mz <= 0
    ) continue;
    const ya = Math.min(y0, y1, y2), yb = Math.max(y0, y1, y2);
    for (let row = Math.max(0, Math.floor(ya - 0.5)); row <= Math.min(B - 1, Math.ceil(yb - 0.5)); row++) {
      for (let col = Math.max(0, Math.floor(lo - 0.5)); col <= Math.min(A - 1, Math.ceil(hi - 0.5)); col++) {
        const x = col + 0.5, y = row + 0.5;
        const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area;
        const w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const r = w0 * at[i * 3 + 2] + w1 * at[j * 3 + 2] + w2 * at[k * 3 + 2];
        const cell = row * A + col;
        if (r <= R[cell]) continue;
        R[cell] = r;
        for (let d = 0; d < 3; d++) {
          N[cell * 3 + d] = w0 * body.N[i * 3 + d] + w1 * body.N[j * 3 + d] + w2 * body.N[k * 3 + d];
        }
        V[cell] = w0 >= w1 && w0 >= w2 ? i : w1 >= w2 ? j : k;
      }
    }
  }
  for (let pass = 0; pass < 24; pass++) {
    const old = R.slice();
    let empty = 0;
    for (let row = 0; row < B; row++) {
      for (let col = 0; col < A; col++) {
        const cell = row * A + col;
        if (old[cell] > 0) continue;
        let sum = 0, count = 0, from = -1;
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const r = row + dr, q = col + dc;
          if (r < 0 || r >= B || q < 0 || q >= A || !(old[r * A + q] > 0)) continue;
          sum += old[r * A + q];
          count++;
          from = r * A + q;
        }
        if (!count) { empty++; continue; }
        R[cell] = sum / count;
        V[cell] = V[from];
        for (let d = 0; d < 3; d++) N[cell * 3 + d] = N[from * 3 + d];
      }
    }
    if (!empty) break;
  }
  return (u) => {
    let a = Math.atan2(u[1], u[2]);
    if (a < -Math.PI / 2) a += TAU;
    const x = clamp(((a + Math.PI / 2) / TAU) * A - 0.5, 0, A - 1.001);
    const y = clamp(((Math.asin(clamp(u[0], -1, 1)) + Math.PI / 2) / Math.PI) * B - 0.5, 0, B - 1.001);
    const col = Math.floor(x), row = Math.floor(y);
    const s = x - col, t = y - row;
    const c00 = row * A + col, c01 = c00 + 1, c10 = c00 + A, c11 = c10 + 1;
    const w = [(1 - s) * (1 - t), s * (1 - t), (1 - s) * t, s * t];
    const cells = [c00, c01, c10, c11];
    const n = [0, 0, 0];
    let r = 0, best = 0;
    for (let i = 0; i < 4; i++) {
      r += w[i] * R[cells[i]];
      if (w[i] > w[best]) best = i;
      for (let d = 0; d < 3; d++) n[d] += w[i] * N[cells[i] * 3 + d];
    }
    return { r, n: unit(n), v: V[cells[best]] };
  };
}


const tangent = (q, v) => {
  const along = dot(q, v);
  return unit([v[0] - q[0] * along, v[1] - q[1] * along, v[2] - q[2] * along]);
};
const aimAt = (phi, eps) => [Math.cos(eps) * Math.sin(phi), Math.sin(eps), Math.cos(eps) * Math.cos(phi)];

function onArc(q, a, b) {
  const n = unit(cross(a, b));
  const flat = unit(sub(q, n.map((x) => x * dot(q, n))));
  if (dot(cross(a, flat), n) >= 0 && dot(cross(flat, b), n) >= 0) return flat;
  return dot(q, a) > dot(q, b) ? a : b;
}

const COMBS = {
  "As cut": { partPhi: 30, from: [[0.20, 0.78, -0.56], aimAt(30 * DEG, 34 * DEG)], forward: 0.35, back: 0.45, sweep: -0.45 },
  "Parted": { partPhi: 32, from: [[0.22, 0.78, -0.55], aimAt(32 * DEG, 30 * DEG)], forward: 0.42, back: 0.45, sweep: -0.52 },
  "Swept left": { partPhi: -34, from: [[-0.22, 0.78, -0.55], aimAt(-34 * DEG, 30 * DEG)], forward: 0.48, back: 0.45, sweep: 0.65 },
  "Swept right": { partPhi: 34, from: [[0.22, 0.78, -0.55], aimAt(34 * DEG, 30 * DEG)], forward: 0.48, back: 0.45, sweep: -0.65 },
  "Off the face": { partPhi: 0, from: [aimAt(-65 * DEG, 14 * DEG), aimAt(0, 20 * DEG), aimAt(65 * DEG, 14 * DEG)], forward: -0.45, back: 0.9, sweep: 0.0 },
};

function combing(look) {
  const comb = COMBS[look] ?? COMBS["Parted"];
  const from = comb.from.map(unit);
  const sourceOf = (q) => {
    let source = from[0];
    if (from.length > 1) {
      let best = -2;
      for (let i = 0; i + 1 < from.length; i++) {
        const p = onArc(q, from[i], from[i + 1]);
        const near = dot(p, q);
        if (near > best) { best = near; source = p; }
      }
    }
    return source;
  };
  const fn = (q) => {
    const source = sourceOf(q);
    const away = sub(q.map((x) => x * dot(q, source)), source);
    const far = length(away);
    const forward = tangent(q, [0, 0, 1]);
    const side = tangent(q, [comb.sweep, -0.1, 0.25]);
    const down = tangent(q, [0, -1, 0]);
    const rear = tangent(q, [0, 0, -1]);
    const napePull = smooth(-0.2, -0.85, q[2]) * smooth(20 * DEG, -35 * DEG, Math.asin(clamp(q[1], -1, 1)));
    const inward = tangent(q, [-q[0] * 0.55, -0.9, -0.15]);
    let top = far > 1e-4 ? away.map((x) => x / far) : forward;
    top = unit(add(top, forward, comb.forward * smooth(0.05, 0.65, q[1])));
    if (Math.abs(comb.sweep) > 0.05) {
      top = unit(add(top, side, 0.35 * smooth(0.05, 0.75, q[2]) * smooth(0.15, 0.7, q[1])));
    }
    let low = unit(add(down, rear, comb.back * Math.abs(q[0])));
    if (napePull > 0.01) low = unit(add(low, inward, 0.38 * napePull));
    const hang = smooth(44 * DEG, 6 * DEG, Math.asin(clamp(q[1], -1, 1)));
    return tangent(q, [mix(top[0], low[0], hang), mix(top[1], low[1], hang), mix(top[2], low[2], hang)]);
  };
  fn.comb = comb;
  return fn;
}

let strandMapsCache = null;

function makeTextureFromRGBA(data, size, name, srgb) {
  let tex;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.getContext("2d").putImageData(new ImageData(data, size, size), 0, 0);
    tex = new T.CanvasTexture(canvas);
  } else {
    const flipped = new Uint8Array(data.length);
    for (let y = 0; y < size; y++) {
      flipped.set(data.subarray(y * size * 4, (y + 1) * size * 4), (size - 1 - y) * size * 4);
    }
    tex = new T.DataTexture(flipped, size, size, T.RGBAFormat);
    tex.magFilter = T.LinearFilter;
    tex.minFilter = T.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
  }
  tex.name = name;
  tex.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function hairStrandMaps() {
  if (strandMapsCache) return strandMapsCache;
  const size = 256;
  const albedo = new Uint8ClampedArray(size * size * 4);
  const bump = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);

  const strandCount = 64;
  const strands = Array.from({ length: strandCount }, (_, i) => ({
    u: (i + 0.5) / strandCount + (hash1(i * 37 + 5) - 0.5) * (0.45 / strandCount),
    amp: 0.09 + 0.11 * hash1(i * 53 + 11),
    height: 0.50 + 0.50 * hash1(i * 61 + 17),
    width: (0.44 + 0.36 * hash1(i * 71 + 3)) / strandCount,
    tone: (hash1(i * 83 + 23) - 0.48) * 0.30,
    freq: 0.6 + 1.0 * hash1(i * 19 + 7),
    phase: TAU * hash1(i * 29 + 13),
    sway: (0.24 + 0.30 * hash1(i * 43 + 9)) / strandCount,
  }));

  const streakCount = 12;
  const streaks = Array.from({ length: streakCount }, (_, i) => ({
    u: (i + 0.5) / streakCount,
    width: 0.72 / streakCount,
    tone: (hash1(i * 97 + 19) - 0.50) * 0.24,
  }));

  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    const vFade = smooth(0.0, 0.06, v) * smooth(1.0, 0.96, v);
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const edgeSym = smooth(0.0, 0.03, u) * smooth(0.0, 0.03, 1 - u);
      let hVal = 0.16;
      let lum = 0.76;
      for (const st of strands) {
        const center = st.u + st.sway * edgeSym * Math.sin(st.phase + st.freq * Math.PI * v);
        const du = (u - center) / st.width;
        const g = Math.exp(-(du * du));
        if (g > 0.005) {
          hVal += st.height * 0.52 * g;
          lum += (st.amp * (g - 0.28) + st.tone * g) * (0.7 + 0.3 * vFade);
        }
      }
      for (const sk of streaks) {
        const du = (u - sk.u) / sk.width;
        lum += sk.tone * Math.exp(-(du * du)) * edgeSym;
      }
      const rootDark = mix(0.76, 1.02, smooth(0.0, 0.16, v));
      const tipDepth = mix(1.0, 0.90, smooth(0.84, 1.0, v));
      const finalLum = clamp(lum * rootDark * tipDepth, 0.42, 1.08);
      const finalH = clamp(0.10 + 0.80 * clamp(hVal * (0.55 + 0.45 * edgeSym), 0, 1.15), 0.04, 0.98);
      const finalR = clamp(mix(0.68, 0.34, clamp(hVal, 0, 1)), 0.30, 0.74);

      const idx = (y * size + x) * 4;
      const aByte = Math.round(finalLum ** (1 / 2.2) * 255);
      const bByte = Math.round(finalH * 255);
      const rByte = Math.round(finalR * 255);
      albedo[idx] = albedo[idx + 1] = albedo[idx + 2] = aByte;
      albedo[idx + 3] = 255;
      bump[idx] = bump[idx + 1] = bump[idx + 2] = bByte;
      bump[idx + 3] = 255;
      rough[idx] = rough[idx + 1] = rough[idx + 2] = rByte;
      rough[idx + 3] = 255;
    }
  }

  strandMapsCache = {
    map: makeTextureFromRGBA(albedo, size, "Sculpted hair grain", true),
    bumpMap: makeTextureFromRGBA(bump, size, "Sculpted hair bump", false),
    roughnessMap: makeTextureFromRGBA(rough, size, "Sculpted hair roughness", false),
  };
  return strandMapsCache;
}


const PROFILE = [
  [-1.0, -0.34, 0.78, -0.68],
  [-0.50, 0.56, 0.96, -0.32],
  [0.0, 1.0, 1.11, 0.0],
  [0.50, 0.56, 0.96, 0.32],
  [1.0, -0.34, 0.78, 0.68],
];

const CLOSED_PROFILE = [
  [-1.0, 0.0, 0.76, -0.92, -0.10, 0.0],
  [-0.48, 0.68, 0.96, -0.38, 0.85, 0.25],
  [0.0, 1.0, 1.12, 0.0, 1.0, 0.50],
  [0.48, 0.68, 0.96, 0.38, 0.85, 0.75],
  [1.0, 0.0, 0.76, 0.92, -0.10, 1.0],
  [0.0, -0.62, 0.58, 0.0, -1.0, 0.50],
];

function makeHangSkin(body) {
  const head = body.bone("head");
  const neck = body.bone("neck_01");
  const chest = body.bone("spine_03");
  const headY = body.joint("head")[1];
  const neckY = body.joint("neck_01")[1];
  const k = body.scale;
  return (p) => {
    const low = smooth(headY + 0.015 * k, neckY - 0.015 * k, p[1]);
    const lower = smooth(neckY + 0.015 * k, neckY - 0.11 * k, p[1]);
    return [
      [head, neck, chest, 0],
      [1 - low, low * (1 - lower), low * lower, 0],
    ];
  };
}

function appendLock(out, body, stations, opts) {
  const { width, thick, baseColor, shadeVar, rootShade = 0.78, tipShade = 1.06, roll = 0, bank = 0, edgeAO = 0.85, skinFn = null } = opts;
  const nSteps = stations.length - 1;
  if (nSteps < 2) return;
  const cols = PROFILE.length;
  const ringStarts = [];

  const root = stations[0];
  const nextRoot = stations[1];
  const rootRun = unit(sub(nextRoot.p, root.p));
  const rootPt = body.clear(add(root.p, root.n, -0.22 * thick), 0.0006 * body.scale);
  const rootNrm = unit(sub(root.n, rootRun, 0.25));
  const rootSkin = skinFn ? skinFn(rootPt) : body.skinOf(root.v >= 0 ? root.v : body.nearest(root.p, 8));
  const rootIdx = out.position.length / 3;
  const rootMul = shadeVar * rootShade * 0.82;
  out.position.push(rootPt[0], rootPt[1], rootPt[2]);
  out.normal.push(rootNrm[0], rootNrm[1], rootNrm[2]);
  out.color.push(clamp(baseColor.r * rootMul, 0, 1), clamp(baseColor.g * rootMul, 0, 1), clamp(baseColor.b * rootMul, 0, 1));
  out.uv.push(0.5, 0.0);
  out.bones.push(...rootSkin[0]);
  out.weights.push(...rootSkin[1]);

  for (let s = 1; s < nSteps; s++) {
    const t = s / nSteps;
    const cur = stations[s];
    const prev = stations[s - 1];
    const next = stations[Math.min(nSteps, s + 1)];
    const run = unit(sub(next.p, prev.p));
    let up = cur.n;
    let across = cross(up, run);
    if (length(across) < 1e-5) continue;
    across = unit(across);
    up = unit(cross(run, across));

    const twist = roll + bank * Math.sin(Math.PI * t);
    if (Math.abs(twist) > 1e-4) {
      const ca = Math.cos(twist), sa = Math.sin(twist);
      const a2 = unit(add(across.map((x) => x * ca), up, sa));
      up = unit(cross(run, a2));
      across = a2;
    }

    const wEnv = mix(0.42, 1.0, smooth(0.0, 0.22, t)) * (1 - smooth(0.58, 1.0, t) ** 1.55 * 0.84);
    const hEnv = mix(0.22, 1.0, smooth(0.0, 0.24, t)) * (1 - smooth(0.52, 1.0, t) ** 1.35 * 0.82);
    const halfW = width * 0.5 * wEnv;
    const hScale = thick * hEnv;
    const lengthShade = mix(rootShade, tipShade, smooth(0.06, 0.86, t));

    const skinning = skinFn ? skinFn(cur.p) : body.skinOf(cur.v >= 0 ? cur.v : body.nearest(cur.p, 8));
    const startIdx = out.position.length / 3;
    ringStarts.push(startIdx);

    for (let j = 0; j < cols; j++) {
      const [sx, hy, pShadeRaw, nTilt] = PROFILE[j];
      const pShade = mix(1.0, pShadeRaw, edgeAO);
      const pt = body.clear(add(add(cur.p, across, sx * halfW), up, hy * hScale), 0.0006 * body.scale);
      const nrm = unit(add(up, across, nTilt));
      const mul = shadeVar * lengthShade * pShade;
      out.position.push(pt[0], pt[1], pt[2]);
      out.normal.push(nrm[0], nrm[1], nrm[2]);
      out.color.push(clamp(baseColor.r * mul, 0, 1), clamp(baseColor.g * mul, 0, 1), clamp(baseColor.b * mul, 0, 1));
      out.uv.push(j / (cols - 1), t);
      out.bones.push(...skinning[0]);
      out.weights.push(...skinning[1]);
    }
  }

  if (ringStarts.length < 1) return;

  const tip = stations[nSteps];
  const prevTip = stations[nSteps - 1];
  const tipRun = unit(sub(tip.p, prevTip.p));
  const tipPt = body.clear(add(tip.p, tip.n, -0.18 * thick), 0.0006 * body.scale);
  const tipNrm = unit(add(tip.n, tipRun, 0.25));
  const tipSkin = skinFn ? skinFn(tipPt) : body.skinOf(tip.v >= 0 ? tip.v : body.nearest(tip.p, 8));
  const tipIdx = out.position.length / 3;
  const tipMul = shadeVar * tipShade * 1.01;
  out.position.push(tipPt[0], tipPt[1], tipPt[2]);
  out.normal.push(tipNrm[0], tipNrm[1], tipNrm[2]);
  out.color.push(clamp(baseColor.r * tipMul, 0, 1), clamp(baseColor.g * tipMul, 0, 1), clamp(baseColor.b * tipMul, 0, 1));
  out.uv.push(0.5, 1.0);
  out.bones.push(...tipSkin[0]);
  out.weights.push(...tipSkin[1]);

  const firstRing = ringStarts[0];
  for (let j = 0; j + 1 < cols; j++) {
    out.index.push(rootIdx, firstRing + j, firstRing + j + 1);
  }
  for (let r = 0; r + 1 < ringStarts.length; r++) {
    const r0 = ringStarts[r];
    const r1 = ringStarts[r + 1];
    for (let j = 0; j + 1 < cols; j++) {
      const a = r0 + j, b = r0 + j + 1, c = r1 + j + 1, d = r1 + j;
      out.index.push(a, d, c, a, c, b);
    }
  }
  const lastRing = ringStarts[ringStarts.length - 1];
  for (let j = 0; j + 1 < cols; j++) {
    out.index.push(lastRing + j, tipIdx, lastRing + j + 1);
  }
}

function appendSolidLock(out, stations, opts) {
  const { width, thick, baseColor, shadeVar, rootShade = 0.74, tipShade = 1.08, roll = 0, bank = 0, skinFn, rootTaper = 0.45, tipTaper = 0.14 } = opts;
  const nSteps = stations.length - 1;
  if (nSteps < 2) return;
  const cols = CLOSED_PROFILE.length;
  const ringStarts = [];

  const root = stations[0];
  const rootSkin = skinFn(root.p);
  const rootIdx = out.position.length / 3;
  const rootMul = shadeVar * rootShade * 0.78;
  out.position.push(root.p[0], root.p[1], root.p[2]);
  out.normal.push(root.n[0], root.n[1], root.n[2]);
  out.color.push(clamp(baseColor.r * rootMul, 0, 1), clamp(baseColor.g * rootMul, 0, 1), clamp(baseColor.b * rootMul, 0, 1));
  out.uv.push(0.5, 0.0);
  out.bones.push(...rootSkin[0]);
  out.weights.push(...rootSkin[1]);

  let prevAcross = null;
  for (let s = 1; s < nSteps; s++) {
    const t = s / nSteps;
    const cur = stations[s];
    const prev = stations[s - 1];
    const next = stations[Math.min(nSteps, s + 1)];
    const run = unit(sub(next.p, prev.p));
    let up = cur.n;
    let across = cross(up, run);
    if (length(across) < 1e-5) {
      across = prevAcross ?? [1, 0, 0];
    } else {
      across = unit(across);
      if (prevAcross && dot(across, prevAcross) < 0) across = across.map((x) => -x);
    }
    prevAcross = across;
    up = unit(cross(run, across));

    const twist = roll + bank * Math.sin(Math.PI * t);
    if (Math.abs(twist) > 1e-4) {
      const ca = Math.cos(twist), sa = Math.sin(twist);
      const a2 = unit(add(across.map((x) => x * ca), up, sa));
      up = unit(cross(run, a2));
      across = a2;
    }

    const wEnv = mix(rootTaper, 1.0, smooth(0.0, 0.22, t)) * mix(1.0, tipTaper, smooth(0.55, 1.0, t) ** 1.45);
    const hEnv = mix(rootTaper * 0.85, 1.0, smooth(0.0, 0.22, t)) * mix(1.0, tipTaper * 0.9, smooth(0.52, 1.0, t) ** 1.35);
    const halfW = width * 0.5 * wEnv;
    const hScale = thick * hEnv;
    const lengthShade = mix(rootShade, tipShade, smooth(0.06, 0.88, t));

    const skinning = skinFn(cur.p);
    const startIdx = out.position.length / 3;
    ringStarts.push(startIdx);

    for (let j = 0; j < cols; j++) {
      const [sx, hy, pShade, nx, ny, uCoord] = CLOSED_PROFILE[j];
      const pt = add(add(cur.p, across, sx * halfW), up, hy * hScale);
      const nrm = unit(add(up.map((x) => x * ny), across, nx));
      const mul = shadeVar * lengthShade * pShade;
      out.position.push(pt[0], pt[1], pt[2]);
      out.normal.push(nrm[0], nrm[1], nrm[2]);
      out.color.push(clamp(baseColor.r * mul, 0, 1), clamp(baseColor.g * mul, 0, 1), clamp(baseColor.b * mul, 0, 1));
      out.uv.push(uCoord, t);
      out.bones.push(...skinning[0]);
      out.weights.push(...skinning[1]);
    }
  }

  if (ringStarts.length < 1) return;

  const tip = stations[nSteps];
  const prevTip = stations[nSteps - 1];
  const tipRun = unit(sub(tip.p, prevTip.p));
  const tipNrm = unit(add(tip.n, tipRun, 0.35));
  const tipSkin = skinFn(tip.p);
  const tipIdx = out.position.length / 3;
  const tipMul = shadeVar * tipShade * 1.02;
  out.position.push(tip.p[0], tip.p[1], tip.p[2]);
  out.normal.push(tipNrm[0], tipNrm[1], tipNrm[2]);
  out.color.push(clamp(baseColor.r * tipMul, 0, 1), clamp(baseColor.g * tipMul, 0, 1), clamp(baseColor.b * tipMul, 0, 1));
  out.uv.push(0.5, 1.0);
  out.bones.push(...tipSkin[0]);
  out.weights.push(...tipSkin[1]);

  const firstRing = ringStarts[0];
  for (let j = 0; j < cols; j++) {
    const j1 = (j + 1) % cols;
    out.index.push(rootIdx, firstRing + j, firstRing + j1);
  }
  for (let r = 0; r + 1 < ringStarts.length; r++) {
    const r0 = ringStarts[r];
    const r1 = ringStarts[r + 1];
    for (let j = 0; j < cols; j++) {
      const j1 = (j + 1) % cols;
      const a = r0 + j, b = r0 + j1, c = r1 + j1, d = r1 + j;
      out.index.push(a, d, c, a, c, b);
    }
  }
  const lastRing = ringStarts[ringStarts.length - 1];
  for (let j = 0; j < cols; j++) {
    const j1 = (j + 1) % cols;
    out.index.push(lastRing + j, tipIdx, lastRing + j1);
  }
}

function appendHairTie(out, center, axis, radius, tubeR, color, skinFn, segs = 14) {
  const ax = unit(axis);
  const e1 = unit(cross(ax, Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const e2 = unit(cross(ax, e1));
  const rings = 6;
  const baseIdx = out.position.length / 3;
  const skinning = skinFn(center);

  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * TAU;
    const rad = add(e1.map((x) => x * Math.cos(a)), e2, Math.sin(a));
    const mid = add(center, rad, radius);
    for (let j = 0; j < rings; j++) {
      const b = (j / rings) * TAU;
      const nrm = unit(add(rad.map((x) => x * Math.cos(b)), ax, Math.sin(b)));
      const pt = add(mid, nrm, tubeR);
      const shade = 0.85 + 0.25 * Math.cos(b);
      out.position.push(pt[0], pt[1], pt[2]);
      out.normal.push(nrm[0], nrm[1], nrm[2]);
      out.color.push(clamp(color.r * shade, 0, 1), clamp(color.g * shade, 0, 1), clamp(color.b * shade, 0, 1));
      out.uv.push(0.5, 0.5);
      out.bones.push(...skinning[0]);
      out.weights.push(...skinning[1]);
    }
  }
  for (let i = 0; i < segs; i++) {
    const i1 = (i + 1) % segs;
    for (let j = 0; j < rings; j++) {
      const j1 = (j + 1) % rings;
      const a = baseIdx + i * rings + j;
      const b = baseIdx + i1 * rings + j;
      const c = baseIdx + i1 * rings + j1;
      const d = baseIdx + i * rings + j1;
      out.index.push(a, b, c, a, c, d);
    }
  }
}


function makeContext(surface, style, skinColor) {
  const body = surfaceBody(surface);
  const f = surfaceFrame(surface);
  const k = f.k;
  const mm = k / 1000;
  const ears = measureEars(body, f);
  const scalp = scalpMap(body, f, ears);
  const look = COMBS[style.fringe] ? style.fringe : "Parted";
  const flow = combing(look);
  const hair = new T.Color(style.hairColor ?? "#48372e");
  const skin = new T.Color(skinColor ?? "#96735d");
  const browEps = Math.max(...f.eyes.map((e) => e.eps + e.tall)) + 6.5 * DEG;
  const hangSkin = makeHangSkin(body);

  const worldDir = (q) => unit([q[0] * f.radii[0], q[1] * f.radii[1], q[2] * f.radii[2]]);
  const seat = (q, h) => {
    const u = worldDir(q);
    const at = scalp(u);
    return {
      p: [
        f.centre[0] + u[0] * at.r + at.n[0] * h,
        f.centre[1] + u[1] * at.r + at.n[1] * h,
        f.centre[2] + u[2] * at.r + at.n[2] * h,
      ],
      n: at.n,
      v: at.v,
    };
  };

  return { body, f, k, mm, ears, scalp, look, flow, hair, skin, browEps, seat, hangSkin };
}

function makeHairlineHelper(ears, lineOpts) {
  const lines = ears.sides.map((e) => sideLine(e, lineOpts));
  const traced = lines.map((line, side) => {
    const pts = new Float32Array(361 * 3);
    for (let i = 0; i <= 360; i++) {
      pts.set(aimAt((side ? -1 : 1) * (i / 2) * DEG, line(i / 2) * DEG), i * 3);
    }
    return pts;
  });
  const margin = (phi, eps) => {
    const side = phi > 0 ? 0 : 1;
    const pts = traced[side];
    const q = aimAt(phi, eps);
    let near = -1;
    for (let i = 0; i < pts.length; i += 3) {
      const d = q[0] * pts[i] + q[1] * pts[i + 1] + q[2] * pts[i + 2];
      if (d > near) near = d;
    }
    return (Math.acos(Math.min(1, near)) / DEG) * (eps / DEG >= lines[side](Math.abs(phi) / DEG) ? 1 : -1);
  };
  return { lines, margin };
}

function buildTaperedUnderLayer(ctx, hl, heightFn, { fadeDeg = 10, flowOverride = null } = {}) {
  const { body, f, mm, ears, hair, skin } = ctx;
  const flow = flowOverride ?? ctx.flow;
  const wear = body.weight(/^(head|neck)/);
  let s = bodyShell(body, { wear });
  s.f.line = new Array(s.count).fill(-1);
  for (let i = 0; i < s.count; i++) {
    if (s.f.wear[i] < 0.5 || ears.mark[i]) continue;
    const at = f.aim(s.anchor(i));
    const napeQuiet = smooth(150 * DEG, 118 * DEG, Math.abs(at.phi));
    const micro = 0.6 * napeQuiet * (noise3(at.q[0] * 24 + 3, at.q[1] * 24, at.q[2] * 24) - 0.5);
    s.f.line[i] = hl.margin(at.phi, at.eps) - 0.3 + micro;
  }
  s = cut(s, (i) => s.f.line[i]);
  s = connected(s, [0, f.top, f.centre[2]]);
  s = subdivide(s);

  const lockStreak = (q) => {
    let sum = 0, a = q, b = q;
    for (let i = 0; i < 4; i++) {
      sum += noise3(a[0] * 38 + 7, a[1] * 38, a[2] * 38) + noise3(b[0] * 38 + 7, b[1] * 38, b[2] * 38);
      a = unit(add(a, flow(a), 0.05));
      b = unit(add(b, flow(b), -0.05));
    }
    return clamp((sum / 8 - 0.5) * 4.2, -1, 1);
  };

  const out = { position: [], normal: [], color: [], uv: [], index: [], bones: [], weights: [] };
  for (let i = 0; i < s.count; i++) {
    const a = s.anchor(i);
    const at = f.aim(a);
    const far = Math.max(0, hl.margin(at.phi, at.eps));
    const n = s.normal(i);
    const top = smooth(10 * DEG, 46 * DEG, at.eps);
    const isForehead = smooth(12 * DEG, 22 * DEG, at.eps) * smooth(0.45, 0.72, at.q[2]);
    const streak = lockStreak(at.q);

    const hMm = heightFn(at, far) + 0.5 * streak * smooth(4, 14, far);
    const p = add(a, n, hMm * mm);

    const fadeBand = mix(fadeDeg * 0.78, 1.4, isForehead);
    const cover = smooth(0, fadeBand, far) ** 0.72;
    const shade = (0.72 + 0.14 * streak) * mix(1.0, 0.88, top);
    const solid = mix(clamp(0.16 + 0.84 * cover, 0, 1), clamp(0.76 + 0.24 * cover, 0, 1), isForehead);

    out.position.push(p[0], p[1], p[2]);
    out.normal.push(n[0], n[1], n[2]);
    out.color.push(
      mix(skin.r, hair.r * shade, solid),
      mix(skin.g, hair.g * shade, solid),
      mix(skin.b, hair.b * shade, solid),
    );
    out.uv.push(0.5, 0.5);
    const [bones, weights] = s.skin(i);
    out.bones.push(...bones);
    out.weights.push(...weights);
  }
  out.index = s.tri.slice();
  return out;
}

function traceSeatedLock(ctx, hl, heightFn, startPhi, startEps, opts) {
  const { f, k, mm, ears, browEps, seat } = ctx;
  const flow = opts.flowOverride ?? ctx.flow;
  const {
    lenMm,
    reliefMm = 2.4,
    liftOffsetMm = 0.0,
    tipDipMm = -1.2,
    steps = 6,
    dirBias = null,
    biasWeight = 0,
    allowOverLine = 1.6,
    keepAboveBrow = true,
    curl = 0,
    seed = 1,
  } = opts;

  let q = aimAt(startPhi, startEps);
  const startBase = seat(q, 0);
  const probeDir = flow(q);
  const ahead = seat(unit(add(q, probeDir, 0.04)), 0);
  const metre = Math.max(0.05 * k, length(sub(ahead.p, startBase.p)) / 0.04);
  const totalLen = lenMm * mm;
  const stepAng = totalLen / steps / metre;

  const stations = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const at = f.aim(seat(q, 0).p);
    if (keepAboveBrow && Math.abs(at.phi) < 58 * DEG && at.eps < browEps) {
      q = aimAt(at.phi, mix(at.eps, browEps, 0.85));
    }
    const ear = ears.sides[at.phi > 0 ? 0 : 1];
    const absPhi = Math.abs(at.phi);
    if (absPhi > ear.front - 5.5 * DEG && absPhi < ear.back + 5.5 * DEG && at.eps < ear.top + 8.0 * DEG && at.eps > ear.low - 4 * DEG) {
      q = aimAt(at.phi, ear.top + 8.5 * DEG);
    }

    const atClean = f.aim(seat(q, 0).p);
    const far = hl.margin(atClean.phi, atClean.eps);
    if (i > 1 && far < -allowOverLine) {
      break;
    }

    const baseCapMm = heightFn(atClean, Math.max(0, far));
    const arch = Math.sin(Math.PI * t ** 0.72);
    const hMm = Math.max(0.75, baseCapMm + liftOffsetMm * (1 - 0.8 * t * t) + reliefMm * arch + tipDipMm * t * t);
    const st = seat(q, hMm * mm);

    if (stations.length && length(sub(st.p, stations[stations.length - 1].p)) > 2.2 * (totalLen / steps) + 0.008 * k) {
      break;
    }
    stations.push(st);

    if (i < steps) {
      let dir = flow(q);
      if (dirBias) {
        const tb = tangent(q, dirBias);
        dir = unit(add(dir, tb, biasWeight));
      }
      if (Math.abs(curl) > 1e-4) {
        const side = cross(q, dir);
        const turn = curl * Math.sin(t * Math.PI * 1.1 + hash1(seed) * 1.4);
        dir = unit(add(dir, side, turn));
      }
      q = unit(add(q, dir, stepAng));
    }
  }
  return stations;
}

function lockTint(hair, seed, range = 0.012) {
  const rnd = (n) => hash1(seed * 197 + n * 41);
  const c = hair.clone();
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL((hsl.h + (rnd(5) - 0.5) * range + 1) % 1, clamp(hsl.s * (0.94 + 0.12 * rnd(6)), 0, 1), hsl.l);
  return { color: c, shadeVar: 0.93 + 0.15 * rnd(4) };
}


function cropVolumeMm(at, far, partPhiDeg, look) {
  const top = smooth(8 * DEG, 46 * DEG, at.eps);
  const front = smooth(0.15, 0.85, at.q[2]) * smooth(12 * DEG, 56 * DEG, at.eps);
  const backFull =
    smooth(100 * DEG, 155 * DEG, Math.abs(at.phi)) *
    smooth(-22 * DEG, 24 * DEG, at.eps) *
    smooth(64 * DEG, 26 * DEG, at.eps);
  const sideGrad = smooth(0, 17, far) ** 0.85;
  let h = mix(0.45, mix(3.2, 9.2, top) + 3.0 * front + 2.6 * backFull, sideGrad);
  if (look !== "Off the face") {
    const dPart = at.phi / DEG - partPhiDeg;
    const inFrontTop = smooth(18 * DEG, 34 * DEG, at.eps) * smooth(-0.35, 0.35, at.q[2]);
    h -= 2.0 * Math.exp(-((dPart / 8.5) ** 2)) * inFrontTop * smooth(2, 10, far);
  }
  return Math.max(0.45, h);
}

function buildSculptedCrop(ctx, game) {
  const { ears, hair, look, flow } = ctx;
  const partPhi = flow.comb.partPhi;
  const sweepSign = look === "Swept left" ? 1 : look === "Swept right" ? -1 : look === "Off the face" ? 0 : -1;

  const hl = makeHairlineHelper(ears, { forehead: 22.8, burnFrac: 0.45, nape: -48 });
  const heightFn = (at, far) => cropVolumeMm(at, far, partPhi, look);
  const under = buildTaperedUnderLayer(ctx, hl, heightFn, { fadeDeg: 10 });

  const locks = { position: [], normal: [], color: [], uv: [], index: [], bones: [], weights: [] };
  const seg = (full, lo) => (game ? lo : full);

  const addSpecList = (specList) => {
    for (const sp of specList) {
      const rnd = (n) => hash1(sp.seed * 197 + n * 41);
      const stations = traceSeatedLock(ctx, hl, heightFn, sp.phi * DEG, sp.eps * DEG, {
        lenMm: sp.len * (0.92 + 0.16 * rnd(1)),
        reliefMm: sp.relief * (0.9 + 0.2 * rnd(2)),
        liftOffsetMm: sp.liftOffset ?? 0,
        tipDipMm: sp.tipDip ?? -1.2,
        steps: sp.steps,
        dirBias: sp.dirBias,
        biasWeight: sp.biasWeight ?? 0,
        allowOverLine: sp.allowOverLine ?? 1.6,
        keepAboveBrow: sp.keepAboveBrow ?? true,
        curl: sp.curl ?? (rnd(3) - 0.5) * 0.16,
        seed: sp.seed,
      });
      if (stations.length < 3) continue;
      const { color, shadeVar } = lockTint(hair, sp.seed);
      appendLock(locks, ctx.body, stations, {
        width: sp.width * ctx.mm * (0.92 + 0.16 * rnd(7)),
        thick: sp.thick * ctx.mm * (0.92 + 0.16 * rnd(8)),
        baseColor: color,
        shadeVar,
        rootShade: sp.rootShade ?? 0.78,
        tipShade: sp.tipShade ?? 1.06,
        roll: (rnd(9) - 0.5) * 0.1,
        bank: sp.bank ?? 0,
        edgeAO: sp.edgeAO ?? 0.85,
      });
    }
  };

  let id = 200;
  const specs = [];

  for (let i = 0; i < 15; i++) {
    const phi = mix(-174, 174, i / 14);
    if (Math.abs(phi) < 100) continue;
    const wide = i % 2 === 0;
    const eps = mix(10, -8, smooth(102, 168, Math.abs(phi))) + (wide ? 2 : -3);
    specs.push({
      seed: id++,
      phi,
      eps,
      len: mix(56, 46, smooth(105, 175, Math.abs(phi))),
      relief: wide ? 1.2 : 1.7,
      liftOffset: wide ? 0.0 : 0.4,
      tipDip: -0.9,
      width: wide ? 34 : 21,
      thick: wide ? 2.6 : 2.9,
      steps: seg(7, 5),
      dirBias: [-Math.sign(phi) * 0.28, -0.95, -0.15],
      biasWeight: 0.52,
      allowOverLine: 0.8,
      rootShade: 0.76,
      tipShade: 0.96,
      edgeAO: 0.65,
    });
  }

  for (const side of [-1, 1]) {
    const ear = ears.sides[side > 0 ? 0 : 1];
    const F = ear.front / DEG;
    const B = ear.back / DEG;
    const top = ear.top / DEG;
    specs.push({
      seed: id++,
      phi: side * (F - 10.5),
      eps: top + 15,
      len: 34,
      relief: 0.9,
      liftOffset: 0.0,
      tipDip: -0.8,
      width: 15,
      thick: 2.1,
      steps: seg(6, 5),
      dirBias: [0, -1, 0.08],
      biasWeight: 0.72,
      allowOverLine: 0.6,
      rootShade: 0.76,
      tipShade: 0.92,
      edgeAO: 0.6,
    });
    specs.push({
      seed: id++,
      phi: side * (F - 14),
      eps: top + 14,
      len: 64,
      relief: 1.4,
      liftOffset: 0.1,
      tipDip: -0.9,
      width: 24,
      thick: 2.8,
      steps: seg(7, 5),
      dirBias: [0, -0.35, -0.93],
      biasWeight: 0.65,
      allowOverLine: 0.9,
      rootShade: 0.76,
      tipShade: 0.98,
      edgeAO: 0.65,
    });
    for (let k = 0; k < 4; k++) {
      const wide = k % 2 === 0;
      const phi = side * mix(F - 24, B + 12, k / 3);
      const eps = mix(top + 28, top + 14, k / 3);
      specs.push({
        seed: id++,
        phi,
        eps,
        len: mix(74, 62, k / 3),
        relief: wide ? 1.6 : 2.1,
        liftOffset: wide ? 0.2 : 0.6,
        tipDip: -1.1,
        width: wide ? 32 : 22,
        thick: wide ? 3.2 : 3.6,
        steps: seg(7, 5),
        dirBias: [0, -0.45, -0.88],
        biasWeight: 0.56,
        allowOverLine: 1.0,
        rootShade: 0.78,
        tipShade: 1.02,
        edgeAO: 0.72,
      });
    }
  }

  const midCount = 19;
  for (let i = 0; i < midCount; i++) {
    const phi = mix(-174, 174, i / (midCount - 1));
    if (Math.abs(phi) < 42) continue;
    const wide = i % 2 === 0;
    const isBack = smooth(95, 165, Math.abs(phi));
    const eps = mix(46, 36, isBack) + (wide ? 3 : -4) + (hash1(id * 23) - 0.5) * 4;
    const whorlSweep = -Math.sign(phi - 12) * 0.22 * isBack;
    specs.push({
      seed: id++,
      phi,
      eps,
      len: mix(90, 84, isBack),
      relief: wide ? 1.8 : 2.5,
      liftOffset: wide ? 0.3 : 0.9,
      tipDip: -1.2,
      width: wide ? 36 : 23,
      thick: wide ? 3.5 : 4.0,
      steps: seg(8, 6),
      dirBias: [whorlSweep, -0.62, -0.78],
      biasWeight: 0.40,
      allowOverLine: 1.2,
      rootShade: 0.78,
      tipShade: 1.05,
      edgeAO: 0.72,
    });
  }

  const crownCount = 18;
  for (let i = 0; i < crownCount; i++) {
    const phi = mix(-170, 170, i / (crownCount - 1));
    const absPhi = Math.abs(phi);
    const wide = i % 2 === 0;
    const isFront = smooth(90, 20, absPhi);
    const eps = mix(64, 70, isFront) + (wide ? 2 : -3);
    const sweepBias =
      look === "Off the face"
        ? [0, -0.05, -1.0]
        : [sweepSign * 0.72 * isFront, -0.25, mix(-0.85, 0.58, isFront)];
    specs.push({
      seed: id++,
      phi,
      eps,
      len: mix(94, 96, isFront),
      relief: wide ? 2.1 : 2.8,
      liftOffset: wide ? 0.6 : 1.3,
      tipDip: -1.4,
      width: wide ? 34 : 23,
      thick: wide ? 4.0 : 4.6,
      steps: seg(8, 6),
      dirBias: sweepBias,
      biasWeight: mix(0.30, 0.50, isFront),
      allowOverLine: mix(1.4, 3.8, isFront),
      keepAboveBrow: true,
      bank: sweepSign * 0.08 * isFront,
      rootShade: 0.80,
      tipShade: 1.08,
      edgeAO: 0.80,
    });
  }

  const offFace = look === "Off the face";
  const fringeCount = 12;
  for (let i = 0; i < fringeCount; i++) {
    const u = i / (fringeCount - 1);
    const wide = i % 2 === 0;
    const phi = offFace
      ? mix(-68, 68, u)
      : sweepSign < 0
        ? mix(partPhi + 3, -46, u)
        : mix(partPhi - 3, 46, u);
    const eps = offFace ? 24 + 8 * (1 - Math.abs(phi) / 72) : mix(56, 36, u) + (wide ? 2 : -2);
    const dirBias = offFace
      ? [Math.sin(phi * DEG) * 0.18, 0.14, -0.97]
      : [sweepSign * 0.90, -0.24, 0.36];
    specs.push({
      seed: id++,
      phi,
      eps,
      len: offFace ? 112 : mix(78, 54, u),
      relief: wide ? 2.1 : 2.8,
      liftOffset: wide ? 0.5 : 1.2,
      tipDip: -1.6,
      width: wide ? mix(28, 24, u) : mix(20, 17, u),
      thick: wide ? 4.0 : 4.4,
      steps: seg(8, 6),
      dirBias,
      biasWeight: 0.66,
      allowOverLine: offFace ? 1.2 : 3.8,
      keepAboveBrow: true,
      curl: sweepSign * 0.12,
      rootShade: 0.78,
      tipShade: 1.11,
      edgeAO: offFace ? 0.68 : 0.88,
    });
  }

  if (offFace) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const u = i / 3;
        specs.push({
          seed: id++,
          phi: side * mix(54, 92, u),
          eps: mix(38, 22, u),
          len: mix(94, 78, u),
          relief: i % 2 === 0 ? 1.6 : 2.2,
          liftOffset: i % 2 === 0 ? 0.2 : 0.8,
          tipDip: -1.3,
          width: i % 2 === 0 ? 32 : 22,
          thick: 3.4,
          steps: seg(8, 6),
          dirBias: [0, -0.25, -0.96],
          biasWeight: 0.62,
          allowOverLine: 1.2,
          keepAboveBrow: true,
          rootShade: 0.78,
          tipShade: 1.06,
          edgeAO: 0.65,
        });
      }
    }
  }

  if (!offFace) {
    const lightSide = partPhi >= 0 ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      const u = i / 5;
      const phi = lightSide * mix(Math.abs(partPhi) - 8, Math.abs(partPhi) + 34, u);
      const eps = mix(36, 24, u);
      specs.push({
        seed: id++,
        phi,
        eps,
        len: mix(72, 54, u),
        relief: 1.9,
        liftOffset: 0.5,
        tipDip: -1.4,
        width: 26,
        thick: 3.6,
        steps: seg(7, 5),
        dirBias: [lightSide * 0.34, -0.36, -0.87],
        biasWeight: 0.65,
        allowOverLine: 1.2,
        keepAboveBrow: true,
        rootShade: 0.78,
        tipShade: 1.05,
        edgeAO: 0.72,
      });
    }
  }

  const accents = [
    { phi: partPhi - sweepSign * -10, eps: 66, len: 74, width: 17, thick: 3.8 },
    { phi: partPhi - sweepSign * -24, eps: 58, len: 66, width: 16, thick: 3.6 },
    { phi: -sweepSign * 6, eps: 72, len: 74, width: 18, thick: 4.0 },
    { phi: -138, eps: 52, len: 68, width: 20, thick: 3.2 },
    { phi: 138, eps: 52, len: 68, width: 20, thick: 3.2 },
  ];
  for (const ac of accents) {
    const isFront = Math.abs(ac.phi) < 75;
    specs.push({
      seed: id++,
      phi: ac.phi,
      eps: ac.eps,
      len: ac.len,
      relief: isFront ? 2.2 : 1.6,
      liftOffset: isFront ? 0.9 : 0.4,
      tipDip: -1.8,
      width: ac.width,
      thick: ac.thick,
      steps: seg(8, 6),
      dirBias: isFront
        ? offFace
          ? [0, 0.1, -1]
          : [sweepSign * 0.82, -0.18, 0.50]
        : [0, -0.55, -0.83],
      biasWeight: 0.55,
      allowOverLine: isFront ? 3.2 : 0.8,
      keepAboveBrow: true,
      rootShade: 0.82,
      tipShade: 1.13,
      edgeAO: 0.80,
    });
  }

  addSpecList(specs);
  return { under, locks };
}


function bobVolumeMm(at, far, partPhiDeg, look) {
  const top = smooth(10 * DEG, 48 * DEG, at.eps);
  const sideGrad = smooth(0, 14, far) ** 0.85;
  let h = mix(0.45, mix(3.4, 7.6, top), sideGrad);
  if (look !== "Off the face") {
    const dPart = at.phi / DEG - partPhiDeg;
    const onTop = smooth(16 * DEG, 34 * DEG, at.eps) * smooth(-0.4, 0.4, at.q[2]);
    h -= 1.8 * Math.exp(-((dPart / 8.0) ** 2)) * onTop * smooth(2, 10, far);
  }
  return Math.max(0.45, h);
}

function wrapDeg(deg) {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  return d;
}

function pingPongU(frac, sectors = 6) {
  const s = frac * sectors;
  const k = Math.floor(s);
  const f = s - k;
  const u = k % 2 === 0 ? f : 1 - f;
  return 0.02 + 0.96 * clamp(u, 0, 1);
}

function smoothAppendedNormals(out, vertStart, vertCount, idxStart, guideBlend = 0.16) {
  const acc = new Float32Array(vertCount * 3);
  const P = out.position;
  const idx = out.index;
  for (let i = idxStart; i < idx.length; i += 3) {
    const ia = idx[i], ib = idx[i + 1], ic = idx[i + 2];
    const ax = P[ia * 3], ay = P[ia * 3 + 1], az = P[ia * 3 + 2];
    const bx = P[ib * 3] - ax, by = P[ib * 3 + 1] - ay, bz = P[ib * 3 + 2] - az;
    const cx = P[ic * 3] - ax, cy = P[ic * 3 + 1] - ay, cz = P[ic * 3 + 2] - az;
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    for (const v of [ia, ib, ic]) {
      const lv = v - vertStart;
      if (lv >= 0 && lv < vertCount) {
        acc[lv * 3] += nx;
        acc[lv * 3 + 1] += ny;
        acc[lv * 3 + 2] += nz;
      }
    }
  }
  const N = out.normal;
  for (let lv = 0; lv < vertCount; lv++) {
    const gx = acc[lv * 3], gy = acc[lv * 3 + 1], gz = acc[lv * 3 + 2];
    const gl = Math.hypot(gx, gy, gz);
    if (gl < 1e-8) continue;
    const gv = vertStart + lv;
    const bx = mix(gx / gl, N[gv * 3], guideBlend);
    const by = mix(gy / gl, N[gv * 3 + 1], guideBlend);
    const bz = mix(gz / gl, N[gv * 3 + 2], guideBlend);
    const bl = Math.hypot(bx, by, bz) || 1;
    N[gv * 3] = bx / bl;
    N[gv * 3 + 1] = by / bl;
    N[gv * 3 + 2] = bz / bl;
  }
}

function bobClumpSample(aRad, t) {
  const warp =
    aRad +
    0.15 * Math.sin(aRad * 3.0 + 0.65) +
    0.09 * Math.cos(aRad * 5.0 - 1.15) +
    0.055 * Math.sin(aRad * 7.0 + 2.3);
  const sideMask = smooth(42 * DEG, 86 * DEG, Math.abs(aRad)) * smooth(140 * DEG, 96 * DEG, Math.abs(aRad));
  const flowBend =
    0.055 * Math.sin(t * Math.PI * 1.15 + Math.sin(aRad * 3.0)) -
    Math.sign(aRad || 1) * 0.055 * sideMask * t * t;

  const mCoord = ((warp + flowBend) / TAU + 4) * 15;
  const mId = Math.floor(mCoord);
  const mf = mCoord - mId;
  const mRidge = Math.sin(Math.PI * mf) ** 0.72;
  const mStr = 0.62 + 0.56 * hash1(mId * 31 + 7);

  const fCoord = ((warp * 1.03 + flowBend * 1.2 + 0.035 * Math.sin(aRad * 11 + t * 2.5)) / TAU + 4) * 38;
  const fId = Math.floor(fCoord);
  const ff = fCoord - fId;
  const fRidge = Math.sin(Math.PI * ff) ** 0.78;
  const fStr = 0.52 + 0.68 * hash1(fId * 53 + 13);

  const lockTintVar = 0.94 + 0.13 * hash1(mId * 71 + 19) + 0.05 * (hash1(fId * 29 + 5) - 0.5);
  return { mRidge, mStr, fRidge, fStr, lockTintVar, mId };
}

function makeBobSurfaceModel(ctx, look) {
  const { body, f, k, mm, seat } = ctx;
  const cz = f.centre[2];
  const offFace = look === "Off the face";
  const partPhiDeg =
    look === "Swept right" ? 32 :
    look === "Swept left" ? -32 :
    look === "Parted" ? 8 :
    look === "As cut" ? 24 : 0;
  const sweepSign =
    look === "Swept left" ? 1 :
    look === "Swept right" ? -1 :
    look === "As cut" ? -1 : 0;

  const eyeOuterDeg = Math.max(...f.eyes.map((e) => (Math.abs(e.phi) + e.wide) / DEG));
  const eyeTopDeg = Math.max(...f.eyes.map((e) => (e.eps + e.tall) / DEG));
  const templeStartDeg = clamp(eyeOuterDeg + 9.5, 36, 50);
  const curtainFullDeg = clamp(templeStartDeg + 20, 56, 70);
  const safeBrowDeg = Math.max(eyeTopDeg + 8.5, 16.5);

  const jawY = f.eye[1] - 0.094 * k;
  const napeEndY = f.eye[1] - 0.070 * k;

  const qFront = aimAt(partPhiDeg * DEG, (offFace ? 30 : 35) * DEG);
  const qWhorl = aimAt(partPhiDeg * 0.28 * DEG, 74 * DEG);

  const fringeEndEpsDeg = (aDeg) => {
    if (offFace) {
      return 25.0 + 3.0 * smooth(0, 48, Math.abs(aDeg));
    }
    if (look === "Parted") {
      const d = Math.abs(wrapDeg(aDeg - partPhiDeg));
      return mix(safeBrowDeg + 8.0, safeBrowDeg + 2.2, smooth(0, 46, d) ** 0.85);
    }
    const d = wrapDeg(aDeg - partPhiDeg);
    const onHeavy = sweepSign < 0 ? d <= 0 : d >= 0;
    const dist = Math.abs(d);
    if (onHeavy) {
      return mix(safeBrowDeg + 8.5, safeBrowDeg + 1.8, smooth(0, 76, dist) ** 0.80);
    }
    return mix(safeBrowDeg + 8.5, safeBrowDeg + 3.2, smooth(0, 32, dist) ** 0.85);
  };

  const crownLiftMm = (aDeg, u, isHeavy) => {
    const absA = Math.abs(aDeg);
    const isBack = smooth(95, 162, absA);
    const isFront = smooth(72, 16, absA);
    const dPart = Math.abs(wrapDeg(aDeg - partPhiDeg));
    const partCrease = offFace ? 1.0 : mix(0.32, 1.0, smooth(0, 13, dPart) ** 0.80);
    const asymBoost = offFace || look === "Parted" ? 1.0 : isHeavy ? 1.24 : 0.86;
    const frontArch = (offFace ? 15.0 : 18.5) * asymBoost * Math.sin(Math.PI * clamp(u * 0.92, 0.06, 0.95)) ** 0.68;
    const sideArch = (15.0 * asymBoost + 3.5 * isBack) * smooth(0.0, 0.32, u);
    const base = mix(sideArch, frontArch, isFront * 0.78);
    const occiputCurve = mix(1.0, 1.14, isBack * smooth(0.14, 0.48, u) * smooth(0.95, 0.52, u));
    return Math.max(4.5, (4.8 + base * occiputCurve) * mix(partCrease, 1.0, smooth(0.0, 0.42, u)));
  };

  const sampleColumn = (aDeg, rows) => {
    const aRad = aDeg * DEG;
    const absA = Math.abs(aDeg);
    const dPart = wrapDeg(aDeg - partPhiDeg);
    const absDPart = Math.abs(dPart);
    const isHeavy = sweepSign < 0 ? dPart <= 0 : dPart >= 0;
    const isBack = smooth(96, 162, absA);
    const curtainBlend = smooth(templeStartDeg, curtainFullDeg, absA);

    const spineS = offFace
      ? smooth(0, 110, absA)
      : smooth(0, 118, absDPart);
    const qStart = unit([
      mix(qFront[0], qWhorl[0], spineS),
      mix(qFront[1], qWhorl[1], spineS),
      mix(qFront[2], qWhorl[2], spineS),
    ]);
    const startAt = f.aim(seat(qStart, 0).p);

    const clHem = bobClumpSample(aRad, 1.0);
    const clusterWave =
      (Math.sin(aRad * 5.0 + 0.4) * 0.55 + Math.cos(aRad * 8.0 - 0.9) * 0.45) * 4.0 * mm;
    const featherUp = ((1 - clHem.mRidge) * 3.0 + (1 - clHem.fRidge) * 1.2) * mm;
    const rawCurtainEndY = mix(jawY, napeEndY, isBack) + clusterWave + featherUp;

    const fEpsDeg = fringeEndEpsDeg(aDeg) + (1 - clHem.mRidge) * 0.9 + (1 - clHem.fRidge) * 0.35;
    const fringeTipSeat = seat(aimAt(aRad, fEpsDeg * DEG), 4.8 * mm);
    const endY = mix(fringeTipSeat.p[1], rawCurtainEndY, curtainBlend ** 1.1);

    const leaveEpsDeg = mix(8, -14, isBack);
    const leaveQ = aimAt(aRad, leaveEpsDeg * DEG);
    const leaveLiftMm = crownLiftMm(aDeg, 0.55, isHeavy) + mix(2.2, 3.0, isBack);
    const leavePtBase = seat(leaveQ, leaveLiftMm * mm).p;
    const leaveY = leavePtBase[1];
    const leaveR = Math.hypot(leavePtBase[0], leavePtBase[2] - cz);
    const leaveAng = Math.atan2(leavePtBase[0], leavePtBase[2] - cz);

    const hangs = curtainBlend > 0.04 && endY < leaveY - 0.005 * k;
    const hangDrop = hangs ? Math.max(0, leaveY - endY) : 0;
    const domeArc = Math.max(0.04 * k, length(sub(leavePtBase, seat(qStart, 6 * mm).p)));
    const scalpFrac = hangs ? clamp(domeArc / (domeArc + hangDrop), 0.38, 0.78) : 1.0;

    const forwardSweepRad = absA < 96 ? -Math.sign(aDeg || 1) * 0.08 * smooth(48, 72, absA) * smooth(104, 72, absA) : 0;
    const tuckMm = mix(17.5, 29.0, isBack);
    const swellMm = mix(4.2, 2.2, isBack);

    const pts = [];
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const cl = bobClumpSample(aRad, t);
      const reliefEnv = smooth(0.04, 0.24, t) * mix(1.0, 0.65, smooth(0.84, 1.0, t));
      const reliefMm = ((cl.mRidge - 0.44) * 3.4 * cl.mStr + (cl.fRidge - 0.46) * 1.5 * cl.fStr) * reliefEnv;

      let p, nGuide;
      if (!hangs || t <= scalpFrac) {
        const u = t / scalpFrac;
        const targetEps = hangs ? leaveEpsDeg : fEpsDeg;
        const phiCurve = smooth(0, 1, u ** (curtainBlend < 0.5 ? 0.80 : 0.94));
        const curPhi = startAt.phi + wrapDeg((aRad - startAt.phi) / DEG) * DEG * phiCurve;
        const curEps = mix(startAt.eps, targetEps * DEG, u ** (curtainBlend < 0.5 ? 1.10 : 1.0));
        const q = aimAt(curPhi, curEps);

        let hMm = crownLiftMm(aDeg, u * scalpFrac, isHeavy);
        if (!hangs) {
          hMm = mix(hMm, 4.4, smooth(0.66, 1.0, u) ** 1.25);
        } else {
          hMm = mix(hMm, leaveLiftMm, smooth(0.50, 1.0, u));
        }
        hMm = Math.max(3.2, hMm + reliefMm * mix(0.65, 1.0, curtainBlend));
        const st = seat(q, hMm * mm);
        p = body.clear(st.p, 0.0028 * k);
        nGuide = st.n;
      } else {
        const v = (t - scalpFrac) / (1 - scalpFrac);
        const y = mix(leaveY, endY, v);
        const swell = Math.sin(Math.PI * clamp(v * 0.80, 0, 1)) * swellMm * mm;
        const tuck = tuckMm * mm * v ** 1.50;
        const ang = leaveAng + forwardSweepRad * v * v;
        const rad = Math.max(leaveR * 0.62, leaveR + swell - tuck + reliefMm * mm);
        p = [Math.sin(ang) * rad, y, cz + Math.cos(ang) * rad];
        p = body.clear(p, 0.0080 * k);
        const minSideAng = (templeStartDeg + 6) * DEG;
        if (Math.abs(ang) < minSideAng) {
          const minX = Math.sin(minSideAng) * Math.hypot(p[0], p[2] - cz);
          if (Math.abs(p[0]) < minX) p[0] = Math.sign(ang || 1) * minX;
        }
        nGuide = unit([p[0], -0.22 * k * v, p[2] - cz]);
      }

      const partAO = offFace ? 1.0 : mix(0.68, 1.0, smooth(0, 12, absDPart) + 0.65 * smooth(0.0, 0.35, t));
      const rootToTip = mix(0.78, 1.06, smooth(0.03, 0.78, t));
      const clumpAO = mix(0.80, 1.10, cl.mRidge) * mix(0.91, 1.06, cl.fRidge);
      const crownSheen = 1.0 + 0.09 * Math.exp(-(((t - 0.32) / 0.14) ** 2)) * (0.4 + 0.6 * cl.mRidge);
      const shade = clamp(partAO * rootToTip * clumpAO * crownSheen * cl.lockTintVar, 0.50, 1.18);

      pts.push({ p, n: nGuide, t, shade, cl, hangs });
    }

    for (let pass = 0; pass < 3; pass++) {
      const prev = pts.map((pt) => pt.p);
      for (let r = 1; r < rows; r++) {
        const avg = [
          0.25 * prev[r - 1][0] + 0.5 * prev[r][0] + 0.25 * prev[r + 1][0],
          0.25 * prev[r - 1][1] + 0.5 * prev[r][1] + 0.25 * prev[r + 1][1],
          0.25 * prev[r - 1][2] + 0.5 * prev[r][2] + 0.25 * prev[r + 1][2],
        ];
        const minClr = pts[r].hangs && r / rows > scalpFrac * 0.9 ? 0.0078 * k : 0.0028 * k;
        pts[r].p = body.clear(avg, minClr);
      }
    }

    return { pts, hangs, curtainBlend, endY, leaveY, isBack, isHeavy };
  };

  return { partPhiDeg, sweepSign, offFace, templeStartDeg, curtainFullDeg, safeBrowDeg, jawY, napeEndY, sampleColumn };
}

function buildSculptedBob(ctx, game) {
  const { body, f, k, mm, ears, hair, look, seat, hangSkin } = ctx;
  const model = makeBobSurfaceModel(ctx, look);

  const hl = makeHairlineHelper(ears, { forehead: 22.8, burnFrac: 0.42, nape: -48 });
  const heightFn = (at, far) => bobVolumeMm(at, far, model.partPhiDeg, look);
  const under = buildTaperedUnderLayer(ctx, hl, heightFn, { fadeDeg: 10 });

  const locks = { position: [], normal: [], color: [], uv: [], index: [], bones: [], weights: [] };
  const cz = f.centre[2];

  const cols = game ? 64 : 88;
  const outerRows = game ? 12 : 18;
  const innerRows = 4;
  const totalRings = outerRows + 1 + innerRows;

  const shellVertStart = locks.position.length / 3;
  const shellIdxStart = locks.index.length;

  const colData = [];
  for (let j = 0; j < cols; j++) {
    const aDeg = mix(-180, 180, j / cols);
    colData.push({ aDeg, frac: j / cols, ...model.sampleColumn(aDeg, outerRows) });
  }

  const ringGrid = Array.from({ length: cols }, () => new Int32Array(totalRings));
  for (let j = 0; j < cols; j++) {
    const col = colData[j];
    const uCoord = pingPongU(col.frac, 6);
    const { color: colColor } = lockTint(hair, 500 + (col.pts[outerRows].cl.mId & 63), 0.010);

    for (let r = 0; r <= outerRows; r++) {
      const st = col.pts[r];
      const idxV = locks.position.length / 3;
      ringGrid[j][r] = idxV;
      const skinning = hangSkin(st.p);
      locks.position.push(st.p[0], st.p[1], st.p[2]);
      locks.normal.push(st.n[0], st.n[1], st.n[2]);
      locks.color.push(
        clamp(colColor.r * st.shade, 0, 1),
        clamp(colColor.g * st.shade, 0, 1),
        clamp(colColor.b * st.shade, 0, 1),
      );
      locks.uv.push(uCoord, 0.02 + 0.96 * st.t);
      locks.bones.push(...skinning[0]);
      locks.weights.push(...skinning[1]);
    }

    const hemOuter = col.pts[outerRows];
    const innerSteps = [
      { backT: 0.97, insetMm: 4.0, upMm: 1.5, ao: 0.72 },
      { backT: 0.86, insetMm: 8.5, upMm: 0.0, ao: 0.56 },
      { backT: 0.68, insetMm: 10.5, upMm: 0.0, ao: 0.48 },
      { backT: 0.48, insetMm: 11.5, upMm: 0.0, ao: 0.44 },
    ];
    for (let ir = 0; ir < innerRows; ir++) {
      const cfg = innerSteps[ir];
      const refIdx = clamp(Math.round(cfg.backT * outerRows), 1, outerRows);
      const ref = col.pts[refIdx];
      let ip;
      if (col.hangs) {
        const dx = ref.p[0], dz = ref.p[2] - cz;
        const rad = Math.hypot(dx, dz) || 1e-6;
        const inset = Math.min(cfg.insetMm * mm, rad * 0.22);
        ip = [dx * ((rad - inset) / rad), ref.p[1] + cfg.upMm * mm, cz + dz * ((rad - inset) / rad)];
        ip = body.clear(ip, 0.0042 * k);
      } else {
        const stAt = f.aim(ref.p);
        const hIn = ir === 0 ? 2.4 : 1.4;
        ip = body.clear(seat(stAt.q, hIn * mm).p, 0.0014 * k);
      }
      const inN = ir === 0
        ? unit([hemOuter.n[0] * 0.3, -0.92, hemOuter.n[2] * 0.3])
        : unit([-ref.n[0], -0.25, -ref.n[2]]);
      const idxV = locks.position.length / 3;
      ringGrid[j][outerRows + 1 + ir] = idxV;
      const skinning = hangSkin(ip);
      locks.position.push(ip[0], ip[1], ip[2]);
      locks.normal.push(inN[0], inN[1], inN[2]);
      locks.color.push(
        clamp(hair.r * cfg.ao, 0, 1),
        clamp(hair.g * cfg.ao, 0, 1),
        clamp(hair.b * cfg.ao, 0, 1),
      );
      locks.uv.push(uCoord, 0.96 - 0.12 * ir);
      locks.bones.push(...skinning[0]);
      locks.weights.push(...skinning[1]);
    }
  }

  for (let j = 0; j < cols; j++) {
    const j1 = (j + 1) % cols;
    for (let r = 0; r + 1 < totalRings; r++) {
      const a = ringGrid[j][r];
      const b = ringGrid[j1][r];
      const c = ringGrid[j1][r + 1];
      const d = ringGrid[j][r + 1];
      locks.index.push(a, d, c, a, c, b);
    }
  }

  smoothAppendedNormals(locks, shellVertStart, locks.position.length / 3 - shellVertStart, shellIdxStart, 0.14);

  const seg = (full, lo) => (game ? lo : full);
  let id = 800;

  const traceSurfaceAccent = (aStartDeg, aEndDeg, t0, t1, reliefMm, steps, endDropMm = 0) => {
    const stations = [];
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const aDeg = aStartDeg + wrapDeg(aEndDeg - aStartDeg) * smooth(0, 1, u);
      const t = mix(t0, t1, u);
      const col = model.sampleColumn(aDeg, 10);
      const fIdx = clamp(t * 10, 0, 10);
      const i0 = Math.floor(fIdx), i1 = Math.min(10, i0 + 1), fr = fIdx - i0;
      const pBase = [
        mix(col.pts[i0].p[0], col.pts[i1].p[0], fr),
        mix(col.pts[i0].p[1], col.pts[i1].p[1], fr) + endDropMm * mm * u * u,
        mix(col.pts[i0].p[2], col.pts[i1].p[2], fr),
      ];
      const nBase = unit([
        mix(col.pts[i0].n[0], col.pts[i1].n[0], fr),
        mix(col.pts[i0].n[1], col.pts[i1].n[1], fr),
        mix(col.pts[i0].n[2], col.pts[i1].n[2], fr),
      ]);
      const arch = Math.sin(Math.PI * u ** 0.78);
      const liftMm = -1.5 * (1 - smooth(0, 0.22, u)) + reliefMm * arch - 0.6 * u * u;
      let p = add(pBase, nBase, liftMm * mm);
      p = body.clear(p, col.hangs ? 0.0080 * k : 0.0028 * k);
      stations.push({ p, n: nBase, v: -1 });
    }
    return stations;
  };

  if (!model.offFace) {
    const fringeSpecs =
      look === "Parted"
        ? [
            { a0: 4, a1: -14, t0: 0.14, t1: 0.96, w: 15, th: 2.5, rel: 2.0 },
            { a0: -6, a1: -32, t0: 0.18, t1: 0.98, w: 18, th: 2.8, rel: 2.3 },
            { a0: -22, a1: -44, t0: 0.22, t1: 0.96, w: 14, th: 2.4, rel: 2.0 },
            { a0: 14, a1: 30, t0: 0.16, t1: 0.96, w: 16, th: 2.5, rel: 2.0 },
            { a0: 26, a1: 44, t0: 0.20, t1: 0.98, w: 15, th: 2.4, rel: 2.1 },
          ]
        : [
            { a0: model.partPhiDeg - model.sweepSign * -4, a1: model.partPhiDeg + model.sweepSign * 18, t0: 0.12, t1: 0.94, w: 17, th: 2.8, rel: 2.2 },
            { a0: model.partPhiDeg + model.sweepSign * 4, a1: model.partPhiDeg + model.sweepSign * 34, t0: 0.14, t1: 0.98, w: 20, th: 3.0, rel: 2.6 },
            { a0: model.partPhiDeg + model.sweepSign * 14, a1: model.partPhiDeg + model.sweepSign * 48, t0: 0.16, t1: 0.96, w: 14, th: 2.4, rel: 2.1 },
            { a0: model.partPhiDeg + model.sweepSign * 26, a1: model.partPhiDeg + model.sweepSign * 62, t0: 0.18, t1: 0.98, w: 18, th: 2.7, rel: 2.4 },
            { a0: model.partPhiDeg + model.sweepSign * 42, a1: model.partPhiDeg + model.sweepSign * 74, t0: 0.20, t1: 0.95, w: 13, th: 2.3, rel: 2.0 },
            { a0: model.partPhiDeg - model.sweepSign * 4, a1: model.partPhiDeg - model.sweepSign * 18, t0: 0.16, t1: 0.94, w: 16, th: 2.4, rel: 1.9 },
            { a0: model.partPhiDeg - model.sweepSign * 12, a1: model.partPhiDeg - model.sweepSign * 28, t0: 0.22, t1: 0.96, w: 14, th: 2.3, rel: 1.9 },
          ];

    for (const sp of fringeSpecs) {
      const stations = traceSurfaceAccent(sp.a0, sp.a1, sp.t0, sp.t1, sp.rel, seg(7, 5), 0);
      const { color, shadeVar } = lockTint(hair, id++);
      appendLock(locks, body, stations, {
        width: sp.w * mm,
        thick: sp.th * mm,
        baseColor: color,
        shadeVar: shadeVar * 1.03,
        rootShade: 0.80,
        tipShade: 1.08,
        edgeAO: 0.62,
        skinFn: hangSkin,
      });
    }
  }

  for (const side of [-1, 1]) {
    const cheekSpecs = [
      { a0: side * 56, a1: side * 54, t0: 0.26, t1: 0.88, w: 13, th: 2.6, rel: 2.0, drop: -4 },
      { a0: side * 66, a1: side * 61, t0: 0.22, t1: 0.98, w: 16, th: 2.9, rel: 2.4, drop: -2 },
      { a0: side * 78, a1: side * 72, t0: 0.28, t1: 0.92, w: 14, th: 2.6, rel: 2.1, drop: 2 },
    ];
    for (const sp of cheekSpecs) {
      const stations = traceSurfaceAccent(sp.a0, sp.a1, sp.t0, sp.t1, sp.rel, seg(8, 5), sp.drop);
      const { color, shadeVar } = lockTint(hair, id++);
      appendSolidLock(locks, stations, {
        width: sp.w * mm,
        thick: sp.th * mm,
        baseColor: color,
        shadeVar: shadeVar * 1.02,
        rootShade: 0.82,
        tipShade: 1.09,
        bank: side * 0.08,
        skinFn: hangSkin,
        rootTaper: 0.35,
        tipTaper: 0.16,
      });
    }
  }

  const layerSpecs = [
    { a0: -162, a1: -165, t0: 0.24, t1: 0.88, w: 16, th: 2.0, rel: 1.5 },
    { a0: -134, a1: -137, t0: 0.22, t1: 0.94, w: 14, th: 1.9, rel: 1.6 },
    { a0: -102, a1: -98,  t0: 0.20, t1: 0.90, w: 17, th: 2.1, rel: 1.7 },
    { a0: -84,  a1: -78,  t0: 0.24, t1: 0.95, w: 14, th: 2.0, rel: 1.6 },
    { a0: 84,   a1: 79,   t0: 0.24, t1: 0.93, w: 14, th: 2.0, rel: 1.6 },
    { a0: 106,  a1: 102,  t0: 0.20, t1: 0.95, w: 17, th: 2.1, rel: 1.7 },
    { a0: 138,  a1: 141,  t0: 0.22, t1: 0.89, w: 15, th: 1.9, rel: 1.6 },
    { a0: 166,  a1: 169,  t0: 0.24, t1: 0.93, w: 16, th: 2.0, rel: 1.5 },
  ];
  for (const sp of layerSpecs) {
    const stations = traceSurfaceAccent(sp.a0, sp.a1, sp.t0, sp.t1, sp.rel, seg(7, 5), 0);
    const { color, shadeVar } = lockTint(hair, id++);
    appendLock(locks, body, stations, {
      width: sp.w * mm,
      thick: sp.th * mm,
      baseColor: color,
      shadeVar,
      rootShade: 0.82,
      tipShade: 1.07,
      edgeAO: 0.58,
      skinFn: hangSkin,
    });
  }

  return { under, locks };
}


function tieBackVolumeMm(at, far, tieQ) {
  const sideGrad = smooth(0, 14, far) ** 0.85;
  const top = smooth(10 * DEG, 50 * DEG, at.eps);
  const frontLift = smooth(0.25, 0.85, at.q[2]) * smooth(16 * DEG, 52 * DEG, at.eps);
  const nearTie = smooth(0.55, 0.96, dot(at.q, tieQ));
  return Math.max(0.45, mix(0.45, mix(2.6, 6.2, top) + 2.2 * frontLift + 4.2 * nearTie, sideGrad));
}

function buildSculptedTieBack(ctx, game) {
  const { body, f, k, mm, ears, hair, look, seat, hangSkin } = ctx;
  const tieQ = unit([0, 0.24, -0.97]);
  const tieFlow = (q) => {
    const toTie = sub(tieQ, q.map((x) => x * dot(q, tieQ)));
    return length(toTie) > 1e-4 ? unit(toTie) : tangent(q, [0, -1, 0]);
  };

  const hl = makeHairlineHelper(ears, { forehead: 22.8, burnFrac: 0.44, nape: -48 });
  const heightFn = (at, far) => tieBackVolumeMm(at, far, tieQ);
  const under = buildTaperedUnderLayer(ctx, hl, heightFn, { fadeDeg: 10, flowOverride: tieFlow });

  const locks = { position: [], normal: [], color: [], uv: [], index: [], bones: [], weights: [] };
  const seg = (full, lo) => (game ? lo : full);
  let id = 600;

  const rings = [
    { count: 13, phiMin: -80, phiMax: 80, epsFn: (a) => mix(23, 12, a / 85), len: 175, width: 36, thick: 2.2, relief: 0.8, ao: 0.44 },
    { count: 10, phiMin: -168, phiMax: 168, epsFn: (a) => mix(0, -26, smooth(84, 168, a)), len: 96, width: 28, thick: 2.0, relief: 0.8, minAbsPhi: 84, ao: 0.45 },
  ];

  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const phiDeg = mix(ring.phiMin, ring.phiMax, i / (ring.count - 1));
      const absPhi = Math.abs(phiDeg);
      if (ring.minAbsPhi && absPhi < ring.minAbsPhi) continue;
      const rnd = (n) => hash1(id * 197 + n * 41);
      const wide = i % 2 === 0;
      const epsDeg = ring.epsFn(absPhi) + (rnd(1) - 0.5) * 2.0;

      let q = aimAt(phiDeg * DEG, epsDeg * DEG);
      const steps = seg(8, 6);
      const stations = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const at = f.aim(seat(q, 0).p);
        const ear = ears.sides[at.phi > 0 ? 0 : 1];
        const ap = Math.abs(at.phi);
        if (ap > ear.front - 5.5 * DEG && ap < ear.back + 5.5 * DEG && at.eps < ear.top + 8.0 * DEG && at.eps > ear.low - 4 * DEG) {
          q = aimAt(at.phi, ear.top + 8.5 * DEG);
        }
        const atC = f.aim(seat(q, 0).p);
        const far = Math.max(0, hl.margin(atC.phi, atC.eps));
        const baseMm = heightFn(atC, far);
        const arch = Math.sin(Math.PI * t ** 0.78);
        const tierOff = wide ? 0.0 : 1.3;
        const hMm = Math.max(1.2, baseMm + tierOff + (wide ? ring.relief : ring.relief + 0.5) * arch + 0.8 * t * t);
        stations.push(seat(q, hMm * mm));

        const angToTie = Math.acos(clamp(dot(q, tieQ), -1, 1));
        if (angToTie < 0.06 && s >= 2) break;
        const stepAng = Math.min(angToTie / Math.max(1, steps - s), (ring.len * mm) / steps / (f.size || 0.1));
        q = unit(add(q, tieFlow(q), stepAng));
      }
      if (stations.length >= 3) {
        const { color, shadeVar } = lockTint(hair, id);
        appendLock(locks, body, stations, {
          width: (wide ? ring.width : ring.width * 0.68) * mm,
          thick: (wide ? ring.thick : ring.thick * 1.1) * mm,
          baseColor: color,
          shadeVar,
          rootShade: 0.82,
          tipShade: 1.04,
          edgeAO: ring.ao,
        });
      }
      id++;
    }
  }

  for (const side of [-1, 1]) {
    const ear = ears.sides[side > 0 ? 0 : 1];
    const F = ear.front / DEG;
    const top = ear.top / DEG;
    const stations = traceSeatedLock(ctx, hl, heightFn, side * (F - 20) * DEG, (top + 18) * DEG, {
      lenMm: 95,
      reliefMm: 1.0,
      tipDipMm: -0.6,
      steps: seg(7, 5),
      dirBias: [0, -0.15, -0.98],
      biasWeight: 0.72,
      allowOverLine: 0.6,
      seed: id,
    });
    if (stations.length >= 3) {
      const { color, shadeVar } = lockTint(hair, id);
      appendLock(locks, body, stations, {
        width: 24 * mm,
        thick: 2.0 * mm,
        baseColor: color,
        shadeVar,
        rootShade: 0.80,
        tipShade: 1.0,
        edgeAO: 0.48,
      });
    }
    id++;
  }

  if (look !== "Off the face") {
    const sweepSign = look === "Swept left" ? 1 : -1;
    for (let i = 0; i < 4; i++) {
      const phi = sweepSign * -mix(6, 38, i / 3);
      const stations = traceSeatedLock(ctx, hl, heightFn, phi * DEG, (34 - i * 3) * DEG, {
        lenMm: 78 - i * 8,
        reliefMm: 1.5,
        liftOffsetMm: 0.4,
        tipDipMm: -1.0,
        steps: seg(7, 5),
        dirBias: [sweepSign * 0.75, -0.12, -0.64],
        biasWeight: 0.65,
        allowOverLine: 2.4,
        keepAboveBrow: true,
        seed: id,
      });
      if (stations.length >= 3) {
        const { color, shadeVar } = lockTint(hair, id);
        appendLock(locks, body, stations, {
          width: 25 * mm,
          thick: 2.8 * mm,
          baseColor: color,
          shadeVar: shadeVar * 1.02,
          rootShade: 0.80,
          tipShade: 1.06,
          edgeAO: 0.62,
        });
      }
      id++;
    }
  }

  const tieSeat = seat(tieQ, 10 * mm);
  const tieOut = unit([tieSeat.n[0], tieSeat.n[1] * 0.85, tieSeat.n[2]]);
  const tieCenter = add(tieSeat.p, tieOut, 1.5 * mm);
  const tieColor = new T.Color("#322c2a");
  appendHairTie(locks, tieCenter, tieOut, 16 * mm, 5.2 * mm, tieColor, hangSkin, game ? 12 : 16);

  const tailStrands = [
    { ox: -10, oy: -4, spreadX: -18, outZ: 28, len: 178, w: 28, th: 6.5, shade: 0.90 },
    { ox: 0, oy: -5, spreadX: 0, outZ: 30, len: 188, w: 30, th: 7.0, shade: 0.88 },
    { ox: 10, oy: -4, spreadX: 18, outZ: 28, len: 178, w: 28, th: 6.5, shade: 0.90 },
    { ox: -12, oy: 6, spreadX: -28, outZ: 42, len: 162, w: 25, th: 6.0, shade: 1.02 },
    { ox: -4, oy: 10, spreadX: -10, outZ: 48, len: 176, w: 27, th: 6.4, shade: 1.06 },
    { ox: 4, oy: 10, spreadX: 10, outZ: 48, len: 176, w: 27, th: 6.4, shade: 1.06 },
    { ox: 12, oy: 6, spreadX: 28, outZ: 42, len: 162, w: 25, th: 6.0, shade: 1.02 },
    { ox: -14, oy: 1, spreadX: -34, outZ: 36, len: 138, w: 19, th: 4.8, shade: 1.04 },
    { ox: 14, oy: 1, spreadX: 34, outZ: 36, len: 138, w: 19, th: 4.8, shade: 1.04 },
    { ox: 0, oy: 12, spreadX: 2, outZ: 54, len: 152, w: 20, th: 5.0, shade: 1.10 },
  ];

  const tailSteps = seg(10, 7);
  for (const stSpec of tailStrands) {
    const rnd = (n) => hash1(id * 197 + n * 41);
    const p0 = [
      tieCenter[0] + stSpec.ox * 0.45 * mm,
      tieCenter[1] + stSpec.oy * 0.45 * mm,
      tieCenter[2] + 3 * mm,
    ];
    const p1 = [
      tieCenter[0] + stSpec.spreadX * 0.55 * mm,
      tieCenter[1] + (stSpec.oy * 1.4 + 14) * mm,
      tieCenter[2] - stSpec.outZ * 0.9 * mm,
    ];
    const p2 = [
      tieCenter[0] + stSpec.spreadX * 1.15 * mm,
      tieCenter[1] - stSpec.len * 0.52 * mm,
      tieCenter[2] - (stSpec.outZ * 1.35 + 16) * mm,
    ];
    const p3 = [
      tieCenter[0] + stSpec.spreadX * 0.55 * mm,
      tieCenter[1] - stSpec.len * mm,
      tieCenter[2] - (stSpec.outZ * 0.72 + 10) * mm,
    ];
    const stations = [];
    for (let s = 0; s <= tailSteps; s++) {
      const t = s / tailSteps, u = 1 - t;
      let p = [0, 1, 2].map(
        (c) => u * u * u * p0[c] + 3 * u * u * t * p1[c] + 3 * u * t * t * p2[c] + t * t * t * p3[c],
      );
      p[0] += Math.sin(t * Math.PI * 1.8 + rnd(1) * 3) * 4.5 * mm * t;
      if (s > 1) p = body.clear(p, 0.012 * k);
      const nrm = unit([stSpec.spreadX * 0.014, 0.28 * (1 - t), -1.0]);
      stations.push({ p, n: nrm, v: -1 });
    }
    const { color, shadeVar } = lockTint(hair, id);
    appendSolidLock(locks, stations, {
      width: stSpec.w * mm,
      thick: stSpec.th * mm,
      baseColor: color,
      shadeVar: shadeVar * stSpec.shade,
      rootShade: 0.72,
      tipShade: 1.10,
      roll: (rnd(2) - 0.5) * 0.2,
      bank: Math.sign(stSpec.spreadX || 1) * 0.14,
      skinFn: hangSkin,
      rootTaper: 0.40,
      tipTaper: 0.10,
    });
    id++;
  }

  return { under, locks };
}


function meshOf(part, material, name) {
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(part.position, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(part.normal, 3));
  if (part.color) g.setAttribute("color", new T.Float32BufferAttribute(part.color, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(part.uv, 2));
  g.setIndex(part.index);
  const mesh = new T.Mesh(g, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.humanWeights = {
    weights: Float32Array.from(part.weights),
    boneIndices: Uint8Array.from(part.bones),
  };
  mesh.userData.styleRegion = "head";
  return mesh;
}

export function sculptedHair(surface, style, material, plain = false, skinColor = "#96735d", gameBudget = 0) {
  if (!sculptedStyles.includes(style?.hair)) return [];
  const ctx = makeContext(surface, style, skinColor);
  const game = gameBudget > 0;

  let built = null;
  if (style.hair === "Sculpted crop") built = buildSculptedCrop(ctx, game);
  else if (style.hair === "Sculpted bob") built = buildSculptedBob(ctx, game);
  else if (style.hair === "Sculpted tie-back") built = buildSculptedTieBack(ctx, game);
  if (!built) return [];

  if (plain) {
    delete built.under.color;
    delete built.locks.color;
  }

  const underMat = material("#ffffff", "hair").clone();
  const lockMat = material("#ffffff", "hair").clone();
  if (!plain) {
    const maps = hairStrandMaps();
    underMat.vertexColors = true;
    underMat.roughness = 0.86;
    lockMat.vertexColors = true;
    lockMat.roughness = 1.0;
    lockMat.map = maps.map;
    lockMat.bumpMap = maps.bumpMap;
    lockMat.bumpScale = 0.0044;
    lockMat.roughnessMap = maps.roughnessMap;
  }
  lockMat.userData = { ...lockMat.userData, fibreLOD: true };

  const underMesh = meshOf(built.under, underMat, style.hair + " roots");
  const locksMesh = meshOf(built.locks, lockMat, style.hair);
  underMesh.userData.hairRoots = true;
  locksMesh.userData.sculptedHair = true;
  return [underMesh, locksMesh];
}
