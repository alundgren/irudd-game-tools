import * as T from "three";
import type { FigureScute, Knot } from "@irudd/document";

export function scuteGeometry(
  mount?: FigureScute["mount"],
  knots?: readonly Knot[],
): T.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rows = 24;
  const cols = 40;
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const width = 0.5 * Math.max(0.012, Math.sin(Math.PI * t) ** 0.66 * (1.3 - 0.85 * t));
    for (let c = 0; c <= cols; c++) {
      const a = (c / cols) * Math.PI * 2;
      const side = Math.sin(a);
      const front = Math.cos(a);
      const x = side * width;
      const lip = Math.sin(t * Math.PI) ** 0.75;
      const crown =
        front > 0 ? (0.22 + 0.28 * (1 - Math.abs(side)) ** 2) * front : -0.19 * Math.abs(front);
      const z = lip * crown + 0.23 * t * t + 0.028 * Math.cos(3 * Math.PI * t) * lip;
      pos.push(x, 0.5 - t, z);
      uv.push(c / cols, 1 - t);
      if (r < rows && c < cols) {
        const i = r * (cols + 1) + c;
        const j = i + cols + 1;
        idx.push(i, j, i + 1, i + 1, j, j + 1);
      }
    }
  }
  for (let i = 1; i < cols - 1; i++) {
    idx.push(0, i + 1, i);
    const end = rows * (cols + 1);
    idx.push(end, end + i, end + i + 1);
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (mount && knots && knots.length >= 2) {
    const frame = new T.Matrix4().compose(
      new T.Vector3(...mount.position),
      new T.Quaternion(...mount.rotation),
      new T.Vector3(...mount.size),
    );
    const inverse = frame.clone().invert(),
      v = new T.Vector3(),
      normal = new T.Vector3();
    const points = g.getAttribute("position"),
      coords = g.getAttribute("uv");
    for (let i = 0; i < points.count; i++) {
      v.fromBufferAttribute(points, i);
      const lift = (v.z - 0.09) * mount.size[2] + 0.003;
      v.applyMatrix4(frame);
      let k = 1;
      while (k < knots.length - 1 && (knots[k]?.[1] ?? v.y) < v.y) k++;
      const a = knots[k - 1],
        b = knots[k];
      if (!a || !b) continue;
      const t = a[1] === b[1] ? 0 : T.MathUtils.clamp((v.y - a[1]) / (b[1] - a[1]), 0, 1);
      const sample = (j: 0 | 2 | 3 | 4) => T.MathUtils.lerp(a[j], b[j], t);
      const cx = sample(0),
        cz = sample(2),
        w = sample(3),
        d = sample(4);
      const angle = Math.atan2(-(v.z - cz) / d, (v.x - cx) / w),
        co = Math.cos(angle),
        si = Math.sin(angle);
      normal.set(co / w, 0, -si / d).normalize();
      v.set(cx + w * co, v.y, cz - d * si)
        .addScaledVector(normal, lift)
        .applyMatrix4(inverse);
      points.setXYZ(i, v.x, v.y, v.z);
      coords.setXY(i, (angle / (2 * Math.PI) + 1) % 1, (k - 1 + t) / (knots.length - 1));
    }
  }
  g.computeVertexNormals();
  return g;
}
