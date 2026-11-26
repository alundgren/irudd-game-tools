import assert from "node:assert/strict";
import test from "node:test";
import {
  startingForm,
  nudge,
  neutral,
  makeBrief,
  readProposal,
} from "./recipe.js";
import { workshopServer } from "../scripts/workshop.mjs";

test("relative nudges accumulate from the accepted form and leave unrelated parts alone", () => {
  const original = startingForm(() => 0.5),
    target = original.parts[0].id;
  const delta = { ...neutral(), width: 10 };
  const first = nudge(original, target, delta),
    second = nudge(first, target, delta);
  assert.ok(
    Math.abs(second.parts[0].size[0] - original.parts[0].size[0] * 1.21) < 1e-9,
  );
  assert.deepEqual(second.parts.slice(1), original.parts.slice(1));
});
test("a revision can replace the entire anatomy and be nudged again", () => {
  const form = startingForm(() => 0.5),
    req = makeBrief(form, "rev", null, neutral(), "Single globe");
  const blob = {
    ...form,
    parts: [
      {
        id: "shell",
        shape: "ellipsoid",
        position: [0, 0.5, 0],
        size: [1, 1, 1],
        rotation: [0, 0, 0],
        color: "#557766",
      },
    ],
  };
  const raw = {
    format: "irudd.form-proposal.v1",
    requestId: req.requestId,
    revision: "rev",
    summary: "A floating shell",
    form: blob,
  };
  assert.equal(readProposal(raw, req, "rev").form, blob);
  assert.throws(() => readProposal(raw, req, "rev2"), /earlier edit/);
  assert.throws(
    () => readProposal({ ...raw, requestId: "other" }, req, "rev"),
    /different request/,
  );
  assert.deepEqual(
    nudge(blob, null, { ...neutral(), height: 10 }).parts[0].size,
    [1, 1.1, 1],
  );
});
test("the web workshop serves the editor without launching an agent", async () => {
  const server = workshopServer("<head></head>");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = "http://127.0.0.1:" + server.address().port;
    assert.equal(await (await fetch(url)).text(), "<head></head>");
    for (const route of ["/variation", "/turnaround", "/trace-map", "/portrait-depth"])
      assert.equal((await fetch(url + route, {method:"POST"})).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
