import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { humanRegions } from "./human-mesh.js";
import { humanForm } from "./human-form.js";
import { validateForm } from "./recipe.js";
import { defaultEyeColor, eyeColorNames } from "./human-face.js";

function head(form, plain = false) {
  const build = humanRegions(form, (color) => new T.MeshStandardMaterial({ color }), plain);
  return build(form.parts.find((part) => part.humanBone === "head"));
}
const adult = (shape = {}, seed = 404) => humanForm({ stance: 0.76, ...shape }, seed);

test("eyes, brows and lashes keep the head's expression and gaze targets", () => {
  for (const plain of [false, true]) {
    const group = head(adult({ frame: 0.9, age: 0.4 }), plain);
    const [skin, eyes, hair] = group.children;
    assert.deepEqual(Object.keys(skin.morphTargetDictionary), ["Blink", "Smile", "BrowLift"]);
    assert.equal(eyes.userData.eyePiece, "Iris");
    assert.deepEqual(
      eyes.geometry.morphAttributes.position.map((a) => a.name),
      ["LookLeft", "LookRight", "LookUp", "LookDown"],
    );
    assert.deepEqual(Object.keys(hair.morphTargetDictionary), ["Blink", "Smile", "BrowLift"]);
    assert.equal(hair.material.userData.fibreLOD, true);
    assert.equal(Boolean(hair.geometry.attributes.color), !plain);
    for (const mesh of [eyes, hair])
      for (const value of mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
  }
});

test("lashes grow from the lid margin and follow a blink", () => {
  const group = head(adult({ frame: -0.8 })),
    [, eyes, hair] = group.children;
  const position = hair.geometry.attributes.position,
    blink = hair.geometry.morphAttributes.position[0],
    lift = hair.geometry.morphAttributes.position[2];
  // The balls the eyes turn on: both at one height, their fronts ahead of their centres.
  const [ball] = eyes.eyeFits;
  const eyeLine = ball.centre.y,
    eyeHeight = 2 * ball.ball;
  let lashes = 0,
    closing = 0,
    brows = 0,
    lifted = 0;
  for (const i of new Set(hair.geometry.index.array)) {
    const y = position.getY(i);
    if (i < hair.geometry.userData.browVertices) {
      brows++;
      assert.ok(y > eyeLine, "brows sit above the eye");
      if (lift.getY(i) > 0.0005) lifted++;
      continue;
    }
    // Every lash stays within a lash length of the eye opening and in front of the ball's centre.
    assert.ok(Math.abs(y - eyeLine) < 0.5 * eyeHeight);
    assert.ok(position.getZ(i) > ball.centre.z);
    if (y > eyeLine + 0.03 * eyeHeight) {
      lashes++;
      if (blink.getY(i) < -0.001) closing++;
    }
  }
  assert.ok(lashes > 300 && brows > 300);
  assert.ok(closing > 0.7 * lashes, "upper lashes travel down with the lid");
  assert.ok(lifted > 0.5 * brows, "brow hairs rise with the brow");
});

test("default iris colours follow skin tone and every listed colour is a valid choice", () => {
  const draws = (skin) => {
    const count = {};
    for (let seed = 0; seed < 400; seed++) {
      const name = defaultEyeColor({ origin: { seed }, appearance: { skin } });
      count[name] = (count[name] ?? 0) + 1;
    }
    return count;
  };
  const deep = draws("#4a2f22"),
    fair = draws("#e8c4ad");
  assert.ok((deep["dark brown"] ?? 0) + (deep.brown ?? 0) > 300);
  assert.ok((deep.blue ?? 0) < 12);
  assert.ok((fair.blue ?? 0) + (fair.green ?? 0) + (fair.grey ?? 0) > 80);
  const form = adult();
  for (const eyeColor of eyeColorNames) validateForm({ ...form, eyeColor });
  assert.throws(() => validateForm({ ...form, eyeColor: "violet" }));
});

test("the eyebrow choice survives a form round trip and fits distinct strands to the head", () => {
  const form = adult({ brow: .35 });
  const styles = ["Straight", "Full and brushed", "Fine arch", "Feathered", "Untrimmed"];
  const counts = new Set();
  for (const browStyle of styles) {
    const reopened = JSON.parse(JSON.stringify({ ...form, humanStyle: { browStyle } }));
    validateForm(reopened);
    const group = head(reopened, true);
    const strandCount = group.children[2].geometry.userData.browVertices;
    assert.ok(strandCount > 0);
    counts.add(strandCount);
  }
  assert.ok(counts.size >= 4);
});
