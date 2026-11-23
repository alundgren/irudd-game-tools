import test from "node:test";
import assert from "node:assert/strict";
import {
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  SphereGeometry,
  Vector3,
  AnimationMixer,
} from "three";
import { blendSkin } from "./blended-skin.js";
import { skinCharacter } from "./skin.js";
import { startingForm } from "./recipe.js";

test("joining organic regions removes the interior walls and preserves the moving seam", () => {
  const mat = new MeshStandardMaterial({ side: DoubleSide }),
    group = new Group(),
    objects = new Map();
  const form = startingForm(() => 0.5);
  form.parts = [
    {
      id: "trunk",
      position: [0, 0.6, 0],
      size: [0.7, 0.5, 0.65],
      shape: "ellipsoid",
      rotation: [0, 0, 0],
      color: "#556b43",
      motionRole: "torso",
      blendSkin: true,
    },
    {
      id: "flipper",
      parent: "trunk",
      position: [0.43, 0.04, 0],
      size: [0.75, 0.35, 0.38],
      shape: "ellipsoid",
      rotation: [0, 0, 0],
      color: "#556b43",
      motionRole: "wing",
      blendSkin: true,
    },
  ];
  for (const r of form.parts) {
    const m = new Mesh(new SphereGeometry(0.5, 36, 28), mat);
    m.userData.partId = r.id;
    m.position.fromArray(r.position);
    m.scale.fromArray(r.size);
    (objects.get(r.parent) ?? group).add(m);
    objects.set(r.id, m);
  }
  group.updateMatrixWorld(true);
  const ray = new Raycaster(
    new Vector3(-1, 0.623, 0.009),
    new Vector3(1, 0, 0),
  );
  const through = () => ray.intersectObject(group, true).length;
  assert.equal(through(), 4);
  blendSkin(form, objects, () => mat);
  assert.equal(through(), 2);
  const mix = Array.from(objects.get("trunk").blendOwners.weight);
  assert.ok(mix.some((w) => w > 0.51 && w < 0.85));
  const rig = skinCharacter(form, group),
    mesh = rig.actor.children.find((o) => o.isSkinnedMesh);
  const p = mesh.geometry.attributes.position,
    w = mesh.geometry.attributes.skinWeight,
    i = mesh.geometry.attributes.skinIndex;
  for (let k = 0; k < p.count; k++)
    assert.ok(
      Math.abs(w.getX(k) + w.getY(k) + w.getZ(k) + w.getW(k) - 1) < 1e-5,
    );
  const coincident = new Map(),
    seam = [];
  for (let k = 0; k < p.count; k++) {
    if (w.getZ(k) + w.getW(k) < 0.05) continue;
    const key = [p.getX(k), p.getY(k), p.getZ(k)]
      .map((x) => Math.round(x * 1e5))
      .join("/");
    if (coincident.has(key) && seam.length < 600)
      seam.push([coincident.get(key), k]);
    else coincident.set(key, k);
  }
  assert.ok(seam.length > 10);
  const mixer = new AnimationMixer(rig.actor);
  mixer.clipAction(rig.clips.find((c) => c.name === "Walk")).play();
  mixer.update(0.25);
  rig.actor.updateMatrixWorld(true);
  mesh.skeleton.update();
  const a = new Vector3(),
    b = new Vector3();
  for (const [left, right] of seam) {
    mesh.getVertexPosition(left, a);
    mesh.getVertexPosition(right, b);
    assert.ok(a.distanceTo(b) < 0.0002);
  }
  rig.dispose();
  for (const m of objects.values()) m.geometry.dispose();
  mat.dispose();
});
