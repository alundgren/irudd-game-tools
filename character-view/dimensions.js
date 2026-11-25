import { Box3, Vector3 } from "three";
import { validateForm } from "./recipe.js";

function includeVertices(box, mesh, point) {
  const positions = mesh.geometry?.attributes.position;
  if (positions)
    for (let i = 0; i < positions.count; i++)
      box.expandByPoint(
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld),
      );
}
export function visibleBounds(object) {
  const box = new Box3(),
    point = new Vector3();
  object.updateWorldMatrix(true, true);
  object.traverseVisible((node) => includeVertices(box, node, point));
  return box;
}
// Measure the actual head surface and exclude separately attached hair, hoods and crests.
export function measureFigure(figure, form) {
  const box = visibleBounds(figure);
  if (box.isEmpty()) return { box, overall: 0, head: null };
  const marked = form.parts.filter(
    (p) =>
      p.shape === "head" || p.anatomy === "face" || p.outfitRole === "head",
  );
  const heads = new Set(
    (marked.length
      ? marked
      : form.parts.filter(
          (p) => p.motionRole === "head" && !p.headLayer && !p.sourceHairOnly,
        )
    ).map((p) => p.id),
  );
  const face = new Box3(),
    point = new Vector3();
  figure.traverseVisible((node) => {
    if (!heads.has(node.userData.partId)) return;
    if (node.isMesh) {
      includeVertices(face, node, point);
      return;
    }
    function visit(child) {
      if (!child.visible || child.userData.partId) return;
      if (child.userData.faceSurface) includeVertices(face, child, point);
      else for (const sub of child.children) visit(sub);
    }
    for (const child of node.children) visit(child);
  });
  return {
    box,
    overall: box.max.y - box.min.y,
    head: face.isEmpty() ? null : face.max.y - box.min.y,
  };
}
export function resizeInMetres(form, current, requested) {
  if (
    !Number.isFinite(requested) ||
    requested < 0.05 ||
    requested > 12 ||
    !Number.isFinite(current) ||
    current <= 1e-5
  )
    throw new Error(
      "Enter a height between 0.05 and 12 metres for a visible form.",
    );
  const ratio = requested / current;
  const next = {
    ...form,
    ...(form.sectionProfile
      ? {
          sectionProfile: {
            ...form.sectionProfile,
            height: form.sectionProfile.height * ratio,
          },
        }
      : {}),
    parts: form.parts.map((p) =>
      p.parent
        ? p
        : {
            ...p,
            position: p.position.map((v) => v * ratio),
            size: p.size.map((v) => v * ratio),
          },
    ),
  };
  validateForm(next);
  return next;
}
