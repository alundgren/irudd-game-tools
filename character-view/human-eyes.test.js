import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { humanRegions } from "./human-mesh.js";
import { generatedHuman, humanForm } from "./human-form.js";
import { eyeColorNames, eyeRoughness, irisPixels, irisRadius, scleraPixels, socketTint } from "./human-eyes.js";

function head(form, plain = false) {
  const build = humanRegions(form, (color) => new T.MeshStandardMaterial({ color }), plain);
  return build(form.parts.find((part) => part.humanBone === "head"));
}
const adult = (shape = {}, seed = 404) => humanForm({ stance: 0.76, ...shape }, seed);
const eyesOf = (group) => group.children.find((mesh) => mesh.userData.eyePiece);
const mm = (form) => (0.001 * (form.human.height ?? 1.72)) / 1.72;
const people = () => [
  adult(),
  adult({ frame: 0.9, age: 0.7 }),
  adult({ frame: -0.9 }),
  ...[8734, 8735, 8736, 8737, 8738, 8739].map((seed) => generatedHuman(seed)),
];

test("each eye turns on a sphere fitted to the head, behind the middle of its visible part", () => {
  for (const form of people()) {
    const eyes = eyesOf(head(form)),
      unit = mm(form);
    assert.equal(eyes.eyeFits.length, 2);
    const [left, right] = eyes.eyeFits;
    assert.ok(left.side === 1 && right.side === -1 && left.centre.x > 0 && right.centre.x < 0);
    const box = new T.Box3().setFromBufferAttribute(eyes.geometry.attributes.position);
    for (const fit of eyes.eyeFits) {
      assert.ok(fit.ball > 12 * unit && fit.ball < 20 * unit, "ball radius " + fit.ball / unit);
      // The visible front lies well ahead of the centre.
      assert.ok(box.min.z - fit.centre.z > 0.25 * fit.ball, "front " + (box.min.z - fit.centre.z) / fit.ball);
    }
  }
});

test("the lid opening is read from the head and the iris is sized and seated in it", () => {
  for (const form of people()) {
    const eyes = eyesOf(head(form)),
      unit = mm(form),
      p = eyes.geometry.attributes.position;
    for (const fit of eyes.eyeFits) {
      const { opening } = fit,
        width = opening.outer - opening.inner;
      assert.ok(width > 16 * unit && width < 32 * unit, "opening width " + width / unit);
      assert.ok(fit.iris >= 10.8 * unit - 1e-9 && fit.iris <= 12.4 * unit + 1e-9, "iris " + fit.iris / unit);
      // The pupil's middle is the first vertex of the moving front.
      const a = fit.side * (p.getX(fit.first) - fit.centre.x),
        y = p.getY(fit.first) - fit.centre.y,
        [bottom, top] = opening.at(a);
      assert.ok(top - bottom > 4 * unit && top - bottom < 14 * unit, "opening height " + (top - bottom) / unit);
      assert.ok(a > opening.inner + 0.35 * width && a < opening.inner + 0.6 * width, "the iris sits near the middle");
      // The upper lid rests on the iris and clears the pupil. The lower lid sits near the limbus.
      const pupil = 0.36 * (fit.iris / 2);
      assert.ok(top - y > pupil, "the pupil is clear of the upper lid by " + (top - y - pupil) / unit);
      assert.ok(top - y < fit.iris / 2, "the upper lid covers the top of the iris");
      assert.ok(y - bottom > pupil && y - bottom < fit.iris / 2 + 1.5 * unit);
    }
    // Both eyes share one height and turn the same way.
    assert.equal(eyes.eyeFits[0].pitch, eyes.eyeFits[1].pitch);
    assert.ok(Math.abs(eyes.eyeFits[0].turn) < 0.14 && Math.abs(eyes.eyeFits[0].pitch) < 0.2);
  }
});

test("only the front of the eye turns with the gaze, about the ball's centre, and its normals turn with it", () => {
  const eyes = eyesOf(head(adult({ frame: 0.4 }))),
    g = eyes.geometry,
    p = g.attributes.position,
    n = g.attributes.normal;
  const names = ["LookLeft", "LookRight", "LookUp", "LookDown"];
  assert.deepEqual(g.morphAttributes.position.map((a) => a.name), names);
  assert.deepEqual(g.morphAttributes.normal.map((a) => a.name), names);
  assert.ok(g.index.count / 3 <= 980, "no more triangles than the eyes had");
  const moving = new Uint8Array(p.count),
    owner = new Array(p.count);
  for (const fit of eyes.eyeFits)
    for (let i = fit.first; i < fit.first + fit.count; i++) {
      moving[i] = 1;
      owner[i] = fit;
    }
  const v = new T.Vector3(),
    d = new T.Vector3();
  for (const [e, name] of names.entries()) {
    const shift = g.morphAttributes.position[e],
      lean = g.morphAttributes.normal[e];
    for (let i = 0; i < p.count; i++) {
      d.fromBufferAttribute(shift, i);
      if (!moving[i]) {
        // The wet line goes up and down with the lower lid. The rest of the white stays put.
        if (e > 1 && Math.abs(g.attributes.uv.getY(i) - 0.94) < 1e-4) {
          assert.ok(d.x === 0 && Math.abs(d.y) < 2.001 * mm(adult()), "the wet line follows its lid");
          continue;
        }
        assert.equal(d.length(), 0, "the socket's white stays in the socket");
        assert.equal(v.fromBufferAttribute(lean, i).length(), 0);
        continue;
      }
      const fit = owner[i],
        from = v.fromBufferAttribute(p, i).sub(fit.centre).length();
      assert.ok(
        Math.abs(v.fromBufferAttribute(p, i).add(d).sub(fit.centre).length() - from) < 1e-6,
        name + " keeps its distance from the centre",
      );
      assert.ok(Math.abs(v.fromBufferAttribute(n, i).add(d.fromBufferAttribute(lean, i)).length() - 1) < 1e-4);
    }
    // The pupil travels the way the target says.
    d.fromBufferAttribute(shift, eyes.eyeFits[0].first);
    assert.ok([d.x > 0.003, d.x < -0.003, d.y > 0.002, d.y < -0.002][e], name);
  }
  // The moving front rises from the ball as a cornea and its edge lies on the ball.
  for (const fit of eyes.eyeFits) {
    const apex = v.fromBufferAttribute(p, fit.first).sub(fit.centre).length(),
      rim = v.fromBufferAttribute(p, fit.first + fit.count - 1).sub(fit.centre).length();
    assert.ok(apex - rim > 0.0008 && apex - rim < 0.0025, "cornea rise " + (apex - rim));
    assert.ok(rim - fit.ball > 0 && rim - fit.ball < 0.0006, "the edge lies just proud of the socket's white");
  }
});

test("the socket shades the white under the lids, in the head's frame", () => {
  const look = { sky: 0.86, cast: [1, 1, 1], flesh: [0.6, 0.3, 0.27] },
    light = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const open = light(socketTint(4, 4, 11, 11, look));
  assert.ok(open > 0.55 && open < 0.85, "the open white is lit, short of the sky's full light: " + open);
  assert.ok(light(socketTint(0.3, 6, 11, 11, look)) < 0.6 * open, "the upper lid and lashes shade a band");
  assert.ok(light(socketTint(6, 0.2, 11, 11, look)) < 0.85 * open, "the lower lid leaves a contact line");
  assert.ok(light(socketTint(1, 1, 11, 0.5, look)) < 0.6 * open, "the outer corner closes in");
  assert.ok(
    light(socketTint(-1, 5, 11, 11, look)) < light(socketTint(0.1, 5, 11, 11, look)),
    "under the lid is darker still",
  );
  // The lower lid's moist edge is a pale pink line where the contact shadow would be.
  const rimmed = { ...look, rim: [0.8, 0.5, 0.46] },
    edge = socketTint(6, 0.2, 11, 11, rimmed),
    plainEdge = socketTint(6, 0.2, 11, 11, look);
  assert.ok(light(edge) > light(plainEdge) * 0.9 && edge[0] / edge[2] > 1.25 * (plainEdge[0] / plainEdge[2]));
  assert.ok(light(socketTint(0.1, 6, 11, 11, rimmed)) < 0.4 * open, "the upper lid margin is nearly dark");
  const corner = socketTint(2, 2, 0.6, 22, look),
    white = socketTint(2, 2, 9, 12, look);
  assert.ok(corner[0] / corner[2] > 1.5 * (white[0] / white[2]), "the nose corner is flesh, not white");
  // On a head, the strip under the upper lid is darker than its middle, on both eyes.
  for (const form of [adult(), generatedHuman(8736)]) {
    const eyes = eyesOf(head(form)),
      colour = eyes.geometry.attributes.color,
      p = eyes.geometry.attributes.position;
    assert.equal(eyes.material.vertexColors, true);
    for (const fit of eyes.eyeFits) {
      const from = fit === eyes.eyeFits[0] ? 0 : eyes.eyeFits[0].first + eyes.eyeFits[0].count;
      let dark = 1,
        bright = 0;
      for (let i = from; i < fit.first; i++) {
        const a = fit.side * (p.getX(i) - fit.centre.x),
          [bottom, top] = fit.opening.at(a),
          y = p.getY(i) - fit.centre.y;
        if (y > top || y < bottom) continue;
        const value = light([colour.getX(i), colour.getY(i), colour.getZ(i)]);
        dark = Math.min(dark, value);
        bright = Math.max(bright, value);
      }
      assert.ok(bright > 0.45 && bright < 0.85 && dark < 0.6 * bright, "white " + dark + " to " + bright);
    }
  }
});

test("the eye image holds a round pupil, a coloured iris and a soft limbus, and no painted light", () => {
  const size = 128,
    half = size / 2,
    at = (pixels, x, y) => Array.from(pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 3));
  const centres = {};
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.71, 0.71],
    [-0.71, 0.71],
    [0.71, -0.71],
    [-0.71, -0.71],
  ];
  for (const name of eyeColorNames) {
    const pixels = irisPixels(name, 3, size),
      r = irisRadius * half;
    // Along every direction from the middle: dark pupil, coloured iris, then the white.
    for (const [dx, dy] of directions) {
      const sample = (q) => at(pixels, Math.round(half + dx * q * r - 0.5), Math.round(half + dy * q * r - 0.5));
      assert.ok(Math.max(...sample(0.2)) < 40, name + " pupil");
      const ring = sample(0.6);
      assert.ok(Math.max(...ring) > 45 && Math.max(...ring) < 250, name + " iris");
      const white = sample(1.19);
      assert.ok(white[0] > 180 && white[0] < 245 && white[0] >= white[2], name + " white");
      // The limbus is a gradient: at the iris radius the colour lies between iris and white.
      assert.ok(sample(1)[0] < white[0] - 15, name + " limbus");
      if (dx === 1) centres[name] = ring;
    }
    // No highlight is painted in: the whole pupil is dark.
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++)
        if (Math.hypot(i + 0.5 - half, j + 0.5 - half) / r < 0.27)
          assert.ok(Math.max(...at(pixels, i, j)) < 40, name + " pupil is dark throughout");
  }
  assert.ok(centres.blue[2] > centres.blue[0] && centres.brown[0] > centres.brown[2]);
  const white = scleraPixels(3, 64);
  for (let i = 0; i < white.length; i += 4)
    assert.ok(white[i] > 160 && white[i] < 245 && white[i] >= white[i + 2]);
  assert.ok(eyeRoughness.cornea < eyeRoughness.white && eyeRoughness.cornea >= 0.2);
});

test("clay eyes carry a cut iris and pupil", () => {
  const depth = (plain) => {
    const eyes = eyesOf(head(adult(), plain)),
      p = eyes.geometry.attributes.position,
      [fit] = eyes.eyeFits,
      v = new T.Vector3();
    const from = (i) => v.fromBufferAttribute(p, i).sub(fit.centre).length();
    assert.equal(Boolean(eyes.geometry.attributes.color), !plain);
    return from(fit.first) - from(fit.first + fit.count - 1);
  };
  const dome = depth(false),
    cut = depth(true);
  assert.ok(dome > 0.0008, "the colour eye has a cornea dome");
  assert.ok(cut < dome - 0.002, "the clay iris and pupil are cut below that dome");
});

test("the cornea's normals put a high light's reflection in the upper iris, clear of the lid", () => {
  const key = new T.Vector3(3, 5, 4).normalize(),
    half = key.clone().add(new T.Vector3(0, 0, 1)).normalize();
  for (const form of people()) {
    const eyes = eyesOf(head(form)),
      unit = mm(form),
      p = eyes.geometry.attributes.position,
      n = eyes.geometry.attributes.normal,
      v = new T.Vector3();
    for (const fit of eyes.eyeFits) {
      // The cap vertex whose normal reflects the key light to a viewer in front.
      let best = -1,
        at = -1;
      const apex = new T.Vector3().fromBufferAttribute(p, fit.first);
      for (let i = fit.first; i < fit.first + fit.count; i++) {
        const d = v.fromBufferAttribute(n, i).dot(half);
        assert.ok(Math.abs(v.length() - 1) < 1e-4);
        // Only the cornea, not the white round it.
        if (v.fromBufferAttribute(p, i).distanceTo(apex) > 0.42 * fit.iris) continue;
        if (d > best) [best, at] = [d, i];
      }
      assert.ok(best > 0.97, "a normal faces the half vector: " + best);
      const a = fit.side * (p.getX(at) - fit.centre.x),
        y = p.getY(at) - fit.centre.y,
        centre = p.getY(fit.first) - fit.centre.y,
        [, top] = fit.opening.at(a);
      assert.ok(y > centre && y - centre < 0.36 * fit.iris, "in the upper iris: " + (y - centre) / unit);
      assert.ok(top - y > 0.1 * unit, "below the upper lid by " + (top - y) / unit);
    }
  }
});

test("each eye includes a fitted lower tear meniscus with upward wet-edge normals that only moves with its lid", () => {
  for (const form of [adult(), generatedHuman(8736)]) {
    const eyes = eyesOf(head(form)), g = eyes.geometry;
    const uv = g.attributes.uv, n = g.attributes.normal;
    let meniscusVerts = 0;
    for (let i = 0; i < uv.count; i++) {
      if (uv.getX(i) > 0.55 && uv.getY(i) > 0.88) {
        meniscusVerts++;
        assert.ok(n.getY(i) > 0.15, "meniscus normal tilts upward: " + n.getY(i));
        for (const shift of g.morphAttributes.position) {
          // A look across leaves it alone. A look up or down takes it with the lower lid.
          const vertical = shift.name === "LookUp" || shift.name === "LookDown";
          assert.equal(shift.getX(i), 0);
          assert.ok(Math.abs(shift.getY(i)) <= (vertical ? 2.001 * mm(form) : 0));
          assert.ok(Math.abs(shift.getZ(i)) <= (vertical ? 2.001 * mm(form) : 0));
        }
      }
    }
    assert.ok(meniscusVerts >= 28 && meniscusVerts <= 48, "meniscus verts: " + meniscusVerts);
  }
});
