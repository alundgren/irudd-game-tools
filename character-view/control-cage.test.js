import test from "node:test";
import assert from "node:assert/strict";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { checkCage, cubeCage, cageGeometry, editCage } from "./control-cage.js";
import { applyOperations } from "./variations.js";
import { copyBranch } from "./parts.js";
function hits(cage, x, side = 1) {
  const g = cageGeometry(cage),
    m = new Mesh(g, new MeshBasicMaterial());
  const ray = new Raycaster(
    new Vector3(x, 0.013, 3 * side),
    new Vector3(0, 0, -side),
  );
  return ray.intersectObject(m, false);
}
test("an editable tunnel stays open through both sides at every subdivision level", () => {
  const box = cubeCage(),
    bore = editCage(box, { kind: "tunnel", face: 0, to: 1 });
  for (const levels of [0, 1, 2]) {
    const c = { ...bore, levels };
    for (const side of [-1, 1]) {
      assert.ok(hits({ ...box, levels }, 0, side).length > 0);
      assert.equal(hits(c, 0, side).length, 0);
      assert.ok(hits(c, 0.392, side).length > 0);
    }
    const geometry = cageGeometry(c);
    assert.equal(geometry.cageFaces.length, geometry.getIndex().count / 3);
    assert.ok(
      [...geometry.getAttribute("normal").array].every(Number.isFinite),
    );
  }
  assert.deepEqual(box, cubeCage());
});
test("a cage survives proposal edits and mirror with outward winding", () => {
  const parent = { parts: [] };
  const form = applyOperations(
    parent,
    [
      { op: "addPart", part: { id: "crest", shape: "cage", color: "#993355" } },
      { op: "editCage", id: "crest", face: 0, to: 1, kind: "tunnel" },
      { op: "editCage", id: "crest", face: 4, kind: "extrude", amount: 0.6 },
      { op: "editCage", id: "crest", face: 4, kind: "crease" },
    ],
    {},
    true,
  );
  const [part] = form.parts;
  assert.deepEqual(part.frameSize, [1, 1, 1]);
  assert.ok(part.cage.vertices.some((v) => v[1] > 1));
  assert.equal(part.cage.creases.length, 4);
  const { form: reflected } = copyBranch(form, "crest", true);
  assert.deepEqual(
    reflected.parts[1].cage.faces[0],
    [...part.cage.faces[0]].reverse(),
  );
  assert.ok(hits(reflected.parts[1].cage, -0.392).length);
  assert.deepEqual(parent, { parts: [] });
});
test("reversed closed shells render outward and extrude outward, while intentional hard edges split their normals", () => {
  const box = cubeCage(),
    inside = { ...box, faces: box.faces.map((f) => [...f].reverse()) };
  assert.ok(hits(inside, 0).length);
  const grown = editCage(inside, { kind: "extrude", face: 0, amount: 0.4 });
  assert.ok(grown.vertices.some((v) => v[2] > 0.89));
  const flat = cageGeometry({ ...box, levels: 0 });
  assert.equal(flat.getAttribute("position").count, 24);
  assert.ok(
    cageGeometry(editCage(box, { kind: "crease", face: 0 })).getAttribute(
      "position",
    ).count > cageGeometry(box).getAttribute("position").count,
  );
});
test("invalid topology and impractical edit sizes fail before geometry generation", () => {
  const c = cubeCage();
  assert.throws(() => checkCage({ ...c, faces: [[1, 1, 2]] }));
  assert.throws(() => checkCage({ ...c, faces: [...c.faces, c.faces[0]] }));
  assert.throws(() =>
    checkCage({
      ...c,
      faces: [c.faces[0].slice().reverse(), ...c.faces.slice(1)],
    }),
  );
  assert.throws(() => checkCage({ ...c, creases: [[0, 6]] }));
  assert.throws(() => editCage(c, { kind: "tunnel", face: 0, to: 2 }));
  assert.throws(() =>
    editCage(c, { kind: "extrude", face: 0, amount: Infinity }),
  );
});
