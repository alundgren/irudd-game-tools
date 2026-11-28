import { randomStream } from "../../random.js";
import { need } from "./need.js";
import { creatureFamilies as familyNames, type CreaturePlan } from "@irudd/document";
import type { RawHead, RawLimb, RawPlan, RawSkin } from "./types.js";

export type Family = NonNullable<CreaturePlan["family"]>;
const deckOf: Record<Family, number> = {
  envoy: 4,
  hopper: 3,
  grazer: 3,
  stalker: 3,
  glider: 3,
  brute: 2,
  tank: 2,
  wader: 2,
  skitter: 2,
  mantis: 2,
  strider: 1,
  drifter: 1,
  swimmer: 1,
  wild: 1,
};
const decks = Object.entries(deckOf).flatMap(([name, n]): [Family, number][] => {
  const family = familyNames.find((f) => f === name);
  return family ? [[family, n]] : [];
});
export const creatureFamilies = decks.map(([name]) => name);
const slots = decks.flatMap(([name, n]) => Array<Family>(n).fill(name));
export const creatureBiomes = [
  "savanna",
  "jungle",
  "reef",
  "dusk",
  "ember",
  "tundra",
  "moss",
  "candy",
  "ink",
  "sand",
];
export const creatureKins: Record<string, string[]> = {
  envoy: ["scholar", "merchant", "sprite", "saurian", "avian"],
  hopper: ["puff", "kanga", "frog", "owl"],
  grazer: ["antelope", "browser", "boar", "bison"],
  stalker: ["raptor", "cat", "terror bird", "lurker"],
  glider: ["bird", "bat", "dragonfly", "wyvern", "moth"],
  brute: ["ape", "ogre", "bear"],
  tank: ["ankylo", "tortoise", "rhino", "ceratops"],
  wader: ["heron", "runner", "longneck", "stilt"],
  skitter: ["scorpion", "beetle", "centipede", "spider", "crab"],
  mantis: ["mantid", "centaur", "hexataur"],
  strider: ["ring", "tripod", "squat"],
  drifter: ["octopus", "jelly", "nautilus"],
  swimmer: ["chaser", "eel", "ray", "angler"],
  wild: ["free"],
};

function familySalt(family: string) {
  let h = 0x3ad5;
  for (let i = 0; i < family.length; i++) h = (Math.imul(h, 31) + family.charCodeAt(i)) >>> 0;
  return h;
}

function shuffled(block: number, n: number, salt: number) {
  const draw = randomStream((Math.imul(block, 0x9e3779b1) ^ salt) >>> 0);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(draw() * (i + 1));
    [order[i], order[j]] = [need(order[j]), need(order[i])];
  }
  return order;
}
const dealt = <T>(seed: number, items: readonly T[], salt: number): T =>
  need(
    items[need(shuffled(Math.floor(seed / items.length), items.length, salt)[seed % items.length])],
  );
const hsl = (h: number, s: number, l: number) => {
  h = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const q = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(q - 3, 9 - q, 1));
  };
  return (
    "#" +
    [0, 8, 4]
      .map((n) =>
        Math.round(f(n) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
};

const dressOdds: Record<string, number> = {
  envoy: 0.72,
  brute: 0.5,
  hopper: 0.42,
  grazer: 0.4,
  stalker: 0.38,
  tank: 0.36,
  wader: 0.3,
  mantis: 0.36,
  strider: 0.3,
  skitter: 0.22,
  glider: 0.24,
  wild: 0.3,
  drifter: 0,
  swimmer: 0,
};
const kitOdds: Record<string, number> = { wader: 0.3, glider: 0.4, skitter: 0.5 };

export function familyOf(seed: number) {
  seed = seed >>> 0;
  const n = slots.length,
    block = Math.floor(seed / n),
    order = shuffled(block, n, 0x51f15e),
    at = seed % n,
    family = need(slots[need(order[at])]);
  let earlier = 0;
  for (let i = 0; i < at; i++) if (slots[need(order[i])] === family) earlier++;
  const kins = need(creatureKins[family]),
    salt = familySalt(family);
  return {
    family,
    kin: need(
      kins[
        need(shuffled(0, kins.length, salt)[(block * need(deckOf[family]) + earlier) % kins.length])
      ],
    ),
  };
}

export interface DrawnFamily {
  family: Family;
  kin: string;
  biome: string;
  plan: RawPlan | null;
  skin?: RawSkin;
  dressOdds: number;
  kitOdds: number;
  draw: () => number;
}

export interface FamilyChoice {
  readonly family?: Family;
  readonly biomes?: readonly string[];
}
export function drawFamily(seed: number, choice: FamilyChoice = {}): DrawnFamily {
  seed = seed >>> 0;
  const dealtKin = familyOf(seed),
    family = choice.family ?? dealtKin.family,
    kin =
      family === dealtKin.family ? dealtKin.kin : dealt(seed, need(creatureKins[family]), 0x6b1d2f);
  const pool = choice.biomes?.length ? choice.biomes : creatureBiomes,
    natural = dealt(seed, creatureBiomes, 0x2c9277),
    biome = pool.includes(natural) ? natural : dealt(seed, pool, 0x2c9277);
  const draw = randomStream((seed ^ 0x7f4a7c15) >>> 0);
  const R = (a: number, b: number) => a + (b - a) * draw(),
    I = (a: number, b: number) => Math.floor(R(a, b + 1)),
    C = <T>(items: readonly T[]): T => need(items[Math.floor(draw() * items.length)]),
    P = (p: number) => draw() < p,
    either = (v: number) => (P(0.5) ? v : -v);

  const tones: Record<string, () => number[]> = {
    savanna: () => [R(24, 48), R(0.45, 0.62), R(0.46, 0.58), C([200, 355, 168])],
    jungle: () => [R(95, 150), R(0.4, 0.58), R(0.34, 0.48), C([320, 46, 18])],
    reef: () => [R(168, 200), R(0.5, 0.68), R(0.4, 0.52), C([12, 285, 48])],
    dusk: () => [R(252, 292), R(0.34, 0.5), R(0.4, 0.52), C([48, 165, 20])],
    ember: () => [R(-4, 18), R(0.5, 0.64), R(0.38, 0.5), C([46, 182, 280])],
    tundra: () => [R(198, 226), R(0.14, 0.3), R(0.66, 0.78), C([18, 335, 265])],
    moss: () => [R(58, 86), R(0.26, 0.42), R(0.4, 0.5), C([352, 205, 28])],
    candy: () => [R(308, 346), R(0.48, 0.64), R(0.55, 0.65), C([176, 52, 205])],
    ink: () => [R(215, 245), R(0.28, 0.44), R(0.2, 0.3), C([28, 88, 318, 176])],
    sand: () => [R(36, 48), R(0.3, 0.45), R(0.66, 0.76), C([12, 204, 150])],
  };
  const tone = need(tones[biome])();
  const [hue = 0, sat = 0, light = 0, accentHue = 0] = tone;
  const pale = hsl(hue + R(8, 34), 0.36, light > 0.62 ? 0.93 : 0.86);
  const markDark = P(light > 0.6 ? 0.85 : 0.6);
  const skinOf = (kinds: readonly string[], extra: RawSkin = {}): RawSkin => ({
    base: hsl(hue, sat, light),
    accent: hsl(accentHue + R(-8, 8), R(0.62, 0.82), R(0.52, 0.62)),
    pale,
    eye: hsl(accentHue + C([0, 0, 150, 200]), 0.8, 0.6),
    surface: C(["scales", "plain"]),
    belly: R(0.55, 0.95),
    socks: P(0.4) ? R(0.35, 0.85) : 0,
    markings: P(0.78)
      ? {
          kind: C(kinds),
          color: P(0.2)
            ? hsl(accentHue, 0.55, 0.5)
            : markDark
              ? hsl(
                  hue + C([0, -14, 14]),
                  Math.min(0.7, sat + 0.08),
                  Math.max(0.1, light - R(0.2, 0.28)),
                )
              : hsl(hue + 12, sat * 0.7, Math.min(0.92, light + R(0.2, 0.3))),
          spacing: R(0.1, 0.28),
          coverage: R(0.3, 0.55),
          angle: Math.round(R(-35, 35)),
          seed: Math.floor(draw() * 4294967296),
        }
      : null,
    ...extra,
  });
  const growth = (kind: string, girth: number, count: number) => ({
    kind,
    count,
    height: R(0.65, 1.1) * girth,
    spread: R(0.5, 0.95),
    seed: Math.floor(draw() * 4294967296),
  });
  const some = (items: readonly string[], most: number, least = 0) => {
    const pool = [...items],
      out: string[] = [];
    for (let n = I(least, most); n > 0 && pool.length; n--)
      out.push(need(pool.splice(Math.floor(draw() * pool.length), 1)[0]));
    return out;
  };
  const wingOf = (
    structure: "bat" | "feather" | "insect",
    extra: Omit<RawLimb, "kind">,
  ): RawLimb => ({
    kind: "wing",
    pairs: 1,
    structure,
    ribs: { bat: I(3, 5), feather: I(7, 11), insect: I(4, 7) }[structure],
    bend: R(0.28, 0.6),
    notch: R(0.25, 0.8),
    point: R(0.1, 0.8),
    pattern: C(["none", "tips", "tips", "bars", "eyespot"]),
    seed: Math.floor(draw() * 4294967296),
    ...extra,
  });
  const folded = (from = 0.7) =>
    wingOf("feather", {
      from,
      length: R(0.45, 0.6),
      rise: -58,
      sweep: 50,
      chord: 0.22,
      ribs: I(6, 8),
      bend: 0.85,
      notch: 0.2,
      point: 0.2,
    });
  const look = () => (P(0.85) ? either(R(10, 30)) : 0);
  const sway = () => (P(0.8) ? either(R(12, 45)) : 0);
  const none = { kind: "none" };

  const families: Record<string, () => RawPlan> = {
    grazer() {
      if (kin === "browser") {
        const girth = R(0.22, 0.27),
          length = R(0.78, 0.95);
        return {
          spine: {
            length,
            girth,
            flat: R(0.9, 1.05),
            rear: R(4, 10),
            front: R(20, 32),
            arch: R(2, 6),
            stance: R(0.74, 0.92),
            profile: "wedge",
            bulge: [0.95, 0.96, 1.04, 1.2, 1.05],
          },
          head: {
            neck: R(0.85, 1.25),
            neckPitch: R(62, 76),
            neckGirth: R(0.62, 0.76),
            size: R(1.15, 1.4),
            shape: C(["long", "round"]),
            snout: "muzzle",
            snoutLength: R(0.9, 1.25),
            jaw: 0.05,
            eyes: 2,
            eyePlace: "side",
            eyeSize: R(1.2, 1.6),
            lids: R(0.3, 0.5),
            brow: R(0.1, 0.3),
            crest: C(["nubs", "nubs", "ears", "fan"]),
            crestSize: R(0.9, 1.3),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 2,
              from: 0.12,
              to: 0.88,
              style: "mammal",
              splay: R(3, 6),
              end: C(["hoof", "hoof", "pad"]),
              muscle: R(1, 1.2),
              girth: R(0.86, 1),
            },
          ],
          tail: {
            kind: "taper",
            length: R(0.35, 0.5) * length,
            lift: R(-45, -20),
            girth: R(0.34, 0.44),
            sway: sway(),
          },
          back: none,
          details: ["tail tuft", ...some(["mane", "dewlap"], 1)],
          skin: skinOf(["Reticulated", "Reticulated", "Rosettes", "Spots"]),
        };
      }
      if (kin === "boar") {
        const girth = R(0.27, 0.33),
          length = R(0.8, 0.98);
        return {
          spine: {
            length,
            girth,
            flat: R(0.92, 1.05),
            rear: R(-2, 4),
            front: R(-4, 6),
            arch: R(6, 12),
            stance: R(0.4, 0.52),
            profile: "barrel",
            bulge: [0.95, 1.02, 1.1, 1.24, 1.12],
          },
          head: {
            neck: R(0.06, 0.14),
            neckPitch: R(4, 18),
            neckGirth: R(1, 1.12),
            size: R(1.3, 1.6),
            shape: C(["long", "wide"]),
            snout: C(["muzzle", "muzzle", "trunk"]),
            snoutLength: R(1.1, 1.5),
            jaw: R(0.1, 0.25),
            teeth: I(0, 2),
            eyes: 2,
            eyePlace: "side",
            eyeSize: R(1, 1.2),
            lids: R(0.3, 0.5),
            brow: R(0.4, 0.7),
            crest: C(["ears", "ears", "nubs", "none"]),
            crestSize: R(0.75, 1.05),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 2,
              from: 0.16,
              to: 0.84,
              style: "mammal",
              splay: R(4, 8),
              end: C(["hoof", "hoof", "pad"]),
              muscle: R(1.1, 1.3),
              girth: R(0.92, 1.1),
            },
          ],
          tail: {
            kind: C(["taper", "stub"]),
            length: R(0.18, 0.3) * length,
            lift: R(10, 50),
            girth: R(0.3, 0.42),
            sway: sway(),
          },
          back: P(0.55)
            ? { kind: "spikes", count: I(5, 8), height: R(0.04, 0.07) }
            : P(0.4)
              ? growth("shag mantle", girth, I(3, 4))
              : none,
          details: ["tusks", ...some(["mane", "tail tuft", "beard"], 1)],
          skin: skinOf(["Countershade", "Bands", "Marbled", "Spots"]),
        };
      }
      if (kin === "bison") {
        const girth = R(0.28, 0.34),
          length = R(0.92, 1.1);
        return {
          spine: {
            length,
            girth,
            flat: R(0.86, 0.98),
            rear: R(-4, 2),
            front: R(-10, 0),
            arch: R(10, 16),
            stance: R(0.55, 0.7),
            profile: "wedge",
            bulge: [0.82, 0.88, 1.02, 1.42, 1.2],
          },
          head: {
            neck: R(0.08, 0.16),
            neckPitch: R(-18, 4),
            neckGirth: R(1.05, 1.2),
            size: R(1.25, 1.5),
            shape: C(["wide", "long"]),
            snout: "muzzle",
            snoutLength: R(0.8, 1.1),
            jaw: 0.08,
            eyes: 2,
            eyePlace: "side",
            eyeSize: R(1, 1.2),
            lids: R(0.3, 0.5),
            brow: R(0.6, 0.9),
            crest: C(["ram", "ram", "horns", "lyre"]),
            crestSize: R(1.2, 1.7),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 2,
              from: 0.14,
              to: 0.84,
              style: "mammal",
              splay: R(4, 7),
              end: "hoof",
              muscle: R(1.15, 1.35),
              girth: R(0.9, 1.08),
            },
          ],
          tail: {
            kind: "taper",
            length: R(0.3, 0.42) * length,
            lift: R(-50, -25),
            girth: R(0.3, 0.4),
            sway: sway(),
          },
          back: P(0.6) ? growth("shag mantle", girth, I(3, 5)) : none,
          details: ["beard", ...some(["mane", "tail tuft"], 2, 1)],
          skin: skinOf(["Countershade", "Countershade", "Marbled", "Bands"]),
        };
      }
      const girth = R(0.2, 0.25),
        length = R(0.82, 1);
      return {
        spine: {
          length,
          girth,
          flat: R(0.9, 1.02),
          rear: R(-2, 6),
          front: R(8, 18),
          arch: R(2, 6),
          stance: R(0.82, 1.02),
          profile: C(["pear", "wedge"]),
          bulge: [1.08, 0.94, 1, 1.14, 1],
        },
        head: {
          neck: R(0.38, 0.6),
          neckPitch: R(48, 66),
          neckGirth: R(0.7, 0.84),
          size: R(1.15, 1.4),
          shape: "long",
          snout: C(["muzzle", "muzzle", "beak"]),
          snoutLength: R(0.9, 1.3),
          jaw: 0.05,
          eyes: 2,
          eyePlace: "side",
          eyeSize: R(1.2, 1.6),
          lids: R(0.2, 0.4),
          brow: R(0.1, 0.4),
          crest: C(["antlers", "antlers", "lyre", "lyre", "spire", "horns"]),
          crestSize: R(1.25, 1.9),
          turn: look(),
        },
        limbs: [
          {
            kind: "leg",
            pairs: 2,
            from: 0.14,
            to: 0.86,
            style: C(["bird", "mammal", "mammal"]),
            splay: R(3, 7),
            end: C(["hoof", "hoof", "paw"]),
            muscle: R(1, 1.2),
            girth: R(0.7, 0.86),
          },
        ],
        tail: {
          kind: C(["taper", "stub", "stub"]),
          length: R(0.2, 0.4) * length,
          lift: R(-10, 40),
          girth: R(0.36, 0.5),
          sway: sway(),
        },
        back: none,
        details: some(["tail tuft", "dewlap", "beard", "mane"], 2),
        skin: skinOf(["Rosettes", "Spots", "Bands", "Countershade"]),
      };
    },
    stalker() {
      if (kin === "cat") {
        const girth = R(0.19, 0.24),
          length = R(0.95, 1.15);
        return {
          spine: {
            length,
            girth,
            flat: R(0.9, 1),
            rear: R(-4, 2),
            front: R(0, 10),
            arch: R(-2, 5),
            stance: R(0.55, 0.7),
            profile: "wedge",
            bulge: [1.02, 0.9, 0.98, 1.16, 1.04],
          },
          head: {
            neck: R(0.12, 0.22),
            neckPitch: R(18, 38),
            neckGirth: R(0.95, 1.08),
            size: R(1.3, 1.6),
            shape: C(["round", "wide"]),
            snout: "muzzle",
            snoutLength: R(0.6, 0.85),
            jaw: R(0.2, 0.45),
            teeth: I(3, 5),
            brow: R(0.5, 0.8),
            lids: R(0.25, 0.4),
            eyes: 2,
            eyePlace: "front",
            eyeSize: R(1.1, 1.4),
            crest: "ears",
            crestSize: R(0.9, 1.5),
            whiskers: true,
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 2,
              from: 0.14,
              to: 0.86,
              style: "mammal",
              splay: R(4, 8),
              end: "paw",
              digits: 3,
              girth: R(0.9, 1.1),
              muscle: R(1.2, 1.4),
            },
          ],
          tail: {
            kind: "taper",
            length: R(0.8, 1.05) * length,
            girth: R(0.6, 0.8),
            lift: R(-25, 35),
            sway: sway(),
          },
          back: P(0.3)
            ? { kind: C(["spikes", "fins"]), count: I(5, 8), height: R(0.04, 0.08) }
            : none,
          details: [
            ...(P(0.6) ? ["tusks"] : []),
            ...some(["mane", "tail tuft", "cheek frills"], 1),
          ],
          skin: skinOf(["Bands", "Rosettes", "Spots", "Countershade"]),
        };
      }
      if (kin === "terror bird") {
        const girth = R(0.22, 0.27),
          length = R(0.62, 0.78);
        return {
          spine: {
            length,
            girth,
            rear: R(4, 12),
            front: R(30, 46),
            arch: R(2, 6),
            stance: R(0.85, 1.05),
            profile: "pear",
            bulge: [1.05, 1.18, 1.08, 0.94, 0.82],
          },
          head: {
            neck: R(0.32, 0.5),
            neckPitch: R(58, 72),
            neckGirth: R(0.74, 0.88),
            size: R(1.5, 1.85),
            shape: C(["long", "round"]),
            snout: "beak",
            snoutLength: R(1.25, 1.7),
            jaw: R(0.1, 0.3),
            eyes: 2,
            eyePlace: "side",
            eyeSize: R(1, 1.3),
            lids: 0.25,
            brow: R(0.6, 0.9),
            crest: C(["plume", "plume", "fan", "none"]),
            crestSize: R(0.9, 1.4),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 1,
              from: 0.34,
              style: "bird",
              splay: R(4, 7),
              end: "talons",
              digits: 3,
              girth: R(0.95, 1.15),
              muscle: R(1.35, 1.55),
            },
            folded(0.68),
          ],
          tail: { kind: C(["fluke", "stub"]), length: R(0.25, 0.4), lift: R(5, 20) },
          back: none,
          details: some(["dewlap", "spurs"], 2),
          skin: skinOf(["Countershade", "Bands", "Spots"]),
        };
      }
      if (kin === "lurker") {
        const girth = R(0.19, 0.24),
          length = R(1.15, 1.4);
        return {
          spine: {
            length,
            girth,
            flat: R(1.25, 1.45),
            rear: R(-4, 0),
            front: R(0, 6),
            arch: R(0, 4),
            stance: R(0.24, 0.32),
            profile: "barrel",
            bulge: [1, 1.1, 1.12, 1.05, 0.92],
          },
          head: {
            neck: R(0.05, 0.1),
            neckPitch: R(2, 10),
            neckGirth: 1.1,
            size: R(1.25, 1.5),
            shape: "flat",
            snout: "muzzle",
            snoutLength: R(1.7, 2.3),
            jaw: R(0.25, 0.5),
            teeth: I(5, 6),
            brow: R(0.6, 0.9),
            lids: 0.3,
            eyes: 2,
            eyePlace: "top",
            eyeSize: R(1, 1.25),
            crest: "none",
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 2,
              from: 0.18,
              to: 0.8,
              style: "mammal",
              splay: R(20, 28),
              end: C(["paw", "paddle"]),
              digits: 3,
              girth: R(0.85, 1),
              muscle: 1.1,
            },
          ],
          tail: {
            kind: "taper",
            length: R(0.9, 1.15) * length,
            girth: R(1.25, 1.45),
            lift: R(-4, 6),
            sway: sway(),
          },
          back: { kind: C(["plates", "spikes", "fins"]), count: I(8, 11), height: R(0.05, 0.09) },
          details: some(["belly plates"], 1),
          skin: skinOf(["Countershade", "Reticulated", "Bands"]),
        };
      }
      const girth = R(0.2, 0.27),
        length = R(0.75, 0.95);
      const limbs: RawLimb[] = [
        {
          kind: "leg",
          pairs: 1,
          from: 0.3,
          style: "bird",
          splay: R(4, 8),
          end: "talons",
          digits: 3,
          girth: R(1.15, 1.4),
          muscle: R(1.2, 1.45),
        },
      ];
      if (P(0.7))
        limbs.push({
          kind: "arm",
          pairs: 1,
          from: 0.82,
          length: R(0.22, 0.4),
          drop: R(40, 60),
          forward: R(35, 55),
          elbow: R(50, 75),
          end: C(["hand", "hand", "spike"]),
          digits: I(2, 3),
          girth: 0.6,
          hand: 0.9,
          raise: either(R(0, 25)),
        });
      return {
        spine: {
          length,
          girth,
          rear: R(6, 16),
          front: R(28, 44),
          arch: R(2, 6),
          stance: R(0.7, 0.95),
          profile: "pear",
          bulge: [1.1, 1.14, 1.04, 0.96, 0.86],
        },
        head: {
          neck: R(0.18, 0.32),
          neckPitch: R(40, 60),
          neckGirth: R(0.9, 1.05),
          size: R(1.3, 1.65),
          shape: C(["long", "long", "wide"]),
          snout: "muzzle",
          snoutLength: R(1.1, 1.5),
          jaw: R(0.2, 0.5),
          teeth: I(3, 6),
          brow: R(0.6, 0.9),
          lids: R(0.2, 0.35),
          eyes: 2,
          eyePlace: C(["side", "front"]),
          eyeSize: R(0.95, 1.3),
          crest: C(["fan", "crown", "none", "spire", "plume"]),
          crestSize: R(0.8, 1.2),
          turn: look(),
        },
        limbs,
        tail: {
          kind: C(["taper", "taper", "taper", "stinger"]),
          length: R(0.85, 1.15) * length,
          girth: R(1.15, 1.35),
          lift: R(2, 14),
          sway: sway(),
        },
        back: P(0.5)
          ? { kind: C(["spikes", "sail", "fins"]), count: I(5, 8), height: R(0.06, 0.13) }
          : P(0.3)
            ? growth("drum sacs", girth, I(1, 2))
            : none,
        details: some(["spurs", "dewlap", "brow horns", "nose horn"], 1),
        skin: skinOf(["Bands", "Bands", "Countershade", "Marbled"]),
      };
    },
    envoy() {
      const leg = (extra: Omit<RawLimb, "kind">): RawLimb => ({
        kind: "leg",
        pairs: 1,
        from: 0.04,
        style: C(["mammal", "mammal", "pillar"]),
        splay: R(4, 9),
        end: C(["paw", "pad", "hoof"]),
        digits: 3,
        girth: R(1.15, 1.45),
        muscle: R(1.1, 1.3),
        ...extra,
      });
      const arm = (extra: Omit<RawLimb, "kind">): RawLimb => ({
        kind: "arm",
        pairs: 1,
        from: 0.82,
        to: 0.82,
        length: R(0.52, 0.72),
        drop: R(55, 70),
        forward: R(15, 32),
        elbow: R(30, 55),
        end: "hand",
        digits: I(3, 4),
        hand: R(0.78, 0.98),
        muscle: R(1, 1.25),
        raise: P(0.7) ? either(R(25, 60)) : 0,
        ...extra,
      });
      if (kin === "scholar") {
        const girth = R(0.17, 0.21),
          length = R(0.7, 0.88);
        return {
          spine: {
            length,
            girth,
            flat: R(1.05, 1.25),
            rear: R(82, 88),
            front: R(80, 88),
            arch: R(0, 6),
            stance: R(0.78, 0.98),
            profile: C(["tube", "wedge"]),
            bulge: [1.02, 0.84, 0.92, 1.12, 0.98],
          },
          head: {
            neck: R(0.26, 0.42),
            neckPitch: R(70, 84),
            neckGirth: R(0.7, 0.84),
            size: R(1.55, 1.85),
            shape: C(["round", "long", "long"]),
            snout: C(["muzzle", "beak", "none", "trunk"]),
            snoutLength: R(0.6, 1),
            jaw: R(0.06, 0.2),
            teeth: 0,
            brow: R(0.2, 0.5),
            lids: R(0.35, 0.55),
            eyes: C([2, 2, 2, 3]),
            eyeSize: R(1.2, 1.6),
            eyePlace: C(["front", "side"]),
            crest: C(["fan", "plume", "lyre", "nubs", "spire"]),
            crestSize: R(1, 1.5),
            turn: look(),
          },
          limbs: [
            leg({ girth: R(0.95, 1.15), style: C(["mammal", "bird"]) }),
            arm({
              length: R(0.6, 0.76),
              drop: R(70, 80),
              forward: R(18, 30),
              elbow: R(45, 70),
              girth: R(0.8, 0.92),
              hand: R(0.8, 0.95),
            }),
          ],
          tail: P(0.5)
            ? {
                kind: "taper",
                length: R(0.4, 0.65),
                lift: R(-50, -25),
                girth: R(0.5, 0.7),
                sway: sway(),
              }
            : none,
          back: none,
          details: some(["beard", "cheek frills", "dewlap", "tail tuft"], 2),
          skin: skinOf(["Bands", "Marbled", "Countershade", "Reticulated"]),
        };
      }
      if (kin === "merchant") {
        const girth = R(0.26, 0.32),
          length = R(0.56, 0.7),
          four = P(0.6);
        return {
          spine: {
            length,
            girth,
            flat: R(1.15, 1.35),
            rear: R(82, 88),
            front: R(84, 90),
            arch: R(0, 4),
            stance: R(0.42, 0.56),
            profile: "pear",
            bulge: [1.08, 1.22, 1.14, 1.02, 0.94],
          },
          head: {
            neck: R(0.04, 0.1),
            neckPitch: R(74, 86),
            neckGirth: 1.1,
            size: R(1.4, 1.75),
            shape: C(["wide", "wide", "flat"]),
            snout: C(["muzzle", "muzzle", "trunk", "bill"]),
            snoutLength: R(0.6, 1),
            jaw: R(0.15, 0.4),
            teeth: I(0, 3),
            brow: R(0.4, 0.8),
            lids: R(0.35, 0.55),
            eyes: C([2, 2, 4, 3]),
            eyeSize: R(1, 1.4),
            eyePlace: "front",
            crest: C(["ears", "ram", "none", "nubs", "horns"]),
            crestSize: R(1, 1.5),
            turn: look(),
          },
          limbs: [
            leg({ style: C(["pillar", "mammal"]), end: C(["pad", "paw"]), girth: R(1.3, 1.55) }),
            arm({
              pairs: four ? 2 : 1,
              from: four ? 0.54 : 0.8,
              to: four ? 0.88 : 0.8,
              length: R(0.5, 0.64),
              girth: R(1, 1.2),
            }),
          ],
          tail: {
            kind: C(["stub", "stub", "none", "club"]),
            length: R(0.3, 0.45),
            lift: R(-40, -10),
            girth: R(1, 1.3),
            sway: sway(),
          },
          back: none,
          details: [...(P(0.6) ? ["tusks"] : []), ...some(["dewlap", "beard"], 1)],
          skin: skinOf(["Spots", "Marbled", "Countershade", "Rosettes"]),
        };
      }
      if (kin === "sprite") {
        const girth = R(0.17, 0.2),
          length = R(0.42, 0.52);
        const limbs: RawLimb[] = [
          leg({
            girth: R(0.95, 1.15),
            style: C(["mammal", "bird"]),
            end: C(["paw", "talons", "pad"]),
          }),
          arm({
            length: R(0.46, 0.6),
            girth: R(0.78, 0.9),
            hand: R(0.9, 1.1),
            raise: either(R(30, 65)),
          }),
        ];
        if (P(0.35))
          limbs.push(
            wingOf("insect", {
              pairs: C([1, 2]),
              from: 0.66,
              to: 0.78,
              length: R(0.9, 1.3) * length,
              rise: R(25, 45),
              sweep: R(15, 35),
              chord: R(0.28, 0.4),
            }),
          );
        return {
          scale: R(0.66, 0.84),
          spine: {
            length,
            girth,
            flat: R(1, 1.2),
            rear: R(80, 88),
            front: R(80, 90),
            arch: R(0, 6),
            stance: R(0.6, 0.8),
            profile: C(["pear", "tube"]),
            bulge: [1.05, 0.9, 0.96, 1.08, 1],
          },
          head: {
            neck: R(0.05, 0.12),
            neckPitch: R(70, 84),
            size: R(1.75, 2.1),
            shape: C(["round", "round", "wide"]),
            snout: C(["none", "muzzle", "beak"]),
            snoutLength: R(0.45, 0.7),
            jaw: R(0.06, 0.2),
            teeth: I(0, 1),
            brow: R(0.1, 0.4),
            lids: R(0.3, 0.5),
            eyes: C([2, 2, 2, 3]),
            eyeSize: R(1.7, 2.15),
            eyePlace: "front",
            crest: C(["ears", "ears", "antennae", "nubs", "plume"]),
            crestSize: R(1.5, 2.2),
            whiskers: P(0.3),
            turn: look(),
          },
          limbs,
          tail: P(0.7)
            ? {
                kind: "taper",
                length: R(0.4, 0.6),
                lift: R(-30, 40),
                girth: R(0.5, 0.7),
                sway: sway(),
              }
            : none,
          back: none,
          details: some(["tail tuft", "cheek frills"], 1),
          skin: skinOf(["Spots", "Rosettes", "Bands", "Marbled"]),
        };
      }
      if (kin === "saurian") {
        const girth = R(0.2, 0.25),
          length = R(0.66, 0.82);
        return {
          spine: {
            length,
            girth,
            flat: R(1.05, 1.2),
            rear: R(70, 80),
            front: R(78, 88),
            arch: R(2, 8),
            stance: R(0.62, 0.8),
            profile: C(["wedge", "pear"]),
            bulge: [1.06, 0.9, 0.98, 1.16, 1],
          },
          head: {
            neck: R(0.12, 0.24),
            neckPitch: R(60, 76),
            neckGirth: R(0.85, 1),
            size: R(1.3, 1.6),
            shape: C(["long", "flat", "long"]),
            snout: "muzzle",
            snoutLength: R(1.1, 1.5),
            jaw: R(0.15, 0.4),
            teeth: I(2, 5),
            brow: R(0.5, 0.9),
            lids: R(0.2, 0.4),
            eyes: 2,
            eyeSize: R(1.05, 1.4),
            eyePlace: C(["side", "front"]),
            crest: C(["fan", "fan", "spire", "crown", "horns", "none"]),
            crestSize: R(0.9, 1.4),
            turn: look(),
          },
          limbs: [
            leg({ style: C(["bird", "mammal"]), end: C(["talons", "paw"]) }),
            arm({ digits: 3 }),
          ],
          tail: {
            kind: C(["taper", "taper", "club", "stinger"]),
            length: R(0.8, 1.1),
            lift: R(-38, -18),
            girth: R(1.15, 1.4),
            sway: sway(),
          },
          back: P(0.6)
            ? { kind: C(["spikes", "fins", "sail"]), count: I(4, 7), height: R(0.06, 0.12) }
            : none,
          details: some(["frill", "brow horns", "nose horn", "dewlap"], 1),
          skin: skinOf(["Bands", "Countershade", "Reticulated", "Marbled"]),
        };
      }
      const girth = R(0.2, 0.25),
        length = R(0.55, 0.72);
      return {
        spine: {
          length,
          girth,
          flat: R(1, 1.15),
          rear: R(76, 86),
          front: R(80, 90),
          arch: R(0, 6),
          stance: R(0.66, 0.86),
          profile: C(["pear", "barrel"]),
          bulge: [1.04, 1.12, 1.06, 1.02, 0.92],
        },
        head: {
          neck: R(0.14, 0.28),
          neckPitch: R(66, 82),
          neckGirth: R(0.7, 0.86),
          size: R(1.4, 1.7),
          shape: C(["round", "long"]),
          snout: C(["beak", "beak", "bill"]),
          snoutLength: R(0.8, 1.3),
          jaw: R(0.05, 0.2),
          brow: R(0.3, 0.7),
          lids: R(0.25, 0.4),
          eyes: 2,
          eyeSize: R(1.3, 1.8),
          eyePlace: C(["front", "side"]),
          crest: C(["plume", "plume", "fan", "crown"]),
          crestSize: R(1, 1.5),
          turn: look(),
        },
        limbs: [
          leg({ style: "bird", end: "talons", girth: R(1, 1.2) }),
          arm({ digits: 3, girth: R(0.82, 0.95) }),
        ],
        tail: { kind: C(["fluke", "fluke", "stub"]), length: R(0.3, 0.45), lift: R(-30, 0) },
        back: none,
        details: some(["dewlap", "cheek frills"], 1),
        skin: skinOf(["Bands", "Spots", "Countershade"]),
      };
    },
    brute() {
      if (kin === "ogre") {
        const girth = R(0.3, 0.36),
          length = R(0.68, 0.84);
        return {
          spine: {
            length,
            girth,
            flat: R(1.15, 1.3),
            rear: R(78, 86),
            front: R(72, 82),
            arch: R(4, 10),
            stance: R(0.36, 0.48),
            profile: "pear",
            bulge: [1.1, 1.26, 1.14, 1.16, 1.04],
          },
          head: {
            neck: R(0.03, 0.08),
            neckPitch: R(50, 66),
            neckGirth: 1.15,
            size: R(1.15, 1.4),
            shape: C(["wide", "wide", "flat"]),
            snout: "muzzle",
            snoutLength: R(0.6, 0.85),
            jaw: R(0.35, 0.65),
            teeth: I(2, 4),
            brow: R(0.8, 1),
            lids: R(0.35, 0.5),
            eyes: C([2, 2, 1, 3]),
            eyePlace: "front",
            eyeSize: R(0.9, 1.2),
            crest: C(["ram", "nubs", "ears", "none", "spire"]),
            crestSize: R(1, 1.5),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 1,
              from: 0.05,
              style: "pillar",
              splay: R(8, 13),
              end: C(["pad", "paw"]),
              girth: R(1.25, 1.5),
              muscle: 1.2,
            },
            {
              kind: "arm",
              pairs: 1,
              from: 0.82,
              length: R(0.7, 0.86),
              drop: R(66, 76),
              forward: R(8, 18),
              elbow: R(18, 32),
              end: "hand",
              digits: 3,
              hand: R(0.9, 1.05),
              girth: R(1.1, 1.3),
              muscle: R(1.3, 1.55),
              raise: P(0.6) ? either(R(15, 40)) : 0,
            },
          ],
          tail: { kind: C(["none", "stub"]), length: 0.28 },
          back: P(0.3) ? { kind: "spikes", count: I(3, 5), height: R(0.06, 0.1) } : none,
          details: ["tusks", ...some(["beard", "shoulder spikes", "belly plates"], 1)],
          skin: skinOf(["Countershade", "Marbled", "Spots"]),
        };
      }
      if (kin === "bear") {
        const girth = R(0.3, 0.36),
          length = R(0.9, 1.08);
        return {
          spine: {
            length,
            girth,
            flat: R(1, 1.12),
            rear: R(-4, 2),
            front: R(4, 12),
            arch: R(6, 12),
            stance: R(0.5, 0.64),
            profile: "barrel",
            bulge: [1.08, 1.1, 1.06, 1.2, 1.08],
          },
          head: {
            neck: R(0.08, 0.16),
            neckPitch: R(10, 28),
            neckGirth: 1.12,
            size: R(1.2, 1.45),
            shape: C(["wide", "round"]),
            snout: "muzzle",
            snoutLength: R(0.7, 1),
            jaw: R(0.15, 0.4),
            teeth: I(2, 4),
            brow: R(0.5, 0.8),
            lids: R(0.3, 0.45),
            eyes: 2,
            eyePlace: "front",
            eyeSize: R(0.9, 1.15),
            crest: C(["ears", "ears", "nubs"]),
            crestSize: R(0.7, 0.95),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 2,
              from: 0.14,
              to: 0.84,
              style: C(["mammal", "pillar"]),
              splay: R(6, 10),
              end: "paw",
              digits: 3,
              girth: R(1.15, 1.35),
              muscle: R(1.2, 1.4),
            },
          ],
          tail: { kind: "stub", length: 0.2, lift: R(0, 30) },
          back: P(0.5) ? growth("shag mantle", girth, I(3, 5)) : none,
          details: some(["mane", "tusks", "nose horn"], 1),
          skin: skinOf(["Countershade", "Marbled", "Bands"]),
        };
      }
      const girth = R(0.26, 0.33),
        length = R(0.75, 0.95);
      return {
        spine: {
          length,
          girth,
          flat: R(1.15, 1.4),
          rear: R(28, 40),
          front: R(50, 64),
          arch: R(4, 10),
          stance: R(0.55, 0.7),
          profile: C(["wedge", "barrel"]),
          bulge: [0.95, 0.9, 1.05, 1.3, 1.1],
        },
        head: {
          neck: R(0.04, 0.1),
          neckPitch: R(20, 40),
          neckGirth: 1.1,
          size: R(1.0, 1.3),
          shape: C(["wide", "flat", "round"]),
          snout: "muzzle",
          snoutLength: R(0.6, 0.9),
          jaw: R(0.2, 0.5),
          teeth: I(2, 4),
          brow: R(0.7, 1),
          lids: R(0.3, 0.5),
          eyes: C([2, 2, 1, 3]),
          eyePlace: "front",
          eyeSize: R(0.85, 1.15),
          crest: C(["horns", "none", "ears", "ram"]),
          crestSize: R(1, 1.6),
          turn: look(),
        },
        limbs: [
          {
            kind: "leg",
            pairs: 1,
            from: 0.08,
            style: C(["pillar", "mammal"]),
            splay: R(8, 14),
            end: C(["pad", "paw"]),
            girth: R(1.1, 1.3),
            muscle: 1.2,
          },
          {
            kind: "arm",
            pairs: 1,
            from: 0.84,
            length: R(0.5, 0.62),
            drop: R(76, 84),
            forward: R(4, 14),
            elbow: R(10, 22),
            end: "hand",
            digits: 3,
            hand: R(0.8, 0.95),
            girth: R(1.1, 1.3),
            muscle: R(1.3, 1.55),
            raise: P(0.4) ? either(R(10, 30)) : 0,
          },
        ],
        tail: { kind: C(["none", "stub", "stub"]), length: 0.3 },
        back: P(0.3)
          ? growth("shag mantle", girth, I(3, 5))
          : P(0.4)
            ? { kind: "spikes", count: I(4, 7), height: R(0.06, 0.1) }
            : none,
        details: some(["tusks", "shoulder spikes", "mane"], 2),
        skin: skinOf(["Countershade", "Marbled", "Bands", "Spots"]),
      };
    },
    tank() {
      if (kin === "tortoise") {
        const girth = R(0.28, 0.34),
          length = R(0.78, 0.95);
        return {
          spine: {
            length,
            girth,
            flat: R(1.25, 1.45),
            front: R(0, 6),
            arch: R(8, 14),
            stance: R(0.36, 0.46),
            profile: "barrel",
            bulge: [1, 1.2, 1.3, 1.2, 0.95],
          },
          head: {
            neck: R(0.26, 0.42),
            neckPitch: R(16, 34),
            neckGirth: R(0.6, 0.74),
            size: R(1.05, 1.25),
            shape: C(["round", "wide"]),
            snout: "beak",
            snoutLength: R(0.6, 0.85),
            eyes: 2,
            eyePlace: "side",
            eyeSize: R(1, 1.25),
            lids: R(0.45, 0.65),
            brow: R(0.3, 0.5),
            crest: "none",
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 2,
              from: 0.18,
              to: 0.82,
              style: "pillar",
              splay: R(12, 18),
              end: "pad",
              girth: R(0.95, 1.15),
              muscle: 1,
            },
          ],
          tail: { kind: "stub", length: R(0.18, 0.28), lift: R(-20, 0) },
          back: P(0.5)
            ? growth("shingles", girth, I(5, 7))
            : { kind: "plates", count: I(7, 10), height: R(0.07, 0.11) },
          details: some(["dewlap", "beard"], 1),
          skin: skinOf(["Reticulated", "Spots", "Countershade"]),
        };
      }
      if (kin === "rhino") {
        const girth = R(0.28, 0.33),
          length = R(1, 1.18);
        return {
          spine: {
            length,
            girth,
            flat: R(1, 1.15),
            front: R(-4, 6),
            arch: R(6, 11),
            stance: R(0.58, 0.72),
            profile: "barrel",
            bulge: [1.06, 1.1, 1.08, 1.2, 1.06],
          },
          head: {
            neck: R(0.1, 0.18),
            neckPitch: R(-6, 12),
            neckGirth: 1.1,
            size: R(1.3, 1.55),
            shape: C(["long", "wide"]),
            snout: "muzzle",
            snoutLength: R(1, 1.35),
            jaw: 0.08,
            eyes: 2,
            eyePlace: "side",
            eyeSize: R(0.9, 1.1),
            lids: R(0.35, 0.5),
            brow: R(0.6, 0.9),
            crest: C(["ears", "ears", "none"]),
            crestSize: R(0.65, 0.9),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 2,
              from: 0.15,
              to: 0.85,
              style: "pillar",
              splay: R(5, 9),
              end: "pad",
              girth: R(1, 1.2),
              muscle: 1,
            },
          ],
          tail: {
            kind: "taper",
            length: R(0.25, 0.36),
            girth: R(0.3, 0.4),
            lift: R(-50, -25),
            sway: sway(),
          },
          back: none,
          details: [
            "nose horn",
            ...some(["brow horns", "belly plates", "tail tuft", "shoulder spikes"], 2),
          ],
          skin: skinOf(["Countershade", "Reticulated", "Marbled"]),
        };
      }
      if (kin === "ceratops") {
        const girth = R(0.26, 0.32),
          length = R(1, 1.2);
        return {
          spine: {
            length,
            girth,
            flat: R(1.1, 1.25),
            front: R(-2, 8),
            arch: R(6, 11),
            stance: R(0.5, 0.64),
            profile: "barrel",
            bulge: [1.02, 1.16, 1.18, 1.1, 0.98],
          },
          head: {
            neck: R(0.08, 0.14),
            neckPitch: R(0, 14),
            neckGirth: 1.1,
            size: R(1.35, 1.6),
            shape: C(["long", "wide"]),
            snout: "beak",
            snoutLength: R(0.85, 1.15),
            eyes: 2,
            eyePlace: "side",
            eyeSize: R(0.9, 1.15),
            lids: R(0.3, 0.5),
            brow: R(0.6, 0.9),
            crest: "none",
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 2,
              from: 0.16,
              to: 0.84,
              style: "pillar",
              splay: R(6, 10),
              end: "pad",
              girth: R(1, 1.2),
              muscle: 1,
            },
          ],
          tail: {
            kind: C(["taper", "taper", "club"]),
            length: R(0.5, 0.7),
            girth: R(1.05, 1.25),
            lift: R(-6, 8),
            sway: sway(),
          },
          back: P(0.4)
            ? { kind: C(["spikes", "plates"]), count: I(4, 7), height: R(0.05, 0.09) }
            : none,
          details: ["frill", "brow horns", ...some(["nose horn", "belly plates"], 1)],
          skin: skinOf(["Spots", "Reticulated", "Bands"]),
        };
      }
      const girth = R(0.25, 0.32),
        length = R(1, 1.28);
      const shingled = P(0.5);
      return {
        spine: {
          length,
          girth,
          flat: R(1.2, 1.4),
          front: R(2, 10),
          arch: R(5, 10),
          stance: R(0.5, 0.68),
          profile: "barrel",
          bulge: [1.05, 1.15, 1.2, 1.1, 0.95],
        },
        head: {
          neck: R(0.1, 0.16),
          neckPitch: R(8, 20),
          neckGirth: 1.05,
          size: R(1.1, 1.35),
          shape: C(["wide", "flat", "wide"]),
          snout: C(["beak", "beak", "muzzle"]),
          snoutLength: R(0.7, 1),
          eyes: 2,
          eyePlace: "side",
          eyeSize: R(0.85, 1.1),
          lids: R(0.3, 0.5),
          brow: R(0.6, 0.9),
          crest: C(["horns", "none", "none"]),
          crestSize: R(1.3, 1.8),
          turn: look(),
        },
        limbs: [
          {
            kind: "leg",
            pairs: 2,
            from: 0.16,
            to: 0.84,
            style: "pillar",
            splay: R(6, 10),
            end: "pad",
            girth: R(1.05, 1.25),
            muscle: 1,
          },
        ],
        tail: {
          kind: C(["club", "club", "stinger"]),
          length: R(0.5, 0.75),
          girth: R(1, 1.2),
          lift: R(0, 12),
          sway: sway(),
        },
        back: shingled
          ? growth("shingles", girth, I(4, 7))
          : { kind: C(["plates", "plates", "spikes"]), count: I(6, 10), height: R(0.09, 0.15) },
        details: some(
          shingled
            ? ["shoulder spikes", "brow horns"]
            : ["shoulder spikes", "belly plates", "brow horns"],
          2,
        ),
        skin: skinOf(["Spots", "Reticulated", "Countershade"]),
      };
    },
    glider() {
      if (kin === "dragonfly") {
        const girth = R(0.15, 0.19),
          length = R(0.9, 1.1);
        return {
          spine: {
            length,
            girth,
            front: R(4, 14),
            arch: R(0, 5),
            stance: R(0.3, 0.4),
            profile: C(["wasp", "tube"]),
            bulge: [0.9, 1.2, 0.8, 1.15, 1],
          },
          head: {
            neck: 0.05,
            neckPitch: R(6, 18),
            size: R(1.3, 1.6),
            shape: C(["wide", "round"]),
            snout: "mandibles",
            eyes: C([2, 2, 4]),
            eyePlace: "side",
            eyeSize: R(1.7, 2.2),
            lids: 0,
            brow: 0,
            crest: "antennae",
            crestSize: R(1, 1.5),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 3,
              from: 0.46,
              to: 0.82,
              style: "insect",
              splay: R(42, 52),
              fan: R(50, 80),
              end: "point",
              girth: R(0.8, 0.95),
            },
            wingOf("insect", {
              pairs: 2,
              from: 0.62,
              to: 0.76,
              length: R(0.9, 1.25) * length,
              rise: R(20, 40),
              sweep: R(8, 26),
              chord: R(0.24, 0.36),
            }),
          ],
          tail: { kind: C(["stinger", "taper", "none"]), length: R(0.4, 0.7) },
          back: none,
          details: [],
          skin: skinOf(["Bands", "Bands", "Spots"]),
        };
      }
      if (kin === "moth") {
        const girth = R(0.22, 0.27),
          length = R(0.6, 0.75);
        return {
          spine: {
            length,
            girth,
            front: R(10, 24),
            arch: R(0, 6),
            stance: R(0.36, 0.48),
            profile: "barrel",
            bulge: [0.9, 1.1, 1.05, 1.15, 1],
          },
          head: {
            neck: 0.05,
            neckPitch: R(16, 34),
            size: R(1.3, 1.55),
            shape: "round",
            snout: C(["none", "trunk", "mandibles"]),
            snoutLength: R(0.5, 0.8),
            eyes: 2,
            eyePlace: "side",
            eyeSize: R(1.8, 2.3),
            lids: 0,
            brow: 0,
            crest: C(["plume", "antennae", "antennae"]),
            crestSize: R(1.3, 1.9),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 3,
              from: 0.3,
              to: 0.78,
              style: "insect",
              splay: R(40, 50),
              fan: R(40, 70),
              end: "point",
              girth: R(0.7, 0.85),
            },
            wingOf("insect", {
              pairs: 2,
              from: 0.5,
              to: 0.74,
              length: R(1.2, 1.6) * length,
              rise: R(18, 36),
              sweep: R(4, 20),
              chord: R(0.5, 0.68),
              pattern: C(["eyespot", "eyespot", "bars", "tips"]),
            }),
          ],
          tail: none,
          back: P(0.6) ? growth("shag mantle", girth, I(3, 4)) : none,
          details: [],
          skin: skinOf(["Bands", "Spots", "Marbled"]),
        };
      }
      if (kin === "wyvern") {
        const girth = R(0.18, 0.22),
          length = R(0.9, 1.1);
        return {
          spine: {
            length,
            girth,
            rear: R(-2, 8),
            front: R(18, 34),
            arch: R(2, 8),
            stance: R(0.55, 0.72),
            profile: "wedge",
            bulge: [0.9, 0.96, 1.06, 1.24, 1],
          },
          head: {
            neck: R(0.4, 0.62),
            neckPitch: R(44, 62),
            neckGirth: R(0.7, 0.84),
            size: R(1.3, 1.55),
            shape: "long",
            snout: "muzzle",
            snoutLength: R(1.1, 1.5),
            jaw: R(0.2, 0.45),
            teeth: I(3, 5),
            eyes: 2,
            eyePlace: C(["side", "front"]),
            eyeSize: R(1, 1.3),
            lids: 0.25,
            brow: R(0.6, 0.9),
            crest: C(["lyre", "horns", "fan", "spire"]),
            crestSize: R(0.9, 1.3),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 1,
              from: 0.3,
              style: "bird",
              splay: R(8, 12),
              end: "talons",
              muscle: 1.3,
              girth: R(1, 1.2),
            },
            wingOf("bat", {
              from: 0.72,
              length: R(1.2, 1.55) * length,
              rise: R(20, 38),
              sweep: R(12, 30),
              chord: R(0.36, 0.5),
            }),
          ],
          tail: {
            kind: C(["taper", "taper", "stinger", "club"]),
            length: R(0.95, 1.25) * length,
            girth: R(0.9, 1.1),
            lift: R(-6, 14),
            sway: sway(),
          },
          back: P(0.6)
            ? { kind: C(["spikes", "fins"]), count: I(5, 8), height: R(0.05, 0.09) }
            : none,
          details: some(["brow horns", "nose horn", "cheek frills", "beard"], 1),
          skin: skinOf(["Bands", "Countershade", "Marbled"]),
        };
      }
      const bat = kin === "bat",
        girth = R(0.17, 0.22),
        length = R(0.7, 0.9);
      return {
        spine: {
          length,
          girth,
          rear: R(0, 10),
          front: R(14, 34),
          arch: R(2, 6),
          stance: R(0.4, 0.6),
          profile: "wedge",
          bulge: [0.9, 0.95, 1.05, 1.25, 1],
        },
        head: bat
          ? {
              neck: R(0.08, 0.16),
              neckPitch: R(40, 58),
              size: R(1.3, 1.6),
              shape: C(["round", "wide"]),
              snout: "muzzle",
              snoutLength: R(0.6, 0.9),
              jaw: R(0.15, 0.4),
              teeth: I(2, 3),
              eyes: 2,
              eyePlace: "front",
              eyeSize: R(1.1, 1.5),
              lids: 0.3,
              brow: 0.4,
              crest: "ears",
              crestSize: R(1.5, 2.1),
              turn: look(),
            }
          : {
              neck: R(0.15, 0.3),
              neckPitch: R(40, 60),
              size: R(1.25, 1.55),
              shape: C(["long", "round"]),
              snout: C(["beak", "beak", "bill"]),
              snoutLength: R(0.9, 1.3),
              eyes: 2,
              eyePlace: "side",
              eyeSize: R(1.2, 1.6),
              lids: 0.2,
              brow: R(0.3, 0.6),
              crest: C(["plume", "fan", "crown", "none"]),
              crestSize: R(0.9, 1.3),
              turn: look(),
            },
        limbs: [
          {
            kind: "leg",
            pairs: 1,
            from: 0.3,
            style: bat ? "mammal" : "bird",
            splay: R(8, 12),
            end: bat ? "paw" : "talons",
            muscle: 1.2,
            girth: R(0.9, 1.1),
          },
          wingOf(bat ? "bat" : "feather", {
            from: 0.7,
            length: R(1.05, 1.45) * length,
            rise: R(14, 34),
            sweep: R(10, 28),
            chord: R(0.32, 0.46),
          }),
        ],
        tail: {
          kind: bat ? C(["taper", "stub"]) : "fluke",
          length: R(0.4, 0.6) * length,
          lift: R(0, 10),
          sway: bat ? sway() : 0,
        },
        back: none,
        details: some(bat ? ["cheek frills", "spurs"] : ["dewlap", "spurs"], 1),
        skin: skinOf(["Bands", "Countershade", "Spots"]),
      };
    },
    wader() {
      if (kin === "runner") {
        const girth = R(0.25, 0.3),
          length = R(0.6, 0.74);
        return {
          spine: {
            length,
            girth,
            rear: R(-4, 6),
            front: R(14, 26),
            arch: R(6, 12),
            stance: R(0.95, 1.15),
            profile: "barrel",
            bulge: [1.05, 1.18, 1.12, 0.96, 0.82],
          },
          head: {
            neck: R(0.55, 0.78),
            neckPitch: R(68, 80),
            neckGirth: R(0.5, 0.62),
            size: R(1.2, 1.45),
            shape: "round",
            snout: "beak",
            snoutLength: R(0.65, 0.95),
            eyes: 2,
            eyePlace: "side",
            eyeSize: R(1.4, 1.8),
            lids: 0.35,
            brow: 0.3,
            crest: C(["plume", "none", "fan", "nubs"]),
            crestSize: R(0.9, 1.4),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 1,
              from: 0.4,
              style: "bird",
              splay: R(4, 7),
              end: "talons",
              digits: 2,
              girth: R(0.9, 1.08),
              muscle: 1.55,
            },
            ...(P(0.6) ? [folded(0.66)] : []),
          ],
          tail: { kind: C(["fluke", "stub"]), length: R(0.28, 0.4), lift: R(15, 40) },
          back: none,
          details: some(["dewlap"], 1),
          skin: skinOf(["Countershade", "Spots", "Bands"], { socks: R(0.6, 0.9) }),
        };
      }
      if (kin === "longneck") {
        const girth = R(0.23, 0.28),
          length = R(0.9, 1.1);
        return {
          spine: {
            length,
            girth,
            front: R(4, 14),
            arch: R(6, 12),
            stance: R(0.7, 0.88),
            profile: "barrel",
            bulge: [1.02, 1.14, 1.12, 1.02, 0.86],
          },
          head: {
            neck: R(0.95, 1.35),
            neckPitch: R(42, 62),
            neckGirth: R(0.6, 0.72),
            size: R(1.1, 1.3),
            shape: C(["round", "long"]),
            snout: C(["muzzle", "bill"]),
            snoutLength: R(0.7, 1),
            jaw: 0.06,
            eyes: 2,
            eyePlace: "side",
            eyeSize: R(1.2, 1.5),
            lids: 0.35,
            brow: 0.3,
            crest: C(["nubs", "fan", "none", "none"]),
            crestSize: R(0.9, 1.3),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 2,
              from: 0.16,
              to: 0.84,
              style: C(["pillar", "mammal"]),
              splay: R(4, 8),
              end: C(["pad", "paddle"]),
              girth: R(0.95, 1.12),
              muscle: 1.1,
            },
          ],
          tail: {
            kind: "taper",
            length: R(1, 1.3) * length,
            girth: R(1.05, 1.2),
            lift: R(-8, 8),
            sway: sway(),
          },
          back: P(0.45)
            ? { kind: C(["fins", "spikes", "sail"]), count: I(6, 10), height: R(0.05, 0.1) }
            : none,
          details: some(["dewlap"], 1),
          skin: skinOf(["Countershade", "Reticulated", "Bands"]),
        };
      }
      if (kin === "stilt") {
        const girth = R(0.2, 0.24),
          length = R(0.44, 0.54);
        return {
          spine: {
            length,
            girth,
            rear: R(0, 10),
            front: R(10, 24),
            arch: R(4, 10),
            stance: R(1.25, 1.55),
            profile: "barrel",
          },
          head: {
            neck: R(0.14, 0.24),
            neckPitch: R(50, 66),
            neckGirth: R(0.62, 0.76),
            size: R(1.4, 1.65),
            shape: "round",
            snout: "bill",
            snoutLength: R(1.9, 2.5),
            eyes: 2,
            eyePlace: C(["front", "side"]),
            eyeSize: R(1.5, 1.9),
            lids: 0.3,
            brow: 0.2,
            crest: C(["plume", "antennae", "none"]),
            crestSize: R(1, 1.5),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 1,
              from: 0.42,
              style: "bird",
              splay: R(3, 6),
              end: C(["talons", "paddle"]),
              girth: R(0.5, 0.6),
              muscle: 1.3,
            },
          ],
          tail: P(0.5) ? { kind: "stub", length: 0.2, lift: R(10, 30) } : none,
          back: none,
          details: [],
          skin: skinOf(["Spots", "Countershade", "Bands"], { socks: R(0.6, 0.9) }),
        };
      }
      const girth = R(0.18, 0.22),
        length = R(0.62, 0.78);
      const limbs: RawLimb[] = [
        {
          kind: "leg",
          pairs: 1,
          from: 0.36,
          style: "bird",
          splay: R(3, 6),
          end: C(["paddle", "talons", "paddle"]),
          girth: R(0.6, 0.72),
          muscle: 1.4,
        },
      ];
      if (P(0.7)) limbs.push(folded());
      return {
        spine: {
          length,
          girth,
          rear: R(2, 10),
          front: R(20, 32),
          arch: R(4, 8),
          stance: R(0.85, 1.05),
          profile: "pear",
          bulge: [1, 1.15, 1.1, 0.95, 0.8],
        },
        head: {
          neck: R(0.5, 0.75),
          neckPitch: R(60, 72),
          neckGirth: R(0.6, 0.75),
          size: R(1.35, 1.65),
          shape: C(["long", "round"]),
          snout: C(["bill", "bill", "beak"]),
          snoutLength: R(1.4, 1.9),
          eyes: 2,
          eyePlace: "side",
          eyeSize: R(1.1, 1.4),
          lids: 0.2,
          brow: 0.3,
          crest: C(["plume", "crown", "none", "fan"]),
          crestSize: R(0.9, 1.4),
          turn: look(),
        },
        limbs,
        tail: { kind: C(["fluke", "fluke", "stub"]), length: R(0.22, 0.32), lift: R(5, 14) },
        back: none,
        details: some(["dewlap"], 1),
        skin: skinOf(["Countershade", "Bands"], { socks: R(0.6, 0.9) }),
      };
    },
    hopper() {
      if (kin === "kanga") {
        const girth = R(0.22, 0.27),
          length = R(0.66, 0.8);
        return {
          spine: {
            length,
            girth,
            rear: R(44, 56),
            front: R(58, 72),
            arch: R(2, 8),
            stance: R(0.6, 0.76),
            profile: "pear",
            bulge: [1.2, 1.18, 1, 0.9, 0.84],
          },
          head: {
            neck: R(0.12, 0.22),
            neckPitch: R(50, 68),
            neckGirth: R(0.8, 0.92),
            size: R(1.2, 1.45),
            shape: "long",
            snout: "muzzle",
            snoutLength: R(0.9, 1.2),
            jaw: 0.08,
            eyes: 2,
            eyePlace: "side",
            eyeSize: R(1.3, 1.7),
            lids: R(0.3, 0.45),
            brow: 0.3,
            crest: "ears",
            crestSize: R(1.7, 2.3),
            whiskers: P(0.4),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 1,
              from: 0.12,
              style: "mammal",
              splay: R(6, 10),
              end: "paw",
              digits: 3,
              girth: R(1.4, 1.7),
              muscle: 1.45,
            },
            {
              kind: "arm",
              pairs: 1,
              from: 0.8,
              length: R(0.26, 0.36),
              drop: R(50, 66),
              forward: R(25, 40),
              elbow: R(50, 75),
              end: "hand",
              digits: 3,
              girth: 0.62,
              hand: 1,
              raise: either(R(0, 30)),
            },
          ],
          tail: {
            kind: "taper",
            length: R(0.9, 1.15),
            girth: R(1.3, 1.55),
            lift: R(-30, -14),
            sway: sway(),
          },
          back: none,
          details: some(["dewlap", "cheek frills"], 1),
          skin: skinOf(["Countershade", "Bands", "Spots"]),
        };
      }
      if (kin === "frog") {
        const girth = R(0.27, 0.33),
          length = R(0.48, 0.6);
        return {
          spine: {
            length,
            girth,
            flat: R(1.25, 1.45),
            rear: R(16, 28),
            front: R(34, 48),
            arch: R(2, 8),
            stance: R(0.3, 0.4),
            profile: "pear",
            bulge: [1.1, 1.16, 1.08, 1, 0.96],
          },
          head: {
            neck: 0.03,
            neckPitch: R(20, 36),
            neckGirth: 1.2,
            size: R(1.4, 1.7),
            shape: C(["wide", "flat"]),
            snout: "muzzle",
            snoutLength: R(0.4, 0.55),
            jaw: R(0.1, 0.3),
            teeth: 0,
            eyes: 2,
            eyePlace: "top",
            eyeSize: R(1.7, 2.2),
            lids: R(0.3, 0.5),
            brow: 0.1,
            crest: "none",
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 1,
              from: 0.14,
              style: "mammal",
              splay: R(22, 30),
              end: "paddle",
              digits: 3,
              girth: R(1.15, 1.4),
              muscle: 1.4,
            },
            {
              kind: "arm",
              pairs: 1,
              from: 0.78,
              length: R(0.3, 0.4),
              drop: R(68, 80),
              forward: R(18, 30),
              elbow: R(30, 50),
              end: "hand",
              digits: 3,
              girth: 0.8,
              hand: 1.15,
            },
          ],
          tail: none,
          back: P(0.4)
            ? growth("drum sacs", girth, I(1, 2))
            : P(0.3)
              ? { kind: "spikes", count: I(4, 6), height: R(0.03, 0.05) }
              : none,
          details: some(["dewlap"], 1),
          skin: skinOf(["Spots", "Marbled", "Rosettes", "Bands"]),
        };
      }
      if (kin === "owl") {
        const girth = R(0.25, 0.31),
          length = R(0.44, 0.56);
        return {
          spine: {
            length,
            girth,
            flat: R(0.95, 1.1),
            rear: R(72, 84),
            front: R(78, 90),
            arch: R(0, 6),
            stance: R(0.34, 0.46),
            profile: "barrel",
            bulge: [1, 1.12, 1.1, 1, 0.94],
          },
          head: {
            neck: R(0.03, 0.07),
            neckPitch: R(66, 82),
            size: R(1.45, 1.75),
            shape: C(["round", "wide"]),
            snout: "beak",
            snoutLength: R(0.45, 0.65),
            eyes: 2,
            eyePlace: "front",
            eyeSize: R(1.9, 2.4),
            lids: R(0.3, 0.5),
            brow: R(0.5, 0.8),
            crest: C(["plume", "ears", "none"]),
            crestSize: R(0.9, 1.3),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 1,
              from: 0.12,
              style: "bird",
              splay: R(8, 12),
              end: "talons",
              digits: 3,
              girth: R(0.95, 1.15),
              muscle: 1.2,
            },
            folded(0.72),
          ],
          tail: { kind: "fluke", length: R(0.2, 0.3), lift: R(-30, -5) },
          back: none,
          details: some(["brow horns", "cheek frills"], 1),
          skin: skinOf(["Spots", "Bands", "Countershade"]),
        };
      }
      const girth = R(0.24, 0.32),
        length = R(0.42, 0.6);
      const limbs: RawLimb[] = [
        {
          kind: "leg",
          pairs: 1,
          from: 0.1,
          style: C(["bird", "mammal", "mammal"]),
          splay: R(6, 12),
          end: C(["paw", "paddle", "pad"]),
          digits: 3,
          girth: R(0.95, 1.25),
          muscle: 1.2,
        },
      ];
      if (P(0.55))
        limbs.push({
          kind: "arm",
          pairs: 1,
          from: 0.8,
          length: R(0.22, 0.34),
          drop: R(45, 65),
          forward: R(25, 45),
          elbow: R(40, 70),
          end: "hand",
          digits: I(2, 3),
          girth: 0.62,
          hand: 1.1,
          raise: either(R(15, 45)),
        });
      return {
        spine: {
          length,
          girth,
          flat: R(0.95, 1.15),
          rear: R(70, 86),
          front: R(76, 90),
          arch: R(0, 6),
          stance: R(0.36, 0.55),
          profile: C(["barrel", "pear"]),
          bulge: [1.05, 1.1, 1.05, 0.95, 0.9],
        },
        head: {
          neck: R(0.03, 0.08),
          neckPitch: R(62, 82),
          size: R(1.4, 1.8),
          shape: C(["round", "round", "wide"]),
          snout: C(["none", "muzzle", "bill"]),
          snoutLength: R(0.5, 0.8),
          jaw: R(0.08, 0.3),
          teeth: I(0, 2),
          eyes: C([2, 2, 2, 1, 3]),
          eyePlace: "front",
          eyeSize: R(1.6, 2.2),
          stalks: P(0.3) ? R(0.12, 0.28) : 0,
          lids: R(0.3, 0.5),
          brow: R(0.1, 0.4),
          crest: C(["antennae", "nubs", "none", "spire", "ears"]),
          crestSize: R(1, 1.6),
          whiskers: P(0.3),
          turn: look(),
        },
        limbs,
        tail: {
          kind: C(["stub", "none", "taper", "taper"]),
          length: R(0.2, 0.4),
          lift: R(-20, 30),
          sway: sway(),
        },
        back: P(0.32)
          ? growth("drum sacs", girth, 1)
          : P(0.25)
            ? { kind: "fins", count: I(3, 5), height: R(0.08, 0.14) }
            : none,
        details: some(["dewlap", "cheek frills"], 1),
        skin: skinOf(["Spots", "Rosettes", "Marbled", "Countershade"]),
      };
    },
    skitter() {
      const mask = (extra: RawHead): RawHead => ({
        neck: 0.05,
        neckPitch: R(4, 14),
        size: R(1.2, 1.5),
        shape: "wide",
        snout: "mandibles",
        eyes: C([2, 4, 6, 8]),
        eyePlace: C(["front", "side"]),
        eyeSize: R(1.1, 1.5),
        lids: 0,
        brow: 0,
        crest: "antennae",
        crestSize: R(0.9, 1.4),
        turn: look(),
        ...extra,
      });
      if (kin === "beetle") {
        const girth = R(0.27, 0.33),
          length = R(0.7, 0.86);
        return {
          spine: {
            length,
            girth,
            flat: R(1.1, 1.25),
            front: R(0, 8),
            arch: R(8, 14),
            stance: R(0.3, 0.38),
            profile: "barrel",
            bulge: [1, 1.2, 1.22, 1.02, 0.84],
          },
          head: mask({
            size: R(1.05, 1.3),
            eyes: 2,
            eyePlace: "side",
            crest: C(["spire", "spire", "lyre", "antlers"]),
            crestSize: R(1.6, 2.3),
          }),
          limbs: [
            {
              kind: "leg",
              pairs: 3,
              from: 0.24,
              to: 0.78,
              style: "insect",
              splay: R(40, 50),
              fan: R(50, 75),
              end: "point",
              girth: R(1, 1.2),
              muscle: 1.2,
            },
          ],
          tail: none,
          back: P(0.6)
            ? growth("shingles", girth, I(4, 6))
            : { kind: "plates", count: I(5, 7), height: R(0.04, 0.07) },
          details: [],
          skin: skinOf(["Spots", "Bands", "Marbled"]),
        };
      }
      if (kin === "centipede") {
        const girth = R(0.13, 0.16),
          length = R(1.7, 2.1);
        return {
          spine: {
            length,
            girth,
            flat: R(1.3, 1.5),
            front: R(8, 22),
            arch: R(-4, 4),
            stance: R(0.22, 0.3),
            profile: "tube",
            bulge: [0.9, 1.02, 0.94, 1.02, 0.98],
          },
          head: mask({ size: R(1.35, 1.6), crestSize: R(1.4, 2) }),
          limbs: [
            {
              kind: "leg",
              pairs: 6,
              from: 0.06,
              to: 0.9,
              style: "insect",
              splay: R(48, 58),
              fan: R(20, 40),
              end: "point",
              girth: R(0.7, 0.85),
              muscle: 1,
            },
          ],
          tail: { kind: C(["stinger", "taper"]), length: R(0.3, 0.5), sway: sway() * 0.5 },
          back: { kind: "plates", count: I(9, 12), height: R(0.025, 0.045) },
          details: [],
          skin: skinOf(["Bands", "Bands", "Countershade"]),
        };
      }
      if (kin === "spider") {
        const girth = R(0.2, 0.25),
          length = R(0.7, 0.86);
        return {
          spine: {
            length,
            girth,
            flat: R(1.05, 1.2),
            front: R(0, 10),
            arch: R(4, 10),
            stance: R(0.46, 0.6),
            profile: "wasp",
            bulge: [1.5, 1.5, 0.8, 1, 0.9],
          },
          head: mask({
            size: R(1, 1.25),
            eyes: C([6, 8, 8]),
            eyePlace: "front",
            eyeSize: R(1.1, 1.4),
            crest: "none",
          }),
          limbs: [
            {
              kind: "leg",
              pairs: 4,
              from: 0.56,
              to: 0.86,
              style: "insect",
              splay: R(52, 62),
              fan: R(110, 140),
              end: "point",
              girth: R(0.8, 0.95),
              muscle: 1.1,
            },
          ],
          tail: none,
          back: P(0.4) ? { kind: "spikes", count: I(3, 5), height: R(0.04, 0.07) } : none,
          details: [],
          skin: skinOf(["Spots", "Bands", "Rosettes", "Marbled"]),
        };
      }
      if (kin === "crab") {
        const girth = R(0.26, 0.32),
          length = R(0.5, 0.62);
        return {
          spine: {
            length,
            girth,
            flat: R(1.6, 1.95),
            front: R(4, 14),
            arch: R(2, 8),
            stance: R(0.32, 0.42),
            profile: "barrel",
            bulge: [0.96, 1.12, 1.14, 1.06, 0.96],
          },
          head: mask({
            neck: 0.03,
            size: R(0.8, 1),
            snout: C(["mandibles", "none"]),
            eyes: 2,
            eyePlace: "top",
            eyeSize: R(1.3, 1.7),
            stalks: R(0.2, 0.32),
            crest: "none",
          }),
          limbs: [
            {
              kind: "leg",
              pairs: I(3, 4),
              from: 0.16,
              to: 0.74,
              style: "insect",
              splay: R(54, 64),
              fan: R(60, 90),
              end: "point",
              girth: R(0.85, 1.05),
              muscle: 1.2,
            },
            {
              kind: "arm",
              pairs: 1,
              from: 0.86,
              length: R(0.5, 0.64),
              drop: R(4, 16),
              forward: R(30, 46),
              elbow: R(70, 95),
              end: "pincer",
              hand: R(1.6, 2.1),
              girth: 1.2,
              muscle: 1.4,
              raise: either(R(10, 35)),
            },
          ],
          tail: none,
          back: P(0.5) ? { kind: "spikes", count: I(3, 5), height: R(0.03, 0.06) } : none,
          details: [],
          skin: skinOf(["Spots", "Marbled", "Countershade"]),
        };
      }
      const girth = R(0.17, 0.22),
        length = R(0.95, 1.2);
      return {
        spine: {
          length,
          girth,
          flat: R(1.2, 1.45),
          front: R(2, 8),
          arch: R(1, 5),
          stance: R(0.26, 0.36),
          profile: C(["tube", "wasp", "pear"]),
          bulge: [0.9, 1.3, 0.76, 1.12, 0.96],
        },
        head: mask({}),
        limbs: [
          {
            kind: "leg",
            pairs: P(0.2) ? 4 : 3,
            from: 0.34,
            to: 0.82,
            style: "insect",
            splay: R(46, 56),
            fan: R(60, 90),
            end: "point",
            girth: R(0.85, 1.05),
            muscle: 1.2,
          },
          {
            kind: "arm",
            pairs: 1,
            from: 0.9,
            length: R(0.45, 0.6),
            drop: R(8, 20),
            forward: R(40, 56),
            elbow: R(50, 70),
            end: "pincer",
            hand: R(1.2, 1.5),
            girth: 1.1,
            muscle: 1.3,
            raise: either(R(0, 22)),
          },
        ],
        tail: { kind: "stinger", length: R(0.7, 1), lift: R(40, 75), sway: sway() * 0.5 },
        back: P(0.4)
          ? growth("shingles", girth, I(4, 6))
          : { kind: C(["plates", "spikes"]), count: I(5, 7), height: R(0.04, 0.07) },
        details: [],
        skin: skinOf(["Bands", "Bands", "Reticulated"]),
      };
    },
    mantis() {
      const girth = R(0.18, 0.23),
        length = R(1.05, 1.3);
      if (kin === "hexataur") {
        const g = R(0.22, 0.27);
        return {
          spine: {
            length: R(1.2, 1.4),
            girth: g,
            rear: R(-2, 4),
            front: R(74, 86),
            arch: 0,
            stance: R(0.5, 0.64),
            profile: "tube",
            bulge: [1.2, 1.4, 1.1, 0.84, 1],
          },
          head: {
            neck: R(0.08, 0.16),
            neckPitch: R(60, 74),
            size: R(1.3, 1.55),
            shape: C(["wide", "long"]),
            snout: C(["muzzle", "beak"]),
            snoutLength: R(0.7, 1.1),
            jaw: R(0.1, 0.3),
            teeth: I(0, 3),
            eyes: C([2, 2, 4]),
            eyePlace: "front",
            eyeSize: R(1.05, 1.4),
            lids: 0.3,
            brow: R(0.5, 0.8),
            crest: C(["ram", "antlers", "lyre", "spire"]),
            crestSize: R(1.1, 1.6),
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: 3,
              from: 0.05,
              to: 0.64,
              style: C(["pillar", "mammal"]),
              splay: R(6, 12),
              end: C(["pad", "hoof"]),
              girth: R(0.78, 0.9),
              muscle: 1.2,
            },
            {
              kind: "arm",
              pairs: 1,
              from: 0.86,
              length: R(0.6, 0.78),
              drop: R(54, 68),
              forward: R(16, 30),
              elbow: R(30, 55),
              end: "hand",
              digits: 3,
              girth: 1.05,
              muscle: 1.3,
              raise: either(R(10, 45)),
            },
          ],
          tail: {
            kind: C(["club", "taper", "stub"]),
            length: R(0.35, 0.6),
            lift: R(-10, 20),
            sway: sway(),
          },
          back: P(0.5)
            ? { kind: C(["plates", "spikes"]), count: I(4, 6), height: R(0.06, 0.1) }
            : none,
          details: some(["beard", "tusks", "shoulder spikes"], 1),
          skin: skinOf(["Bands", "Spots", "Countershade"]),
        };
      }
      const centaur = kin === "centaur";
      return {
        spine: {
          length,
          girth,
          rear: R(0, 6),
          front: R(70, 84),
          arch: 0,
          stance: centaur ? R(0.55, 0.7) : R(0.42, 0.55),
          profile: "tube",
          bulge: [1.15, 1.36, 0.9, 0.8, 0.96],
        },
        head: centaur
          ? {
              neck: R(0.1, 0.2),
              neckPitch: R(58, 72),
              size: R(1.3, 1.6),
              shape: C(["round", "long", "wide"]),
              snout: C(["muzzle", "beak"]),
              snoutLength: R(0.7, 1.1),
              jaw: R(0.1, 0.3),
              teeth: I(0, 3),
              eyes: 2,
              eyePlace: "front",
              eyeSize: R(1.1, 1.5),
              lids: 0.3,
              brow: R(0.3, 0.7),
              crest: C(["antlers", "lyre", "ears", "fan", "nubs"]),
              crestSize: R(1, 1.5),
              turn: look(),
            }
          : {
              neck: R(0.08, 0.16),
              neckPitch: R(55, 68),
              size: R(1.25, 1.55),
              shape: "wide",
              snout: "mandibles",
              eyes: 2,
              eyePlace: "side",
              eyeSize: R(1.7, 2.1),
              lids: 0,
              brow: 0,
              crest: "antennae",
              crestSize: R(1, 1.4),
              turn: look(),
            },
        limbs: [
          centaur
            ? {
                kind: "leg",
                pairs: 2,
                from: 0.08,
                to: 0.5,
                style: C(["mammal", "bird"]),
                splay: R(6, 12),
                end: C(["hoof", "paw", "pad"]),
                girth: R(0.85, 1),
                muscle: 1.2,
              }
            : {
                kind: "leg",
                pairs: 2,
                from: 0.08,
                to: 0.5,
                style: "insect",
                splay: R(40, 50),
                fan: R(40, 60),
                end: "point",
                muscle: 1.2,
              },
          {
            kind: "arm",
            pairs: P(0.25) ? 2 : 1,
            from: 0.66,
            to: 0.82,
            length: R(0.6, 0.82),
            drop: centaur ? R(50, 66) : R(25, 45),
            forward: centaur ? R(18, 34) : R(45, 65),
            elbow: centaur ? R(35, 60) : R(95, 125),
            end: centaur ? "hand" : C(["spike", "pincer"]),
            digits: 3,
            girth: 1.05,
            muscle: 1.3,
            raise: either(R(8, 40)),
          },
        ],
        tail: {
          kind: C(["stub", "taper", "taper"]),
          length: R(0.25, 0.55),
          lift: R(-10, 20),
          sway: sway(),
        },
        back: P(0.4) ? { kind: "plates", count: I(4, 6), height: R(0.06, 0.1) } : none,
        details: some(centaur ? ["spurs", "beard"] : ["spurs"], 1),
        skin: skinOf(["Bands", "Spots", "Countershade"]),
      };
    },
    strider() {
      if (kin === "tripod") {
        const girth = R(0.2, 0.24);
        const limbs: RawLimb[] = [
          {
            kind: "leg",
            pairs: C([2, 2, 3]),
            from: 0,
            to: 0.12,
            style: "insect",
            splay: R(24, 34),
            fan: R(150, 180),
            end: "point",
            girth: R(0.8, 0.95),
          },
        ];
        if (P(0.6))
          limbs.push({
            kind: "tentacle",
            pairs: 1,
            from: 0.7,
            to: 0.7,
            length: R(0.4, 0.6),
            droop: R(30, 60),
            forward: R(20, 45),
            curl: R(0.4, 0.8),
            girth: 0.5,
          });
        return {
          spine: {
            length: R(0.4, 0.5),
            girth,
            rear: R(84, 88),
            front: R(82, 90),
            arch: R(0, 4),
            stance: R(0.68, 0.9),
            profile: "barrel",
          },
          head: {
            neck: R(0.03, 0.08),
            neckPitch: R(66, 82),
            size: R(1.55, 1.9),
            shape: C(["round", "wide"]),
            snout: C(["none", "beak"]),
            snoutLength: R(0.5, 0.8),
            eyes: C([1, 1, 3]),
            eyePlace: "front",
            eyeSize: R(1.8, 2.4),
            lids: R(0.2, 0.4),
            brow: 0.2,
            crest: C(["antennae", "none", "spire", "fan"]),
            crestSize: R(1, 1.5),
            turn: look(),
          },
          limbs,
          tail: none,
          back: none,
          details: [],
          skin: skinOf(["Bands", "Spots", "Countershade"]),
        };
      }
      if (kin === "squat") {
        const girth = R(0.28, 0.34);
        return {
          spine: {
            length: R(0.42, 0.52),
            girth,
            flat: R(1.3, 1.5),
            rear: R(84, 88),
            front: R(80, 88),
            arch: R(0, 4),
            stance: R(0.24, 0.32),
            profile: "barrel",
          },
          head: {
            neck: 0.03,
            neckPitch: R(60, 76),
            neckGirth: 1.2,
            size: R(1.2, 1.45),
            shape: C(["wide", "flat"]),
            snout: "muzzle",
            snoutLength: R(0.5, 0.75),
            jaw: R(0.3, 0.55),
            teeth: I(2, 5),
            eyes: C([2, 2, 4]),
            eyePlace: "top",
            eyeSize: R(1.3, 1.7),
            stalks: R(0.16, 0.3),
            lids: R(0.2, 0.4),
            brow: 0.2,
            crest: "none",
            turn: look(),
          },
          limbs: [
            {
              kind: "leg",
              pairs: I(4, 5),
              from: 0,
              to: 0.14,
              style: "insect",
              splay: R(40, 50),
              fan: R(150, 180),
              end: "pad",
              girth: R(0.95, 1.1),
            },
            {
              kind: "arm",
              pairs: 1,
              from: 0.8,
              length: R(0.42, 0.54),
              drop: R(30, 46),
              forward: R(26, 40),
              elbow: R(50, 75),
              end: "pincer",
              hand: R(1.1, 1.4),
              girth: 0.95,
              raise: either(R(10, 35)),
            },
          ],
          tail: none,
          back: P(0.5) ? { kind: "spikes", count: I(3, 5), height: R(0.04, 0.07) } : none,
          details: [],
          skin: skinOf(["Spots", "Marbled", "Rosettes"]),
        };
      }
      const girth = R(0.18, 0.23);
      const limbs: RawLimb[] = [
        {
          kind: "leg",
          pairs: I(3, 5),
          from: 0,
          to: 0.14,
          style: "insect",
          splay: R(34, 46),
          fan: R(140, 180),
          end: C(["point", "pad"]),
          girth: R(0.8, 0.95),
        },
      ];
      if (P(0.65))
        limbs.push({
          kind: "arm",
          pairs: 1,
          from: 0.84,
          length: R(0.42, 0.56),
          drop: R(40, 58),
          forward: R(22, 36),
          elbow: R(40, 60),
          end: C(["hand", "pincer"]),
          digits: 3,
          hand: 0.85,
          girth: 0.85,
          raise: either(R(15, 45)),
        });
      return {
        spine: {
          length: R(0.55, 0.7),
          girth,
          rear: R(82, 88),
          front: R(78, 86),
          arch: R(0, 5),
          stance: R(0.3, 0.42),
          profile: C(["pear", "barrel"]),
        },
        head: {
          neck: R(0.06, 0.14),
          neckPitch: R(64, 78),
          size: R(1.3, 1.6),
          shape: C(["round", "wide"]),
          snout: C(["muzzle", "none", "beak"]),
          snoutLength: R(0.6, 0.9),
          jaw: R(0.1, 0.25),
          teeth: I(0, 2),
          eyes: C([2, 3, 4, 1]),
          eyePlace: "front",
          eyeSize: R(1.4, 1.9),
          stalks: P(0.3) ? R(0.12, 0.25) : 0,
          lids: R(0.3, 0.5),
          brow: 0.4,
          crest: C(["fan", "antennae", "nubs", "plume", "none"]),
          crestSize: R(1, 1.4),
          whiskers: P(0.4),
          turn: look(),
        },
        limbs,
        tail: none,
        back: none,
        details: some(["cheek frills", "beard"], 1),
        skin: skinOf(["Spots", "Rosettes", "Bands"]),
      };
    },
    drifter() {
      if (kin === "jelly") {
        return {
          spine: {
            length: R(0.34, 0.44),
            girth: R(0.2, 0.25),
            rear: 88,
            front: 90,
            arch: 0,
            stance: R(0.7, 0.95),
            profile: "pear",
          },
          head: {
            neck: 0.03,
            neckPitch: 88,
            size: R(1.7, 2.1),
            shape: C(["wide", "flat"]),
            snout: "none",
            mouth: false,
            eyes: C([2, 4, 3]),
            eyeSize: R(1, 1.3),
            eyePlace: "front",
            lids: 0,
            brow: 0,
            crest: C(["none", "fan", "nubs"]),
            crestSize: R(0.8, 1.2),
          },
          limbs: [
            {
              kind: "tentacle",
              pairs: I(4, 6),
              from: 0.1,
              to: 0.1,
              length: R(1, 1.35),
              droop: R(74, 86),
              fan: 160,
              curl: R(0.15, 0.4),
              girth: R(0.5, 0.66),
            },
            {
              kind: "tentacle",
              pairs: 1,
              from: 0.5,
              to: 0.5,
              length: R(0.5, 0.7),
              droop: R(40, 60),
              forward: R(30, 50),
              curl: R(0.6, 0.9),
              girth: 0.9,
            },
          ],
          tail: none,
          back: none,
          details: [],
          skin: skinOf(["Spots", "Marbled", "Bands"], { belly: R(0.4, 0.7) }),
        };
      }
      if (kin === "nautilus") {
        const girth = R(0.24, 0.3);
        return {
          spine: {
            length: R(0.5, 0.62),
            girth,
            rear: R(30, 50),
            front: R(60, 80),
            arch: R(4, 10),
            stance: R(0.5, 0.66),
            profile: "barrel",
          },
          head: {
            neck: 0.03,
            neckPitch: R(40, 60),
            size: R(1.1, 1.3),
            shape: "round",
            snout: C(["none", "beak"]),
            snoutLength: 0.5,
            mouth: false,
            eyes: 2,
            eyeSize: R(1.6, 2.1),
            eyePlace: "side",
            lids: 0,
            brow: 0,
            crest: "none",
          },
          limbs: [
            {
              kind: "tentacle",
              pairs: I(3, 4),
              from: 0.86,
              to: 0.86,
              length: R(0.45, 0.62),
              droop: R(24, 44),
              forward: R(40, 60),
              fan: 110,
              curl: R(0.4, 0.8),
              girth: R(0.8, 1),
            },
            {
              kind: "tentacle",
              pairs: 1,
              from: 0.7,
              to: 0.7,
              length: R(0.7, 0.9),
              droop: R(50, 66),
              forward: R(20, 40),
              curl: R(0.5, 0.9),
              girth: 0.6,
            },
          ],
          tail: none,
          back: {
            kind: "spiral shell",
            count: I(4, 6),
            height: girth * R(1, 1.25),
            spread: R(0.5, 0.9),
            seed: Math.floor(draw() * 4294967296),
          },
          details: [],
          skin: skinOf(["Bands", "Rosettes", "Marbled"], { belly: R(0.4, 0.7) }),
        };
      }
      return {
        spine: {
          length: R(0.48, 0.62),
          girth: R(0.22, 0.28),
          rear: 88,
          front: 90,
          arch: 0,
          stance: R(0.45, 0.6),
          profile: C(["barrel", "pear"]),
        },
        head: {
          neck: 0.03,
          neckPitch: 88,
          size: R(0.9, 1.15),
          shape: "round",
          snout: "none",
          mouth: false,
          eyes: C([1, 3, 3, 5]),
          eyeSize: R(1.3, 1.8),
          eyePlace: "front",
          stalks: R(0.15, 0.3),
          lids: 0,
          brow: 0,
          crest: "none",
        },
        limbs: [
          {
            kind: "tentacle",
            pairs: I(3, 5),
            from: 0.08,
            to: 0.08,
            length: R(0.8, 1.05),
            droop: R(55, 68),
            fan: 135,
            curl: R(0.3, 0.7),
            girth: R(1, 1.25),
          },
          {
            kind: "tentacle",
            pairs: 2,
            from: 0.55,
            to: 0.55,
            length: R(0.4, 0.56),
            droop: R(4, 16),
            forward: R(45, 60),
            fan: 60,
            curl: R(0.6, 0.9),
            girth: 0.6,
          },
        ],
        tail: none,
        back: P(0.3) ? { kind: "fins", count: I(3, 5), height: R(0.08, 0.14) } : none,
        details: [],
        skin: skinOf(["Rosettes", "Spots", "Marbled"], { belly: R(0.4, 0.7) }),
      };
    },
    swimmer() {
      if (kin === "ray") {
        const girth = R(0.18, 0.22),
          length = R(0.85, 1.05);
        return {
          spine: {
            length,
            girth,
            flat: R(1.8, 2.2),
            front: R(0, 6),
            arch: R(0, 4),
            stance: R(0.5, 0.7),
            profile: "wedge",
          },
          head: {
            neck: 0.03,
            neckPitch: R(0, 6),
            size: R(1.05, 1.25),
            shape: "flat",
            snout: "muzzle",
            snoutLength: R(0.6, 0.9),
            jaw: 0.1,
            eyes: 2,
            eyePlace: "top",
            eyeSize: R(1.1, 1.4),
            lids: 0,
            brow: 0.3,
            crest: C(["none", "nubs"]),
            crestSize: 1,
          },
          limbs: [
            {
              kind: "fin",
              pairs: 1,
              from: 0.56,
              length: R(0.62, 0.82),
              sweep: R(14, 26),
              chord: R(0.5, 0.66),
            },
          ],
          tail: {
            kind: C(["stinger", "taper"]),
            length: R(1, 1.4) * length,
            girth: R(0.5, 0.66),
            sway: sway() * 0.6,
          },
          back: P(0.55)
            ? growth("gill fans", girth, I(2, 3))
            : P(0.5)
              ? { kind: "spikes", count: I(4, 7), height: R(0.03, 0.06) }
              : none,
          details: [],
          skin: skinOf(["Spots", "Countershade", "Rosettes"], { belly: 1 }),
        };
      }
      if (kin === "angler") {
        const girth = R(0.32, 0.38),
          length = R(0.8, 1);
        return {
          spine: {
            length,
            girth,
            flat: R(0.85, 1),
            front: R(0, 6),
            arch: R(2, 8),
            stance: R(0.5, 0.7),
            profile: "wedge",
            bulge: [0.8, 0.9, 1.05, 1.2, 1.1],
          },
          head: {
            neck: 0.03,
            neckPitch: R(0, 8),
            size: R(1.35, 1.6),
            shape: "wide",
            snout: "muzzle",
            snoutLength: R(0.6, 0.85),
            jaw: R(0.55, 0.85),
            teeth: 6,
            eyes: 2,
            eyePlace: "front",
            eyeSize: R(1, 1.2),
            lids: 0,
            brow: 0.5,
            crest: "spire",
            crestSize: R(0.9, 1.3),
            whiskers: P(0.4),
          },
          limbs: [
            {
              kind: "fin",
              pairs: 1,
              from: 0.6,
              length: R(0.24, 0.32),
              sweep: R(30, 44),
              chord: R(0.16, 0.22),
            },
          ],
          tail: { kind: "fan", length: R(0.34, 0.46), girth: R(1.1, 1.4), sway: sway() * 0.6 },
          back: P(0.5)
            ? growth("gill fans", girth, I(2, 3))
            : { kind: C(["fins", "spikes"]), count: I(4, 6), height: R(0.1, 0.16) },
          details: some(["beard", "cheek frills"], 1),
          skin: skinOf(["Marbled", "Spots", "Countershade"], { belly: 1 }),
        };
      }
      const eel = kin === "eel",
        girth = eel ? R(0.15, 0.19) : R(0.2, 0.26),
        length = eel ? R(1.5, 1.9) : R(1.15, 1.5);
      return {
        spine: {
          length,
          girth,
          flat: R(0.74, 0.9),
          front: R(0, 6),
          arch: R(0, 4),
          stance: R(0.5, 0.7),
          profile: eel ? "tube" : "wedge",
        },
        head: {
          neck: 0.05,
          neckPitch: R(2, 8),
          size: eel ? R(1.3, 1.6) : R(1.1, 1.35),
          shape: C(["long", "flat"]),
          snout: C(["muzzle", "muzzle", "bill"]),
          snoutLength: R(1.2, 1.6),
          jaw: R(0.2, 0.45),
          teeth: I(3, 6),
          eyes: 2,
          eyePlace: "side",
          eyeSize: R(1.1, 1.5),
          lids: 0,
          brow: 0.2,
          crest: eel ? C(["none", "fan"]) : "none",
          crestSize: 0.9,
          whiskers: P(0.3),
        },
        limbs: [
          {
            kind: "fin",
            pairs: 1,
            from: 0.72,
            length: R(0.34, 0.46),
            sweep: R(34, 46),
            chord: R(0.18, 0.24),
          },
          { kind: "fin", pairs: 1, from: 0.3, length: R(0.2, 0.28), sweep: R(44, 55), chord: 0.14 },
        ],
        tail: {
          kind: C(["fan", "fluke"]),
          length: R(0.42, 0.55),
          girth: R(1.4, 1.8),
          sway: sway() * 0.6,
        },
        back: P(0.7)
          ? growth("gill fans", girth, I(2, 3))
          : { kind: C(["sail", "fins"]), count: I(4, 7), height: R(0.16, 0.28) },
        details: [],
        skin: skinOf(["Bands", "Countershade", "Spots"], { belly: 1 }),
      };
    },
  };
  if (family === "wild")
    return {
      family,
      kin,
      biome,
      plan: null,
      skin: skinOf(["Bands", "Spots", "Rosettes", "Countershade", "Reticulated", "Marbled"]),
      dressOdds: need(dressOdds["wild"]),
      kitOdds: 0.72,
      draw,
    };
  const plan = need(families[family])();
  const head = (plan.head ??= {}),
    spine = (plan.spine ??= {}),
    skin = (plan.skin ??= {}),
    limbs: RawLimb[] = [...(plan.limbs ?? [])];
  plan.limbs = limbs;
  const faceDraw = randomStream(seed ^ 0x65c3a9b1);
  const faceStyles: Record<string, string[]> = {
    glider: ["Facial disc", "Eye stripe"],
    wader: ["Cheek flashes", "Eye stripe"],
    grazer: ["Forehead blaze", "Eye stripe"],
    stalker: ["Eye stripe", "Facial disc"],
    hopper: ["Facial disc", "Cheek flashes"],
    swimmer: ["Cheek flashes", "Eye stripe"],
    envoy: ["Facial disc", "Forehead blaze"],
    brute: ["Forehead blaze", "Cheek flashes"],
    strider: ["Eye stripe", "Cheek flashes"],
  };
  const faceStyle = faceStyles[family];
  if (faceStyle && faceDraw() < 0.67)
    skin.faceMarking = need(faceStyle[Math.floor(faceDraw() * faceStyle.length)]);
  const plume = randomStream(seed ^ 0x5ac10a17);
  if (["bird", "heron", "runner", "stilt", "terror bird"].includes(kin) && plume() < 0.83) {
    plan.back = {
      kind: "contour plumage",
      count: 3 + Math.floor(plume() * 3),
      height: need(spine.girth) * (0.61 + 0.43 * plume()),
      spread: 0.52 + 0.42 * plume(),
      seed: Math.floor(plume() * 4294967296),
    };
  }
  for (const limb of limbs) if (limb.style === "insect") limb.sockets = true;
  if (["beak", "bill"].includes(head.snout ?? "")) {
    const feeding: Record<string, string> = {
      heron: "spear",
      runner: "scythe",
      stilt: "spoon",
      longneck: "spear",
      tortoise: "shear",
      ankylo: "shear",
      ceratops: "crusher",
      rhino: "shear",
      "terror bird": "crusher",
      bird: "spear",
      bat: "scythe",
      avian: "crusher",
      sprite: "scythe",
      nautilus: "crusher",
      ray: "spoon",
    };
    const variants =
      head.snout === "bill"
        ? ["spoon", "spear", "shear"]
        : ["crusher", "spear", "original", "scythe"];
    const pick =
      feeding[kin] ??
      need(variants[Math.floor(randomStream(seed ^ 0x61294bf)() * variants.length)]);
    if (pick !== "original") head.billProfile = pick;
  }
  if (head.snout === "muzzle") {
    const muzzle: Record<string, string> = {
      cat: "feline",
      scholar: "feline",
      sprite: "feline",
      puff: "feline",
      merchant: "rooting",
      boar: "rooting",
      bear: "canine",
      kanga: "grazing",
      antelope: "grazing",
      bison: "grazing",
      browser: "grazing",
      hound: "canine",
      ogre: "rooting",
      centaur: "grazing",
    };
    const profile = muzzle[kin];
    if (profile) head.muzzleProfile = profile;
  }
  if (head.crest === "ears") {
    const pinna: Record<string, string> = {
      kanga: "lance",
      antelope: "lance",
      scholar: "lance",
      cat: "tufted",
      sprite: "tufted",
      boar: "tufted",
      bat: "fan",
      ogre: "fan",
      bison: "swept",
      browser: "swept",
      merchant: "lop",
      puff: "lop",
      bear: "original",
    };
    const options = ["swept", "tufted", "lance", "lop", "fan"];
    head.ear =
      pinna[kin] ?? need(options[Math.floor(randomStream(seed ^ 0x674883b9)() * options.length)]);
  }
  const scale = R(0.78, 1.22);
  plan.scale ??= scale;

  if (P(0.22)) {
    const legged = limbs.some((l) => l.kind === "leg"),
      flies = limbs.some((l) => l.kind === "wing");
    const oddities = ["eyes", "stalks", "heads", "feelers"];
    if (legged && !flies && family !== "tank") oddities.push("wings");
    if (limbs.some((l) => l.kind === "arm" && l.pairs === 1) && family === "envoy")
      oddities.push("arms");
    const odd = C(oddities);
    const neck = need(head.neck);
    if (odd === "eyes") head.eyes = C([1, 3, 4, 5, 6]);
    else if (odd === "stalks") head.stalks = R(0.14, 0.3);
    else if (odd === "heads" && neck > 0.1 && neck < 0.7) {
      head.count = 2;
      head.size = need(head.size) * 0.84;
      head.turn = 0;
    } else if (odd === "feelers")
      limbs.push({
        kind: "tentacle",
        pairs: 1,
        from: 0.9,
        to: 0.9,
        length: R(0.3, 0.5),
        droop: R(10, 50),
        forward: R(20, 50),
        curl: R(0.3, 0.8),
        girth: 0.5,
      });
    else if (odd === "wings")
      limbs.push({
        kind: "wing",
        pairs: 1,
        from: 0.68,
        length: R(0.5, 0.8) * need(spine.length),
        rise: R(20, 45),
        sweep: R(15, 35),
        chord: R(0.2, 0.32),
      });
    else if (odd === "arms") {
      const arm = need(limbs.find((l) => l.kind === "arm"));
      arm.pairs = 2;
      arm.from = 0.56;
      arm.to = 0.9;
    }
  }
  const shellRoll = randomStream((seed ^ 0x103c9e7a) >>> 0);
  const shellOdds: Record<string, number> = {
    tortoise: 0.25,
    ankylo: 0.12,
    scorpion: 0.2,
    crab: 0.45,
    octopus: 0.5,
  };
  const chance = shellOdds[kin] ?? 0;
  if (shellRoll() < chance && !limbs.some((l) => l.kind === "wing")) {
    plan.back = {
      kind: "spiral shell",
      count: 3 + Math.floor(shellRoll() * 4),
      height: need(spine.girth) * (0.72 + 0.48 * shellRoll()),
      spread: 0.34 + 0.6 * shellRoll(),
      seed: Math.floor(shellRoll() * 4294967296),
    };
  }
  const kinDress: Record<string, number> = {
    lurker: 0.08,
    cat: 0.2,
    tortoise: 0.12,
    centipede: 0,
    spider: 0.05,
    crab: 0.05,
    beetle: 0.1,
    moth: 0.08,
    dragonfly: 0.08,
    tripod: 0.1,
    frog: 0.2,
  };
  return {
    family,
    kin,
    biome,
    plan,
    dressOdds: kinDress[kin] ?? need(dressOdds[family]),
    kitOdds: kitOdds[family] ?? 0.72,
    draw,
  };
}
