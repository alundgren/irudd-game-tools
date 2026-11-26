import * as T from "three";
import { facialMorphNormals } from "./anatomy.js";
import { eyeFitsOf, type EyeFit } from "./eyes.js";

export const lidFollow = {
  up: 1.5,
  down: 2,
  corner: 4.5,
  near: 0.5,
  above: 8,
  below: 7,
} as const;

const smooth = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function share(
  fit: EyeFit,
  x: number,
  y: number,
  z: number,
  mm: number,
): readonly [number, number] | null {
  const f = lidFollow,
    { centre, side, ball, opening } = fit,
    a = side * (x - centre.x),
    h = y - centre.y;
  if (z - centre.z < -0.3 * ball || Math.abs(a) > 1.5 * ball || Math.abs(h) > 1.6 * ball)
    return null;
  const across =
    smooth(a, opening.inner, opening.inner + f.corner * mm) *
    (1 - smooth(a, opening.outer - f.corner * mm, opening.outer));
  if (!across) return null;
  const [bottom, top] = opening.at(a);
  const weight =
    h > top
      ? 1 - smooth(h - top, f.near * mm, f.above * mm)
      : h < bottom
        ? 1 - smooth(bottom - h, f.near * mm, f.below * mm)
        : 1;
  if (!weight) return null;
  const edge = h > top ? top : h < bottom ? bottom : h,
    flat = Math.max(0.3 * ball * ball, ball * ball - a * a - edge * edge);
  return [across * weight, -edge / Math.sqrt(flat)];
}

function targets(geometry: T.BufferGeometry, fits: ReadonlyArray<EyeFit>, mm: number) {
  const p = geometry.getAttribute("position"),
    up = new Float32Array(p.count * 3),
    down = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++)
    for (const fit of fits) {
      if (fit.side * p.getX(i) < 0) continue;
      const s = share(fit, p.getX(i), p.getY(i), p.getZ(i), mm);
      if (!s) continue;
      up[i * 3 + 1] = lidFollow.up * mm * s[0];
      up[i * 3 + 2] = lidFollow.up * mm * s[0] * s[1];
      down[i * 3 + 1] = -lidFollow.down * mm * s[0];
      down[i * 3 + 2] = -lidFollow.down * mm * s[0] * s[1];
    }
  return { up, down };
}

export function followGaze(
  group: T.Group,
  scale: number,
  skinVertices: ReadonlyArray<number>,
): void {
  const meshes = group.children.filter((c): c is T.Mesh => c instanceof T.Mesh);
  const skin = meshes.find((m) => m.userData["faceSurface"]),
    eyes = meshes.find((m) => m.userData["eyePiece"]),
    fits = eyes && eyeFitsOf.get(eyes);
  if (!skin || !eyes || !fits) return;
  const mm = 0.001 * scale;
  for (const mesh of [skin, meshes.find((m) => m.name === "brows-and-lashes")]) {
    if (!mesh) continue;
    const g = mesh.geometry,
      { up, down } = targets(g, fits, mm),
      list = (g.morphAttributes["position"] ??= []);
    for (const [name, values] of [
      ["LookUp", up],
      ["LookDown", down],
    ] as const) {
      const target = new T.BufferAttribute(values, 3);
      target.name = name;
      list.push(target);
    }
    if (mesh === skin) facialMorphNormals(g, skinVertices);
    mesh.morphTargetDictionary = undefined;
    mesh.updateMorphTargets();
  }
  const g = eyes.geometry,
    p = g.getAttribute("position"),
    uv = g.getAttribute("uv"),
    { up, down } = targets(g, fits, mm);
  for (const [name, values] of [
    ["LookUp", up],
    ["LookDown", down],
  ] as const) {
    const target = g.morphAttributes["position"]?.find((t) => t.name === name);
    if (!target) continue;
    const array = target.array;
    for (let i = 0; i < p.count; i++)
      if (Math.abs(uv.getY(i) - 0.94) < 1e-4)
        for (let d = 0; d < 3; d++)
          array[i * 3 + d] = (array[i * 3 + d] ?? 0) + (values[i * 3 + d] ?? 0);
  }
}
