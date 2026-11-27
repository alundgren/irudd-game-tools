import { Schema } from "effect";
import { Digest, SlotKey, JsonValue } from "../schema.js";
import { family } from "./family.js";

export const FigureScapulaMount = Schema.Struct({
  side: Schema.Literals([1, -1]),
});
export type FigureScapulaMount = typeof FigureScapulaMount.Type;

export const figureScapulaMount = family({
  id: "figure.scapula-mount",
  version: 1,
  scope: "part",
  schema: FigureScapulaMount,
  toJson: (v) => v,
});

export const FigureNativePortrait = Schema.Struct({
  layer: Digest,
});
export type FigureNativePortrait = typeof FigureNativePortrait.Type;

export const figureNativePortrait = family({
  id: "figure.native-portrait",
  version: 1,
  scope: "part",
  schema: FigureNativePortrait,
  toJson: (v) => v,
  references: (v) => [
    { kind: "asset" as const, id: v.layer, path: ["layer"], role: "portrait-plate" },
  ],
});

const correction = Schema.Int.check(Schema.isBetween({ minimum: -651, maximum: 651 }));
const control = Schema.Tuple([
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1044 })),
  correction,
  correction,
  correction,
]);
export const humanCorrections = family({
  id: "human.surface-corrections",
  version: 1,
  scope: "document",
  schema: Schema.Struct({
    controls: Schema.Array(control).check(
      Schema.isMaxLength(1045),
      Schema.makeFilter(
        (rows) =>
          (new Set(rows.map((row) => row[0])).size === rows.length &&
            rows.every(([, x, y, z]) => Math.hypot(x, y, z) <= 651)) ||
          "Use distinct controls within the correction limit.",
      ),
    ),
  }),
  toJson: (v) => v,
});
export type SkinCorrections = NonNullable<ReturnType<typeof humanCorrections.read>>;
export const humanReferenceRigs = family({
  id: "human.reference-rigs",
  version: 1,
  scope: "document",
  schema: Schema.Struct({
    rigs: Schema.Array(
      Schema.Literals([
        "lee-perry-smith",
        "mhr-rest",
        "mhr-f1",
        "mhr-f2",
        "mhr-f3",
        "mhr-m1",
        "mhr-m2",
        "mhr-m3",
      ]),
    ),
  }),
  toJson: (v) => v,
});
export const AdultRegionSource = Schema.Struct({
  version: Schema.Int,
  params: JsonValue,
  corrections: Schema.optionalKey(humanCorrections.schema),
});
export type AdultRegionSource = typeof AdultRegionSource.Type;
export const humanRegionCopy = family({
  id: "human.region-copy",
  version: 1,
  scope: "part",
  schema: Schema.Struct({ slot: SlotKey, source: Schema.optionalKey(AdultRegionSource) }),
  toJson: (v) => v,
});
