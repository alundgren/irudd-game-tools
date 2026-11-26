import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { humanRegions } from "./human-mesh.js";
import { costumeStudies } from "../examples/costume-studies.js";
import { BRISTLE_TILES, bristleMaps, bristlePixels } from "./human-beard-bristles.js";

function head(form) {
  const build = humanRegions(form, (color) => new T.MeshStandardMaterial({ color }), false);
  return build(form.parts.find((part) => part.humanBone === "head"));
}
const warden = () => costumeStudies.find((c) => c.id === "salt-road-warden").make();
const beardOf = (group) => group.children.find((mesh) => mesh.name === "facial-hair");

test("every bristle tile holds separate hairs inside a clear gutter", () => {
  const { width, height, data, normal, rough } = bristlePixels();
  assert.equal(data.length, width * height * 4);
  assert.equal(normal.length, data.length);
  assert.equal(rough.length, data.length);
  for (const [kind, tiles] of Object.entries(BRISTLE_TILES))
    for (const [tx, ty, tw, th] of tiles) {
      let solid = 0, clear = 0, top = 0;
      for (let y = 0; y < th; y++)
        for (let x = 0; x < tw; x++) {
          const a = data[((ty + y) * width + tx + x) * 4 + 3];
          if (x < 2 || x >= tw - 2 || y < 2 || y >= th - 2) assert.equal(a, 0, kind + " gutter");
          if (a > 127) { solid++; if (y < th * 0.35) top++; }
          if (a < 20) clear++;
        }
      assert.ok(solid > 0.01 * tw * th, kind + " has hair");
      assert.ok(clear > 0.2 * tw * th, kind + " has gaps between hairs");
      assert.ok(top < 0.5 * solid, kind + " thins toward its tips");
    }
  assert.equal(bristleMaps().map.colorSpace, T.SRGBColorSpace);
});

test("a short beard is rooted cards that follow the skin's joints and expressions", () => {
  const group = head(warden()), beard = beardOf(group), skin = group.children.find((mesh) => mesh.userData.faceSurface);
  const g = beard.geometry, count = g.attributes.position.count;
  assert.equal(beard.userData.originalBeardGroom, "Short beard");
  assert.equal(beard.material.map, bristleMaps().map);
  assert.equal(g.index.count / 6, count / 4);
  assert.ok(g.index.count / 3 <= 6000, g.index.count / 3 + " triangles");

  const { weights, boneIndices, names } = beard.humanWeights;
  assert.equal(names, skin.humanWeights.names);
  assert.equal(weights.length, count * 4);
  let neck = 0, most = 0;
  for (let i = 0; i < count; i++) {
    let total = 0;
    for (let k = 0; k < 4; k++) {
      total += weights[i * 4 + k];
      if (/neck/.test(names[boneIndices[i * 4 + k]]) && weights[i * 4 + k] > 0.05) { neck++; most = Math.max(most, weights[i * 4 + k]); }
    }
    assert.ok(Math.abs(total - 1) < 1e-4, "weights sum to one");
  }
  assert.ok(neck > 40 && most > 0.15, `hair under the jaw follows the neck (${neck} corners, most ${most.toFixed(2)})`);

  const smile = g.morphAttributes.position[beard.morphTargetDictionary.Smile];
  let moved = 0;
  for (let i = 0; i < count; i += 4) {
    for (let k = 1; k < 4; k++) assert.equal(smile.getY(i + k), smile.getY(i));
    if (Math.hypot(smile.getX(i), smile.getY(i), smile.getZ(i)) > 0.001) moved++;
  }
  assert.ok(moved > 200, moved + " cards move in a smile");
});

test("short beard hair thins toward the cheek and stands tallest along the jaw and chin", () => {
  const beard = beardOf(head(warden())), p = beard.geometry.attributes.position, box = new T.Box3().setFromBufferAttribute(p);
  const third = (box.max.y - box.min.y) / 3;
  let upper = 0, lower = 0;
  for (let i = 0; i < p.count; i += 4) {
    if (p.getY(i) > box.max.y - third) upper++;
    else if (p.getY(i) < box.min.y + third) lower++;
  }
  assert.ok(upper < 0.6 * lower, `cheek growth is sparser than the jaw (${upper} above, ${lower} below)`);
  const again = beardOf(head(warden()));
  assert.deepEqual(Array.from(again.geometry.attributes.position.array.slice(0, 600)), Array.from(p.array.slice(0, 600)));
});

test("a short beard fits another face and dye without new settings", () => {
  const assessor = costumeStudies.find((c) => c.id === "dock-assessor").make();
  const worn = { ...assessor, humanStyle: { ...assessor.humanStyle, facialHair: "Short beard", hairColor: "#302725" } };
  const beard = beardOf(head(worn)), colour = beard.geometry.attributes.color;
  assert.ok(beard.geometry.index.count / 3 > 1500);
  let light = 0;
  for (let i = 0; i < colour.count; i++) light += 0.2126 * colour.getX(i) + 0.7152 * colour.getY(i) + 0.0722 * colour.getZ(i);
  assert.ok(light / colour.count < 0.12, "dark dye stays dark");
});
