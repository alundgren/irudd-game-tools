import * as T from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import cuts from "./human-production-hair-data.json" with { type: "json" };
import { combFringe, surfaceBody, surfaceFrame } from "./human-fringe.js";
import { hatHead } from "./human-hats.js";

export const productionStyles = Object.keys(cuts);
const decoded = new Map();

function unpack(encoded, Type) {
  const bytes = unzlibSync(
    Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
  );
  return new Type(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / Type.BYTES_PER_ELEMENT,
  );
}

function cutFor(name) {
  if (!decoded.has(name)) {
    const source = cuts[name];
    decoded.set(name, {
      points: unpack(source.points, Int16Array),
      indices: unpack(source.index, Uint16Array),
      texture: unpack(source.texture, Uint8Array),
    });
  }
  return decoded.get(name);
}

// Scalp and free strands occupy separate halves of the chart. At the scalp's edge
// the dyed source strands grade into the wearer's skin. A pale dye needs less of
// the dark donor photograph's highlight range than a dark dye.
function hairMap(source, hair, skin, plain) {
  const root = new T.Color(skin),
    dye = new T.Color(hair),
    shade = new T.Color();
  const lightness = 0.2126 * dye.r + 0.7152 * dye.g + 0.0722 * dye.b;
  const fair = T.MathUtils.smoothstep(lightness, 0.1, 0.4);
  const colors = new Uint8ClampedArray(256 * 256 * 3);
  if (!plain) {
    for (let level = 0; level < 256; level++) {
      const v = level / 255;
      const linear = shade.setRGB(v, v, v, T.SRGBColorSpace).r;
      const gain = T.MathUtils.lerp(1.37 * linear, 0.4 + 0.43 * linear, fair);
      for (let density = 0; density < 256; density++) {
        shade
          .copy(dye)
          .multiplyScalar(gain)
          .lerp(root, 1 - density / 255)
          .convertLinearToSRGB();
        const at = 3 * (level * 256 + density);
        colors[at] = 255 * shade.r;
        colors[at + 1] = 255 * shade.g;
        colors[at + 2] = 255 * shade.b;
      }
    }
  }
  const rgba = new Uint8Array(512 * 1024 * 4);
  for (let i = 0, j = 0; i < source.length; i += 3, j += 4) {
    const at = 3 * (256 * source[i] + source[i + 2]);
    rgba[j] = plain ? 255 : colors[at];
    rgba[j + 1] = plain ? 255 : colors[at + 1];
    rgba[j + 2] = plain ? 255 : colors[at + 2];
    rgba[j + 3] = source[i + 1];
  }
  const canvas =
    typeof document !== "undefined" && document.createElement("canvas");
  let map;
  if (
    canvas &&
    typeof ImageData !== "undefined" &&
    canvas.getContext("2d")?.putImageData
  ) {
    canvas.width = 512;
    canvas.height = 1024;
    canvas
      .getContext("2d")
      .putImageData(
        new ImageData(new Uint8ClampedArray(rgba.buffer), 512, 1024),
        0,
        0,
      );
    map = new T.CanvasTexture(canvas);
  } else map = new T.DataTexture(rgba, 512, 1024);
  map.colorSpace = T.SRGBColorSpace;
  map.flipY = true;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

export function productionHair(surface, style, material, plain, skin) {
  if (!Object.hasOwn(cuts, style.hair)) return [];
  const source = cutFor(style.hair),
    frame = surfaceFrame(surface),
    skull = hatHead(frame);
  const q = source.points,
    count = q.length / 5,
    position = new Float32Array(count * 3),
    normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2),
    bones = new Uint8Array(count * 4),
    weights = new Float32Array(count * 4);
  const head = surfaceBody(surface).rigid("head")[0][0];
  for (let i = 0; i < count; i++) {
    const p = frame.centre.map(
      (x, k) => x + (frame.radii[k] * q[5 * i + k]) / 4000,
    );
    const at = skull.over(p);
    const above = at.eps > -0.65 || Math.abs(at.phi) < 1.2;
    const push = above
      ? T.MathUtils.clamp(0.0025 * frame.k - at.h, 0, 0.028 * frame.k)
      : 0;
    for (let k = 0; k < 3; k++) p[k] += at.u[k] * push;
    position.set(p, 3 * i);
    const direction = new T.Vector3(...at.u);
    if (at.eps < -0.7) direction.y *= 0.65;
    direction.normalize().toArray(normal, 3 * i);
    uv[2 * i] = q[5 * i + 3] / 4000;
    uv[2 * i + 1] = 1 - q[5 * i + 4] / 4000;
    bones[4 * i] = head;
    weights[4 * i] = 1;
  }
  // The front already carries a cut fringe. Retain its original fall away
  // from the eyes, and apply the full comb only to points at the eye opening.
  const original = position.slice();
  combFringe(position, frame, style.fringe);
  for (let i = 0; i < count; i++) {
    const offset = 3 * i;
    const point = original.subarray(offset, offset + 3);
    const nearEye = 1 - T.MathUtils.smoothstep(point[1] - frame.eye[1], .003 * frame.k, .022 * frame.k);
    const share = .23 + .77 * nearEye;
    for (let k = 0; k < 3; k++) position[offset + k] = T.MathUtils.lerp(point[k], position[offset + k], share);
  }
  // Orient both sides of the original ribbons consistently with the fitted
  // hair volume. A reversed outer card otherwise catches the opposite light.
  const indices = source.indices.slice(),
    a = new T.Vector3(),
    b = new T.Vector3(),
    edge = new T.Vector3();
  for (let t = 0; t < indices.length; t += 3) {
    const i = indices[t],
      j = indices[t + 1],
      k = indices[t + 2];
    a.fromArray(position, 3 * i);
    b.fromArray(position, 3 * j).sub(a);
    edge.fromArray(position, 3 * k).sub(a);
    if (b.cross(edge).dot(a.fromArray(normal, 3 * i)) < 0) {
      indices[t + 1] = k;
      indices[t + 2] = j;
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new T.BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
  geometry.setIndex(new T.BufferAttribute(indices, 1));
  const m = material("#ffffff", "hair").clone();
  if (!plain) m.color.setHex(0xffffff);
  m.map = hairMap(
    source.texture,
    style.hairColor ?? "#493427",
    skin ?? "#c29a7e",
    plain,
  );
  m.alphaTest = 0.34;
  m.roughness = 0.84;
  m.metalness = 0;
  m.side = T.DoubleSide;
  m.userData = { ...m.userData, fibreLOD: true, portrait: true };
  const mesh = new T.Mesh(geometry, m);
  mesh.name = style.hair;
  mesh.userData.styleRegion = "head";
  mesh.userData.ownedPortraitTexture = true;
  mesh.humanWeights = { boneIndices: bones, weights };
  return [mesh];
}
