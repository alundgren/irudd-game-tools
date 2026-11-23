import { Vector3, MathUtils, CurvePath, LineCurve3 } from "three";
import { attachAt } from "./graft.js";

const styles = {
  Horn: { motion: "rigid", tip: 0.025, depth: 0.86 },
  Tail: { motion: "tail", tip: 0.12, depth: 0.96 },
  Fin: { motion: "wing", tip: 0.08, depth: 0.22 },
  "Walking limb": { motion: "thigh", tip: 0.42, depth: 0.9 },
};
export const branchTypes = Object.keys(styles);
function oppositeRegion(id, form) {
  const other = id.replace(/\bleft\b|\bright\b/i, (w) =>
    w.toLowerCase() === "left" ? "right" : "left",
  );
  return (
    form.parts.find((p) => p.id.toLowerCase() === other.toLowerCase())?.id ?? id
  );
}
export function drawBranch(
  form,
  parent,
  path,
  { kind = "Horn", radius = 0.06, mirror = false, color = "#9d8765" } = {},
) {
  if (
    !styles[kind] ||
    !Array.isArray(path) ||
    path.length < 2 ||
    path.length > 256 ||
    !path.every(
      (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite),
    ) ||
    !Number.isFinite(radius) ||
    radius < 0.005 ||
    radius > 0.6
  )
    throw new Error("Draw a visible stroke with a valid radius.");
  if (form.parts.length + (mirror ? 2 : 1) > 128)
    throw new Error("The form supports up to 128 parts.");
  const style = styles[kind],
    curve = new CurvePath();
  for (let i = 1; i < path.length; i++) {
    const a = new Vector3(...path[i - 1]),
      b = new Vector3(...path[i]);
    if (a.distanceToSquared(b) > 0.000001) curve.add(new LineCurve3(a, b));
  }
  const length = curve.getLength();
  if (length < 0.025) throw new Error("Drag farther to draw an appendage.");
  const count = MathUtils.clamp(
    Math.ceil(length / Math.max(0.03, radius * 0.8)),
    3,
    20,
  );
  const pts = Array.from({ length: count }, (_, i) =>
    curve.getPoint(i / (count - 1)),
  );
  let result = form,
    selected;
  const sides = mirror ? [1, -1] : [1];
  for (const side of sides) {
    const pivot = pts[0].clone();
    pivot.x *= side;
    const knots = pts.map((pos, i) => {
      const t = i / (count - 1),
        w = radius * MathUtils.lerp(1, style.tip, t ** 1.05);
      return [
        side * pos.x - pivot.x,
        pos.y - pivot.y,
        pos.z - pivot.z,
        w,
        w * style.depth,
      ];
    });
    const name =
      (mirror ? (pivot.x >= 0 ? "left " : "right ") : "") + kind.toLowerCase();
    let id = name,
      k = 2;
    while (result.parts.some((p) => p.id === id)) id = name + " " + k++;
    result = attachAt(
      result,
      {
        id,
        shape: "sweep",
        knots,
        color,
        motionRole: style.motion,
        ...(form.parts.find((p) => p.id === parent)?.blendSkin
          ? { blendSkin: true }
          : {}),
      },
      side === 1 ? parent : oppositeRegion(parent, form),
      pivot.toArray(),
    );
    selected ??= id;
  }
  return { form: result, id: selected };
}
