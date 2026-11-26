// Garments of one cast member worn by another: the same person, face and hair
// in another member's top and bottom (character-view/human-cast-wardrobe.js at
// 2761eb1). Each supported combination was fitted to the receiver beforehand
// (the cast pack's fitted outfits); here the fitted figure is put in the form
// the cast build reads, and its picture is put together from art the cast
// already carries.

import {
  castBodySkin,
  castFigures,
  castPieceCodes,
  castPieces,
  castPictureSide,
  castPoseNames,
  castReceivers,
  castSlug,
  castVariantKey,
  type CastFigureData,
  type CastFigureEntry,
  type CastFigureName,
  type CastPieceCode,
  type CastVariant,
  type HumanCast,
} from "./cast-data.js";
import { randomStream } from "./identity.js";
import type { HumanPaint } from "./paint-data.js";

/** The style fields an outfit is saved in: the name of a top and of a bottom. Absent means the person's own. */
export interface CastOutfitStyle {
  readonly castTop?: string | undefined;
  readonly castBottom?: string | undefined;
}

const at = (a: ArrayLike<number>, i: number) => a[i] ?? 0;
const codeOf = (slot: "top" | "bottom", name: string | undefined): CastPieceCode | undefined =>
  castPieceCodes.find((code) => castPieces[code][slot] === name);

/** Every top and every bottom the wardrobe holds, by name. */
export const castTopNames: ReadonlyArray<string> = castPieceCodes.map((c) => castPieces[c].top);
export const castBottomNames: ReadonlyArray<string> = castPieceCodes.map(
  (c) => castPieces[c].bottom,
);

/** The outfits a cast member can wear, own first. None for a member with no fitted outfits. */
export function castOutfits(
  name: CastFigureName,
): ReadonlyArray<{ readonly castTop: string; readonly castBottom: string }> {
  const receiver = castReceivers[name];
  if (!receiver) return [];
  const named = (top: CastPieceCode, bottom: CastPieceCode) => ({
    castTop: castPieces[top].top,
    castBottom: castPieces[bottom].bottom,
  });
  return [
    named(receiver.own, receiver.own),
    ...receiver.variants.map((v) => named(v.top, v.bottom)),
  ];
}

// The fitted combination a style asks for, or null for the person's own clothes.
function chosen(name: CastFigureName, style: CastOutfitStyle): CastVariant | null {
  const receiver = castReceivers[name];
  if (!receiver) return null;
  const top = codeOf("top", style.castTop) ?? receiver.own,
    bottom = codeOf("bottom", style.castBottom) ?? receiver.own;
  return receiver.variants.find((v) => v.top === top && v.bottom === bottom) ?? null;
}

/** What is wrong with a style's outfit for this member: [] when it can be worn as saved. */
export function castOutfitProblems(name: CastFigureName, style: CastOutfitStyle): string[] {
  const problems: string[] = [];
  if (style.castTop !== undefined && !codeOf("top", style.castTop))
    problems.push("castTop names no piece: " + style.castTop);
  if (style.castBottom !== undefined && !codeOf("bottom", style.castBottom))
    problems.push("castBottom names no piece: " + style.castBottom);
  if (problems.length || (style.castTop === undefined && style.castBottom === undefined))
    return problems;
  const all = castOutfits(name);
  const wanted = {
    castTop: style.castTop ?? all[0]?.castTop,
    castBottom: style.castBottom ?? all[0]?.castBottom,
  };
  if (!all.some((o) => o.castTop === wanted.castTop && o.castBottom === wanted.castBottom))
    problems.push(`${name} has no fitted ${wanted.castTop} with ${wanted.castBottom}`);
  return problems;
}

/** The outfit as worn, the person's own when the style asks for nothing fitted; null for a member the wardrobe has not fitted. */
export function wornCastOutfit(
  name: CastFigureName,
  style: CastOutfitStyle,
): { readonly top: CastPieceCode; readonly bottom: CastPieceCode; readonly own: boolean } | null {
  const receiver = castReceivers[name];
  if (!receiver) return null;
  const pick = chosen(name, style);
  return { top: pick?.top ?? receiver.own, bottom: pick?.bottom ?? receiver.own, own: !pick };
}

/** Sources of the borrowed pieces, for the credit: avatar paths besides the member's own. */
export function castOutfitSubjects(name: CastFigureName, style: CastOutfitStyle): string[] {
  const pick = chosen(name, style),
    own = castReceivers[name]?.own;
  if (!pick) return [];
  return [
    ...new Set(
      [pick.top, pick.bottom]
        .filter((code) => code !== own)
        .map((code) => castPieces[code].subject),
    ),
  ];
}

/** An outfit for a seed: the same seed gives the same outfit. `keep` is the share that stay in their own clothes. */
export function drawCastOutfit(name: CastFigureName, seed: number, keep = 0.4): CastOutfitStyle {
  const all = castOutfits(name);
  if (all.length < 2) return {};
  const draw = randomStream((seed ^ 0x51c0a7f3) >>> 0);
  if (draw() < keep) return {};
  const picked = all[1 + Math.floor(draw() * (all.length - 1))];
  return picked ? { castTop: picked.castTop, castBottom: picked.castBottom } : {};
}

// Rows of whole numbers that stood for shares of one.
function shares(values: ArrayLike<number>, size: number): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += size) {
    let sum = 0;
    for (let j = 0; j < size; j++) sum += at(values, i + j);
    for (let j = 0; j < size; j++) out[i + j] = sum ? at(values, i + j) / sum : 0;
  }
  return out;
}

// The receiver's authored face shape on the fitted figure: its head points are the receiver's own.
function carried(values: Float32Array, like: Uint16Array): Float32Array {
  const out = new Float32Array(like.length * 3);
  for (let i = 0; i < like.length; i++) {
    const from = at(like, i);
    if (from !== 65535) for (let d = 0; d < 3; d++) out[i * 3 + d] = at(values, from * 3 + d);
  }
  return out;
}

/** A figure as the cast build reads it, and the outfit it was fitted in (null for the member's own). */
export interface WornFigure {
  readonly figure: CastFigureData;
  readonly fitted: CastVariant | null;
}

const made = new WeakMap<HumanCast, Map<string, CastFigureData>>();

/**
 * The figure a member wears in the outfit a style names: the member's own
 * figure when the style names no fitted outfit.
 */
export function castOutfit(
  cast: HumanCast,
  name: CastFigureName,
  style: CastOutfitStyle,
): WornFigure {
  const own = cast.figure(name),
    pick = chosen(name, style);
  if (!pick) return { figure: own, fitted: null };
  const cache = made.get(cast) ?? new Map<string, CastFigureData>();
  made.set(cast, cache);
  const id = `${name}/${castVariantKey(pick)}`;
  const known = cache.get(id);
  if (known) return { figure: known, fitted: pick };
  const packed = cast.variant(name, pick),
    field = packed.field;
  // Each handle's weights are shares of one.
  const starts = field.starts,
    raw = field.weights,
    weights = new Float32Array(raw.length);
  for (let h = 0; h < starts.length - 1; h++) {
    let sum = 0;
    for (let p = at(starts, h); p < at(starts, h + 1); p++) sum += at(raw, p);
    for (let p = at(starts, h); p < at(starts, h + 1); p++) weights[p] = at(raw, p) / sum;
  }
  const fitted: CastFigureData = {
    name,
    positions: packed.positions,
    surface: {
      source: packed.source,
      index: packed.index,
      smooth: packed.smooth,
      uv: Float32Array.from(packed.uv, (v) => v / 65535),
    },
    weights: shares(packed.weights, 4),
    joints: packed.joints,
    field: {
      starts,
      vertices: field.vertices,
      weights,
      rest: field.rest,
      near: field.near,
      pull: shares(field.pull, field.reach),
      reach: field.reach,
    },
    faceTriangles: packed.faceTriangles,
    poses: packed.poses,
    cards: packed.cards,
    blend: own.blend
      ? {
          donor: own.blend.donor,
          shape: carried(own.blend.shape, packed.like),
          poses: new Map(
            castPoseNames.map((pose) => [
              pose,
              carried(own.blend?.poses.get(pose) ?? new Float32Array(), packed.like),
            ]),
          ),
        }
      : null,
    skirt: null,
  };
  cache.set(id, fitted);
  return { figure: fitted, fitted: pick };
}

/** A member's picture: RGB pixels, the face-skin mask and the photographed face skin. */
export interface CastPicture {
  readonly side: number;
  readonly tone: readonly [number, number, number];
  readonly pixels: Uint8Array;
  readonly mask: Uint8Array;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** A member's own picture as the paint pack holds it. */
export function ownCastPicture(paint: HumanPaint, name: CastFigureName): CastPicture {
  const entry: CastFigureEntry = castFigures[name];
  return {
    side: castPictureSide,
    tone: entry.tone,
    pixels: paint.castPicture(`castFigure.${castSlug(name)}.pixels`),
    mask: paint.castPicture(`castFigure.${castSlug(name)}.mask`),
  };
}

interface Art {
  readonly pixels: Uint8Array;
  readonly mask: Uint8Array;
  readonly tone: ReadonlyArray<number> | null;
}

// The skin a garment's art was photographed with, and its art: the body half of its own member's picture, or the copy
// the wardrobe carries.
function bodyArt(paint: HumanPaint, code: CastPieceCode, side: number): Art {
  const half = side / 2,
    piece = castPieces[code],
    pixels = new Uint8Array(half * side * 3),
    mask = new Uint8Array(half * side);
  if (piece.figure) {
    const own = ownCastPicture(paint, piece.figure);
    for (let y = 0; y < side; y++) {
      pixels.set(own.pixels.subarray(y * side * 3, (y * side + half) * 3), y * half * 3);
      mask.set(own.mask.subarray(y * side, y * side + half), y * half);
    }
  } else {
    pixels.set(paint.castPicture(`castArt.${code}.pixels`));
    mask.set(paint.castPicture(`castArt.${code}.mask`));
  }
  return { pixels, mask, tone: castBodySkin[piece.figure ?? code] ?? null };
}

// A borrowed garment's bare skin (hands, arms, legs, the neck in a collar) in the receiver's own skin colour.
function reskin(art: Art, target: ReadonlyArray<number> | null): Art {
  const tone = art.tone;
  if (!tone || !target) return art;
  const lut = tone.map((from, k) =>
    Uint8Array.from({ length: 256 }, (_, i) =>
      Math.round(255 * toSrgb(Math.min(1, (toLinear(i / 255) * at(target, k)) / from))),
    ),
  );
  const pixels = art.pixels.slice();
  for (let i = 0; i < art.mask.length; i++)
    if (art.mask[i])
      for (let k = 0; k < 3; k++)
        pixels[i * 3 + k] =
          at(pixels, i * 3 + k) +
          Math.round(
            (at(art.mask, i) / 255) *
              (at(lut[k] ?? [], at(pixels, i * 3 + k)) - at(pixels, i * 3 + k)),
          );
  return { ...art, pixels };
}

/**
 * The picture a member wears an outfit in: the top's art in the left half,
 * the receiver's head above right, the bottom's art (half as tall) below
 * right. The skin mask is put together the same way, so the skin colour
 * control reaches the borrowed skin too.
 */
export function castOutfitPicture(
  paint: HumanPaint,
  name: CastFigureName,
  fitted: CastVariant | null,
): CastPicture {
  const receiver = ownCastPicture(paint, name);
  const own = castReceivers[name]?.own;
  if (!fitted || !own) return receiver;
  const side = receiver.side,
    half = side / 2;
  const pixels = receiver.pixels.slice(),
    mask = receiver.mask.slice();
  // The receiver's own body skin where the picture has any; else the face's.
  const target = castBodySkin[name] ?? receiver.tone;
  const art = (code: CastPieceCode) =>
    code === own ? bodyArt(paint, code, side) : reskin(bodyArt(paint, code, side), target);
  const top = art(fitted.top);
  for (let y = 0; y < side; y++) {
    pixels.set(top.pixels.subarray(y * half * 3, (y + 1) * half * 3), y * side * 3);
    mask.set(top.mask.subarray(y * half, (y + 1) * half), y * side);
  }
  if (fitted.bottom !== fitted.top) {
    const bottom = art(fitted.bottom),
      mean = (from: Uint8Array, row: number, y: number, i: number) =>
        (at(from, 2 * y * row + i) + at(from, (2 * y + 1) * row + i) + 1) >> 1;
    for (let y = 0; y < half; y++) {
      for (let i = 0; i < half * 3; i++)
        pixels[((half + y) * side + half) * 3 + i] = mean(bottom.pixels, half * 3, y, i);
      for (let i = 0; i < half; i++)
        mask[(half + y) * side + half + i] = mean(bottom.mask, half, y, i);
    }
  }
  return { side, tone: receiver.tone, pixels, mask };
}
