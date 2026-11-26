import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { humanForm, generatedHuman, changeHuman } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { validHuman } from "./human-surface.js";
import { adultStyles, adultStyleProblems, chooseAdultStyle, dressHuman } from "./human-wardrobe.js";
import { studioHeadCarries, studioHeadCredits, studioHeadPresets, studioHeadStyles, wearsStudioHead } from "./human-studio-head.js";

const material = (colour) => new T.MeshStandardMaterial({ color: colour });
const head = (form) => humanRegions(form, material, false)(form.parts.find((part) => part.humanBone === "head"));
const wearing = (form) => ({ ...form, humanStyle: chooseAdultStyle(form.humanStyle, { faceFamily: "Studio Rain" }) });
const named = (group, name) => group.children.find((mesh) => mesh.name === name);
const points = (group, name) => named(group, name).geometry.attributes.position.array;
const furthest = (a, b) => { let most = 0; for (let i = 0; i < a.length; i += 3) most = Math.max(most, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2])); return most; };

test("the face family is an opt-in adult style and saved adults stay native", () => {
  assert.deepEqual(adultStyles.faceFamily, studioHeadStyles);
  assert.deepEqual(adultStyleProblems({ faceFamily: "Studio Rain" }), []);
  assert.ok(adultStyleProblems({ faceFamily: "Studio Snow" }).length);
  const plainAdult = humanForm();
  assert.equal(wearsStudioHead(plainAdult), false);
  assert.equal(wearsStudioHead({ ...plainAdult, humanStyle: { ...plainAdult.humanStyle, faceFamily: "None" } }), false);
  assert.equal(named(head(plainAdult), "studio-head"), undefined);
});

test("the studio head comes whole, with expressions, gaze and a sewn neck", () => {
  const group = head(wearing(humanForm()));
  for (const name of ["studio-head", "studio-eyes", "brows-and-lashes", "studio-hair"]) assert.ok(named(group, name), name);
  const skin = named(group, "studio-head"), eyes = named(group, "studio-eyes");
  assert.deepEqual(Object.keys(skin.morphTargetDictionary), ["Blink", "Smile", "BrowLift"]);
  for (const look of ["LookLeft", "LookRight", "LookUp", "LookDown"]) assert.ok(look in eyes.morphTargetDictionary, look);
  assert.equal(eyes.userData.eyePiece, "Iris");
  assert.ok(skin.userData.faceSurface && skin.userData.fittedEyes && skin.geometry.attributes.lodAnchor);
  for (const mesh of group.children)
    for (const value of mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(value), mesh.name);
  const position = skin.geometry.attributes.position, index = skin.geometry.index.array, a = new T.Vector3(), b = new T.Vector3();
  for (let i = 0; i < index.length; i += 3)
    for (let k = 0; k < 3; k++)
      assert.ok(a.fromBufferAttribute(position, index[i + k]).distanceTo(b.fromBufferAttribute(position, index[i + (k + 1) % 3])) < 0.05);
  const triangles = group.children.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0);
  assert.ok(triangles < 24000, "fits the game budget before the body is counted: " + triangles);
});

test("head controls and age move the studio head", () => {
  const rest = wearing(humanForm()), restPoints = points(head(rest), "studio-head");
  for (const [control, least] of [["nose", 0.0015], ["cheeks", 0.003], ["jaw", 0.005], ["chin", 0.005], ["lips", 0.001]]) {
    const moved = furthest(points(head(changeHuman(rest, { [control]: 1 })), "studio-head"), restPoints);
    assert.ok(moved > least && moved < 0.03, control + " moved " + moved);
  }
  assert.ok(furthest(points(head(changeHuman(rest, { age: 0.95 })), "studio-head"), restPoints) > 0.005);
});

test("a saved and reopened person builds the same head, and switching back keeps every choice", () => {
  const drawn = generatedHuman(905106), person = wearing({ ...drawn, ...dressHuman(drawn, 905106) });
  const reopened = JSON.parse(JSON.stringify(person));
  assert.deepEqual(reopened, person);
  const first = head(person), second = head(reopened);
  for (const mesh of first.children) assert.deepEqual(points(second, mesh.name), mesh.geometry.attributes.position.array, mesh.name);
  const back = { ...person, humanStyle: chooseAdultStyle(person.humanStyle, { faceFamily: "None" }) };
  for (const key of studioHeadCarries) assert.equal(back.humanStyle[key], drawn.humanStyle?.[key] ?? person.humanStyle[key], key);
  assert.equal(named(head(back), "studio-head"), undefined);
});

test("the preset is a valid person and the credit names the source", () => {
  const preset = studioHeadPresets["Studio Rain"];
  assert.ok(validHuman(preset.human));
  assert.deepEqual(adultStyleProblems(preset.humanStyle), []);
  const person = { ...changeHuman(humanForm(), preset.human), humanStyle: chooseAdultStyle(humanForm().humanStyle, preset.humanStyle), eyeColor: preset.eyeColor };
  assert.ok(named(head(person), "studio-head"));
  const credit = studioHeadCredits["Studio Rain"];
  assert.match(credit.credit, /Blender Foundation/);
  assert.match(credit.source, /^https:\/\/studio\.blender\.org\/characters\/rain/);
  assert.match(credit.license, /creativecommons\.org\/licenses\/by\/4\.0/);
});
