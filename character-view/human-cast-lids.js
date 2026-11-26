
const linear = v => (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
const encoded = v => (v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055);
const smooth = (v, a, b) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const lidTravel = .002;
export const lidShade = .85, lidEdge = [.55, .95];

export function castLidTexels({ uv, index, faceTriangles, source, blink, side }) {
  const travel = vertex => Math.hypot(blink[source[vertex] * 3], blink[source[vertex] * 3 + 1], blink[source[vertex] * 3 + 2]);
  const found = [], group = new Map(), root = point => {
    while (group.get(point) !== point) point = group.get(point);
    return point;
  };
  for (let t = 0; t < faceTriangles * 3; t += 3) {
    const corners = [index[t], index[t + 1], index[t + 2]], moved = corners.map(travel);
    if (Math.max(...moved) <= lidTravel) continue;
    found.push({ corners, moved });
    const points = corners.map(c => source[c]);
    for (const point of points) if (!group.has(point)) group.set(point, point);
    for (const point of points) group.set(root(point), root(points[0]));
  }
  const reach = new Map();
  for (const { corners, moved } of found) reach.set(root(source[corners[0]]), Math.max(reach.get(root(source[corners[0]])) ?? 0, ...moved));
  const farthest = Math.max(0, ...reach.values()), lids = found.filter(({ corners }) => reach.get(root(source[corners[0]])) >= .5 * farthest);
  let low = Infinity, high = -Infinity;
  for (const { corners } of lids) for (const c of corners) { low = Math.min(low, uv[c * 2]); high = Math.max(high, uv[c * 2]); }
  const middle = (low + high) / 2, offsets = [.5, .15, .85];
  return [0, 1].map(right => {
    const mine = lids.filter(({ corners }) => (uv[corners[0] * 2] >= middle) === Boolean(right));
    const most = Math.max(0, ...mine.flatMap(({ moved }) => moved)), cells = new Map();
    for (const { corners, moved } of mine) {
      const xs = corners.map(c => uv[c * 2] * side), ys = corners.map(c => (1 - uv[c * 2 + 1]) * side);
      const den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2]);
      if (Math.abs(den) < 1e-12) continue;
      for (let y = Math.floor(Math.min(...ys)) - 1; y <= Math.ceil(Math.max(...ys)); y++)
        for (let x = Math.floor(Math.min(...xs)) - 1; x <= Math.ceil(Math.max(...xs)); x++) {
          if (x < 0 || y < 0 || x >= side || y >= side) continue;
          let least = Infinity;
          for (const ox of offsets) for (const oy of offsets) {
            const a = ((ys[1] - ys[2]) * (x + ox - xs[2]) + (xs[2] - xs[1]) * (y + oy - ys[2])) / den;
            const b = ((ys[2] - ys[0]) * (x + ox - xs[2]) + (xs[0] - xs[2]) * (y + oy - ys[2])) / den, c = 1 - a - b;
            if (Math.min(a, b, c) < -1e-9) continue;
            least = Math.min(least, (a * moved[0] + b * moved[1] + c * moved[2]) / most);
          }
          const key = y * side + x;
          if (least < Infinity) cells.set(key, Math.min(least, cells.get(key) ?? Infinity));
        }
    }
    const texels = Int32Array.from(cells.keys()).sort();
    return { texels, along: Float32Array.from(texels, key => Math.min(1, cells.get(key))) };
  });
}

function median(values) {
  values.sort((a, b) => a - b);
  return values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
}

export function paintCastLids(rgba, mask, side, eyes, tone, { shade = lidShade, edge = lidEdge, reach = 10 } = {}) {
  for (const { texels, along } of eyes) {
    if (!texels.length) continue;
    let x0 = side, x1 = 0, y0 = side, y1 = 0;
    for (const key of texels) {
      const x = key % side, y = (key - x) / side;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const lid = new Set(texels), found = [[], [], []];
    for (let y = Math.max(0, y0 - reach); y <= Math.min(side - 1, y1 + reach); y++)
      for (let x = Math.max(0, x0 - reach); x <= Math.min(side - 1, x1 + reach); x++) {
        const key = y * side + x;
        if (mask[key] < 200 || lid.has(key)) continue;
        for (let k = 0; k < 3; k++) found[k].push(linear(rgba[key * 4 + k] / 255));
      }
    const skin = found[0].length >= 12 ? found.map(median) : tone;
    texels.forEach((key, i) => {
      const share = 1 - smooth(along[i], edge[0], edge[1]);
      for (let k = 0; k < 3; k++) {
        const was = linear(rgba[key * 4 + k] / 255);
        rgba[key * 4 + k] = Math.round(255 * encoded(was + share * (shade * skin[k] - was)));
      }
      mask[key] = Math.round(mask[key] + share * (255 - mask[key]));
    });
  }
}
