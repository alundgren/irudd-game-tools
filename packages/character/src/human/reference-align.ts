import { required } from "./required.js";
import type { ReferenceMesh } from "./reference-mesh.js";
export interface AlignmentOptions {
  units?: string;
  up?: string;
  turn?: string;
  nudge?: readonly [number, number, number];
}
function box(positions: Float32Array, keep?: (x: number, y: number, z: number) => boolean) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (let i = 0; i < positions.length; i += 3) {
    if (keep && !keep(positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0)) continue;
    count++;
    for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d] ?? 0, positions[i + d] ?? 0);
      max[d] = Math.max(max[d] ?? 0, positions[i + d] ?? 0);
    }
  }
  return {
    count,
    min,
    max,
    size: max.map((x, d) => x - (min[d] ?? 0)),
    centre: max.map((x, d) => (x + (min[d] ?? 0)) / 2),
  };
}
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? ((s[(s.length - 1) >> 1] ?? 0) + (s[s.length >> 1] ?? 0)) / 2 : 0;
};

const slabs = [0.06, 0.28, 0.53, 0.72, 0.93];
export function bodyColumn(positions: Float32Array) {
  const all = box(positions),
    h = all.size[1] ?? 0;
  return slabs.map((f) => {
    const b = box(positions, (_x, y) => Math.abs(y - (all.min[1] ?? 0) - f * h) < 0.02 * h);
    return b.count ? [b.centre[0], b.centre[2]] : null;
  });
}

export function poseReadings(positions: Float32Array) {
  const all = box(positions),
    h = all.size[1] ?? 0,
    floor = all.min[1] ?? 0,
    x0 = median(
      bodyColumn(positions)
        .filter((x) => x != null)
        .map((c) => c[0] ?? 0),
    );
  const arms = [-1, 1].map((side) => {
    let n = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      syy = 0,
      sxy = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const x = ((positions[i] ?? 0) - x0) * side,
        y = (positions[i + 1] ?? 0) - floor;
      if (x < 0.14 * h || y < 0.33 * h) continue;
      n++;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
    if (n < 30) return null;
    const mx = sx / n,
      my = sy / n,
      angle =
        (0.5 * Math.atan2(2 * (sxy / n - mx * my), sxx / n - mx * mx - (syy / n - my * my)) * 180) /
        Math.PI;
    return Math.abs(angle) > 70 && my < 0.72 * h ? Math.abs(angle) : -angle;
  });
  const feet = [-1, 1].map((side) =>
    box(positions, (x, y) => (x - x0) * side > 0 && y - floor < 0.05 * h),
  );
  return {
    stature: h,
    armsBelowHorizontal: arms.every((a) => a !== null)
      ? ((arms[0] ?? 0) + (arms[1] ?? 0)) / 2
      : null,
    armDifference: arms.every((a) => a !== null) ? Math.abs((arms[0] ?? 0) - (arms[1] ?? 0)) : null,
    footSpacing:
      required(feet[0]).count && required(feet[1]).count
        ? (required(feet[1]).centre[0] ?? 0) - (required(feet[0]).centre[0] ?? 0)
        : null,
  };
}

export const unitChoices: Record<string, readonly [string, number]> = {
  m: ["metres", 1],
  cm: ["centimetres", 0.01],
  mm: ["millimetres", 0.001],
  in: ["inches", 0.0254],
  ft: ["feet", 0.3048],
};
const adult = [1.2, 2.3];
function facesBack(positions: Float32Array) {
  const all = box(positions),
    h = all.size[1] ?? 0,
    y0 = all.min[1] ?? 0;
  const foot = box(positions, (_x, y) => y - y0 < 0.035 * h),
    ankle = box(positions, (_x, y) => y - y0 > 0.07 * h && y - y0 < 0.12 * h);
  return ankle.count > 0 && (foot.centre[2] ?? 0) < (ankle.centre[2] ?? 0);
}

export function alignReference(
  raw: ReferenceMesh,
  options: AlignmentOptions = {},
  template: { stature?: number; column?: ReturnType<typeof bodyColumn> } = {},
) {
  const { up = "auto", units = "auto", turn = "auto", nudge = [0, 0, 0] } = options;
  const positions = raw.positions.slice(),
    notes = [];
  const source = box(positions);
  const zUp = up === "z" || (up === "auto" && (source.size[2] ?? 0) > (source.size[1] ?? 0) * 1.2);
  if (zUp)
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1] ?? 0;
      positions[i + 1] = positions[i + 2] ?? 0;
      positions[i + 2] = -y;
    }
  const tall = box(positions).size[1] ?? 0;
  if (!(tall > 0)) throw new Error("The reference needs a measurable height.");
  let unit: string | undefined = units,
    factor;
  if (units === "auto") {
    unit = Object.keys(unitChoices).find((key) => {
      const metres = tall * (required(unitChoices[key])[1] ?? 0);
      return metres >= (adult[0] ?? 0) && metres <= (adult[1] ?? 0);
    });
    if (!unit) {
      unit = "stature";
      notes.push(
        "No common unit makes this an adult height, so it was scaled to the template stature. Choose the source units if you know them.",
      );
    }
  }
  if (unit === "stature") factor = (template.stature ?? 1.72) / tall;
  else {
    const chosen = required(unitChoices[unit ?? ""]);
    if (!chosen) throw new Error("Unknown reference unit.");
    factor = chosen[1];
  }
  for (let i = 0; i < positions.length; i++) positions[i] = (positions[i] ?? 0) * factor;
  let degrees = Number(turn),
    turnReason = "chosen";
  if (turn === "auto") {
    const size = box(positions).size;
    degrees = (size[2] ?? 0) > (size[0] ?? 0) ? 90 : 0;
    turnReason = "width";
  }
  const spin = (angle: number) => {
    const c = Math.round(Math.cos((angle * Math.PI) / 180)),
      s = Math.round(Math.sin((angle * Math.PI) / 180));
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] ?? 0,
        z = positions[i + 2] ?? 0;
      positions[i] = x * c + z * s;
      positions[i + 2] = -x * s + z * c;
    }
  };
  if (degrees) spin(degrees);
  if (turn === "auto" && facesBack(positions)) {
    spin(180);
    degrees = (degrees + 180) % 360;
    turnReason = "feet";
  }
  if (turn !== "auto") {
    const size = box(positions).size;
    if ((size[2] ?? 0) > (size[0] ?? 0))
      notes.push(
        "The reference is deeper than it is wide, so it is probably standing sideways. Let the turn be detected.",
      );
    else if (facesBack(positions))
      notes.push(
        "The feet point backwards, so the reference is probably facing away. Let the turn be detected.",
      );
  }
  const stood = box(positions),
    here = bodyColumn(positions),
    there = template.column ?? [];
  const pairs = here
    .map(
      (c, i) =>
        c &&
        there[i] && [
          (required(there[i])[0] ?? 0) - (c[0] ?? 0),
          (required(there[i])[1] ?? 0) - (c[1] ?? 0),
        ],
    )
    .filter((x) => x != null);
  const shift = [
    (pairs.length ? median(pairs.map((p) => p[0] ?? 0)) : -(stood.centre[0] ?? 0)) +
      (nudge[0] ?? 0),
    -(stood.min[1] ?? 0) + (nudge[1] ?? 0),
    (pairs.length ? median(pairs.map((p) => p[1] ?? 0)) : -(stood.centre[2] ?? 0)) +
      (nudge[2] ?? 0),
  ];
  for (let i = 0; i < positions.length; i += 3)
    for (let d = 0; d < 3; d++) positions[i + d] = (positions[i + d] ?? 0) + (shift[d] ?? 0);
  if ((stood.size[1] ?? 0) < (adult[0] ?? 0) || (stood.size[1] ?? 0) > (adult[1] ?? 0))
    notes.push(
      "At " +
        (stood.size[1] ?? 0).toFixed(2) +
        " m this is outside adult stature. Check the source units.",
    );
  return {
    positions,
    report: {
      sourceSize: source.size,
      sourceHeight: tall,
      up: zUp ? "Z" : "Y",
      upAuto: up === "auto",
      unit,
      unitAuto: units === "auto",
      factor,
      turn: degrees,
      turnReason,
      stature: stood.size[1] ?? 0,
      notes,
    },
  };
}

export function summarise(distances: number[] | Float32Array) {
  if (!distances.length) return null;
  const size = Float32Array.from(distances, Math.abs).sort();
  let sum = 0,
    signed = 0;
  for (let i = 0; i < size.length; i++) {
    sum += size[i] ?? 0;
    signed += distances[i] ?? 0;
  }
  return {
    meanMm: (1000 * sum) / size.length,
    p95Mm: 1000 * (size[Math.min(size.length - 1, Math.floor(0.95 * size.length))] ?? 0),
    biasMm: (1000 * signed) / size.length,
    samples: size.length,
  };
}
