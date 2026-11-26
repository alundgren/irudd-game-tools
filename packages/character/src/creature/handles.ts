import { add, type CreaturePlan, type Vec3 } from "@irudd/document";
import { bodyStation } from "./body.js";

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export const girths = ["Hips", "Loin", "Belly", "Chest", "Shoulders"] as const;
export type Handle = {
  kind: "girth" | "limb";
  index: number;
  label: string;
  value: number;
  min: number;
  max: number;
  point: (value: number) => Vec3;
};
export function creatureHandles(p: CreaturePlan): Handle[] {
  const handles: Handle[] = girths.map((label, index) => {
    const t = [0.09, 0.25, 0.5, 0.75, 0.91][index] ?? 0.5,
      s = bodyStation(p, t),
      value = p.spine.bulge[index] ?? 1;
    return {
      kind: "girth",
      index,
      label: label + " thickness",
      value,
      min: 0.4,
      max: 2.2,
      point: (n) => add(s.point, [0, (s.depth * n) / value, 0]),
    };
  });
  p.limbs.forEach((l, index) => {
    const value = (l.from + l.to) / 2,
      half = Math.abs(l.to - l.from) / 2;
    handles.push({
      kind: "limb",
      index,
      label: "Move " + l.kind + " group " + (index + 1),
      value,
      min: half,
      max: 1 - half,
      point: (n) => {
        const s = bodyStation(p, n);
        return add(s.point, [s.width * (l.side === "right" ? -1 : 1), 0, 0]);
      },
    });
  });
  return handles;
}
export function moveHandle(p: CreaturePlan, h: Handle, value: number): CreaturePlan {
  const n = clamp(value, h.min, h.max);
  if (h.kind === "girth") {
    const bulge: [number, number, number, number, number] = [...p.spine.bulge];
    bulge[h.index] = n;
    return { ...p, spine: { ...p.spine, bulge } };
  }
  return {
    ...p,
    limbs: p.limbs.map((l, i) =>
      i === h.index
        ? { ...l, from: clamp(l.from + n - h.value, 0, 1), to: clamp(l.to + n - h.value, 0, 1) }
        : l,
    ),
  };
}
