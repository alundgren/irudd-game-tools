import { Box3, Vector3 } from "three";

export function validWorldMarks(marks) {
  const vector = (p) =>
    Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  return (
    Array.isArray(marks) &&
    marks.length <= 12 &&
    new Set(marks.map((m) => m?.name)).size === marks.length &&
    marks.every(
      (m) =>
        m &&
        typeof m.name === "string" &&
        m.name.trim().length > 0 &&
        m.name.length <= 48 &&
        typeof m.region === "string" &&
        m.region.length > 0 &&
        m.region.length <= 64 &&
        vector(m.world) &&
        vector(m.normal) &&
        Math.abs(Math.hypot(...m.normal) - 1) < 0.001,
    )
  );
}

export function spatialGuide(root) {
  root.updateWorldMatrix(true, true);
  const regions = new Map(),
    point = new Vector3(),
    box = new Box3();
  const triplet = (v) => v.toArray().map((x) => Number(x.toFixed(3)));
  function visit(node, owner, shown) {
    shown = shown && node.visible;
    if (node.userData.partId) {
      owner = {
        id: node.userData.partId,
        pivot: triplet(node.getWorldPosition(point)),
        bounds: new Box3(),
      };
      regions.set(owner.id, owner);
    }
    if (
      owner &&
      shown &&
      node.isMesh &&
      node.geometry.attributes.position?.count
    ) {
      const g = node.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      owner.bounds.union(
        box.copy(g.boundingBox).applyMatrix4(node.matrixWorld),
      );
    }
    for (const child of node.children) visit(child, owner, shown);
  }
  visit(root, null, true);
  return {
    units:
      "metres in standing world space, +X character left, +Y up, +Z front. Bounds exclude attached child regions. Empty bounds mean hidden in the current outfit.",
    regions: [...regions.values()].map(({ id, pivot, bounds }) => ({
      id,
      pivot,
      bounds: bounds.isEmpty()
        ? null
        : [triplet(bounds.min), triplet(bounds.max)],
    })),
  };
}
