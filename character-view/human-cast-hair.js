// Hair cards of the cast. The source library draws each card one-sided and so carries every card twice: a front and
// a back copy in the same place, with the same picture. Drawn two-sided and cut out, as the cast is, the two copies
// stand in each other's way at the same depth, and the hair breaks into hatched blocks along the cards' straight
// edges. One copy of each is enough for a two-sided material.

const kept = new WeakMap();

/**
 * The card triangles with one triangle left in each place. `points` are the cards' packed rest points, `index` their
 * triangles. Of the copies in one place the one facing away from the middle of the hair is kept, so the cards also
 * read rightly one-sided. Triangles and points are otherwise untouched: same pictures, same ties, same expressions.
 */
export function castCardIndex(points, index) {
  if (kept.has(index)) return kept.get(index);
  const middle = [0, 0, 0], count = points.length / 3;
  for (let i = 0; i < points.length; i++) middle[i % 3] += points[i] / count;
  // A place: the three corners to a hundredth of a millimetre, in any order.
  const corner = v => Math.round(points[v * 3] * 1e5) + "," + Math.round(points[v * 3 + 1] * 1e5) + "," + Math.round(points[v * 3 + 2] * 1e5);
  const outward = t => {
    const [a, b, c] = [0, 1, 2].map(k => [0, 1, 2].map(d => points[index[t + k] * 3 + d]));
    const u = [0, 1, 2].map(d => b[d] - a[d]), v = [0, 1, 2].map(d => c[d] - a[d]);
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return [0, 1, 2].reduce((sum, d) => sum + normal[d] * ((a[d] + b[d] + c[d]) / 3 - middle[d]), 0);
  };
  const places = new Map();
  for (let t = 0; t < index.length; t += 3) {
    const place = [corner(index[t]), corner(index[t + 1]), corner(index[t + 2])].sort().join(";");
    const held = places.get(place), facing = outward(t);
    if (!held || facing > held.facing) places.set(place, { t, facing });
  }
  const order = [...places.values()].map(p => p.t).sort((a, b) => a - b), out = new index.constructor(order.length * 3);
  order.forEach((t, i) => out.set(index.subarray(t, t + 3), i * 3));
  kept.set(index, out);
  return out;
}

/** How many triangles lie in a place another triangle already fills: 0 when every card is there once. */
export const castCardCopies = (points, index) => (index.length - castCardIndex(points, index).length) / 3;

// The card pictures are fine strands with soft edges, painted to be blended. Cut out at one half and seen smaller
// than painted, a lock of thin strands turns into scattered holes with the darker scalp showing through.
const LEVEL = .42, EDGE = .16;   // the density of hair at which a card closes, and the soft run either side of it

function blurred(values, side) {
  // Three passes of a three-texel mean, each way: near enough a bell a texel and a half wide.
  let from = Float32Array.from(values), to = new Float32Array(from.length);
  for (let pass = 0; pass < 6; pass++) {
    const step = pass % 2 ? side : 1;
    for (let i = 0; i < from.length; i++) {
      const at = pass % 2 ? Math.floor(i / side) : i % side;
      to[i] = (from[at > 0 ? i - step : i] + from[i] + from[at < side - 1 ? i + step : i]) / 3;
    }
    [from, to] = [to, from];
  }
  return from;
}

const pictured = new WeakMap();

/**
 * A card picture (RGBA bytes, side by side) ready to be cut out: closed where the card is mostly hair, with the
 * gaps between its strands taking the strands' own colour. Nothing that was drawn is taken away: single strands,
 * lashes and the tips stay as they were.
 */
export function castCardPixels(pixels, side) {
  if (pictured.has(pixels)) return pictured.get(pixels);
  const count = side * side, alpha = new Float32Array(count);
  for (let i = 0; i < count; i++) alpha[i] = pixels[i * 4 + 3] / 255;
  const density = blurred(alpha, side), out = new Uint8ClampedArray(pixels);
  const colour = [0, 1, 2].map(k => blurred(Float32Array.from(alpha, (a, i) => a * pixels[i * 4 + k]), side));
  for (let i = 0; i < count; i++) {
    const closed = Math.min(1, Math.max(0, .5 + (density[i] - LEVEL) / (2 * EDGE)));
    if (closed <= alpha[i]) continue;
    // What the texel held of hair keeps its colour; the rest is its neighbours' hair.
    for (let k = 0; k < 3; k++) out[i * 4 + k] = alpha[i] * pixels[i * 4 + k] + (1 - alpha[i]) * colour[k][i] / Math.max(density[i], 1e-4);
    out[i * 4 + 3] = closed * 255;
  }
  pictured.set(pixels, out);
  return out;
}
