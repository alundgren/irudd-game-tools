import { required } from "./required.js";
import { Vector3 } from "three";
import type { FineHeadLayer } from "@irudd/document";
import type { HumanBody } from "./body.js";
import { boneNames } from "./catalogue.js";
import type { HumanSurface } from "./surface.js";

function topology(body: HumanBody, surface: HumanSurface) {
  const rest = body.arrays.f32("base");
  const faces = Array.from({ length: surface.bodyVertices }, (): number[] => []);
  const partner = new Int32Array(surface.bodyVertices).fill(-1);
  const distance = new Float64Array(surface.bodyVertices);
  const point = new Vector3(),
    neighbour = new Vector3();
  for (let t = 0; t < surface.bodyTriangles; t++) {
    for (let k = 0; k < 3; k++) {
      const v = surface.indices[3 * t + k] ?? 0;
      required(faces[v]).push(t);
      point.fromArray(rest, 3 * v);
      for (const step of [1, 2]) {
        const u = surface.indices[3 * t + ((k + step) % 3)] ?? 0;
        const d = point.distanceToSquared(neighbour.fromArray(rest, 3 * u));
        if (d > (distance[v] ?? 0) || (d === distance[v] && u < (partner[v] ?? 0))) {
          partner[v] = u;
          distance[v] = d;
        }
      }
    }
  }
  return { faces, partner };
}

const cached = new WeakMap<HumanBody, ReturnType<typeof topology>>();
export function headLayerFrame(body: HumanBody, surface: HumanSurface) {
  let map = cached.get(body);
  if (!map) cached.set(body, (map = topology(body, surface)));
  const { faces, partner } = map;
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  const normal = new Vector3(),
    tangent = new Vector3(),
    across = new Vector3();
  function at(v: number) {
    const bone = boneNames[surface.boneIndices[4 * v] ?? -1];
    if (bone !== "head" && !bone?.startsWith("neck"))
      throw new Error("Fine corrections belong on head and neck vertices.");
    normal.set(0, 0, 0);
    for (const t of faces[v] ?? []) {
      a.fromArray(surface.positions, 3 * (surface.indices[3 * t] ?? 0));
      b.fromArray(surface.positions, 3 * (surface.indices[3 * t + 1] ?? 0)).sub(a);
      c.fromArray(surface.positions, 3 * (surface.indices[3 * t + 2] ?? 0)).sub(a);
      normal.add(b.cross(c));
    }
    const u = partner[v] ?? -1;
    if (u < 0 || normal.length() <= 1e-14) return false;
    normal.normalize();
    tangent.fromArray(surface.positions, 3 * u).sub(a.fromArray(surface.positions, 3 * v));
    tangent.addScaledVector(normal, -normal.dot(tangent));
    if (tangent.length() <= 1e-9) return false;
    tangent.normalize();
    across.crossVectors(normal, tangent);
    return true;
  }
  return { at, tangent, across, normal };
}

export function applyHeadLayer(
  body: HumanBody,
  surface: HumanSurface,
  layer?: FineHeadLayer,
): HumanSurface {
  if (!layer?.vertices.length) return surface;
  const frame = headLayerFrame(body, surface),
    positions = surface.positions.slice();
  const move = new Vector3(),
    at = new Vector3(),
    unit = (0.00001 * surface.height) / 1.72;
  layer.vertices.forEach((v, i) => {
    const x = layer.offsets[3 * i] ?? 0,
      y = layer.offsets[3 * i + 1] ?? 0,
      z = layer.offsets[3 * i + 2] ?? 0;
    if (frame.at(v))
      move
        .copy(frame.tangent)
        .multiplyScalar(x)
        .addScaledVector(frame.across, y)
        .addScaledVector(frame.normal, z);
    else move.set(x, y, z);
    at.fromArray(surface.positions, 3 * v)
      .addScaledVector(move, unit)
      .toArray(positions, 3 * v);
  });
  return { ...surface, positions };
}
export function encodeHeadLayer(body: HumanBody, surface: HumanSurface, offsets: Float32Array) {
  const frame = headLayerFrame(body, surface);
  const vertices: number[] = [],
    saved: number[] = [],
    p = new Vector3();
  const unit = (0.00001 * surface.height) / 1.72;
  let limited = 0;
  for (let v = 0; v < surface.ids.length; v++) {
    const bone = boneNames[surface.boneIndices[v * 4] ?? -1];
    if (bone !== "head" && !bone?.startsWith("neck")) continue;
    p.fromArray(offsets, 3 * v).divideScalar(unit);
    if (!Number.isFinite(p.lengthSq())) throw new Error("Invalid fine correction.");
    if (p.lengthSq() < 0.25) continue;
    if (frame.at(v)) p.set(p.dot(frame.tangent), p.dot(frame.across), p.dot(frame.normal));
    if (p.length() > 1200) {
      p.setLength(1200);
      limited++;
    }
    const q = p.clone().round();
    if (q.length() > 1200) q.copy(p).roundToZero();
    if (q.lengthSq()) {
      vertices.push(v);
      saved.push(q.x, q.y, q.z);
    }
  }
  return { layer: vertices.length ? { vertices, offsets: saved } : undefined, limited };
}
