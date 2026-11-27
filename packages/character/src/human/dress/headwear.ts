import * as T from "three";
import type { HumanBody } from "../body.js";
import { headwear } from "../headwear-library.js";
import type { HeadwearTexture } from "../headwear-types.js";
import type { HumanSurface } from "../surface.js";
import { surfaceFrame } from "./fringe.js";

const maps = new WeakMap<HumanBody, Map<string, T.DataTexture>>();
function texture(body: HumanBody, image: HeadwearTexture, colour: boolean) {
  let cache = maps.get(body);
  if (!cache) maps.set(body, (cache = new Map<string, T.DataTexture>()));
  const key = [
    image.data,
    colour,
    image.flip,
    image.wrapS,
    image.wrapT,
    ...(image.repeat ?? []),
  ].join("/");
  let value = cache.get(key);
  if (!value) {
    value = new T.DataTexture(body.headwear.u8(image.data), image.width, image.height);
    value.colorSpace = colour ? T.SRGBColorSpace : T.NoColorSpace;
    value.flipY = image.flip;
    const wrap = (v: number | undefined) =>
      v === T.RepeatWrapping
        ? T.RepeatWrapping
        : v === T.MirroredRepeatWrapping
          ? T.MirroredRepeatWrapping
          : T.ClampToEdgeWrapping;
    value.wrapS = wrap(image.wrapS);
    value.wrapT = wrap(image.wrapT);
    if (image.repeat) value.repeat.set(...image.repeat);

    value.magFilter = T.LinearFilter;
    value.minFilter = T.LinearMipmapLinearFilter;
    value.generateMipmaps = true;
    value.anisotropy = 8;
    value.needsUpdate = true;
    cache.set(key, value);
  }
  return value;
}

export function fittedHeadwear(
  body: HumanBody,
  surface: HumanSurface,
  cut: string | undefined,
  dye: string,
  field: "hair" | "hat" | "facialHair",
  material: (tone: string, type: string) => T.Material,
  plain: boolean,
  fringe?: string,
) {
  const parts =
    (cut && fringe && field === "hair" ? headwear[cut + "/" + fringe] : undefined) ??
    (cut ? headwear[cut] : undefined);
  if (!parts) return [];
  const frame = surfaceFrame(surface);
  const base = new T.Color(field === "hat" ? "#959595" : "#a0a0a0"),
    tint = new T.Color(dye);
  const dyeScale = new T.Color(tint.r / base.r, tint.g / base.g, tint.b / base.b);
  return parts.map((part) => {
    const packed = body.headwear.i16(part.points),
      position = new Float32Array(packed.length);
    const normal = Float32Array.from(body.headwear.i16(part.normals), (n) => n / 32767);
    for (let i = 0; i < packed.length; i += 3)
      for (const j of [0, 1, 2] as const)
        position[i + j] = frame.centre[j] + (frame.radii[j] * (packed[i + j] ?? 0)) / 4096;
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(position, 3));
    g.setAttribute("normal", new T.BufferAttribute(normal, 3));
    if (part.morphs?.length) {
      g.morphTargetsRelative = true;
      g.morphAttributes["position"] = part.morphs.map((target) => {
        const delta = Float32Array.from(
          body.headwear.i16(target.data),
          (v, i) => (v * (frame.radii[i % 3] ?? 0)) / 32767,
        );
        const attr = new T.BufferAttribute(delta, 3);
        attr.name = target.name;
        return attr;
      });
    }
    g.setIndex(new T.BufferAttribute(body.headwear.u32(part.indices), 1));
    if (part.uv)
      g.setAttribute(
        "uv",
        new T.Float32BufferAttribute(
          Float32Array.from(body.headwear.i16(part.uv), (n) => n / 4096),
          2,
        ),
      );
    if (part.colors && !plain)
      g.setAttribute("color", new T.Uint8BufferAttribute(body.headwear.u8(part.colors), 3, true));
    const colour = new T.Color(part.tone);
    if (cut === "Flying cap and goggles") {
      const leather =
        part.name === cut || /^Flying cap LeatherParts_low (?!5$|10$)/.test(part.name);
      if (leather) {
        const natural = new T.Color("#6c4d39");
        for (const k of ["r", "g", "b"] as const)
          colour[k] = T.MathUtils.clamp((tint[k] + 0.06) / (natural[k] + 0.06), 0.24, 2.4);
      }
    } else if (field !== "hat" || part.source === "#959595" || part.metal < 0.2)
      colour.multiply(dyeScale);
    const m = material("#" + colour.getHexString(), field === "hair" ? "hair" : "canvas").clone();
    if (m instanceof T.MeshStandardMaterial && !plain) {
      m.color.copy(colour);
      m.vertexColors = Boolean(part.colors);
      m.map = part.map ? texture(body, part.map, true) : null;
      m.normalMap = part.normalMap ? texture(body, part.normalMap, false) : null;
      m.roughnessMap = part.roughMap ? texture(body, part.roughMap, false) : null;
      m.metalnessMap = part.metalMap ? texture(body, part.metalMap, false) : null;
      m.aoMap = part.occlusion ? texture(body, part.occlusion, false) : null;
      m.bumpMap = part.bumpMap ? texture(body, part.bumpMap, false) : null;
      if (part.bumpScale !== undefined) m.bumpScale = part.bumpScale;
      if (part.normalScale) m.normalScale.set(...part.normalScale);
      m.roughness = part.rough;
      m.metalness = part.metal;
      m.alphaTest = part.alpha;
      m.transparent = part.transparent;
      m.alphaToCoverage = part.alpha > 0;
    }
    m.side = part.double ? T.DoubleSide : T.FrontSide;
    const mesh = new T.Mesh(g, m);
    mesh.name = part.name;
    mesh.userData["styleRegion"] = "head";
    mesh.castShadow = true;
    const skin =
      part.bones && part.weights
        ? {
            boneIndices: body.headwear.u8(part.bones),
            weights: Float32Array.from(body.headwear.u8(part.weights), (n) => n / 255),
          }
        : null;
    return { mesh, region: "head", ...(skin ? { skin } : {}) };
  });
}
