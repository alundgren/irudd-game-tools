import test from "node:test";
import assert from "node:assert/strict";
import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  SphereGeometry,
  Group,
} from "three";
import { sweepGeometry } from "./surface.js";
import { splitHem } from "./drapery.js";
import { fitGarment } from "./garment-fit.js";
import { extractComponent, placeComponent } from "./graft.js";
import { drawBranch } from "./branch-stroke.js";
import { startingForm, validateForm } from "./recipe.js";

test("a split coat opens at the hem, remains closed at the waist, and has an inner surface", () => {
  const knots = [
    [0, 0, 0, 0.45, 0.3],
    [0, 0.5, 0, 0.38, 0.26],
    [0, 1, 0, 0.3, 0.24],
  ];
  const geometry = splitHem(sweepGeometry(knots, true, 64), knots, {
    slit: 0.18,
    slitHeight: 0.65,
  });
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
  const hits = (x, y) =>
    new Raycaster(new Vector3(x, y, 2), new Vector3(0, 0, -1)).intersectObject(
      mesh,
    ).length;
  assert.equal(hits(0.004, 0.12), 0);
  assert.ok(hits(0.22, 0.12) >= 4);
  assert.ok(hits(0.004, 0.85) >= 4);
  mesh.material.dispose();
  geometry.dispose();
});

test("a worn component fits its full assembly, preserves the wearer and follows a wardrobe", () => {
  const host = {
    id: "body",
    shape: "ellipsoid",
    position: [0, 1, 0],
    rotation: [0, 0, 0],
    size: [0.6, 0.8, 0.35],
    color: "#534535",
  };
  const body = { ...startingForm(() => 0.5), parts: [host] };
  const panel = {
    ...host,
    id: "lower panel",
    position: [0, 0.2, 0],
    size: [0.5, 0.4, 0.3],
    frameSize: [0.5, 0.4, 0.3],
  };
  const collar = {
    ...host,
    id: "upper collar",
    parent: panel.id,
    position: [0, 0.34, 0],
    size: [0.37, 0.36, 0.28],
  };
  const donor = { ...body, parts: [panel, collar] };
  const added = placeComponent(body, extractComponent(donor, panel.id), {
    target: host.id,
    mode: "wear",
  });
  validateForm(added.form);
  assert.deepEqual(added.form.parts[0], host);
  const garment = extractComponent(added.form, added.id);
  assert.ok(
    Math.abs(garment.bounds[1][1] - garment.bounds[0][1] - 0.8 * 1.015) < 1e-6,
  );
  assert.ok(
    added.form.parts
      .slice(1)
      .every(
        (p) =>
          p.visibleIn.includes("Work clothes") &&
          !p.visibleIn.includes("Base layer"),
      ),
  );
});

test("garment clearance acts on the wearable and keeps shared source geometry intact", () => {
  const geo = new SphereGeometry(0.5, 36, 24),
    mat = new MeshBasicMaterial();
  const host = new Mesh(geo, mat);
  host.userData.partId = "host";
  const group = new Group();
  group.userData.partId = "garment";
  host.add(group);
  const panel = new Mesh(geo, mat);
  panel.scale.set(0.87, 1, 0.87);
  group.add(panel);
  host.updateMatrixWorld(true);
  const original = geo.attributes.position.array.slice();
  fitGarment(host, group);
  assert.notEqual(panel.geometry, geo);
  assert.deepEqual(geo.attributes.position.array, original);
  const v = new Vector3();
  let radius = 0;
  for (let i = 0; i < panel.geometry.attributes.position.count; i++) {
    panel.localToWorld(
      v.fromBufferAttribute(panel.geometry.attributes.position, i),
    );
    if (Math.abs(v.y) < 0.02) radius = Math.max(radius, Math.hypot(v.x, v.z));
  }
  assert.ok(radius > 0.502);
  geo.dispose();
  panel.geometry.dispose();
  mat.dispose();
});

test("drawn strokes replay as tapered, mirrored child geometry in metric space", () => {
  const form = startingForm(() => 0.5);
  const options = {
    kind: "Horn",
    radius: 0.032,
    mirror: true,
    color: "#786540",
  };
  const points = [
    [0.08, 1.75, 0.02],
    [0.16, 1.81, 0.04],
    [0.18, 1.9, 0.05],
    [0.13, 1.98, 0.07],
  ];
  const result = drawBranch(form, "head", points, options);
  assert.deepEqual(drawBranch(form, "head", points, options), result);
  validateForm(result.form);
  assert.equal(result.form.parts.length, form.parts.length + 2);
  const [left, right] = result.form.parts.slice(-2);
  assert.equal(left.parent, "head");
  assert.equal(right.parent, "head");
  assert.ok(left.knots.at(-1)[3] < left.knots[0][3] * 0.05);
  assert.ok(
    left.knots.every((p, i) => Math.abs(p[0] + right.knots[i][0]) < 1e-8),
  );
});
