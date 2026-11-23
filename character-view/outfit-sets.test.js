import test from "node:test";
import assert from "node:assert/strict";
import { Raycaster, Vector3, Mesh, MeshBasicMaterial } from "three";
import { mantleGeometry } from "./mantle.js";
import {
  validOutfitSets,
  saveOutfit,
  wearOutfit,
  setLayer,
} from "./outfit-sets.js";

test("wearing an earlier outfit takes off layers added later and keeps the complete body", () => {
  const form = {
    outfit: "Work clothes",
    appearance: { skin: "#734833", tones: { cloth: "#eedbaa" } },
    parts: [
      { id: "torso" },
      { id: "vest", wearFit: true, visibleIn: ["Work clothes"] },
    ],
  };
  let next = saveOutfit(form, "Rescue");
  next = {
    ...next,
    parts: [
      ...form.parts,
      { id: "cape", wearFit: true, visibleIn: ["Pressure suit"] },
    ],
  };
  next = setLayer(next, "cape", { show: true, dye: "#675533", order: 2 });
  next = setLayer(next, "vest", { show: false });
  next = saveOutfit(next, "Rain");
  const body = next.parts;
  assert.ok(
    validOutfitSets(next.outfitSets, ["Work clothes", "Pressure suit"]),
  );
  const original = wearOutfit(next, "Rescue");
  assert.equal(original.parts, body);
  assert.equal(original.layerStyles.cape.show, false);
  assert.equal(original.layerStyles.vest.show, true);
  assert.deepEqual(wearOutfit(original, "Rain").layerStyles.cape, {
    show: true,
    dye: "#675533",
    order: 2,
  });
  assert.throws(() => saveOutfit(original, "Rescue"));
});

test("the cape has an open centre-front and a two-sided back", () => {
  const g = mantleGeometry({
    kind: "Cape",
    width: 0.5,
    depth: 0.28,
    drop: 0.7,
    flare: 1,
    opening: 80,
    folds: 8,
  });
  const m = new Mesh(g, new MeshBasicMaterial());
  m.updateMatrixWorld();
  const ray = new Raycaster(new Vector3(0, -0.3, 2), new Vector3(0, 0, -1));
  const hits = ray.intersectObject(m);
  assert.ok(hits.length);
  assert.ok(hits.every((hit) => hit.point.z < 0));
  const back = new Raycaster(
    new Vector3(0, -0.3, -2),
    new Vector3(0, 0, 1),
  ).intersectObject(m);
  assert.ok(back.length && back[0].point.z < 0);
  g.dispose();
  m.material.dispose();
});
