import { Schema } from "effect";
import { bounded, family, Hex } from "./family.js";
import { markingKinds } from "./figure.js";

const seed = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffffff }));
const whole = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));

export const creatureProfiles = ["barrel", "pear", "wedge", "tube", "wasp"] as const;
export const limbSides = ["both", "left", "right"] as const;
export const legStyles = ["mammal", "bird", "insect", "pillar"] as const;
export const legEnds = ["paw", "hoof", "talons", "point", "pad", "paddle"] as const;
export const armEnds = ["hand", "pincer", "spike", "none"] as const;
export const wingStructures = ["plain", "bat", "feather", "insect"] as const;
export const wingPatterns = ["none", "tips", "bars", "eyespot"] as const;
export const wingRibCounts = { bat: [2, 5], feather: [4, 12], insect: [3, 8] } as const;
export const headShapes = ["round", "long", "wide", "flat"] as const;
export const snouts = ["muzzle", "beak", "mandibles", "trunk", "bill", "none"] as const;
export const eyePlaces = ["front", "side", "top"] as const;
export const billProfiles = ["spear", "spoon", "crusher", "shear", "scythe"] as const;
export const muzzleProfiles = ["feline", "canine", "grazing", "rooting"] as const;
export const earShapes = ["lance", "swept", "tufted", "fan", "lop"] as const;
export const crests = [
  "none",
  "horns",
  "ears",
  "antennae",
  "crown",
  "antlers",
  "ram",
  "lyre",
  "spire",
  "nubs",
  "fan",
  "plume",
] as const;
export const tailKinds = ["none", "stub", "taper", "club", "fluke", "fan", "stinger"] as const;
export const backGrowths = [
  "shingles",
  "gill fans",
  "drum sacs",
  "shag mantle",
  "spiral shell",
  "contour plumage",
] as const;
export const backKinds = ["none", "fins", "spikes", "plates", "sail", ...backGrowths] as const;
export const creatureDetails = [
  "mane",
  "frill",
  "dewlap",
  "tusks",
  "spurs",
  "shoulder spikes",
  "belly plates",
  "tail tuft",
  "nose horn",
  "brow horns",
  "beard",
  "cheek frills",
] as const;
export const faceMarkings = [
  "Eye stripe",
  "Facial disc",
  "Cheek flashes",
  "Forehead blaze",
] as const;
export const flankMarkings = ["Lateral stripe", "Saddle", "Flank ocelli"] as const;
export const coatFamilies = ["plumage", "pelt", "scutes", "wet skin"] as const;
export const creatureFamilies = [
  "envoy",
  "hopper",
  "grazer",
  "stalker",
  "glider",
  "brute",
  "tank",
  "wader",
  "skitter",
  "mantis",
  "strider",
  "drifter",
  "swimmer",
  "wild",
] as const;
export const equipmentKinds = ["none", "courier satchel", "trader panniers", "survey kit"] as const;
export const dressKinds = ["herald", "warden", "sage", "nomad", "ranger"] as const;
export const dressDevices = ["swallow", "oak", "sunburst", "tide", "compass"] as const;

const limbBase = {
  pairs: whole(1, 6),
  side: Schema.Literals(limbSides),
  from: bounded(0, 1),
  to: bounded(0, 1),
  girth: bounded(0.3, 3),
  muscle: bounded(0, 1.6),
};

export const CreatureLeg = Schema.Struct({
  kind: Schema.Literal("leg"),
  ...limbBase,
  style: Schema.Literals(legStyles),
  sockets: Schema.optionalKey(Schema.Literal(true)),
  splay: bounded(0, 78),
  fan: bounded(0, 240),
  end: Schema.Literals(legEnds),
  digits: whole(0, 5),
}).check(
  Schema.makeFilter(
    (l) => l.sockets === undefined || l.style === "insect" || "Only insect legs have sockets.",
  ),
);

export const CreatureArm = Schema.Struct({
  kind: Schema.Literal("arm"),
  ...limbBase,
  length: bounded(0.08, 3),
  drop: bounded(-80, 90),
  forward: bounded(-80, 90),
  elbow: bounded(0, 150),
  end: Schema.Literals(armEnds),
  digits: whole(1, 6),
  hand: bounded(0.4, 3),
  raise: Schema.optionalKey(
    bounded(-80, 80).check(Schema.makeFilter((v) => v !== 0 || "A zero raise is omitted.")),
  ),
});

const wingBase = {
  kind: Schema.Literal("wing"),
  ...limbBase,
  length: bounded(0.1, 4),
  rise: bounded(-30, 85),
  sweep: bounded(-40, 70),
  chord: bounded(0.03, 1.5),
};

export const CreaturePlainWing = Schema.Struct({
  ...wingBase,
  structure: Schema.Literal("plain"),
});

export const CreatureStructuredWing = Schema.Struct({
  ...wingBase,
  structure: Schema.Literals(["bat", "feather", "insect"]),
  ribs: whole(2, 12),
  bend: bounded(0, 1),
  notch: bounded(0, 1),
  point: bounded(0, 1),
  pattern: Schema.Literals(wingPatterns),
  seed,
}).check(
  Schema.makeFilter((w) => {
    const [least, most] = wingRibCounts[w.structure];
    return (
      (w.ribs >= least && w.ribs <= most) || `A ${w.structure} wing has ${least} to ${most} ribs.`
    );
  }),
);

export const CreatureFin = Schema.Struct({
  kind: Schema.Literal("fin"),
  ...limbBase,
  length: bounded(0.05, 2),
  sweep: bounded(-40, 80),
  chord: bounded(0.03, 1),
});

export const CreatureTentacle = Schema.Struct({
  kind: Schema.Literal("tentacle"),
  ...limbBase,
  length: bounded(0.1, 3),
  droop: bounded(-60, 90),
  forward: bounded(-80, 90),
  fan: bounded(0, 240),
  curl: bounded(-1, 1),
});

export const CreatureLimb = Schema.Union([
  CreatureLeg,
  CreatureArm,
  CreaturePlainWing,
  CreatureStructuredWing,
  CreatureFin,
  CreatureTentacle,
]);
export type CreatureLimb = typeof CreatureLimb.Type;

export const CreatureCoat = Schema.Struct({
  family: Schema.Literals(coatFamilies),
  graded: Schema.optionalKey(Schema.Literal(true)),
  contrast: bounded(0, 1),
  density: bounded(0.55, 1.8),
  seed,
});
export type CreatureCoat = typeof CreatureCoat.Type;

export const CreaturePlanMarkings = Schema.Struct({
  kind: Schema.Literals(markingKinds),
  color: Hex,
  spacing: bounded(0.06, 0.8),
  coverage: bounded(0.1, 0.9),
  angle: bounded(-180, 180),
  seed,
});

export const CreatureEquipment = Schema.Struct({
  kind: Schema.Literals(equipmentKinds),
  handling: Schema.optionalKey(Schema.Literal("offer")),
  station: bounded(0.14, 0.85),
  hang: bounded(-1.42, 0.85),
  size: bounded(0.55, 1.45),
  side: Schema.Literals(["left", "right"]),
  mount: Schema.Literals(["flank", "back"]),
  color: Hex,
  seed,
}).check(
  Schema.makeFilter(
    (e) =>
      e.handling === undefined ||
      e.kind === "courier satchel" ||
      "Only a courier satchel is offered.",
  ),
);
export type CreatureEquipment = typeof CreatureEquipment.Type;

export const CreatureDress = Schema.Struct({
  kind: Schema.Literals(dressKinds),
  device: Schema.optionalKey(Schema.Literals(dressDevices)),
  color: Hex,
  trim: Hex,
  layers: whole(1, 3),
  size: bounded(0.7, 1.4),
  clear: Schema.optionalKey(bounded(0, 1)),
  cut: Schema.optionalKey(Schema.Literals([2, 3])),
  seed,
});
export type CreatureDress = typeof CreatureDress.Type;

const nonZero = (minimum: number, maximum: number) =>
  bounded(minimum, maximum).check(Schema.makeFilter((v) => v !== 0 || "A zero value is omitted."));

export const CreaturePlan = Schema.Struct({
  anatomyRevision: Schema.optionalKey(Schema.Literal(2)),
  family: Schema.optionalKey(Schema.Literals(creatureFamilies)),
  equipment: Schema.optionalKey(CreatureEquipment),
  dress: Schema.optionalKey(CreatureDress),
  scale: bounded(0.2, 4),
  spine: Schema.Struct({
    length: bounded(0.2, 3),
    girth: bounded(0.04, 0.8),
    flat: bounded(0.5, 2.2),
    rear: bounded(-30, 90),
    front: bounded(-45, 100),
    arch: bounded(-40, 40),
    profile: Schema.Literals(creatureProfiles),
    stance: bounded(0.05, 3),
    bulge: Schema.Tuple([
      bounded(0.4, 2.2),
      bounded(0.4, 2.2),
      bounded(0.4, 2.2),
      bounded(0.4, 2.2),
      bounded(0.4, 2.2),
    ]),
  }),
  head: Schema.Struct({
    count: whole(0, 3),
    neck: bounded(0.02, 2),
    neckPitch: bounded(-40, 100),
    neckGirth: bounded(0.3, 2),
    size: bounded(0.4, 3),
    shape: Schema.Literals(headShapes),
    snout: Schema.Literals(snouts),
    snoutLength: bounded(0.3, 4),
    billProfile: Schema.optionalKey(Schema.Literals(billProfiles)),
    muzzleProfile: Schema.optionalKey(Schema.Literals(muzzleProfiles)),
    mouth: Schema.Boolean,
    eyes: whole(0, 8),
    eyeSize: bounded(0.4, 3),
    eyePlace: Schema.Literals(eyePlaces),
    stalks: bounded(0, 0.6),
    lids: bounded(0, 1),
    crest: Schema.Literals(crests),
    crestSize: bounded(0.3, 3),
    ear: Schema.optionalKey(Schema.Literals(earShapes)),
    jaw: bounded(0, 1),
    teeth: whole(0, 6),
    brow: bounded(0, 1),
    nostrils: Schema.Boolean,
    whiskers: Schema.Boolean,
    turn: Schema.optionalKey(nonZero(-50, 50)),
  }),
  limbs: Schema.Array(CreatureLimb).check(Schema.isMaxLength(8)),
  details: Schema.Array(Schema.Literals(creatureDetails)).check(
    Schema.makeFilter((d: ReadonlyArray<(typeof creatureDetails)[number]>) => {
      const order = d.map((v) => creatureDetails.indexOf(v));
      return (
        order.every((n, i) => i === 0 || n > (order[i - 1] ?? -1)) ||
        "Details are listed once, in the legacy order."
      );
    }),
  ),
  tail: Schema.Struct({
    kind: Schema.Literals(tailKinds),
    length: bounded(0.05, 3),
    girth: bounded(0.3, 2.5),
    lift: bounded(-60, 120),
    sway: Schema.optionalKey(nonZero(-90, 90)),
  }),
  back: Schema.Struct({
    kind: Schema.Literals(backKinds),
    count: whole(1, 12),
    height: bounded(0.02, 1),
    spread: Schema.optionalKey(bounded(0, 1)),
    seed: Schema.optionalKey(seed),
  }).check(
    Schema.makeFilter((b) => {
      const growth = backGrowths.some((g) => g === b.kind);
      if (growth !== (b.spread !== undefined && b.seed !== undefined))
        return "A grown back has a spread and a seed; another back has neither.";
      return b.kind !== "shingles" || b.count >= 2 || "Shingles grow at least two rows.";
    }),
  ),
  skin: Schema.Struct({
    base: Hex,
    accent: Hex,
    pale: Hex,
    eye: Hex,
    surface: Schema.Literals(["scales", "plain"]),
    blend: Schema.Boolean,
    belly: bounded(0, 1),
    socks: bounded(0, 1),
    faceMarking: Schema.optionalKey(Schema.Literals(faceMarkings)),
    flankMarking: Schema.optionalKey(Schema.Literals(flankMarkings)),
    limbFade: Schema.optionalKey(Schema.Literal(true)),
    coat: Schema.optionalKey(CreatureCoat),
    markings: Schema.NullOr(CreaturePlanMarkings),
  }),
});
export type CreaturePlan = typeof CreaturePlan.Type;

export const creaturePlan = family({
  id: "creature.plan",
  version: 1,
  scope: "document",
  schema: CreaturePlan,
  toJson: (v) => v,
});
