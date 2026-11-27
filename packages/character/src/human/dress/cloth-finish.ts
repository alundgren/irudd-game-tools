import * as T from "three";
import type { Raster } from "../../raster.js";
import { tailoredClothDesigns } from "./styles.js";
import type { Landmarks } from "./kit.js";

export interface ClothStyle {
  readonly brocade?: Uint8Array;
  readonly clothDesign?: string | undefined;
  readonly secondDesign?: string | undefined;
  readonly clothAccent?: string | undefined;
  readonly clothSecond?: string | undefined;
  readonly clothLight?: string | undefined;
  readonly accentColor?: string | undefined;
  readonly leatherColor?: string | undefined;
  readonly soleColor?: string | undefined;
  readonly metalColor?: string | undefined;
}

type Fabric =
  | "jersey"
  | "wool"
  | "twill"
  | "denim"
  | "poplin"
  | "satin"
  | "silk"
  | "canvas"
  | "waxed cotton"
  | "sports knit"
  | "ripstop";

const fabrics: Readonly<Record<string, Fabric>> = {
  "T-shirt": "jersey",
  Hoodie: "jersey",
  Joggers: "jersey",
  Sweater: "wool",
  Skirt: "twill",
  Tights: "jersey",
  Socks: "jersey",
  Jeans: "denim",
  Chinos: "twill",
  Trousers: "twill",
  "Work trousers": "twill",
  "Field trousers": "twill",
  Shirt: "poplin",
  Undershirt: "jersey",
  "Evening bodice": "silk",
  "Gored satin skirt": "silk",
  "Gathered overskirt": "silk",
  "Dress bodice": "poplin",
  "Dress skirt": "poplin",
  Sash: "satin",
  Overcoat: "wool",
  "Coat skirt": "wool",
  "Coat belt": "wool",
  Scarf: "wool",
  Coveralls: "twill",
  "Chore jacket": "canvas",
  "Field jacket": "canvas",
  Apron: "waxed cotton",
  Vest: "sports knit",
  Shorts: "sports knit",
  Breeches: "twill",
  Cloak: "wool",
  Tunic: "wool",
  "Tunic skirt": "wool",
  Parka: "ripstop",
  "Parka skirt": "ripstop",
  "Snow trousers": "ripstop",
  "Split mantle": "wool",
  "Shoulder cloak": "wool",
  "Mantle lining": "silk",
  "Short bomber": "satin",
  "Rolled-sleeve bomber": "canvas",
  Ribbing: "jersey",
  "Tucked top": "jersey",
  "Wide trousers": "twill",
  "Cuffed wide trousers": "twill",
  Bodice: "silk",
  "Shoulder wing": "silk",
  "Gored skirt": "silk",
  "Draped skirt": "silk",
  "Skirt panel": "silk",
  "Skirt facing": "satin",
  Girdle: "satin",
};

const directedFields = [
  "clothSecond",
  "clothLight",
  "accentColor",
  "leatherColor",
  "soleColor",
  "metalColor",
] as const;

const primaryParts: Readonly<Record<string, readonly [string, string, string?]>> = {
  "T-shirt and jeans": ["T-shirt", "Breton stripe"],
  "Hoodie and joggers": ["Hoodie", "Colour block"],
  "Shirt and chinos": ["Shirt", "Windowpane"],
  "Sweater and skirt": ["Sweater", "Breton stripe"],
  "Evening gown": ["Gored satin skirt", "Hem border"],
  "Day dress": ["Dress bodice", "Windowpane", "Dress skirt"],
  "Running kit": ["Vest", "Colour block"],
  Coveralls: ["Coveralls", "Workwear tape"],
  "Chore jacket": ["Chore jacket", "Colour block"],
  "Workshop apron": ["Apron", "Workbench stripe"],
  Overcoat: ["Overcoat", "Herringbone", "Coat skirt"],
  Explorer: ["Field jacket", "Colour block"],
  Traveller: ["Cloak", "Woven border"],
  Parka: ["Parka", "Colour block", "Parka skirt"],
  "Leather armour": ["Tunic", "Quiet weave", "Tunic skirt"],
  "Split mantle": ["Split mantle", "Herringbone"],
  "Hooded shoulder cloak": ["Shoulder cloak", "Herringbone"],
  "Bomber and wide trousers": ["Short bomber", "Colour block"],
  "Rolled bomber and cuffed trousers": ["Rolled-sleeve bomber", "Colour block"],
  "Bodice and gored skirt": ["Skirt panel", "Scallop brocade"],
  "Draped bodice gown": ["Skirt panel", "Scallop brocade"],
};

const secondParts: Readonly<Record<string, ReadonlyArray<string>>> = {
  "T-shirt and jeans": ["Jeans"],
  "Hoodie and joggers": ["Joggers"],
  "Shirt and chinos": ["Chinos"],
  "Sweater and skirt": ["Skirt"],
  "Day dress": ["Sash"],
  "Running kit": ["Shorts"],
  "Chore jacket": ["Work trousers"],
  "Workshop apron": ["Shirt"],
  Overcoat: ["Scarf"],
  Explorer: ["Field trousers"],
  Traveller: ["Tunic", "Tunic skirt"],
  Parka: ["Snow trousers"],
  "Leather armour": ["Breeches"],
  "Split mantle": ["Tunic", "Tunic skirt"],
  "Hooded shoulder cloak": ["Tunic", "Tunic skirt"],
  "Bomber and wide trousers": ["Wide trousers"],
  "Rolled bomber and cuffed trousers": ["Cuffed wide trousers"],
};

const tailoredFabrics: Readonly<Record<string, Fabric>> = {
  Top: "jersey",
  "Hooded top": "jersey",
  Jacket: "canvas",
  Trousers: "twill",
  Shorts: "twill",
};

const cloth: Readonly<Record<Fabric, readonly [number, number, number]>> = {
  jersey: [0.86, 0.085, 0.007],
  wool: [0.96, 0.145, 0.0092],
  twill: [0.8, 0.13, 0.0068],
  denim: [0.88, 0.165, 0.0078],
  poplin: [0.7, 0.085, 0.0062],
  satin: [0.4, 0.052, 0.0062],
  silk: [0.68, 0.062, 0.0066],
  canvas: [0.9, 0.135, 0.0086],
  "waxed cotton": [0.68, 0.115, 0.0076],
  "sports knit": [0.62, 0.095, 0.0066],
  ripstop: [0.56, 0.1, 0.0142],
};
const washes: Readonly<Record<Fabric, number>> = {
  denim: 0.36,
  canvas: 0.26,
  twill: 0.22,
  wool: 0.22,
  "waxed cotton": 0.28,
  jersey: 0.16,
  poplin: 0.12,
  ripstop: 0.13,
  "sports knit": 0.12,
  satin: 0.08,
  silk: 0.09,
};
const yarnHeight: Readonly<Record<Fabric, number>> = {
  denim: 0.0048,
  canvas: 0.005,
  twill: 0.0044,
  wool: 0.0058,
  "waxed cotton": 0.0042,
  jersey: 0.003,
  poplin: 0.0028,
  ripstop: 0.0042,
  "sports knit": 0.0028,
  satin: 0.0018,
  silk: 0.0022,
};

function designFor(outfit: string, name: string, style: ClothStyle): string {
  const [main, pattern, matching] = primaryParts[outfit] ?? [],
    second = style.secondDesign;
  if (outfit === "Evening gown" && style.clothDesign === "Scallop brocade")
    return name === "Gathered overskirt" || name === "Evening bodice"
      ? style.clothDesign
      : "Hem border";
  if (name === main || name === matching)
    return style.clothDesign === "Outfit swatch"
      ? (pattern ?? "Quiet weave")
      : (style.clothDesign ?? "Quiet weave");
  if (second && second !== "Plain cloth" && secondParts[outfit]?.includes(name)) return second;
  return "Quiet weave";
}

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const fold = (x: number, step: number) => Math.abs(x - Math.round(x / step) * step);
const band = (x: number, half: number, feather = 0.002) =>
  1 - Math.max(0, Math.min(1, (x - half) / feather + 0.5));
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

interface Chart {
  readonly uv: T.Float32BufferAttribute;
  readonly u0: number;
  readonly v0: number;
  readonly du: number;
  readonly dv: number;
  readonly yoke: number;
}

function patternChart(mesh: T.Mesh, m: Landmarks): Chart | null {
  const chart: unknown = mesh.userData["patternChart"],
    uv = mesh.geometry.getAttribute("uv");
  if (!(uv instanceof T.Float32BufferAttribute) || typeof chart !== "object" || chart === null)
    return null;
  const field = (name: string) => {
    const value: unknown = Reflect.get(chart, name);
    return typeof value === "number" ? value : null;
  };
  const u0 = field("u0"),
    v0 = field("v0"),
    du = field("du"),
    dv = field("dv");
  if (u0 === null || v0 === null || du === null || dv === null) return null;
  return { uv, u0, v0, du, dv, yoke: m.shoulder - m.waist };
}

export function clothChart(
  positions: T.BufferAttribute | T.InterleavedBufferAttribute,
  m: Landmarks,
): Chart {
  const { shoulder, waist, chest } = m;
  const points = new Float32Array(positions.count * 2);
  let minU = Infinity,
    minV = Infinity,
    maxU = -Infinity,
    maxV = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      z = positions.getZ(i) - chest[2];
    const u = x * (1 + 0.19 * Math.min(1, Math.abs(z) / 0.17));
    const v = positions.getY(i) - waist;
    points[i * 2] = u;
    points[i * 2 + 1] = v;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const u0 = minU - 0.008,
    v0 = minV - 0.008;
  const du = maxU - minU + 0.016,
    dv = maxV - minV + 0.016;
  for (let i = 0; i < points.length; i += 2) {
    points[i] = ((points[i] ?? 0) - u0) / du;
    points[i + 1] = ((points[i + 1] ?? 0) - v0) / dv;
  }
  return { uv: new T.Float32BufferAttribute(points, 2), u0, v0, du, dv, yoke: shoulder - waist };
}

function brocadeThread(thread: Uint8Array, x: number, y: number) {
  const row = Math.floor(y / 0.156);
  const dx = x / 0.202 + 0.5 * (row & 1);
  const dy = y / 0.156 - row;
  const u = Math.floor((dx - Math.floor(dx)) * 144);
  const v = Math.min(144 - 1, Math.floor((1 - dy) * 144));
  return (thread[v * 144 + u] ?? 0) / 255;
}

function printAt(
  pattern: string,
  x: number,
  y: number,
  chart: Chart,
  outfit: string | null,
  meshName: string,
  thread?: Uint8Array,
): readonly [number, number] {
  if (pattern === "Scallop brocade") {
    if (!thread) throw new Error("The brocade thread map is missing.");
    const ground = brocadeThread(thread, 1.4 * x, 1.4 * y);
    if (meshName === "Gathered overskirt") {
      const hem = y / chart.dv;
      const rail = Math.max(
        band(Math.abs(hem - 0.046), 0.0025, 0.003),
        band(Math.abs(hem - 0.244), 0.0025, 0.003),
      );
      const border =
        hem > 0.054 && hem < 0.235 ? brocadeThread(thread, x, ((hem - 0.054) * 0.156) / 0.181) : 0;
      return [0.12 * ground + 0.7 * border + 0.38 * rail, 0.07 * (1 - ground)];
    }
    if (meshName === "Evening bodice") {
      const yoke = (y - chart.v0) / chart.dv;
      const trim = Math.max(0, 1 - Math.abs(yoke - 0.57) / 0.33);
      return [0.04 + (0.12 + 0.34 * trim) * ground, 0.09 * (1 - ground)];
    }
    return [0.025 + 0.46 * ground, 0.09 * (1 - ground)];
  }

  if (pattern === "Pinstripe") return [0.54 * band(fold(x, 0.033), 0.0015, 0.0018), 0];
  if (pattern === "Windowpane") {
    const warp = band(fold(x, 0.068), 0.0031);
    const weft = band(fold(y - 0.014, 0.071), 0.0034);
    const paired = 0.27 * band(fold(x + 0.012, 0.068), 0.0015);
    return [0.55 * Math.max(warp, weft, paired) + 0.22 * warp * weft, 0.17 * Math.max(warp, weft)];
  }
  if (pattern === "Breton stripe") {
    const inside = band(Math.abs(y - (chart.v0 + chart.dv * 0.51)), chart.dv * 0.4, 0.005);
    return [0.77 * band(fold(y, 0.061), 0.009) * inside, 0];
  }
  if (pattern === "Herringbone") {
    const chevron = fold(x + 0.008, 0.028) * 0.76;
    return [0.31 * band(fold(y + chevron, 0.021), 0.003), 0.29];
  }
  if (pattern === "Workbench stripe") {
    const pin = band(fold(x + 0.046, 0.12), 0.0024);
    const backing = band(fold(x + 0.044, 0.12), 0.009);
    const bib = band(Math.abs(x), 0.19, 0.021);
    return [0.38 * pin * bib, 0.34 * backing * bib];
  }
  if (pattern === "Workwear tape") {
    const awayFromZip = 1 - band(Math.abs(x), 0.031, 0.009);
    const chest = band(Math.abs(y - chart.yoke * 0.53), 0.012);
    const welt = band(Math.abs(y - chart.yoke * 0.53 + 0.021), 0.0022);
    return [awayFromZip * (0.64 * chest + 0.29 * welt), 0.31 * chest];
  }
  if (pattern === "Woven border") {
    const hem = y - chart.v0;
    const inner = band(Math.abs(hem - 0.095), 0.028, 0.005);
    const outer = Math.max(band(Math.abs(hem - 0.057), 0.003), band(Math.abs(hem - 0.132), 0.003));
    const diamond = band(fold(x, 0.048) + Math.abs(hem - 0.095) * 1.3, 0.018, 0.003);
    return [0.58 * inner * diamond + 0.52 * outer, 0.36 * inner];
  }
  if (pattern === "Gingham") {
    const warp = band(fold(x, 0.03), 0.0075, 0.0015),
      weft = band(fold(y, 0.03), 0.0075, 0.0015);
    return [0.36 * (warp + weft) + 0.1 * warp * weft, 0];
  }
  if (pattern === "Small dots") {
    const row = Math.round(y / 0.034),
      dx = fold(x + (row % 2 ? 0.02 : 0), 0.04),
      dy = y - row * 0.034;
    return [0.82 * band(Math.hypot(dx * 1.3, dy * 0.92), 0.0058, 0.0016), 0];
  }
  if (pattern === "Chest band") {
    const at = chart.yoke * 0.58;
    return [
      0.9 * band(Math.abs(y - at), 0.024, 0.003) +
        0.8 * band(Math.abs(y - at + 0.041), 0.0042, 0.002),
      0,
    ];
  }
  if (pattern === "Knit yoke") {
    const from = chart.yoke * 0.7,
      inside = 1 - band(y - from, 0.001, 0.006);
    const zig = band(Math.abs(y - from - 0.03 - fold(x, 0.022) * 0.9), 0.0048, 0.002);
    const row = Math.max(
      band(Math.abs(y - from - 0.008), 0.0032, 0.0016),
      band(Math.abs(y - from - 0.068), 0.0032, 0.0016),
    );
    const seed = band(Math.hypot(fold(x + 0.011, 0.022), y - from - 0.086), 0.0046, 0.0016);
    const lower = band(Math.hypot(fold(x, 0.044), y - from + 0.012), 0.004, 0.0016);
    return [Math.min(1, inside * (0.8 * zig + 0.78 * row + 0.8 * seed) + 0.7 * lower), 0];
  }
  if (pattern === "Hem border") {
    const hem = y - chart.v0;
    const lines = Math.max(
      band(Math.abs(hem - 0.034), 0.0034, 0.0016),
      band(Math.abs(hem - 0.082), 0.0034, 0.0016),
    );
    const lozenge = band(fold(x, 0.034) + Math.abs(hem - 0.058) * 1.25, 0.0088, 0.002);
    return [0.8 * lines + 0.78 * lozenge, 0.2 * band(Math.abs(hem - 0.058), 0.024, 0.004)];
  }
  if (pattern === "Colour block") {
    const active = outfit === "Running kit" || outfit === "Parka";
    const seam =
      (active ? 0.51 : 0.7) * chart.yoke + Math.min(Math.abs(x), 0.36) * (active ? -0.65 : 0.13);
    const above = 1 - band(y - seam, 0.001, 0.005);
    const piping = band(Math.abs(y - seam + 0.014), active ? 0.005 : 0.002);
    return [piping * 0.85 + above * (active ? 0.84 : 0.51), above * 0.32];
  }
  return [0, 0];
}

const grainAt = (i: number, j: number) => {
  const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
function cloud(x: number, y: number): number {
  const i = Math.floor(x),
    j = Math.floor(y),
    u = x - i,
    v = y - j,
    a = u * u * (3 - 2 * u),
    b = v * v * (3 - 2 * v);
  return (
    mix(
      mix(grainAt(i, j), grainAt(i + 1, j), a),
      mix(grainAt(i, j + 1), grainAt(i + 1, j + 1), a),
      b,
    ) *
      2 -
    1
  );
}

function fabricConstruction(
  fabric: Fabric,
  meshName: string,
  x: number,
  y: number,
  chart: Chart,
  pitch: number,
  contrast: number,
  out: Float64Array,
): void {
  const hemY = y - chart.v0;
  let albedoMod: number, height: number, roughScale: number;
  let weftLift = 0;
  if (fabric === "wool") {
    if (meshName === "Sweater" || meshName === "Scarf") {
      const ribBand = hemY < 0.058 ? 1 - clamp((hemY - 0.048) / 0.01, 0, 1) : 0;
      const weltSeam = band(Math.abs(hemY - 0.056), 0.002, 0.0022);
      const waleP = ribBand > 0.5 ? 0.0078 : 0.0096;
      const courseP = 0.0074;
      const waleX = (x / waleP) % 1;
      const wFrac = waleX < 0 ? waleX + 1 : waleX;
      const waleRib = Math.sin(wFrac * Math.PI);
      const vLeg = Math.abs(wFrac - 0.5) * 2;
      const loop = 0.5 + 0.5 * Math.cos((y / courseP + vLeg * 0.65) * Math.PI * 2);
      const fuzz = cloud(x * 75, y * 75) * 0.12;
      const knitH =
        ribBand > 0.5
          ? 0.16 + 0.74 * waleRib + 0.08 * loop
          : 0.14 + 0.64 * waleRib + 0.18 * loop * (0.45 + 0.55 * waleRib);
      height = clamp(knitH + fuzz - 0.26 * weltSeam, 0.06, 0.96);
      albedoMod = 1 + contrast * ((knitH - 0.54) * 1.45 + fuzz * 0.5) - 0.12 * weltSeam;
      roughScale = clamp(0.99 - 0.07 * waleRib - 0.04 * loop, 0.86, 1.0);
    } else {
      const diag = (x * 0.72 + y * 0.69) / pitch;
      const wale = Math.sin(diag * Math.PI * 2);
      const cross = Math.sin(((x * -0.69 + y * 0.72) / (pitch * 1.15)) * Math.PI * 2);
      const nap = cloud(x * 55, y * 55) * 0.22;
      const hemLine = band(Math.abs(hemY - 0.032), 0.0022, 0.0024);
      const stitch = hemLine * band(fold(x, 0.009), 0.0032, 0.0018);
      height = clamp(
        0.5 + 0.28 * wale + 0.1 * cross + nap + 0.24 * stitch - 0.16 * hemLine,
        0.08,
        0.94,
      );
      albedoMod = 1 + contrast * (0.62 * wale + 0.25 * cross + nap * 0.85) - 0.09 * hemLine;
      roughScale = clamp(0.98 - 0.06 * wale + 0.04 * Math.abs(nap), 0.85, 1.0);
    }
  } else if (fabric === "denim" || fabric === "twill") {
    const isDenim = fabric === "denim";
    const diag = (x * 0.78 + y * 0.62) / pitch;
    const f = diag - Math.floor(diag);
    const wale = Math.sin(f * Math.PI * 2) * 0.72 + Math.sin(f * Math.PI * 4) * 0.2;
    const warpSlub = cloud(x * (isDenim ? 72 : 58), y * 14);
    const weftSlub = cloud(x * 16, y * 68);
    const wearPatch = 0.5 + 0.5 * cloud(x * 6.5, y * 4.5);
    const hemStitch =
      (band(Math.abs(hemY - 0.026), 0.0016, 0.0018) +
        (isDenim ? band(Math.abs(hemY - 0.034), 0.0015, 0.0018) : 0)) *
      band(fold(x, 0.0082), 0.0029, 0.0016);
    const hemFold = band(Math.abs(hemY - 0.03), 0.0026, 0.0028);
    height = clamp(
      0.5 +
        (isDenim ? 0.34 : 0.29) * wale +
        0.13 * warpSlub +
        0.06 * weftSlub +
        0.26 * hemStitch -
        0.14 * hemFold,
      0.06,
      0.96,
    );
    albedoMod = 1 + contrast * (0.72 * wale + 0.42 * warpSlub + 0.18 * weftSlub) - 0.1 * hemFold;
    weftLift = isDenim ? clamp((-wale - 0.1) * 0.2 + Math.max(0, weftSlub) * 0.07, 0, 0.24) : 0;
    roughScale = clamp(
      (isDenim ? 0.94 : 0.9) - 0.12 * wale - (isDenim ? 0.1 : 0.06) * wearPatch - 0.06 * hemStitch,
      0.68,
      0.99,
    );
  } else if (fabric === "canvas") {
    const bx = x / pitch,
      by = y / pitch;
    const ix = Math.floor(bx),
      iy = Math.floor(by);
    const fx = bx - ix,
      fy = by - iy;
    const overWarp = ((ix + iy) & 1) === 0;
    const rib = overWarp
      ? Math.sin(fx * Math.PI) * (0.58 + 0.42 * Math.sin(fy * Math.PI))
      : Math.sin(fy * Math.PI) * (0.58 + 0.42 * Math.sin(fx * Math.PI));
    const slub = cloud(x * 38, y * 38) * 0.18;
    const hemFold = band(Math.abs(hemY - 0.032), 0.0028, 0.0028);
    const stitch =
      (band(Math.abs(hemY - 0.027), 0.0017, 0.0018) +
        band(Math.abs(hemY - 0.036), 0.0017, 0.0018)) *
      band(fold(x, 0.0085), 0.003, 0.0016);
    const placket =
      band(Math.abs(Math.abs(x) - 0.019), 0.0018, 0.002) * band(fold(y, 0.009), 0.0032, 0.0016);
    height = clamp(
      0.16 + 0.68 * rib + slub + 0.26 * Math.max(stitch, placket) - 0.16 * hemFold,
      0.06,
      0.96,
    );
    albedoMod = 1 + contrast * ((rib - 0.5) * 1.35 + slub * 0.9) - 0.11 * hemFold;
    roughScale = clamp(0.97 - 0.16 * rib - 0.05 * Math.max(stitch, placket), 0.74, 0.99);
  } else if (fabric === "poplin") {
    const wx = Math.sin((x / pitch) * Math.PI * 2);
    const wy = Math.sin((y / pitch) * Math.PI * 2);
    const slubWeft = cloud(x * 11, y * 92) * 0.34;
    const slubWarp = cloud(x * 92, y * 11) * 0.24;
    const weave = 0.52 * (wx * wy) + slubWeft + slubWarp;
    const hemStitch =
      band(Math.abs(hemY - 0.02), 0.0014, 0.0016) * band(fold(x, 0.0072), 0.0025, 0.0014);
    const placket =
      meshName === "Shirt"
        ? band(Math.abs(Math.abs(x) - 0.015), 0.0016, 0.0018) *
          band(fold(y, 0.0075), 0.0026, 0.0015)
        : 0;
    height = clamp(0.5 + 0.28 * weave + 0.24 * Math.max(hemStitch, placket), 0.12, 0.92);
    albedoMod = 1 + contrast * (0.72 * weave);
    roughScale = clamp(0.92 - 0.14 * weave - 0.06 * Math.max(hemStitch, placket), 0.72, 0.99);
  } else if (fabric === "jersey" || fabric === "sports knit") {
    const isSport = fabric === "sports knit";
    const ribbed = !isSport && (meshName === "Hoodie" || meshName === "Joggers");
    const ribBand = ribbed && hemY < 0.052 ? 1 - clamp((hemY - 0.044) / 0.008, 0, 1) : 0;
    const welt = ribbed ? band(Math.abs(hemY - 0.05), 0.0018, 0.002) : 0;
    if (isSport) {
      const gx = Math.cos((x / pitch) * Math.PI * 2);
      const gy = Math.cos((y / pitch) * Math.PI * 2);
      const cell = gx * gy;
      const stitch =
        band(Math.abs(hemY - 0.022), 0.0015, 0.0017) * band(fold(x, 0.0075), 0.0026, 0.0015);
      height = clamp(0.5 + 0.34 * cell + 0.22 * stitch, 0.1, 0.92);
      albedoMod = 1 + contrast * (0.72 * cell);
      roughScale = clamp(0.88 - 0.18 * cell - 0.06 * stitch, 0.64, 0.98);
    } else {
      const waleP = ribBand > 0.5 ? 0.0072 : pitch;
      const wale = Math.sin((x / waleP) * Math.PI * 2);
      const course = Math.cos(
        (y / (pitch * 1.15) + Math.abs(((((x / waleP) % 1) + 1) % 1) - 0.5) * 0.75) * Math.PI * 2,
      );
      const marl = cloud(x * 48, y * 18) * 0.22;
      const stitch =
        band(Math.abs(hemY - 0.024), 0.0015, 0.0017) * band(fold(x, 0.0075), 0.0026, 0.0015);
      const knit = ribBand > 0.5 ? 0.78 * wale + 0.22 * course : 0.55 * wale + 0.32 * course + marl;
      height = clamp(0.5 + 0.32 * knit + 0.22 * stitch - 0.22 * welt, 0.1, 0.94);
      albedoMod = 1 + contrast * (0.78 * knit) - 0.1 * welt;
      roughScale = clamp(0.95 - 0.09 * knit, 0.8, 0.99);
    }
  } else if (fabric === "waxed cotton") {
    const weave = Math.sin((x / pitch) * Math.PI * 2) * Math.sin((y / pitch) * Math.PI * 2);
    const c1 = Math.abs(cloud(x * 7.5, y * 6.2));
    const c2 = Math.abs(cloud(x * 16.5 + 4.1, y * 14.0 - 2.3));
    const crease = (1 - clamp(c1 / 0.22, 0, 1)) * 0.72 + (1 - clamp(c2 / 0.18, 0, 1)) * 0.38;
    const hemStitch =
      band(Math.abs(hemY - 0.026), 0.0018, 0.002) * band(fold(x, 0.0085), 0.003, 0.0016);
    height = clamp(0.58 + 0.16 * weave - 0.36 * crease + 0.24 * hemStitch, 0.08, 0.94);
    albedoMod = 1 + contrast * (0.35 * weave + 0.55 * crease);
    roughScale = clamp(0.46 + 0.48 * crease - 0.06 * weave, 0.38, 0.98);
  } else if (fabric === "ripstop") {
    const gx = band(fold(x, pitch), 0.0015, 0.0018);
    const gy = band(fold(y, pitch), 0.0015, 0.0018);
    const grid = Math.max(gx, gy);
    const parka = meshName === "Parka" || meshName === "Parka skirt";
    const baffle = parka ? band(fold(y, 0.135), 0.0032, 0.0042) : 0;
    const puff = parka ? Math.sin(((((y / 0.135) % 1) + 1) % 1) * Math.PI) : 0.5;
    const fine = Math.sin((x / 0.0052) * Math.PI * 2) * Math.sin((y / 0.0052) * Math.PI * 2) * 0.14;
    height = clamp(0.38 + 0.24 * puff + 0.34 * grid + fine - 0.34 * baffle, 0.06, 0.96);
    albedoMod = 1 + contrast * (0.48 * grid + 0.28 * (puff - 0.5)) - 0.14 * baffle;
    roughScale = clamp(0.56 + 0.34 * grid + 0.26 * baffle - 0.08 * puff, 0.46, 0.98);
  } else {
    const isSatin = fabric === "satin";
    const diag = (x * 0.55 + y * 0.84) / pitch;
    const weave = Math.sin(diag * Math.PI * 2);
    const shimmer = 0.5 + 0.5 * Math.sin(x * 16 + cloud(x * 5, y * 4) * 2.4);
    const hem = band(Math.abs(hemY - 0.018), 0.0015, 0.0018);
    height = clamp(0.5 + (isSatin ? 0.16 : 0.22) * weave + 0.14 * hem, 0.2, 0.86);
    albedoMod = 1 + contrast * (0.48 * weave + 0.35 * (shimmer - 0.5));
    roughScale = clamp(
      (isSatin ? 0.68 : 0.92) - (isSatin ? 0.14 : 0.09) * shimmer - 0.07 * weave,
      0.48,
      0.98,
    );
  }
  out[0] = albedoMod;
  out[1] = height;
  out[2] = roughScale;
  out[3] = weftLift;
}

function context(raster: Raster, width: number, height: number): CanvasRenderingContext2D {
  const ctx = raster.canvas(width, height).getContext("2d");
  if (!ctx) throw new Error("The raster has no 2D canvas.");
  return ctx;
}

function swatchMap(
  raster: Raster,
  chart: Chart,
  dye: T.Color,
  accent: T.Color,
  fabric: Fabric,
  pattern: string,
  outfit: string | null,
  depth: number,
  meshName: string,
  thread?: Uint8Array,
): { readonly texture: T.CanvasTexture; readonly surface: T.CanvasTexture | null } {
  const width = clamp(Math.round(chart.du * 720), 128, 704),
    height = clamp(Math.round(chart.dv * 720), 128, 704);
  const ctx = context(raster, width, height);
  const image = ctx.createImageData(width, height);
  const reliefCtx = depth ? context(raster, width, height) : null;
  const relief = reliefCtx ? reliefCtx.createImageData(width, height) : null;
  const [, contrast, pitch] = cloth[fabric];
  const base = dye.toArray(),
    other = accent.toArray();
  const dark = base.map((value) => value * 0.67);
  const fade = clamp(
    1.1 - ((base[0] ?? 0) * 0.2126 + (base[1] ?? 0) * 0.7152 + (base[2] ?? 0) * 0.0722) * 1.5,
    0.25,
    1,
  );
  const encoded = Array.from({ length: 1024 }, (_, i) => {
    const v = i / 1023;
    return 255 * (v < 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  });
  const weftTone = base.map((v) => mix(v, 0.78, 0.48));
  const fabOut = new Float64Array(4);
  const wash = washes[fabric] * depth * fade;
  for (let row = 0, i = 0; row < height; row++) {
    const y = chart.v0 + chart.dv * (1 - (row + 0.5) / height);
    for (let col = 0; col < width; col++, i += 4) {
      const x = chart.u0 + (chart.du * (col + 0.5)) / width;
      const [tint, shade] = printAt(pattern, x, y, chart, outfit, meshName, thread);
      fabricConstruction(fabric, meshName, x, y, chart, pitch, contrast, fabOut);
      let light = fabOut[0] ?? 1;
      const weftLift = fabOut[3] ?? 0;
      if (relief) {
        light *=
          1 +
          wash *
            (cloud(x * 9, y * 5) * 0.6 +
              cloud(x * 37 + 9, y * 29) * 0.4 +
              cloud(x * 120, y * 40 + 5) * 0.16) -
          wash * 0.65 * band(Math.abs(y - chart.v0 - 0.03), 0.0018, 0.0022);
        const brocade = pattern === "Scallop brocade" ? tint : 0;
        relief.data[i] = Math.round(255 * clamp((fabOut[1] ?? 0) + brocade * 0.52, 0, 1));
        relief.data[i + 1] = Math.round(255 * clamp((fabOut[2] ?? 0) - brocade * 0.22, 0.38, 1));
        relief.data[i + 2] = 0;
        relief.data[i + 3] = 255;
      }
      for (let channel = 0; channel < 3; channel++) {
        let dyed = mix(
          mix(base[channel] ?? 0, dark[channel] ?? 0, shade),
          other[channel] ?? 0,
          Math.min(1, tint),
        );
        if (weftLift > 0)
          dyed = mix(dyed, weftTone[channel] ?? 0, weftLift * (1 - Math.min(1, tint)));
        const colour = dyed * light;
        image.data[i + channel] = encoded[Math.round(clamp(colour, 0, 1) * 1023)] ?? 0;
      }
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new T.CanvasTexture(ctx.canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  let surface: T.CanvasTexture | null = null;
  if (reliefCtx && relief) {
    reliefCtx.putImageData(relief, 0, 0);
    surface = new T.CanvasTexture(reliefCtx.canvas);
    surface.anisotropy = texture.anisotropy;
  }
  return { texture, surface };
}

function weave(
  raster: Raster,
  mesh: T.Mesh,
  fabric: Fabric,
  pattern: string,
  accent: string | null,
  outfit: string | null,
  m: Landmarks,
  depth: number,
  thread?: Uint8Array,
): void {
  const source = mesh.material;
  if (!(source instanceof T.MeshStandardMaterial)) return;
  const material = source.clone();
  const dye = material.color.clone();
  const hue = dye.getHSL({ h: 0, s: 0, l: 0 });
  const trim = accent
    ? new T.Color(accent)
    : dye
        .clone()
        .lerp(
          new T.Color(hue.l > 0.42 ? "#233039" : "#dfd0ae"),
          pattern === "Herringbone" ? 0.23 : 0.58,
        );
  material.roughness = cloth[fabric][0];
  material.metalness = 0;
  material.name = mesh.name + " · " + fabric;
  const position = mesh.geometry.getAttribute("position");
  const chart = patternChart(mesh, m) ?? clothChart(position, m);
  const { texture, surface } = swatchMap(
    raster,
    chart,
    dye,
    trim,
    fabric,
    pattern,
    outfit,
    depth,
    mesh.name,
    thread,
  );
  mesh.geometry.setAttribute("uv", chart.uv);
  material.color.set(0xffffff);
  material.map = texture;
  material.bumpMap = surface;
  if (surface) {
    material.bumpScale = yarnHeight[fabric];
    material.roughnessMap = surface;
  }
  material.addEventListener("dispose", () => {
    texture.dispose();
    surface?.dispose();
  });
  mesh.material = material;
}

export function finishCloth(
  raster: Raster,
  mesh: T.Mesh,
  outfit: string,
  style: ClothStyle,
  m: Landmarks,
): void {
  const design = style.clothDesign,
    fabric = fabrics[mesh.name];
  if (!fabric || !design || design === "Plain cloth") return;
  const depth = directedFields.some((field) => style[field]) ? 1 : 0;
  weave(
    raster,
    mesh,
    fabric,
    designFor(outfit, mesh.name, style),
    style.clothAccent ?? null,
    outfit,
    m,
    depth,
    style.brocade,
  );
}

export function finishTailored(
  raster: Raster,
  meshes: ReadonlyArray<T.Mesh>,
  style: ClothStyle,
  m: Landmarks,
): void {
  const design = style.clothDesign,
    second = style.secondDesign;
  if (!design || design === "Plain cloth" || design === "Outfit swatch") return;
  if (!tailoredClothDesigns.some((d) => d === design))
    throw new Error(`The cloth design ${design} is not woven for tailored pieces.`);
  const clothMeshes = meshes.filter(
    (mesh) => mesh.userData["styleType"] === "cloth" && Object.hasOwn(tailoredFabrics, mesh.name),
  );
  const outer = clothMeshes.findLast((mesh) => mesh.userData["styleRegion"] === "spine_03");
  for (const mesh of clothMeshes) {
    const fabric = tailoredFabrics[mesh.name];
    if (!fabric) continue;
    const pattern =
      mesh === outer
        ? design
        : second && second !== "Plain cloth" && mesh.userData["styleRegion"] === "pelvis"
          ? second
          : "Quiet weave";
    weave(
      raster,
      mesh,
      fabric,
      pattern,
      mesh === outer ? (style.clothAccent ?? null) : null,
      null,
      m,
      1,
      style.brocade,
    );
  }
}
