import * as T from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import { smoothHumanSurface } from "./human-surface.js";
import data from "./human-buzz-data.json" with { type: "json" };

function unpack(encoded, Type) {
  const bytes = unzlibSync(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
  return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
}

let scalp;
function scalpData() {
  return scalp ??= {
    vertices: unpack(data.vertices, Uint32Array),
    uv: unpack(data.uv, Uint16Array),
    indices: unpack(data.indices, Uint16Array),
    density: unpack(data.density, Uint8Array),
    pixels: unpack(data.pixels, Uint8Array),
  };
}

const paintings = new Map();
function buzzMap(skin, hair) {
  if (typeof document === "undefined") return null;
  const key = skin + "/" + hair;
  if (!paintings.has(key)) {
    const [width, height] = data.size;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx?.createImageData || !ctx.putImageData) return null;
    const image = ctx.createImageData(width, height);
    const pixels = scalpData().pixels;
    const skinColor = new T.Color(skin), hairColor = new T.Color(hair), color = new T.Color();
    for (let i = 0; i < width * height; i++) {
      const density = pixels[2 * i] / 255;
      const grain = (pixels[2 * i + 1] / 255 - .5) * 1.8;
      color.copy(hairColor).multiplyScalar(Math.max(.4, .85 + grain))
        .lerp(skinColor, 1 - .95 * density).convertLinearToSRGB();
      image.data[4 * i] = 255 * color.r;
      image.data[4 * i + 1] = 255 * color.g;
      image.data[4 * i + 2] = 255 * color.b;
      image.data[4 * i + 3] = density > .014 ? 255 : 0;
    }
    ctx.putImageData(image, 0, 0);
    if (paintings.size >= 6) paintings.delete(paintings.keys().next().value);
    paintings.set(key, canvas);
  }
  const texture = new T.CanvasTexture(paintings.get(key));
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function buzzCut(cage, style, material, skin) {
  const texture = buzzMap(skin, style.hairColor ?? "#342923");
  if (!texture) return null;
  const surface = smoothHumanSurface(cage), cut = scalpData();
  const base = new T.BufferGeometry();
  base.setAttribute("position", new T.BufferAttribute(surface.positions, 3));
  base.setIndex(new T.BufferAttribute(surface.indices, 1));
  base.computeVertexNormals();
  const skullNormals = base.attributes.normal.array;
  const count = cut.vertices.length;
  const positions = new Float32Array(3 * count), normals = new Float32Array(3 * count);
  const uv = new Float32Array(2 * count), boneIndices = new Uint8Array(4 * count);
  const weights = new Float32Array(4 * count);
  for (let i = 0; i < count; i++) {
    const v = cut.vertices[i];
    const height = (.00045 + .00135 * cut.density[i] / 255) * surface.height / 1.72;
    for (let axis = 0; axis < 3; axis++) {
      const n = skullNormals[3 * v + axis];
      normals[3 * i + axis] = n;
      positions[3 * i + axis] = surface.positions[3 * v + axis] + height * n;
    }
    uv[2 * i] = cut.uv[2 * i] / 65535;
    uv[2 * i + 1] = 1 - cut.uv[2 * i + 1] / 65535;
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
  dyed.map = texture;
  dyed.color.setHex(0xffffff);
  dyed.alphaTest = .4;
  dyed.roughness = .77;
  dyed.metalness = 0;
  dyed.userData.hairCards = true;
  const mesh = new T.Mesh(geometry, dyed);
  mesh.name = "Buzz cut";
  mesh.castShadow = true;
  mesh.userData.styleRegion = "head";
  mesh.userData.ownedPortraitTexture = true;
  mesh.humanWeights = { boneIndices, weights };
  return mesh;
}
