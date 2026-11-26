import * as T from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import kit from "./human-aviator-data.json" with { type: "json" };

const unpack = (value, Type) => {
  const bytes = unzlibSync(
    Uint8Array.from(atob(value), (x) => x.charCodeAt(0)),
  );
  return new Type(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / Type.BYTES_PER_ELEMENT,
  );
};
const meshes = kit.parts.map((p) => ({
  ...p,
  points: unpack(p.vertices, Int16Array),
  faces: unpack(p.indices, Uint16Array),
}));
const maps = new Map();
function texture(raw, size, srgb) {
  const pixels = unpack(raw, Uint8Array),
    rgba = new Uint8Array(4 * size * size);
  for (let k = 0; k < 3; k++)
    for (let row = 0; row < size; row++) {
      const start = (k * size + row) * size;
      for (let x = 1; x < size; x++) pixels[start + x] += pixels[start + x - 1];
    }
  for (let i = 0; i < size * size; i++) {
    rgba[4 * i] = pixels[i];
    rgba[4 * i + 1] = pixels[size * size + i];
    rgba[4 * i + 2] = pixels[2 * size * size + i];
    rgba[4 * i + 3] = 255;
  }
  let result;
  if (typeof document === "undefined")
    result = new T.DataTexture(rgba, size, size);
  else {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    canvas
      .getContext("2d")
      .putImageData(
        new ImageData(new Uint8ClampedArray(rgba), size, size),
        0,
        0,
      );
    result = new T.CanvasTexture(canvas);
  }
  result.flipY = true;
  result.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
  result.anisotropy = 8;
  result.needsUpdate = true;
  return result;
}
function measuredMaps(index) {
  const s = kit.surfaces[index];
  if (!maps.has(index))
    maps.set(index, [
      texture(s.color, s.size, true),
      texture(s.normal, s.size, false),
      texture(s.orm, s.size, false),
    ]);
  return maps.get(index);
}
export function flightCap(frame, style, material, plain, head) {
  const materials = new Map();
  return meshes.map((part) => {
    const surf = kit.surfaces[part.mi];
    const leather = part.part === "LeatherParts_low";
    const padded =
      part.part === "LeatherParts_low" && (part.rank === 5 || part.rank === 10);
    const group = padded ? "goggle padding" : part.mi;
    if (!materials.has(group)) {
      const m = material("#ffffff", "leather").clone();
      if (!plain) {
        const [color, normal, orm] = measuredMaps(part.mi);
        m.color.setHex(0xffffff);
        m.map = color;
        m.normalMap = normal;
        m.normalScale = new T.Vector2(0.8, 0.8);
        m.roughnessMap = orm;
        m.metalnessMap = orm;
        m.aoMap = orm;
        m.metalness = 1;
        m.roughness = 1;
        if (part.part === "Lenses_low") {
          m.color.set("#577176");
          m.roughnessMap = null;
          m.metalnessMap = null;
          m.roughness = 0.16;
          m.metalness = 0.62;
        }
      }
      if (!plain && padded) m.color.set("#726457");
      if (!plain && leather && !padded && style.hatColor) {
        const dye = new T.Color(style.hatColor);
        const natural = new T.Color("#6c4d39");
        const factor = (k) =>
          T.MathUtils.clamp((dye[k] + 0.06) / (natural[k] + 0.06), 0.24, 2.4);
        m.color.setRGB(factor("r"), factor("g"), factor("b"));
      }
      m.name = surf.name;
      m.side = T.DoubleSide;
      m.userData = { ...m.userData, fibreLOD: true };
      materials.set(group, m);
    }
    const pos = [],
      norm = [],
      uv = [],
      count = part.points.length / 8,
      bones = new Uint8Array(4 * count),
      weights = new Float32Array(4 * count);
    for (let i = 0; i < count; i++) {
      const j = i * 8,
        p = frame.centre.map(
          (v, k) => v + (frame.radii[k] * part.points[j + k]) / 10000,
        );
      const at = frame.over(p);
      const crown = T.MathUtils.smoothstep(at.eps, -0.42, 0.18);
      const minGap = (0.003 + 0.0034 * crown) * frame.k;
      const rise = T.MathUtils.clamp(minGap - at.h, 0, 0.030 * frame.k);
      for (let k = 0; k < 3; k++) p[k] += at.u[k] * rise;
      pos.push(...p);
      const normal = new T.Vector3(
        (part.points[j + 3] * 0.105) / frame.radii[0],
        (part.points[j + 4] * 0.109) / frame.radii[1],
        (part.points[j + 5] * 0.121) / frame.radii[2],
      ).normalize();
      norm.push(normal.x, normal.y, normal.z);
      uv.push(part.points[j + 6] / 10000, 1 - part.points[j + 7] / 10000);
      bones[4 * i] = head;
      weights[4 * i] = 1;
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(norm, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.setIndex(new T.BufferAttribute(part.faces, 1));
    const mesh = new T.Mesh(g, materials.get(group));
    mesh.humanWeights = { boneIndices: bones, weights };
    mesh.name =
      leather && part.rank === 0
        ? style.hat
        : "Flying cap " + part.part + " " + part.rank;
    mesh.userData.styleRegion = "head";
    mesh.userData.hat = style.hat;
    return mesh;
  });
}
