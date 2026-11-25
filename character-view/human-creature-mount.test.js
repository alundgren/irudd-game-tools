import test from "node:test";
import assert from "node:assert/strict";
import { attachCreatureLimbs } from "./human-creature-mount.js";
import { scapulaSocket } from "./human-sockets.js";
import { extractComponent, placeComponent } from "./graft.js";
import { changeHuman, generatedHuman } from "./human-form.js";
import { evaluateHuman } from "./human-surface.js";
import { dressHuman } from "./human-wardrobe.js";
import { makeBrief, readProposal, validateForm } from "./recipe.js";

test("paired wings preserve the adult and reseat after a body edit", () => {
  const adult = dressHuman(generatedHuman(8715), 8715);
  adult.parts.find(p => p.id === "right hand").rotation = [4, 9, 0];
  const saved = structuredClone(adult);
  const brief = makeBrief(adult, "wing", null, {}, "Give the scout feathered wings.");
  const reply = {
    format: "irudd.form-proposal.v1", requestId: brief.requestId, revision: "wing",
    summary: "Paired feathered wings", operations: [{ op: "attachCreatureLimbs" }],
  };
  const form = readProposal(reply, brief, "wing").form;
  assert.deepEqual(form, readProposal(reply, brief, "wing").form);
  assert.deepEqual(adult, saved);
  assert.deepEqual(form.parts.slice(0, adult.parts.length), adult.parts);
  assert.deepEqual(form.human, adult.human);
  assert.deepEqual(form.humanStyle, adult.humanStyle);
  const roots = form.parts.filter(p => p.scapulaMount);
  assert.equal(roots.length, 2);
  assert.ok(roots.every(p => p.parent === "chest" && p.knots.length >= 3));
  const moved = validateForm(changeHuman(form, { weight: .97, chest: 1, shoulders: 1 }));
  const surface = evaluateHuman(moved.human, moved.humanFit);
  for (const root of roots) {
    const fresh = moved.parts.find(p => p.id === root.id);
    assert.deepEqual(fresh.knots, root.knots);
    assert.deepEqual(fresh.position, scapulaSocket(surface, root.scapulaMount));
    assert.ok(Math.hypot(...root.position.map((x, i) => x - fresh.position[i])) > .01);
  }
  assert.deepEqual(moved.parts.find(p => p.id === "right hand").rotation, [4, 9, 0]);
});

test("wing branches transfer onto another build and support each structure", () => {
  const adult = dressHuman(generatedHuman(8710), 8710);
  const donor = dressHuman(generatedHuman(8715), 8715);
  for (const structure of ["feather", "bat", "insect"]) {
    const source = attachCreatureLimbs(donor, { wing: { structure } });
    source.parts.find(p => p.shape === "wing").wing.pattern = "eyespot";
    let form = adult;
    for (const root of source.parts.filter(p => p.scapulaMount)) {
      const component = extractComponent(source, root.id);
      const placed = placeComponent(form, component, { target: "chest", mode: "attach" });
      form = validateForm(placed.form);
      const attached = form.parts.find(p => p.id === placed.id);
      assert.deepEqual(attached.position, scapulaSocket(evaluateHuman(form.human), root.scapulaMount));
      assert.deepEqual(attached.knots, root.knots);
      assert.deepEqual(attached.size, root.size);
    }
    for (const p of form.parts.filter(p => p.scapulaMount))
      assert.equal(Math.sign(p.position[0]), p.scapulaMount);
    assert.deepEqual(form.parts.filter(p => p.shape === "wing").map(p => p.wing.structure), [structure, structure]);
    assert.equal(form.parts.find(p => p.shape === "wing").wing.pattern, "eyespot");
  }
});
