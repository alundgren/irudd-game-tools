// Portrait sculpting uses head-height units. Keep the source picture's
// standing-height coordinates intact for sampling its colours.
export function headSpace(paint) {
  const frame = paint?.portrait?.frame;
  if (!frame) return paint;
  const h = paint.height;
  return {
    ...paint,
    height: h * frame.span,
    offset: [
      paint.offset[0] - frame.centerX * h,
      paint.offset[1] - frame.base * h,
      paint.offset[2],
    ],
  };
}
export const portraitMarks = [
  "first pupil",
  "second pupil",
  "tip of the nose",
  "centre of the lips",
  "bottom of the chin",
];
export function registerFace(part, marks, panel) {
  if (part?.shape !== "sweep" || !part.paint || part.paint.frame === "path")
    throw new Error("Choose a painted head made from cross sections.");
  if (
    !Array.isArray(marks) ||
    marks.length !== 5 ||
    !marks.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((n) => Number.isFinite(n) && n >= 0 && n <= 1),
    )
  )
    throw new Error("Mark both pupils, nose, lips and chin in the front view.");
  const b = part.paint,
    h = b.height;
  const base = (b.rest[0][1] + b.offset[1]) / h,
    top = (b.rest.at(-1)[1] + b.offset[1]) / h,
    span = top - base;
  if (span < 0.018)
    throw new Error("This head area is too small to calibrate.");
  const [a, z, nose, mouth, chin] = marks;
  const y = (p) =>
    ((panel.feet - p[1] * panel.size) / panel.span - base) / span;
  const x = (p) => (p[0] * panel.size - panel.mid) / panel.span;
  const eyes = (y(a) + y(z)) * 0.5,
    width = Math.abs(x(a) - x(z)) / (0.85 * span);
  if (
    width < 0.08 ||
    width > 0.8 ||
    Math.abs(y(a) - y(z)) > 0.16 ||
    eyes >= 1 ||
    y(chin) < -0.025 ||
    !(eyes > y(nose) && y(nose) > y(mouth) && y(mouth) > y(chin))
  )
    throw new Error(
      "Check the five landmarks. Both pupils must sit above the nose, lips and chin, inside the head region.",
    );
  const portrait = {
    center: 0,
    width,
    eyes,
    nose: y(nose),
    mouth: y(mouth),
    chin: Math.max(0, y(chin)),
    frame: { base, span, centerX: (x(a) + x(z)) * 0.5 },
  };
  return {
    ...part,
    anatomy: "face",
    motionRole: part.motionRole ?? "head",
    outfitRole: part.outfitRole ?? "head",
    paint: { ...b, portrait },
  };
}
