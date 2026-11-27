import { capturedAxes } from "./catalogue.js";
import { correctedSurface } from "./brush.js";
import { required } from "./required.js";
import {
  evaluateHuman,
  humanRange,
  type HumanAxis,
  type HumanMeasurements,
  type HumanSurface,
} from "./surface.js";
import { regionAt, type FittedAdult } from "./fit-surface.js";
import type { HumanBody } from "./body.js";
export const familyFitAxes: readonly HumanAxis[] = [
  "height",
  "frame",
  "age",
  "weight",
  "muscle",
  "stance",
  "armForward",
  "elbowBend",
  "legSpread",
  "handTwist",
  "wristFlex",
  "fingerCurl",
  "faceA",
  "faceB",
  "shoulders",
  "waist",
  "hips",
  "belly",
  "chest",
  "legs",
  "neck",
  "jaw",
  "nose",
  "noseBridge",
  "cheeks",
  "lips",
  "chin",
  "jawProjection",
  "chinHeight",
  "forehead",
  "temples",
  "noseLength",
  "noseTipWidth",
  "nostrilWidth",
  "craniumDepth",
  "faceHeight",
  "noseHump",
  "lipFullness",
  "upperLipHeight",
  "cupidsBow",
  "underEye",
  "headWidth",
  "eyeSize",
  "brow",
  "ears",
  "seat",
  "arms",
  "calves",
  "upperArmLength",
  "forearmLength",
  "shinLength",
  "torsoLength",
  "neckLength",
  "bust",
  "mouthCorners",
  "mouthProjection",
  "mouthLevel",
  "noseTipAngle",
  "lipParting",
  "lipBalance",
  "smileLeft",
  "smileRight",
  "eyeSpacing",
  "eyeTilt",
  "eyeFold",
  "earTip",
  "earLevel",
  "earSetback",
  "earLength",
  "earFlare",
  "cheekFullness",
  "hands",
  "feet",
  "malarHeight",
  "jowlFullness",
  "submentalFullness",
  "shoulderLine",
  "upperBack",
  "abdominalApron",
];

function headAxes(body: HumanBody, human: HumanMeasurements) {
  const base = evaluateHuman(body, human),
    scale = base.height / 1.72;
  const keys = familyFitAxes.filter((key) => {
    const [lo, hi, initial] = humanRange(key),
      value = human[key] ?? initial,
      step = key === "height" ? 0.04 : 0.3,
      trial = value + step > hi ? value - step : value + step;
    if (trial < lo) return false;
    const other = evaluateHuman(body, { ...human, [key]: trial }).positions;
    let inside = 0,
      outside = 0;
    for (let v = 0; v < base.bodyVertices; v++) {
      const i = 3 * v,
        d = Math.hypot(
          (other[i] ?? 0) - (base.positions[i] ?? 0),
          (other[i + 1] ?? 0) - (base.positions[i + 1] ?? 0),
          (other[i + 2] ?? 0) - (base.positions[i + 2] ?? 0),
        );
      if (regionAt(base, v) === "head") inside = Math.max(inside, d);
      else outside = Math.max(outside, d);
    }
    return inside > 0.0003 * scale && outside < 0.0004 * scale;
  });
  return [...keys, ...capturedAxes.filter((k) => (human[k] ?? 0) > 0)];
}
function solve(matrix: Float64Array[], rhs: Float64Array) {
  const m = matrix.map((row, i) => Float64Array.from([...row, rhs[i] ?? 0])),
    n = m.length;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++)
      if (Math.abs(required(m[i])[k] ?? 0) > Math.abs(required(m[pivot])[k] ?? 0)) pivot = i;
    const row = required(m[pivot]);
    m[pivot] = required(m[k]);
    m[k] = row;
    const diagonal = row[k] ?? 0;
    if (Math.abs(diagonal) < 1e-18) continue;
    for (const [i, target] of m.entries()) {
      if (i === k) continue;
      const factor = (target[k] ?? 0) / diagonal;
      for (let j = k; j <= n; j++) target[j] = (target[j] ?? 0) - factor * (row[j] ?? 0);
    }
  }
  return m.map((row, i) => (Math.abs(row[i] ?? 0) < 1e-18 ? 0 : (row[n] ?? 0) / (row[i] ?? 1)));
}
export function fitFamilyMeasurements(
  body: HumanBody,
  start: FittedAdult,
  rows: readonly number[],
  weights: readonly number[],
  settle: (s: HumanSurface) => Float32Array,
) {
  const keys = headAxes(body, start.human);
  const read = (human: HumanMeasurements) => {
    const surface = correctedSurface(body, evaluateHuman(body, human), start.corrections);
    const points = new Float32Array(rows.length * 3);
    rows.forEach((v, i) => points.set(surface.positions.subarray(3 * v, 3 * v + 3), 3 * i));
    return { surface, points };
  };
  const product = (a: Float32Array, b: Float32Array) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++)
      sum += (weights[Math.floor(i / 3)] ?? 0) * (a[i] ?? 0) * (b[i] ?? 0);
    return sum;
  };
  const residual = (state: ReturnType<typeof read>) =>
    settle(state.surface).map((v, i) => v - (state.points[i] ?? 0));
  let human = { ...start.human },
    now = read(human),
    gap = residual(now),
    loss = product(gap, gap);
  for (let pass = 0; pass < 6 && keys.length; pass++) {
    const columns = keys.map((k) => {
      const [, hi, initial] = humanRange(k),
        value = human[k] ?? initial,
        size = k === "height" ? 0.02 : 0.08,
        step = value + size > hi ? -size : size;
      return read({ ...human, [k]: value + step }).points.map(
        (v, i) => (v - (now.points[i] ?? 0)) / step,
      );
    });
    const matrix = columns.map(() => new Float64Array(keys.length));
    const rhs = Float64Array.from(columns, (c) => product(c, gap));
    let mean = 0;
    columns.forEach((column, j) => {
      const row = required(matrix[j]);
      for (let k = 0; k <= j; k++)
        row[k] = required(matrix[k])[j] = product(column, required(columns[k]));
      mean += (row[j] ?? 0) / keys.length;
    });
    keys.forEach((k, i) => {
      const row = required(matrix[i]),
        diagonal = row[i] ?? 0,
        initial = humanRange(k)[2];
      row[i] = 1.02 * diagonal + 0.004 * mean;
      rhs[i] = (rhs[i] ?? 0) - 0.004 * mean * ((human[k] ?? initial) - (start.human[k] ?? initial));
    });
    const movement = solve(matrix, rhs);
    let accepted = false;
    for (const alpha of [1, 0.5, 0.25]) {
      const trial = { ...human };
      keys.forEach((k, i) => {
        const [lo, hi, initial] = humanRange(k),
          reach = k === "height" ? 0.2 : 0.6;
        trial[k] = Number(
          Math.min(
            hi,
            Math.max(
              lo,
              (human[k] ?? initial) + alpha * Math.min(reach, Math.max(-reach, movement[i] ?? 0)),
            ),
          ).toFixed(4),
        );
      });
      const next = read(trial),
        remaining = residual(next),
        error = product(remaining, remaining);
      if (error < loss * 0.9995) {
        human = trial;
        now = next;
        gap = remaining;
        loss = error;
        accepted = true;
        break;
      }
    }
    if (!accepted) break;
  }
  return { human, keys };
}
