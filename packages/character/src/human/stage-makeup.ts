import type { HumanBody, BrowName } from "./body.js";
import { chartPoint, chartDensity, faceChart, browCover, type FaceChart } from "./chart.js";
type Point = readonly [number, number];
type Values = ArrayLike<number>;
const value = (a: Values, i: number) => a[i] ?? 0;
const designs = {
  "Plum stage": {
    wing: "#3a1250",
    wingAlpha: 0.9,
    crease: "#4a1762",
    creaseAlpha: 0.84,
    lid: "#c98be8",
    lidAlpha: 0.84,
    lidRough: 0.26,
    pearl: "#f0ddf8",
    pearlAlpha: 0.8,
    browLift: "#e8d2f2",
    browLiftAlpha: 0.42,
    liner: "#1b0b22",
    linerAlpha: 0.92,
    lowerAlpha: 0.52,
    wingReach: 12.2,
    wingLift: 7.4,
    lipEdge: "#440a25",
    lipBody: "#881548",
    lipCenter: "#ba2d6c",
    lipAlpha: 0.88,
    lipRough: 0.34,
    drape: "#9e487a",
    drapeAlpha: 0.34,
  },
  "Smoked charcoal": {
    wing: "#2e2725",
    wingAlpha: 0.72,
    crease: "#433a37",
    creaseAlpha: 0.56,
    lid: "#b8a89d",
    lidAlpha: 0.48,
    lidRough: 0.34,
    pearl: "#e3d6cb",
    pearlAlpha: 0.48,
    browLift: "#d9cbc0",
    browLiftAlpha: 0.18,
    liner: "#1c1716",
    linerAlpha: 0.78,
    lowerAlpha: 0.3,
    wingReach: 9.6,
    wingLift: 5.2,
    lipEdge: "#5c3336",
    lipBody: "#8f5459",
    lipCenter: "#b57479",
    lipAlpha: 0.68,
    lipRough: 0.42,
    drape: "#8c6563",
    drapeAlpha: 0.14,
  },
  "Gilded nocturne": {
    wing: "#261d34",
    wingAlpha: 0.9,
    crease: "#3f2732",
    creaseAlpha: 0.82,
    lid: "#e2b254",
    lidAlpha: 0.88,
    lidRough: 0.24,
    pearl: "#f7e2a8",
    pearlAlpha: 0.84,
    browLift: "#efd79e",
    browLiftAlpha: 0.42,
    liner: "#181116",
    linerAlpha: 0.94,
    lowerAlpha: 0.5,
    wingReach: 12.0,
    wingLift: 7.2,
    lipEdge: "#451111",
    lipBody: "#8b241d",
    lipCenter: "#b83c2b",
    lipAlpha: 0.86,
    lipRough: 0.34,
    drape: "#a25d40",
    drapeAlpha: 0.32,
  },
  "Crimson aria": {
    wing: "#3e0e1e",
    wingAlpha: 0.92,
    crease: "#5e152b",
    creaseAlpha: 0.84,
    lid: "#e6b8c4",
    lidAlpha: 0.82,
    lidRough: 0.26,
    pearl: "#fae6ec",
    pearlAlpha: 0.8,
    browLift: "#f2d6de",
    browLiftAlpha: 0.4,
    liner: "#180a0f",
    linerAlpha: 0.95,
    lowerAlpha: 0.52,
    wingReach: 12.6,
    wingLift: 7.8,
    lipEdge: "#4e0712",
    lipBody: "#9d1124",
    lipCenter: "#cf263c",
    lipAlpha: 0.92,
    lipRough: 0.32,
    drape: "#a8445c",
    drapeAlpha: 0.32,
  },
};
const decode = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const encodeValue = (v: number) =>
  255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const encode = Uint8Array.from({ length: 4097 }, (_, i) =>
  Math.round(Math.min(255, Math.max(0, encodeValue((i / 4096) ** 2)))),
);
const toByte = (v: number) =>
  value(encode, Math.round(Math.sqrt(Math.min(1, Math.max(0, v))) * 4096));
const hexLinear = (text: string) =>
  [1, 3, 5].map((at) => value(decode, parseInt(text.slice(at, at + 2), 16)));
const luma = (c: Values) => 0.2126 * value(c, 0) + 0.7152 * value(c, 1) + 0.0722 * value(c, 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (v: number, a: number, b: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function toLine(
  pts: readonly Point[],
  mx: number,
  my: number,
  out: { distance: number; along: number; nx: number; ny: number },
) {
  let best = Infinity,
    at = 0,
    total = 0,
    nx = 0,
    ny = 1;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k] ?? [0, 0],
      [bx, by] = pts[k + 1] ?? [0, 0],
      ex = bx - ax,
      ey = by - ay,
      len = Math.hypot(ex, ey) || 1;
    const t = clamp(((mx - ax) * ex + (my - ay) * ey) / (len * len), 0, 1);
    const dx = mx - ax - ex * t,
      dy = my - ay - ey * t,
      d = Math.hypot(dx, dy);
    if (d < best) {
      best = d;
      at = total + t * len;
      nx = -ey / len;
      ny = ex / len;
      if (dx * nx + dy * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
    }
    total += len;
  }
  out.distance = best;
  out.along = at / Math.max(total, 1e-6);
  out.nx = nx;
  out.ny = ny;
}

function boxAround(
  c: FaceChart,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): readonly [number, number, number, number] | null {
  const W = c.width,
    H = c.height;
  let u0 = W,
    v0 = H,
    u1 = -1,
    v1 = -1;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const at = j * W + i;
      if (value(c.skin, at) < 0.02) continue;
      if (
        value(c.x, at) >= x0 &&
        value(c.x, at) <= x1 &&
        value(c.y, at) >= y0 &&
        value(c.y, at) <= y1
      ) {
        if (i < u0) u0 = i;
        if (i > u1) u1 = i;
        if (j < v0) v0 = j;
        if (j > v1) v1 = j;
      }
    }
  return u1 >= u0
    ? [Math.max(0, u0 - 2), Math.max(0, v0 - 2), Math.min(W - 1, u1 + 2), Math.min(H - 1, v1 + 2)]
    : null;
}

export function beardAt(
  body: HumanBody,
  name: string | undefined,
  u: number,
  v: number,
  complexion = false,
) {
  const gain =
    name === "Stubble"
      ? 0.5
      : name === "Moustache"
        ? 0.8
        : name === "Short beard"
          ? 0.9
          : name === "Full beard"
            ? 0.92
            : 0;
  if (!gain) return 0;
  const x = clamp(u * 180 - 0.5, 0, 178.999),
    y = clamp(v * 197 - 0.5, 0, 195.999),
    i = Math.floor(y) * 180 + Math.floor(x);
  const dx = x % 1,
    dy = y % 1;
  let cover = 0;
  for (const grid of name === "Moustache" ? body.growth.slice(0, 1) : body.growth) {
    cover = Math.max(
      cover,
      mix(
        mix(value(grid, i), value(grid, i + 1), dx),
        mix(value(grid, i + 180), value(grid, i + 181), dx),
        dy,
      ) / 255,
    );
  }
  return complexion && (name === "Full beard" || name === "Short beard")
    ? smooth(cover, 0.08, 0.86) ** 1.2 * gain
    : smooth(cover, 0.06, 0.7) * gain;
}
function guidesOf(body: HumanBody, c: FaceChart) {
  return ([0, 1] as const).map((idx) => {
    const sign = idx === 0 ? 1 : -1;
    const eye = c.points.eyes[idx];
    const toChart = ([px, py]: Point): Point => {
      const [x, y] = chartPoint(body, px, py);
      return [x, y];
    };
    const upper = eye.upper.map(toChart),
      lower = eye.lower.map(toChart);
    const sampleY = (pts: readonly Point[], ax: number) => {
      for (let k = 0; k < pts.length - 1; k++) {
        const a = Math.abs(pts[k]?.[0] ?? 0),
          b = Math.abs(pts[k + 1]?.[0] ?? 0);
        if ((ax >= a && ax <= b) || (ax >= b && ax <= a)) {
          const t = Math.abs(b - a) < 1e-5 ? 0 : (ax - a) / (b - a);
          return (pts[k]?.[1] ?? 0) + ((pts[k + 1]?.[1] ?? 0) - (pts[k]?.[1] ?? 0)) * t;
        }
      }
      return ax < Math.abs(pts[0]?.[0] ?? 0) ? (pts[0]?.[1] ?? 0) : (pts.at(-1)?.[1] ?? 0);
    };
    const innerAx = Math.abs(eye.inner[0]),
      outerAx = Math.abs(eye.outer[0]);
    const browPts = c.points.brows[idx] ?? [];
    const browY = (ax: number) => {
      for (let k = 0; k < browPts.length - 1; k++) {
        const a = Math.abs(browPts[k]?.[0] ?? 0),
          b = Math.abs(browPts[k + 1]?.[0] ?? 0);
        if ((ax >= a && ax <= b) || (ax >= b && ax <= a)) {
          const t = Math.abs(b - a) < 1e-5 ? 0 : (ax - a) / (b - a);
          return (browPts[k]?.[1] ?? 0) + ((browPts[k + 1]?.[1] ?? 0) - (browPts[k]?.[1] ?? 0)) * t;
        }
      }
      return ax < Math.abs(browPts[0]?.[0] ?? 0)
        ? (browPts[0]?.[1] ?? 0)
        : (browPts.at(-1)?.[1] ?? 0);
    };
    return { sign, eye, upper, lower, innerAx, outerAx, sampleY, browY };
  });
}

export const isStageMakeup = (name: string): name is keyof typeof designs =>
  Object.hasOwn(designs, name);
export function paintStageMakeup(
  body: HumanBody,
  target: { map: Uint8ClampedArray; rough: Uint8ClampedArray },
  styleName: keyof typeof designs,
  look: {
    skin: readonly number[];
    base: readonly number[];
    brow: BrowName;
    facialHair?: string | undefined;
    clippedBeard?: Uint8ClampedArray | null;
  },
) {
  const design = designs[styleName];
  const c = faceChart(body),
    W = c.width,
    H = c.height,
    D = chartDensity,
    FW = W * D,
    FH = H * D,
    map = target.map,
    rough = target.rough;
  if (map.length !== FW * FH * 4) throw new Error("The face paint has an unexpected size.");
  const skin = look.skin.map((v) => Math.max(v, 1e-4));
  const startBase = (look.base ?? skin).map((v) => Math.max(v, 1e-4));
  const fair = smooth(luma(skin), 0.05, 0.42);
  const brows = browCover(body, look.brow);

  const guides = guidesOf(body, c);

  const pearlGain = mix(0.66, 1.0, fair);
  const lidGain = mix(0.84, 1.0, fair);
  const tones = {
    wing: hexLinear(design.wing),
    crease: hexLinear(design.crease),
    lid: hexLinear(design.lid).map((v) => v * lidGain),
    pearl: hexLinear(design.pearl).map((v) => v * pearlGain),
    browLift: hexLinear(design.browLift).map((v) => v * mix(0.62, 0.98, fair)),
    liner: hexLinear(design.liner),
    lipEdge: hexLinear(design.lipEdge),
    lipBody: hexLinear(design.lipBody),
    lipCenter: hexLinear(design.lipCenter),
    drape: hexLinear(design.drape).map(
      (v, k) => mix(v * 0.72, v, fair) * 0.85 + value(skin, k) * 0.15,
    ),
  };

  const peakTarget = [0, 1, 2].map((k) =>
    Math.max(
      value(startBase, k),
      value(tones.lid, k) * 1.02,
      value(tones.pearl, k) * 1.02,
      value(tones.browLift, k),
      value(tones.lipCenter, k),
    ),
  );
  const base = startBase.map((v, k) => {
    if (value(peakTarget, k) <= v * 1.0001) return v;
    const byte = Math.max(1, Math.floor(encodeValue(v / value(peakTarget, k))));
    return v / value(decode, byte);
  });
  if (base.some((v, k) => v !== value(startBase, k))) {
    const tables = base.map((v, k) =>
      Uint8Array.from({ length: 256 }, (_, i) =>
        toByte((value(decode, i) * value(startBase, k)) / v),
      ),
    );
    for (let i = 0; i < map.length; i += 4) {
      map[i] = value(tables[0] ?? [], value(map, i));
      map[i + 1] = value(tables[1] ?? [], value(map, i + 1));
      map[i + 2] = value(tables[2] ?? [], value(map, i + 2));
    }
  }

  const blendPixel = (q: number, targetRgb: Values, alpha: number, targetRough: number) => {
    if (alpha <= 1e-4) return;
    const a = clamp(alpha, 0, 0.98);
    for (let k = 0; k < 3; k++) {
      const cur = value(decode, value(map, q + k)) * value(base, k);
      const next = cur + (value(targetRgb, k) - cur) * a;
      map[q + k] = toByte(next / value(base, k));
    }
    if (rough && targetRough !== null && targetRough !== undefined) {
      const curR = (value(rough, q + 1) / 255) * 0.8;
      const nextR = clamp(curR + (targetRough - curR) * a, 0.24, 0.8);
      rough[q + 1] = Math.round(255 * (nextR / 0.8));
    }
  };

  const near = { along: 0, distance: 0, nx: 0, ny: 0 };
  for (const g of guides) {
    const { sign, eye, upper, lower, innerAx, outerAx, sampleY, browY } = g;
    const span = outerAx - innerAx;
    const [ox, oy] = eye.outer;
    const [, iy] = eye.inner;
    const tipX = outerAx + design.wingReach;
    const tipY = oy + design.wingLift;
    const wdx = tipX - outerAx,
      wdy = tipY - oy,
      wLen = Math.hypot(wdx, wdy) || 1;
    const wux = wdx / wLen,
      wuy = wdy / wLen;
    const flickPts: Point[] = [
      [ox - sign * 1.0, oy + 0.2],
      [ox + sign * wux * 0.68 * wLen, oy + wuy * 0.68 * wLen],
    ];
    const creasePts: Point[] = [];
    for (let s = 0; s <= 12; s++) {
      const t = s / 12;
      if (t <= 0.72) {
        const u = t / 0.72;
        const ax = innerAx + span * (0.12 + 0.88 * u);
        const yUp = sampleY(upper, ax);
        const lift = 3.9 + 1.5 * Math.sin(Math.PI * Math.min(1, u * 0.92));
        creasePts.push([sign * ax, yUp + lift]);
      } else {
        const u = (t - 0.72) / 0.28;
        const ax = mix(outerAx, tipX, u);
        const yStart = sampleY(upper, outerAx) + 4.4;
        creasePts.push([sign * ax, mix(yStart, tipY, u ** 0.85)]);
      }
    }

    const xMin = Math.min(sign * (innerAx - 6), sign * (tipX + 6));
    const xMax = Math.max(sign * (innerAx - 6), sign * (tipX + 6));
    const box = boxAround(c, xMin, oy - 32, xMax, oy + 18);
    if (!box) continue;
    const [u0, v0, u1, v1] = box;

    for (let j = v0 * D; j <= v1 * D + D - 1; j++) {
      const cj = clamp(Math.floor(j / D), 0, H - 1);
      for (let i = u0 * D; i <= u1 * D + D - 1; i++) {
        const ci = clamp(Math.floor(i / D), 0, W - 1);
        const at = cj * W + ci;
        const skinM = value(c.skin, at);
        if (skinM < 0.05) continue;
        const wetClear = 1 - smooth(value(c.wet, at), 0.08, 0.55);
        if (wetClear < 0.02) continue;
        const browClear = 1 - smooth(value(brows, at), 0.12, 0.72);
        const beardDensity = look.clippedBeard
          ? value(look.clippedBeard, 4 * (cj * W + ci)) / 255
          : 0;
        const beardClear =
          1 -
          (look.clippedBeard
            ? look.facialHair === "Clipped beard"
              ? Math.min(0.96, 1.33 * beardDensity)
              : 0.32 * beardDensity
            : beardAt(body, look.facialHair, (ci + 0.5) / W, (cj + 0.5) / H));

        const fx = clamp((i + 0.5) / D - 0.5, 0, W - 1.001);
        const fy = clamp((j + 0.5) / D - 0.5, 0, H - 1.001);
        const xi = Math.floor(fx),
          yj = Math.floor(fy),
          fa = fx - xi,
          fb = fy - yj;
        const a00 = yj * W + xi,
          a10 = a00 + 1,
          a01 = a00 + W,
          a11 = a01 + 1;
        const mx =
          (value(c.x, a00) * (1 - fa) + value(c.x, a10) * fa) * (1 - fb) +
          (value(c.x, a01) * (1 - fa) + value(c.x, a11) * fa) * fb;
        const my =
          (value(c.y, a00) * (1 - fa) + value(c.y, a10) * fa) * (1 - fb) +
          (value(c.y, a01) * (1 - fa) + value(c.y, a11) * fa) * fb;
        if (mx * sign < 8) continue;

        const ax = Math.abs(mx);
        const tEye = (ax - innerAx) / span;
        const yUp = sampleY(upper, ax);
        const yBrow = browY(ax);
        const aboveUp = my - yUp;
        const belowBrow = yBrow - my;
        const q = (j * FW + i) * 4;
        const guard = skinM * wetClear * browClear * beardClear;

        const dxD = ax - 48.0,
          dyD = my - -15.5;
        const alongD = dxD * 0.58 + dyD * 0.81;
        const acrossD = -dxD * 0.81 + dyD * 0.58;
        const drapeM =
          Math.exp(-((alongD / 14.5) ** 2 + (acrossD / 7.2) ** 2)) *
          smooth(ax, 34.0, 42.0) *
          (1 - smooth(my, 4.0, 11.0));
        if (drapeM > 0.02) {
          blendPixel(
            q,
            tones.drape,
            design.drapeAlpha * drapeM * skinM * beardClear * browClear,
            0.58,
          );
        }

        const browBand =
          smooth(tEye, 0.35, 0.72) *
          (1 - smooth(tEye, 1.15, 1.55)) *
          Math.exp(-(((belowBrow - 2.1) / 1.8) ** 2));
        if (browBand > 0.02) {
          blendPixel(q, tones.browLift, design.browLiftAlpha * browBand * guard, 0.34);
        }

        const rx = ax - outerAx,
          ry = my - oy;
        const wingAlong = rx * wux + ry * wuy;
        const wingPerp = -rx * wuy + ry * wux;
        const lowerCut = smooth(wingPerp, -0.45, 0.85);
        const wingHeight = 6.8 * (1 - clamp(wingAlong / (wLen + 0.5), 0, 1)) ** 0.72 + 0.7;
        const wingBody =
          lowerCut *
          smooth(wingAlong, -8.5, -1.5) *
          (1 - smooth(wingAlong, wLen - 2.2, wLen + 1.0)) *
          (1 - smooth(wingPerp, wingHeight - 2.2, wingHeight + 1.4)) *
          smooth(belowBrow, 0.6, 2.8);
        if (wingBody > 0.015) {
          blendPixel(q, tones.wing, design.wingAlpha * wingBody * guard, 0.58);
        }

        const creaseH = 4.2 + 1.3 * Math.sin(Math.PI * clamp(tEye / 0.85, 0, 1));
        const lidM =
          smooth(tEye, 0.02, 0.18) *
          (1 - smooth(tEye, 0.6, 0.9)) *
          smooth(aboveUp, -0.2, 1.35) *
          (1 - smooth(aboveUp, creaseH - 1.35, creaseH + 0.95));
        if (lidM > 0.015) {
          blendPixel(q, tones.lid, design.lidAlpha * lidM * guard, design.lidRough);
        }

        toLine(creasePts, mx, my, near);
        const creaseWidth = 1.55 + 0.6 * Math.sin(Math.PI * clamp(near.along, 0, 1));
        const creaseBand =
          (1 - smooth(near.distance, creaseWidth * 0.35, creaseWidth + 1.35)) *
          smooth(near.along, 0.0, 0.18) *
          (1 - smooth(near.along, 0.86, 1.0)) *
          smooth(belowBrow, 0.7, 2.6) *
          (wingAlong > -1 ? lowerCut : 1);
        if (creaseBand > 0.015) {
          blendPixel(q, tones.crease, design.creaseAlpha * creaseBand * guard, 0.6);
        }

        const dInner = Math.hypot((ax - (innerAx - 1.4)) / 3.4, (my - (iy + 0.4)) / 2.7);
        const pearlM = Math.exp(-(dInner * dInner) * 1.6);
        if (pearlM > 0.02) {
          blendPixel(q, tones.pearl, design.pearlAlpha * pearlM * guard, 0.24);
        }

        toLine(upper, mx, my, near);
        const upSide = aboveUp >= -0.5;
        const lineW = 0.65 + 0.95 * smooth(near.along, 0.1, 0.88);
        const upLiner = upSide
          ? (1 - smooth(near.distance, lineW * 0.65, lineW + 0.55)) * smooth(near.along, 0.05, 0.2)
          : 0;
        toLine(flickPts, mx, my, near);
        const flickW = 1.55 * (1 - near.along) ** 0.85 + 0.15;
        const flickLiner =
          near.along < 0.99
            ? (1 - smooth(near.distance, flickW * 0.55, flickW + 0.45)) *
              smooth(near.along, 0.0, 0.08)
            : 0;
        toLine(lower, mx, my, near);
        const lowTight =
          near.along > 0.56
            ? (1 - smooth(near.distance, 0.6, 1.55)) *
              smooth(near.along, 0.56, 0.82) *
              design.lowerAlpha
            : 0;
        const linerM = Math.max(upLiner, flickLiner, lowTight);
        if (linerM > 0.02) {
          blendPixel(q, tones.liner, design.linerAlpha * linerM * guard, 0.52);
        }
      }
    }
  }

  const mouth = c.points.mouth;
  const mouthBox = boxAround(
    c,
    -(mouth.corner + 5),
    mouth.bottom - 5,
    mouth.corner + 5,
    mouth.top + 5,
  );
  if (mouthBox) {
    const [u0, v0, u1, v1] = mouthBox;
    const myMid = mouth.centre[1];
    for (let j = v0 * D; j <= v1 * D + D - 1; j++) {
      const cj = clamp(Math.floor(j / D), 0, H - 1);
      for (let i = u0 * D; i <= u1 * D + D - 1; i++) {
        const ci = clamp(Math.floor(i / D), 0, W - 1);
        const at = cj * W + ci;
        const lipVal = value(c.lip, at);
        if (lipVal < 0.12) continue;
        const skinM = value(c.skin, at);
        if (skinM < 0.05) continue;
        const lipMask = smooth(lipVal, 0.14, 0.52) * skinM;
        const ax = Math.abs(value(c.x, at));
        const cornerW = smooth(ax / Math.max(mouth.corner, 1), 0.36, 0.92);
        const edgeW = 1 - smooth(lipVal, 0.55, 0.92);
        const borderW = clamp(Math.max(cornerW * 0.88, edgeW * 0.92), 0, 1);
        const centerW =
          (1 - smooth(ax / Math.max(mouth.corner, 1), 0.08, 0.56)) *
          smooth(lipVal, 0.72, 0.96) *
          (1 - smooth(Math.abs(value(c.y, at) - myMid), 5.5, 9.5));
        const rgb = [0, 1, 2].map((k) => {
          let v = mix(value(tones.lipBody, k), value(tones.lipEdge, k), borderW);
          v = mix(v, value(tones.lipCenter, k), centerW * 0.72);
          return v;
        });
        const lipRough = mix(
          mix(design.lipRough + 0.06, design.lipRough + 0.14, borderW),
          design.lipRough - 0.04,
          centerW,
        );
        blendPixel((j * FW + i) * 4, rgb, design.lipAlpha * lipMask, lipRough);
      }
    }
  }

  return base;
}
