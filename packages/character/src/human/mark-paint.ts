// Marks painted into the adult's face texture at the textured presets:
// freckles, sun spots, a beauty mark, a healed scar, eyeliner and graphic
// paint (naturalTone, spot, scatter, the builders, paintFaceMarks and markFace
// in character-view/human-face-marks.js at 2761eb1). The marks go into the
// face paint the complexion made, so the renderer and the game export need
// nothing new. The adult has no facial hair, so nothing keeps pigment out from
// under a beard.

import * as T from "three";
import { context2d, type Raster } from "../raster.js";
import type { BrowName, HumanBody } from "./body.js";
import {
  browCover,
  chartDensity,
  chartPixel,
  chartPoint,
  faceChart,
  type FaceChart,
} from "./chart.js";
import { randomStream } from "./identity.js";
import { faceMarkKindTable, type FaceMark } from "./marks.js";
import {
  boxAround,
  halfOf,
  hash,
  noise,
  placements,
  scarShapes,
  sidesOf,
  slope,
  toLine,
  type MarkShape,
  type Near,
} from "./scars.js";

type Rgb = ReadonlyArray<number>;
type Box = readonly [number, number, number, number];

/** Pigments a painted mark takes when it names no tone. */
export const faceMarkPalette = [
  "#ece6d8",
  "#d9a441",
  "#c8452f",
  "#1f8a8a",
  "#2b4fa8",
  "#6b4aa0",
  "#4f9a5b",
  "#c2387d",
  "#35b8d0",
  "#1d1b1e",
] as const;

// Colour. Paint and material colours are multiplied in linear light.
const decode = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const encodeValue = (v: number) =>
  255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
// Bytes for linear values, looked up by the square root so dark values keep their precision.
const encode = Uint8Array.from({ length: 4097 }, (_, i) =>
  Math.round(Math.min(255, Math.max(0, encodeValue((i / 4096) ** 2)))),
);
const toByte = (v: number) =>
  encode[Math.round(Math.sqrt(Math.min(1, Math.max(0, v))) * 4096)] ?? 0;
const dec = (byte: number) => decode[byte] ?? 0;
const linear = (text: string) => [1, 3, 5].map((at) => dec(parseInt(text.slice(at, at + 2), 16)));
const weight = (c: Rgb) => 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const f = (field: ArrayLike<number>, at: number) => field[at] ?? 0;

/** The tone a mark has on this skin when it names none, as linear red, green and blue. */
export function naturalTone(mark: FaceMark, skin: Rgb): number[] {
  const fair = smooth(weight(skin), 0.03, 0.4),
    scale = (dark: Rgb, light: Rgb) =>
      skin.map((v, k) => v * mix(dark[k] ?? 0, light[k] ?? 0, fair));
  switch (mark.kind) {
    case "Freckles":
      return scale([0.42, 0.36, 0.33], [0.6, 0.4, 0.27]);
    case "Sun spots":
      return scale([0.56, 0.5, 0.46], [0.7, 0.53, 0.4]);
    case "Beauty mark":
      return scale([0.22, 0.18, 0.16], [0.2, 0.13, 0.1]);
    case "Scar":
      // Healed skin is paler and pinker than the skin around it, most of all on dark skin.
      return scale([1.9, 1.42, 1.36], [1.16, 0.9, 0.88]);
    case "Eyeliner":
      return skin.map((v, k) => mix([0.012, 0.01, 0.011][k] ?? 0, v, 0.06));
    default:
      return linear(faceMarkPalette[mark.seed % faceMarkPalette.length] ?? "#000000");
  }
}
const toneOf = (mark: FaceMark, skin: Rgb) =>
  mark.tone ? linear(mark.tone) : naturalTone(mark, skin);

interface Spot extends MarkShape {
  readonly box: Box;
}
// A round or ragged spot that lies on the skin: round on the face wherever the layout stretches.
function spot(
  c: FaceChart,
  at: number,
  cx: number,
  cy: number,
  radius: number,
  opacity: number,
  {
    stretch = 1,
    angle = 0,
    ragged = 0,
    phase = 0,
    core = 0.45,
  }: { stretch?: number; angle?: number; ragged?: number; phase?: number; core?: number } = {},
): Spot {
  const W = c.width,
    cz = f(c.z, at),
    n = [f(c.nx, at), f(c.ny, at), f(c.nz, at)] as const;
  // Two directions in the skin at the centre.
  let e1 = [n[2], 0, -n[0]];
  const size = Math.hypot(...e1) || 1;
  e1 = e1.map((v) => v / size);
  const [e10 = 0, e11 = 0, e12 = 0] = e1;
  const e2 = [n[1] * e12 - n[2] * e11, n[2] * e10 - n[0] * e12, n[0] * e11 - n[1] * e10] as const;
  const cos = Math.cos(angle),
    sin = Math.sin(angle),
    rx = radius * stretch,
    ry = radius / stretch,
    half =
      Math.ceil(
        (Math.max(rx, ry) * (1 + ragged) * 1.7) / Math.sqrt(Math.max(0.04, f(c.area, at))),
      ) + 1,
    i = at % W,
    j = (at - i) / W;
  return {
    box: [i - half, j - half, i + half, j + half],
    rough: null,
    alpha(mx, my, mz) {
      const dx = mx - cx,
        dy = my - cy,
        dz = mz - cz,
        a = dx * e10 + dy * e11 + dz * e12,
        b = dx * e2[0] + dy * e2[1] + dz * e2[2],
        u = (a * cos + b * sin) / rx,
        v = (b * cos - a * sin) / ry;
      let r = Math.sqrt(u * u + v * v);
      if (ragged && r < 1.6) {
        const turn = Math.atan2(v, u);
        r /=
          1 +
          ragged *
            (0.6 * Math.sin(2 * turn + phase) +
              0.4 * Math.sin(3 * turn + 2.3 * phase) +
              0.3 * Math.sin(5 * turn + 4.1 * phase));
      }
      return r >= 1 ? 0 : opacity * (1 - smooth(r, core, 1));
    },
  };
}

interface Scatter {
  readonly density: number;
  readonly centres: ReadonlyArray<readonly [number, number, number, number, number]>;
  readonly spread: number;
  readonly radius: readonly [number, number];
  readonly opacity: readonly [number, number];
  readonly ragged: number;
  readonly core: number;
  readonly grain: number;
}
const reach = 0.36;
// Pigment scattered over a region: many small spots whose places never move. Strength decides
// how many of them show, so turning it up adds spots between the ones already there.
function scatter(mark: FaceMark, c: FaceChart, brow: Float32Array, s: Scatter): Spot[] {
  const W = c.width,
    H = c.height,
    u = c.unit,
    seed = mark.seed,
    wide = (0.55 + 0.9 * mark.size) * s.spread,
    dx = (mark.across ?? 0) * reach * u,
    dy = (mark.up ?? 0) * reach * u,
    candidates = 220000,
    perPixel = (W * H) / candidates,
    next = randomStream(seed ^ 0x3c6ef372),
    spots: Spot[] = [];
  for (let k = 0; k < candidates; k++) {
    const px = next() * W,
      py = next() * H,
      rank = next(),
      at = Math.floor(py) * W + Math.floor(px);
    if (f(c.skin, at) < 0.35 || f(c.lip, at) > 0.04 || f(c.wet, at) > 0.02) continue;
    const mx = f(c.x, at),
      my = f(c.y, at);
    let field = 0;
    for (const [out, up, sx, sy, gain] of s.centres) {
      // Each cluster on the middle is given once; the others once for each side.
      for (const sign of out === 0 ? [0] : [1, -1]) {
        const ex = (mx - sign * (out * u + dx) - (sign ? 0 : dx)) / (sx * u * wide),
          ey = (my - up * u - dy) / (sy * u * wide);
        field += gain * Math.exp(-(ex * ex + ey * ey));
      }
    }
    if (mark.side !== "Both") field *= smooth((mark.side === "Left" ? 1 : -1) * mx, -5, 7);
    // The eye sockets stay nearly clear.
    field *= 0.12 + 0.88 * smooth(Math.hypot(Math.abs(mx) - 0.5 * u, my * 1.5) / u, 0.2, 0.42);
    // Pigment gathers in loose groups.
    const group = 0.3 + 1.4 * noise(mx / s.grain + 31, my / s.grain + 17, seed);
    const expected =
      s.density *
      Math.min(1, field) *
      group *
      (1 - 0.85 * f(c.lid, at)) *
      (1 - f(brow, at)) *
      Math.min(0.7, f(c.area, at)) *
      perPixel;
    if (rank >= expected) continue;
    const a = hash(k, 1, seed),
      b = hash(k, 2, seed),
      r = s.radius[0] + (s.radius[1] - s.radius[0]) * a ** 2.4;
    spots.push(
      spot(
        c,
        at,
        mx,
        my,
        r * (0.85 + 0.3 * mark.size),
        s.opacity[0] + (s.opacity[1] - s.opacity[0]) * b * (1 - 0.4 * a),
        {
          stretch: 1 + 0.2 * hash(k, 3, seed),
          angle: 3.1416 * hash(k, 4, seed),
          ragged: s.ragged,
          phase: 6.2832 * hash(k, 5, seed),
          core: s.core,
        },
      ),
    );
  }
  return spots;
}

interface Layer {
  readonly keep: number;
  readonly beard: number;
  readonly shapes: ReadonlyArray<MarkShape>;
}
interface Context {
  readonly body: HumanBody;
  readonly c: FaceChart;
  readonly brow: BrowName;
  readonly skin: Rgb;
}
type Builder = (mark: FaceMark, x: Context) => Layer;
type Centres = Scatter["centres"];
const pick = <V>(table: Readonly<Record<string, V>>, key: string): V => {
  const v = table[key];
  if (v === undefined) throw new Error(`Unknown face mark place: ${key}.`);
  return v;
};

const builders: Readonly<Record<FaceMark["kind"], Builder>> = {
  Freckles(mark, { c, brow, body }) {
    const centres = pick<Centres>(
      {
        "Nose and cheeks": [
          [0, -0.34, 0.26, 0.2, 1],
          [0.6, -0.38, 0.33, 0.23, 0.95],
        ],
        Cheeks: [[0.66, -0.42, 0.3, 0.24, 1]],
        Nose: [[0, -0.36, 0.2, 0.26, 1]],
        "Whole face": [
          [0, -0.32, 1.05, 0.98, 0.42],
          [0, -0.34, 0.8, 0.26, 0.4],
        ],
        Forehead: [[0, 0.74, 0.72, 0.3, 1]],
      },
      mark.place,
    );
    const s = mark.strength;
    return {
      keep: 1,
      beard: 0.9,
      shapes: scatter(mark, c, browCover(body, brow), {
        density: 0.42 * (0.1 + 0.9 * s ** 1.4),
        centres,
        spread: 1,
        radius: [0.35, 1.25],
        opacity: [0.2 + 0.14 * s, 0.55 + 0.3 * s],
        ragged: 0,
        core: 0.12,
        grain: 9,
      }),
    };
  },
  "Sun spots"(mark, { c, brow, body }) {
    const centres = pick<Centres>(
      {
        Cheekbones: [[0.74, -0.3, 0.3, 0.2, 1]],
        Temples: [[0.98, 0.24, 0.2, 0.32, 1]],
        Forehead: [[0, 0.78, 0.7, 0.28, 1]],
        "Whole face": [[0, -0.2, 1.05, 1.0, 0.75]],
      },
      mark.place,
    );
    const s = mark.strength;
    return {
      keep: 1,
      beard: 0.9,
      shapes: scatter(mark, c, browCover(body, brow), {
        density: 0.016 * (0.25 + 0.75 * s),
        centres,
        spread: 1,
        radius: [1.0, 3.3],
        opacity: [0.16 + 0.1 * s, 0.3 + 0.3 * s],
        ragged: 0.22,
        core: 0.2,
        grain: 16,
      }),
    };
  },
  "Beauty mark"(mark, { c, body }) {
    const anchor = pick<readonly [number, number]>(
      {
        Cheek: [0.62, -0.62],
        "Above lip": [0.3, -0.84],
        "Under eye": [0.62, -0.3],
        Chin: [0.2, -1.48],
        Temple: [1.0, 0.12],
        Jaw: [0.8, -1.15],
      },
      mark.place,
    );
    const shapes: MarkShape[] = [];
    for (const place of placements(mark, c, anchor)) {
      // The seed moves it a little, so each drawn face wears it in its own spot.
      const cx = place.centre[0] + place.sign * (hash(1, 7, mark.seed) - 0.5) * 0.12 * c.unit,
        cy = place.centre[1] + (hash(2, 7, mark.seed) - 0.5) * 0.12 * c.unit,
        at = chartPixel(body, cx, cy);
      if (at < 0) continue;
      shapes.push(
        spot(c, at, f(c.x, at), f(c.y, at), 0.65 + 1.0 * mark.size, 0.55 + 0.42 * mark.strength, {
          stretch: 1 + 0.2 * hash(3, 7, mark.seed),
          angle: 3.1416 * hash(4, 7, mark.seed),
          core: 0.62,
        }),
      );
    }
    return { keep: 1, beard: 0.6, shapes };
  },
  Scar(mark, { c, skin }) {
    return { keep: 0.8, beard: 0.5, shapes: scarShapes(mark, c, skin) };
  },
  Eyeliner(mark, { c, body }) {
    const shapes: MarkShape[] = [],
      smoked = mark.place === "Smoked",
      winged = mark.place === "Winged",
      strength = 0.5 + 0.48 * mark.strength,
      thick =
        (smoked ? 1.1 + 2.4 * mark.size : 0.8 + 1.9 * mark.size) *
        (mark.place === "Lash line" ? 0.85 : 1);
    for (const sign of sidesOf(mark, false)) {
      const eye = c.points.eyes[sign > 0 ? 0 : 1],
        lines: Array<readonly [ReadonlyArray<readonly [number, number]>, number]> = [
          [eye.upper, 1],
          ...(smoked ? [[eye.lower, 0.5] as const] : []),
        ];
      for (const [margin, gain] of lines) {
        // The lid margin as seen from the front. The liner is measured from it in that view,
        // which is where the edge of the lid shows.
        const flat = margin.map(([px, py]) => {
            const [x, y] = chartPoint(body, px, py);
            return [x, y] as const;
          }),
          xs = flat.map((p) => p[0]),
          ys = flat.map((p) => p[1]),
          pad = thick * (smoked ? 2.2 : 1) + 2,
          box = boxAround(
            c,
            Math.min(...xs) - pad,
            Math.min(...ys) - pad,
            Math.max(...xs) + pad,
            Math.max(...ys) + pad,
          ),
          near: Near = { distance: 0, along: 0, nx: 0, ny: 1 },
          lower = margin === eye.lower;
        if (!box) continue;
        shapes.push({
          liner: true,
          box,
          rough: null,
          alpha(mx, my) {
            toLine(flat, mx, my, near);
            const t = near.along;
            if (smoked)
              return (
                strength * gain * Math.exp(-((near.distance / thick) ** 2)) * smooth(t, 0, 0.2)
              );
            // The upper lid is above its margin.
            if ((lower ? -near.ny : near.ny) * near.distance < -0.35) return 0;
            const line = thick * (0.3 + 0.7 * smooth(t, 0.1, 0.85));
            return (
              strength * (1 - smooth(near.distance, line, line + 0.45)) * smooth(t, 0.03, 0.24)
            );
          },
        });
      }
      if (winged) {
        // The wing leaves the outer corner up and out, and thins to a point.
        const [cx, cy] = eye.outer,
          far = 3 + 7.5 * mark.size,
          dir = [sign * Math.cos(0.42), Math.sin(0.42)] as const,
          tip = [cx + dir[0] * far, cy + dir[1] * far] as const,
          root = [cx - dir[0] * 1.2, cy - dir[1] * 1.2 + 0.2] as const,
          box = boxAround(
            c,
            Math.min(root[0], tip[0]) - 3,
            Math.min(root[1], tip[1]) - 3,
            Math.max(root[0], tip[0]) + 3,
            Math.max(root[1], tip[1]) + 3,
          ),
          near: Near = { distance: 0, along: 0, nx: 0, ny: 1 };
        if (box)
          shapes.push({
            liner: true,
            box,
            rough: null,
            alpha(mx, my, _mz, at) {
              toLine([root, tip], mx, my, near);
              const half = thick * 0.95 * (1 - near.along) ** 0.9 + 0.05;
              return near.along >= 1
                ? 0
                : strength *
                    (1 -
                      smooth(
                        near.distance * slope(c, at, near.nx, near.ny),
                        half * 0.55,
                        half + 0.3,
                      ));
            },
          });
      }
    }
    return { keep: 0.35, beard: 0, shapes };
  },
  "Paint band"(mark, { c }) {
    // Anchor, angle, half the length in eye distances, and the narrowest and widest band in millimetres.
    const [anchor, angle, long, thin, wide] = pick<
      readonly [readonly [number, number], number, number, number, number]
    >(
      {
        Eyes: [[0, 0.03], 0, 1.16, 9, 30],
        "Nose bridge": [[0, -0.3], 0, 0.98, 4, 20],
        Cheek: [[0.72, -0.5], -18, 0.36, 4, 16],
        Forehead: [[0, 0.78], 0, 0.85, 4, 20],
        Chin: [[0, -1.5], 90, 0.3, 4, 20],
      },
      mark.place,
    );
    const shapes: MarkShape[] = [],
      seed = mark.seed,
      half = (thin + (wide - thin) * mark.size) / 2,
      length = long * c.unit,
      strength = 0.4 + 0.59 * mark.strength;
    for (const place of placements(mark, c, anchor, angle)) {
      const [ax, ay] = place.along,
        [cx, cy] = place.centre,
        ex = Math.abs(ax) * length + Math.abs(ay) * half + 3,
        ey = Math.abs(ay) * length + Math.abs(ax) * half + 3,
        box = boxAround(c, cx - ex, cy - ey, cx + ex, cy + ey);
      if (!box) continue;
      shapes.push({
        box,
        rough: 0.74,
        alpha(mx, my) {
          const dx = mx - cx,
            dy = my - cy,
            along = dx * ax + dy * ay,
            across = dy * ax - dx * ay;
          // A brushed edge that wanders a little, and ends that run dry.
          const edge =
              half * (1 + 0.07 * (noise(along / 4 + 9, across > 0 ? 1 : 5, seed) - 0.5)) +
              0.35 * (noise(along / 1.3, across > 0 ? 2 : 6, seed) - 0.5),
            body = 1 - smooth(Math.abs(across), edge - 0.5, edge + 0.25),
            streak = noise(across / 0.7 + 40, along / 26, seed),
            end = length * (0.86 + 0.14 * streak);
          // A band kept to one half ends at the middle of the face as a stroke does, not on a ruled line.
          const kept = place.half ? smooth(place.sign * mx + 5 * (streak - 0.5), -1.8, 1.8) : 1;
          return (
            strength *
            body *
            (1 - smooth(Math.abs(along), end - 3.5, end)) *
            (0.9 + 0.1 * streak) *
            kept
          );
        },
      });
    }
    return { keep: 0.5, beard: 0.5, shapes };
  },
  "Paint streaks"(mark, { c }) {
    const [anchor, angle, long] = pick<readonly [readonly [number, number], number, number]>(
      {
        Cheek: [[0.74, -0.5], -20, 0.42],
        "Under eye": [[0.52, -0.5], -90, 0.34],
        Forehead: [[0, 0.82], 90, 0.36],
        Chin: [[0, -1.44], -90, 0.28],
      },
      mark.place,
    );
    const shapes: MarkShape[] = [],
      seed = mark.seed,
      count = 2 + Math.floor(hash(1, 13, seed) * 2.6),
      half = 1.1 + 2.1 * mark.size,
      strength = 0.4 + 0.59 * mark.strength;
    for (const place of placements(mark, c, anchor, angle)) {
      const [ax, ay] = place.along,
        [cx, cy] = place.centre;
      for (let k = 0; k < count; k++) {
        // Strokes lie side by side. Each starts under the finger and thins as it is pulled.
        const off = (k - (count - 1) / 2) * half * 2.9,
          length = long * c.unit * (0.7 + 0.5 * hash(k, 14, seed)),
          start = (hash(k, 15, seed) - 0.5) * 5 - length / 2,
          from = [cx + ax * start - ay * off, cy + ay * start + ax * off] as const,
          to = [from[0] + ax * length, from[1] + ay * length] as const,
          box = boxAround(
            c,
            Math.min(from[0], to[0]) - half - 2,
            Math.min(from[1], to[1]) - half - 2,
            Math.max(from[0], to[0]) + half + 2,
            Math.max(from[1], to[1]) + half + 2,
          ),
          near: Near = { distance: 0, along: 0, nx: 0, ny: 1 };
        if (!box) continue;
        shapes.push({
          box,
          rough: 0.74,
          alpha(mx, my, _mz, at) {
            toLine([from, to], mx, my, near);
            const t = near.along,
              streak = noise((mx * ay - my * ax) / 0.6 + 7 * k, t * 2.2, seed),
              wide = half * (1 - 0.5 * t ** 1.5) * (0.96 + 0.08 * noise(t * 9, k, seed));
            return (
              strength *
              (1 -
                smooth(near.distance * slope(c, at, near.nx, near.ny), wide - 0.45, wide + 0.2)) *
              (1 - smooth(t, 0.55 + 0.4 * streak, 1)) *
              (0.9 + 0.1 * streak) *
              halfOf(place, mx)
            );
          },
        });
      }
    }
    return { keep: 0.5, beard: 0.5, shapes };
  },
  "Paint dots"(mark, { c, body }) {
    const u = c.unit,
      seed = mark.seed,
      strength = 0.45 + 0.52 * mark.strength,
      radius = 1.8 + 3.2 * mark.size,
      shapes: MarkShape[] = [];
    // A run of dots along a gentle arc: its ends, how far the middle bows, and how many.
    const [anchor, angle, long, bow, count] = pick<
      readonly [readonly [number, number], number, number, number, number]
    >(
      {
        "Under eye": [[0.54, -0.33], 6, 0.38, -0.07, 5],
        Brow: [[0.56, 0.36], 4, 0.42, 0.06, 5],
        "Nose bridge": [[0, -0.3], 0, 0.7, 0.03, 7],
        Forehead: [[0, 0.72], 90, 0.3, 0, 3],
        Chin: [[0, -1.46], 90, 0.15, 0, 3],
      },
      mark.place,
    );
    for (const place of placements(mark, c, anchor, angle)) {
      const [ax, ay] = place.along,
        [cx, cy] = place.centre;
      for (let k = 0; k < count; k++) {
        const t = count === 1 ? 0 : (k / (count - 1)) * 2 - 1,
          along = t * long * u,
          off = bow * u * (1 - t * t),
          mx = cx + ax * along - ay * off * place.sign,
          my = cy + ay * along + ax * off * place.sign;
        if (place.half && place.sign * mx < radius * 0.5) continue;
        const at = chartPixel(body, mx, my);
        if (at < 0 || Math.hypot(f(c.x, at) - mx, f(c.y, at) - my) > 2.5) continue;
        // The largest dot sits in the middle of a row and at the start of a column.
        const size =
          radius *
          (anchor[0] === 0 && angle === 90 ? 1 - 0.18 * k : 1 - 0.2 * Math.abs(t)) *
          (0.93 + 0.14 * hash(k, 17, seed));
        shapes.push({
          ...spot(c, at, mx, my, size, strength, {
            stretch: 1 + 0.08 * hash(k, 18, seed),
            angle: 3.1416 * hash(k, 19, seed),
            core: 0.72,
          }),
          rough: 0.74,
        });
      }
    }
    return { keep: 0.5, beard: 0.5, shapes };
  },
};

// How much of a mark's tone can show at most. Bright paint on dark skin needs the head's
// base colour raised, and this bounds by how much.
const fullest = (mark: FaceMark) =>
  mark.kind === "Scar" ? 0.95 : mark.kind === "Freckles" || mark.kind === "Sun spots" ? 0.9 : 0.99;

export interface MarkTarget {
  /** The colour paint as RGBA bytes, multiplied by the base colour when drawn. */
  readonly map: Uint8ClampedArray;
  /** Roughness paint, stored in green against a material value of 0.8. */
  readonly rough?: Uint8ClampedArray | undefined;
  /** Height paint. */
  readonly bump?: Uint8ClampedArray | undefined;
}

/**
 * Paint marks into a face texture of the chart's size times its density.
 * `skin` is the skin colour and `base` the head material's colour, both as
 * linear red, green and blue. Returns the colour the head material must have
 * with the changed paint, and which arrays were written.
 */
export function paintFaceMarks(
  body: HumanBody,
  target: MarkTarget,
  marks: ReadonlyArray<FaceMark>,
  look: { readonly skin: Rgb; readonly base: Rgb; readonly brow: BrowName },
): { base: number[]; changed: Set<"map" | "rough" | "bump"> } {
  const c = faceChart(body),
    W = c.width,
    H = c.height,
    D = chartDensity,
    FW = W * D,
    FH = H * D,
    skin = look.skin.map((v) => Math.max(v, 1e-4)),
    startBase = look.base.map((v) => Math.max(v, 1e-4)),
    skinWeight = weight(skin),
    map = target.map,
    changed = new Set<"map" | "rough" | "bump">();
  if (map.length !== FW * FH * 4) throw new Error("The face paint has an unexpected size.");
  // What belongs to the skin is painted first, so liner and paint lie over freckles and scars.
  const worn = (mark: FaceMark) => "worn" in faceMarkKindTable[mark.kind];
  const ordered = [...marks.filter((m) => !worn(m)), ...marks.filter(worn)],
    context: Context = { body, c, brow: look.brow, skin },
    layers = ordered.map((mark) => ({
      ...builders[mark.kind](mark, context),
      tone: toneOf(mark, skin),
      top: fullest(mark),
    }));

  // Raise the base colour above its starting headroom if a mark needs an even brighter tone, on an exact byte ratio.
  const base = startBase.map((v, k) => {
    const wanted = Math.max(
      v,
      ...layers.map((layer) => f(skin, k) + (f(layer.tone, k) - f(skin, k)) * layer.top),
    );
    if (wanted <= v * 1.0001) return v;
    const byte = Math.max(1, Math.floor(encodeValue(v / wanted)));
    return v / dec(byte);
  });
  if (base.some((v, k) => v !== startBase[k])) {
    const tables = base.map((v, k) =>
      Float32Array.from(decode, (d) => {
        const value = encodeValue(d * (f(startBase, k) / v));
        return Math.abs(value - Math.round(value)) < 1e-4 ? Math.round(value) : value;
      }),
    );
    for (let j = 0, p = 0; j < FH; j++)
      for (let i = 0; i < FW; i++, p += 4) {
        // One threshold for the three channels: the rounding shows as grain, never as colour.
        const dither = hash(i, j, 0x51f15e);
        for (let k = 0; k < 3; k++)
          map[p + k] = Math.floor(f(tables[k] ?? decode, f(map, p + k)) + dither);
      }
    changed.add("map");
  }

  for (const layer of layers)
    for (const shape of layer.shapes) {
      const i0 = Math.max(0, Math.floor(shape.box[0] * D)),
        i1 = Math.min(FW - 1, Math.ceil((shape.box[2] + 1) * D)),
        j0 = Math.max(0, Math.floor(shape.box[1] * D)),
        j1 = Math.min(FH - 1, Math.ceil((shape.box[3] + 1) * D));
      for (let j = j0; j <= j1; j++) {
        const fy = Math.min(H - 1.001, Math.max(0, (j + 0.5) / D - 0.5)),
          sj = Math.floor(fy),
          b = fy - sj;
        for (let i = i0; i <= i1; i++) {
          const fx = Math.min(W - 1.001, Math.max(0, (i + 0.5) / D - 0.5)),
            si = Math.floor(fx),
            a = fx - si,
            at = sj * W + si,
            w0 = (1 - a) * (1 - b),
            w1 = a * (1 - b),
            w2 = (1 - a) * b,
            w3 = a * b,
            read = (field: ArrayLike<number>) =>
              w0 * f(field, at) +
              w1 * f(field, at + 1) +
              w2 * f(field, at + W) +
              w3 * f(field, at + W + 1);
          const open = read(c.skin);
          if (open <= 0.004) continue;
          const nearest = at + (a > 0.5 ? 1 : 0) + (b > 0.5 ? W : 0);
          let alpha = shape.alpha(read(c.x), read(c.y), read(c.z), nearest);
          if (alpha <= 0.004) continue;
          // Lips and eyes stay as they are. Eyeliner alone goes onto the rim of the lid.
          const eye = read(c.eye);
          alpha *=
            open *
            (1 - smooth(read(c.lip), 0.03, 0.22)) *
            (shape.liner ? smooth(eye, -0.8, 0.2) : 1 - smooth(read(c.wet), 0.04, 0.5));
          if (alpha <= 0.004) continue;
          const p = (j * FW + i) * 4,
            tone = shape.tone ?? layer.tone,
            now = [
              dec(f(map, p)) * f(base, 0),
              dec(f(map, p + 1)) * f(base, 1),
              dec(f(map, p + 2)) * f(base, 2),
            ],
            // Pores, planes and brow hairs under the mark still show through it.
            shade = 1 + (Math.min(1.08, Math.max(0.45, weight(now) / skinWeight)) - 1) * layer.keep;
          for (let k = 0; k < 3; k++)
            map[p + k] = toByte(
              (f(now, k) + (Math.min(f(base, k), f(tone, k) * shade) - f(now, k)) * alpha) /
                f(base, k),
            );
          changed.add("map");
          const rough = target.rough,
            bump = target.bump;
          if (shape.rough != null && rough) {
            rough[p + 1] = Math.round(
              mix(f(rough, p + 1), Math.min(255, (shape.rough / 0.8) * 255), alpha * 0.8),
            );
            changed.add("rough");
          }
          if (shape.ridge && bump) {
            for (let k = 0; k < 3; k++)
              bump[p + k] = Math.min(255, Math.round(f(bump, p + k) + 128 * shape.ridge * alpha));
            changed.add("bump");
          }
          if (shape.groove && bump) {
            const low = 1 - shape.groove * alpha;
            for (let k = 0; k < 3; k++) bump[p + k] = Math.round(f(bump, p + k) * low);
            changed.add("bump");
          }
        }
      }
    }
  return { base, changed };
}

const isCanvas = (value: unknown): value is HTMLCanvasElement =>
  typeof value === "object" &&
  value !== null &&
  "getContext" in value &&
  typeof Reflect.get(value, "width") === "number";

/**
 * Add marks to a face material made by `faceMaterial`. The material is changed
 * and returned; without marks it comes back untouched.
 */
export function markFace(
  material: T.MeshStandardMaterial,
  raster: Raster,
  body: HumanBody,
  marks: ReadonlyArray<FaceMark>,
  brow: BrowName,
): T.MeshStandardMaterial {
  const source: unknown = material.map?.image;
  const { width: W, height: H } = faceChart(body);
  if (!marks.length || !isCanvas(source) || !material.map) return material;
  if (source.width !== W * chartDensity || source.height !== H * chartDensity) return material;
  const currentBase = [material.color.r, material.color.g, material.color.b];
  const stored: unknown = material.userData["skinColor"];
  const trueSkin = Array.isArray(stored) ? stored.map(Number) : currentBase;
  const copy = (image: HTMLCanvasElement) => {
    const canvas = raster.canvas(image.width, image.height);
    const pen = context2d(canvas, { willReadFrequently: true });
    pen.drawImage(image, 0, 0);
    return { canvas, pen, pixels: pen.getImageData(0, 0, canvas.width, canvas.height) };
  };
  const sameSize = (t: T.Texture | null) => {
    const image: unknown = t?.image;
    return isCanvas(image) && image.width === source.width && image.height === source.height
      ? image
      : null;
  };
  const relief = marks.some((mark) => mark.kind === "Scar" || mark.kind.startsWith("Paint"));
  const roughImage = relief ? sameSize(material.roughnessMap) : null,
    bumpImage = relief ? sameSize(material.bumpMap) : null;
  const colour = copy(source),
    rough = roughImage ? copy(roughImage) : null,
    bump = bumpImage ? copy(bumpImage) : null;
  const { base, changed } = paintFaceMarks(
    body,
    { map: colour.pixels.data, rough: rough?.pixels.data, bump: bump?.pixels.data },
    marks,
    { skin: trueSkin, base: currentBase, brow },
  );
  const texture = (layer: typeof colour, like: T.Texture) => {
    layer.pen.putImageData(layer.pixels, 0, 0);
    const t = new T.CanvasTexture(layer.canvas);
    t.colorSpace = like.colorSpace;
    t.anisotropy = like.anisotropy;
    return t;
  };
  // The ambient occlusion and metalness maps are the roughness map, and stay the unmarked one as in G0.
  if (changed.has("map")) material.map = texture(colour, material.map);
  if (rough && material.roughnessMap && changed.has("rough"))
    material.roughnessMap = texture(rough, material.roughnessMap);
  if (bump && material.bumpMap && changed.has("bump"))
    material.bumpMap = texture(bump, material.bumpMap);
  material.color.setRGB(base[0] ?? 0, base[1] ?? 0, base[2] ?? 0);
  return material;
}
