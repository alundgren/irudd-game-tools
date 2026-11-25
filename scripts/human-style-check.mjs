// Renders styled humans to a contact sheet for visual checks:
//   node scripts/human-style-check.mjs --outfit "T-shirt and jeans" --hair Bob --bodies f1,m1 --views 0,35,180 --out sheet.png
// Options: --clay (one neutral material), --frame head|bust|torso|legs|feet|body, --size 300x600,
// --bare (hide the body), --pitch degrees, --columns n. Lists take commas; back faces render red.
// The sheet is drawn on the graphics card through a headless browser. On a machine without a usable one
// the CPU renderer draws it. The script prints which renderer it used.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as T from "three";
import { evaluateHuman } from "../character-view/human-surface.js";
import { humanStyles, styleHuman } from "../character-view/human-style.js";
import { sheet, writePng } from "./human-style-raster.mjs";
import { openRenderer } from "./human-style-render.mjs";
import { bodies } from "./human-style-bodies.mjs";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map(a => { const [k, ...v] = a.trim().split(" "); return [k, v.join(" ") || true]; }));
const rgb = hex => { const c = new T.Color(hex).convertLinearToSRGB(); return [c.r, c.g, c.b]; };
const material = args.clay ? () => new T.MeshStandardMaterial({ color: "#b7aa9c" }) : color => new T.MeshStandardMaterial({ color });
const [width, height] = (args.size ?? "300x600").split("x").map(Number);
const frames = { body: [.5, 1.08, 0], head: [.93, .17, 0], bust: [.83, .42, 0], legs: [.27, .6, 0], feet: [.04, .18, .1], torso: [.62, .5, 0] };
const [at, span, forward] = frames[args.frame ?? "body"];
const images = [], draw = await openRenderer();
console.log("Renderer: " + draw.name);
const all = list => list === "all";
for (const name of (args.bodies ?? "f4,m4").split(",")) {
  const surface = evaluateHuman(bodies[name]), tall = bodies[name].height;
  const outfitNames = all(args.outfit) ? humanStyles.outfit.slice(1) : (args.outfit ?? "None").split(",");
  const hairNames = all(args.hair) ? humanStyles.hair.slice(1) : (args.hair ?? "None").split(",");
  for (const outfit of outfitNames) for (const hair of hairNames) {
    const started = performance.now();
    const meshes = styleHuman(surface, { hair, outfit, hairColor: args.hairColor ?? "#4a3628", clothColor: args.clothColor ?? "#5f7f8c" }, material);
    const ms = performance.now() - started;
    const list = meshes.map(mesh => ({ positions: mesh.geometry.attributes.position.array, indices: mesh.geometry.index.array, normals: mesh.geometry.attributes.normal.array, color: rgb(mesh.material.color) }));
    for (const mesh of meshes) {
      const n = mesh.geometry.attributes.position.count;
      if (mesh.humanWeights.weights.length !== n * 4 || mesh.humanWeights.boneIndices.length !== n * 4) throw new Error(mesh.name + " has mismatched skin weights");
      if (!surface.names.includes(mesh.userData.styleRegion)) throw new Error(mesh.name + " names an unknown region");
      for (const x of mesh.geometry.attributes.position.array) if (!Number.isFinite(x)) throw new Error(mesh.name + " has a non-finite position");
    }
    if (!args.bare) list.unshift({ positions: surface.positions, indices: surface.indices, color: args.clay ? rgb("#b7aa9c") : rgb("#c39a80") });
    console.log(name, outfit, hair, meshes.length + " meshes", list.reduce((s, x) => s + x.indices.length / 3, 0) + " triangles", ms.toFixed(0) + " ms", "ground " + meshes.ground?.toFixed(3));
    for (const yaw of (args.views ?? "0,35,180").split(",").map(Number))
      images.push(await draw.render(list, { yaw: yaw * Math.PI / 180, pitch: Number(args.pitch ?? 0) * Math.PI / 180, center: [0, tall * at, forward], span: tall * span, width, height }));
  }
}
await draw.close();
const out = args.out ?? ".reference-cache/human-style/check.png";
mkdirSync(dirname(out), { recursive: true });
writePng(out, sheet(images, Number(args.columns ?? Math.min(images.length, 6))));
console.log("Wrote " + out, "styles:", humanStyles.hair.length + " hair,", humanStyles.outfit.length + " outfits");
