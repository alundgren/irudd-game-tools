import { Schema } from "effect";
import { motionRoles, outfitRoles } from "@irudd/document";

const between = (minimum: number, maximum: number) =>
  Schema.Number.check(Schema.isBetween({ minimum, maximum }));
const unit = between(0, 1),
  point = Schema.Tuple([unit, unit]);
const name = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.makeFilter((s) => !!s.trim() || "Each region needs a name."),
);
const outline = Schema.Array(point).check(
  Schema.isMaxLength(64),
  Schema.makeFilter((a) => !a.length || a.length >= 3 || "Mark at least three outline points."),
);
const radius = Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(0.6));
const region = Schema.Struct({
  id: name,
  parent: Schema.optionalKey(name),
  method: Schema.Literals(["loft", "volume", "path", "membrane"]),
  front: Schema.optionalKey(outline),
  side: Schema.optionalKey(outline),
  spine: Schema.optionalKey(
    Schema.Array(Schema.Tuple([unit, unit, unit, unit, radius, radius])).check(
      Schema.isMinLength(2),
      Schema.isMaxLength(48),
    ),
  ),
  correspondence: Schema.optionalKey(Schema.Literals(["same", "opposite"])),
  thickness: Schema.optionalKey(Schema.Number),
  faceLandmarks: Schema.optionalKey(
    Schema.Array(point).check(Schema.isMinLength(5), Schema.isMaxLength(5)),
  ),
  hairRegions: Schema.optionalKey(
    Schema.Array(Schema.Struct({ id: name, front: outline, side: outline })),
  ),
  depthPairs: Schema.optionalKey(
    Schema.Array(Schema.Tuple([unit, unit, unit, unit, Schema.Number])),
  ),
  motionRole: Schema.optionalKey(Schema.Literals(motionRoles)),
  outfitRole: Schema.optionalKey(Schema.Literals(outfitRoles)),
}).check(
  Schema.makeFilter(
    (r) =>
      (r.method === "path" ? !!r.spine : !!r.front && !!r.side) ||
      "Supply the region's outlines or centreline.",
  ),
);
const manualMap = Schema.Struct({
  format: Schema.Literal("irudd.trace-map.v1"),
  height: between(0.15, 6),
  regions: Schema.Array(region).check(Schema.isMinLength(1), Schema.isMaxLength(48)),
});
export function decodeManualTraceMap(input: unknown) {
  const map = Schema.decodeUnknownSync(manualMap)(input);
  const parents = new Map(map.regions.map((r) => [r.id, r.parent]));
  if (parents.size !== map.regions.length) throw new Error("Trace region IDs must be unique.");
  for (const r of map.regions) {
    let parent = r.parent;
    const seen = new Set([r.id]);
    while (parent) {
      if (!parents.has(parent)) throw new Error("Unknown parent for " + r.id + ".");
      if (seen.has(parent)) throw new Error("Cycle in the part map.");
      seen.add(parent);
      parent = parents.get(parent);
    }
  }
  return map;
}
