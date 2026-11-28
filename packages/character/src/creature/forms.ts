import { Schema } from "effect";
import {
  CreaturePlan,
  defineGenerator,
  identity,
  sub,
  mul,
  pieceNames,
  hairStyles,
  palettes,
  type Appearance,
  type BaseSlotInput,
  type Vec3,
} from "@irudd/document";
import { pieceAnchors } from "../library/anchors.js";
import { randomStream } from "../random.js";
import { creatureSlots } from "./body.js";
import { colourRanges, randomCreature, type ColourRange } from "./draw.js";

export const otherForms = ["Figure", "Humanoid", "Hybrid"] as const;
export const formArchetypes = ["any", "female", "male", "neutral"] as const;
const formSchema = Schema.Struct({
  kind: Schema.Literals(otherForms),
  archetype: Schema.Literals(formArchetypes),
  colours: Schema.Literals(colourRanges),
  seed: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff })),
  plan: CreaturePlan,
});
export function formParams(
  kind: (typeof otherForms)[number],
  seed: number,
  archetype: (typeof formArchetypes)[number],
  colours: ColourRange,
  family?: CreaturePlan["family"],
) {
  return { kind, seed, archetype, colours, plan: randomCreature(seed, family, colours) };
}
function formSlots(p: typeof formSchema.Type): BaseSlotInput[] {
  const draw = randomStream(p.seed ^ 0x566d429),
    pick = <T>(v: readonly [T, ...T[]]) => v[Math.floor(draw() * v.length)] ?? v[0];
  const frame = p.archetype === "any" ? pick(["male", "female", "neutral"] as const) : p.archetype;
  const skin =
    p.colours === "Fantasy" || (p.colours === "Mixed" && draw() < 0.35)
      ? p.plan.skin.base
      : pick(["#734936", "#966444", "#c08d6e", "#d9ae8f", "#e8c6ad"]);
  const look: Appearance = {
    palette: pick(palettes),
    skin,
    hair: pick(hairStyles),
    hairColor: pick(["#262128", "#51382b", "#7a5543", p.plan.skin.accent]),
    face: Math.floor(draw() * 4),
    belly: 0.78 + draw() * 0.52,
    sleeves: pick(["long", "short", "none"]),
    collar: draw() < 0.6,
    pockets: draw() < 0.5,
    tones: { cloth: p.plan.skin.base, trim: p.plan.skin.accent },
    sculpt: { jaw: 0.7 + draw() * 0.72, nose: 0.72 + draw() * 0.7, eyes: 0.8 + draw() * 0.46 },
  };
  if (p.kind === "Hybrid") {
    const slots = creatureSlots(p.plan);
    const heads = new Set(slots.filter((q) => /^head(?:-\d+)?$/.test(q.slot)).map((q) => q.slot));
    const parents = new Map(slots.map((q) => [q.slot, q.parent]));
    const underHead = (slot: string | null): boolean => {
      const parent = slot === null ? null : (parents.get(slot) ?? null);
      return parent !== null && (heads.has(parent) || underHead(parent));
    };
    return slots
      .filter((q) => !underHead(q.slot))
      .map((q) => {
        if (!heads.has(q.slot)) return q;
        const size = Math.max(0.65, Math.min(2.5, q.size[1] * 4.4));
        return {
          ...q,
          size: [size, size, size],
          features: { "figure.piece": { piece: "head", look } },
        };
      });
  }
  const width = (frame === "male" ? 1.08 : frame === "female" ? 0.94 : 1) * (0.9 + draw() * 0.2),
    height = 0.88 + 0.23 * draw();
  const build: Vec3 = [width, height, 0.85 + draw() * 0.3],
    scaleHead = p.kind === "Humanoid" ? 0.95 + draw() * 0.18 : 1.15 + draw() * 0.36;
  return pieceNames.map((piece) => {
    const parent = piece === "torso" ? null : "torso",
      anchor = pieceAnchors[piece],
      position = parent ? sub(anchor, pieceAnchors.torso) : anchor;
    return {
      slot: piece.replace(" ", "."),
      parent,
      label: piece,
      shape: "ellipsoid",
      position: mul(position, build),
      rotation: identity,
      size: piece === "head" ? mul(build, [scaleHead, scaleHead, scaleHead]) : build,
      color: skin,
      features: { "figure.piece": { piece, look } },
    };
  });
}
export const formGenerator = defineGenerator({
  id: "irudd.workshop-form",
  version: 1,
  label: "Workshop form",
  schema: formSchema,
  toJson: (p) => p,
  generate: formSlots,
});
export const formStarter = {
  id: "workshop-form",
  label: "Workshop form",
  reference: false,
  generator: formGenerator,
  description: "Draw a stylised figure, humanoid or creature with a fitted human head.",
  presets: [],
  seed: (seed: number) => formParams(otherForms[seed % 3] ?? "Figure", seed, "any", "Mixed"),
};
