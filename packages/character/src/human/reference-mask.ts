import { Vector3 } from "three";

export function createMask(triangles: number) {
  const steps: Uint32Array[] = [];
  return { hidden: new Uint8Array(triangles), steps, count: 0 };
}
const fewest = 12;

type Mask = ReturnType<typeof createMask>;
type Point = readonly [number, number, number];
function hide(mask: Mask, wanted: (p: Point) => boolean, centre: (f: number) => Point) {
  const n = mask.hidden.length,
    found = [];
  for (let f = 0; f < n; f++) {
    if (mask.hidden[f]) continue;
    if (wanted(centre(f))) found.push(f);
  }
  if (!found.length) return 0;
  if (n - mask.count - found.length < fewest)
    throw new Error("That would hide the whole reference. Hide a smaller part.");
  for (const f of found) mask.hidden[f] = 1;
  mask.steps.push(Uint32Array.from(found));
  mask.count += found.length;
  return found.length;
}
function middles(positions: Float32Array, indices: Uint32Array) {
  const c: [number, number, number] = [0, 0, 0];
  return (f: number) => {
    for (let d = 0; d < 3; d++)
      c[d] =
        ((positions[(indices[f * 3] ?? 0) * 3 + d] ?? 0) +
          (positions[(indices[f * 3 + 1] ?? 0) * 3 + d] ?? 0) +
          (positions[(indices[f * 3 + 2] ?? 0) * 3 + d] ?? 0)) /
        3;
    return c;
  };
}
export function hidePatch(
  mask: Mask,
  positions: Float32Array,
  indices: Uint32Array,
  point: Point,
  radius: number,
) {
  const r = radius * radius;
  return hide(
    mask,
    (c) => (c[0] - point[0]) ** 2 + (c[1] - point[1]) ** 2 + (c[2] - point[2]) ** 2 < r,
    middles(positions, indices),
  );
}
export function hideBeyond(
  mask: Mask,
  positions: Float32Array,
  indices: Uint32Array,
  point: Point,
  direction: Point,
) {
  const level = point[0] * direction[0] + point[1] * direction[1] + point[2] * direction[2];
  return hide(
    mask,
    (c) => c[0] * direction[0] + c[1] * direction[1] + c[2] * direction[2] > level,
    middles(positions, indices),
  );
}
export function undoMask(mask: Mask) {
  const last = mask.steps.pop();
  if (!last) return 0;
  for (const f of last) mask.hidden[f] = 0;
  mask.count -= last.length;
  return last.length;
}
export function clearMask(mask: Mask) {
  const shown = mask.count;
  mask.hidden.fill(0);
  mask.steps.length = 0;
  mask.count = 0;
  return shown;
}
export function maskedIndices(mask: Mask, indices: Uint32Array) {
  const n = mask.hidden.length,
    shown = new Uint32Array((n - mask.count) * 3),
    hidden = new Uint32Array(mask.count * 3),
    kept = new Uint32Array(n - mask.count);
  let s = 0,
    h = 0;
  for (let f = 0; f < n; f++) {
    const to = mask.hidden[f] ? hidden : shown,
      at = mask.hidden[f] ? h++ : s++;
    if (!mask.hidden[f]) kept[at] = f;
    for (let k = 0; k < 3; k++) to[at * 3 + k] = indices[f * 3 + k] ?? 0;
  }
  return { shown, hidden, kept };
}
export function maskSummary(mask: Mask, positions: Float32Array, indices: Uint32Array) {
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  let all = 0,
    gone = 0;
  for (let f = 0; f < mask.hidden.length; f++) {
    a.fromArray(positions, (indices[f * 3] ?? 0) * 3);
    b.fromArray(positions, (indices[f * 3 + 1] ?? 0) * 3).sub(a);
    c.fromArray(positions, (indices[f * 3 + 2] ?? 0) * 3).sub(a);
    const area = b.cross(c).length() / 2;
    all += area;
    if (mask.hidden[f]) gone += area;
  }
  return {
    triangles: mask.hidden.length,
    hiddenTriangles: mask.count,
    hiddenArea: all ? gone / all : 0,
    steps: mask.steps.length,
  };
}
export const underMask = (hidden: (v: Vector3) => number) => (point: Vector3, shown: number) =>
  Math.abs(hidden(point)) < Math.abs(shown);

export function vertexAreas(positions: Float32Array, indices: ArrayLike<number> | null = null) {
  const areas = new Float32Array(positions.length / 3),
    corners = indices ? indices.length : positions.length / 3,
    at = (k: number) => (indices ? (indices[k] ?? 0) : k) * 3;
  for (let f = 0; f + 2 < corners; f += 3) {
    const a = at(f),
      b = at(f + 1),
      c = at(f + 2),
      ux = (positions[b] ?? 0) - (positions[a] ?? 0),
      uy = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0),
      uz = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0),
      vx = (positions[c] ?? 0) - (positions[a] ?? 0),
      vy = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0),
      vz = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0),
      third = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6;
    areas[a / 3] = (areas[a / 3] ?? 0) + third;
    areas[b / 3] = (areas[b / 3] ?? 0) + third;
    areas[c / 3] = (areas[c / 3] ?? 0) + third;
  }
  return areas;
}

const count = (n: number) => n.toLocaleString("en");
export function maskText({
  triangles,
  hiddenTriangles,
  hiddenArea,
}: ReturnType<typeof maskSummary>) {
  return (
    count(hiddenTriangles) +
    " of " +
    count(triangles) +
    " triangles hidden, " +
    (hiddenArea * 100).toFixed(hiddenArea < 0.1 ? 1 : 0) +
    "% of the reference's surface"
  );
}
