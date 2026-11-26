import { figureFrontFit, figureProfileFit, type FrontFitPass, type Vec3 } from "@irudd/document";

export type Mark = readonly [number, number];

export function profileFromMarks(
  points: readonly Mark[],
  facing: "left" | "right",
  aspect: number,
) {
  const start = points[0],
    end = points.at(-1);
  if (!start || !end || end[1] <= start[1] || points.length < 4)
    throw new Error("Trace at least four points from brow down to chin.");
  const height = end[1] - start[1];
  const curve = points.map(([x, y]): Mark => [
    (y - start[1]) / height,
    ((x === start[0] ? 0 : facing === "left" ? -1 : 1) * (x - start[0]) * aspect) / height,
  ]);
  if (curve.some(([y, x], i) => Math.abs(x) > 1 || (i > 0 && y <= (curve[i - 1]?.[0] ?? 0))))
    throw new Error("Follow the profile downwards with a new height at every point.");
  return figureProfileFit.json({ curve, amount: 1, stage: "finish" });
}

export function landmarkPass(
  model: readonly Vec3[],
  photo: readonly Mark[],
  aspect: number,
): FrontFitPass {
  const [a, b] = model,
    [p, q] = photo;
  if (!a || !b || !p || !q || model.length < 3 || model.length !== photo.length)
    throw new Error("Mark matching points on both views, starting with two alignment points.");
  const dx = (q[0] - p[0]) * aspect,
    dy = p[1] - q[1],
    d = dx * dx + dy * dy;
  if (d < 0.0004 || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.12)
    throw new Error("Space the alignment points farther apart.");
  const u = ((b[0] - a[0]) * dx + (b[1] - a[1]) * dy) / d,
    v = ((b[1] - a[1]) * dx - (b[0] - a[0]) * dy) / d;
  const pins = model.map((at, i) => {
    const uv = photo[i] ?? p,
      x = (uv[0] - p[0]) * aspect,
      y = p[1] - uv[1];
    return { at, shift: [a[0] + u * x - v * y - at[0], a[1] + v * x + u * y - at[1]] as const };
  });
  if (pins.some((pin) => pin.shift.some((n) => Math.abs(n) > 0.35)))
    throw new Error("Keep corrections within 35% of head height.");
  return { pins, amount: 1, radius: 0.32 };
}

export function appendLandmarks(passes: readonly FrontFitPass[], pass: FrontFitPass) {
  if (passes.length >= 6) throw new Error("This face already has six landmark passes.");
  return figureFrontFit.json({ passes: [...passes, pass] });
}
