import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as T from "three";
import { evaluateHuman, smoothHumanSurface } from "../../character-view/human-surface.js";
import { dressedHuman } from "../../character-view/human-wardrobe.js";
import { writePng } from "../human-style-raster.mjs";
import { readGlb } from "./glb.mjs";
import { loadStudies, need } from "./local.mjs";
import { openMasks } from "./masks.mjs";
import { bestDepth, join, render, ruler } from "./raster.mjs";

need("targets/female-adult-04.glb");
const rocketboxStudies = await loadStudies();

const args = process.argv.slice(2), option = (name, fallback) => (args.includes("--" + name) ? args[args.indexOf("--" + name) + 1] : fallback);
const only = args[0] && !args[0].startsWith("--") ? args[0] : "", stage = option("stage", "final"), out = option("out", ".reference-cache/rocketbox/outline-metrics");
const look = option("look", ""), angles = option("angles", "0,90,180").split(",").map(Number);
const local = ".reference-cache/rocketbox/targets/", orbit = [0, 45, 90, 135, 180, 225, 270, 315];
const srgb = (hex) => { const c = new T.Color(hex).convertLinearToSRGB(); return [c.r, c.g, c.b]; };
mkdirSync(out, { recursive: true });
const masks = await openMasks();
console.log("Masks drawn by: " + masks.name);

function target(id) {
  const name = id.replace("rocketbox-", ""), glb = readGlb(local + name + ".glb");
  const textured = !masks.hardware;
  if (textured) need("targets/" + name + "." + glb.parts[0].material + ".rgba");
  return glb.parts.map((p) => ({
    positions: p.positions, indices: p.indices, normals: p.normals, uvs: p.uvs, color: [0.6, 0.6, 0.6], cutout: p.material.includes("opacity"),
    ...(textured ? { texture: { data: readFileSync(local + name + "." + p.material + ".rgba"), size: 1024 } } : {}),
  }));
}
function texture(name, index) {
  const material = readGlb(local + name + ".glb").parts[index].material;
  need("targets/" + name + "." + material + ".rgba");
  return { data: readFileSync(local + name + "." + material + ".rgba"), size: 1024 };
}
const view = (angle, px = 200) => ({ yaw: (angle * Math.PI) / 180, center: [0, 0.96, 0], span: 2.06, width: Math.round(1.5 * px), height: Math.round(2.06 * px) });
async function adult(form, placed) {
  const cage = evaluateHuman(form.human, form.humanFit), skin = smoothHumanSurface(cage);
  const material = (color) => new T.MeshStandardMaterial({ color });
  const meshes = [{ positions: skin.positions.slice(), indices: skin.indices.subarray(0, skin.bodyTriangles * 3), color: srgb(form.appearance.skin) }];
  for (const mesh of dressedHuman(cage, form, material, true))
    meshes.push({ positions: mesh.geometry.attributes.position.array.slice(), indices: mesh.geometry.index.array, normals: mesh.geometry.attributes.normal?.array, color: srgb("#" + mesh.material.color.getHexString()), name: mesh.name });
  let low = Infinity;
  for (const m of meshes) for (let i = 1; i < m.positions.length; i += 3) low = Math.min(low, m.positions[i]);
  for (const m of meshes) for (let i = 1; i < m.positions.length; i += 3) m.positions[i] -= low;
  const views = [];
  for (const angle of [0, 45, 90, 135]) views.push({ yaw: view(angle, 100).yaw, target: await masks.mask(placed, view(angle, 100)), adult: await masks.mask(meshes, view(angle, 100)) });
  const { shift } = bestDepth(views, 150, 206, 100);
  const moved = meshes.map((m) => { const positions = m.positions.slice(); for (let i = 2; i < positions.length; i += 3) positions[i] += shift; return { ...m, positions }; });
  return Object.assign(moved, { lift: -low, shift });
}
const frames = { whole: [0.96, 2.06, 1.5], torso: [1.2, 0.95, 0.9], head: [1.63, 0.42, 0.4], legs: [0.5, 1.08, 0.9] };
function preview(a, b, { angle, frame = "whole", mode = "colour", px = 300 }) {
  const [y, span, wide] = frames[frame], shot = { yaw: (angle * Math.PI) / 180, center: [0, y, 0], span, width: Math.round(wide * px), height: Math.round(span * px), mode };
  const left = render(a, shot), right = render(b, shot);
  if (frame === "whole" || frame === "legs") { ruler(left); ruler(right); }
  return join([left, right]);
}
const grid = (tiles, columns) => join(Array.from({ length: Math.ceil(tiles.length / columns) }, (_, r) => join(tiles.slice(r * columns, (r + 1) * columns), 8)), 8, true);

const readings = {}, looks = [];
for (const study of rocketboxStudies) {
  if (only && !study.id.endsWith(only)) continue;
  const staged = Boolean(study.stages[stage]) && stage !== "final", form = (study.stages[stage] ?? study.stages.final)(), a = target(study.id), b = await adult(form, a);
  const tag = study.id.replace("rocketbox-", "") + (staged ? "-" + stage.replaceAll(" ", "-") : "");
  if (look) {
    readings[tag] = { depthShiftM: +b.shift.toFixed(3) };
    looks.push({ tag, a, b });
    continue;
  }
  const rows = {}, diffs = [];
  for (const angle of orbit) {
    const shot = view(angle), w = shot.width, h = shot.height, ppm = h / shot.span, left = await masks.mask(a, shot), right = await masks.mask(b, shot);
    let both = 0, onlyA = 0, onlyB = 0, topA = 0, topB = 0;
    const data = new Uint8Array(w * h * 4).fill(255), widths = [];
    for (let i = w * h - 1; i >= 0; i--) {
      const x = left[i], y = right[i], metres = 0.96 + shot.span / 2 - Math.floor(i / w) / ppm;
      if (x) topA = metres;
      if (y) topB = metres;
      if (x && y) { both++; data.set([70, 80, 76, 255], i * 4); }
      else if (x) { onlyA++; data.set([60, 120, 190, 255], i * 4); }
      else if (y) { onlyB++; data.set([205, 90, 50, 255], i * 4); }
    }
    for (let metres = 0.05; metres < 1.95; metres += 0.1) {
      const y = Math.round(h / 2 - (metres - 0.96) * ppm);
      if (y < 0 || y >= h) continue;
      let wa = 0, wb = 0;
      for (let x = 0; x < w; x++) { wa += left[y * w + x]; wb += right[y * w + x]; }
      widths.push([+metres.toFixed(2), +(wa / ppm).toFixed(3), +(wb / ppm).toFixed(3)]);
    }
    const all = both + onlyA + onlyB;
    rows[angle] = { iou: +(both / all).toFixed(3), targetOnly: +(onlyA / all).toFixed(3), adultOnly: +(onlyB / all).toFixed(3), targetTopM: +topA.toFixed(3), adultTopM: +topB.toFixed(3), widthsByHeightM: widths };
    diffs.push({ width: w, height: h, data });
  }
  const ious = Object.values(rows).map((r) => r.iou), mean = +(ious.reduce((x, y) => x + y, 0) / ious.length).toFixed(3);
  readings[tag] = { masksDrawnBy: masks.name, hairCardsCountAsSolid: masks.hardware, stature: form.human.height, soleLiftM: +b.lift.toFixed(3), depthShiftM: +b.shift.toFixed(3), meanOverlap: mean, views: rows };
  writePng(out + "/" + tag + "-outline.png", grid(diffs, 4));
  console.log(tag, "outline overlap", Object.entries(rows).map(([k, r]) => k + "° " + r.iou).join(", "), "mean", mean, "tops", rows[0].targetTopM, rows[0].adultTopM, "depth shift", readings[tag].depthShiftM);
}
await masks.close();
const placement = ".reference-cache/rocketbox/placement.json";
let placed = {};
try { placed = JSON.parse(readFileSync(placement, "utf8")); } catch {}
writeFileSync(placement, JSON.stringify({ ...placed, ...Object.fromEntries(Object.entries(readings).map(([tag, r]) => [tag, r.depthShiftM])) }, null, 1) + "\n");
if (look) {
  const modes = option("mode", "colour").split(","), columns = option("columns", "3");
  if (masks.hardware) {
    const page = out + "/look-page.html", run = (command, list) => spawnSync(command, list, { stdio: "inherit" }).status === 0;
    const drawn = run(process.execPath, ["scripts/rocketbox-study/build.mjs", "--out", page])
      && run(process.env.PYTHON ?? "python", ["scripts/rocketbox-study/capture.py", "--require-hardware", "--page", page, "--out", out, "--stage", stage, "--look", look, "--angles", angles.join(","), "--modes", modes.join(","), "--columns", columns, ...(only ? ["--study", only] : [])]);
    if (!drawn) throw new Error("Hardware comparison capture failed. See the build and capture output above.");
  } else {
    console.log("Working preview drawn by " + masks.name);
    for (const { tag, a, b } of looks) {
      const name = tag.replace(/-presets$/, ""), textured = a.map((part, i) => ({ ...part, texture: part.texture ?? texture(name, i) }));
      for (const mode of modes) writePng(out + "/" + tag + "-look-" + look + (mode === "colour" ? "" : "-" + mode) + ".png", grid(angles.map((angle) => preview(textured, b, { angle, frame: look, mode, px: +option("px", 420) })), +columns));
    }
  }
} else {
  const file = out + "/readings" + (stage === "final" ? "" : "-" + stage.replaceAll(" ", "-")) + ".json";
  let previous = {};
  try { previous = JSON.parse(readFileSync(file, "utf8")); } catch {}
  writeFileSync(file, JSON.stringify({ ...previous, ...readings }, null, 1) + "\n");
}
