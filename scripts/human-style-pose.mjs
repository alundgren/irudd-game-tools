import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as T from "three";
import { humanForm } from "../character-view/human-form.js";
import { humanRegions } from "../character-view/human-mesh.js";
import { dressedHuman } from "../character-view/human-wardrobe.js";
import { skinCharacter } from "../character-view/skin.js";
import { raycast } from "../character-view/human-style-kit.js";
import { bodies } from "./human-style-bodies.mjs";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map(a => { const [k, ...v] = a.trim().split(" "); return [k, v.join(" ") || true]; }));
const rgb = color => { const c = color.clone().convertLinearToSRGB(); return [c.r, c.g, c.b]; };
const skinTone = "#b58a6c";

export function dressedActor(human, style) {
  const form = humanForm(human, 7);
  form.outfit = style.outfit === "Pressure suit" ? "Pressure suit" : "Work clothes";
  form.humanStyle = style;
  form.appearance.skin = skinTone;
  for (const part of form.parts) if (part.color) part.color = skinTone;
  const material = color => new T.MeshStandardMaterial({ color });
  const dress = surface => { const meshes = dressedHuman(surface, form, material, true); for (const mesh of meshes) mesh.material.userData.piece = mesh.name; return meshes; };
  const root = new T.Group(), parts = new Map(), build = humanRegions(form, material, true, dress);
  for (const p of form.parts) { const g = build(p); g.position.fromArray(p.position); g.userData.partId = p.id; parts.set(p.id, g); }
  for (const p of form.parts) (parts.get(p.parent) ?? root).add(parts.get(p.id));
  return skinCharacter(form, root);
}

export function posed(rig) {
  rig.actor.updateMatrixWorld(true);
  rig.skeleton.update();
  const list = [], point = new T.Vector3();
  let low = Infinity;
  for (const mesh of rig.actor.children) {
    if (!mesh.isSkinnedMesh) continue;
    const count = mesh.geometry.attributes.position.count, positions = new Float32Array(count * 3), index = mesh.geometry.index.array;
    for (let i = 0; i < count; i++) { mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld); point.toArray(positions, i * 3); if (point.y < low) low = point.y; }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
    geometry.setIndex(new T.BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    const normals = geometry.attributes.normal.array;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material], groups = mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: index.length, materialIndex: 0 }];
    for (const group of groups) {
      const used = materials[group.materialIndex];
      list.push({ piece: used.userData.piece ?? (mesh.name.startsWith("Character") ? "skin" : "face"), positions, normals, indices: index.subarray(group.start, group.start + group.count), color: rgb(used.color) });
    }
  }
  return { list, low };
}

const hairLike = /hair|lengths|tail|knot|plait|tie|bob|crop|curls|afro|buzz|part|swept|bun|braid|wavy|long/i;
function samples(list, step) {
  const points = [];
  for (const [n, item] of list.entries()) {
    if (item.piece === "face" || hairLike.test(item.piece)) continue;
    const seen = new Set();
    for (const v of item.indices) seen.add(v);
    let k = 0;
    for (const v of seen) if (k++ % step === 0) points.push({ n, v });
  }
  return points;
}
function covered(list, points, reach = .12) {
  const cloth = list.map((item, n) => item.piece !== "skin" && item.piece !== "face" && !hairLike.test(item.piece) ? n : -1).filter(n => n >= 0);
  return points.map(({ n, v }) => {
    const { positions: p, normals: q } = list[n], origin = [p[v * 3] + q[v * 3] * .0015, p[v * 3 + 1] + q[v * 3 + 1] * .0015, p[v * 3 + 2] + q[v * 3 + 2] * .0015], direction = [q[v * 3], q[v * 3 + 1], q[v * 3 + 2]];
    return cloth.some(c => c !== n && list[c].piece !== list[n].piece && raycast(list[c].positions, list[c].indices, origin, direction) < reach);
  });
}

function stretched(rest, now) {
  const out = {}, far = (p, i, j) => Math.hypot(p[i] - p[j], p[i + 1] - p[j + 1], p[i + 2] - p[j + 2]);
  rest.forEach((item, n) => {
    if (item.piece === "skin" || item.piece === "face") return;
    const tally = out[item.piece] ??= [0, 1, 0];
    for (let t = 0; t < item.indices.length; t += 3) for (let e = 0; e < 3; e++) {
      const i = item.indices[t + e] * 3, j = item.indices[t + (e + 1) % 3] * 3, before = far(item.positions, i, j);
      if (before < .004) continue;
      const ratio = far(now[n].positions, i, j) / before;
      tally[2]++;
      if (ratio > 1.5) tally[0]++;
      if (ratio > tally[1]) tally[1] = ratio;
    }
  });
  return out;
}

if (process.argv[1]?.endsWith("human-style-pose.mjs")) {
  const poses = (args.poses ?? "Walk:.3,Reach:.5,Crouch:.5").split(",").map(p => { const [clip, phase] = p.split(":"); return [clip, Number(phase ?? .5)]; });
  const views = (args.views ?? "0,90,180").split(",").map(Number), images = [], [width, height] = (args.size ?? "260x420").split("x").map(Number);
  const frames = { body: [.5, 1.2], torso: [.62, .55], legs: [.3, .7] }, [at, span] = frames[args.frame ?? "body"];
  const raster = args.out ? await import("./human-style-raster.mjs") : null, draw = args.out ? await (await import("./human-style-render.mjs")).openRenderer() : null;
  if (draw) console.log("Renderer: " + draw.name);
  for (const name of (args.bodies ?? "heavy,f2").split(",")) {
    const style = { outfit: args.outfit ?? "T-shirt and jeans", hair: args.hair ?? "Crop", hairColor: args.hairColor ?? "#3a2c26", clothColor: args.clothColor ?? "#536d71" };
    const rig = dressedActor(bodies[name], style), mixer = new T.AnimationMixer(rig.actor), tall = bodies[name].height;
    const rest = posed(rig), points = samples(rest.list, Number(args.step ?? 20)), before = covered(rest.list, points), total = before.filter(Boolean).length;
    console.log(`${name} | ${style.outfit} | ${points.length} sample points, ${total} covered at rest`);
    for (const [clipName, phase] of poses) {
      mixer.stopAllAction();
      const clip = rig.clips.find(c => c.name === clipName), action = mixer.clipAction(clip).reset().play();
      let low = Infinity;
      for (let i = 0; i < 8; i++) { action.time = clip.duration * i / 8; mixer.update(0); low = Math.min(low, posed(rig).low); }
      action.time = clip.duration * phase;
      mixer.update(0);
      const { list } = posed(rig), now = covered(list, points);
      const bare = {};
      points.forEach((point, i) => { if (before[i] && !now[i]) bare[list[point.n].piece] = (bare[list[point.n].piece] ?? 0) + 1; });
      const lost = Object.values(bare).reduce((a, b) => a + b, 0);
      const pull = Object.entries(stretched(rest.list, list)), edges = pull.reduce((sum, [, t]) => sum + t[2], 0), over = pull.reduce((sum, [, t]) => sum + t[0], 0), [worst, [, ratio]] = pull.sort((a, b) => b[1][1] - a[1][1])[0] ?? ["none", [0, 1]];
      console.log(`  ${clipName} at ${phase}: lowest ${low.toFixed(3)} m, bare ${lost} of ${total} (${(100 * lost / total).toFixed(1)}%)${lost ? " " + JSON.stringify(bare) : ""}, pulled ${over} of ${edges} edges (${(100 * over / Math.max(1, edges)).toFixed(2)}%), worst ${worst} ${ratio.toFixed(1)}x`);
      const shown = args.bare ? list.filter(item => item.piece !== "skin") : list;
      if (draw) for (const yaw of views) images.push(await draw.render(shown, { yaw: yaw * Math.PI / 180, center: [0, tall * at, 0], span: tall * span, width, height }));
    }
    rig.dispose();
  }
  if (draw) {
    await draw.close();
    mkdirSync(dirname(args.out), { recursive: true });
    raster.writePng(args.out, raster.sheet(images, Number(args.columns ?? views.length * 3)));
    console.log("Wrote " + args.out);
  }
}
