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
