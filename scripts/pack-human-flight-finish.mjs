import fs from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { MeshoptSimplifier as M } from "three/addons/libs/meshopt_simplifier.module.js";
const [input, output] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(input, "utf8"));
await M.ready;
const read = (s, T) =>
  new T(Uint8Array.from(inflateSync(Buffer.from(s, "base64"))).buffer);
const pack = (a) =>
  deflateSync(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).toString(
    "base64",
  );
function exposedCrown(points, triangles) {
  const faces = [];
  for (let i = 0; i < triangles.length; i += 3) {
    let height = 0,
      outward = 0;
    for (let corner = 0; corner < 3; corner++) {
      const at = 8 * triangles[i + corner];
      height += points[at + 1];
      for (let axis = 0; axis < 3; axis++) {
        outward += points[at + axis] * points[at + 3 + axis];
      }
    }
    if (height / (3 * 10000) < -0.5 || outward >= 0) {
      faces.push(triangles[i], triangles[i + 1], triangles[i + 2]);
    }
  }
  return faces;
}

let total = 0;
for (const part of data.parts) {
  const vert = read(part.vertices, Int16Array),
    idx = Uint32Array.from(read(part.indices, Uint16Array));
  const v = Float32Array.from(vert, (x) => x / 10000);
  const keep =
    part.part === "LeatherParts_low" && part.rank === 0
      ? 1250
      : part.part === "Lenses_low"
        ? 64
        : Math.min(210, Math.max(24, Math.floor((idx.length / 3) * 0.16)));
  const [simplified] = M.simplify(idx, v, 8, 3 * keep, 0.085);
  const cut =
    part.part === "LeatherParts_low" && part.rank === 0
      ? exposedCrown(vert, simplified)
      : simplified;
  const used = Array.from(new Set(cut));
  const remap = new Map(used.map((x, i) => [x, i]));
  const points = new Int16Array(used.length * 8);
  used.forEach((id, i) => points.set(vert.slice(8 * id, 8 * id + 8), i * 8));
  part.vertices = pack(points);
  part.indices = pack(Uint16Array.from(cut, (x) => remap.get(x)));
  total += cut.length / 3;
}
console.log(total);
fs.writeFileSync(output, JSON.stringify(data));
