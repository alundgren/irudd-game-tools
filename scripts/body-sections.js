// Cross-sections of the visible editor mesh, projected orthographically. Each
// interval represents occupied space, including gaps between arms and torso.
import { Vector3 } from "three";
import { buildFigure } from "../character-view/figure.js";
import { createCharacter, disposeCharacter } from "../character-view/model.js";

export function sections(figure, rows, angles) {
  const group = createCharacter(buildFigure(figure), true);
  group.updateMatrixWorld(true);
  const meshes = [];
  let floor = Infinity,
    top = -Infinity;
  group.traverseVisible((node) => {
    if (!node.isMesh) return;
    const position = node.geometry.getAttribute("position");
    const vertices = Array.from({ length: position.count }, (_, i) => {
      const v = new Vector3()
        .fromBufferAttribute(position, i)
        .applyMatrix4(node.matrixWorld);
      floor = Math.min(floor, v.y);
      top = Math.max(top, v.y);
      return v;
    });
    meshes.push({ vertices, index: node.geometry.index?.array });
  });
  const h = top - floor;
  const planes = Array.from(
    { length: rows },
    (_, i) => floor + ((i + 0.5) * h) / rows,
  );
  const slices = angles.map(() => planes.map(() => []));
  const axes = angles.map((angle) => [
    Math.cos((angle * Math.PI) / 180),
    Math.sin((angle * Math.PI) / 180),
  ]);
  // Intersect triangles with horizontal planes once, then project each
  // intersection segment into every requested view.
  for (const { vertices, index } of meshes) {
    const count = index ? index.length : vertices.length;
    for (let i = 0; i < count; i += 3) {
      const points = [0, 1, 2].map(
        (j) => vertices[index ? index[i + j] : i + j],
      );
      const [a, b, c] = points.sort((a, b) => a.y - b.y);
      const start = Math.max(0, Math.ceil(((a.y - floor) / h) * rows - 0.5));
      const end = Math.min(rows, Math.ceil(((c.y - floor) / h) * rows - 0.5));
      for (let j = start; j < end; j++) {
        const y = planes[j],
          first = y < b.y ? a : b,
          last = y < b.y ? b : c;
        const t = (y - a.y) / (c.y - a.y),
          u = (y - first.y) / (last.y - first.y);
        const x1 = a.x + t * (c.x - a.x),
          z1 = a.z + t * (c.z - a.z);
        const x2 = first.x + u * (last.x - first.x),
          z2 = first.z + u * (last.z - first.z);
        for (let k = 0; k < axes.length; k++) {
          const [x, z] = axes[k],
            p = (x1 * x + z1 * z) / h,
            q = (x2 * x + z2 * z) / h;
          slices[k][j].push([Math.min(p, q), Math.max(p, q)]);
        }
      }
    }
  }
  disposeCharacter(group);
  return slices.map((view) =>
    view.map((intervals) => {
      const merged = [];
      for (const [lo, hi] of intervals.sort((a, b) => a[0] - b[0])) {
        const prev = merged.at(-1);
        if (prev && lo <= prev[1] + 1e-6) prev[1] = Math.max(prev[1], hi);
        else merged.push([lo, hi]);
      }
      return merged;
    }),
  );
}
