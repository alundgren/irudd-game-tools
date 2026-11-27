import { legacyPlateLayout } from "../src/legacy-plates.js";
import { legacyPlateCage } from "../src/surfaces/plate-growth.js";
import { changePlateTip, growPlateField, plateDefaults } from "../src/plate-field.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createRegistry,
  familyFeatures,
  readDocument,
  decodeOperations,
  applyOperations,
  figureSweep,
  figureLocations,
  figurePulls,
  figurePlateSite,
  figurePlateField,
  figureJoin,
  outfitWear,
  figureScute,
  figureCage,
  outfitLayers,
  outfitLooks,
  motionPoses,
  motionRole,
  type CharacterDocument,
} from "@irudd/document";
import * as T from "three";
import { placeBranch, drawBranches } from "../src/place-branch.js";
import { previewPull, mirrorCentre } from "../src/surfaces/pull.js";
import { pleat, splitHem } from "../src/surfaces/drapery.js";
import { scuteGeometry } from "../src/surfaces/scute.js";
import { sweepGeometry } from "../src/surfaces/sweep.js";
import { buildView } from "../src/view.js";
import { addDetail } from "../src/surface-edit.js";
import {
  arrangePlates,
  repeatedPlates,
  cageFace,
  branchStroke,
  drawAppendage,
  graftBranch,
  markLocation,
  moveControl,
  moveSpine,
  pullPart,
  resizeCharacter,
} from "../src/shape-tools.js";
const registry = createRegistry({ features: familyFeatures });
const result = readDocument(
  JSON.parse(
    readFileSync(
      new URL("../../../verification/families/fixtures/field-wardrobe.json", import.meta.url),
      "utf8",
    ),
  ),
  { registry },
);
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
const source = result.value;
function apply(doc: CharacterDocument, raw: readonly object[]) {
  const ops = decodeOperations(raw);
  assert.ok(ops.ok, JSON.stringify(ops));
  const next = applyOperations(doc, ops.value, {
    registry,
    retired: new Set(),
    idFor: () => {
      throw new Error("unexpected generation");
    },
  });
  assert.ok(next.ok, JSON.stringify(next));
  const loaded = readDocument(next.value, { registry });
  assert.ok(loaded.ok, JSON.stringify(loaded));
  return loaded.value;
}
test("drawn curves, named locations and pulls survive document validation at part-local coordinates", () => {
  const root = source.parts[0];
  assert.ok(root);
  const path = drawAppendage(
    root,
    [
      [0, 0, 0],
      [0.08, 0.12, 0],
      [0, 0.25, 0.1],
    ],
    "Tail",
    0.04,
    "#956a48",
  );
  let doc = apply(source, [
    { op: "part.add", part: path },
    markLocation(root, "Ear", [0.1, 0, 0]),
    pullPart(root, [0.1, 0, 0], [0, 0.05, 0], [0.12, 0.12, 0.12]),
  ]);
  const host = doc.parts.find((p) => p.id === root.id);
  assert.ok(host);
  assert.deepEqual(figureLocations.read(host.features)?.marks[0]?.at, [0.1, 0, 0]);
  assert.equal(figurePulls.read(host.features)?.pulls.length, 1);
  doc = apply(doc, [moveControl(path, "Spine", 1, [0.08, 0.1, 0])]);
  const moved = doc.parts.find((p) => p.id === path.id);
  assert.ok(moved);
  assert.deepEqual(figureSweep.read(moved.features)?.knots[1]?.slice(0, 3), [0.08, 0.1, 0]);
  assert.throws(() =>
    drawAppendage(
      root,
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
      "Horn",
      0.04,
      "#987654",
    ),
  );
});
test("a pleated sweep opens below the slit and keeps finite front and lining surfaces", () => {
  const carrier = addDetail(undefined, "sweep");
  const sweep = figureSweep.read(carrier.features);
  assert.ok(sweep);
  const drape = { folds: 8, depth: 0.12, twist: 0.2, slit: 0.2, slitHeight: 0.6 };
  const base = sweepGeometry(sweep.knots);
  const original = base.getAttribute("position").array.slice();
  const folded = pleat(base, sweep.knots, drape);
  assert.notDeepEqual(folded.getAttribute("position").array, original);
  const hem = splitHem(folded, sweep.knots, drape);
  assert.ok(hem.getAttribute("position").count > folded.getAttribute("position").count);
  assert.ok(hem.getAttribute("normal").array.every(Number.isFinite));
  assert.ok(hem.getAttribute("position").array.every(Number.isFinite));
  const bands = (sweep.knots.length - 1) * 5;
  const panelStride = 6;
  const adjacent = 2 * (bands + 1) * panelStride;
  const uv = hem.getAttribute("uv");
  assert.ok(uv.getX(adjacent) - uv.getX(panelStride - 1) > 0.19);
  assert.equal(uv.getX(adjacent + bands * 11), uv.getX((bands + 1) * panelStride - 1));
  hem.dispose();
});
test("adjusting a plate field reuses occupied sites and preserves unrelated parts", () => {
  const carrier = addDetail(undefined, "sweep");
  let doc = apply(source, [{ op: "part.add", part: carrier }]);
  doc = apply(doc, arrangePlates(doc, carrier.id, 4, 3, "Back", "#a78e68", true));
  assert.doesNotThrow(() => buildView(doc));
  const ids = doc.parts.filter((p) => p.parent === carrier.id).map((p) => p.id);
  assert.equal(ids.length, 12);
  doc = apply(doc, arrangePlates(doc, carrier.id, 2, 3, "Left", "#876534", true));
  const kept = doc.parts.filter((p) => p.parent === carrier.id);
  assert.equal(kept.length, 6);
  assert.ok(kept.every((p) => ids.includes(p.id) && figurePlateSite.read(p.features)));
  doc = apply(doc, arrangePlates(doc, carrier.id, 2, 1, "Front", "#665544", false));
  assert.equal(doc.parts.length, source.parts.length + 9);
});
test("graft remaps descendants, cage edits preserve valid faces, and resize keeps the attachment basis", () => {
  const root = source.parts[0];
  assert.ok(root);
  const cage = addDetail(root, "cage"),
    child = addDetail(cage, "scute");
  let donor = apply(source, [
    { op: "part.add", part: cage },
    { op: "part.add", part: child },
  ]);
  assert.ok(apply(donor, [cageFace(cage, 0, "Tunnel", 0.3, 1)]));
  donor = apply(donor, [cageFace(cage, 1, "Inset", 0.25)]);
  const selected = donor.parts.find((p) => p.id === cage.id);
  assert.ok(selected);
  assert.equal(figureCage.read(selected.features)?.faces.length, 10);
  const doc = apply(source, graftBranch(donor, selected, source, root, [0.1, 0.3, 0]));
  const graft = doc.parts.find(
    (p) => p.parent === root.id && p.position[1] === 0.3 && p.label === selected.label,
  );
  assert.ok(graft);
  assert.ok(doc.parts.some((p) => p.parent === graft.id));
  assert.notEqual(graft.id, cage.id);
  assert.equal(apply(doc, resizeCharacter(doc, 2, 2.1)).parts.length, doc.parts.length);
});

test("picked anchor stays seated after rotation and scaling under a different parent", () => {
  const host = source.parts[0];
  assert.ok(host);
  const root = addDetail(host, "sweep"),
    child = addDetail(root, "cage");
  const doc = apply(source, [
    { op: "part.add", part: root },
    { op: "part.add", part: child },
  ]);
  const world = new T.Matrix4().makeRotationY(0.6).setPosition(0.08, 0.34, -0.02);
  const mount = new T.Matrix4().makeScale(1.5, 2, 1).setPosition(0.12, 0.05, 0.04);
  const pin = new T.Vector3(0.01, 0.18, 0.02);
  const opt = {
    anchor: pin.clone().applyMatrix4(world).toArray(),
    point: [0.18, 0.6, 0.2] as const,
    normal: [0, 0, 1] as const,
    axis: [0, 1, 0] as const,
    depth: 0.06,
    twist: 82,
    scale: 1.6,
    copy: true,
  };
  for (const copy of [true, false]) {
    const result = placeBranch(doc, root, host, world, mount, { ...opt, copy });
    const next = apply(doc, result.ops),
      placed = next.parts.find((p) => p.id === result.id);
    assert.ok(placed);
    const matrix = new T.Matrix4().compose(
      new T.Vector3(...placed.position),
      new T.Quaternion(...placed.rotation),
      new T.Vector3(...placed.size),
    );
    assert.ok(
      pin
        .clone()
        .applyMatrix4(matrix)
        .applyMatrix4(mount)
        .distanceTo(new T.Vector3(0.18, 0.6, 0.14)) < 1e-6,
    );
    assert.equal(next.parts.filter((p) => p.parent === result.id).length, 1);
    assert.equal(next.parts.length, doc.parts.length + (copy ? 2 : 0));
  }
  assert.throws(
    () => placeBranch(doc, root, child, world, mount, { ...opt, copy: false }),
    /outside/,
  );
  const pair = drawBranches(
    doc,
    host,
    [
      [0.2, 0.5, 0],
      [0.35, 0.6, 0],
      [0.52, 0.7, 0],
    ],
    "Fin",
    0.1,
    "#cb8755",
    true,
    () => new T.Matrix4(),
  );
  assert.equal(pair.length, 2);
  assert.deepEqual(
    pair.map((p) => p.position[0]),
    [0.2, -0.2],
  );
  assert.ok(
    apply(
      doc,
      pair.map((part) => ({ op: "part.add", part })),
    ),
  );
});
test("branch copies duplicate active layers, saved outfits and joint poses on descendant IDs", () => {
  const host = source.parts[0];
  assert.ok(host);
  const root = addDetail(host, "cage"),
    child = addDetail(root, "sweep");
  const layers = { [child.id]: { show: true, order: 2, dye: "#aabbcc" } };
  const joint = { part: child.id, station: 0, shift: [0.02, 0, 0] as const };
  const doc = apply(source, [
    { op: "part.add", part: root },
    { op: "part.add", part: child },
    {
      op: "pose.set",
      pose: {
        id: "pose-bend",
        label: "Bend",
        joints: [{ part: child.id, rotation: child.rotation }],
      },
    },
    { op: "feature.set", feature: outfitLayers.id, value: { layers } },
    {
      op: "feature.set",
      feature: outfitLooks.id,
      value: { looks: [{ name: "Evening", base: "Anatomy", layers }] },
    },
    {
      op: "feature.set",
      feature: motionPoses.id,
      value: { poses: [{ name: "Turn", joints: [joint] }] },
    },
  ]);
  const world = new T.Matrix4();
  const opts = {
    copy: true,
    scale: 1,
    depth: 0,
    twist: 0,
    anchor: [0, 0, 0],
    point: [0, 1, 0],
    normal: [0, 0, 1],
    axis: [0, 1, 0],
  } as const;
  const result = placeBranch(doc, root, host, world, world, opts),
    copy = apply(doc, result.ops);
  const tip = copy.parts.find((p) => p.parent === result.id);
  assert.ok(tip);
  assert.ok(copy.poses.find((p) => p.id === "pose-bend")?.joints.some((j) => j.part === tip.id));
  assert.deepEqual(outfitLayers.read(copy.features)?.layers[tip.id], layers[child.id]);
  assert.deepEqual(outfitLooks.read(copy.features)?.looks[0]?.layers[tip.id], layers[child.id]);
  assert.deepEqual(motionPoses.read(copy.features)?.poses[0]?.joints, [
    joint,
    { ...joint, part: tip.id },
  ]);
  const full = { ...doc, parts: Array.from({ length: 128 }, (_, i) => doc.parts[i] ?? host) };
  assert.throws(() => placeBranch(full, root, host, world, world, opts), /128/);
  assert.throws(
    () =>
      drawBranches(
        full,
        host,
        [
          [0, 0, 0],
          [0.1, 0, 0],
        ],
        "Horn",
        0.02,
        "#123456",
        true,
        () => world,
      ),
    /128/,
  );
});
test("drawing seats the root, lifts the stroke, filters jitter and retains its endpoints when decimating", () => {
  const stroke = branchStroke([1, 2, 3], [0, 0, 1], 0.1);
  assert.deepEqual(stroke.points[0], [1, 2, 2.965]);
  assert.equal(stroke.sample([1, 2, 3]), false);
  assert.equal(stroke.sample([1.1, 2, 3]), true);
  assert.equal(stroke.sample([1.101, 2, 3]), false);
  assert.ok(Math.abs((stroke.points[1]?.[2] ?? 0) - 3.04) < 1e-8);
  for (let i = 0; i < 600; i++) stroke.sample([1.2 + i * 0.01, 2, 3]);
  assert.ok(stroke.points.length <= 255);
  assert.deepEqual(stroke.points[0], [1, 2, 2.965]);
  assert.deepEqual(stroke.points.at(-1), [1.2 + 599 * 0.01, 2, 3.045]);
});
test("opposite named parents receive mirrored strokes and the minimum brush radius preserves the horn tip", () => {
  const host = source.parts[0];
  assert.ok(host);
  const left = { ...addDetail(host, "sweep"), label: "Left shin" },
    right = { ...addDetail(host, "sweep"), label: "Right shin" };
  const doc = apply(source, [
    { op: "part.add", part: left },
    { op: "part.add", part: right },
  ]);
  const pair = drawBranches(
    doc,
    left,
    [
      [0.12, 0, 0],
      [0.16, 0.1, 0],
    ],
    "Horn",
    0.005,
    "#f1aaad",
    true,
    () => new T.Matrix4(),
  );
  assert.deepEqual(
    pair.map((p) => p.parent),
    [left.id, right.id],
  );
  const next = apply(
    doc,
    pair.map((part) => ({ op: "part.add", part })),
  );
  const part = next.parts.find((p) => p.id === pair[1]?.id);
  assert.ok(part);
  assert.equal(motionRole.read(part.features)?.role, "rigid");
  assert.ok(Math.abs((figureSweep.read(part.features)?.knots.at(-1)?.[3] ?? 0) - 0.000125) < 1e-8);
  assert.throws(
    () =>
      drawAppendage(
        left,
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
        "Horn",
        0.001,
        "#abcdef",
      ),
    /valid radius/,
  );
  const field = { at: [0, 0, 0], offset: [0.02, 0, 0], reach: [0.1, 0.1, 0.1] } as const;
  const capped = {
    ...host,
    features: {
      ...host.features,
      [figurePulls.id]: figurePulls.json({ pulls: Array.from({ length: 64 }, () => field) }),
    },
  };
  assert.throws(() => pullPart(capped, field.at, field.offset, field.reach), /64/);
});
test("mirrored part preview affects both lobes and cancellation restores the original geometry", () => {
  const root = new T.Mesh(new T.SphereGeometry(1, 32, 24)),
    child = new T.Mesh(new T.SphereGeometry());
  child.userData["partId"] = "child";
  root.add(child);
  const original = root.geometry,
    other = child.geometry,
    preview = previewPull(root);
  preview.apply({
    at: [0.5, 0, 0.85],
    offset: [0.3, 0, 0],
    reach: [0.6, 0.6, 0.6],
    mirrorX: mirrorCentre(root),
  });
  const before = original.getAttribute("position"),
    after = root.geometry.getAttribute("position");
  let positive = 0,
    negative = 0;
  for (let i = 0; i < before.count; i++) {
    const dx = after.getX(i) - before.getX(i);
    positive = Math.max(positive, dx);
    negative = Math.min(negative, dx);
  }
  assert.ok(positive > 0.2 && negative < -0.2);
  assert.equal(child.geometry, other);
  preview.restore();
  assert.equal(root.geometry, original);
});

test("moving or copying a fitted plate reseats it and maps its vertices into the receiving paint", () => {
  const host = source.parts[0];
  assert.ok(host);
  const seed = addDetail(host, "scute");
  const mount = {
    position: [0, 0, 0.12] as const,
    rotation: seed.rotation,
    size: [0.1, 0.14, 0.04] as const,
  };
  const doc = apply(source, [
    {
      op: "part.add",
      part: {
        ...seed,
        ...mount,
        features: { ...seed.features, [figureScute.id]: figureScute.json({ mount }) },
      },
    },
  ]);
  const plate = doc.parts.find((p) => p.id === seed.id);
  assert.ok(plate);
  const shape = scuteGeometry(mount, [
    [0, -0.2, 0, 0.14, 0.08],
    [0.03, 0.2, 0.02, 0.1, 0.15],
  ]);
  for (const attr of ["position", "uv"]) {
    const values = Array.from(shape.getAttribute(attr).array);
    assert.ok(values.every(Number.isFinite));
    assert.notDeepEqual(values, Array.from(scuteGeometry().getAttribute(attr).array));
  }
  const world = new T.Matrix4().compose(
    new T.Vector3(...mount.position),
    new T.Quaternion(...mount.rotation),
    new T.Vector3(...mount.size),
  );
  for (const copy of [false, true]) {
    const result = placeBranch(doc, plate, host, world, new T.Matrix4(), {
      copy,
      scale: 1.5,
      twist: 25,
      depth: 0.006,
      normal: [0, 0, 1],
      axis: [0, 0, 1],
      anchor: mount.position,
      point: [0.04, 0.1, 0.12],
    });
    const placed = apply(doc, result.ops).parts.find((p) => p.id === result.id);
    assert.ok(placed);
    const seated = figureScute.read(placed.features)?.mount;
    assert.deepEqual(seated, {
      position: placed.position,
      rotation: placed.rotation,
      size: placed.size,
    });
    assert.notDeepEqual(seated, mount);
  }
});

test("individual tip seeds change only the distal mesh, survive field rerolls and release to the new seed", () => {
  const carrier = addDetail(undefined, "sweep");
  let doc = apply(source, [{ op: "part.add", part: carrier }]);
  doc = apply(doc, growPlateField(doc, carrier, { rows: 2, columns: 3, seed: 992, tipSeed: 321 }));
  const plate = doc.parts.find((p) => p.parent === carrier.id);
  assert.ok(plate);
  const before = figureCage.read(plate.features);
  assert.ok(before);
  const find = () => {
    const p = doc.parts.find((q) => q.id === plate.id);
    assert.ok(p);
    return p;
  };
  doc = apply(doc, changePlateTip(doc, plate, 77));
  const pinned = figureCage.read(find().features);
  assert.ok(pinned);
  assert.deepEqual(pinned.vertices.slice(0, 56), before.vertices.slice(0, 56));
  assert.notDeepEqual(pinned.vertices, before.vertices);
  assert.deepEqual(find().position, plate.position);
  const host = doc.parts.find((p) => p.id === carrier.id);
  assert.ok(host);
  doc = apply(doc, growPlateField(doc, host, { tipSeed: 11 }));
  assert.deepEqual(figureCage.read(find().features), pinned);
  doc = apply(doc, changePlateTip(doc, find(), null));
  assert.notDeepEqual(figureCage.read(find().features), pinned);
  assert.equal(figurePlateSite.read(find().features)?.tipSeed, undefined);
  const latest = doc.parts.find((p) => p.id === host.id);
  assert.ok(latest);
  assert.equal(figurePlateField.read(latest.features)?.tipSeed, 11);
  doc = apply(doc, [cageFace(find(), 0, "Inset", 0.2)]);
  assert.throws(() => changePlateTip(doc, find(), 717), /custom topology/);
});
test("a single repeated row accepts even columns and equipped rows have a rigid base join", () => {
  const carrier = addDetail(undefined, "sweep"),
    doc = apply(source, [{ op: "part.add", part: carrier }]);
  const plates = repeatedPlates(doc, carrier, 1, 4, "Top", 0.19, true, "#bc8811");
  assert.equal(plates.length, 4);
  for (const part of plates) {
    assert.deepEqual(part.size, [0.171, 0.171 * 1.18, 0.171 * 0.34]);
    assert.ok(part.position.every(Number.isFinite));
    assert.ok(outfitWear.read(part.features)?.visibleIn);
    assert.equal(figureJoin.read(part.features)?.end, "base");
    assert.equal(motionRole.read(part.features)?.role, "rigid");
    assert.equal(part.color, "#bc8811");
  }
  assert.throws(
    () =>
      repeatedPlates(
        { ...doc, parts: Array.from({ length: 127 }, () => carrier) },
        carrier,
        1,
        2,
        "Front",
        0.1,
      ),
    /limit/,
  );
});

test("editing a field from an older desktop save upgrades the cage in place and preserves a sculpted control", () => {
  const host = addDetail(undefined, "sweep"),
    field = {
      ...plateDefaults,
      seed: 0,
      tipSeed: 0,
      rows: 3,
      columns: 1 as const,
      direction: "last" as const,
    };
  const carrier = {
    ...host,
    features: { ...host.features, [figurePlateField.id]: figurePlateField.json(field) },
  };
  const base = addDetail(host, "cage"),
    site = { row: 1, column: 0 },
    pose = legacyPlateLayout(carrier, field).get("1/0");
  assert.ok(pose);
  const cage = legacyPlateCage(1, 0),
    plate = {
      ...base,
      position: pose.position,
      rotation: pose.rotation,
      size: pose.size,
      color: field.color,
      features: {
        ...base.features,
        [figurePlateSite.id]: figurePlateSite.json(site),
        [figureCage.id]: figureCage.json(cage),
      },
    };
  const doc = { ...source, parts: [...source.parts, carrier, plate] };
  const updated = apply(doc, changePlateTip(doc, plate, 276));
  const changed = updated.parts.find((p) => p.id === plate.id);
  assert.ok(changed);
  assert.equal(figurePlateSite.read(changed.features)?.tipSeed, 276);
  assert.deepEqual(changed.size, [1, 1, 1]);
  assert.notDeepEqual(figureCage.read(changed.features)?.vertices, cage.vertices);
  const sculpted = {
    ...plate,
    features: {
      ...plate.features,
      [figureCage.id]: figureCage.json({
        ...cage,
        vertices: cage.vertices.map((v, i) => (i === 3 ? [v[0] + 0.2, v[1], v[2]] : v)),
      }),
    },
  };
  const custom = apply(
    { ...doc, parts: [...source.parts, carrier, sculpted] },
    changePlateTip(doc, sculpted, 276),
  );
  const retained = custom.parts.find((p) => p.id === plate.id);
  assert.ok(retained);
  const a = figureCage.read(changed.features)?.vertices,
    b = figureCage.read(retained.features)?.vertices;
  assert.ok(a && b);
  assert.notDeepEqual(a[3], b[3]);
  assert.deepEqual(a[4], b[4]);
});

test("moving a spine point refits grown cages in the same edit without rotating them twice", () => {
  const carrier = addDetail(undefined, "sweep"),
    base = apply(source, [{ op: "part.add", part: carrier }]);
  const doc = apply(
    base,
    growPlateField(base, carrier, { rows: 4, columns: 3, seed: 5, tipSeed: 23 }),
  );
  const host = doc.parts.find((p) => p.id === carrier.id);
  assert.ok(host);
  const point = [0.15, 0.2, 0.03] as const;
  const changed = apply(doc, moveSpine(doc, host, 1, point));
  const sculpted = changed.parts.find((p) => p.id === host.id);
  assert.ok(sculpted);
  assert.deepEqual(figurePlateField.read(sculpted.features)?.rest?.knots[1]?.slice(0, 3), point);
  const useStoredChart = apply(changed, growPlateField(changed, sculpted, {}));
  assert.deepEqual(useStoredChart.parts, changed.parts);
  const plate = changed.parts.find((p) => p.parent === host.id && figurePlateSite.read(p.features));
  const original = doc.parts.find((p) => p.id === plate?.id);
  assert.ok(plate && original);
  assert.deepEqual(plate.rotation, original.rotation);
  assert.notDeepEqual(figureCage.read(plate.features), figureCage.read(original.features));
});

test("field validation protects duplicate sites, attached surplus plates, short carriers and the part limit", () => {
  const carrier = addDetail(undefined, "sweep");
  const base = apply(source, [{ op: "part.add", part: carrier }]);
  const doc = apply(
    base,
    growPlateField(base, carrier, { rows: 4, columns: 3, seed: 5, tipSeed: 23 }),
  );
  const host = doc.parts.find((p) => p.id === carrier.id),
    plate = doc.parts.find((p) => figurePlateSite.read(p.features)?.row === 3);
  assert.ok(host && plate);
  const duplicate = { ...plate, id: addDetail(host, "cage").id };
  assert.throws(
    () => growPlateField({ ...doc, parts: [...doc.parts, duplicate] }, host, { rows: 3 }),
    /duplicate/i,
  );
  const attachment = addDetail(plate, "scute");
  assert.throws(
    () => growPlateField({ ...doc, parts: [...doc.parts, attachment] }, host, { rows: 3 }),
    /attachments/i,
  );
  const short = {
    ...carrier,
    features: {
      ...carrier.features,
      [figureSweep.id]: figureSweep.json({
        knots: [
          [0, 0, 0, 0.1, 0.1],
          [0.001, 0, 0, 0.1, 0.1],
        ],
      }),
    },
  };
  assert.throws(() => growPlateField(base, short, { rows: 2, columns: 1 }), /longer/);
  const packed = { ...base, parts: Array.from({ length: 127 }, () => carrier) };
  assert.throws(() => growPlateField(packed, carrier, { rows: 3, columns: 3 }), /128/);
});
