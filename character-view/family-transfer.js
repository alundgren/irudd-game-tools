import { Matrix4, Quaternion, Vector3 } from "three";


export function familySurface(positions, indices) {
  const faces = indices.length / 3;
  if (!faces || positions.length % 3 || indices.length % 3)
    throw new Error("A family mesh needs positions and triangles.");
  const normals = new Float32Array(faces * 3),
    centres = [0, 1, 2].map(() => new Float32Array(faces));
  for (let f = 0; f < faces; f++) {
    const a = indices[f * 3] * 3, b = indices[f * 3 + 1] * 3, c = indices[f * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[f * 3] = nx / length; normals[f * 3 + 1] = ny / length; normals[f * 3 + 2] = nz / length;
    for (let d = 0; d < 3; d++) centres[d][f] = (positions[a + d] + positions[b + d] + positions[c + d]) / 3;
  }
  const order = Uint32Array.from({ length: faces }, (_, i) => i);
  const capacity = 2 * Math.ceil(faces / 4) + 2,
    bounds = new Float32Array(capacity * 6), start = new Uint32Array(capacity),
    count = new Uint32Array(capacity), right = new Uint32Array(capacity);
  let used = 0;
  function build(lo, hi) {
    const node = used++, b = node * 6;
    bounds.fill(Infinity, b, b + 3); bounds.fill(-Infinity, b + 3, b + 6);
    for (let i = lo; i < hi; i++)
      for (let k = 0; k < 3; k++) {
        const v = indices[order[i] * 3 + k] * 3;
        for (let d = 0; d < 3; d++) {
          if (positions[v + d] < bounds[b + d]) bounds[b + d] = positions[v + d];
          if (positions[v + d] > bounds[b + 3 + d]) bounds[b + 3 + d] = positions[v + d];
        }
      }
    if (hi - lo <= 8) { start[node] = lo; count[node] = hi - lo; return node; }
    let axis = 0;
    for (let d = 1; d < 3; d++)
      if (bounds[b + 3 + d] - bounds[b + d] > bounds[b + 3 + axis] - bounds[b + axis]) axis = d;
    const key = centres[axis], part = order.subarray(lo, hi);
    part.sort((x, y) => key[x] - key[y]);
    const mid = (lo + hi) >> 1;
    build(lo, mid);
    right[node] = build(mid, hi);
    return node;
  }
  build(0, faces);
  const stack = new Uint32Array(128);
  function gap(node, x, y, z) {
    const b = node * 6;
    const dx = Math.max(bounds[b] - x, 0, x - bounds[b + 3]),
      dy = Math.max(bounds[b + 1] - y, 0, y - bounds[b + 4]),
      dz = Math.max(bounds[b + 2] - z, 0, z - bounds[b + 5]);
    return dx * dx + dy * dy + dz * dz;
  }
  function closest(x, y, z, normal, reach = Infinity, agree = -2, out = {}) {
    let best = reach * reach, face = -1, bu = 0, bv = 0, bw = 0, top = 0;
    stack[top++] = 0;
    while (top) {
      const node = stack[--top];
      if (gap(node, x, y, z) >= best) continue;
      if (!count[node]) {
        const a = node + 1, b = right[node];
        if (gap(a, x, y, z) < gap(b, x, y, z)) { stack[top++] = b; stack[top++] = a; }
        else { stack[top++] = a; stack[top++] = b; }
        continue;
      }
      for (let i = start[node]; i < start[node] + count[node]; i++) {
        const f = order[i];
        if (normal && normals[f * 3] * normal[0] + normals[f * 3 + 1] * normal[1] + normals[f * 3 + 2] * normal[2] < agree) continue;
        const A = indices[f * 3] * 3, B = indices[f * 3 + 1] * 3, C = indices[f * 3 + 2] * 3;
        const ax = positions[A], ay = positions[A + 1], az = positions[A + 2];
        const abx = positions[B] - ax, aby = positions[B + 1] - ay, abz = positions[B + 2] - az;
        const acx = positions[C] - ax, acy = positions[C + 1] - ay, acz = positions[C + 2] - az;
        const apx = x - ax, apy = y - ay, apz = z - az;
        const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
        let v, w;
        if (d1 <= 0 && d2 <= 0) { v = 0; w = 0; }
        else {
          const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
          const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
          if (d3 >= 0 && d4 <= d3) { v = 1; w = 0; }
          else {
            const vc = d1 * d4 - d3 * d2;
            if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); w = 0; }
            else {
              const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
              const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
              if (d6 >= 0 && d5 <= d6) { v = 0; w = 1; }
              else {
                const vb = d5 * d2 - d1 * d6;
                if (vb <= 0 && d2 >= 0 && d6 <= 0) { v = 0; w = d2 / (d2 - d6); }
                else {
                  const va = d3 * d6 - d5 * d4;
                  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / (d4 - d3 + (d5 - d6)); v = 1 - w; }
                  else { const s = 1 / (va + vb + vc); v = vb * s; w = vc * s; }
                }
              }
            }
          }
        }
        const qx = ax + abx * v + acx * w - x, qy = ay + aby * v + acy * w - y, qz = az + abz * v + acz * w - z;
        const d = qx * qx + qy * qy + qz * qz;
        if (d < best) { best = d; face = f; bu = 1 - v - w; bv = v; bw = w; }
      }
    }
    if (face < 0) return null;
    out.face = face; out.u = bu; out.v = bv; out.w = bw; out.distance = Math.sqrt(best);
    return out;
  }
  return { positions, indices, faces, normals, closest };
}

function triangleFrame(positions, indices, face, m) {
  const a = indices[face * 3] * 3, b = indices[face * 3 + 1] * 3, c = indices[face * 3 + 2] * 3;
  for (let d = 0; d < 3; d++) {
    m[d] = positions[b + d] - positions[a + d];
    m[3 + d] = positions[c + d] - positions[a + d];
  }
  const nx = m[1] * m[5] - m[2] * m[4], ny = m[2] * m[3] - m[0] * m[5], nz = m[0] * m[4] - m[1] * m[3];
  const scale = 1 / Math.sqrt(Math.hypot(nx, ny, nz) || 1);
  m[6] = nx * scale; m[7] = ny * scale; m[8] = nz * scale;
  return m;
}
function inFrame(m, ox, oy, oz, out, at) {
  const c0 = m[4] * m[8] - m[5] * m[7], c1 = m[5] * m[6] - m[3] * m[8], c2 = m[3] * m[7] - m[4] * m[6];
  const det = m[0] * c0 + m[1] * c1 + m[2] * c2;
  if (Math.abs(det) < 1e-24) { out[at] = out[at + 1] = out[at + 2] = 0; return false; }
  out[at] = (ox * c0 + oy * c1 + oz * c2) / det;
  out[at + 1] = (ox * (m[7] * m[2] - m[8] * m[1]) + oy * (m[8] * m[0] - m[6] * m[2]) + oz * (m[6] * m[1] - m[7] * m[0])) / det;
  out[at + 2] = (ox * (m[1] * m[5] - m[2] * m[4]) + oy * (m[2] * m[3] - m[0] * m[5]) + oz * (m[0] * m[4] - m[1] * m[3])) / det;
  return true;
}

export function vertexNormals(positions, indices, triangles = indices.length / 3) {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < triangles * 3; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { normals[i] += nx; normals[i + 1] += ny; normals[i + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length; normals[i + 1] /= length; normals[i + 2] /= length;
  }
  return normals;
}

export function registerFamily(neutral, base, { vertices, reach = 0.012, agree = 0.5, slip = 0.0005 } = {}) {
  const surface = neutral.closest ? neutral : familySurface(neutral.positions, neutral.indices);
  const triangles = base.triangles ?? base.indices.length / 3;
  const normals = vertexNormals(base.positions, base.indices, triangles);
  const own = familySurface(base.positions, base.indices.subarray(0, triangles * 3)), back = {};
  const ids = vertices ?? Uint32Array.from({ length: base.positions.length / 3 }, (_, i) => i);
  const vertex = [], face = [], weights = [], offset = [], distance = [];
  const hit = {}, frame = new Float64Array(9), local = new Float64Array(3), normal = [0, 0, 0];
  for (const v of ids) {
    const x = base.positions[v * 3], y = base.positions[v * 3 + 1], z = base.positions[v * 3 + 2];
    normal[0] = normals[v * 3]; normal[1] = normals[v * 3 + 1]; normal[2] = normals[v * 3 + 2];
    if (!surface.closest(x, y, z, normal, reach, agree, hit)) continue;
    const a = surface.indices[hit.face * 3] * 3, b = surface.indices[hit.face * 3 + 1] * 3, c = surface.indices[hit.face * 3 + 2] * 3;
    const p = surface.positions;
    const qx = p[a] * hit.u + p[b] * hit.v + p[c] * hit.w,
      qy = p[a + 1] * hit.u + p[b + 1] * hit.v + p[c + 1] * hit.w,
      qz = p[a + 2] * hit.u + p[b + 2] * hit.v + p[c + 2] * hit.w;
    const facing = surface.normals.subarray(hit.face * 3, hit.face * 3 + 3);
    if (!own.closest(qx, qy, qz, facing, reach, agree, back)) continue;
    const A = own.indices[back.face * 3] * 3, B = own.indices[back.face * 3 + 1] * 3, C = own.indices[back.face * 3 + 2] * 3;
    const o = own.positions;
    if (Math.hypot(o[A] * back.u + o[B] * back.v + o[C] * back.w - x,
      o[A + 1] * back.u + o[B + 1] * back.v + o[C + 1] * back.w - y,
      o[A + 2] * back.u + o[B + 2] * back.v + o[C + 2] * back.w - z) > slip + 0.35 * hit.distance) continue;
    triangleFrame(p, surface.indices, hit.face, frame);
    if (!inFrame(frame, x - qx, y - qy, z - qz, local, 0)) continue;
    vertex.push(v); face.push(hit.face); weights.push(hit.u, hit.v, hit.w);
    offset.push(local[0], local[1], local[2]); distance.push(hit.distance);
  }
  return {
    version: 1,
    familyVertices: surface.positions.length / 3,
    familyTriangles: surface.faces,
    baseVertices: base.positions.length / 3,
    requested: ids.length,
    vertex: Uint32Array.from(vertex),
    face: Uint32Array.from(face),
    weights: Float32Array.from(weights),
    offset: Float32Array.from(offset),
    distance: Float32Array.from(distance),
    base: Float32Array.from(base.positions),
  };
}

function sameFamily(registration, mesh) {
  if (mesh.positions.length / 3 !== registration.familyVertices || mesh.indices.length / 3 !== registration.familyTriangles)
    throw new Error("This mesh does not have the topology of the registered family.");
}

export function wrapFamilyMember(registration, member, keep = 1) {
  sameFamily(registration, member);
  const { face, weights, offset } = registration, p = member.positions, n = face.length;
  const out = new Float32Array(n * 3), m = new Float64Array(9);
  for (let i = 0; i < n; i++) {
    const f = face[i], a = member.indices[f * 3] * 3, b = member.indices[f * 3 + 1] * 3, c = member.indices[f * 3 + 2] * 3;
    triangleFrame(p, member.indices, f, m);
    for (let d = 0; d < 3; d++)
      out[i * 3 + d] = p[a + d] * weights[i * 3] + p[b + d] * weights[i * 3 + 1] + p[c + d] * weights[i * 3 + 2] +
        keep * (m[d] * offset[i * 3] + m[3 + d] * offset[i * 3 + 1] + m[6 + d] * offset[i * 3 + 2]);
  }
  return out;
}

function dominantEigenvector(a) {
  const v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) off += a[i][j] * a[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++)
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return v.map((row) => row[best]);
}

export function alignPoints(from, to, { weights, scale = false } = {}) {
  const n = from.length / 3;
  if (n < 3 || to.length !== from.length) throw new Error("Alignment needs at least three matched points.");
  const a = [0, 0, 0], b = [0, 0, 0];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    total += w;
    for (let d = 0; d < 3; d++) { a[d] += w * from[i * 3 + d]; b[d] += w * to[i * 3 + d]; }
  }
  if (!(total > 0)) throw new Error("Alignment needs positive weights.");
  for (let d = 0; d < 3; d++) { a[d] /= total; b[d] /= total; }
  const s = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let spread = 0;
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    for (let r = 0; r < 3; r++) {
      const x = from[i * 3 + r] - a[r];
      spread += w * x * x;
      for (let c = 0; c < 3; c++) s[r][c] += w * x * (to[i * 3 + c] - b[c]);
    }
  }
  const [q0, q1, q2, q3] = dominantEigenvector([
    [s[0][0] + s[1][1] + s[2][2], s[1][2] - s[2][1], s[2][0] - s[0][2], s[0][1] - s[1][0]],
    [s[1][2] - s[2][1], s[0][0] - s[1][1] - s[2][2], s[0][1] + s[1][0], s[2][0] + s[0][2]],
    [s[2][0] - s[0][2], s[0][1] + s[1][0], -s[0][0] + s[1][1] - s[2][2], s[1][2] + s[2][1]],
    [s[0][1] - s[1][0], s[2][0] + s[0][2], s[1][2] + s[2][1], -s[0][0] - s[1][1] + s[2][2]],
  ]);
  const turn = new Quaternion(q1, q2, q3, q0).normalize();
  let size = 1;
  if (scale) {
    const p = new Vector3();
    let along = 0;
    for (let i = 0; i < n; i++) {
      p.set(from[i * 3] - a[0], from[i * 3 + 1] - a[1], from[i * 3 + 2] - a[2]).applyQuaternion(turn);
      along += (weights ? weights[i] : 1) * (p.x * (to[i * 3] - b[0]) + p.y * (to[i * 3 + 1] - b[1]) + p.z * (to[i * 3 + 2] - b[2]));
    }
    size = along / spread;
  }
  const shift = new Vector3(...b).sub(new Vector3(...a).applyQuaternion(turn).multiplyScalar(size));
  return { matrix: new Matrix4().compose(shift, turn, new Vector3(size, size, size)), scale: size };
}

export function transformPoints(points, matrix) {
  const e = matrix.elements, out = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}

export function vertexFrames(positions, indices, triangles = indices.length / 3, partner) {
  const count = positions.length / 3;
  if (!partner) {
    partner = new Int32Array(count).fill(-1);
    for (let t = 0; t < triangles * 3; t += 3)
      for (let k = 0; k < 3; k++)
        if (partner[indices[t + k]] < 0) partner[indices[t + k]] = indices[t + ((k + 1) % 3)];
  }
  const normals = vertexNormals(positions, indices, triangles), frames = new Float32Array(count * 9);
  for (let v = 0; v < count; v++) {
    const j = partner[v];
    if (j < 0) { frames[v * 9] = frames[v * 9 + 4] = frames[v * 9 + 8] = 1; continue; }
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    let tx = positions[j * 3] - positions[v * 3], ty = positions[j * 3 + 1] - positions[v * 3 + 1], tz = positions[j * 3 + 2] - positions[v * 3 + 2];
    const along = tx * nx + ty * ny + tz * nz;
    tx -= along * nx; ty -= along * ny; tz -= along * nz;
    const length = Math.hypot(tx, ty, tz);
    if (length < 1e-12 || Math.hypot(nx, ny, nz) < 0.5) { frames[v * 9] = frames[v * 9 + 4] = frames[v * 9 + 8] = 1; continue; }
    tx /= length; ty /= length; tz /= length;
    frames.set([tx, ty, tz, ny * tz - nz * ty, nz * tx - nx * tz, nx * ty - ny * tx, nx, ny, nz], v * 9);
  }
  return { frames, partner };
}

export function transportDisplacements(vertices, displacements, from, to, size = 1) {
  const out = new Float32Array(displacements.length);
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i] * 9, x = displacements[i * 3], y = displacements[i * 3 + 1], z = displacements[i * 3 + 2];
    for (let axis = 0; axis < 3; axis++) {
      const along = size * (x * from[a + axis * 3] + y * from[a + axis * 3 + 1] + z * from[a + axis * 3 + 2]);
      for (let d = 0; d < 3; d++) out[i * 3 + d] += along * to[a + axis * 3 + d];
    }
  }
  return out;
}

function choleskySolve(a, n, columns) {
  for (let j = 0; j < n; j++) {
    let d = a[j * n + j];
    for (let k = 0; k < j; k++) d -= a[j * n + k] * a[j * n + k];
    if (!(d > 0)) throw new Error("The control solve is singular.");
    d = Math.sqrt(d);
    a[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let s = a[i * n + j];
      for (let k = 0; k < j; k++) s -= a[i * n + k] * a[j * n + k];
      a[i * n + j] = s / d;
    }
  }
  for (const b of columns) {
    for (let i = 0; i < n; i++) {
      let s = b[i];
      for (let k = 0; k < i; k++) s -= a[i * n + k] * b[k];
      b[i] = s / a[i * n + i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let k = i + 1; k < n; k++) s -= a[k * n + i] * b[k];
      b[i] = s / a[i * n + i];
    }
  }
}

export function solveControls(controls, rows, wanted, {
  free, scale = 1, damping = 0.02, smoothing = 0.05, pairs = [], pairWeight = 4,
} = {}) {
  const anchors = controls.ids.length, column = new Int32Array(anchors).fill(-1);
  let n = 0;
  for (let i = 0; i < anchors; i++) if (!free || free[i]) column[i] = n++;
  if (!n) return new Float32Array(anchors * 3);
  const a = new Float64Array(n * n), b = [0, 1, 2].map(() => new Float64Array(n));
  const share = (vertex) => {
    let total = 0;
    for (let j = vertex * 4; j < vertex * 4 + 4; j++) total += controls.weights[j];
    const cells = [];
    for (let j = vertex * 4; j < vertex * 4 + 4; j++)
      if (controls.weights[j] && column[controls.refs[j]] >= 0)
        cells.push([column[controls.refs[j]], (scale * controls.weights[j]) / total]);
    return cells;
  };
  function add(cells, weight, x, y, z) {
    for (const [i, wi] of cells) {
      b[0][i] += weight * wi * x; b[1][i] += weight * wi * y; b[2][i] += weight * wi * z;
      for (const [j, wj] of cells) a[i * n + j] += weight * wi * wj;
    }
  }
  let total = 0;
  const neighbours = Array.from({ length: n }, () => new Set());
  rows.forEach(({ vertex, weight = 1 }, r) => {
    const cells = share(vertex);
    add(cells, weight, wanted[r * 3], wanted[r * 3 + 1], wanted[r * 3 + 2]);
    total += weight;
    for (const [i] of cells) for (const [j] of cells) if (i !== j) neighbours[i].add(j);
  });
  const mean = total / n;
  for (const [first, second] of pairs) {
    const cells = new Map();
    for (const [i, w] of share(first)) cells.set(i, (cells.get(i) ?? 0) + w);
    for (const [i, w] of share(second)) cells.set(i, (cells.get(i) ?? 0) - w);
    add([...cells], pairWeight * mean, 0, 0, 0);
  }
  for (let i = 0; i < n; i++) {
    a[i * n + i] += damping * mean;
    for (const j of neighbours[i]) {
      const w = (smoothing * mean) / neighbours[i].size;
      a[i * n + i] += w; a[j * n + j] += w; a[i * n + j] -= w; a[j * n + i] -= w;
    }
  }
  choleskySolve(a, n, b);
  const out = new Float32Array(anchors * 3);
  for (let i = 0; i < anchors; i++)
    if (column[i] >= 0) for (let d = 0; d < 3; d++) out[i * 3 + d] = b[d][column[i]];
  return out;
}

export function contactPairs(positions, indices, triangles, vertices, reach) {
  const near = new Map(), key = (x, y, z) => x + "," + y + "," + z, cell = (x) => Math.floor(x / reach);
  const adjacent = new Map();
  const link = (a, b) => { if (!adjacent.has(a)) adjacent.set(a, new Set()); adjacent.get(a).add(b); };
  const wanted = new Set(vertices);
  for (let t = 0; t < triangles * 3; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)];
      if (wanted.has(a) && wanted.has(b)) { link(a, b); link(b, a); }
    }
  for (const v of vertices) {
    const k = key(cell(positions[v * 3]), cell(positions[v * 3 + 1]), cell(positions[v * 3 + 2]));
    if (!near.has(k)) near.set(k, []);
    near.get(k).push(v);
  }
  const close = (a, b) => {
    const ring = adjacent.get(a);
    if (!ring) return true;
    if (ring.has(b)) return false;
    for (const m of ring) if (adjacent.get(m)?.has(b)) return false;
    return true;
  };
  const pairs = [];
  for (const v of vertices) {
    const cx = cell(positions[v * 3]), cy = cell(positions[v * 3 + 1]), cz = cell(positions[v * 3 + 2]);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      for (const u of near.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
        if (u <= v) continue;
        const d = Math.hypot(positions[u * 3] - positions[v * 3], positions[u * 3 + 1] - positions[v * 3 + 1], positions[u * 3 + 2] - positions[v * 3 + 2]);
        if (d < reach && close(v, u)) pairs.push([v, u]);
      }
  }
  return pairs;
}

export function foldedTriangles(before, after, indices, triangles, counted) {
  const folded = [];
  let tested = 0;
  for (let t = 0; t < triangles; t++) {
    if (counted && !counted(t)) continue;
    const i = indices[t * 3] * 3, j = indices[t * 3 + 1] * 3, k = indices[t * 3 + 2] * 3;
    const cross = (p) => {
      const ux = p[j] - p[i], uy = p[j + 1] - p[i + 1], uz = p[j + 2] - p[i + 2];
      const vx = p[k] - p[i], vy = p[k + 1] - p[i + 1], vz = p[k + 2] - p[i + 2];
      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    };
    const old = cross(before);
    if (Math.hypot(...old) < 2 * 0.25e-6) continue;
    const now = cross(after);
    tested++;
    if (old[0] * now[0] + old[1] * now[1] + old[2] * now[2] <= 0) folded.push(t);
  }
  return { tested, folded };
}
