import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { humanRegions } from "./human-mesh.js";
import { generatedHuman, humanForm } from "./human-form.js";
import { lidFollow } from "./human-lid-follow.js";

function head(form, plain = false) {
  const build = humanRegions(form, (color) => new T.MeshStandardMaterial({ color }), plain);
  return build(form.parts.find((part) => part.humanBone === "head"));
}
const people = () => [
  humanForm({ stance: 0.76 }, 404),
  humanForm({ stance: 0.76, frame: 0.9, age: 0.7 }, 404),
  generatedHuman(8734),
];
const mm = (form) => (0.001 * (form.human.height ?? 1.72)) / 1.72;
const named = (mesh, name) => mesh.geometry.morphAttributes.position[mesh.morphTargetDictionary[name]];

test("the lids carry their share of a look up or down beside the expressions", () => {
  for (const form of people()) {
    const group = head(form),
      skin = group.children.find((mesh) => mesh.userData.faceSurface),
      lashes = group.children.find((mesh) => mesh.name === "brows-and-lashes"),
      unit = mm(form);
    for (const mesh of [skin, lashes]) {
      const morphs = mesh.geometry.morphAttributes;
      assert.deepEqual(Object.keys(mesh.morphTargetDictionary), ["Blink", "Smile", "BrowLift", "LookUp", "LookDown"]);
      assert.equal(mesh.morphTargetInfluences.length, 5);
      assert.ok(mesh.morphTargetInfluences.every((value) => value === 0));
      assert.ok(morphs.position.every((target) => target.count === mesh.geometry.attributes.position.count));
      if (morphs.normal) assert.equal(morphs.normal.length, morphs.position.length);
      const up = named(mesh, "LookUp").array,
        down = named(mesh, "LookDown").array;
      let most = 0,
        moved = 0;
      for (let i = 0; i < up.length; i += 3) {
        assert.equal(up[i], 0);
        assert.ok(up[i + 1] >= 0 && down[i + 1] <= 0);
        assert.ok(Math.abs(up[i + 1] * lidFollow.down + down[i + 1] * lidFollow.up) < 1e-9);
        most = Math.max(most, up[i + 1]);
        if (up[i + 1]) moved++;
      }
      assert.ok(Math.abs(most - lidFollow.up * unit) < 1e-6 * unit, `${mesh.name} travels ${most / unit} mm`);
      assert.ok(moved > 50 && moved < up.length / 3, `${moved} points move`);
    }
  }
});

test("the upper and lower lid travel together and the corners hold still", () => {
  const form = people()[0],
    group = head(form),
    skin = group.children.find((mesh) => mesh.userData.faceSurface),
    eyes = group.children.find((mesh) => mesh.userData.eyePiece),
    unit = mm(form),
    p = skin.geometry.attributes.position,
    up = named(skin, "LookUp").array;
  for (const fit of eyes.eyeFits) {
    const { centre, side, opening } = fit,
      middle = (opening.inner + opening.outer) / 2,
      [bottom, top] = opening.at(middle);
    let upper = null,
      lower = null,
      corner = 0;
    for (let i = 0; i < p.count; i++) {
      const a = side * (p.getX(i) - centre.x),
        h = p.getY(i) - centre.y;
      if (side * p.getX(i) < 0 || p.getZ(i) < centre.z || Math.abs(h) > 12 * unit) continue;
      if (Math.abs(a - middle) < 1.5 * unit) {
        if (Math.abs(h - top) < 0.5 * unit) upper = up[i * 3 + 1];
        if (Math.abs(h - bottom) < 0.5 * unit) lower = up[i * 3 + 1];
      }
      if (a < opening.inner || a > opening.outer) corner = Math.max(corner, up[i * 3 + 1]);
    }
    assert.ok(upper !== null && lower !== null);
    assert.ok(Math.abs(upper - lower) < 1e-6 * unit && Math.abs(upper - lidFollow.up * unit) < 1e-6 * unit);
    assert.equal(corner, 0);
  }
});

test("the wet line on the eye goes with the lower lid and the rest of the eye turns as before", () => {
  const form = people()[0],
    eyes = head(form).children.find((mesh) => mesh.userData.eyePiece),
    unit = mm(form);
  assert.deepEqual(Object.keys(eyes.morphTargetDictionary), ["LookLeft", "LookRight", "LookUp", "LookDown"]);
  const uv = eyes.geometry.attributes.uv,
    up = named(eyes, "LookUp").array;
  let line = 0,
    strip = 0;
  for (let i = 0; i < uv.count; i++) {
    const wet = Math.abs(uv.getY(i) - 0.94) < 1e-4,
      moved = Math.hypot(up[i * 3], up[i * 3 + 1], up[i * 3 + 2]);
    if (wet) line = Math.max(line, up[i * 3 + 1]);
    else if (moved && moved < 0.2 * unit) strip++;
  }
  assert.ok(line > 0.5 * lidFollow.up * unit && line <= lidFollow.up * unit + 1e-9, `wet line rises ${line / unit} mm`);
  assert.equal(strip, 0);
});

test("a plain head builds without the lid targets failing", () => {
  assert.ok(head(people()[0], true).children.length > 0);
});
