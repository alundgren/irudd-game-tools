import { readdirSync, readFileSync } from "node:fs";
import { local, need } from "./local.mjs";

const folder = process.argv[2] ?? local + "exports";
if (!process.argv[2]) need("exports");
for (const file of readdirSync(folder).filter((f) => f.endsWith(".glb")).sort()) {
  const data = readFileSync(folder + "/" + file), length = data.readUInt32LE(12), doc = JSON.parse(data.subarray(20, 20 + length).toString("utf8"));
  let triangles = 0;
  const names = [];
  for (const node of doc.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const mesh = doc.meshes[node.mesh], name = node.name ?? mesh.name ?? "mesh " + node.mesh;
    for (const primitive of mesh.primitives) {
      triangles += doc.accessors[primitive.indices].count / 3;
      if (!("JOINTS_0" in primitive.attributes) || !("WEIGHTS_0" in primitive.attributes) || node.skin === undefined) names.push("UNSKINNED " + name);
    }
    names.push(name);
  }
  const unskinned = names.filter((n) => n.startsWith("UNSKINNED"));
  console.log(file, (data.length / 1e6).toFixed(2) + " MB,", doc.meshes.length, "meshes,", triangles, "triangles,", (doc.materials ?? []).length, "materials,", (doc.textures ?? []).length, "textures,", (doc.skins ?? []).length, "skins with", doc.skins?.[0]?.joints.length ?? 0, "joints,", (doc.animations ?? []).length, "animations");
  console.log("  meshes:", [...new Set(names.filter((n) => !n.startsWith("UNSKINNED")))].join(", "));
  const surface = doc.meshes.find((mesh, index) => (doc.nodes ?? []).some((node) => node.mesh === index && node.name === "Character surface"));
  if (surface) console.log("  surface materials:", surface.primitives.map((p) => (doc.materials[p.material]?.name || "material " + p.material) + " " + doc.accessors[p.indices].count / 3).join(", "));
  if (unskinned.length) console.log("  NOT SKINNED:", unskinned.join(", "));
}
