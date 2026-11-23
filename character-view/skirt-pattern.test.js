import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Group, Mesh } from "three";
import { traceSkirt, skirtRadius, skirtGeometry } from "./skirt-pattern.js";
import { fitGarment } from "./garment-fit.js";

test("left and right waist traces preserve the same flared outline in wearer space", () => {
  const right = [
    [100, 30],
    [125, 30],
    [135, 58],
    [128, 90],
    [145, 130],
  ];
  const outline = traceSkirt(right);
  assert.deepEqual(traceSkirt(right.map(([x, y]) => [200 - x, y])), outline);
  assert.deepEqual(outline, [
    [0, 1],
    [0.28, 1.4],
    [0.6, 1.12],
    [1, 1.8],
  ]);
  for (let i = 1; i < outline.length; i++) {
    const [a, b] = outline.slice(i - 1, i + 1);
    for (let j = 0; j <= 10; j++) {
      const r = skirtRadius(outline, a[0] + ((b[0] - a[0]) * j) / 10);
      assert.ok(
        r >= Math.min(a[1], b[1]) - 1e-7 && r <= Math.max(a[1], b[1]) + 1e-7,
      );
    }
  }
  assert.throws(() =>
    traceSkirt([
      [0, 0],
      [20, 0],
      [17, 10],
      [-10, 20],
    ]),
  );
});
test("a fitted waistband follows the actual torso section while diagonal fabric folds retain relief", () => {
  const body = new Mesh(new BoxGeometry(0.2, 0.65, 0.14));
  const params = {
    width: 0.5,
    depth: 0.4,
    drop: 0.8,
    outline: [
      [0, 1],
      [0.5, 1.1],
      [1, 1.5],
    ],
    flare: 1,
    folds: 6,
    bias: 0.6,
    gather: 0.22,
    tiers: 2,
    train: 0.05,
  };
  const garment = new Mesh(skirtGeometry(params));
  garment.userData.partId = "skirt";
  const carrier = new Group();
  carrier.add(body, garment);
  carrier.updateMatrixWorld(true);
  fitGarment(carrier, garment, [], [], true);
  const { uv, position } = garment.geometry.attributes;
  const xs = [],
    front = [];
  for (let i = 0; i < uv.count / 2; i++) {
    if (uv.getY(i) === 1) xs.push(position.getX(i));
    if (uv.getX(i) === 0.5 && uv.getY(i) > 0.35 && uv.getY(i) < 0.8)
      front.push(position.getZ(i));
  }
  assert.ok(Math.max(...xs) - Math.min(...xs) < 0.22);
  assert.ok(
    front.filter(
      (v, i) =>
        i > 0 && i < front.length - 1 && v > front[i - 1] && v > front[i + 1],
    ).length >= 2,
  );
});
