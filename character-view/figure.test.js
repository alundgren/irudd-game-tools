import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { buildFigure, randomFigure, readFigure } from "./figure.js";
import { validateForm } from "./recipe.js";
import { applyOperations } from "./variations.js";
import { fitWardrobe } from "./wardrobe.js";
import { randomStream } from "./random.js";
import {
  BoxGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
} from "three";
import { sweepGeometry } from "./surface.js";
import { blendSkin } from "./blended-skin.js";
import { skinCharacter } from "./skin.js";

const world = (form, id) => {
  const at = new Vector3();
  for (
    let p = form.parts.find((x) => x.id === id);
    p;
    p = form.parts.find((x) => x.id === p.parent)
  )
    at.add(new Vector3(...p.position));
  return at;
};

test("a default figure is a valid, metric, two-armed form", () => {
  const form = buildFigure();
  validateForm(form);
  for (const side of ["left ", "right "]) {
    const shoulder = world(form, side + "upper arm"),
      elbow = world(form, side + "forearm"),
      wrist = world(form, side + "hand");
    const upper = shoulder.distanceTo(elbow),
      lower = elbow.distanceTo(wrist);
    // Adult proportions: the upper arm is the longer segment and the wrist hangs near the hip.
    assert.ok(upper > lower && upper / lower < 1.35, "arm segments");
    assert.ok(Math.abs(upper + lower - 0.32 * 1.72) < 0.03, "arm length");
    assert.ok(wrist.y > 0.42 * 1.72 && wrist.y < 0.52 * 1.72, "wrist height");
    assert.ok(Math.abs(shoulder.y - 0.79 * 1.72) < 0.035, "shoulder height");
  }
  assert.equal(
    form.parts.filter((p) => p.outfitRole === "upper arm").length,
    2,
  );
  assert.equal(form.parts.filter((p) => p.shape === "hand").length, 2);
});

test("starting proportions survive a recipe round trip and leave height, face and clothing independent", () => {
  const profiles = ["male", "neutral", "female"].map((archetype) => {
    const fig = randomFigure(randomStream(161), archetype);
    const form = buildFigure(fig);
    validateForm(form);
    assert.deepEqual(buildFigure(form.origin.figure), form);
    assert.equal(form.origin.figure.archetype, archetype);
    const neck = form.parts.find((p) => p.anatomy === "neck");
    assert.equal(form.parts.find((p) => p.shape === "head").parent, neck.id);
    assert.ok(neck.knots.at(-1)[2] > neck.knots[0][2]);
    return form.origin.figure;
  });
  for (const key of ["height", "face", "hair", "top", "bottom", "shoes"]) {
    assert.deepEqual(profiles[0][key], profiles[2][key]);
  }
  const ratios = profiles.map((p) => p.shoulders / p.hips);
  assert.ok(ratios[0] > ratios[1] && ratios[1] > ratios[2]);
  assert.equal(
    readFigure({ archetype: "female", shoulders: 1.3 }).shoulders,
    1.3,
  );
  assert.equal(readFigure({}).archetype, "neutral");
});

test("limb segments close with matching rounded ends at each joint", () => {
  const form = buildFigure({ limbs: 1.3, stance: { arms: 40, elbows: 60 } });
  for (const [upper, lower] of [
    ["left upper arm", "left forearm"],
    ["right thigh", "right shin"],
  ]) {
    const a = form.parts.find((p) => p.id === upper),
      b = form.parts.find((p) => p.id === lower);
    const joint = new Vector3(...b.position);
    // The proximal segment has a full section exactly at the child's pivot.
    const at = a.knots.find((k) => new Vector3(...k).distanceTo(joint) < 1e-6);
    const start = b.knots.find((k) => Math.hypot(k[0], k[1], k[2]) < 1e-6);
    assert.ok(at && start, "sections at the joint");
    assert.ok(
      Math.abs(at[3] - start[3]) < 1e-6 && Math.abs(at[4] - start[4]) < 1e-6,
    );
    assert.ok(
      a.knots.at(-1)[3] < at[3] * 0.4 && b.knots[0][3] < start[3] * 0.4,
      "caps",
    );
  }
});

test("partial and out-of-range requests are clamped to an adult figure", () => {
  const f = readFigure({
    height: 9,
    belly: -3,
    top: { kind: "cape", color: "red" },
    face: 12,
  });
  assert.equal(f.height, 2.2);
  assert.equal(f.belly, 0);
  assert.equal(f.top.kind, "shirt");
  assert.equal(f.top.color, "#5d7d86");
  assert.equal(f.face, 3);
  for (let seed = 1; seed < 40; seed++)
    validateForm(buildFigure(randomFigure(randomStream(seed))));
});

test("clothes are separate from the bare body in every wardrobe", () => {
  const form = buildFigure({
    top: { kind: "jacket" },
    shoes: { kind: "boots" },
  });
  assert.equal(form.outfit, "Anatomy");
  const worn = form.parts.filter((p) => p.visibleIn?.includes("Work clothes"));
  const barefoot = form.parts.filter((p) => p.visibleIn?.includes("Anatomy"));
  assert.equal(barefoot.filter((p) => / toe [1-5]$/.test(p.id)).length, 10);
  assert.ok(barefoot.every((p) => p.seamGroup?.endsWith(" foot")));
  assert.ok(worn.every((p) => !p.visibleIn.includes("Anatomy")));
  assert.ok(worn.length >= 14);
  assert.ok(
    worn.every((p) => p.visibleIn[0] === "Work clothes" && !p.outfitRole),
  );
  const arm = form.parts.find((p) => p.id === "left upper arm"),
    forearm = form.parts.find((p) => p.id === "left forearm");
  assert.equal(fitWardrobe(arm, form), null);
  const base = fitWardrobe(arm, { ...form, outfit: "Base layer" });
  assert.ok(base.amount > 1 && base.amount < 1.1);
  assert.equal(
    fitWardrobe(forearm, { ...form, outfit: "Base layer" }).amount,
    1,
  );
  assert.ok(
    fitWardrobe(arm, { ...form, outfit: "Pressure suit" }).amount > 1.3,
  );
  const sleeve = form.parts.find((p) => p.id === "left sleeve");
  const widest = (p) => Math.max(...p.knots.map((k) => k[3]));
  assert.ok(widest(sleeve) > widest(arm) + 0.01);
});

test("a proposal can build a figure and then edit its regions", () => {
  const start = buildFigure();
  const next = applyOperations(start, [
    {
      op: "buildFigure",
      figure: {
        height: 1.6,
        belly: 0.6,
        top: { kind: "tee", sleeves: "short" },
      },
    },
    { op: "setPart", id: "left sleeve", set: { color: "#aa3322" } },
  ]);
  validateForm(next);
  assert.equal(next.outfit, "Anatomy");
  assert.equal(
    applyOperations({ ...start, outfit: "Work clothes" }, [
      { op: "buildFigure", figure: {} },
    ]).outfit,
    "Work clothes",
  );
  assert.equal(next.origin.figure.height, 1.6);
  assert.equal(next.parts.find((p) => p.id === "left sleeve").color, "#aa3322");
  assert.ok(!next.parts.some((p) => p.id === "left cuff"));
});

test("reach turns the elbow about the forearm pivot", () => {
  const form = buildFigure({
    top: { kind: "none" },
    bottom: { kind: "none" },
    shoes: { kind: "none" },
  });
  const model = new Group(),
    nodes = new Map();
  for (const p of form.parts) {
    const node = new Mesh(
      p.knots ? sweepGeometry(p.knots) : new BoxGeometry(1, 1, 1),
    );
    node.userData.partId = p.id;
    node.position.fromArray(p.position);
    node.rotation.set(...p.rotation.map(MathUtils.degToRad));
    if (!p.knots) node.scale.fromArray(p.size);
    nodes.set(p.id, node);
  }
  for (const p of form.parts)
    (nodes.get(p.parent) ?? model).add(nodes.get(p.id));
  const rig = skinCharacter(form, model);
  const reach = rig.clips.find((c) => c.name === "Reach");
  for (const side of ["left", "right"]) {
    const forearm = rig.regions.get(side + " forearm"),
      upper = rig.regions.get(side + " upper arm");
    assert.equal(upper.points.length, 3);
    assert.ok(upper.points[2].distanceTo(forearm.points[0]) < 1e-6);
    assert.ok(
      reach.tracks.some(
        (t) => t.name === forearm.bones[0].name + ".quaternion",
      ),
    );
  }
  rig.dispose();
});

test("trousers and shorts cover the body between the legs", () => {
  const draw = randomStream(11),
    ray = new Raycaster();
  for (let n = 0; n < 24; n++) {
    const figure = randomFigure(draw);
    figure.bottom.kind = n % 2 ? "shorts" : "trousers";
    const form = buildFigure(figure),
      scene = new Group();
    for (const p of form.parts) {
      if (
        !/^(body|trouser seat|(left|right) (trouser thigh|short leg))$/.test(
          p.id,
        )
      )
        continue;
      const mesh = new Mesh(
        sweepGeometry(p.knots),
        new MeshBasicMaterial({ side: DoubleSide }),
      );
      mesh.position.copy(world(form, p.id));
      mesh.name = p.id;
      scene.add(mesh);
    }
    scene.updateMatrixWorld(true);
    const body = form.parts.find((p) => p.id === "body"),
      k = figure.height / 1.72,
      low = body.position[1] + body.knots[0][1];
    for (const toward of [1, -1])
      for (let y = low + 0.002 * k; y < low + 0.1 * k; y += 0.006 * k)
        for (const x of [-0.02 * k, 0, 0.02 * k]) {
          ray.set(new Vector3(x, y, -2 * toward), new Vector3(0, 0, toward));
          const hit = ray.intersectObjects(scene.children)[0];
          assert.notEqual(
            hit?.object.name,
            "body",
            `figure ${n} ${toward > 0 ? "back" : "front"} at ${(y - low).toFixed(3)}`,
          );
        }
  }
});

test("cargo pockets sit on the outside of each thigh", () => {
  for (const kind of ["trousers", "shorts"]) {
    const form = buildFigure({ bottom: { kind, pockets: "cargo" } });
    validateForm(form);
    for (const [side, sign] of [
      ["left ", 1],
      ["right ", -1],
    ]) {
      const pocket = form.parts.find((p) => p.id === side + "cargo pocket"),
        thigh = form.parts.find((p) => p.id === side + "thigh");
      assert.equal(pocket.parent, side + "thigh");
      const reach = (part) =>
        Math.max(...part.knots.map((row) => sign * row[0] + row[3]));
      assert.ok(reach(pocket) > reach(thigh) + 0.01);
    }
  }
  assert.equal(
    readFigure({ bottom: { pockets: "holster" } }).bottom.pockets,
    "none",
  );
  assert.equal(
    buildFigure().parts.some((p) => p.id.includes("pocket")),
    false,
  );
});

test("a cropped groom carries the hairline to the nape", () => {
  const form = buildFigure({
    groom: { pattern: "Side part", length: 0.06, nape: 1 },
  });
  validateForm(form);
  assert.equal(form.parts.find((p) => p.id === "head").groom.nape, 1);
  assert.equal(readFigure({ groom: { nape: 4 } }).groom.nape, 1);
});

test("the articulated pelvis joins the thighs and trouser seat on separate surfaces", () => {
  const form = buildFigure({
    top: { kind: "none" },
    bottom: { kind: "trousers" },
  });
  form.parts = form.parts.filter((p) =>
    /^(body|trouser seat|(left|right) (thigh|trouser thigh|shin))$/.test(p.id),
  );
  const model = new Group(),
    nodes = new Map();
  const materials = {
    figure: new MeshBasicMaterial(),
    bottom: new MeshBasicMaterial(),
  };
  for (const p of form.parts) {
    const mesh = new Mesh(sweepGeometry(p.knots), materials[p.seamGroup]);
    mesh.userData.partId = p.id;
    mesh.position.fromArray(p.position);
    mesh.rotation.set(...p.rotation.map(MathUtils.degToRad));
    nodes.set(p.id, mesh);
  }
  for (const p of form.parts)
    (nodes.get(p.parent) ?? model).add(nodes.get(p.id));
  blendSkin(form, nodes, () =>
    assert.fail("each layer keeps its own material"),
  );
  for (const part of form.parts) {
    const mesh = nodes.get(part.id);
    assert.equal(mesh.material, materials[part.seamGroup]);
    assert.ok(
      mesh.geometry.index.count > 2 * mesh.geometry.attributes.position.count,
    );
    assert.deepEqual(
      new Set(mesh.blendOwners.ids),
      new Set(
        form.parts
          .filter((p) => p.seamGroup === part.seamGroup)
          .map((p) => p.id),
      ),
    );
  }
  const rig = skinCharacter(form, model);
  const mesh = rig.actor.children.find((o) => o.isSkinnedMesh);
  const { skinWeight, skinIndex, _region } = mesh.geometry.attributes;
  for (const layer of Object.keys(materials)) {
    let sharedSeat = false;
    for (let i = 0; i < skinWeight.count; i++) {
      if (form.parts[_region.getX(i)].seamGroup !== layer) continue;
      const bones = new Set(
        [0, 1, 2, 3]
          .filter((k) => skinWeight.getComponent(i, k) > 0.01)
          .map(
            (k) =>
              mesh.skeleton.bones[skinIndex.getComponent(i, k)].userData.region,
          ),
      );
      if (["body", "left thigh", "right thigh"].every((id) => bones.has(id))) {
        sharedSeat = true;
        break;
      }
    }
    assert.ok(sharedSeat, "seat bends between both hip joints");
  }
  rig.dispose();
  for (const mesh of nodes.values()) mesh.geometry.dispose();
  for (const material of Object.values(materials)) material.dispose();
});
