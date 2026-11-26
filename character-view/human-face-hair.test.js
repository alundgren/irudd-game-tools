import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { humanRegions } from "./human-mesh.js";
import { generatedHuman, humanForm } from "./human-form.js";
import { validateForm } from "./recipe.js";
import { facialHairNames, facePoint, growthAt } from "./human-face-hair.js";
import { adultStyles, chooseAdultStyle, dressHuman, validAdultStyle } from "./human-wardrobe.js";

function head(form, plain = false) {
  const build = humanRegions(form, (color) => new T.MeshStandardMaterial({ color }), plain);
  return build(form.parts.find((part) => part.humanBone === "head"));
}
const adult = (shape = {}, seed = 404) => humanForm({ stance: 0.76, ...shape }, seed);
const worn = (form, facialHair) => ({ ...form, humanStyle: { ...form.humanStyle, facialHair } });
const mass = (group) => group.children.find((mesh) => mesh.name === "facial-hair");
const fibres = (group) => group.children.find((mesh) => mesh.name === "brows-and-lashes");

test("every facial hair style builds on slight and broad frames, in colour and clay", () => {
  for (const frame of [-0.9, 0.9])
    for (const plain of [false, true]) {
      const form = adult({ frame });
      const bare = fibres(head(worn(form, "None"), plain)).geometry.index.count;
      for (const name of facialHairNames) {
        const group = head(worn(form, name), plain),
          beard = mass(group),
          strands = fibres(group);
        assert.equal(Boolean(beard), !["None", "Stubble"].includes(name), name);
        const groom = Boolean(beard?.userData.authoredGroom || beard?.userData.originalBeardGroom);
        assert.equal(groom, Boolean(beard) && !plain, name + " uses a strand groom in colour");
        assert.equal(strands.geometry.index.count > bare, Boolean(beard) && !groom, name + " strands");
        for (const mesh of [beard, strands].filter(Boolean)) {
          for (const value of mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
          assert.equal(Boolean(mesh.geometry.attributes.color), !plain);
          assert.deepEqual(Object.keys(mesh.morphTargetDictionary).slice(0, 3), ["Blink", "Smile", "BrowLift"]);
        }
      }
    }
});

test("a beard sits below the eyes, grows with its style and moves with a smile", () => {
  const form = adult({ frame: 0.8, jaw: 0.6 });
  const depth = (name) => {
    const group = head(worn(form, name)),
      beard = mass(group),
      eyes = group.children.find((mesh) => mesh.userData.eyePiece);
    const box = new T.Box3().setFromBufferAttribute(beard.geometry.attributes.position);
    const eyeBox = new T.Box3().setFromBufferAttribute(eyes.geometry.attributes.position);
    const p = beard.geometry.attributes.position;
    for (let i = 0; i < p.count; i++)
      if (p.getX(i) > eyeBox.min.x && p.getX(i) < eyeBox.max.x) assert.ok(p.getY(i) < eyeBox.min.y, name + " stays below the eyes");
    return { box, beard };
  };
  const moustache = depth("Moustache"),
    short = depth("Short beard"),
    full = depth("Full beard");
  assert.ok(moustache.box.min.y > short.box.min.y, "a moustache ends above the chin");
  assert.ok(full.box.min.y < short.box.min.y - 0.004, "a full beard hangs below a short one");
  const smile = full.beard.geometry.morphAttributes.position[full.beard.morphTargetDictionary.Smile];
  let moved = 0;
  for (let i = 0; i < smile.count; i++) if (Math.hypot(smile.getX(i), smile.getY(i), smile.getZ(i)) > 0.0005) moved++;
  assert.ok(moved > 0.15 * smile.count, "the hair around the mouth follows the smile");
});

test("strands are lit as the skin they grow from and face the viewer", () => {
  const strands = fibres(head(worn(adult({ frame: 0.7 }), "Short beard"), true)),
    g = strands.geometry,
    p = g.attributes.position,
    n = g.attributes.normal,
    index = g.index.array;
  assert.equal(strands.material.side, T.FrontSide);
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    normal = new T.Vector3();
  let front = 0,
    back = 0;
  for (let t = 0; t < index.length; t += 3) {
    a.fromBufferAttribute(p, index[t]);
    b.fromBufferAttribute(p, index[t + 1]).sub(a);
    c.fromBufferAttribute(p, index[t + 2]).sub(a);
    normal.fromBufferAttribute(n, index[t]);
    assert.ok(Math.abs(normal.length() - 1) < 1e-3);
    if (b.cross(c).dot(normal) >= 0) front++;
    else back++;
  }
  assert.ok(back > 100 && back < 0.35 * front, `${back} back, ${front} front`);
});

test("growth zones cover the lip, chin and jaw and leave the eyes and forehead bare", () => {
  const skin = head(adult()).children.find((mesh) => mesh.userData.faceSurface);
  assert.ok(skin, "the head has a face surface");
  const total = [0, 0, 0],
    out = [0, 0, 0];
  for (let j = 0; j < 40; j++)
    for (let i = 0; i < 40; i++) {
      growthAt((i + 0.5) / 40, (j + 0.5) / 40, out);
      out.forEach((value, k) => {
        assert.ok(value >= 0 && value <= 1);
        total[k] += value;
      });
      if (i < 16) assert.ok(Math.max(...out.slice(0, 2)) < 0.05, "no moustache or chin growth on the upper face");
    }
  assert.ok(total.every((value) => value > 3));
  assert.deepEqual(growthAt(1.2, 0.5), [0, 0, 0]);
  assert.equal(facePoint(0, 1).length, 2);
});

test("facial hair is a saved style choice that outfits and identity edits keep", () => {
  assert.deepEqual(adultStyles.facialHair, facialHairNames);
  const form = adult({ frame: 0.9 });
  for (const facialHair of facialHairNames) {
    assert.ok(validAdultStyle({ facialHair }));
    validateForm({ ...form, humanStyle: { facialHair } });
  }
  assert.ok(!validAdultStyle({ facialHair: "Goatee of doom" }));
  const bearded = chooseAdultStyle({ facialHair: "Full beard", hair: "None" }, { outfit: "None" });
  assert.equal(bearded.facialHair, "Full beard");
  const count = (frame) => {
    let grown = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const style = dressHuman(adult({ frame }), seed).humanStyle;
      assert.ok(validAdultStyle(style));
      if (style.facialHair !== "None") grown++;
    }
    return grown;
  };
  const broad = count(0.9);
  assert.ok(broad > 60 && broad < 140);
  assert.equal(count(-0.9), 0);
  const look = dressHuman(form, 8712).humanStyle,
    again = dressHuman(form, 8712).humanStyle;
  assert.deepEqual(look, again);
});

test("generated adult 8715 builds with its seeded look and with every facial hair style", () => {
  for (const archetype of ["male", "any"]) {
    const base = generatedHuman(8715, archetype);
    const looks = [dressHuman(base, 8715), ...facialHairNames.map((name) => worn(base, name))];
    for (const form of looks)
      for (const plain of [false, true]) {
        const group = head(form, plain),
          name = form.humanStyle.facialHair ?? "None";
        assert.equal(Boolean(mass(group)), !["None", "Stubble"].includes(name), name);
        for (const mesh of group.children)
          for (const value of mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
      }
  }
});

test("in colour a moustache is an authored CC0 groom and beards use the original lock groom that a game model keeps", async () => {
  const { authoredFacialHair, authoredFacialMesh, authoredAssets } = await import("./human-authored-hair.js");
  const { beardGroomStyles } = await import("./human-beard-groom.js");
  const form = adult({ frame: 0.8 });
  const box = (mesh) => new T.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
  const beards = {};
  for (const name of ["Moustache", ...beardGroomStyles]) {
    const beard = (beards[name] = mass(head(worn(form, name)))),
      g = beard.geometry,
      m = beard.material;
    const isOriginal = beardGroomStyles.includes(name);
    if (isOriginal) {
      assert.equal(beard.userData.originalBeardGroom, name, name + " uses the original beard groom");
      assert.equal(beard.userData.authoredGroom, undefined, name + " does not use community Sigmund groom");
      assert.ok(m.map && m.alphaTest > 0 && !m.alphaToCoverage, name + " keeps the fine strands as a clean cutout");
      const triangles = g.index.count / 3;
      assert.ok(triangles >= 900 && triangles <= (name === "Short beard" ? 6000 : 3400), `${name}: ${triangles} triangles`);
    } else {
      const spec = authoredFacialHair[name];
      assert.equal(beard.userData.authoredGroom, spec.groom, name);
      assert.ok(authoredAssets[spec.groom].facial && authoredAssets[spec.groom].credit.licence === "CC0 1.0", name + " is a credited CC0 groom");
      const triangles = g.index.count / 3;
      assert.ok(triangles >= 0.5 * spec.triangles && triangles <= 1.15 * spec.triangles, `${name}: ${triangles} triangles`);
      assert.equal(m.map, null);
      assert.equal(m.alphaTest, 0);
    }
    assert.equal(m.userData.fibreLOD, true, name + " is kept whole in a game model");
    assert.ok(m.side === T.DoubleSide && m.vertexColors && g.attributes.color.count === g.attributes.position.count, name + " material");
    assert.deepEqual(Object.keys(beard.morphTargetDictionary), ["Blink", "Smile", "BrowLift"]);
    for (const attr of g.morphAttributes.position) assert.equal(attr.count, g.attributes.position.count);
    for (const value of g.attributes.position.array) assert.ok(Number.isFinite(value));
    for (const value of g.attributes.uv.array) assert.ok(value >= 0 && value <= 1, name + " reads inside its picture");
    for (const value of g.attributes.normal.array) assert.ok(Number.isFinite(value));
    assert.equal(mass(head(worn(form, name))).geometry.index.count, g.index.count, name + " is the same every time");
  }
  assert.ok(box(beards["Full beard"]).min.y < box(beards["Short beard"]).min.y - 0.015);
  assert.ok(box(beards["Full beard"]).max.z > box(beards["Short beard"]).max.z + 0.001);
  const { evaluateHuman, expressionDisplacements } = await import("./human-surface.js");
  const s = evaluateHuman({}),
    names = ["Blink", "Smile", "BrowLift"];
  const cut = authoredFacialMesh("Moustache", s, new Map(Array.from(s.ids, (v, i) => [v, i])), [0, 0, 0], names.map((n) => expressionDisplacements(n, false, s)), names,
    (color) => new T.MeshStandardMaterial({ color }), new T.Color("#44372f"), new T.Texture());
  assert.ok(cut.material.map && cut.material.alphaTest > 0 && cut.material.alphaToCoverage && cut.material.color.getHexString() === "ffffff");
  assert.equal(mass(head(worn(form, "Short beard"), true)).userData.originalBeardGroom, undefined);
  assert.equal(mass(head(worn(form, "Short beard"), true)).userData.authoredGroom, undefined);
  assert.equal(mass(head(worn(form, "Stubble"))), undefined);
});
