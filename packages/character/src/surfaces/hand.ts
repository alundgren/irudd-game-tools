// Hands: a palm and digit chains filled into one surface, with a rig of
// three joints per digit. Ported from character-view/hands.js,
// hand-surface.js and cylindrical-grip.js at 2761eb1, arithmetic in the same
// order so the vertices match.

import type { FigureHand } from "@irudd/document";
import * as T from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

/** [x, y, z, x radius, z radius] in metres. */
type Row = [number, number, number, number, number];

/** One digit's joint anchors in the part frame and the vertices it carries. */
export interface Digit {
  readonly name: string;
  /** Three anchors, the first at the knuckle, in the part's unit frame. */
  readonly anchors: ReadonlyArray<readonly [number, number, number]>;
  /** Vertex indices of the digit and, for each, how far along its chain it sits (0–3). */
  readonly vertices: number[];
  readonly parameters: number[];
}

export interface HandSurface {
  readonly geometry: T.BufferGeometry;
  readonly digits: ReadonlyArray<Digit>;
}

const at = (v: ArrayLike<number>, i: number): number => v[i] ?? 0;
const row = (r: ReadonlyArray<number>): Row => [at(r, 0), at(r, 1), at(r, 2), at(r, 3), at(r, 4)];

// The cylindrical handle crosses the palm along local X.
const gripCentre = [0, -0.095, 0.026] as const;
const gripRadius = 0.015;

function closedDigitRows(rows: Row[], thumb: boolean, side: number): Row[] {
  const cy = gripCentre[1];
  const cz = gripCentre[2];
  const r = gripRadius;
  if (thumb) {
    const controls: ReadonlyArray<readonly [number, number, number]> = [
      [-0.023, -0.033, 0.009],
      [-0.038, -0.049, 0.019],
      [-0.047, -0.065, 0.031],
      [-0.043, cy + 0.01, cz + 0.016],
      [-0.026, cy + 0.006, cz + 0.009],
    ];
    return rows.map((rw, i) => {
      const c = controls[i] ?? [0, 0, 0];
      return [c[0] * side, c[1], c[2], rw[3], rw[4]];
    });
  }
  const angles = [-90, -131, -174, -219, -251].map((d) => (d * Math.PI) / 180);
  return rows.map((rw, i) => {
    if (!i) return [rw[0], -0.083, 0.004, rw[3], rw[4]];
    const ring = r + 0.43 * (rw[3] + rw[4]) * 0.5;
    return [
      rw[0],
      cy + ring * Math.cos(at(angles, i)),
      cz + ring * Math.sin(at(angles, i)),
      rw[3],
      rw[4],
    ];
  });
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (t: number) => Math.max(0, Math.min(1, t));

interface Segment {
  readonly a: Row;
  readonly b: Row;
  readonly ratio: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly inv: number;
}

function segments(rows: ReadonlyArray<Row>): Segment[] {
  return rows.slice(1).map((b, i) => {
    const a = rows[i] ?? b;
    const ratio = (a[3] + b[3]) / (a[4] + b[4]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = (b[2] - a[2]) * ratio;
    return { a, b, ratio, dx, dy, dz, inv: 1 / (dx * dx + dy * dy + dz * dz || 1) };
  });
}

function palmDistance(palm: ReadonlyArray<Row>, x: number, y: number, z: number): number {
  let i = 0;
  while (i < palm.length - 2 && y < (palm[i + 1]?.[1] ?? -Infinity)) i++;
  const a = palm[i];
  const b = palm[i + 1];
  if (!a || !b) return -1;
  const t = clamp((y - a[1]) / (b[1] - a[1]));
  const rx = mix(a[3], b[3], t);
  const rz = mix(a[4], b[4], t);
  const dx = (x - mix(a[0], b[0], t)) / rx;
  const dz = (z - mix(a[2], b[2], t)) / rz;
  const dy = (y - mix(a[1], b[1], t)) / 0.009;
  return (1 - Math.hypot(dx, dy, dz)) * Math.min(rx, rz);
}

const fieldMaterial = new T.MeshBasicMaterial();

// A rounded palm and tapered phalanges share one surface at the webbing.
// Sample in metres so long, slim or curled fingers keep their cross sections.
function handSurface(
  palm: ReadonlyArray<Row>,
  digits: ReadonlyArray<{ readonly name: string; readonly rows: Row[] }>,
  dimensions: readonly [number, number, number],
  game: boolean,
): HandSurface {
  const n = game ? 26 : 50;
  const chains = digits.map((d) => segments(d.rows));
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const [i, rows] of [palm, ...digits.map((d) => d.rows)].entries())
    for (const a of rows) {
      const extent = [a[3] + 0.005, (i ? Math.max(a[3], a[4]) : 0.01) + 0.004, a[4] + 0.005];
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(at(lo, k), at(a, k) - at(extent, k));
        hi[k] = Math.max(at(hi, k), at(a, k) + at(extent, k));
      }
    }
  // MarchingCubes leaves boundary cells unused. At game density a fingertip
  // or the wrist can reach that boundary despite the margin measured in metres.
  if (game)
    for (let axis = 0; axis < 3; axis++) {
      const margin = (2 * (at(hi, axis) - at(lo, axis))) / (n - 4);
      lo[axis] = at(lo, axis) - margin;
      hi[axis] = at(hi, axis) + margin;
    }
  const span = hi.map((v, i) => v - at(lo, i));
  const step = span.map((v) => v / n);
  let owner = -1;
  let along = 0;
  const field = (x: number, y: number, z: number): number => {
    const palmField = palmDistance(palm, x, y, z);
    let best = -1;
    let which = -1;
    let tAlong = 0;
    for (let j = 0; j < chains.length; j++) {
      const chain = chains[j] ?? [];
      for (let k = 0; k < chain.length; k++) {
        const s = chain[k];
        if (!s) continue;
        const { a, b, ratio, dx, dy, dz, inv } = s;
        const px = x - a[0];
        const py = y - a[1];
        const pz = (z - a[2]) * ratio;
        const t = clamp((px * dx + py * dy + pz * dz) * inv);
        const distance =
          mix(a[3], b[3], t) -
          Math.sqrt((px - t * dx) ** 2 + (py - t * dy) ** 2 + (pz - t * dz) ** 2);
        if (distance > best) {
          best = distance;
          which = j;
          tAlong = k + t;
        }
      }
    }
    owner = best >= palmField - 0.0014 ? which : -1;
    along = tAlong;
    const blend = 0.0036 * Math.max(0, 1 - Math.abs(palmField - best) / 0.0036) ** 2 * 0.25;
    return Math.max(palmField, best) + blend;
  };
  const mc = new MarchingCubes(n, fieldMaterial, false, false, 24 * n * n);
  mc.isolation = 0;
  mc.field.fill(-0.02);
  for (let k = 1; k < n - 1; k++)
    for (let j = 1; j < n - 1; j++)
      for (let i = 1; i < n - 1; i++)
        mc.field[i + n * (j + n * k)] = field(
          at(lo, 0) + i * at(step, 0),
          at(lo, 1) + j * at(step, 1),
          at(lo, 2) + k * at(step, 2),
        );
  mc.update();
  const pos = new Float32Array(mc.count * 3);
  const normal = new Float32Array(mc.count * 3);
  const uv = new Float32Array(mc.count * 2);
  const v = new T.Vector3();
  for (let i = 0; i < mc.count; i++) {
    for (let a = 0; a < 3; a++)
      pos[3 * i + a] = at(lo, a) + (1 + at(mc.positionArray, 3 * i + a)) * 0.5 * at(span, a);
    v.fromArray(mc.normalArray, 3 * i)
      .set(v.x / at(span, 0), v.y / at(span, 1), v.z / at(span, 2))
      .normalize()
      .toArray(normal, 3 * i);
    uv[2 * i] = (at(pos, 3 * i) - at(lo, 0)) / at(span, 0);
    uv[2 * i + 1] = (at(pos, 3 * i + 1) - at(lo, 1)) / at(span, 1);
  }
  mc.geometry.dispose();
  const raw = new T.BufferGeometry();
  raw.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  raw.setAttribute("normal", new T.Float32BufferAttribute(normal, 3));
  raw.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  const g = mergeVertices(raw, 0.000001);
  raw.dispose();
  const rig = digits.map((d): Digit => ({
    name: d.name,
    anchors: d.rows
      .slice(0, 3)
      .map((r): [number, number, number] => [
        r[0] / dimensions[0],
        r[1] / dimensions[1],
        r[2] / dimensions[2],
      ]),
    vertices: [],
    parameters: [],
  }));
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    field(p.getX(i), p.getY(i), p.getZ(i));
    const digit = rig[owner];
    if (owner >= 0 && digit) {
      digit.vertices.push(i);
      digit.parameters.push(along);
    }
  }
  g.scale(1 / dimensions[0], 1 / dimensions[1], 1 / dimensions[2]);
  return { geometry: g, digits: rig };
}

// The wrist is the pivot. Digit chains bend toward the palm in its local
// frame, and the opposable thumb has its own plane of movement.
export function handGeometry(grip: FigureHand, { game = false } = {}): HandSurface {
  const fingers = grip.fingers ?? 4;
  const curl = grip.curl ?? 0.15;
  const spread = grip.spread ?? 0.2;
  const side = grip.side ?? 1;
  const relaxed = grip.relaxed ?? false;
  const cylindrical = grip.cylindrical ?? false;
  const pad = grip.pad ?? "hand";
  const w = 0.085;
  const h = 0.18;
  const d = 0.039;
  let palm: Row[] = [];
  const digits: { name: string; rows: Row[] }[] = [];
  const loft = (rows: ReadonlyArray<ReadonlyArray<number>>, name?: string) => {
    const scaled = rows.map((r): Row => {
      const [x, y, z, rx, rz] = row(r);
      return [x * w * side, y * h, z * d, rx * w, rz * d];
    });
    if (!cylindrical && pad !== "hand") {
      // A padded paw has a metacarpal cushion and short, thick toes.
      // In a raptorial grasp the long distal phalanx curls toward the palm.
      // Both use the same individual digit chains as the animator.
      for (const [i, p] of scaled.entries()) {
        const t = i / (scaled.length - 1);
        const toe = name && name !== "Thumb";
        const paw = pad === "paw";
        p[0] *= paw ? 1.12 : 0.95;
        if (paw) {
          p[1] *= toe ? 1 - 0.16 * t : 0.97;
          p[2] += toe ? 0.012 * t * t : 0;
          p[3] *= toe ? 1.35 : 1.05;
          p[4] *= toe ? 1.42 : 1.24;
        } else if (name) {
          p[2] += 0.021 * t * t;
          p[1] += 0.009 * t ** 3;
          const taper = i === scaled.length - 1 ? 0.36 : 1.03;
          p[3] *= taper;
          p[4] *= taper;
        }
      }
    }
    if (name === "Thumb" && relaxed)
      scaled.forEach((p, i) => {
        const extension = i / (scaled.length - 1);
        p[0] -= side * 0.009 * extension;
        p[2] += 0.004 * extension;
      });
    if (name)
      digits.push({
        name,
        rows: cylindrical ? closedDigitRows(scaled, name === "Thumb", side) : scaled,
      });
    else palm = scaled;
  };
  // The little-finger edge rounds away first. The palm fans from a
  // flatter wrist, with the thumb pad carried by the thumb's root.
  loft(
    relaxed
      ? [
          [0, 0.024, -0.015, 0.27, 0.37],
          [0, -0.07, -0.008, 0.3, 0.36],
          [-0.022, -0.19, 0.012, 0.388, 0.455],
          [-0.006, -0.34, 0.018, 0.452, 0.455],
          [0.008, -0.435, 0.02, 0.458, 0.37],
          [-0.04, -0.508, 0.025, 0.38, 0.3],
        ]
      : [
          [0, 0, 0, 0.29, 0.33],
          [0, -0.12, 0.005, 0.35, 0.43],
          [0.012, -0.28, 0, 0.45, 0.5],
          [0.014, -0.42, 0.018, 0.47, 0.43],
          [0, -0.53, 0.03, 0.41, 0.34],
        ],
  );
  for (let i = 0; i < fingers; i++) {
    const u = fingers === 1 ? 0.5 : i / (fingers - 1);
    const x = -0.33 + u * 0.69;
    const fan = (u - 0.5) * spread;
    const length = 0.429 + 0.055 * Math.sin(u * Math.PI) - 0.083 * u;
    const thick = Math.min(0.118, 0.435 / fingers);
    const rows: Row[] = [
      [x, -0.49, 0.015, thick, 0.25],
      [x + fan * 0.3, -0.49 - length * 0.35, -0.045 + curl * 0.17, thick * 0.91, 0.234],
      [
        x + fan * 0.62,
        -0.49 - length * 0.68 + curl * 0.035,
        0.025 + curl * 0.43,
        thick * 0.84,
        0.192,
      ],
      [
        x + fan * 0.94,
        -0.49 - length * 0.98 + curl * 0.14,
        0.12 + curl * 0.67,
        thick * 0.75,
        0.176,
      ],
      [x + fan, -0.49 - length + curl * 0.145, 0.132 + curl * 0.68, thick * 0.46, 0.12],
    ];
    // Preserve the bind shape of authored grasps. A hanging human hand
    // has staggered knuckles and increasing flexion toward the little finger.
    if (relaxed) {
      const bend = curl * (0.77 + 0.79 * u);
      let y = -0.485 - 0.025 * Math.sin(Math.PI * u) + 0.055 * u;
      let z = 0.015;
      const segmentAngles: ReadonlyArray<readonly [number, number]> = [
        [0.36, 0.3],
        [0.33, 1.18],
        [0.27, 1.84],
        [0.04, 1.96],
      ];
      const first = rows[0];
      if (first) first[1] = y;
      for (const [index, [fraction, angle]] of segmentAngles.entries()) {
        y -= length * fraction * Math.cos(angle * bend);
        z += (length * fraction * Math.sin(angle * bend) * h) / d;
        const target = rows[index + 1];
        if (target) {
          target[1] = y;
          target[2] = z;
        }
      }
    }
    loft(rows, ["Index", "Middle", "Ring", "Little"][i] ?? "Digit" + (i + 1));
  }
  loft(
    [
      [-0.25, -0.17, 0.19, 0.163, 0.32],
      [-0.406, -0.28, 0.33, 0.153, 0.29],
      [-0.56 - spread * 0.1, -0.395, 0.46, 0.13, 0.25],
      [-0.59 - spread * 0.14, -0.51 + curl * 0.08, 0.57 + curl * 0.19, 0.115, 0.2],
      [-0.58 - spread * 0.14, -0.57 + curl * 0.13, 0.65 + curl * 0.35, 0.069, 0.14],
    ],
    "Thumb",
  );
  return handSurface(palm, digits, [w, h, d], game);
}
