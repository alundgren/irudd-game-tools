// Hair drawn back to a tie, as rooted locks: ribbons of strands that leave the skin at the hairline, rise off the
// head and run back over one another to where the hair is gathered. A darker painted scalp lies under them, so
// between two locks there is depth and not skin.
//   sweptLockSheet(game)                  -> { map, normalMap, roughnessMap } the strand picture and its relief
//   lockSheetPixels(game)                 -> the same as plain pixels, for tests and for other renderers
//   lockTiles(game)                       -> the places of the picture, in pixels of its `size`
//   sweptVolume(rooted, k)                -> q => how far the drawn-back hair stands off the scalp there, in metres
//   sweptLocks(cards, { ... })            appends the locks of one head to `cards`
// Everything is measured from the head it is built on: roots follow that adult's own hairline and ears, and every
// station of a lock is seated on that adult's own scalp.
import * as T from "three";
import { add, clamp, cross, dot, hash1, length, mix, noise3, smooth, sub, unit } from "./human-style-kit.js";

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const aimAt = (phi, eps) => [Math.cos(eps) * Math.sin(phi), Math.sin(eps), Math.cos(eps) * Math.cos(phi)];
const slerp = (a, b, t) => {
  const w = Math.acos(clamp(dot(a, b), -1, 1));
  if (w < 1e-5) return a;
  const s = Math.sin(w), x = Math.sin((1 - t) * w) / s, y = Math.sin(t * w) / s;
  return unit([a[0] * x + b[0] * y, a[1] * x + b[1] * y, a[2] * x + b[2] * y]);
};

// ---------------------------------------------------------------------------------------------
// The strand picture

/**
 * Places in a picture, each [left, top, wide, tall] in pixels of its `size`. Roots are at the foot of a tile and tips at
 * its top.
 *   lock    a ribbon of hair gathered into a few clumps, with slits between them that open and close
 *   wisp    a few single strands
 *   solid   unbroken combed hair
 * A game model shares one small atlas between everything it wears, so its picture has fewer, broader tiles: every
 * strand it keeps is then wide enough to survive. `soft` is how many pixels the edge of the hair fades over: a cutout
 * read larger than it was drawn follows a slope smoothly and a hard edge in steps.
 */
const LAYOUTS = {
  full: { size: 1024, lock: Array.from({ length: 6 }, (_, i) => [i * 128, 0, 128, 1024]), wisp: Array.from({ length: 4 }, (_, i) => [768 + i * 48, 0, 48, 1024]), solid: [960, 0, 64, 1024], per: 8, soft: 2 },
  game: { size: 512, lock: Array.from({ length: 3 }, (_, i) => [i * 150, 0, 150, 512]), wisp: [[450, 0, 40, 512]], solid: [490, 0, 22, 512], per: 5, soft: 3 },
};
/** The places of the strand picture a full model (`game` false) or a game model reads. `long` is `lock` by the name the tail uses. */
export const lockTiles = game => { const layout = LAYOUTS[game ? "game" : "full"]; return { ...layout, long: layout.lock }; };

const drawn = {};
/**
 * The picture as three images of `size` squared RGBA pixels, rows from the top.
 *   color      a grey the hair colour is multiplied by; alpha is the hair
 *   normal     tangent-space relief: every strand is a rounded thing, and so is every clump
 *   roughness  in green, as glTF reads it: strands shine along their crowns and are dull between
 */
export function lockSheetPixels(game = false) {
  const name = game ? "game" : "full";
  if (drawn[name]) return drawn[name];
  const layout = LAYOUTS[name], SIZE = layout.size, lockTiles = layout, n = SIZE * SIZE, tone = new Float32Array(n).fill(.62), alpha = new Float32Array(n), height = new Float32Array(n);
  const wave1 = (seed, t) => noise3(seed * 7.31 + 1.7, t, seed * 3.17 + .4);

  const lock = ([left, top, wide, tall], seed) => {
    const clumps = 3 + seed % 2, per = layout.per, strands = [], fine = wide / per / 16;
    const groups = Array.from({ length: clumps }, (_, c) => ({
      centre: wide * (c + .5 + .3 * (hash1(seed * 31 + c) - .5)) / clumps, half: wide / clumps * .5 * (.9 + .25 * hash1(seed * 37 + c)),
      shrink: .28 + .3 * hash1(seed * 41 + c), rate: 2.2 + 2.5 * hash1(seed * 43 + c), root: .035 * hash1(seed * 47 + c), tone: .82 + .18 * hash1(seed * 53 + c),
      sway: wide * .035 * (hash1(seed * 59 + c) - .5), turns: 1 + 2 * hash1(seed * 61 + c),
    }));
    groups.forEach((g, c) => { for (let s = 0; s < per; s++) {
      const rnd = k => hash1(seed * 977 + c * 131 + s * 31 + k), off = (s + .2 + .6 * rnd(1)) / per * 2 - 1;
      // Strands end over the last eighth of a tile only: a lock that is read short of it is whole.
      strands.push({ c, off, root: g.root + .05 * Math.abs(off) ** 1.4 + .03 * rnd(2), tip: 1 - .12 * (.8 * Math.abs(off) ** 1.3 + .35 * rnd(3)), tone: g.tone * (.66 + .34 * rnd(4)), half: fine * (1.9 + .9 * rnd(5)), wave: fine * 1.1 * rnd(6), phase: TAU * rnd(7), turns: 1.5 + 3 * rnd(8) });
    } });
    const x = new Float32Array(strands.length), w = new Float32Array(strands.length), lo = new Float32Array(clumps), hi = new Float32Array(clumps), mid = new Float32Array(clumps), wideOf = new Float32Array(clumps);
    for (let y = 0; y < tall; y++) {
      const t = 1 - (y + .5) / tall;
      groups.forEach((g, c) => {
        // A clump draws in and lets go again along its length. Where two neighbours draw in together a slit opens.
        const slit = smooth(.42, .8, wave1(seed * 11 + c, t * g.rate * 3)) * smooth(.05, .16, t);
        mid[c] = g.centre + g.sway * Math.sin(TAU * g.turns * t * .5); wideOf[c] = g.half * (1.08 - g.shrink * slit) * (1 - .35 * smooth(.9, 1, t));
        lo[c] = Infinity; hi[c] = -Infinity;
      });
      strands.forEach((s, i) => {
        const live = t >= s.root && t <= s.tip;
        w[i] = live ? s.half * mix(.4, 1, smooth(s.root, s.root + .035, t)) * mix(1, .45, smooth(s.tip - .1, s.tip, t)) : 0;
        x[i] = mid[s.c] + s.off * wideOf[s.c] + s.wave * Math.sin(s.phase + s.turns * Math.PI * t);
        if (live) { lo[s.c] = Math.min(lo[s.c], x[i] - w[i]); hi[s.c] = Math.max(hi[s.c], x[i] + w[i]); }
      });
      for (let px = 0; px < wide; px++) {
        const at = (top + y) * SIZE + left + px, here = px + .5;
        let near = Infinity, best = -1, cover = 0, lump = 0;
        for (let i = 0; i < strands.length; i++) { if (!w[i]) continue; const far = Math.abs(here - x[i]) / w[i]; if (far < near) { near = far; best = i; } }
        for (let c = 0; c < clumps; c++) {
          const inside = clamp(Math.min(here - lo[c], hi[c] - here) / layout.soft + .5);
          if (inside > cover) { cover = inside; const r = (here - mid[c]) / Math.max(1, wideOf[c] + 2); lump = Math.sqrt(Math.max(0, 1 - r * r)); }
        }
        // The gutter of a tile stays clear, so one lock never reads its neighbour.
        if (px < 2 || px >= wide - 2) cover = 0;
        const round = best < 0 ? 0 : Math.sqrt(Math.max(0, 1 - Math.min(1, near) ** 2));
        // Between two strands of one clump there is hair further down, in shadow.
        tone[at] = (best < 0 ? .7 : strands[best].tone * (.6 + .4 * round)) * (.86 + .14 * t);
        alpha[at] = cover;
        height[at] = cover * (.4 * lump + .6 * round);
      }
    }
  };

  const wisp = ([left, top, wide, tall], seed) => {
    const count = 3 + seed % 2, strands = Array.from({ length: count }, (_, s) => {
      const rnd = k => hash1(seed * 613 + s * 37 + k);
      return { x: 7 + (wide - 14) * (s + .2 + .6 * rnd(1)) / count, root: .02 + .1 * rnd(2) * rnd(3), tip: 1 - .3 * rnd(4), tone: .78 + .22 * rnd(5), half: wide / 48 * (2.3 + .9 * rnd(6)), sway: 3.2 * (rnd(7) - .5), phase: TAU * rnd(8), turns: .8 + 1.6 * rnd(9) };
    });
    for (let y = 0; y < tall; y++) {
      const t = 1 - (y + .5) / tall;
      for (let px = 2; px < wide - 2; px++) {
        const at = (top + y) * SIZE + left + px;
        let cover = 0, shade = .8, round = 0;
        for (const s of strands) {
          if (t < s.root || t > s.tip) continue;
          const half = s.half * smooth(s.root, s.root + .03, t) * mix(1, .5, smooth(s.tip - .15, s.tip, t)), far = Math.abs(px + .5 - s.x - s.sway * Math.sin(s.phase + s.turns * Math.PI * t)), c = clamp((half - far) / layout.soft + .5);
          if (c > cover) { cover = c; shade = s.tone; round = Math.sqrt(Math.max(0, 1 - Math.min(1, far / half) ** 2)); }
        }
        tone[at] = shade * (.62 + .38 * round); alpha[at] = cover; height[at] = cover * round;
      }
    }
  };

  lockTiles.lock.forEach((tile, i) => lock(tile, 5 + i));
  lockTiles.wisp.forEach((tile, i) => wisp(tile, 23 + i));
  {
    // Unbroken hair: fine streaks that run the way the strands do.
    const [left, top, wide, tall] = lockTiles.solid;
    for (let px = 0; px < wide; px++) {
      const fine = hash1(9001 + px), broad = noise3(px / 5.5 + 3, .5, 7.5);
      for (let y = 0; y < tall; y++) {
        const at = (top + y) * SIZE + left + px, value = clamp(.5 + .3 * broad + .2 * fine + .06 * (noise3(px / 3, y / 60, 2.5) - .5), .3, 1);
        tone[at] = value; alpha[at] = px < 1 || px >= wide - 1 ? 0 : 1; height[at] = value;
      }
    }
  }

  const color = new Uint8ClampedArray(n * 4), normal = new Uint8ClampedArray(n * 4), roughness = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < SIZE; y++) for (let px = 0; px < SIZE; px++) {
    const at = y * SIZE + px, o = at * 4, grey = Math.round(255 * tone[at] ** (1 / 2.2));
    color[o] = color[o + 1] = color[o + 2] = grey; color[o + 3] = Math.round(255 * alpha[at]);
    const dx = height[y * SIZE + Math.min(SIZE - 1, px + 1)] - height[y * SIZE + Math.max(0, px - 1)], dy = height[Math.min(SIZE - 1, y + 1) * SIZE + px] - height[Math.max(0, y - 1) * SIZE + px];
    // Strands are far longer than they are wide: what the light shows is the slope across them.
    const nx = -dx * 1.5, ny = dy * .6, l = Math.hypot(nx, ny, 1);
    normal[o] = Math.round(127.5 + 127.5 * nx / l); normal[o + 1] = Math.round(127.5 + 127.5 * ny / l); normal[o + 2] = Math.round(127.5 + 127.5 / l); normal[o + 3] = 255;
    const rough = Math.round(255 * mix(.88, .5, clamp(height[at]) ** 1.5));
    roughness[o] = 255; roughness[o + 1] = rough; roughness[o + 2] = 0; roughness[o + 3] = 255;
  }
  return drawn[name] = { size: SIZE, color, normal, roughness };
}

const sheets = {};
/** The strand picture as textures, shared by every head that wears drawn-back locks. */
export function sweptLockSheet(game = false) {
  const kind = game ? "game" : "full";
  if (sheets[kind]) return sheets[kind];
  const { size, color, normal, roughness } = lockSheetPixels(game);
  const textureOf = (data, name, srgb) => {
    let texture;
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d").putImageData(new ImageData(data, size, size), 0, 0);
      texture = new T.CanvasTexture(canvas);
    } else {
      // Without a page the same pixels are used directly, turned over as a canvas would be.
      const turned = new Uint8Array(data.length);
      for (let y = 0; y < size; y++) turned.set(data.subarray(y * size * 4, (y + 1) * size * 4), (size - 1 - y) * size * 4);
      texture = new T.DataTexture(turned, size, size, T.RGBAFormat);
      texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter; texture.generateMipmaps = true;
      texture.needsUpdate = true;
    }
    texture.name = name;
    if (srgb) texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };
  return sheets[kind] = { map: textureOf(color, "Hair locks", true), normalMap: textureOf(normal, "Hair lock relief", false), roughnessMap: textureOf(roughness, "Hair lock sheen", false) };
}

// ---------------------------------------------------------------------------------------------
// The locks

/**
 * The share of the depth of the hair the painted scalp under the locks lies at. A game model has few, long facets,
 * which cut the corners of a round head, so its layers keep further apart.
 */
export const scalpShare = game => game ? .15 : .62;

/** How to wear the front: where the hair divides, in degrees to the wearer's left, and how far it bows away from there. */
const FRONTS = {
  "Parted": { part: 0, bow: .09 },
  "Swept left": { part: -24, bow: .13 },
  "Swept right": { part: 24, bow: .13 },
};

/**
 * How far drawn-back hair stands off the scalp at a direction `q` of the head frame, in metres: fullest over the
 * forehead and the top, close at the sides where the ears are, closer still towards the nape and the tie.
 *   rooted.volume   millimetres on a head of average size
 *   to              where the hair is gathered
 * The layers of the hair are shares of this depth: the painted scalp lies at `scalpShare` of it and the locks over that.
 */
export function sweptVolume(rooted, k, to) {
  const mm = k / 1000, gather = unit(to);
  return q => {
    const eps = Math.asin(clamp(q[1], -1, 1)), top = smooth(2 * DEG, 42 * DEG, eps), front = smooth(-.1, .7, q[2]) * top;
    // The tie draws the hair down to the head.
    const drawn = mix(.25, 1, smooth(10 * DEG, 62 * DEG, Math.acos(clamp(dot(q, gather), -1, 1))));
    return rooted.volume * mm * mix(.34, 1, top) * mix(.92, 1.2, front) * drawn;
  };
}

/**
 * Append the locks of drawn-back hair to `cards`.
 *   rooted    { volume, strays } from the style
 *   to        where the hair is gathered, a direction of the head frame
 *   rootLine  [left, right] (direction in degrees) -> elevation in degrees of the line the outer locks grow from
 *   burns     [left, right] { at, wide, low } the sideburn: its middle and half its width as directions, and the
 *             elevation of its tip, all in degrees
 *   seat      (direction, height) -> { p, n, v } on this adult's scalp
 *   skinOf    seated station -> [bones, weights]
 *   hair      {r, g, b} in linear light
 *   fringe    how the front is worn: straight back, parted or swept to one side
 * Returns how many locks were laid.
 */
export function sweptLocks(cards, { rooted, to, f, k, seat, skinOf, rootLine, burns, hair, game, fringe }) {
  const mm = k / 1000, gather = unit(to), volume = sweptVolume(rooted, k, to), front = FRONTS[fringe] ?? null, tiles = lockTiles(game), SIZE = tiles.size;
  // Light hair needs deeper shadows than dark hair to show the same locks.
  const light = clamp(.2126 * hair.r + .7152 * hair.g + .0722 * hair.b), depth = mix(.16, .3, smooth(.05, .6, light));
  const world = q => seat(q, 0).p;

  // The line roots grow from, as points a degree apart round the head, with the distance along it.
  const ring = [];
  for (let i = 0; i <= 360; i++) {
    const side = i <= 180 ? 0 : 1, absolute = side ? 360 - i : i, phi = (side ? -1 : 1) * absolute * DEG;
    ring.push({ phi, absolute, side, p: world(aimAt(phi, rootLine[side](absolute) * DEG)), run: 0 });
  }
  for (let i = 1; i < ring.length; i++) ring[i].run = ring[i - 1].run + length(sub(ring[i].p, ring[i - 1].p));
  const round = ring[ring.length - 1].run;
  const rootAt = run => {
    let i = 1;
    while (i < ring.length - 1 && ring[i].run < run) i++;
    const a = ring[i - 1], b = ring[i], t = clamp((run - a.run) / Math.max(1e-9, b.run - a.run));
    const turn = mix(a.side ? -a.absolute : a.absolute, b.side ? -b.absolute : b.absolute, a.side === b.side ? t : 0);
    return { phi: turn * DEG, absolute: Math.abs(turn), side: turn < 0 ? 1 : 0 };
  };
  const lineAt = q => { const phi = Math.atan2(q[0], q[2]) / DEG; return rootLine[phi < 0 ? 1 : 0](Math.abs(phi)); };

  const STATIONS = 25;
  /**
   * One lock as stations from its root to where it goes under the tie.
   *   L   { inset (degrees inside the root line), full (share of the volume it stands at), out (metres further),
   *         end (share of the way to the tie it runs), fly (metres its free end lifts) }
   */
  const path = (root, L) => {
    const q0 = aimAt(root.phi, (rootLine[root.side](root.absolute) + L.inset) * DEG), angle = Math.acos(clamp(dot(q0, gather), -1, 1));
    // Under the tie the hair is one bundle; a lock stops just inside it.
    const whole = Math.max(.3, 1 - 4.5 * DEG / Math.max(angle, 6 * DEG)), end = whole * (L.end ?? 1);
    const frontal = front ? smooth(75, 35, root.absolute) : 0, away = front ? (root.phi / DEG >= front.part ? 1 : -1) : 0;
    const straight = .9 * Math.cos(root.phi) ** 2;
    let qs = [];
    for (let i = 0; i < STATIONS; i++) {
      // Stations are closest together where a lock leaves the skin and turns back.
      const u = (i / (STATIONS - 1)) ** 1.45 * end;
      let q = slerp(q0, gather, u);
      // The shortest way round a head from near the middle of the forehead to the middle of the back swings wide of
      // the middle on its way. Combed hair does not: it keeps its place between its neighbours.
      q = unit([mix(q[0], mix(q0[0], gather[0], u / whole), straight), q[1], q[2]]);
      if (frontal) q = unit(add(q, [away, 0, 0], front.bow * frontal * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 1.3));
      qs.push({ q, u });
    }
    // Hair grows inside its hairline and goes over the ears, not through them.
    const inside = s => {
      const need = lineAt(s.q) + 3.2 * smooth(0, .1, s.u), eps = Math.asin(clamp(s.q[1], -1, 1)) / DEG;
      if (eps < need && s.u > 0) s.q = aimAt(Math.atan2(s.q[0], s.q[2]), need * DEG);
    };
    qs.forEach(inside);
    for (let pass = 0; pass < 2; pass++) {
      qs = qs.map((s, i) => i && i + 1 < qs.length ? { u: s.u, q: unit(add(add(qs[i - 1].q, qs[i + 1].q, 1), s.q, 2)) } : s);
      qs.forEach(inside);
    }
    let run = 0;
    const stations = qs.map((s, i) => {
      if (i) run += length(sub(world(s.q), world(qs[i - 1].q)));
      // A lock leaves the skin, rises to its fullness within two centimetres and is drawn down again to the tie.
      const rise = smooth(0, 1, run / (28 * mm)) ** .7;
      // A strand that ends on the head goes back into the hair it lies on.
      const h = .25 * mm + (volume(s.q) * L.full + L.out) * rise * (L.end ? mix(1, .8, smooth(.6, 1, s.u / end)) : 1);
      return { ...seat(s.q, h), run, u: s.u };
    });
    return { stations, run, angle, root };
  };

  const push = (station, p, n, tone, uv) => {
    const [bones, weights] = skinOf(station);
    cards.position.push(p[0], p[1], p[2]); cards.normal.push(n[0], n[1], n[2]);
    cards.color.push(Math.min(1, hair.r * tone), Math.min(1, hair.g * tone), Math.min(1, hair.b * tone));
    cards.uv.push(uv[0], uv[1]); cards.bones.push(...bones); cards.weights.push(...weights);
  };
  const picture = (tile, x, row) => [(tile[0] + 3 + (tile[2] - 6) * x) / SIZE, 1 - (tile[1] + 1.5 + (tile[3] - 3) * (1 - row)) / SIZE];
  // One whole tile is this much hair, so strands are the same size on a long lock and on a short one.
  const tileRun = 300 * mm;
  let laid = 0;

  /**
   * A layer of locks round the head.
   *   count   how many; `steps` the most segments a lock has
   *   wide    how much wider a lock is than the room between its neighbours; `shade` its tone
   */
  const layer = (index, count, { inset, full, out, steps, shade, wide = 1.5, least = 3.5, most = 15, spread = 0 }) => {
    const locks = [];
    for (let i = 0; i < count; i++) {
      const rnd = n => hash1(index * 7919 + i * 131 + n), root = rootAt(round * (i + .5 + .45 * (rnd(1) - .5)) / count);
      // The hairline is never one even line: every lock starts a little higher or lower than the next.
      const jag = 1.8 * (rnd(2) - .5) + 2.4 * (noise3(root.phi * 3.1 + 5, index * 1.7, .3) - .5);
      locks.push({ ...path(root, { inset: inset + spread * rnd(3) + jag, full: full * (.92 + .16 * rnd(4)), out: out + 1.4 * mm * (rnd(5) - .5) }), i, rnd });
    }
    locks.forEach((lock, i) => {
      const before = locks[(i + count - 1) % count], after = locks[(i + 1) % count], { stations, rnd } = lock;
      const tile = tiles.lock[Math.floor(rnd(7) * tiles.lock.length) % tiles.lock.length], flip = rnd(8) < .5, roll = (rnd(9) - .5) * .5;
      const tone = shade * (1 + depth * (1.5 * (noise3(lock.root.phi * 2.6 + 3, index * 2.3, 1.1) - .5) + .6 * (rnd(10) - .5)));
      const n = clamp(Math.round(lock.angle / DEG / (game ? 15 : 7.5)), 2, steps), first = cards.position.length / 3, start = .02 + .05 * rnd(11);
      for (let j = 0; j <= n; j++) {
        // A game model has too few segments to spend most of them at the root: its segments are of even length.
        const at = Math.round((game ? (j / n) ** (1 / 1.45) : j / n) * (STATIONS - 1)), s = stations[at], along = unit(sub(stations[Math.min(STATIONS - 1, at + 1)].p, stations[Math.max(0, at - 1)].p));
        let side = unit(cross(s.n, along));
        const normal = unit(cross(along, side)), turn = roll * smooth(.05, .4, s.u);
        // A lock lies flat where it leaves the skin and turns a little further on, like a shingle over the next.
        side = unit(add(side.map(x => x * Math.cos(turn)), normal, Math.sin(turn)));
        // Each edge reaches towards the lock on that side, however unevenly the locks are spaced: no gap is left between two.
        const toBefore = sub(before.stations[at].p, s.p), toAfter = sub(after.stations[at].p, s.p), swap = dot(toBefore, side) > dot(toAfter, side), narrow = mix(.7, 1, smooth(0, 12 * mm, s.run));
        const reach = to => clamp(length(to) * wide * .5, least * mm, most * mm) * narrow, halves = swap ? [reach(toAfter), reach(toBefore)] : [reach(toBefore), reach(toAfter)];
        // Dark where the hair comes out of the skin and from under the hair before it, lighter along its length.
        const value = tone * mix(.6, 1.06, smooth(0, 45 * mm, s.run)) * mix(1, .8, smooth(.8, 1, at / (STATIONS - 1)));
        for (let c = 0; c < 3; c++) {
          // The middle of a lock stands up and its edges go down into the hair beside it.
          const off = c - 1, half = halves[c >> 1], p = add(add(s.p, side, off * half), normal, (c === 1 ? .1 * half : -Math.min(.2 * half, 1.6 * mm)) * smooth(0, 15 * mm, s.run));
          push(s, p, unit(add(add(normal, s.n, .6), side, off * .45)), value * (c === 1 ? 1 : .93), picture(tile, flip ? 1 - c / 2 : c / 2, Math.min(.84, start + s.run / tileRun)));
        }
        if (j) for (let c = 0; c < 2; c++) { const b = first + j * 3 + c, e = b - 3; cards.index.push(e, b + 1, e + 1, e, b, b + 1); }
      }
      laid++;
    });
  };

  /** Single strands that left the comb: they start anywhere near the front and end before the tie. */
  const wisps = (index, count, steps) => {
    for (let i = 0; i < count; i++) {
      const rnd = n => hash1(index * 6007 + i * 173 + n), root = rootAt(round * (i + rnd(1)) / count);
      const L = { inset: -.6 + 16 * rnd(2) ** 2, full: 1.02 + .06 * rnd(3), out: 2.6 * mm + 1 * mm * rnd(4), end: .3 + .55 * rnd(5) };
      const { stations, angle } = path(root, L), tile = tiles.wisp[Math.floor(rnd(7) * tiles.wisp.length) % tiles.wisp.length], flip = rnd(8) < .5;
      const n = clamp(Math.round(angle * L.end / DEG / (game ? 26 : 8)), 2, steps), first = cards.position.length / 3, half = (2.6 + 1.6 * rnd(9)) * mm, tone = 1.04 + .22 * (rnd(10) - .5), whole = stations[STATIONS - 1].run;
      for (let j = 0; j <= n; j++) {
        const at = Math.round(j * (STATIONS - 1) / n), s = stations[at], along = unit(sub(stations[Math.min(STATIONS - 1, at + 1)].p, stations[Math.max(0, at - 1)].p)), side = unit(cross(s.n, along)), normal = unit(cross(along, side));
        for (let c = 0; c < 2; c++) push(s, add(s.p, side, (c * 2 - 1) * half), unit(add(normal, s.n, .6)), tone * mix(.7, 1.05, smooth(0, 30 * mm, s.run)), picture(tile, flip ? 1 - c : c, mix(.03, 1, s.run / whole)));
        if (j) { const b = first + j * 2; cards.index.push(b - 2, b + 1, b - 1, b - 2, b, b + 1); }
      }
      laid++;
    }
  };

  /**
   * The sideburns: short hair that grows down in front of each ear. It starts under the locks drawn back over it and
   * lies on the skin to its tips. With `rooted.strays`, a few long strands have come loose at the temple and hang there.
   */
  const sideburns = () => {
    burns.forEach((burn, side) => {
      const sign = side ? -1 : 1, count = game ? 2 : 6;
      for (let i = 0; i < count; i++) {
        const rnd = n => hash1(8111 + side * 977 + i * 61 + n), at = burn.at - burn.wide * (i + .5 + .3 * (rnd(1) - .5)) / count * 2 + burn.wide;
        const from = aimAt(sign * (at - 3) * DEG, (rootLine[side](at - 3) + 2) * DEG), tip = aimAt(sign * (at + 1.5 * (rnd(2) - .5)) * DEG, (burn.low - 2 * rnd(3)) * DEG);
        const tile = tiles.lock[Math.floor(rnd(4) * tiles.lock.length) % tiles.lock.length], steps = game ? 2 : 5, first = cards.position.length / 3, tone = .74 + .2 * rnd(5), half = (game ? 6.5 : 4.2) * mm;
        const line = Array.from({ length: steps + 1 }, (_, j) => seat(slerp(from, tip, j / steps), (1.6 - 1.2 * j / steps) * mm));
        line.forEach((s, j) => {
          const along = unit(sub(line[Math.min(steps, j + 1)].p, line[Math.max(0, j - 1)].p)), across = unit(cross(s.n, along));
          for (let c = 0; c < 2; c++) push(s, add(s.p, across, (c * 2 - 1) * half * (1 - .35 * j / steps)), s.n, tone * mix(.78, 1, j / steps), picture(tile, c ? .58 : .08 + .3 * rnd(6), mix(.72, .995, (j / steps) ** .8)));
          if (j) { const b = first + j * 2; cards.index.push(b - 2, b + 1, b - 1, b - 2, b, b + 1); }
        });
        laid++;
      }
      const strays = game ? 0 : rooted.strays ?? 0;
      for (let i = 0; i < strays; i++) {
        const rnd = n => hash1(9343 + side * 733 + i * 89 + n);
        // More come loose on one side than on the other.
        if (rnd(1) < (side ? .55 : .2)) continue;
        const at = burn.at - burn.wide - 4 - 9 * rnd(2), from = aimAt(sign * at * DEG, (rootLine[side](at) + 1) * DEG), root = seat(from, .4 * mm);
        const long = (55 + 60 * rnd(3)) * mm, lean = .1 + .22 * rnd(4), steps = 8, tile = tiles.wisp[Math.floor(rnd(5) * tiles.wisp.length) % tiles.wisp.length], first = cards.position.length / 3, half = (2 + 1.2 * rnd(6)) * mm;
        const out = unit([root.n[0], 0, root.n[2]]), line = [];
        for (let j = 0; j <= steps; j++) {
          const t = j / steps, drop = long * t;
          // It leaves the head, falls beside the cheekbone and turns in a little at its end.
          const p = add(add(add(root.p, [0, -1, 0], drop), out, (4 + 7 * Math.sin(Math.PI * Math.min(1, t * 1.2))) * mm * smooth(0, .25, t)), [0, 0, 1], lean * drop * (1 - .4 * t));
          line.push({ p, n: out, v: root.v });
        }
        line.forEach((s, j) => {
          const along = unit(sub(line[Math.min(steps, j + 1)].p, line[Math.max(0, j - 1)].p)), across = unit(cross(s.n, along));
          for (let c = 0; c < 2; c++) push(s, add(s.p, across, (c * 2 - 1) * half), unit(add(s.n, [0, .3, 0], 1)), 1.05, picture(tile, c, mix(.04, 1, j / steps)));
          if (j) { const b = first + j * 2; cards.index.push(b - 2, b + 1, b - 1, b - 2, b, b + 1); }
        });
        laid++;
      }
    });
  };

  /** The finest hair of the hairline: short single strands on the skin before the first locks, across the forehead and the temples. */
  const fuzz = (index, count) => {
    for (let i = 0; i < count; i++) {
      const rnd = n => hash1(index * 4391 + i * 211 + n), turn = (i + rnd(1)) / count * 2 - 1, absolute = Math.abs(turn) * 74, side = turn < 0 ? 1 : 0, phi = turn * 74 * DEG;
      const low = rootLine[side](absolute) - .6 - 2.2 * rnd(2) ** 1.5, from = aimAt(phi, low * DEG), long = (7 + 9 * rnd(3)) * mm, steps = 2;
      const up = slerp(from, gather, long / (.1 * k) / Math.max(.3, Math.acos(clamp(dot(from, gather), -1, 1))));
      const tile = tiles.wisp[Math.floor(rnd(4) * tiles.wisp.length) % tiles.wisp.length], first = cards.position.length / 3, half = (2.2 + 1.2 * rnd(5)) * mm, start = .1 + .6 * rnd(6);
      for (let j = 0; j <= steps; j++) {
        const s = seat(slerp(from, up, j / steps), (.3 + 2.4 * (j / steps) ** 1.4) * mm), across = unit(cross(s.n, sub(world(up), world(from))));
        for (let c = 0; c < 2; c++) push(s, add(s.p, across, (c * 2 - 1) * half), s.n, .8 + .2 * j / steps, picture(tile, c, start + .1 * j / steps));
        if (j) { const b = first + j * 2; cards.index.push(b - 2, b + 1, b - 1, b - 2, b, b + 1); }
      }
      laid++;
    }
  };

  // Hair from further back on the head: it lies under the outer locks and is what shows in their slits.
  layer(2, game ? 14 : 44, { inset: 9, spread: 16, full: game ? .72 : .8, out: .8 * mm, steps: game ? 6 : 14, shade: .74, wide: 1.9, most: 20 });
  // The outer locks grow at the hairline and run all the way back.
  layer(1, game ? 40 : 72, { inset: -.4, full: 1, out: 2.2 * mm, steps: game ? 10 : 20, shade: 1, wide: game ? 1.8 : 1.6, most: game ? 20 : 15 });
  if (!game) fuzz(5, 56);
  sideburns();
  // A game model's picture is too small to keep single strands whole.
  if (!game) wisps(3, 44, 9);
  return laid;
}
