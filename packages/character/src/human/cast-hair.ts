const kept = new WeakMap<Uint16Array, Uint16Array>();
const at = (a: ArrayLike<number>, i: number) => a[i] ?? 0;

export function castCardIndex(points: Float32Array, index: Uint16Array): Uint16Array {
  const known = kept.get(index);
  if (known) return known;
  const middle = [0, 0, 0],
    count = points.length / 3;
  for (let i = 0; i < points.length; i++) middle[i % 3] = at(middle, i % 3) + at(points, i) / count;
  const corner = (v: number) =>
    Math.round(at(points, v * 3) * 1e5) +
    "," +
    Math.round(at(points, v * 3 + 1) * 1e5) +
    "," +
    Math.round(at(points, v * 3 + 2) * 1e5);
  const outward = (t: number) => {
    const [a = [], b = [], c = []] = [0, 1, 2].map((k) =>
      [0, 1, 2].map((d) => at(points, at(index, t + k) * 3 + d)),
    );
    const u = [0, 1, 2].map((d) => at(b, d) - at(a, d)),
      v = [0, 1, 2].map((d) => at(c, d) - at(a, d));
    const normal = [
      at(u, 1) * at(v, 2) - at(u, 2) * at(v, 1),
      at(u, 2) * at(v, 0) - at(u, 0) * at(v, 2),
      at(u, 0) * at(v, 1) - at(u, 1) * at(v, 0),
    ];
    return [0, 1, 2].reduce(
      (sum, d) => sum + at(normal, d) * ((at(a, d) + at(b, d) + at(c, d)) / 3 - at(middle, d)),
      0,
    );
  };
  const places = new Map<string, { readonly t: number; readonly facing: number }>();
  for (let t = 0; t < index.length; t += 3) {
    const place = [corner(at(index, t)), corner(at(index, t + 1)), corner(at(index, t + 2))]
      .sort()
      .join(";");
    const held = places.get(place),
      facing = outward(t);
    if (!held || facing > held.facing) places.set(place, { t, facing });
  }
  const order = [...places.values()].map((p) => p.t).sort((a, b) => a - b),
    out = new Uint16Array(order.length * 3);
  order.forEach((t, i) => out.set(index.subarray(t, t + 3), i * 3));
  kept.set(index, out);
  return out;
}

const LEVEL = 0.42,
  EDGE = 0.16;

function blurred(values: Float32Array, side: number): Float32Array {
  let from = Float32Array.from(values),
    to = new Float32Array(from.length);
  for (let pass = 0; pass < 6; pass++) {
    const step = pass % 2 ? side : 1;
    for (let i = 0; i < from.length; i++) {
      const p = pass % 2 ? Math.floor(i / side) : i % side;
      to[i] =
        (at(from, p > 0 ? i - step : i) + at(from, i) + at(from, p < side - 1 ? i + step : i)) / 3;
    }
    [from, to] = [to, from];
  }
  return from;
}

const pictured = new WeakMap<Uint8Array, Uint8ClampedArray>();

export function castCardPixels(pixels: Uint8Array, side: number): Uint8ClampedArray {
  const known = pictured.get(pixels);
  if (known) return known;
  const count = side * side,
    alpha = new Float32Array(count);
  for (let i = 0; i < count; i++) alpha[i] = at(pixels, i * 4 + 3) / 255;
  const density = blurred(alpha, side),
    out = new Uint8ClampedArray(pixels);
  const colour = [0, 1, 2].map((k) =>
    blurred(
      Float32Array.from(alpha, (a, i) => a * at(pixels, i * 4 + k)),
      side,
    ),
  );
  for (let i = 0; i < count; i++) {
    const closed = Math.min(1, Math.max(0, 0.5 + (at(density, i) - LEVEL) / (2 * EDGE)));
    const a = at(alpha, i);
    if (closed <= a) continue;
    for (let k = 0; k < 3; k++)
      out[i * 4 + k] =
        a * at(pixels, i * 4 + k) +
        ((1 - a) * at(colour[k] ?? [], i)) / Math.max(at(density, i), 1e-4);
    out[i * 4 + 3] = closed * 255;
  }
  pictured.set(pixels, out);
  return out;
}
