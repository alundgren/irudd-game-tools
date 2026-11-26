import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Finish, Knot } from "@irudd/document";
import type { RegionFit } from "./dress.js";
import { sweepGeometry } from "./surfaces/sweep.js";

export const easedKnots = (knots: ReadonlyArray<Knot>, amount: number): Knot[] =>
  knots.map(([x, y, z, a, b]) => [x, y, z, a * amount, b * amount]);

const rubber = "#34413e";

export function addEquipment(
  mesh: T.Mesh,
  fit: RegionFit,
  material: (color: string, finish: Finish) => T.Material,
): void {
  if (!fit.suit || fit.hide || fit.role === "tail") return;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return;
  const extent = box.getSize(new T.Vector3());
  const c = box.getCenter(new T.Vector3());
  const [w, h, d] = extent.toArray();
  const at = (x: number, y: number, z: number): [number, number, number] => [
    c.x + w * x,
    box.min.y + h * y,
    c.z + d * z,
  ];
  const piece = (geo: T.BufferGeometry, color: string, pos: readonly number[], finish: Finish) => {
    const object = new T.Mesh(geo, material(color, finish));
    object.position.fromArray(pos);
    object.castShadow = true;
    mesh.add(object);
  };
  const rounded = (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    color: string,
    finish: Finish,
  ) => {
    const dim = [w * sx, h * sy, d * sz] as const;
    const radius = Math.min(...dim) * 0.43;
    piece(new RoundedBoxGeometry(dim[0], dim[1], dim[2], 2, radius), color, at(x, y, z), finish);
  };
  const loop = (y: number, height: number, ww: number, dd: number, color: string) => {
    const a = at(0, y, 0);
    const b = at(0, y + height, 0);
    piece(
      sweepGeometry(
        [
          [0, 0, 0, w * ww, d * dd],
          [0, b[1] - a[1], 0, w * ww, d * dd],
        ],
        true,
      ),
      color,
      a,
      "leather",
    );
  };
  if (fit.role === "torso") {
    rounded(0, 0.51, -0.45, 0.85, 0.66, 0.38, rubber, "leather");
    rounded(0, 0.54, -0.64, 0.68, 0.5, 0.12, fit.panel, "metal");
    for (const s of [-1, 1]) {
      rounded(s * 0.34, 0.52, -0.58, 0.16, 0.62, 0.22, fit.trim, "metal");
      rounded(s * 0.24, 0.73, 0.38, 0.12, 0.32, 0.09, rubber, "leather");
    }
    loop(0.81, 0.035, 0.35, 0.42, rubber);
  } else if (fit.role === "head") {
    loop(0.14, 0.05, 0.46, 0.47, rubber);
    for (const s of [-1, 1]) rounded(s * 0.46, 0.51, -0.015, 0.13, 0.31, 0.38, fit.panel, "metal");
    rounded(0, 0.54, -0.4, 0.67, 0.41, 0.14, fit.panel, "metal");
  }
}
