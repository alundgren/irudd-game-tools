import { evaluateHuman, humanRange, type HumanAxis } from "./surface.js";
import type { HumanBody } from "./body.js";
import type { HumanAdultParams } from "./generator.js";

const levels = [0.24, 0.5, 0.6, 0.72, 0.93];

function profile(vertices: ArrayLike<number>) {
  let low = Infinity,
    high = -Infinity;
  for (let i = 1; i < vertices.length; i += 3) {
    low = Math.min(low, vertices[i] ?? Infinity);
    high = Math.max(high, vertices[i] ?? -Infinity);
  }
  const height = high - low;
  if (!Number.isFinite(height) || height < 0.0001)
    throw new Error("Choose an upright full-body mesh.");
  const depths = levels.map((level) => {
    let near = -Infinity,
      far = Infinity;
    for (let i = 0; i < vertices.length; i += 3) {
      if (Math.abs(((vertices[i + 1] ?? low) - low) / height - level) > 0.035) continue;
      near = Math.max(near, vertices[i + 2] ?? -Infinity);
      far = Math.min(far, vertices[i + 2] ?? Infinity);
    }
    return (near - far) / height;
  });
  if (depths.some((d) => !Number.isFinite(d) || d <= 0))
    throw new Error(
      "The mesh needs surfaces from the feet to the head, with Y up and Z facing forward.",
    );
  return { height, depths };
}

export function referenceVertices(obj: string): Float32Array {
  const vertices: number[] = [];
  for (const line of obj.split(/\r?\n/)) {
    const [tag, x, y, z] = line.trim().split(/\s+/, 4);
    if (tag !== "v") continue;
    const point = [Number(x), Number(y), Number(z)];
    if (!point.every(Number.isFinite)) throw new Error("The OBJ has an invalid vertex.");
    vertices.push(...point);
  }
  return Float32Array.from(vertices);
}

export function fitReference(body: HumanBody, params: HumanAdultParams, vertices: Float32Array) {
  const target = profile(vertices);
  const human = { ...params.human };
  if (target.height >= 1.43 && target.height <= 2.08) human["height"] = target.height;
  const score = () =>
    profile(evaluateHuman(body, human).positions).depths.reduce(
      (sum, d, i) => sum + (d - (target.depths[i] ?? d)) ** 2,
      0,
    );
  let best = score();
  const axes: HumanAxis[] = ["weight", "muscle", "frame"];
  for (const step of [0.6, 0.3, 0.15])
    for (const axis of axes) {
      const [lo, hi, base] = humanRange(axis);
      const initial = human[axis] ?? base;
      let chosen = initial;
      for (const direction of [-1, 1]) {
        human[axis] = Math.min(hi, Math.max(lo, initial + direction * step));
        const candidate = score();
        if (candidate < best) {
          best = candidate;
          chosen = human[axis] ?? initial;
        }
      }
      human[axis] = chosen;
    }
  return { ...params, human };
}
