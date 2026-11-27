import type { AccessoryStyle } from "./accessory-style.js";
import type { HumanSurface } from "../surface.js";
import { boneNames } from "../catalogue.js";
import { context2d, type Raster } from "../../raster.js";
interface FanPart {
  pos: number[];
  uv: number[];
  ix: number[];
}
import * as T from "three";

const fanName = "Painted folding fan";
export const handProps = ["None", fanName];

function colours(style: AccessoryStyle): [T.Color, T.Color, T.Color] {
  return [
    new T.Color(style.clothSecond ?? "#71435d"),
    new T.Color(style.clothLight ?? "#edd4ad"),
    new T.Color(style.metalColor ?? "#ba9867"),
  ];
}

function paintLeaf(style: AccessoryStyle, raster?: Raster) {
  if (!raster) return null;
  const [base, silk, gold] = colours(style);
  const canvas = raster.canvas(512, 192);
  canvas.width = 512;
  canvas.height = 192;
  const ctx = context2d(canvas);
  if (!ctx?.createLinearGradient || !ctx.arc) return null;
  const colour = (a: T.Color, b: T.Color, t: number) => "#" + a.clone().lerp(b, t).getHexString();
  const grad = ctx.createLinearGradient(0, 0, 0, 192);
  grad.addColorStop(0, colour(base, silk, 0.5));
  grad.addColorStop(0.68, colour(base, silk, 0.23));
  grad.addColorStop(1, colour(base, silk, 0.07));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 192);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = colour(base, gold, 0.82);
  for (let level = 0; level < 3; level++)
    for (let x = -40; x < 552; x += 70) {
      const centre = x + 35 * (level % 2);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(centre, 168 - level * 19, 32 - i * 6, Math.PI, 2 * Math.PI);
        ctx.stroke();
      }
    }
  ctx.fillStyle = colour(base, gold, 0.88);
  ctx.fillRect(0, 6, 512, 3);
  ctx.fillRect(0, 12, 512, 1.5);
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

export function fittedFan(
  surface: HumanSurface,
  style: AccessoryStyle,
  material: (tone: string, kind: string) => T.Material,
  plain: boolean,
  raster?: Raster,
) {
  if (style.handProp !== fanName) return [];
  const joint = (name: string) =>
    new T.Vector3().fromArray(surface.joints, 3 * boneNames.findIndex((n) => n === name + "_r"));
  const wrist = joint("hand"),
    index = joint("index_01"),
    pinky = joint("pinky_01");
  const radial = index.clone().sub(pinky).normalize();
  const along = joint("middle_01").sub(wrist).normalize();
  along.addScaledVector(radial, -along.dot(radial)).normalize();
  const face = along.clone().cross(radial).normalize();
  const grip = joint("index_02"),
    towardsThumb = joint("thumb_03").sub(grip).normalize();
  grip.addScaledVector(towardsThumb, (0.008 * surface.height) / 1.72);
  const scale = surface.height / 1.72;
  const point = (angle: number, r: number, depth: number) => {
    const p = grip
      .clone()
      .addScaledVector(radial, r * Math.cos(angle) * scale)
      .addScaledVector(along, r * Math.sin(angle) * scale)
      .addScaledVector(face, depth * scale);
    return p.toArray();
  };
  const leaf: FanPart = { pos: [], uv: [], ix: [] },
    wood: FanPart = { pos: [], uv: [], ix: [] },
    trim: FanPart = { pos: [], uv: [], ix: [] };
  function quad(
    part: FanPart,
    a: number[],
    b: number[],
    c: number[],
    d: number[],
    u0 = 0,
    u1 = 1,
    v0 = 0,
    v1 = 1,
  ) {
    const i = part.pos.length / 3;
    part.pos.push(...a, ...b, ...c, ...d);
    part.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    part.ix.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  const folds = 14,
    spread = 2.42,
    angle = (i: number) => spread * (i / (folds * 2) - 0.5);
  for (let i = 0; i < folds * 2; i++) {
    const a = angle(i),
      b = angle(i + 1),
      z = i % 2 ? -0.006 : 0.006;
    const outer = (j: number) => 0.225 + (j % 2 ? 0.0 : 0.0025);
    quad(
      leaf,
      point(a, 0.091, z * 0.52),
      point(b, 0.091, -z * 0.52),
      point(b, outer(i + 1), -z),
      point(a, outer(i), z),
      i / (2 * folds),
      (i + 1) / (2 * folds),
    );
  }
  for (let i = 0; i <= folds; i++) {
    const a = angle(i * 2),
      guard = i === 0 || i === folds;
    const profile: readonly [number, number][] = [
      [-0.016, 0.0055],
      [0.013, 0.005],
      [0.054, 0.0024],
      [0.093, 0.0032],
      [guard ? 0.23 : 0.222, guard ? 0.0034 : 0.0012],
    ];
    const depth = 0.0069 - i * 0.00023;
    const edge = (radius: number, offset: number, depth: number) =>
      grip
        .clone()
        .addScaledVector(radial, (radius * Math.cos(a) - offset * Math.sin(a)) * scale)
        .addScaledVector(along, (radius * Math.sin(a) + offset * Math.cos(a)) * scale)
        .addScaledVector(face, depth * scale)
        .toArray();
    for (let j = 1; j < profile.length; j++) {
      const [r0, w0] = profile[j - 1] ?? [0, 0],
        [r1, w1] = profile[j] ?? [0, 0];
      quad(
        wood,
        edge(r0, -w0, depth),
        edge(r0, w0, depth),
        edge(r1, w1, depth),
        edge(r1, -w1, depth),
      );
      if (guard)
        quad(
          trim,
          edge(r0, -w0, depth + 0.0005),
          edge(r0, -w0 * 0.36, depth + 0.0005),
          edge(r1, -w1 * 0.36, depth + 0.0005),
          edge(r1, -w1, depth + 0.0005),
        );
    }
  }
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8,
      b = ((i + 1) * Math.PI) / 8;
    quad(
      trim,
      point(a, 0.0003, 0.011),
      point(b, 0.0003, 0.011),
      point(b, 0.0062, 0.009),
      point(a, 0.0062, 0.009),
    );
  }
  const [base, , gold] = colours(style);
  const make = (part: FanPart, colour: string, kind: string, title: string) => {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(part.pos, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(part.uv, 2));
    g.setIndex(part.ix);
    g.computeVertexNormals();
    const mat = material(colour, kind).clone();
    mat.side = T.DoubleSide;
    if (!plain && part === leaf && mat instanceof T.MeshStandardMaterial) {
      const tex = paintLeaf(style, raster);
      if (tex) {
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.userData["ownedLivery"] = true;
      }
      mat.roughness = 0.58;
    }
    mat.userData = { ...mat.userData, foldedCloth: true };
    const mesh = new T.Mesh(g, mat);
    mesh.name = title;
    mesh.userData["styleRegion"] = "hand_r";
    mesh.castShadow = true;
    return mesh;
  };
  return [
    make(leaf, "#" + base.getHexString(), "satin", "Pleated silk fan leaf"),
    make(wood, style.leatherColor ?? "#614735", "leather", "Lacquered fan sticks"),
    make(trim, "#" + gold.getHexString(), "metal", "Fan guards and rivet"),
  ];
}
