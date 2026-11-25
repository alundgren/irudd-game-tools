import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {
  applyHumanControls,
  evaluateHuman,
  humanControls,
  smoothHumanSurface,
} from "./human-surface.js";
import { humanForm } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { validateForm } from "./recipe.js";
import { brushBody, brushStroke, skinDistances } from "./human-brush.js";

const region = (name) =>
  name === "head" || name.startsWith("neck")
    ? "head"
    : /thigh|calf|foot|ball/.test(name)
      ? "legs"
      : /arm|hand|thumb|index|middle|ring|pinky/.test(name)
        ? "arms"
        : "trunk";
function regions(surface) {
  return Array.from({ length: surface.bodyVertices }, (_, v) => {
    let best = v * 4;
    for (let j = best + 1; j < v * 4 + 4; j++)
      if (surface.weights[j] > surface.weights[best]) best = j;
    return region(surface.names[surface.boneIndices[best]]);
  });
}
const at = (surface, v) => Array.from(surface.positions.subarray(v * 3, v * 3 + 3));
function nearest(surface, point, keep = () => true) {
  let best = -1,
    gap = Infinity;
  for (let v = 0; v < surface.bodyVertices; v++) {
    if (!keep(v)) continue;
    const d = Math.hypot(...at(surface, v).map((x, i) => x - point[i]));
    if (d < gap) {
      gap = d;
      best = v;
    }
  }
  return best;
}
// Largest movement in millimetres of the kept cage vertices between two cages.
function moved(a, b, keep) {
  let most = 0;
  for (let v = 0; v < a.bodyVertices; v++)
    if (keep(v))
      most = Math.max(most, 1000 * Math.hypot(...at(a, v).map((x, i) => x - b.positions[v * 3 + i])));
  return most;
}
const touchAt = (surface, vertex) => ({ vertices: [vertex], point: at(surface, vertex) });

test("a touch on the ribs spreads along the skin and leaves the hanging arm alone", () => {
  const form = humanForm({ stance: 1, weight: 0.5 }, 3),
    body = brushBody(form),
    parts = regions(body.fitted),
    controls = humanControls();
  // The outermost trunk vertex below the armpit sits beside the resting upper arm.
  let ribs = -1;
  for (let v = 0; v < body.fitted.bodyVertices; v++) {
    const [x, y] = at(body.fitted, v);
    if (parts[v] === "trunk" && y > 1.1 && y < 1.2 && (ribs < 0 || x > at(body.fitted, ribs)[0])) ribs = v;
  }
  const point = at(body.fitted, ribs),
    stroke = brushStroke(form, touchAt(body.fitted, ribs), { reach: 0.09 });
  // Coarse trunk anchors widen the brush; a ball of that size reaches into the arm.
  assert.ok(stroke.used >= 0.09 && stroke.used < 0.16, "brush settled on " + stroke.used);
  const armAnchors = [];
  controls.ids.forEach((v, i) => {
    if (parts[v] === "arms" && Math.hypot(...at(body.fitted, v).map((x, d) => x - point[d])) < stroke.used)
      armAnchors.push(i);
  });
  assert.ok(armAnchors.length > 3, "a ball of this size would hold arm anchors: " + armAnchors.length);
  assert.ok(armAnchors.every((i) => stroke.primary[i] === 0));
  const field = skinDistances(body.fitted, [{ vertex: ribs, distance: 0 }], 0.09);
  assert.ok(field.size > 20 && [...field.keys()].every((v) => parts[v] === "trunk"));
  const after = applyHumanControls(body.bare, stroke.vectors([0.02, 0, 0]));
  // The arm from 5 cm above the touch down hangs beside it; the armpit above is joined skin.
  const hanging = (v) => parts[v] === "arms" && at(body.fitted, v)[1] < point[1] + 0.05;
  const here = moved(after, body.fitted, (v) => v === ribs),
    armpit = moved(after, body.fitted, (v) => parts[v] === "arms"),
    beside = moved(after, body.fitted, hanging),
    legs = moved(after, body.fitted, (v) => parts[v] === "legs"),
    head = moved(after, body.fitted, (v) => parts[v] === "head");
  assert.ok(here > 12 && here <= 20.05, "touched skin moved " + here.toFixed(1) + " mm");
  assert.equal(beside + legs + head, 0);
  assert.ok(armpit < 1.5, "armpit skin moved " + armpit.toFixed(2) + " mm");
  // One drag is held to a share of the brush size.
  const far = applyHumanControls(body.bare, stroke.vectors([0.2, 0, 0]));
  assert.ok(Math.abs(moved(far, body.fitted, () => true) - stroke.limit * 1000) < 0.5);
});

test("touched skin keeps up with the pointer on dense and on coarse anchors", () => {
  const form = humanForm({}, 1),
    body = brushBody(form),
    parts = regions(body.fitted);
  for (const [name, point, reach] of [
    ["cheek", [0.05, 1.56, 0.08], 0.03],
    ["chin", [0, 1.49, 0.09], 0.03],
    ["belly", [0.07, 1.02, 0.1], 0.03],
    ["thigh", [0.14, 0.7, 0.08], 0.05],
  ]) {
    const vertex = nearest(body.fitted, point, (v) => parts[v] !== "arms");
    const stroke = brushStroke(form, touchAt(body.fitted, vertex), { reach });
    const after = applyHumanControls(body.bare, stroke.vectors([0, 0, 0.01]));
    const here = moved(after, body.fitted, (v) => v === vertex);
    const most = moved(after, body.fitted, () => true);
    assert.ok(here > 5.5 && most < 10.05, name + " followed a 10 mm drag by " + here.toFixed(1) + " of " + most.toFixed(1) + " mm");
  }
});

test("a mirrored stroke shapes both sides alike and cancels sideways motion on the midline", () => {
  const form = humanForm({}, 1),
    body = brushBody(form);
  const cheek = nearest(body.fitted, [0.05, 1.56, 0.08]),
    stroke = brushStroke(form, touchAt(body.fitted, cheek), { reach: 0.04, mirror: true });
  const after = applyHumanControls(body.bare, stroke.vectors([0.008, 0.002, 0.004]));
  const sums = { left: [0, 0, 0], right: [0, 0, 0] };
  for (let v = 0; v < after.bodyVertices; v++) {
    const side = at(body.fitted, v)[0] > 0 ? sums.left : sums.right;
    at(after, v).forEach((x, i) => (side[i] += x - body.fitted.positions[v * 3 + i]));
  }
  assert.ok(sums.left[0] > 0.01 && Math.abs(sums.left[0] + sums.right[0]) < 0.06 * sums.left[0]);
  for (const d of [1, 2])
    assert.ok(Math.abs(sums.left[d] - sums.right[d]) < 0.06 * Math.abs(sums.left[d]));
  const chin = nearest(body.fitted, [0, 1.49, 0.09]),
    centred = brushStroke(form, touchAt(body.fitted, chin), { reach: 0.04, mirror: true });
  const pushed = applyHumanControls(body.bare, centred.vectors([0.01, 0, 0.01]));
  const [x, , z] = at(pushed, chin).map((value, i) => value - body.fitted.positions[chin * 3 + i]);
  assert.ok(Math.abs(x) < 0.0008 && z > 0.006, "chin moved " + x + ", " + z);
});

test("strokes stay an ordinary recipe: bounded, added to a reference fit, softened or removed", () => {
  const base = humanForm({ height: 1.9 }, 5),
    fitted = { ...base, humanFit: { version: 1, strength: 0.5, controls: [[0, 40, 0, 0], [7, 0, -60, 20]] } };
  validateForm(fitted);
  const body = brushBody(fitted),
    belly = nearest(body.fitted, [0.07, 1.13, 0.11]),
    touch = touchAt(body.fitted, belly);
  const stroke = brushStroke(fitted, touch, { reach: 0.08, mirror: true });
  const next = stroke.form(stroke.vectors([0, 0, 0.5]));
  validateForm(next);
  const rows = new Map(next.humanFit.controls.map(([i, ...row]) => [i, row]));
  assert.equal(next.humanFit.strength, 1);
  assert.ok(Math.max(...[...rows.values()].map((row) => Math.hypot(...row))) <= 651);
  // Anchors outside the brush keep the earlier fit at its stored strength.
  for (const [i, ...row] of fitted.humanFit.controls)
    if (!stroke.primary[i] && !stroke.twin[i]) assert.deepEqual(rows.get(i), row.map((x) => x / 2));
  assert.ok(rows.size > 4 && stroke.changes(stroke.vectors([0, 0, 0.5])));
  assert.equal(next.human, fitted.human);
  assert.equal(next.parts, fitted.parts);

  const again = brushStroke(next, touch, { reach: 0.08, mirror: true });
  const eased = again.vectors(1, "soften"),
    peak = again.primary.indexOf(Math.max(...again.primary));
  assert.ok(Math.hypot(...eased.subarray(peak * 3, peak * 3 + 3)) < 1e-6);
  assert.ok(again.changes(eased));
  const plain = brushStroke(base, touch, { reach: 0.08 });
  assert.equal(plain.changes(plain.vectors(1, "soften")), false);
  assert.equal("humanFit" in plain.form(plain.vectors(1, "soften")), false);
});

test("drawn skin names the cage quad beneath every face", () => {
  const form = humanForm({}, 2),
    cage = evaluateHuman(form.human),
    smooth = smoothHumanSurface(cage),
    material = () => new T.MeshStandardMaterial(),
    build = humanRegions(form, material, true);
  for (const id of ["head", "left forearm"]) {
    const part = form.parts.find((p) => p.id === id),
      mesh = build(part).children.find((child) => child.humanSkin),
      tag = mesh.humanSkin,
      position = mesh.geometry.attributes.position;
    assert.equal(tag.faces.length, mesh.geometry.index.count);
    assert.equal(tag.vertices.length, position.count);
    for (const face of [0, 17, tag.faces.length / 3 - 1]) {
      const quad = smooth.parentFaces[tag.faces[face * 3] / 3],
        corner = new T.Vector3().fromBufferAttribute(position, mesh.geometry.index.getX(face * 3));
      corner.add(new T.Vector3(...tag.origin));
      const gaps = Array.from(smooth.quadIds.subarray(quad * 4, quad * 4 + 4), (v) =>
        corner.distanceTo(new T.Vector3(...at(cage, v))),
      );
      assert.ok(Math.max(...gaps) < 0.06, "face lies on its quad: " + gaps.map((g) => g.toFixed(3)));
    }
  }
});
