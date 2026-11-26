import type { FaceSculpt } from "@irudd/document";
import * as T from "three";

const bell = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  Math.exp(-(((x - cx) / rx) ** 2) - ((y - cy) / ry) ** 2);

export function deformFace(
  geometry: T.BufferGeometry,
  sculpt: FaceSculpt = {},
  chinFraction = 0,
  includeStructure = true,
): T.BufferGeometry {
  if (!Object.values(sculpt).some((v) => v !== 1)) return geometry;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;
  const span = box.getSize(new T.Vector3());
  const center = box.getCenter(new T.Vector3());
  const half = span.x * 0.5;
  const height = span.y * (1 - chinFraction);
  const chin = box.min.y + span.y * chinFraction;
  const pos = geometry.getAttribute("position");
  const axis = (key: keyof FaceSculpt): number => (sculpt[key] ?? 1) - 1;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const x = (px - center.x) / half;
    const y = (py - chin) / height;
    const side = Math.sign(x);
    const ax = Math.abs(x);
    const front = T.MathUtils.smoothstep(
      (pz - center.z) / Math.max(span.z * 0.5, 0.001),
      0.04,
      0.7,
    );
    const eye = bell(ax, y, 0.385, 0.56, 0.265, 0.1) * front;
    const lid = bell(ax, y, 0.385, 0.56, 0.19, 0.075) * front;
    const lip = bell(x, y, 0, 0.245, 0.43, 0.085) * front;
    const corner = bell(ax, y, 0.245, 0.245, 0.14, 0.068) * front;
    const lower = bell(x, y, 0, 0.085, 0.75, 0.13);
    let dx = side * 0.26 * axis("eyes") * eye + (x - side * 0.385) * 0.65 * axis("eye size") * lid;
    let dy = (y - 0.56) * 0.95 * axis("eye size") * lid;
    dx += x * 0.9 * axis("mouth") * lip;
    dy += (y - 0.245) * 0.95 * axis("lips") * lip + 0.094 * axis("smile") * corner;
    dy -= 0.14 * axis("chin") * lower;
    let dz = 0.065 * axis("lips") * lip + 0.08 * axis("chin") * lower * front;
    if (includeStructure) {
      dx += x * 0.44 * axis("jaw") * bell(ax, y, 0.55, 0.19, 0.53, 0.21);
      dz += 0.3 * axis("nose") * bell(x, y, 0, 0.43, 0.22, 0.11) * front;
      dy += 0.068 * axis("brow") * bell(ax, y, 0.37, 0.66, 0.33, 0.08) * front;
      dz += 0.1 * axis("brow") * bell(ax, y, 0.37, 0.66, 0.33, 0.08) * front;
      dx += side * 0.13 * axis("cheek") * bell(ax, y, 0.57, 0.41, 0.32, 0.15) * front;
    }
    pos.setXYZ(i, px + dx * half, py + dy * height, pz + dz * span.z * 0.5);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
