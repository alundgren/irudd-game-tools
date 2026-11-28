import * as T from "three";
import type { Finish } from "@irudd/document";
import { ring, stations } from "./plate-shape.js";
import type { BuildPart } from "../view.js";

export function hasPlatedAxis(part: BuildPart | undefined): boolean {
  if (!part?.sweep || !part.plateField) return false;
  const role = part.motion ?? part.wear.role;
  return role === "tail" || role === "axial spine";
}

interface Control {
  readonly p: T.Vector3;
  readonly u: number;
  readonly v: number;
}

function growthUv(
  geometry: T.BufferGeometry,
  part: BuildPart,
  cageFaces: ReadonlyArray<number> | undefined,
): Uint8Array | undefined {
  const cage = part.cage;
  const width = ring.length;
  const count = stations.length;
  const expected = 2 + (count - 1) * width;
  if (
    !cage ||
    cage.vertices.length !== count * width ||
    cage.faces.length !== expected ||
    !cageFaces
  )
    return undefined;
  const coords: Control[] = cage.vertices.map((v, i) => {
    const row = Math.floor(i / width);
    const col = i % width;
    return {
      p: new T.Vector3(...v),
      u: 0.5 + 0.5 * (ring[col]?.[0] ?? 0) * (stations[row]?.[1] ?? 0),
      v: 1 - (stations[row]?.[0] ?? 0),
    };
  });
  const control = (i: number | undefined): Control => {
    const c = i === undefined ? undefined : coords[i];
    if (!c) throw new Error(`Plate ${part.id} names a missing cage vertex.`);
    return c;
  };
  const triangles = cage.faces.map((face) => {
    const first = control(face[0]);
    return face.slice(1, -1).map((id, i) => {
      const b = control(id);
      const c = control(face[i + 2]);
      return { triangle: new T.Triangle(first.p, b.p, c.p), controls: [first, b, c] as const };
    });
  });
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  if (!index) return undefined;
  const seen = new Uint8Array(pos.count);
  const at = new T.Vector3();
  const point = new T.Vector3();
  const closest = new T.Vector3();
  const weights = new T.Vector3();
  const underside = new Uint8Array(pos.count);
  for (let i = 0; i < index.count; i++) {
    const v = index.getX(i);
    if (seen[v]) continue;
    seen[v] = 1;
    const face = cageFaces[Math.floor(i / 3)] ?? 0;
    let best: (typeof triangles)[number][number] | undefined;
    let dist = Infinity;
    at.fromBufferAttribute(pos, v);
    for (const patch of triangles[face] ?? []) {
      patch.triangle.closestPointToPoint(at, point);
      const d = at.distanceToSquared(point);
      if (d < dist) {
        best = patch;
        dist = d;
        closest.copy(point);
      }
    }
    if (!best || !best.triangle.getBarycoord(closest, weights)) continue;
    const [a, b, c] = best.controls;
    uv.setXY(
      v,
      weights.x * a.u + weights.y * b.u + weights.z * c.u,
      weights.x * a.v + weights.y * b.v + weights.z * c.v,
    );
    if (face > 0 && face < expected - 1 && (face - 1) % width >= 5) underside[v] = 1;
  }
  return underside;
}

export function finishPlateSurface(
  mesh: T.Mesh,
  part: BuildPart,
  cageFaces: ReadonlyArray<number> | undefined,
  materials: (color: string, finish: Finish) => T.Material,
): void {
  const g = mesh.geometry;
  const lower = growthUv(g, part, cageFaces);
  if (!lower) return;
  const base = new T.Color(part.color);
  const uv = g.getAttribute("uv");
  const rgb = new Float32Array(3 * uv.count);
  const tileX = part.hornSwatch % 2;
  const tileY = Math.floor(part.hornSwatch / 2);
  for (let i = 0; i < uv.count; i++) {
    const t = 1 - uv.getY(i);
    const shade = lower[i] ? 0.54 : 0.83 + 0.17 * t;
    uv.setXY(i, (tileX + 0.025 + 0.95 * uv.getX(i)) / 2, (tileY + 0.025 + 0.95 * uv.getY(i)) / 2);
    rgb[i * 3] = base.r * shade;
    rgb[i * 3 + 1] = base.g * shade;
    rgb[i * 3 + 2] = base.b * shade;
  }
  g.setAttribute("color", new T.Float32BufferAttribute(rgb, 3));
  const shared = materials("#ffffff", "horn");
  shared.vertexColors = true;
  if (shared instanceof T.MeshStandardMaterial) shared.roughness = 0.72;
  mesh.material = shared;
}
