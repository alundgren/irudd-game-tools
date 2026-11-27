import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
const { MeshoptEncoder } = createRequire(
  new URL("../packages/character/package.json", import.meta.url),
)("meshoptimizer");
import { generatedHuman } from "../character-view/human-form.js";
import { evaluateHuman, smoothHumanSurface } from "../character-view/human-surface.js";
import { proportionEnds, proportions } from "../character-view/human-proportions.js";

const dir = resolve(process.argv[2]);
await mkdir(dir, { recursive: true });
const adult = generatedHuman(491, "any");
await writeFile(
  join(dir, "adult.form.json"),
  JSON.stringify({ format: "irudd.form.v1", form: adult }),
);
const target = {
  ...adult.human,
  height: 1.83,
  weight: 0.8,
  bust: 0.65,
  frame: 0.5,
  headWidth: 0.6,
  nose: 0.8,
  jaw: -0.5,
};
function glb(positions, indices) {
  const attributes = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength),
    faces = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  positions.forEach((x, i) => {
    min[i % 3] = Math.min(min[i % 3], x);
    max[i % 3] = Math.max(max[i % 3], x);
  });
  const bin = Buffer.concat([attributes, faces]);
  const json = Buffer.from(
    JSON.stringify({
      asset: {
        version: "2.0",
        copyright: "Generated from the MakeHuman CC0 adult for local parity QA.",
      },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      buffers: [{ byteLength: bin.length }],
      bufferViews: [
        { buffer: 0, byteLength: attributes.length },
        { buffer: 0, byteOffset: attributes.length, byteLength: faces.length },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min, max },
        { bufferView: 1, componentType: 5125, count: indices.length, type: "SCALAR" },
      ],
    }),
  );
  const j = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(j);
  const out = Buffer.alloc(28 + j.length + bin.length);
  for (const [offset, value] of [
    [0, 0x46546c67],
    [4, 2],
    [8, out.length],
    [12, j.length],
    [16, 0x4e4f534a],
    [20 + j.length, bin.length],
    [24 + j.length, 0x004e4942],
  ])
    out.writeUInt32LE(value, offset);
  j.copy(out, 20);
  bin.copy(out, 28 + j.length);
  return out;
}
const s = evaluateHuman(target),
  smooth = smoothHumanSurface(s);
for (const [unit, factor] of Object.entries({
  auto: 1,
  m: 1,
  cm: 100,
  mm: 1000,
  in: 1 / 0.0254,
  ft: 1 / 0.3048,
  stature: 4.13,
})) {
  await writeFile(
    join(dir, unit + ".glb"),
    glb(
      Float32Array.from(smooth.positions, (x) => x * factor),
      smooth.indices,
    ),
  );
}
const scene = glb(smooth.positions, smooth.indices),
  jsonLength = scene.readUInt32LE(12);
const model = JSON.parse(scene.toString("utf8", 20, 20 + jsonLength));
const n = smooth.positions.length / 3;
const bin = scene.subarray(28 + jsonLength),
  joints = new Uint8Array(4 * n),
  weights = new Uint8Array(4 * n);
for (let i = 0; i < n; i++) weights[4 * i] = 255;
await MeshoptEncoder.ready;
const encoded = MeshoptEncoder.encodeGltfBuffer(
  new Uint8Array(smooth.positions.buffer, smooth.positions.byteOffset, smooth.positions.byteLength),
  n,
  12,
  "ATTRIBUTES",
);
const payload = Buffer.concat([bin, joints, weights, encoded]);
model.buffers = [
  {
    byteLength: payload.length,
    uri: "data:application/octet-stream;base64," + payload.toString("base64"),
  },
];
model.extensionsUsed = ["EXT_meshopt_compression"];
model.extensionsRequired = ["EXT_meshopt_compression"];
model.bufferViews[0].extensions = {
  EXT_meshopt_compression: {
    buffer: 0,
    byteOffset: bin.length + 2 * n * 4,
    byteLength: encoded.length,
    byteStride: 12,
    count: n,
    mode: "ATTRIBUTES",
    filter: "NONE",
  },
};
model.bufferViews.push(
  { buffer: 0, byteOffset: bin.length, byteLength: 4 * n },
  { buffer: 0, byteOffset: bin.length + 4 * n, byteLength: 4 * n },
);
model.accessors.push(
  { bufferView: 2, componentType: 5121, count: n, type: "VEC4" },
  { bufferView: 3, componentType: 5121, count: n, type: "VEC4", normalized: true },
);
model.meshes[0].primitives[0].attributes.JOINTS_0 = 2;
model.meshes[0].primitives[0].attributes.WEIGHTS_0 = 3;
model.nodes = [
  { mesh: 0, skin: 0 },
  { name: "joint" },
  { mesh: 0, skin: 0, scale: [-0.12, 0.12, 0.12], translation: [0.47, 0, 0] },
];
model.scenes = [{ nodes: [0, 1, 2] }];
model.skins = [{ joints: [1] }];
await writeFile(join(dir, "transformed-skinned.gltf"), JSON.stringify(model));
await writeFile(join(dir, "corrupt.glb"), "unreadable");
await writeFile(
  join(dir, "empty.gltf"),
  JSON.stringify({ asset: { version: "2.0" }, scenes: [{}], scene: 0 }),
);
await writeFile(
  join(dir, "draco.gltf"),
  JSON.stringify({
    ...model,
    extensionsUsed: ["KHR_draco_mesh_compression"],
    extensionsRequired: ["KHR_draco_mesh_compression"],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            extensions: {
              KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } },
            },
          },
        ],
      },
    ],
  }),
);
const invalid = Buffer.from(scene);
invalid.writeFloatLE(NaN, 28 + jsonLength);
await writeFile(join(dir, "nonfinite.glb"), invalid);
const neutral = smoothHumanSurface(evaluateHuman({ height: 1.72 }));
await writeFile(join(dir, "neutral.glb"), glb(neutral.positions, neutral.indices));
const memberBytes = await readFile(resolve("examples/human-targets/mhr-f1.glb")),
  memberJsonLength = memberBytes.readUInt32LE(12);
const memberJson = JSON.parse(memberBytes.toString("utf8", 20, 20 + memberJsonLength)),
  indexAccessor = memberJson.accessors[memberJson.meshes[0].primitives[0].indices];
const indexStart =
  28 +
  memberJsonLength +
  memberJson.bufferViews[indexAccessor.bufferView].byteOffset +
  (indexAccessor.byteOffset ?? 0);
if (indexAccessor.componentType !== 5123) throw new Error("Unexpected MHR index format.");
const first = memberBytes.readUInt16LE(indexStart);
memberBytes.writeUInt16LE(memberBytes.readUInt16LE(indexStart + 2), indexStart);
memberBytes.writeUInt16LE(first, indexStart + 2);
await writeFile(join(dir, "mhr-order.glb"), memberBytes);
const reverse = smooth.indices.slice();
[reverse[1], reverse[2]] = [reverse[2], reverse[1]];
await writeFile(join(dir, "order.glb"), glb(smooth.positions, reverse));
const large = new Uint32Array(750001 * 3);
for (let i = 0; i < large.length; i++) large[i] = i % 3;
await writeFile(join(dir, "too-large.glb"), glb(Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), large));
const head = s.names.indexOf("head"),
  taken = [];
for (let t = 0; t < s.bodyTriangles; t++) {
  const ids = [...s.indices.subarray(3 * t, 3 * t + 3)];
  if (ids.every((v) => s.boneIndices[4 * v] === head)) taken.push(...ids);
}
const indices = [...new Set(taken)],
  remap = new Map(indices.map((v, i) => [v, i]));
const points = Float32Array.from(
  indices.flatMap((v) => [...s.positions.subarray(v * 3, v * 3 + 3)]),
);
await writeFile(
  join(dir, "bust.glb"),
  glb(
    points,
    Uint32Array.from(taken, (v) => remap.get(v)),
  ),
);
const front = [];
for (let t = 0; t < taken.length; t += 3) {
  const a = 3 * taken[t],
    b = 3 * taken[t + 1],
    c = 3 * taken[t + 2];
  const dz =
    (s.positions[b] - s.positions[a]) * (s.positions[c + 1] - s.positions[a + 1]) -
    (s.positions[b + 1] - s.positions[a + 1]) * (s.positions[c] - s.positions[a]);
  if (dz > 0 && Math.min(s.positions[a + 2], s.positions[b + 2], s.positions[c + 2]) > 0.055)
    front.push(remap.get(taken[t]), remap.get(taken[t + 1]), remap.get(taken[t + 2]));
}
await writeFile(join(dir, "one-sided.glb"), glb(points, Uint32Array.from(front)));
await writeFile(
  join(dir, "marks.json"),
  JSON.stringify({
    height: adult.human.height ?? 1.72,
    proportions: Object.fromEntries(
      proportions.map((p) => [p.id, proportionEnds({ human: target }, p.id)]),
    ),
  }),
);
