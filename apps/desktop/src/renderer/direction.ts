import {
  drawDecks,
  encodeDecks,
  decodeDecks,
  type Deck,
  type PinnedDeck,
  type DrawnDeck,
} from "./choice-decks.js";
export const strengths = ["subtle", "exploratory", "radical"] as const;
export type Strength = (typeof strengths)[number];
export interface Direction {
  strength: Strength;
  seed: number;
  cues: string[];
  magnitude: number;
  decks: DrawnDeck[];
  pins: (number | null)[];
}
const ideas = {
  subtle: [
    [
      "Round a contour",
      "Sharpen one transition",
      "Taper the extremities",
      "Soften one joint",
      "Exaggerate a single landmark",
    ],
    [
      "Shift weight forward",
      "Echo an existing curve",
      "Move one accent off-center",
      "Make the silhouette more compact",
      "Lengthen an exposed edge",
    ],
  ],
  exploratory: [
    [
      "Repeat a feature in graduated sizes",
      "Change the carrying posture",
      "Move the center of mass",
      "Branch one attachment",
      "Introduce a contrasting silhouette",
    ],
    [
      "Low and wide",
      "Tall and narrow",
      "Swept backward",
      "Offset asymmetry",
      "Long arcs with short terminals",
      "Heavy core and delicate extremities",
    ],
  ],
  radical: [
    [
      "Change the locomotor plan",
      "Redistribute sensory organs",
      "Branch the spine or tail",
      "Transform a limb into another functional structure",
      "Split a major body region",
      "Move from upright to horizontal",
    ],
    [
      "Bilateral repeating segments",
      "Radial fan",
      "Unequal limbs that balance the body",
      "Concentric shells",
      "Tapered suspended volumes",
      "Overlapping interlocking outer plates",
    ],
  ],
};
export function drawVariation(
  strength: Strength = "exploratory",
  seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
) {
  if (!Object.hasOwn(ideas, strength)) throw new Error("Unknown variation range.");
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    strength,
    seed: seed >>> 0,
    cues: ideas[strength].map((deck) => deck[Math.floor(next() * deck.length)] ?? ""),
    magnitude: Math.round(20 + next() * 65),
  };
}

interface Prior {
  strength: Strength;
  pins: readonly (number | null)[];
  decks: readonly PinnedDeck[];
}
export function redrawDirection(
  previous: Prior | undefined,
  strength: Strength,
  seed?: number,
  definitions: readonly Deck[] = previous?.decks ?? [],
): Direction {
  const fresh = drawVariation(strength, seed);
  const pins = fresh.cues.map((_, i) =>
    previous?.strength === strength ? (previous.pins[i] ?? null) : null,
  );
  return {
    ...fresh,
    pins,
    decks: drawDecks(definitions, fresh.seed, previous?.decks),
    cues: fresh.cues.map((cue, i) => {
      const pin = pins[i];
      return pin == null ? cue : (drawVariation(strength, pin).cues[i] ?? cue);
    }),
  };
}
export function directionCode(variation: Direction) {
  const pins = variation.pins;
  return (
    [
      variation.strength,
      variation.seed.toString(36),
      ...(pins.some((v) => v !== null) ? pins.map((v) => (v === null ? "_" : v.toString(36))) : []),
    ].join("/") + (variation.decks.length ? "~" + encodeDecks(variation.decks) : "")
  );
}
export function replayDirection(code: string) {
  const [base, decksToken, ...excess] = code.trim().split("~");
  if (excess.length) throw new Error("Enter a saved direction code.");
  const decks = decksToken === undefined ? [] : decodeDecks(decksToken);
  const [name, draw, ...locked] = (base ?? "").toLowerCase().split("/");
  const strength = strengths.find((value) => value === name);
  function seed(s: string) {
    if (!/^[0-9a-z]{1,7}$/.test(s) || Number.parseInt(s, 36) > 0xffffffff)
      throw new Error("Enter a saved direction code.");
    return Number.parseInt(s, 36);
  }
  if (!strength || !draw || (locked.length && locked.length !== ideas[strength].length))
    throw new Error("Enter a saved direction code.");
  return redrawDirection(
    { strength, decks, pins: locked.map((s) => (s === "_" ? null : seed(s))) },
    strength,
    seed(draw),
  );
}
