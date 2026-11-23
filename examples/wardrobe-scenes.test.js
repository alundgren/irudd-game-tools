import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { clipsForScene } from "./wardrobe-scenes.js";

test("each exported outfit owns its animated joints and root-level skinned meshes", async () => {
  const bytes = await readFile(
    new URL("./relay-wardrobe.glb", import.meta.url),
  );
  const json = JSON.parse(
    bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
  );
  const asset = {
    scenes: json.scenes,
    animations: json.animations,
    parser: { json },
  };
  const usedJoints = new Set();
  assert.equal(json.scenes.length, 4);
  for (const [index, scene] of json.scenes.entries()) {
    const clips = clipsForScene(asset, index);
    assert.deepEqual(clips.map((clip) => clip.name).sort(), [
      "Crouch",
      "Idle",
      "Reach",
      "Walk",
    ]);
    const meshes = scene.nodes.filter(
      (id) => json.nodes[id].skin !== undefined,
    );
    assert.ok(meshes.length);
    const joints = new Set(
      meshes.flatMap((id) => json.skins[json.nodes[id].skin].joints),
    );
    assert.ok([...joints].every((id) => !usedJoints.has(id)));
    for (const id of joints) usedJoints.add(id);
    const rigs = scene.nodes.filter((id) =>
      json.nodes[id].children?.some((child) => joints.has(child)),
    );
    assert.equal(rigs.length, 1);
    assert.ok(!joints.has(rigs[0]));
    assert.equal(json.nodes[rigs[0]].name, scene.extras.outfitName + " rig");
  }
});
