import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { examplesDir, fixturesDir } from "../src/paths.js";
import { fixtureText, prepareForm, preparePacks, sourceForm } from "../src/prepare.js";

await preparePacks();

const starters = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.slice(0, -".json".length));

test("each starter with a source form is that form's current preparation", () => {
  const prepared = starters.filter((name) => existsSync(join(examplesDir, name + ".form.json")));
  assert.ok(prepared.length > 0);
  for (const name of prepared) {
    const fresh: unknown = JSON.parse(fixtureText(prepareForm(name, sourceForm(name)).document));
    const shipped: unknown = JSON.parse(readFileSync(join(fixturesDir, name + ".json"), "utf8"));
    assert.deepEqual(
      shipped,
      fresh,
      `${name}: run src/prepare.ts ${name} after editing examples/${name}.form.json`,
    );
  }
});

test("a form's surface fit becomes the adult's corrections at its strength", () => {
  const file = sourceForm("winged-scout");
  assert.ok(file && typeof file === "object" && "form" in file);
  const source = file.form;
  assert.ok(source && typeof source === "object");
  const fitted = (strength: number) =>
    prepareForm("winged-scout", {
      ...file,
      form: {
        ...source,
        humanFit: {
          version: 1,
          strength,
          controls: [
            [3, 100, -40, 20],
            [9, 1, 0, 0],
          ],
        },
      },
    }).document.features["human.surface-corrections"];
  assert.deepEqual(fitted(1), {
    controls: [
      [3, 100, -40, 20],
      [9, 1, 0, 0],
    ],
  });
  assert.deepEqual(fitted(0.5), {
    controls: [
      [3, 50, -20, 10],
      [9, 1, 0, 0],
    ],
  });
  assert.deepEqual(fitted(0.25), { controls: [[3, 25, -10, 5]] });
  assert.equal(fitted(0), undefined);
  assert.throws(
    () => prepareForm("winged-scout", { ...file, form: { ...source, humanFit: { version: 2 } } }),
    /humanFit/,
  );
});
