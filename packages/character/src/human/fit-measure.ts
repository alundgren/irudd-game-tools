import { required } from "./required.js";
import { Box3, Vector3 } from "three";
import type { HumanBody } from "./body.js";
import {
  evaluateHuman,
  humanRange,
  type HumanAxis,
  type HumanMeasurements,
  type HumanSurface,
} from "./surface.js";
import { boneNames } from "./catalogue.js";
import { regionAt, type FitRegion, type FittedAdult } from "./fit-types.js";
import { applyHeadLayer } from "./fine-head.js";
import { correctedSurface } from "./brush.js";
import { vertexNormals } from "./family-registration.js";
import { eyeOpenings, exteriorSkin, fitControls } from "./fit-topology.js";
import { fitSummary } from "./fit-local.js";
import type { FitTargetTree } from "./fit-target.js";
import type { ReferenceMesh } from "./reference-mesh.js";
import { headDepthSamples, matchHeadDepth } from "./fit-head-depth.js";
import { lipCreaseSamples, fitLipContact } from "./fit-lips.js";
const axes: Record<Exclude<FitRegion, "whole">, HumanAxis[]> = {
  head: [
    "headWidth",
    "craniumDepth",
    "faceHeight",
    "noseTipAngle",
    "noseTipWidth",
    "nostrilWidth",
    "earLevel",
    "earSetback",
    "earLength",
    "earFlare",
    "jaw",
    "chin",
    "cheeks",
    "nose",
    "noseBridge",
    "ears",
    "neckLength",
    "neck",
    "brow",
    "eyeSize",
    "lips",
    "jawProjection",
    "chinHeight",
    "forehead",
    "temples",
    "noseLength",
    "noseHump",
    "lipFullness",
    "lipBalance",
    "upperLipHeight",
    "cupidsBow",
    "mouthCorners",
    "mouthProjection",
    "lipParting",
    "mouthLevel",
    "underEye",
    "eyeSpacing",
    "cheekFullness",
    "malarHeight",
    "jowlFullness",
    "submentalFullness",
    "eyeFold",
  ],
  trunk: [
    "bust",
    "shoulders",
    "waist",
    "chest",
    "belly",
    "abdominalApron",
    "hips",
    "seat",
    "torsoLength",
    "neckLength",
    "shoulderLine",
    "upperBack",
  ],
  arms: [
    "stance",
    "armForward",
    "elbowBend",
    "handTwist",
    "wristFlex",
    "hands",
    "upperArmLength",
    "forearmLength",
    "arms",
  ],
  legs: ["legSpread", "legs", "shinLength", "calves", "feet"],
};
function solve(a: Float64Array[], b: Float64Array) {
  const rows = a.map((row, i) => [...row, b[i] ?? 0]),
    n = b.length;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let j = k + 1; j < n; j++)
      if (Math.abs(required(rows[j])[k] ?? 0) > Math.abs(required(rows[pivot])[k] ?? 0)) pivot = j;
    [rows[pivot], rows[k]] = [required(rows[k]), required(rows[pivot])];
    if (Math.abs(required(rows[k])[k] ?? 0) < 1e-12) continue;
    const value = required(rows[k])[k] ?? 0;
    for (let j = k; j <= n; j++) required(rows[k])[j] = (required(rows[k])[j] ?? 0) / value;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const scale = required(rows[i])[k] ?? 0;
      for (let j = k; j <= n; j++)
        required(rows[i])[j] = (required(rows[i])[j] ?? 0) - (required(rows[k])[j] ?? 0) * scale;
    }
  }
  return rows.map((row) => row[n] ?? 0);
}
function subset(v: Float32Array, indices: number[]) {
  const out = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++)
    for (let k = 0; k < 3; k++) out[i * 3 + k] = v[(indices[i] ?? 0) * 3 + k] ?? 0;
  return out;
}
function armExtremes(positions: Float32Array, count: number, height: number) {
  const directions = [];
  for (const side of [-1, 1])
    for (const [x, y, z] of [
      [0.94, -0.34, 0],
      [0.8, -0.6, 0],
      [0.82, -0.32, 0.47],
      [0.82, -0.32, -0.47],
    ]) {
      const normal = new Vector3(side * (x ?? 0), y, z).normalize();
      let outer = -Infinity,
        index = -1;
      for (let i = 0; i < count; i++) {
        const j = i * 3,
          px = positions[j] ?? 0,
          py = positions[j + 1] ?? 0,
          pz = positions[j + 2] ?? 0;
        if (side * px < 0.145 * height || py < 0.28 * height || py > 0.84 * height) continue;
        const support = px * normal.x + py * normal.y + pz * normal.z;
        if (support > outer) {
          outer = support;
          index = i;
        }
      }
      directions.push({
        normal,
        outer,
        index,
        spread: index >= 0 && Math.abs(positions[index * 3] ?? 0) > 0.205 * height,
      });
    }
  return directions;
}
function footExtents(positions: Float32Array, count: number, height: number) {
  const feet: ({ back: number; front: number; minX: number; maxX: number } | null)[] = [null, null];
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3] ?? 0,
      y = positions[i * 3 + 1] ?? 0,
      z = positions[i * 3 + 2] ?? 0;
    if (y < -0.01 * height || y > 0.055 * height || Math.abs(x) < 0.012 * height) continue;
    const side = Number(x > 0);
    const foot = (feet[side] ??= { back: z, front: z, minX: x, maxX: x });
    foot.back = Math.min(foot.back, z);
    foot.front = Math.max(foot.front, z);
    foot.minX = Math.min(foot.minX, x);
    foot.maxX = Math.max(foot.maxX, x);
  }
  return feet.map((f) => {
    if (!f) return null;
    const length = f.front - f.back,
      width = f.maxX - f.minX;
    return length > 0.085 * height &&
      length < 0.205 * height &&
      width > 0.025 * height &&
      width < 0.1 * height
      ? { ...f, length }
      : null;
  });
}
function referencedPositions(mesh: ReferenceMesh) {
  const ids = [...new Set(mesh.indices)];
  const points = new Float32Array(3 * ids.length);
  ids.forEach((v, i) => points.set(mesh.positions.subarray(3 * v, 3 * v + 3), 3 * i));
  return { array: points, count: ids.length };
}

function fitFootLength(
  target: ReturnType<typeof referencedPositions>,
  params: HumanMeasurements,
  surface: HumanSurface,
  evaluate: (h: HumanMeasurements) => HumanSurface,
) {
  const targetFeet = footExtents(target.array, target.count, surface.height);
  const lengths = (s: HumanSurface) => footExtents(s.positions, s.bodyVertices, s.height);
  const error = (feet: ReturnType<typeof footExtents>) => {
    if (!feet.every(Boolean) || !targetFeet.every(Boolean)) return null;
    const gaps = feet.map(
      (foot, i) => (required(targetFeet[i])?.length ?? 0) - (foot?.length ?? 0),
    );
    if (
      Math.abs((gaps[0] ?? 0) - (gaps[1] ?? 0)) > 0.015 * surface.height ||
      gaps.some((g) => Math.abs(g) > 0.06 * surface.height)
    )
      return null;
    return ((gaps[0] ?? 0) + (gaps[1] ?? 0)) / 2;
  };
  for (let i = 0; i < 3; i++) {
    const gap = error(lengths(surface));
    if (gap === null || Math.abs(gap) < 0.002) break;
    const size = params.feet ?? 0,
      step = size > 0.93 ? -0.07 : 0.07;
    const probe = error(lengths(evaluate({ ...params, feet: size + step })));
    if (probe === null) break;
    const slope = (gap - probe) / step;
    if (slope < 0.005) break;
    const nextSize = Math.max(-1, Math.min(1, size + gap / slope));
    const next = evaluate({ ...params, feet: nextSize }),
      nextGap = error(lengths(next));
    if (nextGap === null || Math.abs(nextGap) >= Math.abs(gap)) break;
    params.feet = nextSize;
    surface = next;
  }
  return surface;
}
export function fitReferenceMeasurements(
  body: HumanBody,
  form: FittedAdult,
  mesh: ReferenceMesh,
  tree: FitTargetTree,
  region: FitRegion,
  isolatedHead: boolean,
  keepEyeOpenings: boolean,
  hold?: (p: Vector3) => boolean,
) {
  const evaluate = (p: HumanMeasurements) =>
    applyHeadLayer(
      body,
      correctedSurface(body, evaluateHuman(body, p), form.corrections),
      form.fineHead,
    );

  let keys: HumanAxis[] =
    region === "whole"
      ? [
          ...new Set<HumanAxis>([
            "frame",
            "weight",
            "muscle",
            "age",
            "faceA",
            "faceB",
            ...axes.trunk,
            ...axes.arms,
            ...axes.legs,
            ...axes.head,
          ]),
        ]
      : isolatedHead && region === "head"
        ? axes.head.filter((k) => k !== "neck" && k !== "neckLength")
        : axes[region];
  if (!keys || !form.human) throw new Error("Choose a supported human region.");

  const original = evaluate(form.human);
  const controls = fitControls(body),
    params = { ...form.human };
  const target = referencedPositions(mesh);
  if (region === "whole") {
    const bbox = new Box3().setFromArray(target.array);
    const targetHeight = bbox.max.y - bbox.min.y;
    if (targetHeight >= 1.43 && targetHeight <= 2.08) params.height = targetHeight;
  }
  const exterior = exteriorSkin(original, controls);
  const eligible = (v: number) =>
    (exterior[v] ?? 0) &&
    (region === "whole" ||
      (regionAt(original, v) === region &&
        (!isolatedHead || boneNames[original.boneIndices[v * 4] ?? 0] === "head")));
  const anchors = Array.from(controls.ids).filter(eligible);
  const check = [];
  const ctl = new Set(controls.ids);
  const p = new Vector3(),
    n = new Vector3();
  const eyes = keepEyeOpenings ? eyeOpenings(original, controls) : null;
  if (eyes) {
    const start = evaluate(params).positions;
    keys = keys.filter((key) => {
      const [, hi, def] = humanRange(key),
        v = params[key] ?? def,
        moved = evaluate({ ...params, [key]: v + (v + 0.065 > hi ? -0.065 : 0.065) }).positions;
      let within = 0,
        all = 0;
      for (let i = 0; i < original.bodyVertices; i++) {
        let d = 0;
        for (let k = i * 3; k < i * 3 + 3; k++) d += ((moved[k] ?? 0) - (start[k] ?? 0)) ** 2;
        all += d;
        if (eyes.skin[i] ?? 0) within += d;
      }
      return within <= 0.5 * all;
    });
  }
  const held = (surface: HumanSurface, v: number) =>
    Boolean((eyes?.skin[v] ?? 0) || hold?.(p.fromArray(surface.positions, v * 3)));
  for (let v = 5; v < original.bodyVertices; v += 9)
    if (!ctl.has(v) && eligible(v) && !held(original, v)) check.push(v);
  let surface = evaluate(params);

  const useArms = !tree.observedDirection && (region === "whole" || region === "arms");
  const ref = useArms ? armExtremes(target.array, target.count, surface.height) : [];
  const useFeet = !tree.observedDirection && (region === "whole" || region === "legs");
  const heads =
    region === "whole" || region === "head"
      ? headDepthSamples(surface, tree.observedDirection)
      : [];
  for (let iteration = 0; iteration < 6; iteration++) {
    const edges = useArms
      ? armExtremes(surface.positions, surface.bodyVertices, surface.height).flatMap((edge, i) =>
          edge.spread &&
          required(ref[i]).spread &&
          Math.abs(required(ref[i]).outer - edge.outer) < 0.23
            ? [{ ...edge, error: required(ref[i]).outer - edge.outer }]
            : [],
        )
      : [];
    const surfaceNormals = vertexNormals(surface.positions, surface.indices, surface.bodyTriangles);
    const depth = matchHeadDepth(heads, surface, surfaceNormals, tree);
    const lips = heads.length ? lipCreaseSamples(surface, tree) : [];
    const constraints: { index: number; normal: Vector3; error: number; weight?: number }[] = [
      ...edges,
      ...depth,
      ...lips,
    ].filter((e) => !held(surface, e.index));
    const pins = [...anchors, ...constraints.map((e) => e.index)];
    const flat = subset(surface.positions, pins),
      normals = subset(surfaceNormals, pins);
    const residual = new Float32Array(pins.length),
      confidence = new Float32Array(pins.length);
    for (let i = 0; i < constraints.length; i++) {
      const row = anchors.length + i;
      required(constraints[i]).normal.toArray(normals, row * 3);
      residual[row] = required(constraints[i]).error;
      confidence[row] = required(constraints[i]).weight ?? 12;
    }
    let count = 0;
    for (let i = 0; i < anchors.length; i++) {
      p.fromArray(flat, i * 3);
      n.fromArray(normals, i * 3);
      if (tree.observedDirection && n.dot(tree.observedDirection) < 0.15) continue;
      if (eyes?.skin[anchors[i] ?? 0] || hold?.(p)) continue;
      const near = tree.query(p, n, 0.24);
      if (!near) continue;
      residual[i] = n.dot(near.clone().sub(p));
      confidence[i] = Math.min(1, 0.032 / Math.max(0.0001, Math.abs(residual[i] ?? 0)));
      count++;
    }
    if (count < 12) throw new Error("Too few surface correspondences. Align the reference first.");
    const cols = keys.map((key) => {
      const [, hi, def] = humanRange(key),
        v = params[key] ?? def,
        step = v + 0.065 > hi ? -0.065 : 0.065;
      const other = evaluate({ ...params, [key]: v + step }).positions,
        column = new Float32Array(pins.length);
      for (let i = 0; i < pins.length; i++)
        for (let k = 0; k < 3; k++)
          column[i] =
            (column[i] ?? 0) +
            (((other[(pins[i] ?? 0) * 3 + k] ?? 0) - (flat[i * 3 + k] ?? 0)) *
              (normals[i * 3 + k] ?? 0)) /
              step;
      return column;
    });
    const a = keys.map(() => new Float64Array(keys.length)),
      b = new Float64Array(keys.length);
    for (let j = 0; j < keys.length; j++) {
      for (let i = 0; i < pins.length; i++) {
        const w = (confidence[i] ?? 0) * (required(cols[j])[i] ?? 0);
        b[j] = (b[j] ?? 0) + w * (residual[i] ?? 0);
        for (let k = 0; k <= j; k++)
          required(a[j])[k] = (required(a[j])[k] ?? 0) + w * (required(cols[k])[i] ?? 0);
      }
      for (let k = 0; k < j; k++) required(a[k])[j] = required(a[j])[k] ?? 0;
      if (
        axes.head.includes(required(keys[j])) &&
        !["neck", "neckLength"].includes(required(keys[j]))
      ) {
        let peak = 0;
        for (const response of required(cols[j])) peak = Math.max(peak, Math.abs(response));
        const support = peak > 1e-8 ? (required(a[j])[j] ?? 0) / (peak * peak) : 0;
        const prior = Math.max(1, support) * 0.00002;
        const initial = form.human[required(keys[j])] ?? humanRange(required(keys[j]))[2];
        required(a[j])[j] = (required(a[j])[j] ?? 0) + (prior + Math.max(1, support) * 0.000003);
        b[j] = (b[j] ?? 0) - prior * ((params[required(keys[j])] ?? initial) - initial);
      } else {
        required(a[j])[j] = (required(a[j])[j] ?? 0) + count * 0.000012;
      }
    }
    const step = solve(a, b);
    const loss = (v: Float32Array) =>
      v.reduce((acc, x, i) => acc + (confidence[i] ?? 0) * x * x, 0);
    const before = loss(residual);
    let accepted = false;
    for (const alpha of [1, 0.45, 0.2]) {
      const trial = { ...params };
      keys.forEach((key, j) => {
        const [lo, hi, def] = humanRange(key),
          delta = Math.max(-0.48, Math.min(0.48, step[j] ?? 0));
        trial[key] = Math.min(hi, Math.max(lo, (params[key] ?? def) + alpha * delta));
      });
      const next = evaluate(trial),
        test = new Float32Array(residual);
      for (let i = 0; i < pins.length; i++)
        for (let k = 0; k < 3; k++)
          test[i] =
            (test[i] ?? 0) -
            ((next.positions[(pins[i] ?? 0) * 3 + k] ?? 0) - (flat[i * 3 + k] ?? 0)) *
              (normals[i * 3 + k] ?? 0);
      if (loss(test) < before * 0.999) {
        Object.assign(params, trial);
        surface = next;
        accepted = true;
        break;
      }
    }
    if (!accepted) break;
  }
  if (heads.length && !lipCreaseSamples(surface, tree).some((e) => held(surface, e.index)))
    surface = fitLipContact(params, surface, tree, evaluate);
  if (useFeet) surface = fitFootLength(target, params, surface, evaluate);
  return {
    human: params,
    metrics: {
      before: fitSummary(original, tree, check),
      after: fitSummary(surface, tree, check),
    },
  };
}
