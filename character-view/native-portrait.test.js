import test from "node:test";
import assert from "node:assert/strict";
import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import { evaluateHuman } from "./human-surface.js";
import { portraitTargets } from "./native-portrait.js";
import { humanForm } from "./human-form.js";
import { photoDetail, photoDetailNames } from "./human-photo-detail.js";
import { makeBrief, readProposal, validateForm } from "./recipe.js";

const id = "nativeportrait-" + "a".repeat(64);

test("a prepared portrait can be applied by a proposal without changing the head or eyes", () => {
  const form = humanForm({ nose: .22, frame: -.5 }, 491);
  form.eyeColor = "amber";
  form.artwork = { [id]: "data:image/webp;base64,AAAA" };
  const brief = makeBrief(form, "portrait", null, {}, "Use the prepared portrait.");
  assert.deepEqual(brief.humanPortraitLayers, [id]);
  const next = readProposal({
    format: "irudd.form-proposal.v1",
    requestId: brief.requestId,
    revision: "portrait",
    summary: "Apply prepared portrait",
    operations: [{ op: "setPart", id: "head", set: { nativePortrait: id } }],
  }, brief, "portrait").form;
  assert.deepEqual(next.human, form.human);
  assert.equal(next.eyeColor, form.eyeColor);
  const head = form.parts.find(part => part.id === "head");
  assert.deepEqual(next.parts.find(part => part.id === "head"), { ...head, nativePortrait: id });
  assert.throws(() => validateForm({ ...next, artwork: {} }), /Invalid native human portrait/);
});

test("photo detail choices replay and vary across consecutive seeds", () => {
  const form = humanForm({}, 8711);
  const points = [[.13, .67], [.27, .42], [.50, .50], [.82, .19]];
  const values = sample => points.map(point => sample(...point));
  for (const complexion of photoDetailNames) {
    validateForm({ ...form, complexion });
    const first = values(photoDetail(complexion, 8711));
    assert.deepEqual(values(photoDetail(complexion, 8711)), first);
    assert.notDeepEqual(values(photoDetail(complexion, 8712)), first);
  }
  assert.equal(photoDetail("Smooth", 8711), null);
});

test("front and profile paint registration follow the middle of the mouth and the edited chin", () => {
  for (const params of [{}, { frame: -.8, lipFullness: .8, chinHeight: .9, chin: .6 }]) {
    const surface = evaluateHuman(params);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(surface.positions, 3));
    const { mouth, chin, eyes } = portraitTargets(geometry, surface, new Vector3());
    const upper = new Vector3().fromArray(surface.positions, 474*3);
    const lower = new Vector3().fromArray(surface.positions, 523*3);
    assert.ok(mouth.distanceTo(upper.lerp(lower, .5)) < 1e-6);
    assert.ok(Math.abs(mouth.x - (eyes[0].x + eyes[1].x)/2) < .004);
    assert.ok(chin.y < mouth.y && Math.abs(chin.x - mouth.x) < .004);
    geometry.dispose();
  }
});
