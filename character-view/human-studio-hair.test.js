import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { humanForm, generatedHuman, changeHuman } from "./human-form.js";
import { humanRegions } from "./human-mesh.js";
import { adultStyles, adultStyleProblems, chooseAdultStyle, dressHuman, dressedHuman } from "./human-wardrobe.js";
import * as studio from "./human-studio-head.js";

const material = (colour) => new T.MeshStandardMaterial({ color: colour });
const head = (form) => humanRegions(form, material, false, (s) => dressedHuman(s, form, material, false, 0))(form.parts.find((part) => part.humanBone === "head"));
const styled = (form, patch) => ({ ...form, humanStyle: chooseAdultStyle(form.humanStyle, patch) });
const names = (group) => group.children.map((mesh) => mesh.name);
const drawn = (seed) => { const base = generatedHuman(seed); return { ...base, ...dressHuman(base, seed) }; };

test("the artist's cut is an ordinary hairstyle that ordinary draws do not pick", () => {
  assert.ok(adultStyles.hair.includes("Ribbon ponytail"));
  assert.deepEqual(adultStyles.faceFamilyHair, ["Family", "Chosen"]);
  assert.deepEqual(adultStyleProblems({ hair: "Ribbon ponytail", faceFamilyHair: "Chosen" }), []);
  for (let seed = 906400; seed < 906460; seed++) {
    const style = drawn(seed).humanStyle;
    assert.notEqual(style.hair, "Ribbon ponytail");
    assert.equal(style.faceFamily, undefined);
    assert.equal(style.faceFamilyHair, undefined);
  }
});

test("a native adult wears the cut on a native face, with its tail and band, and without them under a hat", () => {
  const person = styled(drawn(906205), { hair: "Ribbon ponytail", hat: "None" }), group = head(person);
  assert.equal(group.children.find((mesh) => mesh.name === "studio-head"), undefined);
  const hair = group.children.filter((mesh) => mesh.userData.studioHair);
  assert.equal(hair.length, 2);
  for (const mesh of hair) for (const value of mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
  const hatted = head(styled(person, { hat: "Flat cap" })).children.filter((mesh) => mesh.userData.studioHair);
  assert.equal(hatted.length, 1);
  assert.ok(hatted[0].geometry.index.count < hair[0].geometry.index.count);
});

test("the cut follows the width and age of the head it is worn on", () => {
  const top = (patch) => {
    const form = styled(changeHuman(humanForm(), patch), { hair: "Ribbon ponytail" });
    const box = new T.Box3().setFromBufferAttribute(head(form).children.find((mesh) => mesh.userData.sculptedHair).geometry.attributes.position);
    return box.max.x - box.min.x;
  };
  const rest = top({}), wide = top({ headWidth: 1, temples: 1 }), narrow = top({ headWidth: -1, temples: -1 });
  assert.ok(wide > rest + 0.002 && narrow < rest - 0.002, [narrow, rest, wide].join(" "));
});

test("a family wears its own hair unless a hairstyle is chosen, and a chosen None is a bare head", () => {
  const person = drawn(906205), own = head(styled(person, { faceFamily: "Studio Rain" }));
  assert.ok(names(own).includes("studio-hair"));
  assert.equal(names(own).includes(person.humanStyle.hair), false);
  const chosen = head(styled(person, { faceFamily: "Studio Rain", faceFamilyHair: "Chosen" }));
  assert.equal(names(chosen).includes("studio-hair"), false);
  assert.ok(chosen.children.length > 3, names(chosen).join(","));
  const bare = head(styled(person, { faceFamily: "Studio Rain", faceFamilyHair: "Chosen", hair: "None", hat: "None", eyewear: "None", earrings: "None" }));
  assert.deepEqual(names(bare).sort(), ["brows-and-lashes", "studio-eyes", "studio-head"]);
  const ribbon = head(styled(person, { faceFamily: "Studio Rain", faceFamilyHair: "Chosen", hair: "Ribbon ponytail" }));
  assert.ok(names(ribbon).includes("studio-hair"));
  assert.equal(ribbon.children.filter((mesh) => mesh.userData.studioHair && mesh.name === "Ribbon ponytail").length, 0);
});

test("pieces fitted onto the family lie outside its skin", () => {
  const person = styled(drawn(906206), { faceFamily: "Studio Rain", faceFamilyHair: "Chosen" }), group = head(person);
  const skin = group.children.find((mesh) => mesh.name === "studio-head").geometry.attributes.position, centre = new T.Box3().setFromBufferAttribute(skin).getCenter(new T.Vector3());
  for (const mesh of group.children.filter((mesh) => !mesh.name.startsWith("studio-") && mesh.name !== "brows-and-lashes")) {
    const box = new T.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
    assert.ok(box.getCenter(new T.Vector3()).distanceTo(centre) < 0.35, mesh.name);
    for (const value of mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(value), mesh.name);
  }
});

test("held fields and the note follow the hair choice, and credit is owed for the cut alone", () => {
  const person = drawn(906205);
  assert.deepEqual(studio.studioHeadHolds(person), []);
  assert.ok(studio.studioHeadHolds(styled(person, { faceFamily: "Studio Rain" })).includes("hair"));
  const chosen = styled(person, { faceFamily: "Studio Rain", faceFamilyHair: "Chosen" });
  assert.equal(studio.studioHeadHolds(chosen).includes("hair"), false);
  assert.equal(studio.studioHeadHolds(chosen).includes("hat"), false);
  assert.match(studio.studioHeadNoteFor(chosen), /chosen hairstyle/);
  assert.equal(studio.studioCreditFor(person), null);
  assert.equal(studio.studioCreditFor(styled(person, { hair: "Ribbon ponytail" })).name, "Ribbon ponytail");
  assert.equal(studio.studioCreditFor(chosen).name, "Studio Rain");
});

test("switching family, hair choice and back keeps the saved person", () => {
  const person = drawn(906207);
  const round = styled(styled(styled(person, { faceFamily: "Studio Rain", faceFamilyHair: "Chosen" }), { faceFamilyHair: "Family" }), { faceFamily: "None" });
  for (const key of Object.keys(person.humanStyle)) assert.deepEqual(round.humanStyle[key], person.humanStyle[key], key);
  assert.deepEqual(round.human, person.human);
  assert.deepEqual(JSON.parse(JSON.stringify(round)), round);
  const first = head(person), again = head({ ...round, humanStyle: person.humanStyle });
  assert.deepEqual(names(again), names(first));
});
