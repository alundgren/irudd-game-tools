import * as T from "three";
import { evaluateHuman, humanRange } from "../../character-view/human-surface.js";
import { dressedHuman } from "../../character-view/human-wardrobe.js";
import { readGlb } from "./glb.mjs";
import { loadStudies, local, need } from "./local.mjs";
import { openMasks } from "./masks.mjs";
import { bestDepth } from "./raster.mjs";

const args = process.argv.slice(2), option = (name, fallback) => (args.includes("--" + name) ? args[args.indexOf("--" + name) + 1] : fallback);
const studies = await loadStudies(), study = studies.find((s) => s.id.endsWith(args[0]));
if (!study) { console.error("Name a study: " + studies.map((s) => s.id.replace("rocketbox-", "")).join(", ")); process.exit(1); }
const name = study.id.replace("rocketbox-", "");
need("targets/" + name + ".glb");
const px = +option("px", 90), rounds = +option("rounds", 3), yaws = [0, 45, 90, 135];
const body = ["frame", "weight", "muscle", "shoulders", "chest", "bust", "waist", "belly", "hips", "seat", "legs", "calves", "arms", "neck", "torsoLength", "neckLength", "shinLength", "upperArmLength", "forearmLength", "headWidth"];
const pose = ["height", "stance", "legSpread", "armForward", "elbowBend"];
const axes = option("axes", [...pose, ...body].join(",")).split(",");
const view = (yaw) => ({ yaw: (yaw * Math.PI) / 180, center: [0, 0.96, 0], span: 2.06, width: Math.round(1.5 * px), height: Math.round(2.06 * px) });
const masks = await openMasks();
console.log("Outlines drawn by: " + masks.name);
const glb = readGlb(local + "targets/" + name + ".glb");
const targetMeshes = glb.parts.map((p) => ({ positions: p.positions, indices: p.indices, color: [0, 0, 0] })), want = [];
for (const yaw of yaws) want.push(await masks.mask(targetMeshes, view(yaw)));
const form = study.make(), material = (color) => new T.MeshStandardMaterial({ color });

async function score(human) {
  const cage = evaluateHuman(human, form.humanFit);
  const meshes = [{ positions: cage.positions.slice(), indices: cage.indices.subarray(0, cage.bodyTriangles * 3), color: [0, 0, 0] }];
  for (const mesh of dressedHuman(cage, { ...form, human }, material, true)) meshes.push({ positions: mesh.geometry.attributes.position.array.slice(), indices: mesh.geometry.index.array, color: [0, 0, 0] });
  let low = Infinity;
  for (const m of meshes) for (let i = 1; i < m.positions.length; i += 3) low = Math.min(low, m.positions[i]);
  for (const m of meshes) for (let i = 1; i < m.positions.length; i += 3) m.positions[i] -= low;
  const frame = view(0), views = [];
  for (const [v, yaw] of yaws.entries()) views.push({ yaw: (yaw * Math.PI) / 180, target: want[v], adult: await masks.mask(meshes, view(yaw)) });
  const placed = bestDepth(views, frame.width, frame.height, px);
  const total = placed.overlap * yaws.length;
  const extreme = body.reduce((sum, key) => sum + (human[key] ?? 0) ** 2, 0);
  return { overlap: total / yaws.length, cost: total / yaws.length - 0.004 * extreme };
}

let human = { ...form.human };
if (args.includes("--fresh")) for (const key of axes) if (key !== "height") delete human[key];
let best = await score(human);
console.log(name, "start", best.overlap.toFixed(4));
for (let round = 0; round < rounds; round++) {
  const step = 0.32 / 2 ** round;
  for (const key of axes) {
    const [lo, hi] = humanRange(key), size = key === "height" ? step * 0.06 : step;
    for (const direction of [1, -1]) {
      let moved = false;
      for (;;) {
        const value = +Math.min(hi, Math.max(lo, (human[key] ?? (key === "height" ? 1.72 : 0)) + direction * size)).toFixed(3);
        if (value === (human[key] ?? 0)) break;
        const trial = { ...human, [key]: value }, got = await score(trial);
        if (got.cost <= best.cost + 0.0002) break;
        human = trial; best = got; moved = true;
      }
      if (moved) break;
    }
  }
  console.log("round", round + 1, "overlap", best.overlap.toFixed(4), JSON.stringify(human));
}
await masks.close();
