import test from "node:test";
import assert from "node:assert/strict";
import { Color, Object3D, Vector3 } from "three";
import { limbPigments } from "./creature-limb-colour.js";

test("the knee has the same pigment on both adjoining regions, with or without the fade to a darker end", () => {
  const ids = [
    "left leg 1 thigh",
    "left leg 1 shin",
    "left leg 1 foot",
    "left leg 1 claw 1",
    "gear bag",
  ];
  const form = {
    origin: { plan: { skin: { base: "#814863", socks: 0.8, limbFade: true } } },
    parts: ids.map((id, i) => ({
      id,
      motionRole: ["thigh", "shin", "foot", "rigid", "rigid"][i],
    })),
  };
  const objects = new Map(
    ids.map((id, i) => {
      const o = new Object3D();
      o.position.set(0.15, 1 - 0.42 * i, 0);
      return [id, o];
    }),
  );
  const field = limbPigments(form, objects);
  assert.deepEqual([...field.keys()], ids.slice(0, 3));
  const evalAt = (id, y) => {
    const c = new Color("#814863");
    field.get(id)(c, new Vector3(0.16, y, 0));
    return c;
  };
  assert.deepEqual(evalAt(ids[0], 0.58), evalAt(ids[1], 0.58));
  assert.ok(evalAt(ids[0], 0.93).r > evalAt(ids[1], 0.58).r);
  assert.ok(evalAt(ids[1], 0.58).r > evalAt(ids[2], 0.16).r);
  // Without the fade the anatomical layers remain: the same three regions, one
  // pigment on both sides of the knee, a darker crease there and the body's
  // own colour high on the thigh.
  form.origin.plan.skin.limbFade = false;
  const plain = limbPigments(form, objects);
  assert.deepEqual([...plain.keys()], ids.slice(0, 3));
  const plainAt = (id, y) => {
    const c = new Color("#814863");
    plain.get(id)(c, new Vector3(0.16, y, 0));
    return c;
  };
  assert.deepEqual(plainAt(ids[0], 0.58), plainAt(ids[1], 0.58));
  assert.ok(Math.abs(plainAt(ids[0], 0.93).r - new Color("#814863").r) < 0.01);
  assert.ok(plainAt(ids[1], 0.58).r < plainAt(ids[0], 0.93).r);
  assert.ok(plainAt(ids[2], 0.16).r > 0.5 * new Color("#814863").r);
});
