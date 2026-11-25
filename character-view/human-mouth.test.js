import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { humanRegions } from "./human-mesh.js";
import { humanForm } from "./human-form.js";
import { mouthLining } from "./human-mouth.js";

function head(form, plain = false) {
  const build = humanRegions(form, (color) => new T.MeshStandardMaterial({ color }), plain);
  return build(form.parts.find((part) => part.humanBone === "head"));
}
const adult = (shape = {}, seed = 404) => humanForm({ stance: 0.76, ...shape }, seed);

test("the mouth lining is a shallow pocket that opens with a smile", () => {
  for (const [shape, seed] of [
    [{ frame: -0.8 }, 77],
    [{ frame: 0.9, jaw: 0.7, height: 1.92 }, 404],
  ]) {
    const skin = head(adult(shape, seed)).children.find((mesh) => mesh.userData.faceSurface),
      g = skin.geometry,
      p = g.attributes.position,
      lining = mouthLining(g);
    const smile = g.morphAttributes.position[skin.morphTargetDictionary.Smile];
    const count = lining.reduce((sum, flag) => sum + flag, 0);
    assert.ok(count > 1000 && count < 0.15 * p.count, "the lining is a small part of the head");
    // Lips are the skin vertices that share a position with the lining.
    const key = (i) => [p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v * 2e5)).join("/");
    const lips = new Set();
    for (let i = 0; i < p.count; i++) if (!lining[i]) lips.add(key(i));
    let front = -Infinity,
      back = Infinity,
      top = -Infinity,
      bottom = Infinity,
      smileTop = -Infinity,
      smileBottom = Infinity,
      width = 0;
    for (let i = 0; i < p.count; i++) {
      if (!lining[i]) continue;
      for (const value of [p.getX(i), p.getY(i), p.getZ(i), smile.getX(i), smile.getY(i), smile.getZ(i)])
        assert.ok(Number.isFinite(value));
      back = Math.min(back, p.getZ(i));
      width = Math.max(width, Math.abs(p.getX(i)));
      if (!lips.has(key(i)) || Math.abs(p.getX(i)) > 0.004) continue;
      front = Math.max(front, p.getZ(i));
      top = Math.max(top, p.getY(i));
      bottom = Math.min(bottom, p.getY(i));
      smileTop = Math.max(smileTop, p.getY(i) + smile.getY(i));
      smileBottom = Math.min(smileBottom, p.getY(i) + smile.getY(i));
    }
    const scale = (shape.height ?? 1.72) / 1.72;
    assert.ok(front - back < 0.03 * scale, "the pocket ends within 3 cm of the front of the lips");
    assert.ok(width < 0.03 * scale, "the pocket stays between the corners of the mouth");
    assert.ok(smileTop - smileBottom > top - bottom + 0.003, "a smile parts the lips");
  }
});

test("teeth stand inside the mouth as their own mesh and slide into a smile", () => {
  for (const plain of [false, true]) {
    const group = head(adult({ frame: 0.4 }), plain),
      skin = group.children.find((mesh) => mesh.userData.faceSurface),
      teeth = group.children.find((mesh) => mesh.name === "teeth");
    assert.ok(teeth, "the head has teeth");
    assert.equal(teeth.userData.faceSurface, undefined);
    assert.deepEqual(Object.keys(teeth.morphTargetDictionary), ["Blink", "Smile", "BrowLift"]);
    const [blink, smile, lift] = teeth.geometry.morphAttributes.position;
    let still = 0,
      slid = 0;
    for (let i = 0; i < smile.count; i++) {
      still = Math.max(still, Math.abs(blink.getY(i)), Math.abs(lift.getY(i)));
      slid = Math.min(slid, smile.getY(i));
      assert.equal(smile.getX(i), 0);
    }
    assert.ok(still < 2e-4, "teeth stay put when the eyes and brows move");
    assert.ok(slid < -0.002 && slid > -0.007, "the upper row comes down into a smile");
    assert.equal(teeth.material.userData.fibreLOD, true);
    assert.equal(teeth.material.side, T.FrontSide);
    assert.equal(Boolean(teeth.geometry.attributes.color), !plain);
    assert.ok(teeth.geometry.index.count / 3 <= 700);
    const p = teeth.geometry.attributes.position,
      box = new T.Box3().setFromBufferAttribute(p),
      head3 = new T.Box3().setFromBufferAttribute(skin.geometry.attributes.position);
    for (const value of p.array) assert.ok(Number.isFinite(value));
    // Behind the face, below the nose and narrower than the head.
    assert.ok(box.max.z < head3.max.z - 0.012 && box.min.z > head3.max.z - 0.06);
    assert.ok(box.max.x - box.min.x < 0.45 * (head3.max.x - head3.min.x));
    assert.ok(Math.abs(box.max.x + box.min.x) < 1e-6, "the two sides match");
    assert.ok(box.max.y - box.min.y < 0.03);
  }
});

test("the head skin keeps its vertices and triangles", () => {
  const skin = head(adult()).children.find((mesh) => mesh.userData.faceSurface);
  assert.equal(skin.geometry.attributes.position.count, skin.humanSkin.vertices.length);
  assert.equal(skin.geometry.index.count, skin.humanSkin.faces.length);
  const normal = skin.geometry.attributes.normal;
  for (let i = 0; i < normal.count; i++)
    assert.ok(Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) < 1e-3);
});
