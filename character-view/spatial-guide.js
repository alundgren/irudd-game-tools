import { Box3, Vector3 } from "three";

// Report the rendered rest geometry in game metres. A child's geometry belongs
// to its own row, even when it sits inside its parent's scene graph.
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
