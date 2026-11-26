import * as T from "three";
import { context2d, type Raster } from "../raster.js";
import {
  castBones,
  castCardSide,
  castPieces,
  castSlug,
  castSurfaceSide,
  castSurfaceSubjects,
  type CastFigureData,
  type CastFigureName,
  type HumanCast,
} from "./cast-data.js";
import { castCardIndex, castCardPixels } from "./cast-hair.js";
import { castLidTexels, paintCastLids } from "./cast-lids.js";
import {
  castOutfit,
  castOutfitPicture,
  wornCastOutfit,
  type CastOutfitStyle,
  type CastPicture,
} from "./cast-wardrobe.js";
import { boneNames, castPeople } from "./catalogue.js";
import { irisBaseTone } from "./eye-paint.js";
import type { HumanPaint } from "./paint-data.js";
import type { ClothJoints } from "./cloth-joints.js";
import type { SmoothSurface } from "./smooth.js";

const at = (a: ArrayLike<number>, i: number) => a[i] ?? 0;

export interface CastWeights {
  readonly boneIndices: Uint16Array;
  readonly weights: Float32Array;
}

export interface CastStyle extends CastOutfitStyle {
  readonly castShape?: number | undefined;
  readonly castPigment?: number | undefined;
}

export interface CastFinish {
  readonly raster: Raster;
  readonly paint: HumanPaint;
}

function spread<A extends Float32Array | Uint8Array>(
  values: A,
  source: Uint16Array,
  size: number,
  make: (length: number) => A,
): A {
  const out = make(source.length * size);
  for (let i = 0; i < source.length; i++)
    for (let j = 0; j < size; j++) out[i * size + j] = at(values, at(source, i) * size + j);
  return out;
}
const floats = (length: number) => new Float32Array(length);

function shapeFigure(
  figure: CastFigureData,
  surface: SmoothSurface,
): { readonly rest: Float32Array; readonly moved: Float32Array } {
  const field = figure.field;
  const { starts, vertices, weights } = field;
  const delta = Float32Array.from(field.rest, (value) => -value);
  for (let h = 0; h < starts.length - 1; h++)
    for (let p = at(starts, h); p < at(starts, h + 1); p++)
      for (let d = 0; d < 3; d++)
        delta[h * 3 + d] =
          at(delta, h * 3 + d) + at(weights, p) * at(surface.positions, at(vertices, p) * 3 + d);
  const { near, pull } = field;
  const rest = figure.positions,
    moved = rest.slice();
  for (let i = 0; i < rest.length / 3; i++)
    for (let j = 0; j < field.reach; j++) {
      const p = i * field.reach + j;
      for (let d = 0; d < 3; d++)
        moved[i * 3 + d] = at(moved, i * 3 + d) + at(pull, p) * at(delta, at(near, p) * 3 + d);
    }
  return { rest, moved };
}

function morph(values: Float32Array, name: string): T.BufferAttribute {
  const result = new T.BufferAttribute(values, 3);
  result.name = name;
  return result;
}

function smoothNormals(positions: Float32Array, index: Uint16Array): Float32Array {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
  geometry.setIndex(new T.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute("normal").array;
  geometry.dispose();
  return normal instanceof Float32Array ? normal : Float32Array.from(normal);
}

function picture(raster: Raster, bytes: Uint8ClampedArray, side: number): T.CanvasTexture {
  const canvas = raster.canvas(side, side),
    pen = context2d(canvas);
  const image = pen.createImageData(side, side);
  image.data.set(bytes);
  pen.putImageData(image, 0, 0);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

const smoothstep = (x: number, a: number, b: number) => T.MathUtils.smoothstep(x, a, b);

function paintedSkin(
  raster: Raster,
  paint: CastPicture,
  colour: string,
  blend: { readonly pixelDelta: Uint8Array } | null,
  pigment: number | undefined,
  eyeColour: string | undefined,
  lids: Parameters<typeof paintCastLids>[3] | null,
): T.CanvasTexture {
  const rgb = paint.pixels,
    mask = paint.mask.slice();
  const rgba = new Uint8ClampedArray(mask.length * 4);
  const delta = blend && pigment ? blend.pixelDelta : null;
  const half = paint.side / 2;
  const lut = new T.Color(colour).toArray().map((value, channel) => {
    const gain = T.MathUtils.clamp(value / at(paint.tone, channel), 0.02, 6);
    return Uint8Array.from({ length: 256 }, (_, i) => {
      const srgb = i / 255;
      const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      const tinted = Math.min(1, linear * gain);
      return Math.round(
        255 * (tinted <= 0.0031308 ? 12.92 * tinted : 1.055 * tinted ** (1 / 2.4) - 0.055),
      );
    });
  });
  for (let i = 0; i < mask.length; i++) {
    for (let k = 0; k < 3; k++) {
      let orig = at(rgb, i * 3 + k);
      const x = i % paint.side;
      if (delta && pigment && x >= half && i < paint.side * half) {
        const p = (Math.floor(i / paint.side) * half + x - half) * 3 + k;
        const donor = (orig + at(delta, p)) & 255;
        orig = Math.round(orig + (donor - orig) * pigment);
      }
      rgba[i * 4 + k] = orig;
    }
    rgba[i * 4 + 3] = 255;
  }
  if (lids) paintCastLids(rgba, mask, paint.side, lids, paint.tone);
  for (let i = 0; i < mask.length; i++) {
    const m = at(mask, i);
    if (!m) continue;
    for (let k = 0; k < 3; k++) {
      const orig = at(rgba, i * 4 + k);
      rgba[i * 4 + k] = orig + (m / 255) * (at(lut[k] ?? [], orig) - orig);
    }
  }
  const target = eyeColour === undefined ? undefined : irisBaseTone(eyeColour);
  if (target) {
    const cx = 0.263 * half,
      cy = 0.929 * half,
      rx = 0.02 * half,
      ry = 0.019 * half;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const radius = Math.hypot((x - cx) / rx, (y - cy) / ry);
        const i = y * paint.side + x + half;
        const light = 0.23 * at(rgb, 3 * i) + 0.62 * at(rgb, 3 * i + 1) + 0.15 * at(rgb, 3 * i + 2);
        const fade =
          smoothstep(radius, 0.27, 0.45) *
          (1 - smoothstep(radius, 0.79, 1)) *
          smoothstep(light, 20, 60) *
          (1 - smoothstep(light, 178, 228));
        for (let k = 0; k < 3; k++)
          rgba[4 * i + k] =
            at(rgba, 4 * i + k) + fade * ((at(target, k) * light) / 112 - at(rgba, 4 * i + k));
      }
  }
  return picture(raster, rgba, paint.side);
}

function applyCastSurface(
  raster: Raster,
  paint: HumanPaint,
  material: T.MeshStandardMaterial,
  name: CastFigureName,
  style: CastOutfitStyle,
): void {
  const head = castPeople[name]?.subject ?? "";
  if (!Object.hasOwn(castSurfaceSubjects, head)) return;
  const outfit = wornCastOutfit(name, style);
  const top = outfit ? castPieces[outfit.top].subject : head;
  const bottom = outfit ? castPieces[outfit.bottom].subject : head;
  const side = castSurfaceSide,
    half = side / 2;
  const normals = new Uint8ClampedArray(side * side * 4).fill(255);
  const roughness = new Uint8ClampedArray(normals.length).fill(255);
  for (let i = 0; i < normals.length; i += 4) normals[i] = normals[i + 1] = 128;
  const signed = (value: number) => (value >= 128 ? value - 256 : value);
  const fill = (
    subject: string,
    region: "body" | "head",
    left: number,
    startY: number,
    rows: number,
    step: number,
  ) => {
    const src = paint.castPicture(`castSurface.${subject}.${region}`);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < half; x++) {
        const a = 3 * (y * step * half + x),
          b = a + 3 * half * (step - 1);
        const dst = 4 * ((startY + y) * side + left + x);
        const nx = (signed(at(src, a)) + signed(at(src, b))) / 127;
        const ny = (signed(at(src, a + 1)) + signed(at(src, b + 1))) / 127;
        const scale = 127 / Math.hypot(nx, ny, 1);
        normals[dst] = 128 + scale * nx;
        normals[dst + 1] = 128 + scale * ny;
        normals[dst + 2] = 128 + scale;
        const intensity = (at(src, a + 2) + at(src, b + 2)) / 255;
        roughness[dst + 1] = 255 * Math.max(0.24, 0.9 - 0.9 * Math.sqrt(intensity));
      }
  };
  fill(top, "body", 0, 0, side, 1);
  fill(head, "head", half, 0, half, 1);
  if (bottom !== top) fill(bottom, "body", half, half, half, 2);
  material.normalMap = picture(raster, normals, side);
  material.roughnessMap = picture(raster, roughness, side);
  material.normalMap.colorSpace = material.roughnessMap.colorSpace = T.NoColorSpace;
  material.roughness = 1;
}

export interface CastMesh {
  readonly mesh: T.Mesh;
  readonly weights: CastWeights;
  readonly clothJoints?: ClothJoints;
}

function hairCards(
  figure: CastFigureData,
  cardPicture: Uint8Array | null,
  moved: Float32Array,
  rest: Float32Array,
  origin: readonly [number, number, number],
  material: (colour: string) => T.Material,
  raster: Raster | null,
): CastMesh | null {
  const cards = figure.cards;
  if (!cards) return null;
  const originalPoints = cards.points,
    points = originalPoints.slice();
  const { ties, shares } = cards;
  for (let i = 0; i < points.length; i++) {
    const d = i % 3,
      vertex = i - d;
    points[i] = at(points, i) - at(origin, d);
    for (let k = vertex; k < vertex + 3; k++)
      points[i] =
        at(points, i) +
        at(shares, k) * (at(moved, at(ties, k) * 3 + d) - at(rest, at(ties, k) * 3 + d));
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(points, 3));
  geometry.setAttribute("uv", new T.BufferAttribute(cards.uv.slice(), 2));
  geometry.setIndex(new T.BufferAttribute(castCardIndex(originalPoints, cards.index), 1));
  geometry.computeVertexNormals();
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes["position"] = [...cards.expressions].map(([name, values]) =>
    morph(values.slice(), name),
  );
  const mat = material("#ffffff").clone();
  mat.side = T.DoubleSide;
  if (raster && cardPicture && mat instanceof T.MeshStandardMaterial) {
    mat.map = picture(raster, castCardPixels(cardPicture, castCardSide), castCardSide);
    mat.userData["ownedColorMap"] = true;
    mat.userData["castHairSheet"] = true;
    mat.alphaTest = 0.5;
    mat.roughness = 0.6;
    mat.metalness = 0;
  }
  const mesh = new T.Mesh(geometry, mat),
    count = points.length / 3;
  const boneIndices = new Uint16Array(count * 4),
    weights = new Float32Array(count * 4);
  const head = boneNames.indexOf("head");
  for (let i = 0; i < count; i++) {
    boneIndices[i * 4] = head;
    weights[i * 4] = 1;
  }
  mesh.name = "Cast hair and lashes";
  return { mesh, weights: { boneIndices, weights } };
}

function leavesHairQuarterFree(uv: Float32Array, indices: Uint16Array): boolean {
  for (let cursor = 0; cursor < indices.length; cursor += 3) {
    const a = 2 * at(indices, cursor),
      b = 2 * at(indices, cursor + 1),
      c = 2 * at(indices, cursor + 2);
    const right = Math.max(at(uv, a), at(uv, b), at(uv, c));
    const bottom = Math.min(at(uv, a + 1), at(uv, b + 1), at(uv, c + 1));
    if (right > 0.5 && bottom < 0.5) return false;
  }
  return true;
}

function castSkirtJoints(
  s: SmoothSurface,
  moved: Float32Array,
  inSkirt: Uint8Array,
  origin: readonly [number, number, number],
): ClothJoints {
  const joint = (name: string): [number, number, number] => {
    const named: ReadonlyArray<string> = boneNames,
      i = named.indexOf(name) * 3;
    return [
      at(s.joints, i) - origin[0],
      at(s.joints, i + 1) - origin[1],
      at(s.joints, i + 2) - origin[2],
    ];
  };
  const pelvis = joint("pelvis"),
    k = s.height / 1.75,
    hip = joint("thigh_l")[1],
    high = hip + 0.02 * k,
    low = hip - 0.17 * k,
    columns = 8;
  const points: Array<readonly [number, number, number]> = [];
  let bottom = Infinity;
  for (let i = 0; i < inSkirt.length; i++)
    if (inSkirt[i]) {
      const p = [
        at(moved, i * 3) - origin[0],
        at(moved, i * 3 + 1) - origin[1],
        at(moved, i * 3 + 2) - origin[2],
      ] as const;
      points.push(p);
      bottom = Math.min(bottom, p[1]);
    }
  const cx = pelvis[0],
    cz = pelvis[2];
  const radius = (y: number, a: number) => {
    const best: Array<readonly [number, number]> = [];
    for (const p of points) {
      let turn = Math.atan2(p[0] - cx, p[2] - cz) - a;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      if (Math.abs(turn) < Math.PI / columns)
        best.push([Math.abs(p[1] - y), Math.hypot(p[0] - cx, p[2] - cz)]);
    }
    best.sort((p, q) => p[0] - q[0]);
    const near = best.slice(0, 4);
    return near.length ? near.reduce((sum, p) => sum + p[1], 0) / near.length : 0.15 * k;
  };
  const joints: Array<ClothJoints["joints"][number]> = [];
  [low + (bottom - low) * 0.42, bottom].forEach((y, level) => {
    for (let c = 0; c < columns; c++) {
      const a = ((c + 0.5) / columns) * Math.PI * 2,
        r = radius(y, a),
        from = radius(low, a),
        dir = [Math.sin(a), Math.cos(a)] as const;
      joints.push({
        name: "Source_" + (level + 1) + "_" + (c + 1),
        level,
        column: c,
        at: [cx + dir[0] * r, y, cz + dir[1] * r],
        from: [cx + dir[0] * from, low, cz + dir[1] * from],
        dir,
        free: r,
      });
    }
  });
  const legs: Array<ClothJoints["legs"][number]> = [];
  for (const side of ["l", "r"])
    for (const [from, to, radii] of [
      ["thigh", "calf", [0.085, 0.082, 0.076, 0.07, 0.064, 0.06]],
      ["calf", "foot", [0.058, 0.057, 0.053, 0.047, 0.042, 0.038]],
      ["foot", "ball", [0.045, 0.045]],
    ] as const)
      legs.push({ from: from + "_" + side, to: to + "_" + side, radii: radii.map((r) => r * k) });
  return {
    name: "Source",
    columns,
    joints,
    legs,
    axis: [cx, cz],
    pelvis,
    floor: -origin[1],
    scale: k,
    low,
    high,
  };
}

export function castMeshes(
  cast: HumanCast,
  name: CastFigureName,
  surface: SmoothSurface,
  origin: readonly [number, number, number],
  material: (colour: string) => T.Material,
  colour: string,
  style: CastStyle,
  eyeColour: string | undefined,
  finish: CastFinish | null,
): ReadonlyArray<CastMesh> {
  const { figure, fitted } = castOutfit(cast, name, style),
    art = figure.surface;
  const { source, index, smooth } = art,
    { moved, rest } = shapeFigure(figure, surface);
  const shape = figure.blend && style.castShape ? style.castShape : 0;
  if (shape && figure.blend) {
    const delta = figure.blend.shape;
    for (let i = 0; i < moved.length; i++) moved[i] = at(moved, i) + shape * at(delta, i);
  }
  const normals = smoothNormals(moved, smooth),
    position = spread(moved, source, 3, floats);
  for (let i = 0; i < position.length; i++) position[i] = at(position, i) - at(origin, i % 3);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new T.BufferAttribute(spread(normals, source, 3, floats), 3));
  geometry.setAttribute("uv", new T.BufferAttribute(art.uv.slice(), 2));
  const mat = material(colour).clone();
  mat.side = T.DoubleSide;
  if (finish && mat instanceof T.MeshStandardMaterial) {
    mat.color.set(0xffffff);
    const uv = geometry.getAttribute("uv").array;
    mat.userData["castBodySheet"] =
      Boolean(figure.cards) && uv instanceof Float32Array && leavesHairQuarterFree(uv, index);
    const blink = figure.poses.get("Blink") ?? new Float32Array();
    const own = castOutfitPicture(finish.paint, name, fitted);
    const lids = castLidTexels({
      uv: art.uv,
      index,
      faceTriangles: figure.faceTriangles,
      source,
      blink,
      side: own.side,
    });
    const slug = castSlug(name);
    const pixelDelta = figure.blend
      ? finish.paint.castPicture(`castFigure.${slug}.pixelDelta`)
      : null;
    mat.map = paintedSkin(
      finish.raster,
      own,
      colour,
      pixelDelta ? { pixelDelta } : null,
      style.castPigment,
      eyeColour,
      lids,
    );
    mat.userData["ownedColorMap"] = true;
    mat.metalness = 0;
    applyCastSurface(finish.raster, finish.paint, mat, name, style);
    mat.userData["ownedSurfaceMaps"] = true;
  }
  const faceEnd = figure.faceTriangles * 3;
  const jointLookup = castBones.map((bone) => boneNames.indexOf(bone));
  const weights: CastWeights = {
    boneIndices: Uint16Array.from(
      spread(figure.joints, source, 4, (n) => new Uint8Array(n)),
      (j) => at(jointLookup, j),
    ),
    weights: spread(figure.weights, source, 4, floats),
  };
  const part = (label: string, indices: ArrayLike<number>): T.Mesh => {
    const g = new T.BufferGeometry();
    for (const [key, attr] of Object.entries(geometry.attributes)) g.setAttribute(key, attr);
    g.setIndex(new T.BufferAttribute(Uint16Array.from(indices), 1));
    const mesh = new T.Mesh(g, mat);
    mesh.name = label;
    mesh.castShadow = true;
    return mesh;
  };
  const face = part("Cast face", index.subarray(0, faceEnd));
  face.userData["faceSurface"] = face.userData["fittedEyes"] = true;
  face.geometry.morphTargetsRelative = true;
  const names = [...figure.poses.keys()];
  const shifts = names.map((pose) => {
    const authored = figure.poses.get(pose) ?? new Float32Array();
    const correction = figure.blend?.poses.get(pose);
    if (!shape || !correction) return authored;
    return Float32Array.from(authored, (value, i) => value + shape * at(correction, i));
  });
  face.geometry.morphAttributes["position"] = shifts.map((shift, i) =>
    morph(spread(shift, source, 3, floats), names[i] ?? ""),
  );
  face.geometry.morphAttributes["normal"] = shifts.map((shift, i) => {
    const posed = smoothNormals(
      Float32Array.from(moved, (x, j) => x + at(shift, j)),
      smooth,
    );
    for (let j = 0; j < posed.length; j++) posed[j] = at(posed, j) - at(normals, j);
    return morph(spread(posed, source, 3, floats), names[i] ?? "");
  });
  face.updateMorphTargets();
  const meshes: CastMesh[] = [{ mesh: face, weights }];
  if (figure.skirt) {
    const mask = new Uint8Array(rest.length / 3);
    for (const i of figure.skirt) mask[i] = 1;
    const cloth: number[] = [],
      body: number[] = [];
    for (let i = faceEnd; i < index.length; i += 3) {
      const a = at(index, i),
        b = at(index, i + 1),
        c = at(index, i + 2);
      (mask[at(source, a)] || mask[at(source, b)] || mask[at(source, c)] ? cloth : body).push(
        a,
        b,
        c,
      );
    }
    meshes.push(
      { mesh: part("Cast body and clothing", body), weights },
      {
        mesh: part("Cast tunic hem", cloth),
        weights,
        clothJoints: castSkirtJoints(surface, moved, mask, origin),
      },
    );
  } else meshes.push({ mesh: part("Cast body and clothing", index.subarray(faceEnd)), weights });
  const cards = hairCards(
    figure,
    finish && figure.cards ? finish.paint.castPicture(`castFigure.${castSlug(name)}.cards`) : null,
    moved,
    rest,
    origin,
    material,
    finish?.raster ?? null,
  );
  if (cards) meshes.push(cards);
  return meshes;
}
