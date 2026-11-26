import assert from "node:assert/strict";
import test from "node:test";
import * as T from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import {
  applyHumanControls,
  applyHumanDetail,
  controlVectors,
  evaluateHuman,
  humanDetailFrom,
  humanDetailLimit,
  humanDetailVertex,
  smoothHumanSurface,
  validHumanDetail,
} from "./human-surface.js";
import { changeHuman, generatedHuman } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { dressedHuman } from "./human-wardrobe.js";
import { validateForm } from "./recipe.js";
import { skinCharacter } from "./skin.js";
import { extractComponent, placeComponent } from "./graft.js";
import { brushBody, brushStroke } from "./human-brush.js";
import { foldedTriangles } from "./family-transfer.js";
import { fitHumanReference, optimizeHumanMeasurements } from "./human-fit.js";

function swelling(coarse, size = 0.004) {
  const moves = new Float32Array(coarse.positions.length), p = coarse.positions, scale = coarse.height / 1.72;
  let top = -Infinity;
  for (let v = 0; v < coarse.bodyVertices; v++) top = Math.max(top, p[v * 3 + 1]);
  for (let v = 0; v < coarse.bodyVertices; v++) {
    if (!humanDetailVertex(v)) continue;
    const x = p[v * 3] / scale, y = (top - p[v * 3 + 1]) / scale, z = p[v * 3 + 2] / scale;
    const wave = Math.sin(14 * x) * Math.cos(11 * y) + 0.5 * Math.sin(16 * z + 9 * y);
    moves[v * 3] = 0.3 * size * scale * Math.sin(13 * y);
    moves[v * 3 + 1] = 0.25 * size * scale * wave;
    moves[v * 3 + 2] = size * scale * wave * Math.max(0, Math.min(1, (z + 0.02) / 0.06));
  }
  for (const group of coarse.eyeGroups) for (const v of group) moves.set([0.0004 * scale, -0.0006 * scale, 0.0011 * scale], v * 3);
  return moves;
}
const sample = (human = { height: 1.72 }, fit) => {
  const coarse = evaluateHuman(human, fit);
  return { coarse, detail: humanDetailFrom(coarse, swelling(coarse)) };
};
const farthest = (a, b, from = 0, to = a.length / 3) => {
  let most = 0;
  for (let i = from * 3; i < to * 3; i += 3) most = Math.max(most, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]));
  return most;
};

test("a fine head layer is checked strictly and is optional", () => {
  const { coarse, detail } = sample();
  assert.ok(validHumanDetail(detail));
  assert.deepEqual(Object.keys(detail), ["version", "region", "vertices", "offsets"]);
  assert.ok(detail.vertices.every(humanDetailVertex));
  const broken = (change) => {
    const copy = structuredClone(detail);
    change(copy);
    return copy;
  };
  for (const [name, bad] of Object.entries({
    missing: undefined,
    "an array": [],
    "another version": broken((d) => (d.version = 2)),
    "another region": broken((d) => (d.region = "whole")),
    "an extra field": broken((d) => (d.source = "scan.glb")),
    "no vertices": { version: 1, region: "head", vertices: [], offsets: [] },
    "a missing number": broken((d) => d.offsets.pop()),
    "a fraction": broken((d) => (d.offsets[4] = 0.5)),
    "not a number": broken((d) => (d.offsets[4] = NaN)),
    "no limit": broken((d) => (d.offsets[4] = Infinity)),
    "text": broken((d) => (d.offsets[4] = "12")),
    "too long": broken((d) => d.offsets.splice(0, 3, humanDetailLimit, 40, 0)),
    "a repeated vertex": broken((d) => (d.vertices[1] = d.vertices[0])),
    "vertices out of order": broken((d) => d.vertices.reverse()),
    "a negative vertex": broken((d) => (d.vertices[0] = -1)),
    "a vertex beyond the figure": broken((d) => (d.vertices[d.vertices.length - 1] = 1e6)),
    "a vertex outside the head": broken((d) => {
      let foot = 0;
      for (let v = 0; v < coarse.bodyVertices; v++) if (coarse.positions[v * 3 + 1] < 0.05) foot = v;
      d.vertices = [foot];
      d.offsets = [1, 1, 1];
    }),
  })) {
    assert.equal(validHumanDetail(bad), false, name);
    if (bad) assert.throws(() => applyHumanDetail(coarse, bad), /fine correction/, name);
  }
  assert.ok(validHumanDetail(broken((d) => d.offsets.splice(0, 3, humanDetailLimit, 0, 0))));
  const long = new Float32Array(coarse.positions.length);
  long.set([0.05, 0.03, -0.04], detail.vertices[0] * 3);
  const cut = humanDetailFrom(coarse, long);
  assert.ok(validHumanDetail(cut));
  assert.ok(Math.abs(Math.hypot(...cut.offsets) - humanDetailLimit) < 2);
  assert.equal(humanDetailFrom(coarse, new Float32Array(coarse.positions.length)), undefined);
  assert.throws(() => humanDetailFrom(coarse, new Float32Array(coarse.positions.length).fill(NaN)), /fine correction/);

  const plain = evaluateHuman({ height: 1.8, jaw: 0.4 });
  assert.deepEqual(evaluateHuman({ height: 1.8, jaw: 0.4 }, undefined, undefined).positions, plain.positions);
});

test("the layer reshapes only the head and returns what was written", () => {
  const { coarse, detail } = sample(), wanted = swelling(coarse), made = evaluateHuman({ height: 1.72 }, undefined, detail);
  let worst = 0;
  for (let v = 0; v < coarse.positions.length / 3; v++) {
    const moved = [0, 1, 2].map((d) => made.positions[v * 3 + d] - coarse.positions[v * 3 + d]);
    if (!humanDetailVertex(v)) assert.equal(Math.hypot(...moved), 0);
    else worst = Math.max(worst, Math.hypot(...moved.map((x, d) => x - wanted[v * 3 + d])));
  }
  assert.ok(worst < 0.00002, "written and applied movements differ by " + worst * 1000 + " mm");
  assert.deepEqual(made.joints, coarse.joints);
  assert.equal(made.indices, coarse.indices);
  for (const group of coarse.eyeGroups) {
    const first = [0, 1, 2].map((d) => made.positions[group[0] * 3 + d] - coarse.positions[group[0] * 3 + d]);
    for (const v of group) for (let d = 0; d < 3; d++) assert.ok(Math.abs(made.positions[v * 3 + d] - coarse.positions[v * 3 + d] - first[d]) < 1e-6);
  }
  assert.equal(applyHumanDetail(coarse, undefined), coarse);
  assert.equal(farthest(applyHumanDetail(coarse, detail, 0).positions, coarse.positions), 0);
});

test("the rebase rule: the layer follows the skin when the head or the stature changes", () => {
  const { detail } = sample();
  const changed = { height: 1.72, jaw: 0.8, noseLength: -0.7, earFlare: 0.9, craniumDepth: 0.6, cheeks: -0.7, lipFullness: 0.6 };
  const coarse = evaluateHuman(changed), made = evaluateHuman(changed, undefined, detail), moves = new Float32Array(coarse.positions.length);
  for (let i = 0; i < moves.length; i++) moves[i] = made.positions[i] - coarse.positions[i];
  const again = humanDetailFrom(coarse, moves);
  assert.deepEqual(again.vertices, detail.vertices);
  for (let i = 0; i < detail.offsets.length; i++) assert.ok(Math.abs(again.offsets[i] - detail.offsets[i]) <= 1, "offset " + i);

  const fit = { version: 1, strength: 1, controls: [[700, 30, -20, 60], [701, -40, 10, 25], [702, 15, 15, -35]] };
  const corrected = applyHumanControls(evaluateHuman(changed), controlVectors(fit)), both = evaluateHuman(changed, fit, detail);
  assert.ok(farthest(both.positions, applyHumanDetail(corrected, detail).positions) === 0);

  const short = evaluateHuman({ height: 1.72 }), shortMade = evaluateHuman({ height: 1.72 }, undefined, detail);
  const tall = evaluateHuman({ height: 1.978 }), tallMade = evaluateHuman({ height: 1.978 }, undefined, detail);
  let worst = 0;
  for (const v of detail.vertices)
    for (let d = 0; d < 3; d++)
      worst = Math.max(worst, Math.abs(tallMade.positions[v * 3 + d] - tall.positions[v * 3 + d] - 1.15 * (shortMade.positions[v * 3 + d] - short.positions[v * 3 + d])));
  assert.ok(worst < 0.00002, "stature scaling differs by " + worst * 1000 + " mm");

  for (const group of coarse.eyeGroups) {
    const first = [0, 1, 2].map((d) => made.positions[group[0] * 3 + d] - coarse.positions[group[0] * 3 + d]);
    for (const v of group) for (let d = 0; d < 3; d++) assert.ok(Math.abs(made.positions[v * 3 + d] - coarse.positions[v * 3 + d] - first[d]) < 1e-6);
  }
  const drawn = (under, over) => {
    const smooth = smoothHumanSurface(under), smoothOver = smoothHumanSurface(over);
    return foldedTriangles(smooth.positions, smoothOver.positions, smooth.indices, smooth.indices.length / 3).folded.length;
  };
  const cage = (under, over) => foldedTriangles(under.positions, over.positions, over.indices, over.bodyTriangles).folded.length;
  assert.equal(drawn(short, shortMade) + cage(short, shortMade), 0);
  assert.equal(drawn(coarse, made), 0);
  assert.ok(cage(coarse, made) <= 6);
  const calm = { ...changed, earFlare: 0.3 };
  assert.equal(cage(evaluateHuman(calm), evaluateHuman(calm, undefined, detail)), 0);
});

test("shape controls keep working on a head with a fine layer, through edit, save and undo", () => {
  const start = generatedHuman(31, "neutral"), { detail } = sample(start.human);
  const form = validateForm({ ...start, humanDetail: detail });
  assert.deepEqual(form.humanDetail, detail);
  assert.equal(validateForm(start).humanDetail, undefined);
  assert.throws(() => validateForm({ ...start, humanDetail: { ...detail, offsets: detail.offsets.map((x) => x + 0.5) } }), /fine head layer/);
  assert.throws(() => validateForm({ ...start, humanDetail: { ...detail, note: "from a scan" } }), /fine head layer/);
  const { human, ...creature } = start;
  assert.throws(() => validateForm({ ...creature, humanDetail: detail }), /fine head layer/);

  const edit = { jaw: 0.7, noseLength: 0.5, height: 1.81 };
  const edited = changeHuman(form, edit), plainEdited = changeHuman(start, edit);
  assert.equal(edited.humanDetail, detail);
  assert.deepEqual(edited.human, plainEdited.human);
  const surface = (f) => evaluateHuman(f.human, f.humanFit, f.humanDetail);
  const before = surface(form), after = surface(edited), plainBefore = surface(start), plainAfter = surface(plainEdited);
  let effect = 0, gap = 0;
  for (let v = 0; v < before.bodyVertices; v++) {
    const mine = [0, 1, 2].map((d) => after.positions[v * 3 + d] - before.positions[v * 3 + d]);
    const plain = [0, 1, 2].map((d) => plainAfter.positions[v * 3 + d] - plainBefore.positions[v * 3 + d]);
    effect = Math.max(effect, Math.hypot(...plain));
    gap = Math.max(gap, Math.hypot(...mine.map((x, d) => x - plain[d])));
  }
  assert.ok(effect > 0.05);
  assert.ok(gap < 0.0015, "the layer changed what the controls do by " + gap * 1000 + " mm");
  assert.deepEqual(edited.parts.map((p) => p.id), form.parts.map((p) => p.id));

  const saved = JSON.stringify(edited), loaded = validateForm(JSON.parse(saved));
  assert.deepEqual(loaded.humanDetail, detail);
  assert.ok(farthest(surface(loaded).positions, after.positions) === 0);
  assert.deepEqual(Object.keys(loaded).filter((key) => !(key in start)), ["humanDetail"]);

  assert.deepEqual(form.humanDetail, detail);
  assert.ok(farthest(surface(form).positions, before.positions) === 0);
  const removed = { ...edited };
  delete removed.humanDetail;
  assert.ok(farthest(surface(validateForm(removed)).positions, plainAfter.positions) === 0);

  const body = brushBody(form);
  assert.ok(farthest(body.fitted.positions, before.positions) === 0);
  const nose = [...detail.vertices].sort((a, b) => before.positions[b * 3 + 2] - before.positions[a * 3 + 2])[0];
  const stroke = brushStroke(form, { vertices: [nose], point: Array.from(before.positions.subarray(nose * 3, nose * 3 + 3)) });
  const sculpted = stroke.form(stroke.vectors([0, 0, 0.004]));
  assert.equal(sculpted.humanDetail, detail);
  assert.ok(sculpted.humanFit.controls.length > 0);
  assert.ok(validateForm(sculpted));

  const component = extractComponent(form, "head");
  const placed = placeComponent(generatedHuman(32, "neutral"), component, { target: "head", mode: "replace", fit: false });
  const key = placed.form.parts.find((p) => p.id === placed.id).humanSource;
  assert.deepEqual(validateForm(placed.form).humanSources[key].humanDetail, detail);
});

function character(form) {
  const material = new T.MeshStandardMaterial(), root = new T.Group();
  const build = humanRegions(form, () => material, true, (s) => dressedHuman(s, form, () => material, true)), parts = new Map();
  for (const p of form.parts) {
    const g = build(p);
    g.position.fromArray(p.position);
    g.userData.partId = p.id;
    parts.set(p.id, g);
  }
  for (const p of form.parts) (parts.get(p.parent) ?? root).add(parts.get(p.id));
  return skinCharacter(form, root);
}
async function glb(rig) {
  globalThis.FileReader ??= class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  };
  const scene = new T.Scene();
  scene.add(...rig.actor.children);
  const bytes = await new GLTFExporter().parseAsync(scene, { binary: true, animations: rig.clips });
  const view = new DataView(bytes);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  return { size: bytes.byteLength, json: JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, view.getUint32(12, true)))) };
}

test("a head with a fine layer draws, dresses, animates and exports like any other", async () => {
  const start = generatedHuman(19, "neutral");
  start.outfit = "Work clothes";
  start.humanStyle = { hair: "Bun", outfit: "T-shirt and jeans" };
  const { detail } = sample(start.human), form = validateForm({ ...start, humanDetail: detail });
  const plain = character(start), made = character(form);
  const meshes = (rig) => rig.actor.children.filter((o) => o.isMesh);
  const shape = (rig) => meshes(rig).map((o) => [o.name, Object.keys(o.geometry.attributes).sort().join(),
    Object.keys(o.morphTargetDictionary ?? {}).length, [o.material].flat().length]);
  const sizes = (rig) => meshes(rig).flatMap((o) => [o.geometry.attributes.position.count, o.geometry.index?.count ?? 0]);
  assert.deepEqual(shape(made), shape(plain));
  sizes(made).forEach((n, i) => assert.ok(Math.abs(n - sizes(plain)[i]) <= 0.01 * sizes(plain)[i], "mesh size " + n + " against " + sizes(plain)[i]));
  assert.deepEqual(made.clips.map((c) => c.name), plain.clips.map((c) => c.name));
  assert.deepEqual(made.skeleton.bones.map((b) => b.name), plain.skeleton.bones.map((b) => b.name));
  for (let i = 0; i < made.skeleton.bones.length; i++) assert.ok(made.skeleton.bones[i].position.distanceTo(plain.skeleton.bones[i].position) < 1e-9);

  const material = new T.MeshStandardMaterial(), bare = humanRegions(start, () => material, true), layered = humanRegions(form, () => material, true);
  const moved = (part) => {
    const a = bare(part), b = layered(part);
    return Object.fromEntries(a.children.map((mesh, i) => {
      const p = mesh.geometry.attributes.position, q = b.children[i].geometry.attributes.position, all = [];
      assert.equal(p.count, q.count);
      for (let k = 0; k < p.count; k++) all.push(Math.hypot(p.getX(k) - q.getX(k), p.getY(k) - q.getY(k), p.getZ(k) - q.getZ(k)));
      return [mesh.name || "skin", [Math.min(...all), Math.max(...all)]];
    }));
  };
  for (const part of form.parts) {
    const change = moved(part);
    if (part.humanBone === "head") {
      assert.ok(change.skin[1] > 0.002 && change.skin[1] < 0.013, "head skin moved " + change.skin[1] * 1000 + " mm");
      assert.ok(change["high-poly"][0] > 0.0002 && change["high-poly"][1] < 0.013, JSON.stringify(change["high-poly"]));
      assert.ok(change["brows-and-lashes"][1] > 0.0005);
      assert.ok(change.teeth[1] > 0);
    } else if (/thigh|calf|foot|hand|pelvis|lowerarm/.test(part.humanBone))
      for (const [, most] of Object.values(change)) assert.equal(most, 0, part.humanBone);
  }
  const bound = (rig) => rig.actor.children.find((o) => o.name === "Character surface");
  const b = bound(made).geometry.attributes.position;
  for (let i = 0; i < b.count; i += 7) assert.ok(Number.isFinite(b.getX(i) + b.getY(i) + b.getZ(i)));
  const w = bound(made).geometry.attributes.skinWeight;
  for (let i = 0; i < w.count; i += 13) assert.ok(Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1) < 2e-4);
  const mixer = new T.AnimationMixer(made.actor);
  mixer.clipAction(made.clips.find((c) => c.name === "Reach")).play();
  mixer.setTime(0.6);
  made.actor.updateMatrixWorld(true);
  made.skeleton.update();
  const rest = new T.Vector3(), posed = new T.Vector3();
  let movement = 0;
  for (let i = 0; i < b.count; i += 19) {
    posed.copy(rest.fromBufferAttribute(b, i));
    bound(made).applyBoneTransform(i, posed);
    assert.ok(Number.isFinite(posed.x + posed.y + posed.z));
    movement = Math.max(movement, posed.distanceTo(rest));
  }
  assert.ok(movement > 0.07 && movement < 1.6);
  mixer.stopAllAction();

  const originalGroups = bound(plain).geometry.groups, fittedGroups = bound(made).geometry.groups;
  const before = await glb(plain), after = await glb(made);
  const outline = ({ json }) => ({
    meshes: json.meshes.map((m) => m.primitives.map((p) => [Object.keys(p.attributes).sort().join(), p.targets?.length ?? 0, p.material])),
    materials: json.materials.length, skins: json.skins.map((s) => s.joints.length), animations: json.animations.map((x) => x.name),
    nodes: json.nodes.length, accessors: json.accessors.map((x) => [x.type, x.componentType]),
  });
  assert.deepEqual(outline(after), outline(before));
  function surfaceIndices(groups, json) {
    const node = json.nodes.find((n) => n.name === "Character surface");
    return new Map(json.meshes[node.mesh].primitives.map((primitive, i) =>
      [primitive.indices, groups[i].count]));
  }
  const originalIndices = surfaceIndices(originalGroups, before.json), fittedIndices = surfaceIndices(fittedGroups, after.json);
  after.json.accessors.forEach((accessor, i) => {
    if (fittedIndices.has(i)) {
      assert.equal(before.json.accessors[i].count, originalIndices.get(i));
      assert.equal(accessor.count, fittedIndices.get(i));
    } else {
      const oldCount = before.json.accessors[i].count;
      assert.ok(Math.abs(accessor.count - oldCount) <= 0.01 * oldCount, "accessor " + i + ": " + oldCount + " to " + accessor.count);
    }
  });
  assert.ok(!/humanDetail|humanFit|neutral|reference/i.test(JSON.stringify(after.json)));
  assert.ok(Math.abs(after.size - before.size) < 0.02 * before.size);
  plain.dispose();
  made.dispose();
});

test("an ordinary reference fit after a fine layer fits the skin as drawn and keeps the layer", () => {
  const start = generatedHuman(23, "neutral"), { detail } = sample(start.human);
  const form = { ...start, humanDetail: detail };
  const reference = (surface) => {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(surface.positions.slice(0, surface.bodyVertices * 3), 3));
    geometry.setIndex(new T.BufferAttribute(Uint32Array.from(surface.indices.subarray(0, surface.bodyTriangles * 3)), 1));
    return geometry;
  };
  const head = (s, v) => s.names[s.boneIndices[v * 4]] === "head";
  const farHead = (a, b) => {
    let most = 0;
    for (let v = 0; v < a.bodyVertices; v++)
      if (head(a, v)) most = Math.max(most, Math.hypot(...[0, 1, 2].map((k) => a.positions[v * 3 + k] - b.positions[v * 3 + k])));
    return most;
  };
  const before = evaluateHuman(form.human, form.humanFit, detail);

  let geometry = reference(before);
  const face = fitHumanReference(form, geometry, { region: "head" });
  assert.ok(face.metrics.before.meanMm < 0.05, "head before " + face.metrics.before.meanMm);
  const afterFace = evaluateHuman(form.human, face.fit, detail);
  assert.ok(farHead(afterFace, before) < 0.0003, "head moved " + farHead(afterFace, before) * 1000 + " mm");
  const blind = fitHumanReference({ ...start }, geometry, { region: "head" });
  assert.ok(blind.metrics.before.meanMm > 10 * Math.max(face.metrics.before.meanMm, 0.02));

  const shoulders = start.human.shoulders ?? 0;
  geometry = reference(evaluateHuman({ ...start.human, shoulders: shoulders + (shoulders > 0.3 ? -0.5 : 0.5) }, undefined, detail));
  const whole = fitHumanReference(form, geometry);
  assert.ok(whole.metrics.after.meanMm < 0.6 * whole.metrics.before.meanMm, JSON.stringify([whole.metrics.before, whole.metrics.after]));
  const next = { ...form, humanFit: whole.fit };
  assert.equal(next.humanDetail, detail);
  assert.ok(validateForm(next).humanDetail);
  assert.ok(farHead(evaluateHuman(next.human, next.humanFit, detail), before) < 0.0015);
  const coarse = optimizeHumanMeasurements(form, geometry);
  assert.equal(coarse.form.humanDetail, detail);
  assert.ok(coarse.metrics.after.meanMm <= coarse.metrics.before.meanMm);
});
