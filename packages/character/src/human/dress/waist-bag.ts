import * as T from "three";
import type { Vec } from "./kit.js";
import type { HumanSurface } from "../surface.js";
import type { AccessoryStyle } from "./accessory-style.js";
import { analyse, Piece, raycaster } from "./kit.js";

export const waistBagStyles = ["None", "Dispatch folio", "Running belt"];

export function fittedWaistBag(
  surface: HumanSurface,
  style: AccessoryStyle,
  clothing: readonly T.Mesh[],
  material: (tone: string, kind: string) => T.Material,
  plain: boolean,
) {
  if (!style.waistBag || !waistBagStyles.slice(1).includes(style.waistBag)) return [];
  const folio = style.waistBag === "Dispatch folio";
  const body = analyse(surface),
    scale = body.scale;
  const [cx, waist, cz] = body.joint("spine_01");
  const angle = folio ? 0.47 : -0.3;
  const height = waist + (folio ? 0.015 : 0.035) * scale;
  const casts = [raycaster(body.P, body.tri)];
  for (const mesh of clothing) {
    const g = mesh.geometry,
      p = g?.getAttribute("position");
    if (!p || mesh.userData["styleRegion"] === "head") continue;
    g.computeBoundingBox();
    const box = g.boundingBox;
    if (
      !box ||
      box.min.y > height + 0.05 * scale ||
      box.max.y < height - 0.1 * scale ||
      box.min.x > cx ||
      box.max.x < cx
    )
      continue;
    casts.push(raycaster(p.array, g.index?.array ?? Array.from({ length: p.count }, (_, i) => i)));
  }
  function radius(a: number, y: number) {
    const dir: Vec = [Math.sin(a), 0, Math.cos(a)];
    let r = 0;
    for (const cast of casts) {
      const hit = cast([cx, y, cz], dir);
      if (Number.isFinite(hit)) r = Math.max(r, hit);
    }
    return r + 0.0055 * scale;
  }
  function around(a: number, y: number, r: number): Vec {
    return [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
  }
  const leather = new Piece(),
    bag = new Piece(),
    lid = new Piece(),
    metal = new Piece();
  const band = folio ? 0.016 : 0.018;
  const rings = (
    [
      [-band, -0.002],
      [-band, 0.001],
      [band, 0.001],
      [band, -0.002],
    ] as const
  ).map(([dy, dr]) =>
    Array.from({ length: 48 }, (_, j) => {
      const a = (2 * Math.PI * j) / 48,
        y = height + scale * (dy - 0.016 * Math.cos(a - angle));
      return around(a, y, radius(a, y) + dr * scale);
    }),
  );
  leather.loft([...rings, rings[0] ?? []], (p) => body.trunkAt(p), { flip: true });

  const y0 = height - (folio ? 0.056 : 0.024) * scale;
  const r0 = radius(angle, y0);
  const skin = body.trunkAt(around(angle, height, r0));
  function panel(
    piece: Piece,
    x: number,
    y: number,
    width: number,
    tall: number,
    depth: number,
    base: number,
    power: number,
    pointed = 0,
  ) {
    const profile = [
      [0.91, 0],
      [1, 0.15],
      [1, 0.72],
      [0.94, 1],
    ] as const;
    const outline = Array.from({ length: 24 }, (_, j): readonly [number, number] => {
      const a = (2 * Math.PI * j) / 24,
        c = Math.cos(a),
        s = Math.sin(a);
      return [Math.sign(c) * Math.abs(c) ** power, Math.sign(s) * Math.abs(s) ** power];
    });
    const rows = profile.map(([factor, thick]) =>
      outline.map(([u, v]) => {
        const a = angle + ((x + u * width * factor) * scale) / r0;
        const h = y0 + (y + v * tall * factor - pointed * Math.max(0, -v) * (1 - u * u)) * scale;
        return around(a, h, radius(a, h) + (base + depth * thick) * scale);
      }),
    );
    piece.loft(rows, skin, { capStart: true, capEnd: true, flip: true });
  }
  if (folio) {
    panel(bag, 0, 0, 0.103, 0.078, 0.035, -0.004, 0.24);
    panel(lid, 0, 0.038, 0.107, 0.047, 0.012, 0.031, 0.26, 0.019);
    panel(leather, 0, 0.012, 0.011, 0.04, 0.006, 0.043, 0.26);
    panel(metal, 0, 0.002, 0.008, 0.008, 0.004, 0.049, 0.55);
    for (const x of [-0.082, 0.082]) panel(metal, x, 0.061, 0.004, 0.004, 0.004, 0.043, 1);
  } else {
    panel(bag, 0, 0, 0.126, 0.05, 0.042, -0.004, 0.65);
    panel(lid, 0, 0.009, 0.103, 0.007, 0.005, 0.036, 0.42);
    panel(metal, 0.066, -0.0005, 0.005, 0.013, 0.004, 0.043, 0.5);
  }
  const selections: readonly (readonly [Piece, string, string, string])[] = [
    [leather, "strap", folio ? "#463629" : "#333537", "leather"],
    [
      bag,
      "pocket",
      folio ? style.leatherColor || "#775138" : style.accentColor || "#b25735",
      folio ? "leather" : "canvas",
    ],
    [
      lid,
      folio ? "envelope flap" : "zip",
      folio ? "#8a6647" : "#3a3634",
      folio ? "leather" : "canvas",
    ],
    [metal, folio ? "brass fasteners" : "zip pull", folio ? "#b29859" : "#91959b", "metal"],
  ];
  return selections.map(([piece, part, colour, surfaceName]) => {
    const m = material(colour, surfaceName).clone();
    if (!plain && m instanceof T.MeshStandardMaterial) {
      m.metalness = surfaceName === "metal" ? 0.67 : 0;
      m.roughness = surfaceName === "canvas" ? 0.87 : 0.55;
    }
    return piece.mesh(
      m,
      "pelvis",
      part === "pocket" ? (style.waistBag ?? "Waist bag") : style.waistBag + " " + part,
    );
  });
}
