import { humanRegions } from "../character-view/human-mesh.js";
import { humanForm } from "../character-view/human-form.js";
import * as T from "three";
import { evaluateHuman } from "../character-view/human-surface.js";
import { adultStyles, dressedHuman } from "../character-view/human-wardrobe.js";
import { loadHumanLibraryMaps } from "../character-view/human-library.js";
import { surfaceFrame } from "../character-view/human-fringe.js";
const surface = evaluateHuman({ height: 1.72 }),
  frame = surfaceFrame(surface);
const native = new Set([
  "None",
  "Buzz cut",
  "Crop",
  "Side part",
  "Swept back",
  "Ponytail",
  "Bun",
  "Braid",
  "Tapered crop",
  "Horseshoe crop",
  "Close crop",
  "Sleek bob",
  "Curled-under bob",
  "Angled bob",
  "Fringed bob",
  "Layered short",
  "Receding short",
  "Long centre part",
]);
export const cuts = [
  ...adultStyles.hair.filter((n) => !native.has(n)).map((n) => ["hair", n]),
  ...adultStyles.hat.slice(1).map((n) => ["hat", n]),
  ...adultStyles.facialHair
    .filter((n) => n !== "None" && n !== "Stubble")
    .map((n) => ["facialHair", n]),
];
export const ready = loadHumanLibraryMaps;
function bytes(a) {
  const array = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let out = "";
  for (let i = 0; i < array.length; i += 24576)
    out += btoa(String.fromCharCode(...array.subarray(i, i + 24576)));
  return out;
}
function colourMap(map) {
  if (!map?.image) return null;
  const image = map.image;
  const canvas = document.createElement("canvas");
  const size = Math.min(1, 768 / Math.max(image.width, image.height));
  canvas.width = Math.max(1, Math.round(size * image.width));
  canvas.height = Math.max(1, Math.round(size * image.height));
  const ctx = canvas.getContext("2d");
  if (image.data) {
    const src = document.createElement("canvas");
    src.width = image.width;
    src.height = image.height;
    src
      .getContext("2d")
      .putImageData(new ImageData(Uint8ClampedArray.from(image.data), src.width, src.height), 0, 0);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  } else ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    flip: map.flipY,
    wrapS: map.wrapS,
    wrapT: map.wrapT,
    repeat: map.repeat.toArray(),
    data: bytes(ctx.getImageData(0, 0, canvas.width, canvas.height).data),
  };
}
export function fit(field, cut, fringe = "As cut") {
  const form = {
    outfit: "Anatomy",
    humanStyle: {
      hair: "None",
      [field]: cut,
      hairColor: "#a0a0a0",
      hatColor: "#959595",
      fringe,
    },
    appearance: { skin: "#b89679" },
  };
  const material = (colour) => {
    const m = new T.MeshStandardMaterial({ color: colour });
    m.userData.dye = colour;
    return m;
  };
  const face = field === "facialHair";
  const recipe = face ? humanForm({ height: 1.72 }, 404) : null;
  const meshes = face
    ? humanRegions(
        {
          ...recipe,
          humanStyle: form.humanStyle,
          appearance: { ...recipe.appearance, ...form.appearance },
        },
        material,
        false,
      )(recipe.parts.find((p) => p.humanBone === "head")).children.filter(
        (m) => m.name === "facial-hair",
      )
    : dressedHuman(surface, form, material, false).filter((m) => m.userData.styleRegion === "head");
  const head = surface.names.indexOf("head"),
    origin = face ? surface.joints.slice(3 * head, 3 * head + 3) : [0, 0, 0];
  return meshes.map((m) => {
    const g = m.geometry,
      p = g.getAttribute("position"),
      n = g.getAttribute("normal"),
      uv = g.getAttribute("uv"),
      colours = g.getAttribute("color");
    const positions = new Int16Array(p.count * 3),
      normals = new Int16Array(p.count * 3),
      tex = new Int16Array(p.count * 2),
      rgb = new Uint8Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      for (const [j, get] of ["getX", "getY", "getZ"].entries()) {
        positions[i * 3 + j] = Math.round(
          ((p[get](i) + origin[j] - frame.centre[j]) / frame.radii[j]) * 4096,
        );
        normals[i * 3 + j] = Math.round(32767 * (n?.[get](i) ?? 0));
        rgb[i * 3 + j] = Math.round(255 * Math.max(0, Math.min(1, colours?.[get](i) ?? 1)));
      }
      if (uv) {
        tex[i * 2] = Math.round(4096 * uv.getX(i));
        tex[i * 2 + 1] = Math.round(4096 * uv.getY(i));
      }
    }
    const mat = m.material;
    return {
      name: face ? cut : m.name,
      morphs: (g.morphAttributes.position ?? []).map((attr) => ({
        name: attr.name,
        data: bytes(
          Int16Array.from(attr.array, (v, i) => Math.round((v * 32767) / frame.radii[i % 3])),
        ),
      })),
      tone: "#" + mat.color.getHexString(),
      source: mat.userData.dye ?? "",
      double: mat.side === T.DoubleSide,
      alpha: mat.alphaTest,
      rough: mat.roughness,
      metal: mat.metalness,
      transparent: mat.transparent,
      points: bytes(positions),
      normals: bytes(normals),
      uv: uv ? bytes(tex) : null,
      colors: colours ? bytes(rgb) : null,
      indices: bytes(
        Uint32Array.from(g.index?.array ?? Array.from({ length: p.count }, (_, i) => i)),
      ),
      map: colourMap(mat.map),
      normalMap: colourMap(mat.normalMap),
      bumpMap: colourMap(mat.bumpMap),
      bumpScale: mat.bumpScale,
      normalScale: mat.normalScale.toArray(),
      roughMap: colourMap(mat.roughnessMap),
      metalMap: colourMap(mat.metalnessMap),
      occlusion: colourMap(mat.aoMap),
      bones: m.humanWeights ? bytes(Uint8Array.from(m.humanWeights.boneIndices)) : null,
      weights: m.humanWeights
        ? bytes(Uint8Array.from(m.humanWeights.weights, (w) => Math.round(255 * w)))
        : null,
    };
  });
}
