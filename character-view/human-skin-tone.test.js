import assert from "node:assert/strict";
import test from "node:test";
import * as T from "three";
import complexion from "./human-complexion-data.json" with { type: "json" };
import tone from "./human-skin-tone-data.json" with { type: "json" };
import { complexionProfile, detailEncoding, detailTint } from "./human-complexion.js";
import { generatedHuman, tintHumanSkin } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { evaluateHuman, smoothHumanSurface } from "./human-surface.js";
import { skinShade, toneEncoding } from "./human-skin-tone.js";

const skins = { fair: "#e8cdb8", tanned: "#b07a52", deep: "#4a2c1e", lilac: "#ad87b2", bright: "#3fd0c8" };

test("the detail maps are packed the way the face paint reads them", () => {
  // A face painted from signed maps read as near-white paint is dark and blotched all over.
  assert.equal(complexion.encoding.name, detailEncoding);
  assert.equal(complexion.encoding.neutral, 128);
  assert.equal(tone.encoding.name, toneEncoding);
  assert.equal(tone.encoding.neutral, 128);
});

test("a neutral detail texel leaves skin exactly its own colour, and no texel moves it far", () => {
  for (const [name, skin] of Object.entries(skins))
    for (const choice of ["Smooth", "Fine", "Weathered", "Lined", "Soft lines"])
      for (const age of [0, 0.5, 1]) {
        const profile = complexionProfile({ skin, age, choice });
        assert.deepEqual(detailTint(128, 128, 128, profile), [1, 1, 1], name + " " + choice);
        // No detail outside the face mask, whatever the map holds there.
        assert.deepEqual(detailTint(0, 255, 0, profile, 0, 0), [1, 1, 1]);
        for (const r of [0, 128, 255]) for (const g of [0, 128, 255]) for (const b of [0, 128, 255])
          for (const v of detailTint(r, g, b, profile)) assert.ok(v > 0.75 && v < 1.05, name + " " + choice + " " + v);
      }
});

function surfaceOf(form) {
  const s = smoothHumanSurface(evaluateHuman(form.human, form.humanFit, form.humanDetail));
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(s.positions, 3));
  g.setIndex(new T.BufferAttribute(s.indices, 1));
  g.computeVertexNormals();
  return [s, g.attributes.normal.array];
}

test("body skin tone only deepens the chosen colour, in its own hue, and leaves the face alone", () => {
  const [s, normals] = surfaceOf(generatedHuman(14118));
  const head = s.names.indexOf("head");
  assert.equal(tone.count, s.positions.length / 3);
  for (const [name, skin] of Object.entries(skins)) {
    const colour = new T.Color(skin), shade = skinShade(s, normals, colour);
    const order = [colour.r, colour.g, colour.b];
    let varied = 0, hands = 0, handCount = 0;
    for (let v = 0; v < shade.length / 3; v++) {
      const [r, g, b] = shade.subarray(v * 3, v * 3 + 3);
      let face = 0, hand = 0;
      for (let j = v * 4; j < v * 4 + 4; j++) {
        if (s.boneIndices[j] === head) face += s.weights[j];
        if (/^(hand|index|middle|ring|pinky|thumb)_/.test(s.names[s.boneIndices[j]])) hand += s.weights[j];
      }
      for (const c of [r, g, b]) assert.ok(c <= 1 && c > 0.449, name + " " + c);
      if (face > 0.9) assert.deepEqual([r, g, b], [1, 1, 1]);
      // The channel the skin has most of is deepened least: the hue is kept and saturated.
      const most = order.indexOf(Math.max(...order)), least = order.indexOf(Math.min(...order));
      assert.ok(shade[v * 3 + most] >= shade[v * 3 + least] - 1e-6);
      if (Math.min(r, g, b) < 0.97) varied++;
      if (hand > 0.9) { hands += Math.min(r, g, b); handCount++; }
    }
    // Readable but restrained: some of the body differs, and a hand is not a flat panel.
    assert.ok(varied > 0.08 * shade.length / 3 && varied < 0.6 * shade.length / 3, name + " varied " + varied);
    assert.ok(hands / handCount < 0.97 && hands / handCount > 0.76, name + " hands " + hands / handCount);
  }
});

test("the head and the neck agree at every point they share", () => {
  for (const skin of Object.values(skins)) {
    const form = tintHumanSkin(generatedHuman(8807), skin);
    const base = new T.MeshStandardMaterial({ color: skin, roughness: 0.88 });
    const build = humanRegions(form, () => base, false);
    const head = build(form.parts.find((p) => p.humanBone === "head")).children.find((m) => m.userData.faceSurface);
    const neck = build(form.parts.find((p) => p.humanBone === "neck_01")).children[0];
    const at = (mesh, i, origin) => [0, 1, 2].map((d) => Math.round((mesh.geometry.attributes.position.getComponent(i, d) + origin[d]) * 1e5)).join();
    const seen = new Map(), ho = head.humanSkin.origin, no = neck.humanSkin.origin;
    for (let i = 0; i < head.geometry.attributes.position.count; i++) seen.set(at(head, i, ho), i);
    let shared = 0, shaded = 0;
    for (let i = 0; i < neck.geometry.attributes.position.count; i++) {
      const h = seen.get(at(neck, i, no));
      if (h === undefined) continue;
      shared++;
      for (let d = 0; d < 3; d++) {
        // The lip, lid and nail pigments are read per texture coordinate from compressed masks, and the
        // join is a seam of the layout: allow their noise, a five-hundredth of a step of an 8 bit colour.
        assert.ok(Math.abs(neck.geometry.attributes.color.getComponent(i, d) - head.geometry.attributes.color.getComponent(h, d)) < 2e-3);
        assert.ok(Math.abs(neck.geometry.attributes.normal.getComponent(i, d) - head.geometry.attributes.normal.getComponent(h, d)) < 1e-6);
      }
      if (neck.geometry.attributes.color.getX(i) < 1) shaded++;
      // A game file reduces the two meshes apart. Both must keep the points of the join.
      assert.equal(neck.geometry.attributes.lodAnchor.getX(i), 1);
      assert.equal(head.geometry.attributes.lodAnchor.getX(h), 1);
    }
    assert.ok(shared > 40, "shared " + shared);
    // Same colour and roughness on both sides without the painted textures loaded.
    assert.equal(head.material.color.getHex(), neck.material.color.getHex());
    assert.equal(head.material.roughness, neck.material.roughness);
    const anchored = [...head.geometry.attributes.lodAnchor.array].filter(Boolean).length;
    assert.ok(anchored < 0.05 * head.geometry.attributes.position.count, "anchored " + anchored);
    base.dispose();
  }
});
