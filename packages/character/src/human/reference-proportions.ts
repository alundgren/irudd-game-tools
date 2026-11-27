import { required } from "./required.js";
import { Vector3 } from "three";
import type { HumanBody } from "./body.js";
import type { HumanAxis } from "./surface.js";
import { fittingSkin, type FittedAdult } from "./fit-surface.js";
import { proportions, proportionPlaces as places } from "./proportion-places.js";
export { proportions, proportionPlaces } from "./proportion-places.js";
import { proportionSolver } from "./proportion-solver.js";
export function readProportion(id: string, a: Vector3, b: Vector3) {
  const spec = proportions.find((s) => s.id === id);
  const y = b.y - a.y;
  return (
    1000 *
    (spec?.kind === "rise"
      ? (Math.abs(b.x) >= Math.abs(a.x) ? 1 : -1) * y
      : spec?.kind === "height"
        ? Math.abs(y)
        : Math.hypot(b.x - a.x, y))
  );
}
export function proportionPoints(body: HumanBody, adult: FittedAdult) {
  const s = fittingSkin(body, adult),
    refs = body.arrays.u16("subRefs"),
    offsets = body.arrays.u32("subOffsets"),
    weights = body.arrays.f32("subFactors");
  const points = new Map<string, Vector3>();
  for (const [name, vertices] of Object.entries(places)) {
    const point = new Vector3(),
      p = new Vector3();
    for (const v of vertices)
      for (let j = offsets[v] ?? 0; j < (offsets[v + 1] ?? 0); j++)
        point.addScaledVector(
          p.fromArray(s.positions, 3 * (refs[j] ?? 0)),
          (weights[j] ?? 0) / vertices.length,
        );
    points.set(name, point);
  }
  return points;
}
export function proportionReadings(body: HumanBody, adult: FittedAdult) {
  const points = proportionPoints(body, adult);
  return new Map(
    proportions.map((spec) => [
      spec.id,
      readProportion(spec.id, required(points.get(spec.from)), required(points.get(spec.to))),
    ]),
  );
}
export function proportionChoices(
  body: HumanBody,
  adult: FittedAdult,
  ids: readonly string[],
  hold?: (p: Vector3) => boolean,
  keepEyeOpenings = false,
) {
  const solver = proportionSolver(body),
    options = { hold, keepEyeOpenings };
  const suggested = solver.suggestControls(adult, ids, options);
  return solver
    .proportionControls(adult, options)
    .filter(
      (c) =>
        suggested.able.includes(c.key) ||
        (!c.free &&
          ids.some(
            (id) => Math.max(Math.abs(c.rates[id] ?? 0), Math.abs(c.ratesDown[id] ?? 0)) >= 0.5,
          )),
    )
    .map((c) => ({
      key: c.key,
      free: c.free,
      reason: c.why ?? "",
      suggested: suggested.includes(c.key),
    }));
}
export function fitMarkedProportions(
  body: HumanBody,
  adult: FittedAdult,
  targets: ReadonlyMap<string, number>,
  controls: readonly HumanAxis[],
  hold?: (p: Vector3) => boolean,
  keepEyeOpenings = false,
) {
  return proportionSolver(body).fitProportions(adult, Object.fromEntries(targets), {
    controls,
    hold,
    keepEyeOpenings,
  });
}
