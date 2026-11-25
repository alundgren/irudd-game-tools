// The lengths of a strand groom: hair that has left the scalp, as layers of strand cards over a dark
// sheet of the same hair. Hanging lengths, tails, knots and plaits all come as grids of points from
// `hairLengths` in human-style-hair.js; this file only turns a grid into cards.
//   lengthCards(cards, shapes, { tiles, solid, hair, k, centre, game }) appends to the arrays of `cards`
import { add, clamp, cross, dot, hash1, length, mix, noise3, smooth, sub, unit } from "./human-style-kit.js";

const TAU = Math.PI * 2;

/** A grid of points to read at any place: `at(i, j)` with fractional rows `i` and lanes `j`. */
function reader(points, { wrap = false, loop = false } = {}) {
  const rows = points.length, lanes = points[0].length, lastRow = loop ? rows : rows - 1, lastLane = wrap ? lanes : lanes - 1;
  const row = i => loop ? ((i % rows) + rows) % rows : clamp(i, 0, rows - 1), lane = j => wrap ? ((j % lanes) + lanes) % lanes : clamp(j, 0, lanes - 1);
  const at = (i, j) => {
    i = loop ? ((i % rows) + rows) % rows : clamp(i, 0, rows - 1); j = wrap ? ((j % lanes) + lanes) % lanes : clamp(j, 0, lanes - 1);
    const i0 = Math.floor(i), j0 = Math.floor(j), s = i - i0, t = j - j0, a = points[row(i0)][lane(j0)], b = points[row(i0)][lane(j0 + 1)], c = points[row(i0 + 1)][lane(j0)], d = points[row(i0 + 1)][lane(j0 + 1)];
    return [0, 1, 2].map(x => mix(mix(a[x], b[x], t), mix(c[x], d[x], t), s));
  };
  return { rows, lanes, lastRow, lastLane, at };
}

/**
 * Append the cards of every length in `shapes` to `cards`.
 *   tiles    long strand tiles [left, top, wide, tall] of the 256 pixel strand picture
 *   solid    the tile of unbroken combed hair, for the sheet under the cards
 *   hair     {r, g, b} in linear light
 *   k        the scale of this adult; `centre` the middle of the cranium
 *   game     true to build the smaller set a game model carries
 */
export function lengthCards(cards, shapes, { tiles, solid, hair, k, centre, game }) {
  let seed = 0;
  const uv = (tile, x, t) => [(tile[0] + 2 + (tile[2] - 4) * x) / 256, 1 - (tile[1] + 1.5 + (tile[3] - 3) * (1 - t)) / 256];
  const push = (p, n, tone, [u, v], skin) => {
    cards.position.push(p[0], p[1], p[2]); cards.normal.push(n[0], n[1], n[2]);
    cards.color.push(clamp(hair.r * tone), clamp(hair.g * tone), clamp(hair.b * tone));
    cards.uv.push(u, v); cards.bones.push(...skin[0]); cards.weights.push(...skin[1]);
    return cards.position.length / 3 - 1;
  };

  /**
   * One grid: rows run from the root to the ends, lanes across.
   *   wrap     lanes close on themselves, as round a tail
   *   loop     rows close on themselves, as hair wound round a knot
   *   middle   i => the point the grid faces away from at row i
   *   wide     the width of a card in metres
   *   layers   how many of the three layers of cards to build over the sheet
   *   under    how far the sheet lies under the grid; `ends` leaves that share of the length to the cards alone
   */
  const grow = (points, skin, { wrap = false, loop = false, middle, wide, layers = 3, under = .003 * k, ends = .14, wave = 0, cap = false, sheet = true, darkest = .68, blunt = false, fine = false }) => {
    const g = reader(points, { wrap, loop }), weigh = typeof skin === "function" ? skin : () => skin, id = ++seed;
    const outward = (i, j) => {
      const p = g.at(i, j), along = sub(g.at(i + .5, j), g.at(i - .5, j)), across = sub(g.at(i, j + .5), g.at(i, j - .5));
      let n = cross(across, along);
      const away = sub(p, middle(i, p));
      if (length(n) < 1e-12) n = away;
      n = unit(n);
      return dot(n, away) < 0 ? n.map(x => -x) : n;
    };
    // Where each lane ends: lanes shorter than the longest repeat their last point.
    const reach = Array.from({ length: g.lanes }, (_, j) => {
      if (loop) return g.rows;
      let i = g.rows - 1;
      while (i > 1 && length(sub(points[i][j], points[i - 1][j])) < 1e-6) i--;
      return i;
    });
    const endOf = j => { const a = ((Math.floor(j) % g.lanes) + g.lanes) % g.lanes, b = wrap ? (a + 1) % g.lanes : Math.min(g.lanes - 1, a + 1); return mix(reach[a], reach[b], j - Math.floor(j)); };
    // How wide a lane is half way down, to size cards in lanes.
    let span = 0;
    const half = Math.floor(g.rows * .45);
    for (let j = 0; j < g.lastLane; j++) span += length(sub(points[half][(j + 1) % g.lanes], points[half][j]));
    const lane = span / g.lastLane || 1e-4;
    // Light and dark locks keep their tone down the whole length.
    const lock = j => clamp((noise3(j * lane / (.011 * k) + id * 7.3, id * 3.1, .5) - .5) * 3.2, -1, 1);

    if (sheet) {
      // The sheet: the same hair in shadow, unbroken, so nothing shows between the cards but more hair.
      const stepI = Math.max(1, Math.round(g.lastRow / (fine ? (game ? 78 : 108) : game ? 11 : 20))), stepJ = Math.max(1, Math.round(g.lastLane / (game ? (wrap ? 9 : 22) : 40)));
      const last = loop ? g.rows : Math.max(stepI, Math.round((g.rows - 1) * (1 - ends))), is = [], js = [];
      for (let i = 0; i < last; i += stepI) is.push(i);
      is.push(last);
      for (let j = 0; j < g.lastLane; j += stepJ) js.push(j);
      js.push(g.lastLane);
      const first = cards.position.length / 3;
      is.forEach((i, a) => js.forEach((j, b) => {
        const p = g.at(i, j), n = outward(i, j);
        push(add(p, n, -under), n, darkest * (1 + .16 * lock(j)) * mix(.85, 1.05, i / g.lastRow), uv(solid, fine ? .035 + .93*j/g.lastLane : b % 2 ? .92 : .08, a % 2 ? .9 : .1), weigh(p));
      }));
      for (let a = 0; a + 1 < is.length; a++) for (let b = 0; b + 1 < js.length; b++) {
        const n = first + a * js.length + b;
        cards.index.push(n, n + js.length, n + 1, n + 1, n + js.length, n + js.length + 1);
      }
      if (cap) for (const a of cap === "end" ? [is.length - 1] : cap === "start" ? [0] : [0, is.length - 1]) {
        const i = is[a], hub = middle(i), n = unit(sub(hub, middle(a ? i - 1 : i + 1))), at = push(hub, n, darkest * .9, uv(solid, .5, .5), weigh(hub));
        for (let b = 0; b + 1 < js.length; b++) cards.index.push(at, first + a * js.length + b, first + a * js.length + b + 1);
      }
    }

    // The cards. Each layer lies further out, ends at another length and is lit a little more.
    const widths = wide / lane, total = g.lastLane;
    const more = wave ? 2 : 0;
    const LAYERS = [
      { cover: 1.7, from: r => .05 + .05 * r, to: () => 1, lift: .001, steps: (game ? 7 : 10) + more, tone: .9, broad: 1.15, past: blunt ? .004 : .02 },
      { cover: 1.35, from: r => .04 + .1 * r, to: r => .5 + .38 * r, lift: .004, steps: (game ? 5 : 8) + more, tone: 1, broad: 1, past: 0 },
      { cover: 1.05, from: r => .3 + .3 * r, to: () => 1, lift: .0065, steps: (game ? 4 : 6) + more, tone: 1.06, broad: .7, past: blunt ? .008 : .028 },
    ].slice(0, layers);
    LAYERS.forEach((layer, depth) => {
      const count = Math.max(wrap ? 5 : 3, Math.round(total / widths * layer.cover * (game ? 1 : 1.8)));
      for (let c = 0; c < count; c++) {
        const rnd = n => hash1(id * 7919 + depth * 613 + c * 37 + n);
        const j0 = wrap || loop ? (c + rnd(1)) / count * total : mix(.5 * widths * .6, total - .5 * widths * .6, (c + .15 + .7 * rnd(1)) / count);
        const start = layer.from(rnd(2)), stop = Math.max(start + .2, layer.to(rnd(3))), halfW = .5 * widths * layer.broad * (.8 + .4 * rnd(4)) * (game ? 1 : .7);
        const tile = tiles[Math.floor(rnd(5) * tiles.length) % tiles.length], flip = rnd(6) < .5, lean = (rnd(7) - .5) * .0035 * k;
        const shade = layer.tone * (1 + .1 * lock(j0)) * (1 + .08 * (rnd(8) - .5)), swing = wave * widths * .6, phase = TAU * (.25 * rnd(9) + lock(j0));
        const full = loop ? g.rows * mix(.55, .9, rnd(10)) : endOf(j0), begin = loop ? g.rows * rnd(11) : 0, steps = layer.steps, first = cards.position.length / 3;
        // The picture: unbroken strands repeated down the length, then the tips.
        const picture = Array.from({ length: steps + 1 }, (_, s) => { const left = steps - s; return left === 0 ? 1 : left === 1 ? .86 : left === 2 ? .68 : left % 2 ? .5 : .16; });
        let before = null;
        for (let s = 0; s <= steps; s++) {
          const t = mix(start, stop, loop ? s / steps : (s / steps) ** 1.3), i = begin + t * full, j = j0 + swing * Math.sin(phase + t * 13) * smooth(.15, .5, t);
          const narrow = halfW * mix(1, .78, s / steps), n = outward(i, j), out = layer.lift * k * smooth(0, .12, t) + (wave ? .004 * k * wave * Math.sin(phase + t * 13 + 1.3) * smooth(.15, .5, t) : 0);
          const here = [];
          for (const sign of [-1, 1]) {
            let p = add(g.at(i, j + sign * narrow), n, out + sign * lean);
            // Tips hang a little past the end of the grid, so the outline is strands and not the last row of points.
            if (s === steps && layer.past && before) p = add(p, unit(sub(p, before[here.length])), layer.past * k * (.5 + rnd(12 + sign)));
            here.push(p);
            push(p, n, shade * mix(.8, 1.06, smooth(0, .8, s / steps)), uv(tile, (sign < 0) !== flip ? .04 : .96, picture[s]), weigh(p));
          }
          before = here;
          if (s) { const n2 = first + s * 2; cards.index.push(n2 - 2, n2 + 1, n2 - 1, n2 - 2, n2, n2 + 1); }
        }
      }
    });
  };

  for (const { rows, wave, around } of shapes.sheets) grow(rows, shapes.skin, { wrap: false, middle: (i, p) => [centre[0], Math.min(p[1], centre[1]), centre[2]], wide: (game ? (wave ? .021 : .018) : .015) * k, wave, ends: around ? .05 : .14, blunt: around });
  for (const { rings, wound, rigid, plait, tuft } of shapes.tubes) {
    const hubs = rings.map(ring => ring.reduce((s, p) => add(s, p), [0, 0, 0]).map(x => x / ring.length)), skin = rigid ? shapes.rigid : tuft ? shapes.skin(rings[0][0]) : shapes.skin;
    const hub = i => hubs[Math.round(clamp(i, 0, hubs.length - 1))];
    if (wound) {
      // A knot is hair wound round and round: its sheet is the knot, its cards run round it.
      grow(rings, skin, { wrap: true, middle: hub, wide: 1, layers: 0, under: 0, ends: 0, cap: "end", darkest: .7 });
      const turned = rings[0].map((_, j) => rings.map(ring => ring[j])), all = hubs.reduce((s, p) => add(s, p), [0, 0, 0]).map(x => x / hubs.length);
      grow(turned, skin, { loop: true, middle: () => all, wide: .011 * k, layers: 2, sheet: false });
    } else if (plait) grow(rings, skin, { wrap: true, middle: hub, wide: 1, layers: 0, under: 0, ends: 0, cap: true, darkest: .9, fine: true });
    else grow(rings, skin, { wrap: true, middle: hub, wide: (tuft ? .008 : .013) * k, layers: tuft ? 1 : 3, under: tuft ? 0 : .002 * k, ends: tuft ? .5 : .12, cap: tuft ? false : "start" });
  }
}
