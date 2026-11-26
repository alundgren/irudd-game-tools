import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as found from "./local-references.js";
import { localReferencesPlugin } from "../scripts/local-references.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("every study list loads with the private reference files absent", () => {
  const script = `
    const [refs, human, scans, torso] = await Promise.all([
      import("./examples/local-references.js"),
      import("./examples/human-studies.js"),
      import("./examples/reference-studies.js"),
      import("./examples/mhr-study.js"),
    ]);
    console.log(JSON.stringify({
      rigs: refs.rigs,
      fits: [refs.mhrFit, refs.scanFits, refs.workshopFits],
      heads: Object.keys(refs.headFits),
      referenceFits: human.humanStudies.filter((s) => s.game === "3D reference fits").length,
      adults: human.humanStudies.filter((s) => s.game === "Adult shapes").length,
      scans: scans.referenceStudies.length,
      torso: torso.mhrStudies.length,
      unfitted: torso.mhrStudy().parts.some((p) => p.radialFit),
    }));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: root,
    env: { ...process.env, WORKSHOP_REFERENCES: "none" },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), {
    rigs: [],
    fits: [null, null, null],
    heads: [],
    referenceFits: 0,
    adults: 7,
    scans: 0,
    torso: 0,
    unfitted: false,
  });
});

test("a browser bundle carries the references found at build time and reads no files", async () => {
  const { outputFiles } = await build({
    entryPoints: [root + "examples/local-references.js"],
    bundle: true,
    format: "esm",
    write: false,
    plugins: [localReferencesPlugin()],
  });
  const text = outputFiles[0].text;
  assert.ok(!/node:|import\.meta|process\./.test(text));
  const bundled = await import(
    "data:text/javascript;base64," + Buffer.from(text).toString("base64")
  );
  assert.deepEqual({ ...bundled }, { ...found });
});

test("only installed practice rigs are offered and each has a file path", () => {
  assert.ok(found.rigs.every((id) => found.rigFiles[id]));
  assert.equal(Object.keys(found.rigFiles).length, 7);
});
