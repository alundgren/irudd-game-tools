import * as T from "three";
import { browCover, chartDensity, chartHeight, chartPoint, chartWidth, faceChart } from "./human-face-chart.js";
import { fittedBrow } from "./human-brow-styles.js";
import { facialHairStyle, growthAt } from "./human-face-hair.js";

const W = chartWidth,
  H = chartHeight,
  D = chartDensity;

export function browPigment(hair, skin, age = 0, makeup) {
  const light = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const powdered = Boolean(stageDesigns[makeup]);
  const root = new T.Color(powdered ? "#291d21" : "#30251f").lerp(hair, powdered ? 0.08 : 0.23);
  const value = light(root);
  root.lerp(new T.Color(value, value, value), 0.27);
  const most = (powdered ? 0.26 : 0.38 + 0.075 * age) * light(skin);
  if (light(root) > most) root.multiplyScalar(most / Math.max(light(root), 0.0001));
  return root;
}

const palettes = {
  "Rose stain": { lip: [0.98, 0.68, 0.77], shadow: [0.89, 0.79, 0.80], cheek: [1, 0.89, 0.93], strength: 0.70, roughness: 0.5 },
  "Burnished copper": { lip: [0.92, 0.55, 0.38], shadow: [0.85, 0.61, 0.43], cheek: [0.99, 0.83, 0.75], strength: 0.82, roughness: 0.47 },
  "Berry satin": { lip: [0.84, 0.32, 0.53], shadow: [0.73, 0.55, 0.75], cheek: [0.97, 0.78, 0.88], strength: 0.90, roughness: 0.45 },
  "Plum stage": { lip: [0.75, 0.22, 0.43], shadow: [0.53, 0.38, 0.68], cheek: [0.95, 0.70, 0.88], strength: 1, roughness: 0.42, stage: true },
  "Smoked charcoal": { lip: [0.88, 0.70, 0.71], shadow: [0.36, 0.37, 0.41], cheek: [0.96, 0.90, 0.88], strength: 0.91, roughness: 0.48, stage: true },
  "Gilded nocturne": { lip: [0.78, 0.26, 0.22], shadow: [0.46, 0.36, 0.30], cheek: [0.95, 0.76, 0.66], strength: 0.98, roughness: 0.44, stage: true },
  "Crimson aria": { lip: [0.84, 0.14, 0.22], shadow: [0.44, 0.24, 0.30], cheek: [0.96, 0.72, 0.78], strength: 1, roughness: 0.40, stage: true },
};

const stageDesigns = {
  "Plum stage": {
    wing: "#3a1250",
    wingAlpha: 0.90,
    crease: "#4a1762",
    creaseAlpha: 0.84,
    lid: "#c98be8",
    lidAlpha: 0.84,
    lidRough: 0.26,
    pearl: "#f0ddf8",
    pearlAlpha: 0.80,
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
    lowerAlpha: 0.30,
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
    wingAlpha: 0.90,
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
    lowerAlpha: 0.50,
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
    pearlAlpha: 0.80,
    browLift: "#f2d6de",
    browLiftAlpha: 0.40,
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

export const drawnMakeupStyles = ["Rose stain", "Burnished copper", "Berry satin", "Plum stage", "Smoked charcoal"];
export const stageMakeupStyles = Object.keys(stageDesigns);
export const makeupStyles = ["None", ...Object.keys(palettes)];
export const makeupPalette = (name) => (Object.hasOwn(palettes, name) ? palettes[name] : null);

export function mixMakeup(channels, palette, lips, lids, socket, blush, mask) {
  const opacity = mask * palette.strength;
  const lip = Math.min(1, lips * 1.22) * opacity;
  const lid = Math.min(1, (palette.stage ? lids * 0.22 + socket * socket * 0.08 : lids * 0.98 + socket * socket * 0.36)) * opacity;
  const cheek = Math.min(1, blush * blush * (palette.stage ? 0.16 : 0.84)) * opacity;
  for (let i = 0; i < 3; i++) {
    channels[i] *= (1 - lip * (1 - palette.lip[i])) * (1 - lid * (1 - palette.shadow[i])) * (1 - cheek * (1 - palette.cheek[i]));
  }
}

const decode = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const encodeValue = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const encode = Uint8Array.from({ length: 4097 }, (_, i) => Math.round(Math.min(255, Math.max(0, encodeValue((i / 4096) ** 2)))));
const toByte = (v) => encode[Math.round(Math.sqrt(Math.min(1, Math.max(0, v))) * 4096)];
const hexLinear = (text) => [1, 3, 5].map((at) => decode[parseInt(text.slice(at, at + 2), 16)]);
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (v, a, b) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

function toLine(pts, mx, my, out) {
  let best = Infinity,
    at = 0,
    total = 0,
    nx = 0,
    ny = 1;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k],
      [bx, by] = pts[k + 1],
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
      if (dx * nx + dy * ny < 0) (nx = -nx), (ny = -ny);
    }
    total += len;
  }
  out.distance = best;
  out.along = at / Math.max(total, 1e-6);
  out.nx = nx;
  out.ny = ny;
}

function boxAround(c, x0, y0, x1, y1) {
  let u0 = W,
    v0 = H,
    u1 = -1,
    v1 = -1;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const at = j * W + i;
      if (c.skin[at] < 0.02) continue;
      if (c.x[at] >= x0 && c.x[at] <= x1 && c.y[at] >= y0 && c.y[at] <= y1) {
        if (i < u0) u0 = i;
        if (i > u1) u1 = i;
        if (j < v0) v0 = j;
        if (j > v1) v1 = j;
      }
    }
  return u1 >= u0 ? [Math.max(0, u0 - 2), Math.max(0, v0 - 2), Math.min(W - 1, u1 + 2), Math.min(H - 1, v1 + 2)] : null;
}

const facialCovers = new Map();
function hairCover(name) {
  const style = facialHairStyle(name);
  if (!style) return null;
  if (!facialCovers.has(name)) {
    const cover = new Float32Array(W * H),
      at = [0, 0, 0];
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        growthAt((i + 0.5) / W, (j + 0.5) / H, at);
        cover[j * W + i] = smooth(Math.max(style.cover[0] * at[0], style.cover[1] * at[1], style.cover[2] * at[2]), 0.06, 0.7) * style.paint;
      }
    facialCovers.set(name, cover);
  }
  return facialCovers.get(name);
}

let eyeGuides = null;
function guidesOf(c) {
  if (eyeGuides) return eyeGuides;
  eyeGuides = [0, 1].map((idx) => {
    const sign = idx === 0 ? 1 : -1;
    const eye = c.points.eyes[idx];
    const upper = eye.upper.map(([px, py]) => chartPoint(px, py).slice(0, 2));
    const lower = eye.lower.map(([px, py]) => chartPoint(px, py).slice(0, 2));
    const sampleY = (pts, ax) => {
      for (let k = 0; k < pts.length - 1; k++) {
        const a = Math.abs(pts[k][0]),
          b = Math.abs(pts[k + 1][0]);
        if ((ax >= a && ax <= b) || (ax >= b && ax <= a)) {
          const t = Math.abs(b - a) < 1e-5 ? 0 : (ax - a) / (b - a);
          return pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t;
        }
      }
      return ax < Math.abs(pts[0][0]) ? pts[0][1] : pts.at(-1)[1];
    };
    const innerAx = Math.abs(eye.inner[0]),
      outerAx = Math.abs(eye.outer[0]);
    const browPts = c.points.brows[idx];
    const browY = (ax) => {
      for (let k = 0; k < browPts.length - 1; k++) {
        const a = Math.abs(browPts[k][0]),
          b = Math.abs(browPts[k + 1][0]);
        if ((ax >= a && ax <= b) || (ax >= b && ax <= a)) {
          const t = Math.abs(b - a) < 1e-5 ? 0 : (ax - a) / (b - a);
          return browPts[k][1] + (browPts[k + 1][1] - browPts[k][1]) * t;
        }
      }
      return ax < Math.abs(browPts[0][0]) ? browPts[0][1] : browPts.at(-1)[1];
    };
    return { sign, eye, upper, lower, innerAx, outerAx, sampleY, browY };
  });
  return eyeGuides;
}

export function paintStageMakeup(target, styleName, look) {
  const design = stageDesigns[styleName];
  if (!design) return { base: look.base ?? look.skin, changed: new Set() };
  const c = faceChart(),
    FW = W * D,
    FH = H * D,
    map = target.map,
    rough = target.rough;
  if (map.length !== FW * FH * 4) throw new Error("The face paint has an unexpected size.");
  const skin = look.skin.map((v) => Math.max(v, 1e-4));
  const startBase = (look.base ?? skin).map((v) => Math.max(v, 1e-4));
  const fair = smooth(luma(skin), 0.05, 0.42);
  const brows = browCover(look.brow ?? "eyebrow001");
  const beard = hairCover(look.facialHair);
  const guides = guidesOf(c);

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
    drape: hexLinear(design.drape).map((v, k) => mix(v * 0.72, v, fair) * 0.85 + skin[k] * 0.15),
  };

  const peakTarget = [0, 1, 2].map((k) =>
    Math.max(
      startBase[k],
      tones.lid[k] * 1.02,
      tones.pearl[k] * 1.02,
      tones.browLift[k],
      tones.lipCenter[k],
    ),
  );
  const base = startBase.map((v, k) => {
    if (peakTarget[k] <= v * 1.0001) return v;
    const byte = Math.max(1, Math.floor(encodeValue(v / peakTarget[k])));
    return v / decode[byte];
  });
  if (base.some((v, k) => v !== startBase[k])) {
    const tables = base.map((v, k) => Uint8Array.from({ length: 256 }, (_, i) => toByte((decode[i] * startBase[k]) / v)));
    for (let i = 0; i < map.length; i += 4) {
      map[i] = tables[0][map[i]];
      map[i + 1] = tables[1][map[i + 1]];
      map[i + 2] = tables[2][map[i + 2]];
    }
  }

  const blendPixel = (q, targetRgb, alpha, targetRough) => {
    if (alpha <= 1e-4) return;
    const a = clamp(alpha, 0, 0.98);
    for (let k = 0; k < 3; k++) {
      const cur = decode[map[q + k]] * base[k];
      const next = cur + (targetRgb[k] - cur) * a;
      map[q + k] = toByte(next / base[k]);
    }
    if (rough && targetRough !== null && targetRough !== undefined) {
      const curR = (rough[q + 1] / 255) * 0.8;
      const nextR = clamp(curR + (targetRough - curR) * a, 0.24, 0.8);
      rough[q + 1] = Math.round(255 * (nextR / 0.8));
    }
  };

  const near = {};
  for (const g of guides) {
    const { sign, eye, upper, lower, innerAx, outerAx, sampleY, browY } = g;
    const span = outerAx - innerAx;
    const [ox, oy] = eye.outer;
    const [ix, iy] = eye.inner;
    const tipX = outerAx + design.wingReach;
    const tipY = oy + design.wingLift;
    const wdx = tipX - outerAx,
      wdy = tipY - oy,
      wLen = Math.hypot(wdx, wdy) || 1;
    const wux = wdx / wLen,
      wuy = wdy / wLen;
    const flickPts = [
      [ox - sign * 1.0, oy + 0.2],
      [ox + sign * wux * 0.68 * wLen, oy + wuy * 0.68 * wLen],
    ];
    const creasePts = [];
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
        const skinM = c.skin[at];
        if (skinM < 0.05) continue;
        const wetClear = 1 - smooth(c.wet[at], 0.08, 0.55);
        if (wetClear < 0.02) continue;
        const browClear = 1 - smooth(brows[at], 0.12, 0.72);
        const beardClear = beard ? 1 - beard[at] : 1;

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
        const mx = (c.x[a00] * (1 - fa) + c.x[a10] * fa) * (1 - fb) + (c.x[a01] * (1 - fa) + c.x[a11] * fa) * fb;
        const my = (c.y[a00] * (1 - fa) + c.y[a10] * fa) * (1 - fb) + (c.y[a01] * (1 - fa) + c.y[a11] * fa) * fb;
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
          blendPixel(q, tones.drape, design.drapeAlpha * drapeM * skinM * beardClear * browClear, 0.58);
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
        const wingHeight = (6.8 * (1 - clamp(wingAlong / (wLen + 0.5), 0, 1)) ** 0.72) + 0.7;
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
          (1 - smooth(tEye, 0.60, 0.90)) *
          smooth(aboveUp, -0.2, 1.35) *
          (1 - smooth(aboveUp, creaseH - 1.35, creaseH + 0.95));
        if (lidM > 0.015) {
          blendPixel(q, tones.lid, design.lidAlpha * lidM * guard, design.lidRough);
        }

        toLine(creasePts, mx, my, near);
        const creaseWidth = 1.55 + 0.60 * Math.sin(Math.PI * clamp(near.along, 0, 1));
        const creaseBand =
          (1 - smooth(near.distance, creaseWidth * 0.35, creaseWidth + 1.35)) *
          smooth(near.along, 0.0, 0.18) *
          (1 - smooth(near.along, 0.86, 1.0)) *
          smooth(belowBrow, 0.7, 2.6) *
          (wingAlong > -1 ? lowerCut : 1);
        if (creaseBand > 0.015) {
          blendPixel(q, tones.crease, design.creaseAlpha * creaseBand * guard, 0.60);
        }

        const dInner = Math.hypot((ax - (innerAx - 1.4)) / 3.4, (my - (iy + 0.4)) / 2.7);
        const pearlM = Math.exp(-(dInner * dInner) * 1.6);
        if (pearlM > 0.02) {
          blendPixel(q, tones.pearl, design.pearlAlpha * pearlM * guard, 0.24);
        }

        toLine(upper, mx, my, near);
        const upSide = aboveUp >= -0.5;
        const lineW = 0.65 + 0.95 * smooth(near.along, 0.10, 0.88);
        const upLiner = upSide
          ? (1 - smooth(near.distance, lineW * 0.65, lineW + 0.55)) * smooth(near.along, 0.05, 0.20)
          : 0;
        toLine(flickPts, mx, my, near);
        const flickW = 1.55 * (1 - near.along) ** 0.85 + 0.15;
        const flickLiner =
          near.along < 0.99
            ? (1 - smooth(near.distance, flickW * 0.55, flickW + 0.45)) * smooth(near.along, 0.0, 0.08)
            : 0;
        toLine(lower, mx, my, near);
        const lowTight =
          near.along > 0.56
            ? (1 - smooth(near.distance, 0.6, 1.55)) * smooth(near.along, 0.56, 0.82) * design.lowerAlpha
            : 0;
        const linerM = Math.max(upLiner, flickLiner, lowTight);
        if (linerM > 0.02) {
          blendPixel(q, tones.liner, design.linerAlpha * linerM * guard, 0.52);
        }
      }
    }
  }

  const mouth = c.points.mouth;
  const mouthBox = boxAround(c, -(mouth.corner + 5), mouth.bottom - 5, mouth.corner + 5, mouth.top + 5);
  if (mouthBox) {
    const [u0, v0, u1, v1] = mouthBox;
    const myMid = mouth.centre[1];
    for (let j = v0 * D; j <= v1 * D + D - 1; j++) {
      const cj = clamp(Math.floor(j / D), 0, H - 1);
      for (let i = u0 * D; i <= u1 * D + D - 1; i++) {
        const ci = clamp(Math.floor(i / D), 0, W - 1);
        const at = cj * W + ci;
        const lipVal = c.lip[at];
        if (lipVal < 0.12) continue;
        const skinM = c.skin[at];
        if (skinM < 0.05) continue;
        const lipMask = smooth(lipVal, 0.14, 0.52) * skinM;
        const ax = Math.abs(c.x[at]);
        const cornerW = smooth(ax / Math.max(mouth.corner, 1), 0.36, 0.92);
        const edgeW = 1 - smooth(lipVal, 0.55, 0.92);
        const borderW = clamp(Math.max(cornerW * 0.88, edgeW * 0.92), 0, 1);
        const centerW = (1 - smooth(ax / Math.max(mouth.corner, 1), 0.08, 0.56)) * smooth(lipVal, 0.72, 0.96) * (1 - smooth(Math.abs(c.y[at] - myMid), 5.5, 9.5));
        const rgb = [0, 1, 2].map((k) => {
          let v = mix(tones.lipBody[k], tones.lipEdge[k], borderW);
          v = mix(v, tones.lipCenter[k], centerW * 0.72);
          return v;
        });
        const lipRough = mix(mix(design.lipRough + 0.06, design.lipRough + 0.14, borderW), design.lipRough - 0.04, centerW);
        blendPixel((j * FW + i) * 4, rgb, design.lipAlpha * lipMask, lipRough);
      }
    }
  }

  const changed = new Set(["map"]);
  if (rough) changed.add("rough");
  return { base, changed };
}

const paintedStage = new Map();
function makeTexture(canvas, like) {
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = like.colorSpace;
  t.anisotropy = like.anisotropy;
  return t;
}

export function stageMakeupFace(material, form) {
  const name = form.humanStyle?.makeup;
  if (!name || !stageDesigns[name]) return material;
  const source = material.map?.image;
  if (typeof document === "undefined" || !source?.getContext) return material;
  if (source.width !== W * D || source.height !== H * D) return material;
  const currentBase = [material.color.r, material.color.g, material.color.b];
  const trueSkin = Array.isArray(material.userData?.skinColor) ? material.userData.skinColor : currentBase;
  const look = {
    skin: trueSkin,
    base: currentBase,
    brow: fittedBrow(form),
    facialHair: form.humanStyle?.facialHair,
  };
  const key = [material.map.uuid, material.color.getHexString(), trueSkin.map((v) => v.toFixed(4)).join(","), name, look.brow, look.facialHair].join("|");
  if (paintedStage.has(key)) {
    const kept = paintedStage.get(key);
    paintedStage.delete(key);
    paintedStage.set(key, kept);
  } else {
    if (paintedStage.size >= 4) {
      const oldest = paintedStage.keys().next().value;
      for (const t of paintedStage.get(oldest).owned) t.dispose();
      paintedStage.delete(oldest);
    }
    const copy = (image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const pen = canvas.getContext("2d", { willReadFrequently: true });
      pen.drawImage(image, 0, 0);
      return { canvas, pen, pixels: pen.getImageData(0, 0, canvas.width, canvas.height) };
    };
    const sameSize = (t) => t?.image?.getContext && t.image.width === source.width && t.image.height === source.height;
    const colour = copy(source);
    const rough = sameSize(material.roughnessMap) ? copy(material.roughnessMap.image) : null;
    const { base, changed } = paintStageMakeup({ map: colour.pixels.data, rough: rough?.pixels.data }, name, look);
    const entry = { base, owned: [] };
    for (const [slot, layer, like] of [
      ["map", colour, material.map],
      ["rough", rough, material.roughnessMap],
    ]) {
      if (!layer || !changed.has(slot)) continue;
      layer.pen.putImageData(layer.pixels, 0, 0);
      entry[slot] = makeTexture(layer.canvas, like);
      entry.owned.push(entry[slot]);
    }
    paintedStage.set(key, entry);
  }
  const entry = paintedStage.get(key);
  if (entry.map) material.map = entry.map;
  if (entry.rough) {
    material.roughnessMap = entry.rough;
    material.metalnessMap = entry.rough;
    material.aoMap = entry.rough;
  }
  material.color.setRGB(...entry.base);
  return material;
}
