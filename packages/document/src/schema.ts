import { Schema } from "effect";
import { isJson, type Json } from "./json.js";
import { quatNorm } from "./geometry.js";

const pattern = (re: RegExp, message: string) =>
  Schema.String.check(Schema.isPattern(re, { message }));

export const DocumentId = pattern(
  /^doc-[a-z0-9][a-z0-9-]{3,62}$/,
  "Use a document ID like doc-1a2b3c4d.",
).pipe(Schema.brand("DocumentId"));
export type DocumentId = typeof DocumentId.Type;

export const PartId = pattern(/^p-[a-z0-9][a-z0-9-]{0,62}$/, "Use a part ID like p-trunk.").pipe(
  Schema.brand("PartId"),
);
export type PartId = typeof PartId.Type;

export const PoseId = pattern(
  /^pose-[a-z0-9][a-z0-9-]{0,62}$/,
  "Use a pose ID like pose-rest.",
).pipe(Schema.brand("PoseId"));
export type PoseId = typeof PoseId.Type;

export const EditId = pattern(/^d-[a-z0-9][a-z0-9-]{0,62}$/, "Use an edit ID like d-1.").pipe(
  Schema.brand("EditId"),
);
export type EditId = typeof EditId.Type;

export const ProposalId = pattern(
  /^prop-[a-z0-9][a-z0-9-]{0,62}$/,
  "Use a proposal ID like prop-1.",
).pipe(Schema.brand("ProposalId"));
export type ProposalId = typeof ProposalId.Type;

export const Digest = pattern(/^sha256:[0-9a-f]{64}$/, "Use a sha256:<64 hex> digest.").pipe(
  Schema.brand("Digest"),
);
export type Digest = typeof Digest.Type;

export const FeatureId = pattern(
  /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/,
  "Use a dotted feature name like core.sculpt.",
).pipe(Schema.brand("FeatureId"));
export type FeatureId = typeof FeatureId.Type;

export const GeneratorId = pattern(
  /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/,
  "Use a dotted generator name like irudd.frame-creature.",
).pipe(Schema.brand("GeneratorId"));
export type GeneratorId = typeof GeneratorId.Type;

export const Namespace = pattern(
  /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/,
  "Use a dotted namespace like com.example.notes.",
).pipe(Schema.brand("Namespace"));
export type Namespace = typeof Namespace.Type;

export const CatalogId = pattern(
  /^[a-z][a-z0-9.-]{1,63}$/,
  "Use a catalog name like irudd.parts.",
).pipe(Schema.brand("CatalogId"));
export type CatalogId = typeof CatalogId.Type;

export const SlotKey = pattern(/^[a-z][a-z0-9.-]{0,63}$/, "Use a slot key like leg.0.l.").pipe(
  Schema.brand("SlotKey"),
);
export type SlotKey = typeof SlotKey.Type;

export const JsonValue = Schema.Unknown.pipe(
  Schema.refine((value: unknown): value is Json => isJson(value), {
    message: "Use plain JSON with finite numbers.",
  }),
);

export const Label = Schema.String.check(
  Schema.makeFilter(
    (s: string) =>
      (s.length >= 1 && s.length <= 120 && s.trim() === s) ||
      "Use a label of 1 to 120 characters without surrounding spaces.",
  ),
);

export const Color = pattern(/^#[0-9a-f]{6}$/, "Use a lowercase #rrggbb colour.");

const component = (min: number, max: number) =>
  Schema.Finite.check(Schema.isBetween({ minimum: min, maximum: max }));

const bounded = (limit: number) =>
  Schema.Tuple([component(-limit, limit), component(-limit, limit), component(-limit, limit)]);

export const Position = bounded(100);
export const Size = Schema.Tuple([
  component(0.0005, 100),
  component(0.0005, 100),
  component(0.0005, 100),
]);
export const Rotation = Schema.Tuple([
  component(-1, 1),
  component(-1, 1),
  component(-1, 1),
  component(-1, 1),
]).check(
  Schema.makeFilter(
    (q: readonly [number, number, number, number]) =>
      (Math.abs(quatNorm(q) - 1) <= 1e-6 && q[3] >= 0) ||
      "Use a unit quaternion [x, y, z, w] with w >= 0.",
  ),
);

export const coreShapes = ["ellipsoid", "box", "capsule", "cylinder", "cone"] as const;
export const Shape = Schema.Literals(coreShapes);
export type Shape = typeof Shape.Type;

export const Displacement = Schema.Struct({
  id: EditId,
  at: bounded(1.5),
  offset: bounded(1),
  radius: component(0.02, 2),
});
export type Displacement = typeof Displacement.Type;

export const Paint = Schema.Struct({
  atlas: Digest,
  occluder: Schema.optionalKey(Digest),
});
export type Paint = typeof Paint.Type;

export const ComponentSource = Schema.Struct({
  catalog: CatalogId,
  item: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
});

const FeatureKey = pattern(
  /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/,
  "Use a dotted feature name like core.sculpt.",
);
const NamespaceKey = pattern(
  /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/,
  "Use a dotted namespace like com.example.notes.",
);
const FeaturePayloads = Schema.Record(FeatureKey, JsonValue);

export const Part = Schema.Struct({
  id: PartId,
  label: Label,
  parent: Schema.NullOr(PartId),
  shape: Shape,
  position: Position,
  rotation: Rotation,
  size: Size,
  color: Color,
  sculpt: Schema.Array(Displacement).check(Schema.isMaxLength(64)),
  paint: Schema.optionalKey(Paint),
  slot: Schema.optionalKey(SlotKey),
  component: Schema.optionalKey(ComponentSource),
  features: FeaturePayloads,
});
export type Part = typeof Part.Type;

export const Joint = Schema.Struct({ part: PartId, rotation: Rotation });
export const Pose = Schema.Struct({
  id: PoseId,
  label: Label,
  joints: Schema.Array(Joint).check(Schema.isMaxLength(256)),
});
export type Pose = typeof Pose.Type;

export const mediaTypes = ["image/webp", "image/png", "image/jpeg", "model/gltf-binary"] as const;
export const rasterMediaTypes: ReadonlyArray<(typeof mediaTypes)[number]> = [
  "image/webp",
  "image/png",
  "image/jpeg",
];
export const assetRoles = [
  "paint-atlas",
  "occluder-atlas",
  "reference",
  "attachment",
  "portrait-plate",
] as const;
export type AssetRole = (typeof assetRoles)[number];
export const AssetEntry = Schema.Struct({
  digest: Digest,
  mediaType: Schema.Literals(mediaTypes),
  byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 * 1024 * 1024 })),
  role: Schema.Literals(assetRoles),
});
export type AssetEntry = typeof AssetEntry.Type;

export const CatalogDependency = Schema.Struct({ id: CatalogId, digest: Digest });
export type CatalogDependency = typeof CatalogDependency.Type;

export const FeatureRequirement = Schema.Struct({
  feature: FeatureId,
  version: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
});
export type FeatureRequirement = typeof FeatureRequirement.Type;

export const BaseSlot = Schema.Struct({
  slot: SlotKey,
  parent: Schema.NullOr(SlotKey),
  label: Label,
  shape: Shape,
  position: Position,
  rotation: Rotation,
  size: Size,
  color: Color,
  features: Schema.optionalKey(FeaturePayloads),
});
export type BaseSlot = typeof BaseSlot.Type;
export type BaseSlotInput = typeof BaseSlot.Encoded;

export const Generation = Schema.Struct({
  generator: GeneratorId,
  version: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
  params: JsonValue,
  base: Schema.Struct({
    digest: Digest,
    slots: Schema.Array(BaseSlot).check(Schema.isMaxLength(512)),
  }),
});
export type Generation = typeof Generation.Type;

export const documentFormat = "irudd.character";
export const documentVersion = 1;

export const CharacterDocument = Schema.Struct({
  format: Schema.Literal(documentFormat),
  version: Schema.Literal(documentVersion),
  id: DocumentId,
  label: Label,
  requires: Schema.Array(FeatureRequirement).check(Schema.isMaxLength(64)),
  catalog: Schema.Array(CatalogDependency).check(Schema.isMaxLength(32)),
  assets: Schema.Array(AssetEntry).check(Schema.isMaxLength(64)),
  parts: Schema.Array(Part).check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  poses: Schema.Array(Pose).check(Schema.isMaxLength(64)),
  generation: Schema.optionalKey(Generation),
  features: FeaturePayloads,
  extensions: Schema.Record(NamespaceKey, JsonValue),
});
export type CharacterDocument = typeof CharacterDocument.Type;

export const strictParse = { onExcessProperty: "error", errors: "all" } as const;
