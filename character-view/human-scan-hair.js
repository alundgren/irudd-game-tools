// Scalp hair cut from 3D scans of real people: the scanned hair surface with its own photograph, worn on the
// editable adult's head. The hairline is the photographed one, cut out by the scan's own matte, and the picture
// keeps the light, shade and colour variation of the real hair under any dye.
//
// Scans: HSRD-100, DigitalRealityLab / HumanScanRepository, CC BY 4.0. docs/licenses/hsrd-100-cc-by-4.0.md
// Packed by scripts/pack-human-scan-hair (see docs/human-scan-hair.md).
import * as T from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import data from "./human-scan-hair-data.json" with { type: "json" };
import { surfaceBody, surfaceFrame } from "./human-fringe.js";
import { hatHead } from "./human-hats.js";

export const scanHairStyles = Object.keys(data.cuts);
export const scanHairCredit = { credit: data.credit, source: data.source, license: data.license, revision: data.revision, changes: data.changes };
/* The scan a style was cut from, for the credit an export owes. */
export const scanHairSource = (style) => data.cuts[style?.hair]?.pose ?? null;

const decoded = new Map();
function unpack(encoded, Type) {
  const bytes = unzlibSync(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
  return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
}
function cutFor(name) {
  if (!decoded.has(name)) {
    const cut = data.cuts[name];
    decoded.set(name, { points: unpack(cut.points, Int16Array), indices: unpack(cut.index, Uint16Array), texture: unpack(cut.texture, Uint8Array), tone: cut.tone, spread: cut.spread, side: cut.side });
  }
  return decoded.get(name);
}

const toLinear = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toSRGB = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const maps = new Map();

/* The photograph in a dye. Every pixel keeps its ratio to the scan's own middle hair colour, channel by channel,
   so strands lighter, darker, warmer or cooler than the middle stay so. A dark dye spreads the ratios a little,
   as dark hair shows its lights more. Towards the photographed hairline the
   hair thins into the wearer's skin, and the matte cuts the outline. */
function hairMap(name, hair, skin, plain) {
  const key = [name, hair, skin, plain].join("/");
  if (maps.has(key)) { const kept = maps.get(key); maps.delete(key); maps.set(key, kept); return kept; }
  const { texture, tone, spread, side } = cutFor(name), dye = new T.Color(hair), root = new T.Color(skin);
  // Very dark hair photographs with strands many times its middle tone; in a lighter dye they would glare, so the
  // range is drawn in until its lighter strands stand at most four fifths above the middle.
  const depth = Math.min(1, Math.log(1.8) / Math.log(Math.max(spread ?? 1.8, 1.01))) * (1 + 0.35 * (1 - T.MathUtils.smoothstep(0.2126 * dye.r + 0.7152 * dye.g + 0.0722 * dye.b, 0.03, 0.25))),
    // A dye names the lightest the hair shows, as it does for every other cut; its middle tone lies under that.
    lightness = 0.2126 * dye.r + 0.7152 * dye.g + 0.0722 * dye.b, body = T.MathUtils.lerp(0.55, 0.72, T.MathUtils.smoothstep(lightness, 0.1, 0.4)), dyes = [dye.r * body, dye.g * body, dye.b * body], roots = [root.r, root.g, root.b], rgba = new Uint8ClampedArray(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    const cover = texture[i * 4 + 3] / 255, thin = 1 - T.MathUtils.smoothstep(cover, 0.42, 0.8);
    for (let k = 0; k < 3; k++) {
      const strand = plain ? 1 : Math.min(1, dyes[k] * Math.min(3.6, (toLinear[texture[i * 4 + k]] / tone[k]) ** (depth * (1 - 0.35 * thin))));
      rgba[i * 4 + k] = toSRGB(plain ? 1 : strand + (roots[k] - strand) * 0.8 * thin);
    }
    rgba[i * 4 + 3] = texture[i * 4 + 3];
  }
  let map;
  const canvas = typeof document !== "undefined" && document.createElement("canvas");
  if (canvas && typeof ImageData !== "undefined" && canvas.getContext("2d")?.putImageData) {
    canvas.width = canvas.height = side;
    canvas.getContext("2d").putImageData(new ImageData(rgba, side, side), 0, 0);
    map = new T.CanvasTexture(canvas);
  } else map = new T.DataTexture(new Uint8Array(rgba.buffer), side, side);
  map.colorSpace = T.SRGBColorSpace;
  map.flipY = true;
  map.anisotropy = 8;
  map.needsUpdate = true;
  if (maps.size >= 6) { const oldest = maps.keys().next().value; maps.get(oldest).dispose(); maps.delete(oldest); }
  maps.set(key, map);
  return map;
}

/* The worn pieces of a scan hairstyle on this head, in the adult's own space. */
export function scanHair(surface, style, material, plain, skin) {
  if (!Object.hasOwn(data.cuts, style.hair)) return [];
  const source = cutFor(style.hair), frame = surfaceFrame(surface), skull = hatHead(frame);
  const q = source.points, count = q.length / 6, position = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const bones = new Uint8Array(count * 4), weights = new Float32Array(count * 4), head = surfaceBody(surface).rigid("head")[0][0];
  for (let i = 0; i < count; i++) {
    // The shell keeps its place in the head's own proportions. Hair near its roots keeps the height it had above
    // the scanned skull, so the hairline lies on this head's skin whatever its width; the free relief further up
    // keeps its shape, lifted clear of the skin where this head is the larger.
    const p = frame.centre.map((x, k) => x + (frame.radii[k] * q[6 * i + k]) / 4000), at = skull.over(p);
    const stood = (q[6 * i + 5] / 1e5) * frame.k, rooted = 1 - T.MathUtils.smoothstep(stood, 0.004 * frame.k, 0.016 * frame.k);
    const height = Math.max(at.h + (stood - at.h) * rooted, 0.0016 * frame.k);
    for (let k = 0; k < 3; k++) position[3 * i + k] = p[k] + at.u[k] * (height - at.h);
    uv[2 * i] = q[6 * i + 3] / 4000;
    uv[2 * i + 1] = q[6 * i + 4] / 4000;
    bones[4 * i] = head;
    weights[4 * i] = 1;
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(position, 3));
  geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
  geometry.setIndex(new T.BufferAttribute(source.indices.slice(), 1));
  geometry.computeVertexNormals();
  const m = material("#ffffff", "hair").clone();
  if (!plain) m.color.setHex(0xffffff);
  m.map = hairMap(style.hair, style.hairColor ?? "#8c8179", skin ?? "#c29a7e", plain);
  m.alphaTest = 0.42;
  m.roughness = 0.9;
  m.metalness = 0;
  m.userData = { ...m.userData, portrait: true, scanHair: true };
  const mesh = new T.Mesh(geometry, m);
  mesh.name = style.hair;
  mesh.userData.styleRegion = "head";
  mesh.userData.sculptedHair = true;
  mesh.userData.scanHair = data.cuts[style.hair].pose;
  mesh.castShadow = true;
  mesh.humanWeights = { boneIndices: bones, weights };
  return [mesh];
}
