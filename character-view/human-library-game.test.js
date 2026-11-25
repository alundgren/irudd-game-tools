import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { generatedHuman } from "./human-form.js";
import { surfaceBody } from "./human-fringe.js";
import { raycaster } from "./human-style-kit.js";
import { evaluateHuman } from "./human-surface.js";
import { libraryHair, libraryPieces } from "./human-library.js";
import { optimizeForGame } from "./game-export.js";

const material = () => new T.MeshStandardMaterial();
const surface = evaluateHuman({ height: 1.66, frame: -0.9 });
const hair = (name, plain, game) =>
  libraryPieces(surface, { hair: name, fringe: "Swept right" }, material, plain, game).find((mesh) => mesh.userData.libraryHair);
const triangles = (mesh) => mesh.geometry.index.count / 3;
// The share of triangle edges that only one triangle uses.
function openEdges(geometry) {
  const index = geometry.index.array, edges = new Map();
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = index[t + k], b = index[t + (k + 1) % 3], key = a < b ? a * 1e6 + b : b * 1e6 + a;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  let open = 0;
  for (const count of edges.values()) if (count === 1) open++;
  return open / edges.size;
}
function area(geometry) {
  const p = geometry.attributes.position, index = geometry.index.array, tri = new T.Triangle();
  let sum = 0;
  for (let t = 0; t < index.length; t += 3)
    sum += tri.setFromAttributeAndIndices(p, index[t], index[t + 1], index[t + 2]).getArea();
  return sum;
}

test("library hair is tagged for the game exporter in every view", () => {
  for (const name of Object.keys(libraryHair))
    for (const [plain, game] of [[false, false], [true, false], [false, true], [true, true]])
      assert.equal(hair(name, plain, game).material.userData.hairCards, true, name);
  // Callers that only measure hair pass stand-in materials without user data.
  const bare = libraryPieces(surface, { hair: "Rounded bob" }, () => ({ clone: () => ({}) }), true);
  assert.equal(bare.find((mesh) => mesh.userData.libraryHair).material.userData.hairCards, true);
});

test("the game export draws whole hair cards and lets their map cut the outline", () => {
  for (const name of Object.keys(libraryHair)) {
    const full = hair(name, false, false), game = hair(name, false, true);
    assert.ok(triangles(game) <= triangles(full), name + " has no more triangles than the trimmed cards");
    assert.equal(game.material.alphaTest, full.material.alphaTest, name);
    assert.equal(game.geometry.attributes.uv.count, game.geometry.attributes.position.count);
    // Trimmed cards are slivers with their own corners; whole cards meet along their edges.
    if (name === "Loose waves")
      assert.deepEqual(game.geometry.index.array, full.geometry.index.array, "both use the same continuous subdivided ribbons");
    else assert.ok(openEdges(game.geometry) < openEdges(full.geometry), name + " cards share more of their edges");
    // The cards stay where the trimmed hair is.
    const a = new T.Box3().setFromBufferAttribute(full.geometry.attributes.position), b = new T.Box3().setFromBufferAttribute(game.geometry.attributes.position);
    assert.ok(b.containsBox(a.clone().expandByScalar(-0.004)) && a.clone().expandByScalar(0.03).containsBox(b), name + " keeps its place");
  }
});

test("a plain game export keeps a geometric outline that can be thinned", () => {
  // Trimmed slivers are joined where they meet.
  const full = hair("Rounded bob", true, false), game = hair("Rounded bob", true, true);
  assert.ok(game.geometry.attributes.position.count < 0.6 * full.geometry.attributes.position.count);
  assert.ok(triangles(game) > 0.95 * triangles(full) && triangles(game) <= triangles(full));
  assert.ok(Math.abs(area(game.geometry) / area(full.geometry) - 1) < 0.01);
  // Curls trim into far more slivers than a game mesh can hold, so their half-covered cards stand in.
  const curls = hair("Natural curls", true, true), trimmed = hair("Natural curls", true, false);
  assert.ok(triangles(curls) < 3000 && triangles(trimmed) > 10 * triangles(curls));
  const ratio = area(curls.geometry) / area(trimmed.geometry);
  assert.ok(ratio > 0.8 && ratio < 1.3, "half-covered cards have about the area of the trimmed hair, got " + ratio.toFixed(2));
});

// A canvas that draws nothing, so the exporter can lay out its atlas without a browser.
const blank = () => ({ width: 1, height: 1, getContext: () => ({ fillRect() {}, clearRect() {}, drawImage() {}, putImageData() {}, set fillStyle(v) {},
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }) }) });
// Curved strips that overlap like hair cards: open sheets with a free edge all round.
function strips(count, across, along) {
  const pos = [], uv = [], index = [];
  for (let s = 0; s < count; s++) {
    const base = pos.length / 3, turn = s * 2.4, lift = 0.02 * (s % 5);
    for (let j = 0; j <= along; j++) for (let i = 0; i <= across; i++) {
      const a = turn + 0.5 * (i / across - 0.5), down = j / along, r = 0.1 + 0.03 * Math.sin(3 * down + s);
      pos.push(r * Math.sin(a), 1.7 - lift - 0.16 * down, r * Math.cos(a));
      uv.push((s + i / across) / count, down);
    }
    for (let j = 0; j < along; j++) for (let i = 0; i < across; i++) {
      const a = base + j * (across + 1) + i, b = a + 1, c = a + across + 1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
async function exported(cards) {
  const tagged = material();
  tagged.userData.hairCards = true;
  const hairMesh = new T.Mesh(cards, tagged), body = new T.Mesh(new T.SphereGeometry(0.4, 220, 160), material());
  const scene = new T.Scene().add(hairMesh, body);
  globalThis.document = { createElement: blank };
  try {
    const result = await optimizeForGame(scene, { triangles: 24000 });
    return { hair: triangles(hairMesh), total: result.triangles, geometry: hairMesh.geometry };
  } finally {
    delete globalThis.document;
  }
}

test("the game exporter gives hair cards a bounded share and keeps them whole", async () => {
  const cards = strips(30, 8, 20), before = area(cards), count = cards.index.count / 3;
  const result = await exported(cards);
  assert.ok(count > 0.11 * 24000 * 1.5, "the cards need thinning");
  assert.ok(result.hair <= 0.11 * 24000 * 1.5 && result.hair >= 0.08 * 24000, "hair takes about its share, got " + result.hair);
  assert.ok(Math.abs(result.total - 24000) < 0.04 * 24000, "the whole export stays near its budget, got " + result.total);
  assert.ok(Math.abs(area(result.geometry) / before - 1) < 0.03, "thinned cards cover what they covered, got " + (area(result.geometry) / before).toFixed(3));
});

test("hair with fewer cards than its share keeps every triangle", async () => {
  const cards = strips(10, 4, 10), count = cards.index.count / 3;
  const result = await exported(cards);
  assert.equal(result.hair, count);
  assert.ok(Math.abs(result.total - 24000) < 0.04 * 24000, "got " + result.total);
});

test("the roof of each fitted shirt clears the shoulder under its yoke", () => {
  for (const [seed, outfit] of [[8807, "Overshirt and denim"], [8808, "Striped shirt and jeans"]]) {
    const human = evaluateHuman(generatedHuman(seed).human), body = surfaceBody(human);
    const clothes = libraryPieces(human, { outfit }, material, true);
    const skin = raycaster(body.P, body.tri);
    const fabrics = clothes.map(({ geometry }) => raycaster(geometry.attributes.position.array, geometry.index.array));
    const [x, y, z] = body.joint("upperarm_l"), scale = human.height / 1.72, down = [0,-1,0];
    for (const [width, depth] of [[.70,0], [.78,-.025], [.83,.01], [.75,-.04]]) {
      const origin = [-x*width, y+.34*scale, z+depth];
      const bodyDepth = skin(origin,down), clothDepth = Math.min(...fabrics.map(hit => hit(origin,down)));
      assert.ok(Number.isFinite(bodyDepth) && clothDepth < bodyDepth, outfit+" shoulder under cloth");
    }
  }
});
