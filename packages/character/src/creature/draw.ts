import {
  coatFamilies,
  dressKinds,
  equipmentKinds,
  creatureFamilies,
  type CreatureLimb,
  type CreaturePlan,
} from "@irudd/document";
import { randomStream } from "../random.js";
import { randomCreaturePlan } from "./plan/plan.js";

type Family = (typeof creatureFamilies)[number];
export const colourRanges = ["Mixed", "Natural", "Fantasy"] as const;
export type ColourRange = (typeof colourRanges)[number];
type LimbKind = CreatureLimb["kind"];
const colourBiomes: Record<Exclude<ColourRange, "Mixed">, readonly string[]> = {
  Natural: ["savanna", "jungle", "reef", "tundra", "moss", "sand"],
  Fantasy: ["dusk", "ember", "candy", "ink"],
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

export function randomCreature(
  seed: number,
  family: Family | "Any" = "Any",
  colours: ColourRange = "Mixed",
): CreaturePlan {
  return randomCreaturePlan(seed, {
    ...(family === "Any" ? {} : { family }),
    ...(colours === "Mixed" ? {} : { biomes: colourBiomes[colours] }),
  });
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
