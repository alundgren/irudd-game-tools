import { unzlibSync } from "three/addons/libs/fflate.module.js";
import chart from "./human-photo-detail-data.json" with { type: "json" };
import pigment from "./human-skin-pigment-data.json" with { type: "json" };
import { randomStream } from "./random.js";

export const photoDetailNames = Object.keys(chart.patches);
const decoded = new Map();
function reflected(value, size) {
  const tile = Math.floor(value), fraction = value - tile;
  return (tile & 1 ? 1 - fraction : fraction) * (size - 1);
}

export function photoDetail(choice, seed) {
  if (!Object.hasOwn(chart.patches, choice)) return null;
  if (!decoded.has(choice)) {
    const bytes = Uint8Array.from(atob(chart.patches[choice]), char => char.charCodeAt(0));
    decoded.set(choice, unzlibSync(bytes));
  }
  const map = decoded.get(choice), size = chart.size;
  const next = randomStream(seed ^ 0x607ac9);
  const x0 = next(), y0 = next(), direction = next() < .5 ? -1 : 1;
  const gain = choice === "Fine pores" ? 1.15 : 1.65;
  return (u, v) => {
    const x = reflected(u * direction * 2.83 + v * .36 + x0, size);
    const y = reflected(v * 3.19 - u * direction * .28 + y0, size);
    const left = Math.floor(x), top = Math.floor(y);
    const right = Math.min(size - 1, left + 1), bottom = Math.min(size - 1, top + 1);
    const mix = (a, b, t) => a + (b - a) * t;
    return gain * (mix(mix(map[top * size + left], map[top * size + right], x - left),
      mix(map[bottom * size + left], map[bottom * size + right], x - left), y - top) - 128);
  };
}

export function skinPigment(seed) {
  const random = randomStream(seed ^ 0x0b2739c1);
  const index = Math.floor(random() * pigment.patches.length);
  if (!decoded.has(index)) {
    const bytes = Uint8Array.from(atob(pigment.patches[index]), c => c.charCodeAt(0));
    decoded.set(index, unzlibSync(bytes));
  }
  const patch = decoded.get(index), size = pigment.size;
  const shiftX = random(), shiftY = random(), angle = random() * 2 * Math.PI;
  const c = Math.cos(angle) * 6.7, s = Math.sin(angle) * 6.7;
  return (u, v, output) => {
    const x = reflected(c*u + s*v + shiftX, size);
    const y = reflected(c*v - s*u + shiftY, size);
    const left = Math.floor(x), top = Math.floor(y), fx = x-left, fy = y-top;
    const p = 3*(top*size + left);
    const dx = left < size-1 ? 3 : 0;
    const dy = top < size-1 ? 3*size : 0;
    for (let channel=0; channel<3; channel++) {
      const i = p+channel;
      const upper = patch[i] + fx*(patch[i+dx] - patch[i]);
      const lower = patch[i+dy] + fx*(patch[i+dy+dx] - patch[i+dy]);
      output[channel] = (upper + fy*(lower - upper) - 128) / 535;
    }
  };
}
