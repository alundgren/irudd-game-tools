import test from "node:test";
import assert from "node:assert/strict";
import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, Scene, SphereGeometry, TorusKnotGeometry, Texture, Uint16BufferAttribute } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { canonicalizeGameAttributes, optimizeForGame } from "./game-export.js";

test("packed vertex colours and unused joint slots satisfy glTF bounds", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("color", new Float32BufferAttribute([1.001, .5, -.003, 1], 4));
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute([9, 4, 3, 77], 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute([.75, 0, .25, 0], 4));
  canonicalizeGameAttributes(geometry);
  assert.deepEqual([...geometry.attributes.color.array], [1, .5, 0, 1]);
  assert.deepEqual([...geometry.attributes.skinIndex.array], [9, 0, 3, 0]);
  assert.deepEqual([...geometry.attributes.skinWeight.array], [.75, 0, .25, 0]);
});

const blank = () => ({ width: 1, height: 1, getContext: () => ({ fillRect() {}, clearRect() {}, drawImage() {}, putImageData() {}, set fillStyle(v) {},
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }) }) });
async function shares(pieces, target = 24000) {
  const geometry = mergeGeometries(pieces.map(([piece]) => piece), true);
  const materials = pieces.map(([, tag]) => Object.assign(new MeshStandardMaterial(), { userData: { ...tag } }));
  globalThis.document = { createElement: blank };
  try {
    const result = await optimizeForGame(new Scene().add(new Mesh(geometry, materials)), { triangles: target });
    return { total: result.triangles, of: materials.map(material => result.shares.find(share => share.material === material)) };
  } finally {
    delete globalThis.document;
  }
}
const body = () => new SphereGeometry(0.4, 300, 200), plate = () => new CylinderGeometry(0.2, 0.26, 0.4, 24, 6, true).translate(0.9, 0, 0);
const stud = () => new SphereGeometry(0.01, 8, 6).translate(0, 0.6, 0), fibres = () => new TorusKnotGeometry(0.3, 0.004, 1500, 4).translate(0, 1.2, 0);

test("a character already inside the budget keeps its authored surfaces", async () => {
  const pieces = [
    [new SphereGeometry(.3, 24, 20)],
    [plate(), { foldedCloth: true }],
    [stud(), { attachmentDetail: "trim" }],
  ];
  const initial = pieces.reduce((sum, [geometry]) => sum + geometry.index.count / 3, 0);
  for (const budget of [initial, 24000]) {
    const result = await shares(pieces, budget);
    assert.equal(result.total, initial);
    assert.ok(result.of.every(batch => batch.triangles === batch.initial));
  }
});

test("materials that share the budget give by shape: a plate of few faces keeps them, and none drops below its floor", async () => {
  const { total, of: [dense, coarse, small] } = await shares([[body()], [plate()], [stud()]]);
  const even = 24000 / (dense.initial + coarse.initial + small.initial);
  assert.ok(dense.initial > 100000 && even < 0.25, "the body needs reducing");
  assert.ok(coarse.triangles / coarse.initial > 3 * even, `the plate keeps ${coarse.triangles} of ${coarse.initial}`);
  assert.ok(small.triangles >= 12, "a small piece is never reduced to nothing");
  assert.ok(dense.triangles >= 0.7 * even * dense.initial - 2, "the dense surface keeps its floor, got " + dense.triangles);
  assert.ok(total <= 24000 + 4 && total > 0.97 * 24000, "the file is filled, not overdrawn: " + total);
});

test("fibres and feathers stay as built until the rest of the figure runs short, then give within a limit", async () => {
  const strands = () => [fibres(), { fibreLOD: true }], feathers = () => [new TorusKnotGeometry(0.5, 0.01, 750, 4), { wingLOD: true }];
  const built = [strands(), feathers()].map(([piece]) => piece.index.count / 3);
  assert.deepEqual(built, [12000, 6000]);
  const easy = await shares([[new SphereGeometry(0.4, 120, 80)], strands(), feathers()]);
  assert.deepEqual(easy.of.slice(1).map(share => share.triangles), built, "a light figure keeps every fibre and feather");
  const { total, of: [rest, hair, wings] } = await shares([[body()], strands(), feathers()]);
  const kept = hair.triangles + wings.triangles;
  assert.ok(hair.triangles < built[0] && wings.triangles < built[1], `thinned to ${hair.triangles} and ${wings.triangles}`);
  assert.ok(Math.abs(hair.triangles / built[0] - wings.triangles / built[1]) < 0.03, "both give the same share");
  assert.ok(kept >= 0.3 * 24000 - 24, "thinning stops at the floor: " + kept);
  assert.ok(rest.triangles > 0.08 * rest.initial && rest.triangles > 1.5 * (24000 - 18000), "what they give goes to the rest: " + rest.triangles);
  assert.ok(Math.abs(total - 24000) < 0.02 * 24000, "the file keeps its size: " + total);
});

test("a constant UV corner copies its texel, while another mesh using the same material can require the whole image", async () => {
  const source = { width: 32, height: 64 };
  const material = new MeshStandardMaterial({ map: new Texture(source) });
  const drawCalls = [];
  const documentBefore = globalThis.document;
  globalThis.document = { createElement() {
    const canvas = blank();
    const ctx = canvas.getContext();
    ctx.drawImage = (image, ...args) => { if (image === source) drawCalls.push(args); };
    canvas.getContext = () => ctx;
    return canvas;
  } };
  const patch = new SphereGeometry(0.1, 8, 6);
  patch.attributes.uv.array.fill(0);
  const scene = new Scene().add(new Mesh(patch, material));
  try {
    await optimizeForGame(scene, { size: 64 });
    assert.ok(drawCalls.length > 0);
    assert.deepEqual(drawCalls[0].slice(0, 4), [0, 63, 1, 1]);
    drawCalls.length = 0;
    const sharedScene = new Scene().add(new Mesh(patch, material), new Mesh(new SphereGeometry(.2, 8, 6), material));
    await optimizeForGame(sharedScene, { size: 64 });
    assert.ok(drawCalls.length > 0);
    assert.ok(drawCalls.every(args => args.length === 4 && args[2] > 1 && args[3] > 1));
  } finally {
    if (documentBefore === undefined) delete globalThis.document;
    else globalThis.document = documentBefore;
  }
});


test("a cast cutout uses square texels in the free quarter of the packed body map", async () => {
  const body = new Mesh(new SphereGeometry(.5, 12, 8), new MeshStandardMaterial());
  const hair = new Mesh(new SphereGeometry(.2, 8, 6), new MeshStandardMaterial());
  body.material.userData.castBodySheet = true;
  hair.material.userData.castHairSheet = true;
  const bodyUV = body.geometry.attributes.uv;
  for (let i = 0; i < bodyUV.count; i++) bodyUV.setX(i, .5 * bodyUV.getX(i));
  globalThis.document = {createElement: blank};
  try {
    const result = await optimizeForGame(new Scene().add(body, hair), {size: 256});
    const uv = hair.geometry.attributes.uv;
    let minU = 1, minV = 1, maxU = 0, maxV = 0;
    for (let i = 0; i < uv.count; i++) {
      minU = Math.min(minU, uv.getX(i));
      maxU = Math.max(maxU, uv.getX(i));
      minV = Math.min(minV, uv.getY(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
    assert.ok(minU > .5 && maxU < 1);
    assert.ok(minV > 0 && maxV < .55);
    assert.ok(maxU - minU > .38 && maxV - minV > .38);
    result.dispose();
  } finally {
    delete globalThis.document;
  }
});
