import { Vector3 } from "three";
import type { HumanBody } from "./body.js";
import { fitFamilyMeasurements } from "./family-measurements.js";
import { fittedHeadLayer, measuredHeadIntegrity, eyeGuard, headShare } from "./head-constraints.js";

import { evaluateHuman } from "./surface.js";
import { correctedSurface } from "./brush.js";
import {
  alignReference,
  bodyColumn,
  poseReadings,
  type AlignmentOptions,
} from "./reference-align.js";
import {
  alignPoints,
  registerFamily,
  transformPoints,
  wrapFamilyMember,
} from "./family-registration.js";
import type { ReferenceMesh } from "./reference-mesh.js";
import { fittingSkin, fitSurface, regionAt, type FittedAdult } from "./fit-surface.js";

export function prealignAdult(
  body: HumanBody,
  adult: FittedAdult,
  mesh: ReferenceMesh,
  options: AlignmentOptions,
  matchHeight: boolean,
  matchArms: boolean,
) {
  const stature = adult.human.height ?? 1.72;
  const pose = poseReadings(alignReference(mesh, options, { stature }).positions);
  const human = { ...adult.human };
  const height = +Math.max(1.43, Math.min(2.08, pose.stature)).toFixed(3);
  if (matchHeight && Math.abs(height - stature) > 0.0005) human.height = height;
  if (matchArms && pose.armsBelowHorizontal !== null) {
    const read = (stance: number) => {
      const s = fittingSkin(body, { ...adult, human: { ...human, stance } });
      return poseReadings(s.positions.subarray(0, 3 * s.bodyVertices)).armsBelowHorizontal;
    };
    let a = 0,
      b = 1,
      fa = read(a),
      fb = read(b),
      best: number | undefined;
    for (let pass = 0; pass < 4 && fa !== null && fb !== null && fa !== fb; pass++) {
      best = Math.max(-1, Math.min(1, a + ((pose.armsBelowHorizontal - fa) * (b - a)) / (fb - fa)));
      const f = read(best);
      if (f === null || Math.abs(f - pose.armsBelowHorizontal) < 0.25 || best === b) break;
      a = b;
      fa = fb;
      b = best;
      fb = f;
    }
    if (best !== undefined && Math.abs(best - (human.stance ?? 0)) > 0.005)
      human.stance = +best.toFixed(2);
  }
  const prepared = { ...adult, human };
  const skin = fittingSkin(body, prepared);
  const placed = alignReference(mesh, options, {
    stature,
    column: bodyColumn(skin.positions.subarray(0, 3 * skin.bodyVertices)),
  });
  return { prepared, placed, pose };
}

export function registerNeutral(body: HumanBody, raw: ReferenceMesh, options: AlignmentOptions) {
  const { prepared, placed } = prealignAdult(body, { human: {} }, raw, options, true, true);
  const neutral = { positions: placed.positions, indices: raw.indices };
  const fit = fitSurface(body, prepared, neutral, "whole", {
    measurements: true,
    contours: false,
    headOnly: false,
    keepEyes: false,
  });
  const skin = fittingSkin(body, fit.adult);
  const vertices = Uint32Array.from({ length: skin.bodyVertices }, (_, i) => i);
  const registration = registerFamily(
    neutral,
    { ...skin, triangles: skin.bodyTriangles },
    { vertices, reach: (0.012 * skin.height) / 1.72 },
  );
  const headVertices = vertices.filter((v) => regionAt(skin, v) === "head").length;
  const registered = registration.vertex.filter((v) => regionAt(skin, v) === "head").length;
  return {
    registration,
    indices: raw.indices,
    factor: placed.report.factor,
    registered,
    headVertices,
  };
}
type Registered = ReturnType<typeof registerNeutral>;
const gather = (positions: Float32Array, ids: readonly number[] | Uint32Array) => {
  const p = new Float32Array(ids.length * 3);
  ids.forEach((v, i) => p.set(positions.subarray(v * 3, v * 3 + 3), 3 * i));
  return p;
};

function errorStats(values: number[]) {
  values.sort((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1),
    p95: values[Math.floor(0.95 * (values.length - 1))] ?? 0,
  };
}
export function transferHead(
  body: HumanBody,
  neutral: Registered,
  member: ReferenceMesh,
  adult: FittedAdult,
  measurements: boolean,
  detail: boolean,
) {
  if (!measurements && !detail)
    throw new Error("Choose head measurements, the fine layer, or both.");
  if (
    neutral.indices.length !== member.indices.length ||
    neutral.indices.some((v, i) => member.indices[i] !== v)
  )
    throw new Error("Choose meshes with the same vertex and triangle order.");
  const { registration } = neutral;
  const wrapped = wrapFamilyMember(
    registration,
    {
      positions: Float32Array.from(member.positions, (x) => x * neutral.factor),
      indices: member.indices,
    },
    0,
  );
  const start: FittedAdult = {
    human: adult.human,
    ...(adult.corrections ? { corrections: adult.corrections } : {}),
  };
  const skin = fittingSkin(body, start);

  const picks: number[] = [],
    rows: number[] = [],
    weights: number[] = [];
  const c = new Vector3(),
    p = new Vector3();
  const lids = eyeGuard(skin).free;
  registration.vertex.forEach((v, i) => {
    if (regionAt(skin, v) !== "head") return;
    const share = headShare(skin, v);
    if (share <= 0.05) return;
    const weight = share * (lids[v] ?? 1);
    picks.push(i);
    rows.push(v);
    weights.push(weight);
  });
  const core = weights.flatMap((w, i) => (w > 0.9 ? [i] : []));
  if (core.length < 30)
    throw new Error("Too little of the head is registered against this neutral.");
  const source = gather(wrapped, picks),
    registered = gather(registration.base, rows);
  const placed = transformPoints(
    source,
    alignPoints(gather(source, core), gather(registered, core)).matrix,
  );
  const settle = (surface: typeof skin) =>
    transformPoints(
      placed,
      alignPoints(
        gather(placed, core),
        gather(
          surface.positions,
          core.map((i) => rows[i] ?? 0),
        ),
      ).matrix,
    );
  const initial = settle(skin);
  const plan = measurements
    ? fitFamilyMeasurements(body, start, rows, weights, settle)
    : { human: start.human, keys: [] };
  const human = plan.human;
  const result: FittedAdult = { ...start, human };
  const measured = correctedSurface(body, evaluateHuman(body, human), adult.corrections);
  const goal = settle(measured);
  const layer = detail
    ? fittedHeadLayer(body, skin, measured, Uint32Array.from(rows), goal)
    : undefined;
  if (layer?.layer) result.fineHead = layer.layer;
  const finished = fittingSkin(body, result);
  const integrity = layer ?? measuredHeadIntegrity(skin, measured);
  const fine = result.fineHead;
  const lengths =
    fine?.vertices.map(
      (_, i) => ((0.01 * measured.height) / 1.72) * c.fromArray(fine.offsets, 3 * i).length(),
    ) ?? [];
  const scored = weights.flatMap((w, i) => (w > 0.5 ? [i] : []));
  const residual = (points: Float32Array, s: typeof skin) =>
    errorStats(
      scored.map(
        (i) =>
          1000 *
          c.fromArray(points, 3 * i).distanceTo(p.fromArray(s.positions, 3 * (rows[i] ?? 0))),
      ),
    );
  return {
    adult: result,
    before: residual(initial, skin),
    after: residual(goal, finished),
    limited: layer?.limited ?? 0,
    folds: integrity.folds,
    contactBefore: integrity.contactBefore,
    contactAfter: integrity.contactAfter,
    fineMean: lengths.reduce((sum, x) => sum + x, 0) / Math.max(1, lengths.length),
    fineMax: lengths.reduce((max, x) => Math.max(max, x), 0),
    outsideMm:
      1000 *
      skin.positions.reduce(
        (max, _x, i) =>
          i % 3 === 0 && i < 3 * skin.bodyVertices && regionAt(skin, i / 3) !== "head"
            ? Math.max(
                max,
                c.fromArray(skin.positions, i).distanceTo(p.fromArray(finished.positions, i)),
              )
            : max,
        0,
      ),
    registered: rows.length,
    measurementKeys: plan.keys,
  };
}
