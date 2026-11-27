import { fitReferenceMeasurements } from "./fit-measure.js";
import { localReferenceFit } from "./fit-local.js";
import { fitTarget } from "./fit-target.js";
import { Vector3 } from "three";

import type { HumanBody } from "./body.js";
import { boneNames } from "./catalogue.js";
import { evaluateHuman } from "./surface.js";
import { correctedSurface } from "./brush.js";
import { applyHeadLayer } from "./fine-head.js";
import { fittedHeadLayer, headShare } from "./head-constraints.js";
import type { ReferenceMesh } from "./reference-mesh.js";

export { regionAt, type FittedAdult, type FitRegion } from "./fit-types.js";
import { regionAt, type FittedAdult, type FitRegion } from "./fit-types.js";
export function fittingSkin(body: HumanBody, adult: FittedAdult) {
  return applyHeadLayer(
    body,
    correctedSurface(body, evaluateHuman(body, adult.human), adult.corrections),
    adult.fineHead,
  );
}

export function fitSurface(
  body: HumanBody,
  adult: FittedAdult,
  ref: ReferenceMesh,
  region: FitRegion,
  options: {
    measurements: boolean;
    contours: boolean;
    keepEyes: boolean;
    headOnly: boolean;
    held?: (p: Vector3, shown: number) => boolean;
  },
) {
  const skin = fittingSkin(body, adult),
    keepHead = !!adult.fineHead && region !== "head" && !options.headOnly;
  const target = fitTarget(ref, options.headOnly),
    head = boneNames.indexOf("head");
  let floor = Infinity;
  if (keepHead)
    for (let v = 0; v < skin.bodyVertices; v++)
      if (skin.boneIndices[4 * v] === head)
        floor = Math.min(floor, skin.positions[3 * v + 1] ?? Infinity);
  const hidden = options.held
    ? (p: Vector3) => {
        const near = target.query(p, null);
        return !!options.held?.(p, near ? near.distanceTo(p) : Infinity);
      }
    : undefined;
  const hold = keepHead ? (p: Vector3) => p.y >= floor || !!hidden?.(p) : hidden;
  const measured = options.measurements
    ? fitReferenceMeasurements(
        body,
        adult,
        ref,
        target,
        region,
        options.headOnly,
        options.keepEyes,
        hidden,
      )
    : undefined;
  const human = measured?.human ?? adult.human;
  let fitted: ReturnType<typeof localReferenceFit> | undefined, problem: string | undefined;
  const result: FittedAdult = { ...adult, human };
  try {
    fitted = localReferenceFit(
      body,
      result,
      target,
      region,
      options.headOnly,
      options.keepEyes,
      options.contours,
      hold,
    );
    result.corrections = fitted.fit;
  } catch (error) {
    if (!measured) throw error;
    problem = error instanceof Error ? error.message : String(error);
  }
  let preserved: { carried: number; kept: number; limited: number; folds: number } | undefined;
  if (keepHead) {
    const coarse = correctedSurface(body, evaluateHuman(body, human), result.corrections);
    const rows = Uint32Array.from({ length: coarse.bodyVertices }, (_, v) => v).filter(
      (v) => headShare(coarse, v) > 0.05 && regionAt(coarse, v) === "head",
    );
    const goal = new Float32Array(3 * rows.length),
      joint = 3 * boneNames.indexOf("head"),
      size = coarse.height / skin.height;
    rows.forEach((v, i) => {
      for (let d = 0; d < 3; d++)
        goal[3 * i + d] =
          (coarse.joints[joint + d] ?? 0) +
          size * ((skin.positions[3 * v + d] ?? 0) - (skin.joints[joint + d] ?? 0));
    });
    const { layer, limited, folds } = fittedHeadLayer(body, skin, coarse, rows, goal);
    const mean = (positions: Float32Array) => {
      let sum = 0,
        count = 0;
      rows.forEach((v, i) => {
        if (headShare(coarse, v) > 0.5) {
          sum += new Vector3()
            .fromArray(positions, 3 * v)
            .distanceTo(new Vector3().fromArray(goal, 3 * i));
          count++;
        }
      });
      return (1000 * sum) / Math.max(1, count);
    };
    preserved = {
      carried: mean(applyHeadLayer(body, coarse, adult.fineHead).positions),
      kept: mean(applyHeadLayer(body, coarse, layer).positions),
      limited,
      folds,
    };
    if (layer) result.fineHead = layer;
    else delete result.fineHead;
  }
  return {
    adult: result,
    fitted: fitted?.metrics.fittedAnchors ?? 0,
    candidates: fitted?.metrics.eligibleAnchors ?? 0,
    metrics: fitted?.metrics,
    measure: measured?.metrics,
    preserved,
    problem,
  };
}
