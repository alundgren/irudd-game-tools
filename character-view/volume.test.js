import test from "node:test";
import assert from "node:assert/strict";
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { volumeGeometry } from "./volume.js";
import { startingForm, validateForm } from "./recipe.js";

test("exportable volume has an actual opening, separate islands and metric heights", () => {
  const solid = [[-0.5, 0.5]],
    sides = [[-0.2, 0.2]],
    rim = [
      [-0.5, -0.28],
      [0.28, 0.5],
    ];
  const rows = [
    [0, solid, sides],
    [0.12, solid, sides],
    [0.18, rim, sides],
    [0.59, rim, sides],
    [0.65, solid, sides],
    [0.7, solid, sides],
    [0.76, [], []],
    [0.84, [], []],
    [0.91, solid, sides],
    [1, solid, sides],
  ];
  const hull = {
    atlas: "test",
    frames: Array.from({ length: 4 }, () => [0.5, 0.98, 0.9]),
    height: 2,
    pivot: [0, 0, 0],
    resolution: 48,
    rows,
  };
  const part = {
    id: "shell",
    shape: "volume",
    hull,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: [1, 1, 1],
    color: "#808080",
  };
  const form = startingForm(() => 0.5);
  form.parts = [part];
  validateForm(form);
  const geo = volumeGeometry(hull),
    mat = new MeshBasicMaterial({ side: DoubleSide }),
    mesh = new Mesh(geo, mat);
  const hits = (x, y) =>
    new Raycaster(new Vector3(x, y, 3), new Vector3(0, 0, -1)).intersectObject(
      mesh,
    ).length;
  assert.equal(hits(0.013, 0.75), 0);
  assert.ok(hits(0.78, 0.75) >= 2);
  assert.equal(hits(0.014, 1.6), 0);
  assert.ok(hits(0.014, 1.94) >= 2);
  assert.ok(Math.abs(geo.boundingBox.max.y - 2) < 0.04);
  geo.dispose();
  mat.dispose();
  const invalid = structuredClone(form);
  invalid.parts[0].hull.rows[2][1] = [[0.3, -0.4]];
  assert.throws(() => validateForm(invalid));
});
test("a membrane keeps a slanted, thin cross section between its two supplied projections", () => {
  const hull = {
    atlas: "test",
    height: 1,
    pivot: [0, 0, 0],
    resolution: 56,
    frames: Array.from({ length: 4 }, () => [0.5, 0.98, 0.9]),
    rows: [0, 0.25, 0.5, 0.75, 1].map((y) => [y, [[-0.5, 0.5]], [[-0.3, 0.3]]]),
    membrane: { slope: -1, thickness: 0.024 },
  };
  const mat = new MeshBasicMaterial({ side: DoubleSide }),
    mesh = new Mesh(volumeGeometry(hull), mat);
  function cross(x) {
    const hits = new Raycaster(
      new Vector3(x, 0.49, 2),
      new Vector3(0, 0, -1),
    ).intersectObject(mesh);
    assert.ok(hits.length >= 2);
    return [hits.at(-1).point.z, hits[0].point.z];
  }
  const left = cross(-0.28),
    right = cross(0.28);
  assert.ok(left[0] > 0.1 && right[1] < -0.1);
  assert.ok(left[1] - left[0] < 0.07);
  mesh.geometry.dispose();
  mat.dispose();
});
