// The cast's upper eyelids (character-view/human-cast-lids.js at 2761eb1). In
// the photographed pictures the skin of an upper lid is a strip a few texels
// tall, painted as the dark red-brown shade under the brow. An open eye shows
// a third of it as a thin line; a blink stretches the same texels over the
// whole eye, which then reads as a dark red patch. Here that strip is
// repainted as the wearer's own skin, a little in shade, and runs into the
// photographed dark at the lid's edge, where the lashes are. The strip is
// found from the mesh: the texels under the triangles a blink moves.

const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encoded = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const smooth = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const at = (a: ArrayLike<number>, i: number) => a[i] ?? 0;

/** A blink moves a lid point at least this far, in metres. */
export const lidTravel = 0.002;
/** Lid skin relative to the skin around the eye, and where along the lid (0 crease, 1 edge) the photographed dark returns. */
export const lidShade = 0.85,
  lidEdge: readonly [number, number] = [0.55, 0.95];

/** One eye's lid texels and how far along the lid each lies. */
export interface CastLid {
  readonly texels: Int32Array;
  readonly along: Float32Array;
}

/**
 * The texels of a square picture of `side` under the triangles a blink moves,
 * one list per eye. `along` is 0 at points that stay still and 1 at the edge
 * of the lid, the least value of the triangles on a texel.
 */
export function castLidTexels(input: {
  readonly uv: Float32Array;
  readonly index: Uint16Array;
  readonly faceTriangles: number;
  readonly source: Uint16Array;
  readonly blink: Float32Array;
  readonly side: number;
}): ReadonlyArray<CastLid> {
  const { uv, index, faceTriangles, source, blink, side } = input;
  const travel = (vertex: number) => {
    const p = at(source, vertex) * 3;
    return Math.hypot(at(blink, p), at(blink, p + 1), at(blink, p + 2));
  };
  const found: Array<{ readonly corners: number[]; readonly moved: number[] }> = [],
    group = new Map<number, number>();
  const root = (point: number) => {
    while (group.get(point) !== point) point = group.get(point) ?? point;
    return point;
  };
  for (let t = 0; t < faceTriangles * 3; t += 3) {
    const corners = [at(index, t), at(index, t + 1), at(index, t + 2)],
      moved = corners.map(travel);
    if (Math.max(...moved) <= lidTravel) continue;
    found.push({ corners, moved });
    // Triangles that share a point of the surface are one patch.
    const points = corners.map((c) => at(source, c));
    for (const point of points) if (!group.has(point)) group.set(point, point);
    for (const point of points) group.set(root(point), root(at(points, 0)));
  }
  // A lid travels about a centimetre. A patch that moves much less than the lids do is a stray point
  // of the pose, in the hair or at an ear, and is left as photographed.
  const reach = new Map<number, number>();
  for (const { corners, moved } of found) {
    const r = root(at(source, at(corners, 0)));
    reach.set(r, Math.max(reach.get(r) ?? 0, ...moved));
  }
  const farthest = Math.max(0, ...reach.values()),
    lids = found.filter(
      ({ corners }) => (reach.get(root(at(source, at(corners, 0)))) ?? 0) >= 0.5 * farthest,
    );
  let low = Infinity,
    high = -Infinity;
  for (const { corners } of lids)
    for (const c of corners) {
      low = Math.min(low, at(uv, c * 2));
      high = Math.max(high, at(uv, c * 2));
    }
  const middle = (low + high) / 2,
    offsets = [0.5, 0.15, 0.85];
  return [0, 1].map((right) => {
    const mine = lids.filter(
      ({ corners }) => at(uv, at(corners, 0) * 2) >= middle === Boolean(right),
    );
    const most = Math.max(0, ...mine.flatMap(({ moved }) => moved)),
      cells = new Map<number, number>();
    for (const { corners, moved } of mine) {
      const xs = corners.map((c) => at(uv, c * 2) * side),
        ys = corners.map((c) => (1 - at(uv, c * 2 + 1)) * side);
      const [x0 = 0, x1 = 0, x2 = 0] = xs,
        [y0 = 0, y1 = 0, y2 = 0] = ys,
        [m0 = 0, m1 = 0, m2 = 0] = moved;
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(den) < 1e-12) continue;
      for (let y = Math.floor(Math.min(...ys)) - 1; y <= Math.ceil(Math.max(...ys)); y++)
        for (let x = Math.floor(Math.min(...xs)) - 1; x <= Math.ceil(Math.max(...xs)); x++) {
          if (x < 0 || y < 0 || x >= side || y >= side) continue;
          let least = Infinity;
          // A texel belongs to the lid when a triangle covers any of nine places on it.
          for (const ox of offsets)
            for (const oy of offsets) {
              const a = ((y1 - y2) * (x + ox - x2) + (x2 - x1) * (y + oy - y2)) / den;
              const b = ((y2 - y0) * (x + ox - x2) + (x0 - x2) * (y + oy - y2)) / den,
                c = 1 - a - b;
              if (Math.min(a, b, c) < -1e-9) continue;
              least = Math.min(least, (a * m0 + b * m1 + c * m2) / most);
            }
          const key = y * side + x;
          if (least < Infinity) cells.set(key, Math.min(least, cells.get(key) ?? Infinity));
        }
    }
    const texels = Int32Array.from(cells.keys()).sort();
    return {
      texels,
      along: Float32Array.from(texels, (key) => Math.min(1, cells.get(key) ?? 1)),
    };
  });
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values.length % 2
    ? at(values, (values.length - 1) / 2)
    : (at(values, values.length / 2 - 1) + at(values, values.length / 2)) / 2;
}

/**
 * Repaint the lids in an RGBA picture that has not yet been tinted, and mark
 * them as skin in `mask`, so that a chosen skin colour carries them with the
 * face. The skin is measured beside each eye: the median of the surely masked
 * texels within `reach` of the lid. `tone` (linear) stands in where none are
 * found.
 */
export function paintCastLids(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  side: number,
  eyes: ReadonlyArray<CastLid>,
  tone: ReadonlyArray<number>,
  shade = lidShade,
  edge = lidEdge,
  reach = 10,
): void {
  for (const { texels, along } of eyes) {
    if (!texels.length) continue;
    let x0 = side,
      x1 = 0,
      y0 = side,
      y1 = 0;
    for (const key of texels) {
      const x = key % side,
        y = (key - x) / side;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const lid = new Set(texels),
      found: number[][] = [[], [], []];
    for (let y = Math.max(0, y0 - reach); y <= Math.min(side - 1, y1 + reach); y++)
      for (let x = Math.max(0, x0 - reach); x <= Math.min(side - 1, x1 + reach); x++) {
        const key = y * side + x;
        if (at(mask, key) < 200 || lid.has(key)) continue;
        for (let k = 0; k < 3; k++) found[k]?.push(linear(at(rgba, key * 4 + k) / 255));
      }
    const skin = (found[0]?.length ?? 0) >= 12 ? found.map(median) : tone;
    texels.forEach((key, i) => {
      const share = 1 - smooth(at(along, i), edge[0], edge[1]);
      for (let k = 0; k < 3; k++) {
        const was = linear(at(rgba, key * 4 + k) / 255);
        rgba[key * 4 + k] = Math.round(255 * encoded(was + share * (shade * at(skin, k) - was)));
      }
      mask[key] = Math.round(at(mask, key) + share * (255 - at(mask, key)));
    });
  }
}
