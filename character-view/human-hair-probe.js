import { analyse } from "./human-style-kit.js";
import { smoothHumanSurface } from "./human-surface.js";
import { hairline, headFrame } from "./human-fringe.js";

const DEG = Math.PI / 180;

function soup(meshes) {
  const out = [];
  for (const mesh of meshes) {
    const p = mesh.geometry.attributes.position.array, index = mesh.geometry.index?.array;
    const n = index ? index.length : p.length / 3;
    for (let i = 0; i < n; i++) { const v = (index ? index[i] : i) * 3; out.push(p[v], p[v + 1], p[v + 2]); }
  }
  return Float32Array.from(out);
}

function depthMap(tris, dir, centre, half = .22, cell = .0008) {
  const right = [dir[2], 0, -dir[0]], rl = Math.hypot(right[0], right[2]) || 1;
  const rx = Math.abs(dir[1]) > .99 ? [1, 0, 0] : [right[0] / rl, 0, right[2] / rl];
  const up = [dir[1] * rx[2] - dir[2] * rx[1], dir[2] * rx[0] - dir[0] * rx[2], dir[0] * rx[1] - dir[1] * rx[0]];
  const n = Math.ceil(2 * half / cell), depth = new Float32Array(n * n).fill(Infinity);
  const project = (x, y, z) => { const a = x - centre[0], b = y - centre[1], c = z - centre[2]; return [(a * rx[0] + b * rx[1] + c * rx[2] + half) / cell, (a * up[0] + b * up[1] + c * up[2] + half) / cell, a * dir[0] + b * dir[1] + c * dir[2]]; };
  for (let t = 0; t < tris.length; t += 9) {
    const a = project(tris[t], tris[t + 1], tris[t + 2]), b = project(tris[t + 3], tris[t + 4], tris[t + 5]), c = project(tris[t + 6], tris[t + 7], tris[t + 8]);
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(n - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(n - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    if (Math.abs(area) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + .5, py = y + .5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area, w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
      if (z < depth[y * n + x]) depth[y * n + x] = z;
    }
  }
  return p => { const [x, y, z] = project(p[0], p[1], p[2]), i = Math.floor(x), j = Math.floor(y); return { z, front: i < 0 || j < 0 || i >= n || j >= n ? Infinity : depth[j * n + i] }; };
}

function radialIndex(tris, centre, cells = 96) {
  const faces = Array.from({ length: 6 }, () => new Map());
  const face = (x, y, z) => { const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z); return ax >= ay && ax >= az ? (x > 0 ? 0 : 1) : ay >= az ? (y > 0 ? 2 : 3) : (z > 0 ? 4 : 5); };
  const onFace = (n, x, y, z) => n < 2 ? [y / Math.abs(x), z / Math.abs(x), n ? -x : x] : n < 4 ? [x / Math.abs(y), z / Math.abs(y), n === 3 ? -y : y] : [x / Math.abs(z), y / Math.abs(z), n === 5 ? -z : z];
  const cellOf = a => Math.floor((a + 1) / 2 * cells);
  for (let t = 0; t < tris.length; t += 9) {
    const v = [0, 3, 6].map(o => [tris[t + o] - centre[0], tris[t + o + 1] - centre[1], tris[t + o + 2] - centre[2]]);
    for (const n of new Set(v.map(p => face(...p)))) {
      const q = v.map(p => onFace(n, ...p));
      if (q.some(p => p[2] <= 1e-6)) {
        if (q.every(p => p[2] <= 1e-6)) continue;
        for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) { const key = i * cells + j; if (!faces[n].has(key)) faces[n].set(key, []); faces[n].get(key).push(t); }
        continue;
      }
      const i0 = Math.max(0, cellOf(Math.min(q[0][0], q[1][0], q[2][0]))), i1 = Math.min(cells - 1, cellOf(Math.max(q[0][0], q[1][0], q[2][0])));
      const j0 = Math.max(0, cellOf(Math.min(q[0][1], q[1][1], q[2][1]))), j1 = Math.min(cells - 1, cellOf(Math.max(q[0][1], q[1][1], q[2][1])));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const key = i * cells + j; if (!faces[n].has(key)) faces[n].set(key, []); faces[n].get(key).push(t); }
    }
  }
  return u => {
    const n = face(u[0], u[1], u[2]), q = onFace(n, u[0], u[1], u[2]), list = faces[n].get(clampCell(cellOf(q[0]), cells) * cells + clampCell(cellOf(q[1]), cells)), hits = [];
    if (!list) return hits;
    for (const t of list) {
      const ax = tris[t] - centre[0], ay = tris[t + 1] - centre[1], az = tris[t + 2] - centre[2];
      const e1x = tris[t + 3] - centre[0] - ax, e1y = tris[t + 4] - centre[1] - ay, e1z = tris[t + 5] - centre[2] - az, e2x = tris[t + 6] - centre[0] - ax, e2y = tris[t + 7] - centre[1] - ay, e2z = tris[t + 8] - centre[2] - az;
      const px = u[1] * e2z - u[2] * e2y, py = u[2] * e2x - u[0] * e2z, pz = u[0] * e2y - u[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const s = (-ax * px - ay * py - az * pz) / det;
      if (s < 0 || s > 1) continue;
      const qx = -ay * e1z + az * e1y, qy = -az * e1x + ax * e1z, qz = -ax * e1y + ay * e1x, w = (u[0] * qx + u[1] * qy + u[2] * qz) / det;
      if (w < 0 || s + w > 1) continue;
      const far = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (far > 0) hits.push(far);
    }
    return hits;
  };
}
const clampCell = (i, cells) => Math.min(cells - 1, Math.max(0, i));

const VIEWS = { front: 0, left: 35, right: -35 };

export function probeHair(surface, meshes) {
  const body = analyse(surface), f = headFrame(body), skin = smoothHumanSurface(surface), P = skin.positions, hair = soup(meshes);
  const near = p => Math.hypot(p[0] - f.centre[0], p[1] - f.centre[1], p[2] - f.centre[2]) < .2 * f.k + f.size;
  const solid = [];
  for (let i = 0; i < skin.indices.length; i += 3) {
    const a = skin.indices[i] * 3, b = skin.indices[i + 1] * 3, c = skin.indices[i + 2] * 3;
    if (near([P[a], P[a + 1], P[a + 2]])) solid.push(P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]);
  }
  const headTris = Float32Array.from(solid), headIndex = skin.names.indexOf("head");
  const whole = new Float32Array(skin.indices.length * 3);
  for (let i = 0; i < skin.indices.length; i++) whole.set(P.subarray(skin.indices[i] * 3, skin.indices[i] * 3 + 3), i * 3);
  const headPoints = [];
  for (let v = 0; v < skin.boneIndices.length / 4; v++) {
    let w = 0;
    for (let j = v * 4; j < v * 4 + 4; j++) if (skin.boneIndices[j] === headIndex) w += skin.weights[j];
    if (w > .5) headPoints.push([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
  }
  const brow = Math.max(...f.eyes.map(e => e.eps + e.tall)), temple = Math.max(...f.eyes.map(e => Math.abs(e.phi) + e.wide));
  const eyeSamples = f.eyes.map(e => {
    const points = [];
    for (let v = body.count; v < surface.ids.length; v++) if (surface.ids[v] >= 14598 && surface.ids[v] <= 14741) {
      const p = [surface.positions[v * 3], surface.positions[v * 3 + 1], surface.positions[v * 3 + 2]];
      if ((p[0] > 0) === (e.centre[0] > 0) && p[2] > e.centre[2] + .004 * f.k) points.push(p);
    }
    return points.length ? points : [e.centre];
  });
  const face = [], scalp = [];
  for (const p of headPoints) {
    const a = f.aim(p), line = a.eps - hairline(a.phi);
    if (line > 4 * DEG) scalp.push(p);
    else if (Math.abs(a.phi) < temple + 4 * DEG && a.eps < brow + 4 * DEG && a.eps > brow - 62 * DEG && p[2] > f.centre[2]) face.push(p);
  }
  const eyes = {}, faceHidden = {};
  for (const [name, yaw] of Object.entries(VIEWS)) {
    const dir = [-Math.sin(yaw * DEG), 0, -Math.cos(yaw * DEG)], hairDepth = depthMap(hair, dir, f.centre), headDepth = depthMap(headTris, dir, f.centre);
    const hidden = points => {
      let seen = 0, covered = 0;
      for (const p of points) {
        const own = headDepth(p);
        if (own.front < own.z - .004) continue;
        seen++;
        if (hairDepth(p).front < own.z - .0005) covered++;
      }
      return seen ? covered / seen : 0;
    };
    eyes[name] = eyeSamples.map(hidden);
    faceHidden[name] = hidden(face);
  }
  const hairRays = radialIndex(hair, f.centre), headRays = radialIndex(whole, f.centre);
  let bare = 0;
  for (const p of scalp) {
    const d = [p[0] - f.centre[0], p[1] - f.centre[1], p[2] - f.centre[2]], r = Math.hypot(...d), u = [d[0] / r, d[1] / r, d[2] / r];
    if (!hairRays(u).some(hit => hit > r - .002)) bare++;
  }
  let inside = 0, deepest = 0, vertices = 0, below = 0;
  const seen = new Set();
  for (let i = 0; i < hair.length; i += 3) {
    const key = Math.round(hair[i] * 2e4) + "/" + Math.round(hair[i + 1] * 2e4) + "/" + Math.round(hair[i + 2] * 2e4);
    if (seen.has(key)) continue;
    seen.add(key); vertices++;
    const d = [hair[i] - f.centre[0], hair[i + 1] - f.centre[1], hair[i + 2] - f.centre[2]], r = Math.hypot(...d);
    if (r > f.size * 1.9 || r < 1e-6) continue;
    const hits = headRays([d[0] / r, d[1] / r, d[2] / r]).filter(hit => hit > r);
    if (hits.length % 2 === 0) continue;
    const depth = Math.min(...hits) - r;
    if (depth <= .001) continue;
    if (d[1] / r < -.45) below++; else { inside++; deepest = Math.max(deepest, depth); }
  }
  return {
    eyes, face: faceHidden,
    scalp: { samples: scalp.length, bare: scalp.length ? bare / scalp.length : 0 },
    inside: { vertices, count: inside, share: vertices ? inside / vertices : 0, deepest, below },
    triangles: hair.length / 9,
  };
}
