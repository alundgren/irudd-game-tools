import { NoColorSpace } from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import maps from "./human-cast-surface-data.json" with { type: "json" };
import catalog from "./human-cast-catalog.json" with { type: "json" };
import { castPieces, wornCastOutfit } from "./human-cast-wardrobe.js";

const decoded = new Map();
const signed = value => value >= 128 ? value - 256 : value;

function sourceMap(subject, region) {
  const key = subject + "/" + region;
  if (!decoded.has(key)) {
    const bytes = Uint8Array.from(atob(maps.subjects[subject][region]), c => c.charCodeAt(0));
    decoded.set(key, unzlibSync(bytes));
  }
  return decoded.get(key);
}

export function applyCastSurface(material, label, style, picture) {
  const head = catalog.people[label].subject;
  if (!Object.hasOwn(maps.subjects, head)) return;
  const outfit = wornCastOutfit(label, style);
  const top = outfit ? castPieces.top[outfit.castTop] : head;
  const bottom = outfit ? castPieces.bottom[outfit.castBottom] : head;
  const side = maps.size, half = side / 2;
  const normals = new Uint8ClampedArray(side * side * 4).fill(255);
  const roughness = new Uint8ClampedArray(normals.length).fill(255);
  for (let i = 0; i < normals.length; i += 4) normals[i] = normals[i + 1] = 128;

  function paint(subject, region, left, startY, rows, step) {
    const src = sourceMap(subject, region);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < half; x++) {
        const a = 3 * (y * step * half + x), b = a + 3 * half * (step - 1);
        const dst = 4 * ((startY + y) * side + left + x);
        const nx = (signed(src[a]) + signed(src[b])) / 127;
        const ny = (signed(src[a + 1]) + signed(src[b + 1])) / 127;
        const scale = 127 / Math.hypot(nx, ny, 1);
        normals[dst] = 128 + scale * nx;
        normals[dst + 1] = 128 + scale * ny;
        normals[dst + 2] = 128 + scale;
        const intensity = (src[a + 2] + src[b + 2]) / 255;
        roughness[dst + 1] = 255 * Math.max(.24, .90 - .90 * Math.sqrt(intensity));
      }
    }
  }
  paint(top, "body", 0, 0, side, 1);
  paint(head, "head", half, 0, half, 1);
  if (bottom !== top) paint(bottom, "body", half, half, half, 2);
  material.normalMap = picture(normals, side);
  material.roughnessMap = picture(roughness, side);
  material.normalMap.colorSpace = material.roughnessMap.colorSpace = NoColorSpace;
  material.roughness = 1;
}
