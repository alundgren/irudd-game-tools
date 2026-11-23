import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh } from "three";
import { clearFaceHardware } from "./face-hardware.js";

test("a rigid frame clears a scaled face while the ends of the side arms stay on their mounts", () => {
  const head = new Group(),
    face = new Mesh(new BoxGeometry(0.2, 0.25, 0.2)),
    rim = new Mesh(new BoxGeometry(0.1, 0.06, 0.01)),
    arm = new Mesh(new BoxGeometry(0.01, 0.01, 0.15));
  head.add(face, rim, arm);
  head.scale.z = 2;
  rim.position.z = 0.082;
  arm.position.z = 0.005;
  const named = (object, clearance) => ({
    object,
    part: { rigidFaceAnchor: [0, 0.1, 0.4], faceClearance: clearance },
  });
  const items = [named(rim, 0.004), named(arm, undefined)];
  const bounds = (m) => {
    m.geometry.computeBoundingBox();
    return m.geometry.boundingBox;
  };
  const oldRear = bounds(arm).min.z;
  head.updateMatrixWorld(true);
  clearFaceHardware(face, items);
  assert.ok(
    Math.abs((bounds(rim).min.z + rim.position.z - 0.1) * 2 - 0.004) < 1e-6,
  );
  assert.ok(Math.abs(bounds(arm).min.z - oldRear) < 1e-7);
  assert.ok(bounds(arm).max.z > 0.09);
  const first = rim.geometry.attributes.position.array.slice();
  clearFaceHardware(face, items);
  assert.deepEqual(rim.geometry.attributes.position.array, first);
});
