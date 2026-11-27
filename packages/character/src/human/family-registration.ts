import { Vector3 } from "three";

import { referenceTree, type ReferenceMesh } from "./reference-mesh.js";
type Index = Uint16Array | Uint32Array;
type Cage = { positions: Float32Array; indices: Index; triangles?: number };
function triangleFrame(positions: Float32Array, indices: Index, face: number, m: Float64Array) {
  const a = (indices[face * 3] ?? 0) * 3,
    b = (indices[face * 3 + 1] ?? 0) * 3,
    c = (indices[face * 3 + 2] ?? 0) * 3;
  for (let d = 0; d < 3; d++) {
    m[d] = (positions[b + d] ?? 0) - (positions[a + d] ?? 0);
    m[3 + d] = (positions[c + d] ?? 0) - (positions[a + d] ?? 0);
  }
  const nx = (m[1] ?? 0) * (m[5] ?? 0) - (m[2] ?? 0) * (m[4] ?? 0),
    ny = (m[2] ?? 0) * (m[3] ?? 0) - (m[0] ?? 0) * (m[5] ?? 0),
    nz = (m[0] ?? 0) * (m[4] ?? 0) - (m[1] ?? 0) * (m[3] ?? 0);
  const scale = 1 / Math.sqrt(Math.hypot(nx, ny, nz) || 1);
  m[6] = nx * scale;
  m[7] = ny * scale;
  m[8] = nz * scale;
  return m;
}
function inFrame(
  m: Float64Array,
  ox: number,
  oy: number,
  oz: number,
  out: Float64Array,
  at: number,
) {
  const c0 = (m[4] ?? 0) * (m[8] ?? 0) - (m[5] ?? 0) * (m[7] ?? 0),
    c1 = (m[5] ?? 0) * (m[6] ?? 0) - (m[3] ?? 0) * (m[8] ?? 0),
    c2 = (m[3] ?? 0) * (m[7] ?? 0) - (m[4] ?? 0) * (m[6] ?? 0);
  const det = (m[0] ?? 0) * c0 + (m[1] ?? 0) * c1 + (m[2] ?? 0) * c2;
  if (Math.abs(det) < 1e-24) {
    out[at] = out[at + 1] = out[at + 2] = 0;
    return false;
  }
  out[at] = (ox * c0 + oy * c1 + oz * c2) / det;
  out[at + 1] =
    (ox * ((m[7] ?? 0) * (m[2] ?? 0) - (m[8] ?? 0) * (m[1] ?? 0)) +
      oy * ((m[8] ?? 0) * (m[0] ?? 0) - (m[6] ?? 0) * (m[2] ?? 0)) +
      oz * ((m[6] ?? 0) * (m[1] ?? 0) - (m[7] ?? 0) * (m[0] ?? 0))) /
    det;
  out[at + 2] =
    (ox * ((m[1] ?? 0) * (m[5] ?? 0) - (m[2] ?? 0) * (m[4] ?? 0)) +
      oy * ((m[2] ?? 0) * (m[3] ?? 0) - (m[0] ?? 0) * (m[5] ?? 0)) +
      oz * ((m[0] ?? 0) * (m[4] ?? 0) - (m[1] ?? 0) * (m[3] ?? 0))) /
    det;
  return true;
}

export function vertexNormals(
  positions: Float32Array,
  indices: Index,
  triangles = indices.length / 3,
) {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < triangles * 3; t += 3) {
    const a = (indices[t] ?? 0) * 3,
      b = (indices[t + 1] ?? 0) * 3,
      c = (indices[t + 2] ?? 0) * 3;
    const ux = (positions[b] ?? 0) - (positions[a] ?? 0),
      uy = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0),
      uz = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
    const vx = (positions[c] ?? 0) - (positions[a] ?? 0),
      vy = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0),
      vz = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      normals[i] = (normals[i] ?? 0) + nx;
      normals[i + 1] = (normals[i + 1] ?? 0) + ny;
      normals[i + 2] = (normals[i + 2] ?? 0) + nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i] ?? 0, normals[i + 1] ?? 0, normals[i + 2] ?? 0) || 1;
    normals[i] = (normals[i] ?? 0) / length;
    normals[i + 1] = (normals[i + 1] ?? 0) / length;
    normals[i + 2] = (normals[i + 2] ?? 0) / length;
  }
  return normals;
}

export function registerFamily(
  neutral: ReferenceMesh,
  base: Cage,
  {
    vertices,
    reach = 0.012,
    agree = 0.5,
    slip = 0.0005,
  }: { vertices?: Uint32Array; reach?: number; agree?: number; slip?: number } = {},
) {
  const surface = referenceTree(neutral);
  const triangles = base.triangles ?? base.indices.length / 3;
  const normals = vertexNormals(base.positions, base.indices, triangles);
  const own = referenceTree({
    positions: base.positions,
    indices: Uint32Array.from(base.indices.subarray(0, triangles * 3)),
  });
  const ids = vertices ?? Uint32Array.from({ length: base.positions.length / 3 }, (_, i) => i);
  const vertex = [],
    face = [],
    weights = [],
    offset = [],
    distance = [];
  const frame = new Float64Array(9),
    local = new Float64Array(3),
    normal = new Vector3(),
    point = new Vector3();
  for (const v of ids) {
    point.fromArray(base.positions, 3 * v);
    normal.fromArray(normals, 3 * v);
    const hit = surface.nearest(point, normal, reach, agree);
    if (!hit) continue;
    const back = own.nearest(hit.hit, hit.normal, reach, agree);
    if (!back || back.hit.distanceTo(point) > slip + 0.35 * hit.distance) continue;
    const p = neutral.positions,
      { x, y, z } = point,
      { x: qx, y: qy, z: qz } = hit.hit;
    triangleFrame(p, neutral.indices, hit.face, frame);
    if (!inFrame(frame, x - qx, y - qy, z - qz, local, 0)) continue;
    vertex.push(v);
    face.push(hit.face);
    weights.push(hit.weights.x, hit.weights.y, hit.weights.z);
    offset.push(local[0] ?? 0, local[1] ?? 0, local[2] ?? 0);
    distance.push(hit.distance);
  }
  return {
    version: 1,
    familyVertices: neutral.positions.length / 3,
    familyTriangles: neutral.indices.length / 3,
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

function sameFamily(registration: ReturnType<typeof registerFamily>, mesh: ReferenceMesh) {
  if (
    mesh.positions.length / 3 !== registration.familyVertices ||
    mesh.indices.length / 3 !== registration.familyTriangles
  )
    throw new Error("This mesh does not have the topology of the registered family.");
}

export function wrapFamilyMember(
  registration: ReturnType<typeof registerFamily>,
  member: ReferenceMesh,
  keep = 1,
) {
  sameFamily(registration, member);
  const { face, weights, offset } = registration,
    p = member.positions,
    n = face.length;
  const out = new Float32Array(n * 3),
    m = new Float64Array(9);
  for (let i = 0; i < n; i++) {
    const f = face[i] ?? 0,
      a = (member.indices[f * 3] ?? 0) * 3,
      b = (member.indices[f * 3 + 1] ?? 0) * 3,
      c = (member.indices[f * 3 + 2] ?? 0) * 3;
    triangleFrame(p, member.indices, f, m);
    for (let d = 0; d < 3; d++)
      out[i * 3 + d] =
        (p[a + d] ?? 0) * (weights[i * 3] ?? 0) +
        (p[b + d] ?? 0) * (weights[i * 3 + 1] ?? 0) +
        (p[c + d] ?? 0) * (weights[i * 3 + 2] ?? 0) +
        keep *
          ((m[d] ?? 0) * (offset[i * 3] ?? 0) +
            (m[3 + d] ?? 0) * (offset[i * 3 + 1] ?? 0) +
            (m[6 + d] ?? 0) * (offset[i * 3 + 2] ?? 0));
  }
  return out;
}

export { alignPoints, transformPoints } from "./alignment-points.js";
