import assert from "node:assert/strict";
import test from "node:test";
import { BufferAttribute, BufferGeometry, Group, Mesh, PerspectiveCamera, Vector3 } from "three";
import { humanForm } from "./human-form.js";
import { evaluateHuman, smoothHumanSurface } from "./human-surface.js";
import { measureProportions, proportionEnds, proportionFitted, proportions } from "./human-proportions.js";
import { proportionMatcher } from "./human-proportion-match.js";

function page() {
  const made = new Map();
  function element(id = "") {
    const heard = {};
    return {
      id,
      hidden: false,
      disabled: false,
      checked: false,
      textContent: "",
      value: "",
      dataset: {},
      style: {},
      attributes: {},
      children: [],
      options: [],
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      append(...items) {
        this.children.push(...items);
        this.options.push(...items.filter((item) => item?.option));
      },
      replaceChildren(...items) {
        this.children = items;
      },
      get tBodies() {
        return [(this.body ??= element())];
      },
      addEventListener(type, listener) {
        (heard[type] ??= []).push(listener);
      },
      fire(type, event = {}) {
        for (const listener of heard[type] ?? []) listener(event);
      },
      querySelector: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    };
  }
  const $ = (id) => made.get(id) ?? made.set(id, element(id)).get(id);
  globalThis.document = { getElementById: $, createElement: () => element(), head: element() };
  globalThis.Option = function (text, value) {
    return Object.assign(element(), { textContent: text, value, option: true });
  };
  $("hfit-views").querySelector = () => ({ dataset: { view: "side" } });
  return $;
}

function headMesh(human) {
  const smooth = smoothHumanSurface(evaluateHuman(human)),
    head = smooth.names.indexOf("head"),
    faces = [];
  for (let i = 0; i < smooth.indices.length; i += 3) {
    const corners = smooth.indices.subarray(i, i + 3);
    if (corners.every((v) => smooth.boneIndices[v * 4] === head)) faces.push(...corners);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(smooth.positions, 3));
  geometry.setIndex(faces);
  const mesh = new Mesh(geometry);
  mesh.updateMatrixWorld(true);
  return mesh;
}

test("proportions marked on a reference are read, fitted with chosen controls and stored as one step", () => {
  const $ = page();
  try {
    const made = { lips: 0.7, eyeSize: 0.6, nostrilWidth: 0.5, chinHeight: 0.4, jaw: 0.3 },
      truth = measureProportions({ human: made }),
      target = headMesh(made),
      canvas = $("canvas"),
      camera = new PerspectiveCamera(20, 400 / 600, 0.1, 5),
      notes = [],
      steps = [];
    camera.position.set(0, 1.575, 0.95);
    camera.lookAt(0, 1.575, 0.14);
    camera.updateMatrixWorld(true);
    let working = humanForm({ height: 1.72, cheeks: 0.2 }),
      loaded = { name: "generated" },
      free = true;
    const skin = new Mesh(new BufferGeometry()),
      group = new Group();
    skin.position.set(0, 1.6, 0);
    skin.humanSkin = { origin: [0, 1.6, 0] };
    group.add(skin);
    group.updateMatrixWorld(true);
    const tool = proportionMatcher({
      slot: $("hfit-prop-slot"),
      names: { lips: "Mouth width", eyeSize: "Eye size", nostrilWidth: "Nostril width" },
      canvas,
      camera,
      ready: () => free,
      raw: () => loaded,
      placement: () => loaded,
      reference: () => target,
      figure: () => ({ group, skins: [[skin, "head", "head"]] }),
      form: () => working,
      hold: () => null,
      accept(next, entry) {
        steps.push([working, entry]);
        working = next;
        tool.sync();
      },
      sideBySide() {},
      note: (text) => notes.push(text),
      render() {},
    });
    const click = (point, pane = 0) => {
      const seen = new Vector3(...point).project(camera),
        at = { button: 0, clientX: pane * 400 + ((seen.x + 1) / 2) * 400, clientY: ((1 - seen.y) / 2) * 600 };
      canvas.fire("pointerdown", at);
      canvas.fire("pointerup", at);
    };
    const mark = (id) => {
      $("hfit-prop-pick").value = id;
      $("hfit-prop-pick").onchange();
      for (const end of proportionEnds({ human: made }, id)) click(end);
    };
    const rows = () => $("hfit-prop-list").tBodies[0].children.map((row) => row.children.map((cell) => cell.textContent));

    tool.sync();
    assert.equal($("hfit-prop").disabled, false);
    assert.equal($("hfit-prop-panel").hidden, true);
    assert.equal($("hfit-prop-pick").options.length, proportions.length);
    $("hfit-prop").onclick();
    assert.equal(tool.active(), true);
    assert.equal($("hfit-prop-panel").hidden, false);
    assert.match($("hfit-prop-hint").textContent, /one corner of the mouth/);
    assert.equal(skin.children.length, 1);
    assert.equal(skin.children[0].children.filter((o) => o.isMesh).length, 2);

    click(proportionEnds(working, "mouthWidth")[0], 1);
    assert.match(notes.at(-1), /left pane/);
    assert.equal(rows().length, 0);

    for (const id of ["mouthWidth", "eyeLength", "noseWidth", "mouthToChin"]) mark(id);
    const table = rows();
    assert.deepEqual(table.map((row) => row[0]), ["Mouth width", "Nose width", "Eye length", "Mouth line to chin (reading)"]);
    assert.equal(proportionFitted("mouthToChin"), false);
    assert.match($("hfit-prop-hint").textContent, /This one is a reading/);
    for (const [label, reference, yours] of table) {
      const name = label.replace(" (reading)", ""),
        id = proportions.find((p) => p.name === name).id;
      assert.ok(Math.abs(Number(reference) - truth[id]) < 0.6, name + " " + reference + " for " + truth[id]);
      assert.equal(yours, measureProportions(working)[id].toFixed(1));
    }
    assert.match($("hfit-prop-pick").options[0].textContent, /✓/);
    assert.equal(target.children.length, 1);
    assert.ok(target.children[0].children.filter((o) => o.isMesh).length >= 8);

    const boxes = () => Object.fromEntries($("hfit-prop-controls").children.map((label) => [label.children[1], label.children[0]]));
    assert.equal(boxes()["Mouth width"].checked, true);
    assert.equal(boxes()["Eye size"].checked, true);
    assert.equal(boxes()["Nostril width"].checked, true);
    assert.equal(boxes().headWidth.checked, false);
    assert.equal(boxes().chinHeight, undefined);
    assert.equal(boxes().mouthLevel, undefined);
    boxes()["Nostril width"].checked = false;
    boxes()["Nostril width"].onchange();
    assert.equal(boxes()["Nostril width"].checked, false);

    $("hfit-prop-fit").onclick();
    assert.equal(steps.length, 1);
    const [before, entry] = steps[0],
      after = measureProportions(working);
    assert.equal(entry.region, "head");
    assert.equal(working.human.cheeks, 0.2);
    assert.equal(working.human.chinHeight ?? 0, 0);
    assert.ok(working.human.lips > 0.5 && working.human.eyeSize > 0.3);
    assert.deepEqual(entry.proportions.proportions.map((row) => row.id), ["mouthWidth", "noseWidth", "eyeLength"]);
    for (const row of entry.proportions.proportions) {
      assert.ok(Math.abs(row.beforeMm - measureProportions(before)[row.id]) < 1e-9);
      assert.ok(Math.abs(row.afterMm - after[row.id]) < 1e-9);
      assert.ok(Math.abs(row.afterMm - row.referenceMm) < 0.3, row.id);
    }
    assert.ok(!entry.proportions.controls.some((c) => c.key === "nostrilWidth" || c.key === "chinHeight"));
    assert.equal(working.human.nostrilWidth ?? 0, 0);
    assert.ok(Math.abs(after.mouthToChin - measureProportions(before).mouthToChin) < 0.3);
    assert.match($("hfit-prop-reading").textContent, /^Proportions · Mouth width .* · controls: .*Mouth width 0\.00 → 0\.\d\d/);
    assert.equal(rows()[0][2], after.mouthWidth.toFixed(1));
    assert.match(notes.at(-1), /Undo step/);

    $("hfit-eyes").checked = true;
    $("hfit-eyes").fire("change");
    assert.match($("hfit-prop-kept").textContent, /Eye size \(eye openings kept\)/);
    assert.equal(boxes()["Eye size"], undefined);
    $("hfit-eyes").checked = false;
    $("hfit-eyes").fire("change");
    assert.equal($("hfit-prop-kept").textContent, "");
    assert.equal(boxes()["Eye size"].checked, true);

    const remove = $("hfit-prop-list").tBodies[0].children[0].children[4].children[0];
    remove.onclick();
    assert.deepEqual(rows().map((row) => row[0]), ["Nose width", "Eye length", "Mouth line to chin (reading)"]);

    free = false;
    tool.sync();
    assert.equal(tool.active(), false);
    assert.equal($("hfit-prop").disabled, true);
    assert.equal(target.children.length, 0);
    assert.equal(skin.children.length, 0);
    free = true;
    tool.sync();
    $("hfit-prop").onclick();
    assert.equal(rows().length, 3);

    loaded = { name: "another" };
    tool.sync();
    assert.equal($("hfit-prop-list").hidden, true);
    assert.equal(rows().length, 0);
    tool.cancel();
    assert.equal(tool.active(), false);
    target.geometry.dispose();
  } finally {
    delete globalThis.document;
    delete globalThis.Option;
  }
});
