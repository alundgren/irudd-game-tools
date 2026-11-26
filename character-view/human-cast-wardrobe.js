import { unzlibSync } from "three/addons/libs/fflate.module.js";
import figures from "./human-cast-data.json" with { type: "json" };
import wardrobe from "./human-cast-wardrobe-data.json" with { type: "json" };
import { randomStream } from "./random.js";

const decoded = new WeakMap();
function unpack(owner, name, Type) {
  if (ArrayBuffer.isView(owner[name])) return owner[name];
  if (!decoded.has(owner)) decoded.set(owner, new Map());
  const cache = decoded.get(owner);
  if (!cache.has(name)) {
    const bytes = unzlibSync(Uint8Array.from(atob(owner[name]), c => c.charCodeAt(0)));
    cache.set(name, new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT));
  }
  return cache.get(name);
}

const pieces = wardrobe.pieces;
const slots = ["top", "bottom"], fields = { top: "castTop", bottom: "castBottom" };
const own = label => wardrobe.receivers[label]?.own;
const codeOf = (slot, name) => Object.keys(pieces).find(code => pieces[code][slot] === name);

export const castOutfitFields = Object.values(fields);

export const castPieces = Object.fromEntries(slots.map(slot => [slot, Object.fromEntries(Object.values(pieces).map(p => [p[slot], p.subject]))]));

export function castOutfits(label) {
  const mine = own(label);
  if (!mine) return [];
  const named = key => { const [top, bottom] = key.split("/"); return { castTop: pieces[top].top, castBottom: pieces[bottom].bottom }; };
  return [named(mine + "/" + mine), ...Object.keys(wardrobe.receivers[label].variants).map(named)];
}

export const castTops = label => [...new Set(castOutfits(label).map(o => o.castTop))];
export const castBottoms = (label, top) => {
  const all = castOutfits(label), wanted = top ?? all[0]?.castTop;
  return all.filter(o => o.castTop === wanted).map(o => o.castBottom);
};

function chosen(label, style) {
  const mine = own(label);
  if (!mine || !style) return null;
  const top = codeOf("top", style.castTop) ?? mine, bottom = codeOf("bottom", style.castBottom) ?? mine;
  const key = top + "/" + bottom;
  return Object.hasOwn(wardrobe.receivers[label].variants, key) ? { key, top, bottom } : null;
}

export function castOutfitProblems(label, style = {}) {
  const problems = [];
  for (const slot of slots) {
    const value = style[fields[slot]];
    if (value !== undefined && typeof value !== "string") problems.push(fields[slot] + " is not a name");
    else if (value !== undefined && !codeOf(slot, value)) problems.push(fields[slot] + " names no piece: " + value);
  }
  if (problems.length || (style.castTop === undefined && style.castBottom === undefined)) return problems;
  const wanted = { castTop: style.castTop ?? castOutfits(label)[0]?.castTop, castBottom: style.castBottom ?? castOutfits(label)[0]?.castBottom };
  if (!castOutfits(label).some(o => o.castTop === wanted.castTop && o.castBottom === wanted.castBottom))
    problems.push(label + " has no fitted " + wanted.castTop + " with " + wanted.castBottom);
  return problems;
}

export function wornCastOutfit(label, style) {
  const mine = own(label), pick = chosen(label, style);
  if (!mine) return null;
  return { castTop: pieces[pick?.top ?? mine].top, castBottom: pieces[pick?.bottom ?? mine].bottom, own: !pick };
}

export function castOutfitSubjects(label, style) {
  const pick = chosen(label, style);
  if (!pick) return [];
  return [...new Set([pick.top, pick.bottom].filter(code => code !== own(label)).map(code => pieces[code].subject))];
}

export function drawCastOutfit(label, seed, keep = .4) {
  const all = castOutfits(label);
  if (all.length < 2) return {};
  const draw = randomStream((seed ^ 0x51c0a7f3) >>> 0);
  if (draw() < keep) return {};
  const { castTop, castBottom } = all[1 + Math.floor(draw() * (all.length - 1))];
  return { castTop, castBottom };
}

function shares(values, size) {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += size) {
    let sum = 0;
    for (let j = 0; j < size; j++) sum += values[i + j];
    for (let j = 0; j < size; j++) out[i + j] = sum ? values[i + j] / sum : 0;
  }
  return out;
}

const toLinear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const toSrgb = v => v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055;
const hex = tone => "#" + tone.map(v => Math.round(toSrgb(v) * 255).toString(16).padStart(2, "0")).join("");

export const castSkin = label => Object.hasOwn(figures, label) ? hex(figures[label].paint.tone) : null;

export function drawCastSkin(label, skin, seed, keep = .6) {
  const original = castSkin(label);
  if (!original || typeof skin !== "string" || !/^#[0-9a-f]{6}$/i.test(skin)) return original;
  if (randomStream((seed ^ 0x2b7e1516) >>> 0)() < keep) return original;
  const tone = figures[label].paint.tone, wanted = [1, 3, 5].map(i => toLinear(parseInt(skin.slice(i, i + 2), 16) / 255));
  const light = c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  if (light(wanted) === 0) return hex(tone.map(v => .4 * v));
  const ratio = light(wanted) / light(tone), held = Math.min(1.45, Math.max(.4, ratio)) / ratio;
  return hex(wanted.map((value, k) => {
    const v = Math.max(value, 1e-6), balance = v / light(wanted) / (tone[k] / light(tone));
    return Math.min(1, v * held * Math.min(1.5, Math.max(1 / 1.5, balance)) / balance);
  }));
}

function bodyArt(code, side) {
  const half = side / 2, piece = pieces[code], pixels = new Uint8Array(half * side * 3), mask = new Uint8Array(half * side);
  if (piece.figure) {
    const paint = figures[piece.figure].paint, rgb = unpack(paint, "pixels", Uint8Array), skin = unpack(paint, "mask", Uint8Array);
    for (let y = 0; y < side; y++) {
      pixels.set(rgb.subarray(y * side * 3, (y * side + half) * 3), y * half * 3);
      mask.set(skin.subarray(y * side, y * side + half), y * half);
    }
  } else {
    pixels.set(unpack(wardrobe.art[code], "pixels", Uint8Array));
    if (wardrobe.art[code].mask) mask.set(unpack(wardrobe.art[code], "mask", Uint8Array));
  }
  return { pixels, mask, tone: wardrobe.skin?.[piece.figure ?? code]?.body };
}

function reskin(art, target) {
  if (!art.tone || !target) return art;
  const lut = art.tone.map((from, k) => Uint8Array.from({ length: 256 }, (_, i) => Math.round(255 * toSrgb(Math.min(1, toLinear(i / 255) * target[k] / from)))));
  const pixels = art.pixels.slice();
  for (let i = 0; i < art.mask.length; i++) if (art.mask[i])
    for (let k = 0; k < 3; k++) pixels[i * 3 + k] += Math.round(art.mask[i] / 255 * (lut[k][pixels[i * 3 + k]] - pixels[i * 3 + k]));
  return { ...art, pixels };
}

function painted(label, receiver, pick) {
  const side = receiver.side, half = side / 2;
  const pixels = unpack(receiver, "pixels", Uint8Array).slice(), mask = unpack(receiver, "mask", Uint8Array).slice();
  const target = wardrobe.skin?.[label]?.body ?? receiver.tone, mine = own(label);
  const art = code => code === mine ? bodyArt(code, side) : reskin(bodyArt(code, side), target);
  const top = art(pick.top);
  for (let y = 0; y < side; y++) {
    pixels.set(top.pixels.subarray(y * half * 3, (y + 1) * half * 3), y * side * 3);
    mask.set(top.mask.subarray(y * half, (y + 1) * half), y * side);
  }
  if (pick.bottom !== pick.top) {
    const bottom = art(pick.bottom), mean = (from, row, y, i) => (from[2 * y * row + i] + from[(2 * y + 1) * row + i] + 1) >> 1;
    for (let y = 0; y < half; y++) {
      for (let i = 0; i < half * 3; i++) pixels[((half + y) * side + half) * 3 + i] = mean(bottom.pixels, half * 3, y, i);
      for (let i = 0; i < half; i++) mask[(half + y) * side + half + i] = mean(bottom.mask, half, y, i);
    }
  }
  return { side, tone: receiver.tone, pixels, mask };
}

function carried(values, like) {
  const out = new Float32Array(like.length * 3);
  for (let i = 0; i < like.length; i++) if (like[i] !== 65535) for (let d = 0; d < 3; d++) out[i * 3 + d] = values[like[i] * 3 + d];
  return out;
}

const made = new Map();

export function castOutfit(figure, label, style) {
  const pick = chosen(label, style);
  if (!pick) return figure;
  const id = label + "/" + pick.key;
  if (made.has(id) && made.get(id).from === figure) return made.get(id).figure;
  const packed = wardrobe.receivers[label].variants[pick.key], art = packed.surface, field = packed.field;
  const fitted = {
    positions: unpack(packed, "positions", Float32Array),
    surface: {
      source: unpack(art, "source", Uint16Array), index: unpack(art, "index", Uint16Array), smooth: unpack(art, "smooth", Uint16Array),
      uv: Float32Array.from(unpack(art, "uv", Uint16Array), v => v / 65535),
    },
    weights: shares(unpack(packed, "weights", Uint8Array), 4), joints: unpack(packed, "joints", Uint8Array),
    field: {
      starts: unpack(field, "starts", field.wide ? Uint32Array : Uint16Array), wide: field.wide,
      vertices: unpack(field, "vertices", Uint16Array), rest: unpack(field, "rest", Float32Array),
      near: unpack(field, "near", Uint16Array), pull: shares(unpack(field, "pull", Uint8Array), field.reach), reach: field.reach,
    },
    faceTriangles: packed.faceTriangles,
    poses: Object.fromEntries(Object.keys(packed.poses).map(name => [name, unpack(packed.poses, name, Float32Array)])),
    paint: painted(label, figure.paint, pick),
  };
  const starts = fitted.field.starts, raw = unpack(field, "weights", Uint16Array), weights = fitted.field.weights = new Float32Array(raw.length);
  for (let h = 0; h < starts.length - 1; h++) {
    let sum = 0;
    for (let p = starts[h]; p < starts[h + 1]; p++) sum += raw[p];
    for (let p = starts[h]; p < starts[h + 1]; p++) weights[p] = raw[p] / sum;
  }
  if (packed.cards) { fitted.cards = packed.cards; fitted.cardPaint = figure.cardPaint; }
  if (figure.blend) {
    const like = unpack(packed, "like", Uint16Array);
    fitted.blend = {
      donor: figure.blend.donor, pixelDelta: unpack(figure.blend, "pixelDelta", Uint8Array),
      shape: carried(unpack(figure.blend, "shape", Float32Array), like),
      poses: Object.fromEntries(Object.keys(fitted.poses).map(name => [name, carried(unpack(figure.blend.poses, name, Float32Array), like)])),
    };
  }
  made.set(id, { from: figure, figure: fitted });
  return fitted;
}
