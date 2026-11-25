import { humanRestPositions } from "./human-surface.js";

// A woven panel spans several attachment triangles. Fit the front of a shirt
// against a patch of rib cage, so a pocket or lapel keeps its cut as the bust moves.
const bindings = new Map();
const cell = 0.018;
const bin = (p) => Math.floor(p / cell);
const align = (p, lo, hi) => {
  const t = Math.max(0, Math.min(1, (p - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
function sewPanel(surface, proxyRest) {
  const rest = humanRestPositions(),
    cells = new Map();
  for (let i = 0; i < surface.bodyVertices; i++) {
    const idx = i * 3,
      x = rest[idx],
      y = rest[idx + 1],
      z = rest[idx + 2];
    if (Math.abs(x) > 0.24 || y < 0.1 || y > 0.59 || z < 0.045) continue;
    const key = bin(x) + "," + bin(y),
      prior = cells.get(key);
    if (prior === undefined || z > rest[prior * 3 + 2]) cells.set(key, i);
  }
  const rows = [];
  for (let v = 0; v < proxyRest.length / 3; v++) {
    const j = v * 3,
      x = proxyRest[j],
      y = proxyRest[j + 1],
      z = proxyRest[j + 2];
    const mix =
      align(z, 0.062, 0.12) *
      align(0.225 - Math.abs(x), 0, 0.065) *
      align(y, 0.12, 0.22) *
      align(0.565 - y, 0, 0.09);
    if (mix < 0.01) continue;
    const anchors = [];
    for (let dx = -5; dx <= 5; dx++)
      for (let dy = -6; dy <= 6; dy++) {
        const i = cells.get(bin(x) + dx + "," + (bin(y) + dy));
        if (i === undefined) continue;
        const ax = rest[i * 3],
          ay = rest[i * 3 + 1];
        const distance = ((ax - x) / 0.044) ** 2 + ((ay - y) / 0.052) ** 2;
        if (distance < 5)
          anchors.push({ i, weight: Math.exp(-0.5 * distance) });
      }
    const sum = anchors.reduce((a, p) => a + p.weight, 0);
    if (sum)
      rows.push({ v, mix, anchors: anchors.map((p) => [p.i, p.weight / sum]) });
  }
  return rows;
}
export function fitChestPanel(name, surface, proxyRest, positions) {
  if (!bindings.has(name)) bindings.set(name, sewPanel(surface, proxyRest));
  const rest = humanRestPositions(),
    scale = surface.height / 1.72;
  for (const { v, mix, anchors } of bindings.get(name)) {
    const j = v * 3;
    const point = [0, 1, 2].map((k) => proxyRest[j + k] * scale);
    let support = -Infinity;
    for (const [i, weight] of anchors) {
      for (let k = 0; k < 3; k++)
        point[k] +=
          weight * (surface.positions[i * 3 + k] - rest[i * 3 + k] * scale);
      // Cloth can hang below an apex and bridge the midline. A nearer
      // anchor has more support than a distant one on the other breast.
      const x = rest[i * 3] - proxyRest[j],
        y = rest[i * 3 + 1] - proxyRest[j + 1];
      const falloff = scale * (4.7 * x * x + (y > 0 ? 0.29 * y : -0.7 * y));
      support = Math.max(support, surface.positions[i * 3 + 2] - falloff);
    }
    point[2] = Math.max(point[2], support + 0.007 * scale);
    for (let k = 0; k < 3; k++)
      positions[j + k] += mix * (point[k] - positions[j + k]);
  }
}
