import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { surfaceBody, surfaceFrame } from "./human-fringe.js";
import { evaluateHuman } from "./human-surface.js";
import { libraryHair, libraryPieces } from "./human-library.js";
import { nativeBob, nativeBobMaps, nativeBobs, settleNativeBob } from "./human-native-bob.js";

const material = () => new T.MeshStandardMaterial();
const styles = ["Sleek bob", "Fringed bob", "Angled bob", "Curled-under bob"];
const heads = {
  resting: {},
  wide: { height: 1.5, frame: 0.6, weight: 0.9, headWidth: 1, forehead: 1, temples: 1 },
  narrow: { height: 1.95, frame: -0.8, weight: -0.7, headWidth: -1, forehead: -1, temples: -1 },
  old: { age: 1, weight: 0.5 },
};
const cardsOf = (surface, hair, extra = {}) => libraryPieces(surface, { hair, hairColor: "#72553d", ...extra }, material, false, true).find((mesh) => mesh.userData.libraryHair);
function ripple(geometry) {
  const pos = geometry.attributes.position.array, index = geometry.index.array, id = [], first = new Map();
  for (let i = 0; i < pos.length / 3; i++) {
    const key = [0, 1, 2].map((d) => Math.round(pos[i * 3 + d] * 2e4)).join(",");
    if (!first.has(key)) first.set(key, i);
    id.push(first.get(key));
  }
  const beside = new Map(), edges = new Map();
  for (let t = 0; t < index.length; t += 3) for (let j = 0; j < 3; j++) {
    const a = id[index[t + j]], b = id[index[t + (j + 1) % 3]], edge = a < b ? a + "/" + b : b + "/" + a;
    (beside.get(a) ?? beside.set(a, new Set()).get(a)).add(b);
    (beside.get(b) ?? beside.set(b, new Set()).get(b)).add(a);
    edges.set(edge, (edges.get(edge) ?? 0) + 1);
  }
  const rim = new Set();
  for (const [edge, uses] of edges) if (uses === 1) edge.split("/").forEach((v) => rim.add(Number(v)));
  const out = [];
  for (const [v, near] of beside) {
    if (rim.has(v) || near.size < 3) continue;
    const c = [0, 0, 0];
    for (const u of near) for (let d = 0; d < 3; d++) c[d] += pos[u * 3 + d] / near.size;
    out.push(1000 * Math.hypot(pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]));
  }
  out.sort((a, b) => a - b);
  return out[out.length >> 1];
}

test("the family is the four authored bobs, each with its shell and its picture", () => {
  assert.deepEqual([...nativeBobs].sort(), ["bob_blunt", "bob_blunt_fringe", "bob_curled", "bob_inverted"]);
  for (const style of styles) assert.ok(nativeBob(libraryHair[style]), style);
  assert.ok(!nativeBob("bun_tied") && !nativeBob("bob01"));
  for (const groom of nativeBobs) assert.match(nativeBobMaps[groom].texture, /^data:image\/webp;base64,/, groom);
});

test("a bob is worn as a smooth shell on resting, wide, narrow and old heads", () => {
  for (const [label, human] of Object.entries(heads)) {
    const surface = evaluateHuman(human);
    for (const style of styles) {
      const cards = cardsOf(surface, style), p = cards.geometry.attributes.position.array;
      assert.ok(p.every(Number.isFinite), `${label}, ${style}`);
      assert.equal(cards.material.userData.hairCards, true);
      assert.ok(ripple(cards.geometry) < 1.4, `${label}, ${style}: ${ripple(cards.geometry).toFixed(2)} mm`);
    }
  }
});

test("the shell stays outside the scalp and covers the ears", () => {
  for (const [label, human] of Object.entries(heads)) {
    const surface = evaluateHuman(human), frame = surfaceFrame(surface), body = surfaceBody(surface), k = frame.k;
    for (const style of ["Sleek bob", "Curled-under bob", "Angled bob"]) {
      const p = cardsOf(surface, style).geometry.attributes.position.array, widest = [0, 0];
      let inside = 0;
      for (let i = 0; i < p.length; i += 3) {
        const at = [p[i], p[i + 1], p[i + 2]];
        if (at[1] > frame.eye[1] + .03 * k && frame.over(at).h < -.002 * k) inside++;
        widest[at[0] > 0 ? 0 : 1] = Math.max(widest[at[0] > 0 ? 0 : 1], Math.abs(at[0]));
      }
      assert.ok(inside < p.length / 3 * .01, `${label}, ${style}: ${inside} points inside the scalp`);
      for (const id of [5413, 12012]) {
        const rim = body.point(surface.ids.indexOf(id));
        assert.ok(widest[rim[0] > 0 ? 0 : 1] > Math.abs(rim[0]), `${label}, ${style}: hair is wider than the ear rim`);
      }
    }
  }
});

test("a different shell is refused, and a heavy neck does not swing the hem", () => {
  assert.throws(() => settleNativeBob("bob_blunt", new Float32Array(9), new Uint8Array(3), new Uint16Array([0, 1, 2]), null), /authored shell/);
  const lean = cardsOf(evaluateHuman({ weight: -0.8 }), "Sleek bob").geometry, heavy = cardsOf(evaluateHuman({ weight: 0.9 }), "Sleek bob").geometry;
  for (const g of [lean, heavy]) g.computeBoundingBox();
  assert.ok(Math.abs((lean.boundingBox.max.y - lean.boundingBox.min.y) - (heavy.boundingBox.max.y - heavy.boundingBox.min.y)) < .015);
});
