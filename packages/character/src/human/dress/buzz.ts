// The clipped buzz cut of the textured presets (buzzCut in
// character-view/human-buzz.js at 2761eb1). The donor was painted on the
// native topology, so the cut keeps its texture coordinate splits and sits on
// the adult's own smoothed skull, a little over the skin where the hair is
// dense, skinned as the skin under each point is. Its picture is the hair
// colour over the skin colour by the painted density and grain.

import * as T from "three";
import { context2d, type Raster } from "../../raster.js";
import type { HumanBody } from "../body.js";
import { buzzSize, type BuzzScalp } from "../paint-data.js";
import { smoothHumanSurface } from "../smooth.js";
import type { HumanSurface } from "../surface.js";
import type { DressMesh } from "./kit.js";

// A painting can be drawn again for the next wearer; each wearer owns a separate texture of it.
const paintings = new WeakMap<Raster, Map<string, HTMLCanvasElement>>();
function buzzMap(raster: Raster, scalp: BuzzScalp, skin: string, hair: string): T.CanvasTexture {
  let drawn = paintings.get(raster);
  if (!drawn) paintings.set(raster, (drawn = new Map<string, HTMLCanvasElement>()));
  const key = skin + "/" + hair;
  let canvas = drawn.get(key);
  if (!canvas) {
    const [width, height] = buzzSize;
    canvas = raster.canvas(width, height);
    const ctx = context2d(canvas);
    const image = ctx.createImageData(width, height);
    const pixels = scalp.pixels;
    const skinColor = new T.Color(skin),
      hairColor = new T.Color(hair),
      color = new T.Color();
    for (let i = 0; i < width * height; i++) {
      const density = (pixels[2 * i] ?? 0) / 255;
      const grain = ((pixels[2 * i + 1] ?? 0) / 255 - 0.5) * 1.8;
      color
        .copy(hairColor)
        .multiplyScalar(Math.max(0.4, 0.85 + grain))
        .lerp(skinColor, 1 - 0.95 * density)
        .convertLinearToSRGB();
      image.data[4 * i] = 255 * color.r;
      image.data[4 * i + 1] = 255 * color.g;
      image.data[4 * i + 2] = 255 * color.b;
      image.data[4 * i + 3] = density > 0.014 ? 255 : 0;
    }
    ctx.putImageData(image, 0, 0);
    const oldest = drawn.keys().next();
    if (drawn.size >= 6 && !oldest.done) drawn.delete(oldest.value);
    drawn.set(key, canvas);
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** The buzz cut on this adult's scalp, in `hairColor` over `skin`. */
export function buzzCut(
  human: HumanBody,
  cage: HumanSurface,
  hairColor: string | undefined,
  material: (tone: string, type: string) => T.Material,
  skin: string,
  raster: Raster,
  cut: BuzzScalp,
): DressMesh {
  const texture = buzzMap(raster, cut, skin, hairColor ?? "#342923");
  const surface = smoothHumanSurface(human, cage);
  const base = new T.BufferGeometry();
  base.setAttribute("position", new T.BufferAttribute(surface.positions, 3));
  base.setIndex(new T.BufferAttribute(surface.indices, 1));
  base.computeVertexNormals();
  const skullNormals = base.getAttribute("normal").array;
  const count = cut.vertices.length;
  const positions = new Float32Array(3 * count),
    normals = new Float32Array(3 * count);
  const uv = new Float32Array(2 * count),
    boneIndices = new Uint8Array(4 * count);
  const weights = new Float32Array(4 * count);
  for (let i = 0; i < count; i++) {
    const v = cut.vertices[i] ?? 0;
    const height = ((0.00045 + (0.00135 * (cut.density[i] ?? 0)) / 255) * surface.height) / 1.72;
    for (let axis = 0; axis < 3; axis++) {
      const n = skullNormals[3 * v + axis] ?? 0;
      normals[3 * i + axis] = n;
      positions[3 * i + axis] = (surface.positions[3 * v + axis] ?? 0) + height * n;
    }
    uv[2 * i] = (cut.uv[2 * i] ?? 0) / 65535;
    uv[2 * i + 1] = 1 - (cut.uv[2 * i + 1] ?? 0) / 65535;
    boneIndices.set(surface.boneIndices.subarray(4 * v, 4 * v + 4), 4 * i);
    weights.set(surface.weights.subarray(4 * v, 4 * v + 4), 4 * i);
  }
  base.dispose();
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new T.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
  geometry.setIndex(new T.BufferAttribute(cut.indices, 1));
  const dyed = material("#ffffff", "hair").clone();
  if (dyed instanceof T.MeshStandardMaterial) {
    dyed.map = texture;
    dyed.color.setHex(0xffffff);
    dyed.roughness = 0.77;
    dyed.metalness = 0;
  }
  dyed.alphaTest = 0.4;
  dyed.userData["hairCards"] = true;
  const mesh = new T.Mesh(geometry, dyed);
  mesh.name = "Buzz cut";
  mesh.castShadow = true;
  mesh.userData["styleRegion"] = "head";
  mesh.userData["ownedPortraitTexture"] = true;
  return { mesh, region: "head", boneIndices, weights };
}
