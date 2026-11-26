import {
  coatFamilies,
  backGrowths,
  dressKinds,
  equipmentKinds,
  creatureFamilies,
  markingKinds,
  type CreatureLimb,
  type CreaturePlan,
} from "@irudd/document";
import { randomStream } from "../random.js";

type Family = (typeof creatureFamilies)[number];
export const colourRanges = ["Mixed", "Natural", "Fantasy"] as const;
export type ColourRange = (typeof colourRanges)[number];
type LimbKind = CreatureLimb["kind"];
type Profile = readonly [
  length: number,
  girth: number,
  stance: number,
  tilt: number,
  neck: number,
  snout: CreaturePlan["head"]["snout"],
  crest: CreaturePlan["head"]["crest"],
  tail: CreaturePlan["tail"]["kind"],
  legPairs: number,
  limbs: readonly LimbKind[],
];

const profiles: Record<Family, Profile> = {
  grazer: [1, 0.24, 0.74, 8, 0.55, "muzzle", "antlers", "stub", 2, ["leg"]],
  stalker: [1.12, 0.19, 0.54, 2, 0.2, "muzzle", "ears", "taper", 2, ["leg"]],
  glider: [0.7, 0.19, 0.45, 19, 0.22, "beak", "plume", "fan", 1, ["leg", "wing"]],
  skitter: [0.67, 0.17, 0.32, 0, 0.08, "mandibles", "antennae", "none", 4, ["leg"]],
  mantis: [0.85, 0.14, 0.55, 48, 0.24, "mandibles", "antennae", "taper", 2, ["leg", "arm"]],
  envoy: [0.6, 0.19, 0.74, 78, 0.12, "bill", "plume", "stub", 1, ["leg", "arm"]],
  brute: [0.85, 0.31, 0.48, 32, 0.13, "muzzle", "horns", "club", 2, ["leg", "arm"]],
  hopper: [0.54, 0.22, 0.39, 42, 0.11, "muzzle", "ears", "taper", 1, ["leg", "arm"]],
  tank: [0.92, 0.34, 0.33, 2, 0.12, "beak", "nubs", "club", 2, ["leg"]],
  wader: [0.62, 0.18, 0.97, 18, 0.65, "bill", "fan", "fan", 1, ["leg"]],
  strider: [0.77, 0.15, 0.92, 12, 0.25, "beak", "antennae", "stub", 3, ["leg"]],
  drifter: [0.42, 0.27, 0.69, 58, 0.08, "none", "fan", "none", 0, ["fin", "tentacle"]],
  swimmer: [1.29, 0.21, 0.45, 0, 0.09, "bill", "none", "fluke", 0, ["fin"]],
  wild: [0.9, 0.23, 0.53, 24, 0.28, "trunk", "horns", "stinger", 2, ["leg", "wing", "tentacle"]],
};

export function limbGroup(kind: LimbKind, seed: number): CreatureLimb {
  const base = { side: "both", pairs: 1, from: 0.7, to: 0.7, girth: 1, muscle: 1 } as const;
  switch (kind) {
    case "leg":
      return { ...base, kind, style: "mammal", splay: 9, fan: 0, end: "paw", digits: 3 };
    case "arm":
      return {
        ...base,
        kind,
        length: 0.58,
        drop: 52,
        forward: 18,
        elbow: 34,
        end: "hand",
        digits: 3,
        hand: 1,
      };
    case "wing":
      return {
        ...base,
        kind,
        length: 0.9,
        rise: 23,
        sweep: 26,
        chord: 0.35,
        structure: "feather",
        ribs: 9,
        bend: 0.4,
        notch: 0.4,
        point: 0.65,
        pattern: "tips",
        seed,
      };
    case "fin":
      return { ...base, kind, length: 0.42, sweep: 35, chord: 0.21 };
    case "tentacle":
      return {
        ...base,
        kind,
        pairs: 3,
        from: 0.12,
        to: 0.86,
        length: 0.68,
        droop: 59,
        forward: 10,
        fan: 80,
        curl: 0.55,
      };
  }
}

export function drawCoat(
  plan: CreaturePlan,
  seed: number,
): NonNullable<CreaturePlan["skin"]["coat"]> {
  const draw = randomStream(seed ^ 0x4f8b2a13);
  const families: readonly (typeof coatFamilies)[number][] =
    plan.back.kind === "shag mantle"
      ? ["pelt"]
      : plan.limbs.some((l) => l.kind === "wing" && l.structure === "feather")
        ? ["plumage"]
        : plan.back.kind === "shingles"
          ? ["scutes", "scutes", "plumage"]
          : plan.limbs.some((l) => l.kind === "fin") || plan.back.kind === "gill fans"
            ? ["wet skin", "wet skin", "scutes"]
            : plan.limbs.some((l) => l.kind === "leg" && l.style === "insect")
              ? ["scutes", "wet skin"]
              : plan.head.snout === "beak" ||
                  plan.limbs.some((l) => l.kind === "leg" && l.style === "bird")
                ? ["plumage", "plumage", "scutes"]
                : ["pelt", "pelt", "wet skin", "scutes"];
  return {
    family: families[Math.floor(draw() * families.length)] ?? "pelt",
    graded: true,
    contrast: 0.68 + 0.27 * draw(),
    density: 0.76 + 0.52 * draw(),
    seed: Math.floor(draw() * 4294967296),
  };
}

function tone(hue: number, saturation: number, light: number) {
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(
      255 *
        (light - saturation * Math.min(light, 1 - light) * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
    )
      .toString(16)
      .padStart(2, "0");
  };
  return "#" + channel(0) + channel(8) + channel(4);
}

function dealtFamily(seed: number): Family {
  const deck = [...creatureFamilies],
    draw = randomStream(Math.floor((seed >>> 0) / deck.length) ^ 0x51f15e);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(draw() * (i + 1)),
      a = deck[i],
      b = deck[j];
    if (a && b) {
      deck[i] = b;
      deck[j] = a;
    }
  }
  return deck[(seed >>> 0) % deck.length] ?? "wild";
}
export function randomCreature(
  seed: number,
  family: Family | "Any" = "Any",
  colours: ColourRange = "Mixed",
): CreaturePlan {
  const draw = randomStream(seed);
  const pick = <T>(items: readonly [T, ...T[]]): T =>
    items[Math.floor(draw() * items.length)] ?? items[0];
  const vary = (n: number) => n * (0.8 + 0.4 * draw());
  const f = family === "Any" ? dealtFamily(seed) : family;
  const [length, girth, stance, tilt, neck, snout, crest, tail, pairs, kinds] = profiles[f];
  const hue =
    colours === "Natural" || (colours === "Mixed" && draw() < 0.5)
      ? pick([16, 28, 37, 58, 82, 105, 198]) + draw() * 12
      : draw() * 360;
  const accent = (hue + pick([32, 145, 190]) + draw() * 18) % 360;
  const insect = f === "mantis" || f === "skitter" || f === "strider";
  const bird = f === "glider" || f === "wader" || f === "envoy";
  const detailChoices: CreaturePlan["details"] = insect
    ? ["shoulder spikes", "belly plates"]
    : bird
      ? ["mane", "belly plates"]
      : ["mane", "tusks", "shoulder spikes", "belly plates", "tail tuft"];
  const details = detailChoices.filter(() => draw() < 0.32);
  const limbs = kinds.map((kind): CreatureLimb => {
    const l = limbGroup(kind, seed);
    if (l.kind === "leg")
      return {
        ...l,
        pairs,
        from: pairs === 1 ? 0.36 : 0.12,
        to: pairs === 1 ? 0.36 : 0.86,
        girth: vary(f === "brute" || f === "tank" ? 1.4 : 1),
        style: insect ? "insect" : bird ? "bird" : f === "tank" ? "pillar" : "mammal",
        splay: insect ? 44 : 8,
        end: insect ? "point" : bird ? "talons" : f === "grazer" ? "hoof" : "paw",
      };
    if (l.kind === "wing")
      return {
        ...l,
        structure: pick(["bat", "feather", "insect"]),
        ribs: 5,
        length: vary(0.98),
        bend: 0.25 + 0.5 * draw(),
        notch: 0.4,
        point: 0.56,
        pattern: "tips",
        seed,
      };
    if (l.kind === "tentacle")
      return {
        ...l,
        length: vary(stance * 1.1),
        pairs: 2 + Math.floor(draw() * 3),
        curl: draw() * 1.7 - 0.85,
      };
    return l;
  });
  const gearDraw = randomStream(seed ^ 0x865df381);
  const gear = () => Math.floor(gearDraw() * 4294967296);
  const kit: NonNullable<CreaturePlan["equipment"]> = {
    kind: pick(["courier satchel", "trader panniers", "survey kit"]),
    station: 0.34 + 0.26 * gearDraw(),
    hang: -0.36,
    size: 0.72 + 0.52 * gearDraw(),
    side: gearDraw() < 0.5 ? "left" : "right",
    mount: "flank",
    color: tone(hue, 0.41, 0.26),
    seed: gear(),
  };
  const dress: NonNullable<CreaturePlan["dress"]> = {
    kind: pick(dressKinds),
    color: tone(accent, 0.54, 0.38),
    trim: tone(hue, 0.59, 0.73),
    layers: 1 + Math.floor(gearDraw() * 3),
    size: 0.82 + 0.33 * gearDraw(),
    seed: gear(),
  };
  const backKind: CreaturePlan["back"]["kind"] =
    f === "tank"
      ? pick(["plates", "shingles", "spiral shell"])
      : insect
        ? "spikes"
        : bird
          ? pick(["none", "contour plumage"])
          : f === "swimmer"
            ? pick(["fins", "gill fans"])
            : f === "grazer"
              ? pick(["none", "shag mantle"])
              : pick(["none", "fins", "plates"]);
  const plan: CreaturePlan = {
    ...(gearDraw() < 0.28 ? { equipment: kit } : {}),
    ...(gearDraw() < 0.3 ? { dress } : {}),
    family: f,
    anatomyRevision: 2,
    scale: 1,
    spine: {
      length: vary(length),
      girth: vary(girth),
      flat: vary(f === "tank" ? 1.5 : 1),
      rear: tilt + draw() * 8 - 4,
      front: tilt + draw() * 14 - 5,
      arch: draw() * 14 - 4,
      stance: vary(stance),
      profile: pick(["barrel", "pear", "wedge", "tube", "wasp"]),
      bulge: [vary(1), vary(1), vary(1), vary(1.12), vary(0.98)],
    },
    head: {
      count: 1,
      neck: vary(neck),
      neckPitch: bird || f === "grazer" ? 55 : 18,
      neckGirth: vary(0.86),
      size: vary(1.15),
      shape: insect ? "wide" : pick(["round", "long", "wide"]),
      snout,
      snoutLength: vary(1),
      mouth: true,
      eyes: insect && draw() < 0.4 ? 4 : 2,
      eyeSize: vary(1.2),
      eyePlace: "side",
      stalks: 0,
      lids: 0.32,
      crest,
      crestSize: vary(1.1),
      jaw: 0.1,
      teeth: 0,
      brow: 0.4,
      nostrils: true,
      whiskers: false,
    },
    limbs,
    details,
    tail: {
      kind: tail,
      length: vary(tail === "stub" ? 0.25 : 0.78),
      girth: vary(0.9),
      lift: draw() * 45 - 10,
      sway: draw() * 35 + 1,
    },
    back: {
      kind: backKind,
      ...(backGrowths.some((kind) => kind === backKind)
        ? { spread: 0.4 + draw() * 0.5, seed }
        : {}),
      count: 3 + Math.floor(draw() * 5),
      height: vary(0.12),
    },
    skin: {
      base: tone(hue, 0.37 + draw() * 0.2, 0.37 + draw() * 0.16),
      accent: tone(accent, 0.65, 0.52),
      pale: tone(hue, 0.32, 0.83),
      eye: tone(accent, 0.82, 0.57),
      surface: insect ? "scales" : "plain",
      blend: false,
      belly: 0.72,
      socks: 0.45,
      limbFade: true,
      markings: {
        kind: pick(markingKinds),
        color: tone(hue, 0.48, 0.18),
        spacing: 0.13 + draw() * 0.16,
        coverage: 0.25 + 0.28 * draw(),
        angle: Math.round(draw() * 60 - 30),
        seed,
      },
    },
  };
  return { ...plan, skin: { ...plan.skin, coat: drawCoat(plan, seed) } };
}

export const creatureScopes = [
  "Whole creature",
  "Posture and limbs",
  "Head",
  "Tail, back and details",
  "Colours and markings",
  "Equipment",
  "Worn layers",
  "Coat",
] as const;
export type Scope = (typeof creatureScopes)[number];
export interface CreatureDirection {
  readonly strength: "subtle" | "exploratory" | "radical";
  readonly decks: ReadonlyArray<{ readonly label: string; readonly value: string }>;
}
export function shuffleCreature(
  p: CreaturePlan,
  scope: Scope,
  seed: number,
  direction?: CreatureDirection,
): CreaturePlan {
  const choice = (label: string) =>
    direction?.decks.find((d) => d.label.toLowerCase() === label)?.value.toLowerCase();
  const family = creatureFamilies.find((f) => f === choice("family"));
  const fresh = randomCreature(
    seed,
    family ??
      (scope === "Whole creature" || direction?.strength !== "subtle"
        ? "Any"
        : (p.family ?? "Any")),
  );
  if (scope === "Equipment") {
    const { equipment: previous, ...rest } = p;
    const kind = equipmentKinds[(seed >>> 0) % equipmentKinds.length] ?? "none";
    const next = fresh.equipment ?? {
      kind,
      station: 0.55,
      hang: -0.35,
      size: 0.9 + (seed % 20) / 50,
      side: "left" as const,
      mount: "flank" as const,
      color: fresh.skin.accent,
      seed,
    };
    return next.kind === "none" && previous
      ? rest
      : { ...rest, equipment: { ...next, kind: next.kind === "none" ? "survey kit" : next.kind } };
  }
  if (scope === "Worn layers")
    return {
      ...p,
      dress: fresh.dress ?? {
        kind: dressKinds[seed % dressKinds.length] ?? "ranger",
        color: fresh.skin.base,
        trim: fresh.skin.accent,
        layers: 1 + (seed % 3),
        size: 0.9 + (seed % 19) / 50,
        seed,
      },
    };
  const weight =
    direction?.strength === "subtle" ? 0.2 : direction?.strength === "exploratory" ? 0.62 : 1;
  const mix = (a: number, b: number) => a + (b - a) * weight;
  const whole = scope === "Whole creature";
  const spine = {
    ...fresh.spine,
    length: mix(p.spine.length, fresh.spine.length),
    girth: mix(p.spine.girth, fresh.spine.girth),
    stance: mix(p.spine.stance, fresh.spine.stance),
  };
  const head = {
    ...fresh.head,
    size: mix(p.head.size, fresh.head.size),
    neck: mix(p.head.neck, fresh.head.neck),
  };
  const tail = { ...fresh.tail, length: mix(p.tail.length, fresh.tail.length) };
  const coat = scope === "Coat" ? drawCoat(p, seed) : fresh.skin.coat;
  const coatFamily = coatFamilies.find((f) => f === choice("coat"));
  const skinChoice = choice("skin");
  const skin = {
    ...(scope === "Coat" ? p.skin : fresh.skin),
    ...(coat
      ? {
          coat: {
            ...coat,
            family: coatFamily ?? coat.family,
            contrast: mix(p.skin.coat?.contrast ?? coat.contrast, coat.contrast),
            density: mix(p.skin.coat?.density ?? coat.density, coat.density),
          },
        }
      : {}),
    ...(skinChoice && /^#[0-9a-f]{6}$/.test(skinChoice) ? { base: skinChoice } : {}),
  };
  return {
    ...(whole ? fresh : p),
    ...(whole || scope === "Posture and limbs" ? { spine, limbs: fresh.limbs } : {}),
    ...(whole || scope === "Head" ? { head } : {}),
    ...(whole || scope === "Tail, back and details"
      ? { tail, back: fresh.back, details: fresh.details }
      : {}),
    ...(whole || scope === "Colours and markings" || scope === "Coat" ? { skin } : {}),
  };
}
