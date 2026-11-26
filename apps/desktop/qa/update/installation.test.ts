// Installation state and links on a real NTFS folder: prepare, activate, roll
// back, prune and refusals. Fake builds keep it under a second; recovery after
// killed processes is in recovery.test.ts, and the installer rehearsal
// (scripts/rehearse.ts) covers real builds.

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  activate,
  appDirectoryOf,
  buildDirectory,
  prepare,
  prune,
  readInstallation,
  readLink,
  readState,
  repair,
  rollback,
} from "../../src/main/update/installation.js";

const scratch = mkdtempSync(path.join(tmpdir(), "irudd-installation-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const commit = (n: number): string => String(n).repeat(40).slice(0, 40);

function fakeBuild(root: string, id: string, launcher = "v1"): string {
  const build = buildDirectory(root, id);
  const app = appDirectoryOf(build);
  mkdirSync(path.join(app, "bin"), { recursive: true });
  writeFileSync(path.join(build, "Irudd Workshop", "Irudd Workshop.exe"), "runtime");
  const stateFile = launcher === "preview" ? "" : "installation.json";
  const identity = Buffer.from(`Irudd Workshop launcher v1 (${launcher}) ${stateFile}`, "utf16le");
  writeFileSync(path.join(app, "bin", "Irudd Workshop.exe"), identity);
  writeFileSync(path.join(app, "bin", "irudd.exe"), identity);
  writeFileSync(
    path.join(app, "package.json"),
    JSON.stringify({
      name: "irudd-workshop",
      iruddInstallation: {
        root,
        commit: id,
        branch: "main",
        origin: "C:\\origin.git",
        vp: "C:\\vp.exe",
      },
    }),
  );
  return build;
}

const commitOfLink = (root: string, name: "current" | "previous" | "prepared") =>
  readLink(root, name)?.split(path.sep).pop();

test("activation keeps the previous build, installs launchers and rolls back", async () => {
  const root = path.join(scratch, "cycle");
  const a = fakeBuild(root, commit(1));
  const b = fakeBuild(root, commit(2), "v1 b");
  await activate(root, a);
  assert.equal(commitOfLink(root, "current"), commit(1));
  assert.equal(readLink(root, "previous"), undefined);
  assert.match(readFileSync(path.join(root, "bin", "irudd.exe"), "utf16le"), /v1 \(v1\)/);

  await prepare(root, b);
  assert.equal(commitOfLink(root, "prepared"), commit(2));
  assert.equal(commitOfLink(root, "current"), commit(1), "preparing never switches");

  await activate(root, b);
  assert.equal(commitOfLink(root, "current"), commit(2));
  assert.equal(commitOfLink(root, "previous"), commit(1));
  assert.equal(readLink(root, "prepared"), undefined);
  assert.deepEqual(readState(root), { current: commit(2), previous: commit(1) });
  assert.match(readFileSync(path.join(root, "Irudd Workshop.exe"), "utf16le"), /v1 b/);

  assert.equal(path.basename(await rollback(root)), commit(1));
  assert.equal(commitOfLink(root, "current"), commit(1));
  assert.equal(commitOfLink(root, "previous"), commit(2));
  assert.equal(readInstallation(appDirectoryOf(a))?.commit, commit(1));
});

test("a rollback made by the junction-only preview survives a modern restart", async () => {
  const root = path.join(scratch, "preview");
  const preview = fakeBuild(root, commit(1), "preview");
  const modern = fakeBuild(root, commit(2));
  await activate(root, preview);
  await activate(root, modern);
  await rollback(root);
  assert.equal(existsSync(path.join(root, "installation.json")), false);
  // The running preview implements its own rollback entirely with junctions.
  renameSync(path.join(root, "current"), path.join(root, "swapping"));
  renameSync(path.join(root, "previous"), path.join(root, "current"));
  renameSync(path.join(root, "swapping"), path.join(root, "previous"));
  await repair(root);
  assert.deepEqual(readState(root), { current: commit(2), previous: commit(1) });
  assert.equal(commitOfLink(root, "current"), commit(2));
  assert.ok(existsSync(path.join(root, "installation.json")));
});

test("a foreign launcher or a build of another root is refused without changing links", async () => {
  const root = path.join(scratch, "refuse");
  const a = fakeBuild(root, commit(3));
  await activate(root, a);
  const b = fakeBuild(root, commit(4));
  writeFileSync(path.join(root, "bin", "irudd.exe"), "someone else's program");
  await assert.rejects(activate(root, b), /not this installation's launcher/);
  assert.deepEqual(readState(root), { current: commit(3) });
  assert.equal(commitOfLink(root, "current"), commit(3));
  assert.equal(readLink(root, "previous"), undefined);

  const other = fakeBuild(path.join(scratch, "elsewhere"), commit(5));
  await assert.rejects(activate(root, other), /not a build of this installation/);
  // A foreign program at a launcher path blocks every step until it is moved.
  await assert.rejects(rollback(root, { wait: 0 }), /not this installation's launcher/);
  rmSync(path.join(root, "bin", "irudd.exe"));
  await assert.rejects(rollback(root, { wait: 0 }), /no earlier version/);
  assert.match(readFileSync(path.join(root, "bin", "irudd.exe"), "utf16le"), /launcher v1/);
});

test("prune keeps linked and named builds and removes the rest", async () => {
  const root = path.join(scratch, "prune");
  for (const n of [6, 7, 8, 9]) fakeBuild(root, commit(n));
  await activate(root, buildDirectory(root, commit(6)));
  await activate(root, buildDirectory(root, commit(7)));
  await prepare(root, buildDirectory(root, commit(8)));
  const removed = await prune(root, [buildDirectory(root, commit(9))]);
  assert.deepEqual(removed, []);
  assert.deepEqual(await prune(root), [commit(9)]);
  for (const n of [6, 7, 8]) assert.ok(existsSync(buildDirectory(root, commit(n))));
});
