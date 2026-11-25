import * as T from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import data from "./human-watch-cap-data.json" with { type: "json" };
const decode = (src, Type) => {
  const b = unzlibSync(Uint8Array.from(atob(src), (c) => c.charCodeAt(0)));
  return new Type(
    b.buffer,
    b.byteOffset,
    b.byteLength / Type.BYTES_PER_ELEMENT,
  );
};
const raw = decode(data.points, Int16Array),
  index = decode(data.index, Uint16Array);
let maps;
function knitMap(bytes, colour) {
  const side = 512,
    rgb = decode(bytes, Uint8Array),
    rgba = new Uint8Array(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    for (let k = 0; k < 3; k++) rgba[4 * i + k] = rgb[3 * i + k];
    rgba[4 * i + 3] = 255;
  }
  let texture;
  if (typeof document === "undefined") {
    texture = new T.DataTexture(rgba, side, side);
    texture.flipY = true;
    texture.needsUpdate = true;
  } else {
    const c = document.createElement("canvas");
    c.width = c.height = side;
    c.getContext("2d").putImageData(
      new ImageData(new Uint8ClampedArray(rgba), side, side),
      0,
      0,
    );
    texture = new T.CanvasTexture(c);
  }
  texture.colorSpace = colour ? T.SRGBColorSpace : T.NoColorSpace;
  texture.anisotropy = 4;
  return texture;
}
export function knitCap(frame, style, material, plain, headIndex, gap) {
  const pos = [],
    uv = [];
  for (let j = 0; j < raw.length; j += 5) {
    const p = frame.centre.map(
      (a, k) => a + (frame.radii[k] * raw[j + k]) / 12000,
    );
    const d = frame.over(p);
    const minimum = d.eps > 0.64 ? gap + 0.001 * frame.k : 0.003 * frame.k;
    if (d.h < minimum) {
      const raise = minimum - d.h;
      for (let k = 0; k < 3; k++) p[k] += raise * d.u[k];
    }
    pos.push(...p);
    uv.push(raw[j + 3] / 12000, raw[j + 4] / 12000);
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(new T.BufferAttribute(index, 1));
  g.computeVertexNormals();
  const m = material(style.hatColor ?? "#674e39", "cloth").clone();
  m.side = T.DoubleSide;
  if (!plain) {
    maps ??= [knitMap(data.tone, true), knitMap(data.normal, false)];
    m.map = maps[0];
    m.normalMap = maps[1];
    m.normalScale = new T.Vector2(0.68, 0.68);
    m.roughness = 0.89;
    m.metalness = 0;
  }
  m.userData = { ...m.userData, fibreLOD: true };
  const mesh = new T.Mesh(g, m);
  const count = pos.length / 3,
    bones = new Uint8Array(count * 4),
    weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    bones[4 * i] = headIndex;
    weights[4 * i] = 1;
  }
  mesh.humanWeights = { boneIndices: bones, weights };
  mesh.name = "Ribbed watch cap";
  mesh.userData.hat = style.hat;
  mesh.userData.styleRegion = "head";
  return mesh;
}
