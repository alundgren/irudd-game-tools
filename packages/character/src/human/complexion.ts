import { beardAt, isStageMakeup, paintStageMakeup } from "./stage-makeup.js";
import * as T from "three";
import { context2d, type Raster, type RasterImage } from "../raster.js";
import type { BrowName, HumanBody } from "./body.js";
import { capturedSkinNames } from "./captured.js";
import { capturedAxes } from "./catalogue.js";
import { faceChart } from "./chart.js";
import { groomNames, type GroomName } from "./groom.js";
import type { HumanAdultParams } from "./generator.js";
import { randomStream } from "./identity.js";
import { makeupPalette, mixMakeup } from "./makeup.js";
import {
  castSkinNames,
  paintBrowNames,
  type HumanPaint,
  type PaintBrowName,
} from "./paint-data.js";

const layout = 2048,
  density = 2;
export const seededHairColor = "#45352e";

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (v: number, a: number, b: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const srgbDecode = Float64Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});
const srgbEncode = (v: number) => {
  const c = clamp(v, 0, 1);
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
};
const srgbUnitToLinear = (v: number) => {
  const c = clamp(v, 0, 1.5);
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const headGain = 1.46;
const at = (array: ArrayLike<number>, i: number) => array[i] ?? 0;

const portraitRead = { browMass: 0.34, browInk: 1.35 } as const;

export function headroomForSkin(
  skin: T.Color,
  gain = headGain,
): { neutral: [number, number, number]; base: [number, number, number] } {
  const channels = [skin.r, skin.g, skin.b];
  const neutral: [number, number, number] = [255, 255, 255],
    base: [number, number, number] = [skin.r, skin.g, skin.b];
  for (let k = 0; k < 3; k++) {
    const v = channels[k] ?? 0;
    if (v <= 1e-4) continue;
    const wanted = Math.min(1, v * gain);
    if (wanted <= v * 1.0001) continue;
    const byte = Math.max(1, Math.floor(srgbEncode(v / wanted)));
    neutral[k] = byte;
    base[k] = v / at(srgbDecode, byte);
  }
  return { neutral, base };
}
function tintOn(skin: T.Color, target: T.Color): [number, number, number] {
  const encode = (v: number) =>
    Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  return [
    encode(Math.min(1, target.r / Math.max(skin.r, 0.01))),
    encode(Math.min(1, target.g / Math.max(skin.g, 0.01))),
    encode(Math.min(1, target.b / Math.max(skin.b, 0.01))),
  ];
}

type DetailName = "Smooth" | "Fine" | "Weathered" | "Lined" | "Soft lines";
const isDetail = (name: string): name is DetailName => Object.hasOwn(detailPresets, name);
const ageComplexion = (age: number): DetailName =>
  age > 0.63 ? "Soft lines" : age > 0.35 ? "Weathered" : "Fine";
const detailPresets: Readonly<
  Record<
    DetailName,
    {
      poreRelief: number;
      wrinkleRelief: number;
      wrinkleShade: number;
      mottleAmp: number;
      dryness: number;
    }
  >
> = {
  Smooth: { poreRelief: 0.24, wrinkleRelief: 0, wrinkleShade: 0, mottleAmp: 0.42, dryness: -0.015 },
  Fine: { poreRelief: 0.76, wrinkleRelief: 0.32, wrinkleShade: 0.26, mottleAmp: 0.78, dryness: 0 },
  Weathered: {
    poreRelief: 0.92,
    wrinkleRelief: 0.68,
    wrinkleShade: 0.48,
    mottleAmp: 0.94,
    dryness: 0.03,
  },
  Lined: { poreRelief: 0.95, wrinkleRelief: 1, wrinkleShade: 0.68, mottleAmp: 0.9, dryness: 0.05 },
  "Soft lines": {
    poreRelief: 0.82,
    wrinkleRelief: 0.78,
    wrinkleShade: 0.54,
    mottleAmp: 0.84,
    dryness: 0.04,
  },
};
const detailOrder: ReadonlyArray<DetailName> = [
  "Smooth",
  "Fine",
  "Weathered",
  "Lined",
  "Soft lines",
];

export interface ComplexionLook {
  readonly choice: string;
  readonly ageDetail: DetailName;
  readonly skin: T.Color;
  readonly hair: T.Color;
  readonly age: number;
  readonly frame: number;
  readonly seed: number;
  readonly brow: BrowName;
  readonly photoBrows: boolean;
  readonly makeup: string;
  readonly facialHair?: string | undefined;
}
export function complexionLook(params: HumanAdultParams, brow: BrowName): ComplexionLook {
  const age = params.human["age"] ?? 0;
  return {
    choice: params.complexion ?? ageComplexion(age),
    ageDetail: ageComplexion(age),
    skin: new T.Color(params.skin),
    hair: new T.Color(params.style.hairColor ?? seededHairColor),
    age: Math.round(age * 20) / 20,
    frame: Math.round(clamp(params.human["frame"] ?? 0, -1, 1) * 10) / 10,
    seed: params.seed >>> 0,
    brow,
    photoBrows: (params.style.browStyle ?? "As drawn") === "As drawn",
    facialHair: params.style.facialHair,
    makeup: params.style.makeup ?? "None",
  };
}

export interface ComplexionProfile {
  readonly fair: number;
  readonly naturalHue: number;
  readonly age: number;
  readonly bodyRoughness: number;
  readonly faceRoughness: number;
  readonly shineDrop: number;
  readonly lipRoughness: number;
  readonly lidRoughnessDrop: number;
  readonly microRoughAmp: number;
  readonly poreRelief: number;
  readonly wrinkleRelief: number;
  readonly wrinkleShade: number;
  readonly mottleAmp: number;
  readonly beard: number;
}
export function complexionProfile(look: ComplexionLook): ComplexionProfile {
  const c = look.skin;
  const light = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const fair = smooth(light, 0.05, 0.45);
  const naturalHue = smooth(c.r - c.g, -0.02, 0.05) * smooth(c.g - c.b, -0.04, 0.03);
  const clampedAge = clamp(look.age, 0, 1);
  const baseName: DetailName = isDetail(look.choice) ? look.choice : look.ageDetail;
  const preset = detailPresets[baseName];
  const bodyRoughness = clamp(
    mix(0.69, 0.64, fair) + 0.04 * clampedAge + preset.dryness * 0.45,
    0.58,
    0.76,
  );
  const faceRoughness = clamp(
    mix(0.64, 0.56, fair) + 0.045 * clampedAge + preset.dryness * 0.55,
    0.52,
    0.73,
  );
  return {
    fair,
    naturalHue,
    age: clampedAge,
    bodyRoughness,
    faceRoughness,
    shineDrop: mix(0.095, 0.125, fair) * (1 - 0.18 * clampedAge),
    lipRoughness: clamp(faceRoughness - 0.035, 0.5, 0.68),
    lidRoughnessDrop: 0.042,
    microRoughAmp: mix(0.03, 0.044, fair),
    poreRelief: preset.poreRelief,
    wrinkleRelief: preset.wrinkleRelief,
    wrinkleShade: preset.wrinkleShade * mix(0.85, 1, fair),
    mottleAmp: preset.mottleAmp * mix(0.78, 1, fair),
    beard: Math.min(0.2, Math.max(0, look.frame - 0.24) * 0.28),
  };
}

function detailTint(
  r: number,
  g: number,
  b: number,
  profile: ComplexionProfile,
  skinArea: number,
  open: number,
  lids: number,
): [number, number, number] {
  const pore = (r - 128) / 96,
    wrinkle = (g - 128) / 96,
    mottle = (b - 128) / 88;
  const mv = mottle * profile.mottleAmp * skinArea;
  const crease = Math.min(0, wrinkle) * profile.wrinkleShade * open * (1 - lids * 0.5);
  const poreWhisper = 1 + 0.014 * Math.min(0, pore) * profile.poreRelief * skinArea;
  return [
    (mv < 0 ? 1 + 0.024 * mv : 1) * (1 + 0.1 * crease) * poreWhisper,
    (mv < 0 ? 1 + 0.006 * mv : 1 - 0.032 * mv) * (1 + 0.16 * crease) * poreWhisper,
    (mv < 0 ? 1 + 0.014 * mv : 1 - 0.038 * mv) * (1 + 0.18 * crease) * poreWhisper,
  ];
}

function poreReliefTile(seed: number, size = 96): Float32Array {
  const next = randomStream(seed ^ 0x2f6b1d);
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) {
    const u = next();
    grid[i] = u < 0.18 ? -1.15 * (1 - u / 0.18) : 0.22 * (u - 0.5);
  }
  const out = new Float32Array(size * size);
  let mean = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const ym = (y + size - 1) % size,
        yp = (y + 1) % size,
        xm = (x + size - 1) % size,
        xp = (x + 1) % size;
      const v =
        (at(grid, ym * size + xm) +
          2 * at(grid, ym * size + x) +
          at(grid, ym * size + xp) +
          2 * at(grid, y * size + xm) +
          4 * at(grid, y * size + x) +
          2 * at(grid, y * size + xp) +
          at(grid, yp * size + xm) +
          2 * at(grid, yp * size + x) +
          at(grid, yp * size + xp)) /
        16;
      out[y * size + x] = v;
      mean += v;
    }
  mean /= out.length;
  for (let i = 0; i < out.length; i++) out[i] = at(out, i) - mean;
  return out;
}

const finishRead = {
  bumpScale: 0.0025,
  legacyRelief: 0.5,
  relief: 96,
  micro: 1.1,
  meso: 0.6,
  gloss: 1.1,
  fantasyChroma: 0.4,
  lipChroma: 0.64,
  lipChromaBroad: 0.56,
} as const;

export function finishDonors(look: ComplexionLook, paint: HumanPaint): Array<[number, number]> {
  const c = look.skin;
  const deep = 1 - smooth(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 0.085, 0.125),
    male = smooth(look.frame, 0.05, 0.25);
  const a = clamp(look.age, 0, 1),
    t =
      a < 0.25
        ? 0
        : a < 0.45
          ? (a - 0.25) / 0.2
          : a < 0.58
            ? 1
            : a < 0.76
              ? 1 + (a - 0.58) / 0.18
              : 2,
    lower = Math.floor(t);
  const seed = look.seed;
  let choice = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  choice = (choice ^ (choice >>> 13)) >>> 0;
  const shares = new Map<number, number>();
  for (const [band, ofBand] of [
    [lower, 1 - (t - lower)],
    [lower + 1, t - lower],
  ] as const)
    for (const [isDeep, ofDepth] of [
      [true, deep],
      [false, 1 - deep],
    ] as const)
      for (const [isMale, ofFrame] of [
        [true, male],
        [false, 1 - male],
      ] as const) {
        const share = ofBand * ofDepth * ofFrame;
        if (share <= 0) continue;
        const fit = paint.donors.flatMap((d, i) =>
          d.age === band && d.deep === isDeep && d.male === isMale ? [i] : [],
        );
        const index = fit[choice % fit.length];
        if (index === undefined) throw new Error("No portrait finish donor fits this face.");
        shares.set(index, (shares.get(index) ?? 0) + share);
      }
  return [...shares];
}

const lineFields = new WeakMap<HumanBody, Map<number, Int8Array>>();
function expressionLines(body: HumanBody, seed: number): Int8Array {
  const variant = (seed >>> 5) % 6;
  let fields = lineFields.get(body);
  if (!fields) lineFields.set(body, (fields = new Map<number, Int8Array>()));
  const kept = fields.get(variant);
  if (kept) return kept;
  const unit = (v: number) => Math.min(1, Math.max(0, v));
  const fade = (value: number, low: number, high: number) => {
    const t = unit((value - low) / (high - low));
    return t * t * (3 - 2 * t);
  };
  const c = faceChart(body),
    height = new Int8Array(c.x.length);
  const phase = variant * 1.13;
  const groove = (distance: number, width: number) => {
    const t = distance / width;
    return 0.32 * Math.exp(-((t - 1.5) ** 2)) - Math.exp(-t * t);
  };
  for (let i = 0; i < height.length; i++) {
    const x = at(c.x, i),
      y = at(c.y, i),
      a = Math.abs(x);
    const skin = at(c.skin, i) * fade(at(c.nz, i), 0.12, 0.6);
    if (skin < 0.001 || y < -19 || y > 65) continue;
    let relief = 0;
    if (y > 12 && a < 52) {
      for (let row = 0; row < 3; row++) {
        const length = 43 - 4 * row + 3 * Math.sin(phase + row);
        const t = a / length;
        const arc =
          28 + 8.2 * row + 4.7 * (1 - t * t) + 1.4 * Math.sin(0.13 * x + phase + 0.8 * row);
        const strength =
          (1 - fade(t, 0.48, 1)) * (0.66 + 0.24 * Math.cos(0.14 * x - 0.7 * row + phase));
        relief += strength * groove(y - arc, 0.65 + 0.12 * row);
      }
      const path = 3.9 + 0.15 * (y - 13) + 0.8 * Math.sin((y - 13) * 0.15 + phase);
      relief += groove(a - path, 0.86) * fade(y, 12, 18) * (1 - fade(y, 23, 32));
    }
    if (a > 40 && a < 70 && y < 10) {
      for (let ray = 0; ray < 3; ray++) {
        const run = a - 45,
          line =
            -1.3 +
            (ray - 1) * 2.3 +
            run * ((ray - 1) * 0.35 - 0.1) +
            0.54 * Math.sin(run * 0.24 + phase + ray);
        const strength = fade(run, -2, 3) * (1 - fade(run, 8 + ray, 16 + ray));
        relief += 0.72 * strength * groove(y - line, 0.52 + 0.017 * Math.max(0, run));
      }
    }
    height[i] = Math.round(Math.max(-1, Math.min(1, relief * skin)) * 110);
  }
  fields.set(variant, height);
  return height;
}

function skinPigment(
  paint: HumanPaint,
  seed: number,
): (u: number, v: number, output: number[]) => void {
  const random = randomStream(seed ^ 0x0b2739c1);
  const index = Math.floor(random() * paint.skinPigment.length);
  const patch = paint.skinPigment[index] ?? new Uint8Array(0),
    size = 74;
  const reflected = (value: number) => {
    const tile = Math.floor(value),
      fraction = value - tile;
    return (tile & 1 ? 1 - fraction : fraction) * (size - 1);
  };
  const shiftX = random(),
    shiftY = random(),
    angle = random() * 2 * Math.PI;
  const c = Math.cos(angle) * 6.7,
    s = Math.sin(angle) * 6.7;
  return (u, v, output) => {
    const x = reflected(c * u + s * v + shiftX);
    const y = reflected(c * v - s * u + shiftY);
    const left = Math.floor(x),
      top = Math.floor(y),
      fx = x - left,
      fy = y - top;
    const p = 3 * (top * size + left);
    const dx = left < size - 1 ? 3 : 0;
    const dy = top < size - 1 ? 3 * size : 0;
    for (let channel = 0; channel < 3; channel++) {
      const i = p + channel;
      const upper = at(patch, i) + fx * (at(patch, i + dx) - at(patch, i));
      const lower = at(patch, i + dy) + fx * (at(patch, i + dy + dx) - at(patch, i + dy));
      output[channel] = (upper + fy * (lower - upper) - 128) / 535;
    }
  };
}

export function browPigment(hair: T.Color, skin: T.Color, age: number, makeup = "None"): T.Color {
  const light = (c: T.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const stage = isStageMakeup(makeup);
  const root = new T.Color(stage ? "#291d21" : "#30251f").lerp(hair, stage ? 0.08 : 0.23);
  const value = light(root);
  root.lerp(new T.Color(value, value, value), 0.27);
  const most = (stage ? 0.26 : 0.38 + 0.075 * age) * light(skin);
  if (light(root) > most) root.multiplyScalar(most / Math.max(light(root), 0.0001));
  return root;
}

export interface HumanPaintSources {
  readonly raster: Raster;
  readonly paint: HumanPaint;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly clippedBeard: Uint8ClampedArray;
  readonly maps: ReadonlyArray<Uint8ClampedArray>;
  readonly fields: readonly [
    Uint8ClampedArray,
    Uint8ClampedArray,
    Uint8ClampedArray,
    Uint8ClampedArray,
  ];
  readonly dermal: ReadonlyArray<Uint8ClampedArray>;
  readonly brows: ReadonlyMap<PaintBrowName, RasterImage>;
  readonly body: { readonly normalMap: T.Texture; readonly roughnessMap: T.Texture };
  readonly finish: {
    readonly donors: ReadonlyArray<RasterImage>;
    readonly micro: Uint8ClampedArray;
    readonly meso: Uint8ClampedArray;
    readonly gloss: Uint8ClampedArray;
    readonly lips: Uint8ClampedArray;
  };
  readonly cast: ReadonlyMap<string, readonly [Uint8ClampedArray, Uint8ClampedArray]>;
  readonly captured: ReadonlyMap<string, readonly [Uint8ClampedArray, Uint8ClampedArray]>;
  readonly grooms: ReadonlyMap<GroomName, GroomMaps>;
}

export interface GroomMaps {
  readonly picture: RasterImage;
  readonly texture: T.Texture;
  readonly normal: T.Texture;
}

export async function prepareHumanPaint(
  raster: Raster,
  paint: HumanPaint,
  body: HumanBody,
): Promise<HumanPaintSources> {
  const [left, top, right, bottom] = body.chart.rect,
    width = right - left,
    height = bottom - top;
  const image = (name: string) => {
    const { bytes, mediaType } = paint.image(name);
    return raster.image(bytes, mediaType);
  };
  const pixels = async (name: string) => {
    const decoded = await image(name);
    const c = context2d(raster.canvas(width, height), { willReadFrequently: true });
    c.drawImage(decoded, 0, 0, width, height);
    return c.getImageData(0, 0, width, height).data;
  };
  const all = <T>(list: ReadonlyArray<Promise<T>>) => Promise.all(list);
  const pair = async (a: string, b: string) => [await pixels(a), await pixels(b)] as const;
  const [
    maps,
    fields,
    dermal,
    browList,
    normal,
    roughness,
    donors,
    micro,
    meso,
    gloss,
    lips,
    clippedBeard,
  ] = await Promise.all([
    all([0, 1, 2, 3].map((k) => pixels(`detail.${k}`))),
    all(["tone", "zones", "eyes", "visibility"].map((k) => pixels(`field.${k}`))),
    all([0, 1].map((k) => pixels(`dermal.${k}`))),
    all(paintBrowNames.map(async (n) => [n, await image(`brow.${n}`)] as const)),
    image("body.normal"),
    image("body.roughness"),
    all(paint.donors.map((_, k) => image(`finish.donor.${k}`))),
    pixels("finish.micro"),
    pixels("finish.meso"),
    pixels("finish.gloss"),
    pixels("finish.lips"),
    pixels("clippedBeard"),
  ]);
  const [tone, zones, eyes, visibility] = fields;
  if (!tone || !zones || !eyes || !visibility)
    throw new Error("The paint pack lacks a face field.");
  const cast = new Map<string, readonly [Uint8ClampedArray, Uint8ClampedArray]>();
  for (const name of castSkinNames)
    cast.set(`Portrait ${name}`, await pair(`cast.${name}.paint`, `cast.${name}.surface`));
  const captured = new Map<string, readonly [Uint8ClampedArray, Uint8ClampedArray]>();
  for (const [k, axis] of capturedAxes.entries())
    captured.set(
      capturedSkinNames[k] ?? axis,
      await pair(`captured.${axis}.paint`, `captured.${axis}.surface`),
    );
  const grooms = new Map<GroomName, GroomMaps>(
    await all(
      groomNames.map(async (name) => {
        const [picture, relief] = await Promise.all([
          image(`groom.${name}.texture`),
          image(`groom.${name}.normal`),
        ]);
        const texture = new T.Texture(picture),
          normal = new T.Texture(relief);
        texture.colorSpace = T.SRGBColorSpace;
        texture.anisotropy = 4;
        texture.needsUpdate = normal.needsUpdate = true;
        return [name, { picture, texture, normal }] as const;
      }),
    ),
  );
  const normalMap = new T.Texture(normal),
    roughnessMap = new T.Texture(roughness);
  normalMap.anisotropy = roughnessMap.anisotropy = 4;
  normalMap.needsUpdate = roughnessMap.needsUpdate = true;
  return {
    raster,
    paint,
    width,
    height,
    left,
    top,
    maps,
    clippedBeard,
    fields: [tone, zones, eyes, visibility],
    dermal,
    brows: new Map(browList),
    body: { normalMap, roughnessMap },
    finish: { donors, micro, meso, gloss, lips },
    cast,
    captured,
    grooms,
  };
}

export interface PaintedFace {
  readonly map: T.CanvasTexture;
  readonly roughnessMap: T.CanvasTexture;
  readonly bumpMap: T.CanvasTexture;
  readonly headBase: readonly [number, number, number];
  readonly skinColor: readonly [number, number, number];
}

export function paintFace(
  body: HumanBody,
  sources: HumanPaintSources,
  look: ComplexionLook,
): PaintedFace {
  const { raster, paint, width, height } = sources;
  const { choice, skin, hair, age, seed, brow } = look;
  const cast = sources.cast.get(choice);
  const captured = sources.captured.get(choice);
  const baseDetail: DetailName = cast || captured || !isDetail(choice) ? look.ageDetail : choice;
  const detail = sources.maps[detailOrder.indexOf(baseDetail) - 1];
  const [tone, zones, eyes, visibility] = sources.fields;
  const fin = sources.finish,
    finish = finishRead,
    encoding = paint.finish;
  const profile = { ...complexionProfile(look), mottleAmp: 0 };
  const makeup = makeupPalette(look.makeup);
  const donorPixels = (index: number) => {
    const c = context2d(raster.canvas(width, height), { willReadFrequently: true });
    const image = fin.donors[index];
    if (!image) throw new Error(`No finish donor ${index}.`);
    c.drawImage(image, 0, 0, width, height);
    return c.getImageData(0, 0, width, height).data;
  };
  const donors = finishDonors(look, paint).map(
    ([index, share]) => [donorPixels(index), share] as const,
  );
  const onlyDonor = donors.length === 1 ? donors[0]?.[0] : undefined;
  const finishLog = Float64Array.from({ length: 256 }, (_, b) => {
    const v = (b - 128) / 127;
    return v * (v < 0 ? encoding.darker : encoding.lighter);
  });
  const finishTint = (r: number, g: number, b: number, chroma: number, weight: number) => {
    if ((r === 128 && g === 128 && b === 128) || weight <= 0) return [1, 1, 1];
    const lr = at(finishLog, r),
      lg = at(finishLog, g),
      lb = at(finishLog, b),
      l = (lr + lg + lb) / 3;
    return [
      Math.exp(weight * (l + chroma * (lr - l))),
      Math.exp(weight * (l + chroma * (lg - l))),
      Math.exp(weight * (l + chroma * (lb - l))),
    ];
  };
  const donorChroma = mix(finish.fantasyChroma, 1, profile.naturalHue);
  const lipChroma =
    (look.frame > 0.15 ? finish.lipChromaBroad : finish.lipChroma) * mix(0.82, 1, profile.fair);
  const ageLines = smooth(profile.age, 0.3, 0.8);
  const pigmentAt = baseDetail === "Smooth" ? null : skinPigment(paint, seed);
  const localPigment = [0, 0, 0];
  const pigmentGain = 0.95 * (1 - 0.4 * ageLines);
  const reliefMap = baseDetail === "Smooth" ? null : sources.dermal[(seed >>> 3) & 1];
  const tissue = reliefMap ? 0.39 + 0.48 * profile.age : 0;
  const lineStrength =
    baseDetail === "Smooth"
      ? 0
      : Math.min(1, Math.max(0, (age - 0.18) * 1.25) + (baseDetail === "Lined" ? 0.25 : 0));
  const lines = lineStrength > 0 ? expressionLines(body, seed) : null;
  const trimmed = look.facialHair === "Clipped beard";
  const clipped = trimmed || look.facialHair === "Stubble" ? sources.clippedBeard : null;
  const root = trimmed ? hair.clone().multiplyScalar(0.66).lerp(skin, 0.12) : null;
  const gain = root
    ? clamp(
        1.04 *
          Math.max(
            root.r / Math.max(skin.r, 0.004),
            root.g / Math.max(skin.g, 0.004),
            root.b / Math.max(skin.b, 0.004),
          ),
        headGain,
        6,
      )
    : headGain;
  const { neutral, base: headBase } = headroomForSkin(skin, gain);
  const rootLinear = root
    ? root.toArray().map((v, k) => v / Math.max(0.0001, at(headBase, k)))
    : null;
  const bareLinear = neutral.map((b) => at(srgbDecode, b));
  const { beard } = profile;
  const stubble = tintOn(skin, hair.clone().lerp(skin, 0.48)).map((v) => v / 255);
  const dense = tintOn(skin, hair.clone().lerp(skin, 0.22)).map((v) => v / 255);
  const poreTileSize = 96,
    poreTile = poreReliefTile(seed, poreTileSize);
  const small = raster.canvas(width, height),
    rough = raster.canvas(width, height),
    relief = raster.canvas(width, height);
  const colour = new ImageData(width, height),
    gloss = new ImageData(width, height),
    bump = new ImageData(width, height);
  for (let i = 0; i < width * height * 4; i += 4) {
    const pixel = i / 4,
      px = pixel % width,
      py = Math.floor(pixel / width);
    const mask = at(eyes, i + 2) / 255,
      lips = at(fin.lips, i) / 255,
      lids = at(tone, i + 1) / 255;
    const beardDensity = clipped ? (at(clipped, i) / 255) * mask * (1 - lips) : 0;
    const cover = clipped
      ? trimmed
        ? Math.min(0.96, 1.33 * beardDensity)
        : 0.32 * beardDensity
      : beardAt(body, look.facialHair, (px + 0.5) / width, (py + 0.5) / height, true);
    const rootGrain = clipped ? 0.26 + (0.7 * at(clipped, i + 1)) / 128 : 1;
    const blush = at(zones, i) / 255,
      shine = at(zones, i + 1) / 255,
      growth = (at(zones, i + 2) / 255) * (1 - lips) * beard;
    const socket = at(eyes, i + 1) / 255;
    const pore = detail ? (at(detail, i) - 128) / 96 : 0;
    const wrinkle = detail ? (at(detail, i + 1) - 128) / 96 : 0;
    const open = mask * (1 - lips) * (1 - cover);
    const skinArea = open * (1 - lids * 0.7);
    if (pigmentAt && skinArea > 0) pigmentAt((px + 0.5) / width, (py + 0.5) / height, localPigment);
    const photo = 0;
    const procPore =
      at(poreTile, (py % poreTileSize) * poreTileSize + (px % poreTileSize)) * profile.poreRelief;
    const plane = 1,
      warmG = 1,
      warmB = 1;
    const [detR, detG, detB] = detail
      ? detailTint(
          at(detail, i),
          at(detail, i + 1),
          at(detail, i + 2),
          profile,
          skinArea,
          open,
          lids,
        )
      : [1, 1, 1];
    const tints = [
      plane * detR * mix(1, at(stubble, 0), growth) * mix(1, at(dense, 0), root ? 0 : cover),
      plane *
        detG *
        warmG *
        mix(1, at(stubble, 1), growth) *
        mix(1, at(dense, 1), root ? 0 : cover),
      plane *
        detB *
        warmB *
        mix(1, at(stubble, 2), growth) *
        mix(1, at(dense, 2), root ? 0 : cover),
    ];
    let pigLinear: number[];
    {
      const chroma = donorChroma * (1 - (1 - lipChroma) * lips),
        weight = 1 - cover;
      if (onlyDonor)
        pigLinear = finishTint(
          at(onlyDonor, i),
          at(onlyDonor, i + 1),
          at(onlyDonor, i + 2),
          chroma,
          weight,
        );
      else {
        let r = 0,
          g = 0,
          b = 0;
        for (const [donor, share] of donors) {
          r += at(finishLog, at(donor, i)) * share;
          g += at(finishLog, at(donor, i + 1)) * share;
          b += at(finishLog, at(donor, i + 2)) * share;
        }
        const l = (r + g + b) / 3;
        pigLinear = [
          Math.exp(weight * (l + chroma * (r - l))),
          Math.exp(weight * (l + chroma * (g - l))),
          Math.exp(weight * (l + chroma * (b - l))),
        ];
      }
    }
    const ridge = reliefMap ? ((at(reliefMap, i) - 128) / 118) * tissue * mask : 0;
    const sebum = reliefMap ? ((at(reliefMap, i + 1) - 128) / 118) * tissue * mask : 0;
    const cavity = reliefMap ? ((at(reliefMap, i + 2) - 128) / 118) * tissue * mask : 0;
    const crease = lines ? (at(lines, pixel) / 110) * lineStrength * mask : 0;
    const depth = Math.min(0, crease) * 0.26 + Math.min(0, cavity) * 0.14;
    tints[0] = at(tints, 0) * (1 + depth * 0.78);
    tints[1] = at(tints, 1) * (1 + depth);
    tints[2] = at(tints, 2) * (1 + depth * 1.04);
    if (cast) {
      const [castPaint, material] = cast;
      const region = at(material, i + 2) / 255,
        weight = mask * (1 - cover) * (1 - 0.32 * profile.age);
      const lum =
        0.25 * at(castPaint, i) + 0.61 * at(castPaint, i + 1) + 0.14 * at(castPaint, i + 2) - 128;
      for (let k = 0; k < 3; k++) {
        const chroma = at(castPaint, i + k) - 128 - lum;
        const local = (1.18 * lum + (0.15 + 0.85 * profile.naturalHue) * chroma) / 94;
        pigLinear[k] = Math.exp(
          (1 - weight * region) * Math.log(at(pigLinear, k)) + weight * local,
        );
      }
    }
    if (captured) {
      const [capturedPaint, surface] = captured;
      const region = (at(surface, i + 2) / 255) * mask * (1 - cover);
      const light =
        (0.26 * at(capturedPaint, i) +
          0.59 * at(capturedPaint, i + 1) +
          0.15 * at(capturedPaint, i + 2) -
          128) /
        51;
      const liftedBrow = look.photoBrows ? 0 : at(surface, i + 1) / 102;
      for (let k = 0; k < 3; k++) {
        const chroma = (at(capturedPaint, i + k) - 128) / 51 - light;
        const target = 0.94 * light + 0.8 * profile.naturalHue * chroma + liftedBrow;
        pigLinear[k] = Math.exp((1 - region) * Math.log(at(pigLinear, k)) + region * target);
      }
    }
    if (makeup) mixMakeup(tints, makeup, lips, lids, socket, blush, mask);
    for (let k = 0; k < 3; k++) {
      const sVal = at(tints, k) + (photo * 0.18) / 255;
      if (mask === 0 && photo === 0 && sVal === 1 && pigLinear[k] === 1) {
        colour.data[i + k] = at(neutral, k);
      } else {
        const variation = pigmentAt ? Math.exp(pigmentGain * skinArea * at(localPigment, k)) : 1;
        const lit = srgbUnitToLinear(sVal) * at(pigLinear, k) * at(bareLinear, k) * variation;
        colour.data[i + k] = Math.round(
          srgbEncode(
            rootLinear && cover > 0 ? mix(lit, at(rootLinear, k) * rootGrain, cover) : lit,
          ),
        );
      }
    }
    colour.data[i + 3] = 255;

    let roughVal = mix(profile.bodyRoughness, profile.faceRoughness, mask);
    roughVal -= profile.shineDrop * shine * mask * (1 - cover);
    roughVal -=
      ((finish.gloss * (at(fin.gloss, i) - 128)) / encoding.gloss) * (1 - cover) * (1 - lips);
    if (cast) {
      const cm = cast[1],
        spatial = 0.0019 * (at(cm, i + 1) - 128);
      roughVal = mix(
        roughVal,
        profile.faceRoughness - 0.045 - spatial,
        (at(cm, i + 2) / 255) * mask * (1 - cover),
      );
    }
    roughVal -= profile.lidRoughnessDrop * lids * mask;
    roughVal = mix(roughVal, makeup?.roughness ?? profile.lipRoughness, lips * mask);
    roughVal = mix(roughVal, 0.72, Math.min(1, growth * 1.35));
    roughVal = mix(roughVal, 0.76, cover);
    roughVal +=
      (-profile.microRoughAmp * (pore * profile.poreRelief + 0.55 * procPore) -
        0.028 * wrinkle * profile.wrinkleRelief -
        (photo / 255) * 0.08) *
      skinArea;
    roughVal = clamp(roughVal - 0.11 * sebum - 0.035 * crease, 0.24, 0.8);
    gloss.data[i] = at(visibility, i);
    gloss.data[i + 1] = Math.round(255 * (roughVal / 0.8));
    gloss.data[i + 2] = 0;
    gloss.data[i + 3] = 255;

    const lipGrain = lips * mask * procPore * 4.5;
    let high =
      128 +
      (pore * 36 * profile.poreRelief +
        wrinkle * 48 * profile.wrinkleRelief +
        procPore * 12 +
        photo * 1.1) *
        skinArea +
      lipGrain +
      104 * ridge +
      105 * crease;
    {
      const forms = Math.max(
          lips,
          mix(0.4, 0.7, ageLines) * Math.max(lids, 0.6 * socket),
          0.06 + 0.94 * ageLines,
        ),
        fine = 1 - (1 - ageLines) * (0.2 + 0.5 * Math.max(socket, at(eyes, i) / 255));
      high =
        128 +
        (high - 128) * finish.legacyRelief +
        finish.relief *
          (1 - cover) *
          ((finish.micro *
            fine *
            (1 - (0.55 * at(zones, i + 2)) / 255) *
            (at(fin.micro, i) - 128)) /
            encoding.micro +
            (finish.meso * forms * (at(fin.meso, i) - 128)) / encoding.meso);
    }
    if (cast) {
      const cm = cast[1],
        area = mask * (1 - cover);
      high =
        128 +
        (high - 128) * (1 - ((0.48 * at(cm, i + 2)) / 255) * area) +
        1.15 * (at(cm, i) - 128) * area;
    }
    if (captured) {
      const surface = captured[1],
        amount = (at(surface, i + 2) / 255) * mask * (1 - cover);
      high = mix(high, 128 + 0.09 * (at(surface, i) - 128) + 0.32 * (high - 128), amount);
    }
    if (clipped) high += (at(clipped, i + 2) - 128) * cover * 0.62;
    bump.data[i] = bump.data[i + 1] = bump.data[i + 2] = high;
    bump.data[i + 3] = 255;
  }
  context2d(small).putImageData(colour, 0, 0);
  context2d(rough).putImageData(gloss, 0, 0);
  context2d(relief).putImageData(bump, 0, 0);
  const w = width * density,
    h = height * density;
  const enlarge = (source: HTMLCanvasElement) => {
    const c = raster.canvas(w, h),
      ctx = context2d(c);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    return c;
  };
  const map = enlarge(small),
    roughness = enlarge(rough),
    height2 = enlarge(relief);
  const fine = raster.canvas(w, h),
    f = context2d(fine);
  f.fillStyle = "#fff";
  f.fillRect(0, 0, w, h);
  const ink = (target: T.Color) => {
    const [r, g2, b] = tintOn(skin, target);
    return "rgb(" + r + "," + g2 + "," + b + ")";
  };
  const browImage = sources.brows.get(brow),
    placement = paint.brows[brow];
  if (!browImage) throw new Error(`The paint pack has no brow ${brow}.`);
  const capturedAxis = captured ? capturedAxes[capturedSkinNames.indexOf(choice)] : undefined;
  if (!(capturedAxis && look.photoBrows && paint.capturedBrows(capturedAxis))) {
    const tint = raster.canvas(browImage.width, browImage.height);
    const inkLayer = context2d(tint);
    inkLayer.drawImage(browImage, 0, 0);
    inkLayer.globalCompositeOperation = "source-in";
    inkLayer.fillStyle = ink(browPigment(hair, skin, age, look.makeup));
    inkLayer.fillRect(0, 0, tint.width, tint.height);
    f.save();
    f.filter = "blur(" + 1.8 * density + "px)";
    f.globalAlpha = portraitRead.browMass;
    for (const dx of [-3.2, -1.6, 0, 1.6, 3.2])
      f.drawImage(tint, placement.x + dx * density, placement.y);
    f.restore();
    f.drawImage(tint, placement.x, placement.y);
    f.globalAlpha = Math.min(1, portraitRead.browInk - 1);
    f.drawImage(tint, placement.x, placement.y);
    f.globalAlpha = 1;
  }
  f.lineCap = "round";
  const lash = hair.clone().lerp(new T.Color("#120d0b"), 0.7);
  for (const lidLine of body.chart.lids) {
    const p = lidLine.points;
    f.strokeStyle = ink(
      lidLine.lower ? lash.clone().lerp(skin, 0.5) : lash.clone().lerp(skin, 0.06),
    );
    for (const [line, alpha] of lidLine.lower
      ? [
          [4 * density, 0.12],
          [1.3 * density, 0.3],
        ]
      : [
          [10 * density, 0.2],
          [5 * density, 0.5],
          [2.2 * density, 0.85],
        ]) {
      f.lineWidth = line ?? 0;
      f.globalAlpha = alpha ?? 0;
      f.lineJoin = "round";
      f.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        const x = at(p, i) * w,
          y = at(p, i + 1) * h;
        if (i) f.lineTo(x, y);
        else f.moveTo(x, y);
      }
      f.stroke();
    }
  }
  f.globalAlpha = 1;
  const coverCanvas = raster.canvas(width, height),
    cover2d = context2d(coverCanvas),
    alpha = new ImageData(width, height);
  for (let i = 0; i < alpha.data.length; i += 4) alpha.data[i + 3] = at(eyes, i + 2);
  cover2d.putImageData(alpha, 0, 0);
  f.globalCompositeOperation = "destination-in";
  f.drawImage(coverCanvas, 0, 0, w, h);
  const mc = context2d(map);
  mc.globalCompositeOperation = "multiply";
  mc.drawImage(fine, 0, 0);
  const [patchX, patchY, patchHalf] = body.chart.mouthPatch;
  const inner = (patchHalf + 4) * density,
    cx = patchX * density,
    cy = patchY * density;
  const mouthRgb = [142, 112, 110].map((v, k) =>
    Math.round(srgbEncode(at(srgbDecode, v) * at(bareLinear, k))),
  );
  for (const [canvas, fill] of [
    [map, `rgb(${mouthRgb[0]},${mouthRgb[1]},${mouthRgb[2]})`],
    [roughness, "rgb(96,205,0)"],
    [height2, "rgb(128,128,128)"],
  ] as const) {
    const c = context2d(canvas);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.fillStyle = fill;
    c.fillRect(cx - inner, cy - inner, 2 * inner, 2 * inner);
  }
  const texture = (canvas: HTMLCanvasElement, srgb: boolean) => {
    const t = new T.CanvasTexture(canvas);
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  if (isStageMakeup(look.makeup)) {
    const glossContext = context2d(roughness);
    const colour = mc.getImageData(0, 0, w, h),
      gloss = glossContext.getImageData(0, 0, w, h);
    const base = paintStageMakeup(body, { map: colour.data, rough: gloss.data }, look.makeup, {
      skin: [skin.r, skin.g, skin.b],
      base: headBase,
      brow: look.brow,
      facialHair: look.facialHair,
      clippedBeard: clipped,
    });
    for (const i of [0, 1, 2] as const) headBase[i] = base[i] ?? headBase[i];
    mc.putImageData(colour, 0, 0);
    glossContext.putImageData(gloss, 0, 0);
  }
  return {
    map: texture(map, true),
    roughnessMap: texture(roughness, false),
    bumpMap: texture(height2, false),
    headBase,
    skinColor: [skin.r, skin.g, skin.b],
  };
}

export function faceMaterial(
  base: T.MeshStandardMaterial,
  body: HumanBody,
  sources: HumanPaintSources,
  look: ComplexionLook,
): T.MeshStandardMaterial {
  const material = base.clone();
  const { map, roughnessMap, bumpMap, headBase, skinColor } = paintFace(body, sources, look);
  material.color.setRGB(headBase[0], headBase[1], headBase[2]);
  Object.assign(material, {
    map,
    roughnessMap,
    metalnessMap: roughnessMap,
    metalness: 0,
    aoMap: roughnessMap,
    aoMapIntensity: 0.72,
    bumpMap,
    bumpScale: sources.captured.has(look.choice) ? 0.0016 : finishRead.bumpScale,
    roughness: 0.8,
  });
  material.userData = {
    ...material.userData,
    portrait: true,
    faceLayout: true,
    quietCheeks: false,
    skinColor,
    paintedLips: look.makeup === "None",
  };
  return material;
}

export function skinMaterial(
  base: T.MeshStandardMaterial,
  sources: HumanPaintSources,
  look: ComplexionLook,
): T.MeshStandardMaterial {
  const material = base.clone();
  material.roughness = complexionProfile(look).bodyRoughness;
  Object.assign(material, sources.body);
  material.normalScale.setScalar(0.82);
  material.userData["bodySkin"] = true;
  return material;
}

export function fitFaceLayout(
  geometry: T.BufferGeometry,
  sources: HumanPaintSources,
  body: HumanBody,
  lining: ArrayLike<number> | null,
): void {
  const uv = geometry.getAttribute("uv");
  if (!(uv instanceof T.BufferAttribute)) throw new Error("A head without texture coordinates.");
  const { width, height, left, top } = sources;
  const [liningLeft, liningTop, liningRight, liningBottom] = sources.paint.mouthIsland;
  const [patchX, patchY, patchHalf] = body.chart.mouthPatch;
  const unit = (v: number) => Math.min(1, Math.max(0, v));
  for (let i = 0; i < uv.count; i++) {
    const x = uv.getX(i) * layout,
      y = (1 - uv.getY(i)) * layout;
    if (lining ? lining[i] : x > liningLeft && x < liningRight && y > liningTop && y < liningBottom)
      uv.setXY(
        i,
        (patchX + (unit((x - liningLeft) / (liningRight - liningLeft)) - 0.5) * patchHalf) / width,
        1 -
          (patchY + (unit((y - liningTop) / (liningBottom - liningTop)) - 0.5) * patchHalf) /
            height,
      );
    else uv.setXY(i, (x - left) / width, 1 - (y - top) / height);
  }
  uv.needsUpdate = true;
}
