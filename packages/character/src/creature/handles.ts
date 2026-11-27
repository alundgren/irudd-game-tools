import { add, scale, cross, dot, length, type CreaturePlan, type Vec3 } from "@irudd/document";
import { bodyStation, limbSocket } from "./body.js";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const unit = (v: Vec3) => scale(v, 1 / (length(v) || 1));
export const girths = ["Hips", "Loin", "Belly", "Chest", "Shoulders"] as const;
export type Handle = {
  kind: "girth" | "limb";
  index: number;
  label: string;
  value: number;
  min: number;
  max: number;
  point: (value: number) => Vec3;
  guides: (value: number) => { lines: Vec3[][]; dots: Vec3[] };
  readout: (value: number) => string;
};
export function moveHandle(
  p: CreaturePlan,
  h: Pick<Handle, "min" | "max" | "kind" | "index" | "value">,
  value: number,
): CreaturePlan {
  const n = clamp(value, h.min, h.max),
    round = (v: number) => Math.round(v * 1000) / 1000;
  if (h.kind === "girth") {
    const bulge: [number, number, number, number, number] = [...p.spine.bulge];
    bulge[h.index] = round(n);
    return { ...p, spine: { ...p.spine, bulge } };
  }
  return {
    ...p,
    limbs: p.limbs.map((l, i) =>
      i === h.index
        ? {
            ...l,
            from: round(clamp(l.from + n - h.value, 0, 1)),
            to: round(clamp(l.to + n - h.value, 0, 1)),
          }
        : l,
    ),
  };
}
export function creatureHandles(
  p: CreaturePlan,
  forward: Vec3 = [0, 0, -1],
  up: Vec3 = [0, 1, 0],
): Handle[] {
  const handles: Handle[] = girths.map((label, index) => {
    const station = [0.1, 0.25, 0.5, 0.75, 0.9][index] ?? 0.5;
    const { tangent, dorsal } = bodyStation(p, station);
    const contour = cross(tangent, forward);
    let axis = length(contour) < 0.2 ? dorsal : unit(contour);
    const vertical = dot(axis, up);
    if (Math.abs(vertical) > 0.2 ? vertical < 0 : dot(axis, cross(forward, up)) < 0)
      axis = scale(axis, -1);
    const info = {
      kind: "girth" as const,
      index,
      value: p.spine.bulge[index] ?? 1,
      min: 0.4,
      max: 2.2,
    };
    const section = (v: number) => {
      const s = bodyStation(moveHandle(p, info, v), station);
      return {
        s,
        at: (a: number, b: number) =>
          add(add(s.point, [s.width * a, 0, 0]), scale(dorsal, s.depth * b)),
      };
    };
    return {
      ...info,
      label: label + " thickness",
      point: (v: number) => {
        const { s, at } = section(v),
          a = s.width * axis[0],
          b = s.depth * dot(axis, dorsal),
          l = Math.hypot(a, b) || 1;
        return at(a / l, b / l);
      },
      guides: (v: number) => {
        const { at } = section(v);
        return {
          lines: [
            Array.from({ length: 41 }, (_, i) =>
              at(Math.cos((i * Math.PI) / 20), Math.sin((i * Math.PI) / 20)),
            ),
          ],
          dots: [],
        };
      },
      readout: (v: number) => label + " thickness ×" + v.toFixed(2),
    };
  });
  p.limbs.forEach((l, index) => {
    const value = (l.from + l.to) / 2,
      half = Math.abs(l.to - l.from) / 2;
    const sides = l.side === "both" ? [1, -1] : [l.side === "left" ? 1 : -1];
    const side = l.side === "both" ? (forward[0] > 0 ? -1 : 1) : (sides[0] ?? 1);
    const root = (v: number, side: number) => limbSocket(p, l.kind, v, side);
    handles.push({
      kind: "limb",
      index,
      label: "Move " + l.kind + " group " + (index + 1),
      value,
      min: half,
      max: 1 - half,
      point: (v) => root(v, side),
      guides: (v) => ({
        lines: sides.map((side) => Array.from({ length: 65 }, (_, i) => root(i / 64, side))),
        dots: sides.flatMap((side) =>
          Array.from({ length: l.pairs }, (_, i) =>
            root(v + (l.pairs === 1 ? 0 : ((2 * i) / (l.pairs - 1) - 1) * half), side),
          ),
        ),
      }),
      readout: (v) =>
        l.kind +
        " group " +
        (index + 1) +
        " at " +
        (v - half).toFixed(2) +
        (half ? "–" + (v + half).toFixed(2) : "") +
        " (0 hips, 1 chest)",
    });
  });
  return handles;
}
export function handleValue(
  h: Handle,
  project: (p: Vec3) => readonly [number, number],
  goal: readonly [number, number],
) {
  let distance = Infinity,
    best = h.value;
  for (let i = 0; i < 64; i++) {
    const a = h.min + ((h.max - h.min) * i) / 64,
      b = h.min + ((h.max - h.min) * (i + 1)) / 64,
      p = project(h.point(a)),
      q = project(h.point(b));
    const x = q[0] - p[0],
      y = q[1] - p[1],
      l = x * x + y * y;
    const t = l ? clamp(((goal[0] - p[0]) * x + (goal[1] - p[1]) * y) / l, 0, 1) : 0;
    const d = Math.hypot(goal[0] - p[0] - x * t, goal[1] - p[1] - y * t);
    if (d < distance) {
      distance = d;
      best = a + (b - a) * t;
    }
  }
  return best;
}
