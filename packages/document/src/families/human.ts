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
const fineOffset = Schema.Int.check(Schema.isBetween({ minimum: -1200, maximum: 1200 }));
export const humanFineHead = family({
  id: "human.fine-head",
  version: 1,
  scope: "document",
  schema: Schema.Struct({
    vertices: Schema.Array(
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 17595 })),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(17596)),
    offsets: Schema.Array(fineOffset).check(Schema.isMaxLength(52788)),
  }).check(
    Schema.makeFilter(
      ({ vertices, offsets }) =>
        (offsets.length === vertices.length * 3 &&
          vertices.every(
            (v, i) =>
              v > (vertices[i - 1] ?? -1) &&
              Math.hypot(
                offsets[i * 3] ?? Infinity,
                offsets[i * 3 + 1] ?? Infinity,
                offsets[i * 3 + 2] ?? Infinity,
              ) <= 1200,
          )) ||
        "Use ascending head vertices with one bounded three-axis correction per vertex.",
    ),
  ),
  toJson: (v) => v,
});
export type FineHeadLayer = NonNullable<ReturnType<typeof humanFineHead.read>>;
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
  fineHead: Schema.optionalKey(humanFineHead.schema),
});
export type AdultRegionSource = typeof AdultRegionSource.Type;
export const humanRegionCopy = family({
  id: "human.region-copy",
  version: 1,
  scope: "part",
  schema: Schema.Struct({ slot: SlotKey, source: Schema.optionalKey(AdultRegionSource) }),
  toJson: (v) => v,
});
