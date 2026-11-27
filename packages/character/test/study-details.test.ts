import assert from "node:assert/strict";
import { test } from "node:test";
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { FigureBuild, FigureSweep, Knot } from "@irudd/document";
import { whiteVertexColors } from "../src/rig/skin.js";
import { sectionFit } from "../src/surfaces/section-fit.js";
import { applyRadialFit, suctionCups } from "../src/surfaces/study-details.js";

type Profile = NonNullable<FigureBuild["sectionProfile"]>;
type Station = Profile["stations"][number];
const profile = (station: Station): Profile => ({
  height: 1.7,
  stations: Array.from({ length: 14 }, () => station),
});
const near = (a: T.Vector3, b: T.Vector3) => a.distanceTo(b) < 1e-9;

test("a neutral section profile leaves the body in place", () => {
  const fit = sectionFit(profile([1, 1, 0, 0]), []);
  for (const point of [
    new T.Vector3(0.1, 0.4, 0.05),
    new T.Vector3(-0.2, 1.2, -0.1),
    new T.Vector3(0.05, 1.68, 0.12),
  ])
    assert.ok(near(fit(point.clone()), point));
});

test("a section profile scales width and depth and shifts the centre by the body height", () => {
  const fit = sectionFit(profile([1.2, 0.9, 0.01, -0.02]), []);
  const out = fit(new T.Vector3(0.1, 0.8, 0.2));
  assert.ok(near(out, new T.Vector3(0.1 * 1.2 + 0.017, 0.8, 0.2 * 0.9 - 0.034)));
});

test("a section profile carries each arm with its shoulder and wrist instead of the torso warp", () => {
  const joints = (["left", "right"] as const).flatMap((side, k) => {
    const x = k ? -1 : 1;
    return [
      [side + " upper arm", new T.Vector3(0.19 * x, 1.42, 0)],
      [side + " forearm", new T.Vector3(0.26 * x, 1.15, 0.02)],
      [side + " hand", new T.Vector3(0.3 * x, 0.88, 0.04)],
    ] as const;
  });
  const stations = profile([1, 1, 0, 0]).stations.map((_, i): Station => [
    1 + i * 0.02,
    1 - i * 0.01,
    0,
    0,
  ]);
  const shape = { height: 1.7, stations };
  const torso = sectionFit(shape, []);
  const arms = sectionFit(shape, joints);
  const [, shoulder] = joints[0] ?? [];
  const [, elbow] = joints[1] ?? [];
  const [, wrist] = joints[2] ?? [];
  assert.ok(shoulder && elbow && wrist);
  const t = (shoulder.y - elbow.y) / (shoulder.y - wrist.y);
  const carried = torso(shoulder.clone())
    .sub(shoulder)
    .lerp(torso(wrist.clone()).sub(wrist), t)
    .add(elbow);
  assert.ok(arms(elbow.clone()).distanceTo(carried) < 1e-4);
  assert.ok(torso(elbow.clone()).distanceTo(carried) > 1e-3);
  const chest = new T.Vector3(0, 1.3, 0.08);
  assert.ok(near(arms(chest.clone()), torso(chest.clone())));
});

type RadialFit = NonNullable<FigureSweep["radialFit"]>;
const radial = (inner: number): RadialFit => ({
  bottom: 0,
  step: 0.25,
  rows: [0, 1, 2, 3, 4].map((i) => Array.from({ length: 8 }, () => (i % 4 ? inner : 0))),
});

test("a radial fit pushes rings out between its fixed end rows", () => {
  const geometry = new T.CylinderGeometry(0.2, 0.2, 1, 16, 8).translate(0, 0.5, 0);
  applyRadialFit(geometry, radial(0.03));
  const p = geometry.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getZ(i)),
      y = p.getY(i);
    if (r < 0.01) continue;
    if (y > 0.3 && y < 0.7) assert.ok(Math.abs(r - 0.23) < 1e-6);
    if (y < 1e-6) assert.ok(Math.abs(r - 0.2) < 1e-6);
  }
});

const arm: Knot[] = [
  [0, 0, 0, 0.04, 0.04],
  [0, -0.1, 0.05, 0.03, 0.03],
  [0, -0.2, 0.12, 0.02, 0.02],
  [0, -0.28, 0.2, 0.01, 0.01],
];

test("suction cups follow the arm's rows and drop detail for the game", () => {
  const count = (g: T.BufferGeometry) => g.getAttribute("position").count;
  const one = suctionCups(arm, 1, "#a05050", "#e4c3a3", false);
  const two = suctionCups(arm, 2, "#a05050", "#e4c3a3", false);
  const game = suctionCups(arm, 2, "#a05050", "#e4c3a3", true);
  assert.ok(count(two) > count(one));
  assert.ok(count(game) < count(two));
  for (const g of [one, two, game]) {
    assert.equal(g.getAttribute("color").count, count(g));
    g.computeBoundingBox();
    const box = g.boundingBox;
    assert.ok(box && box.min.y > -0.35 && box.max.y < 0.06);
  }
});

test("byte vertex colours merge with float vertex colours at the same value", () => {
  const hat = new T.BoxGeometry(1, 1, 1).toNonIndexed();
  const shirt = new T.BoxGeometry(1, 1, 1).toNonIndexed();
  const bare = new T.BoxGeometry(1, 1, 1).toNonIndexed();
  hat.setAttribute(
    "color",
    new T.Uint8BufferAttribute(
      new Uint8Array(hat.getAttribute("position").count * 3).fill(51),
      3,
      true,
    ),
  );
  shirt.setAttribute(
    "color",
    new T.Float32BufferAttribute(
      new Float32Array(shirt.getAttribute("position").count * 3).fill(0.5),
      3,
    ),
  );
  for (const g of [hat, shirt, bare]) whiteVertexColors(g);
  const merged = mergeGeometries([hat, shirt, bare]);
  const colour = merged.getAttribute("color");
  assert.ok(colour.array instanceof Float32Array);
  assert.ok(Math.abs(colour.getX(0) - 0.2) < 1e-6);
  assert.equal(colour.getX(hat.getAttribute("position").count), 0.5);
  assert.equal(colour.getX(colour.count - 1), 1);
});
