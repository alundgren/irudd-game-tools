// The seeded sequence of character-view/random.js at 2761eb1, so seeded
// geometry and swatches draw the same numbers.

/** A deterministic stream of numbers in [0, 1) from a 32-bit seed. */
export function randomStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
