import {frontRoot, paintWaveRoots} from "./human-waves-root.js";
import * as T from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import fieldAssets from "./human-field-outfits-data.json" with { type: "json" };
import { fieldClothes } from "./human-field-outfits.js";
import { scannedAssets, scannedClothes } from "./human-scanned-tops.js";
import systemAssets from "./human-library-data.json" with { type: "json" };
import { attireAssets, attireClothes, bareLegged, everydayClothes, wearSurface } from "./human-attire.js";
import { einarAssets, einarClothes } from "./human-einar-attire.js";
import { buildLibraryFabricMaps, hasLibraryFabricProfile } from "./human-cloth-library-surface.js";
import { authoredAssets, authoredHair, settleAuthored } from "./human-authored-hair.js";
import { nativeBob, nativeBobMaps, settleNativeBob } from "./human-native-bob.js";
import { humanRestPositions } from "./human-surface.js";
import { fitChestPanel } from "./human-cloth-fit.js";
import { hangLibraryCloth, sleeveBone } from "./human-library-drape.js";
import { combFringe, settleFringe, surfaceBody, surfaceFrame } from "./human-fringe.js";
import { smoothHairCards } from "./human-hair-cards.js";
import { buildLooseWaves } from "./human-waves-hair.js";
import { hairLockTips } from "./human-lock-tips.js";
import { textureHairRoots } from "./human-hairline.js";
import { hairRoots } from "./human-style-hair.js";
import { palette, toneFields } from "./human-style.js";

const assets = { ...systemAssets, ...attireAssets, ...authoredAssets, ...einarAssets, ...fieldAssets, ...scannedAssets };
for (const [groom, maps] of Object.entries(nativeBobMaps)) if (assets[groom]) assets[groom] = { ...assets[groom], ...maps };

// A style keeps its name when its groom is packed again: the first groom of a list that the library holds is
// worn, so a saved look resolves whether or not the newer packing is present.
const packed = (...grooms) => grooms.find((groom) => assets[groom]?.faceRefs) ?? grooms.at(-1);
export const additionalHair = {
  "Blunt bob": "bob02",
  "Low ponytail": packed("ponytail_low", "ponytail01"),
  "Long centre part": packed("long_centre", "long01"),
  "Side-swept pixie": packed("pixie_swept", "short03"),
  ...Object.fromEntries(Object.entries(authoredHair).filter(([, groom]) => assets[groom]?.faceRefs)),
};
export const libraryHair = {
  "Swept crop": "short04",
  "Rounded bob": "bob01",
  "Crown braid": "braid01",
  "Natural curls": "afro01",
  ...additionalHair,
};
export const libraryClothes = {
  "Field jacket and denim": ["male_casualsuit05", "shoes02"],
  "Workshop overalls": ["male_worksuit01", "shoes02"],
  "Tailored suit": ["male_elegantsuit01", "shoes01"],
  "Striped blouse and skirt": ["female_elegantsuit01", "shoes01"],
  "Overshirt and denim": ["male_casualsuit01", "shoes02"],
  "Striped shirt and jeans": ["male_casualsuit03", "shoes01"],
  "Track top and leggings": ["female_sportsuit01", "shoes05"],
  ...attireClothes,
  ...everydayClothes,
  ...einarClothes,
  ...fieldClothes,
  ...scannedClothes,
};
const decoded = new Map(),
  textures = new Map(),
  normalMaps = new Map(),
  occlusionMaps = new Map(),
  surfaceMaps = new Map();
export function loadHumanLibraryMaps() {
  if (typeof document === "undefined") return Promise.resolve();
  return Promise.all(
    Object.entries(assets).map(async ([key, record]) => {
      if (textures.has(key)) return;
      const loader = new T.TextureLoader();
      const [t, normal, ao, surface] = await Promise.all([record.texture, record.normal, record.occlusion, record.surface]
        .map(url => url ? loader.loadAsync(url) : null));
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 4;
      textures.set(key, t);
      if (normal) normalMaps.set(key, normal);
      if (ao) occlusionMaps.set(key, ao);
      if (surface) surfaceMaps.set(key, surface);
    }),
  );
}
/**
 * The strand picture of a library groom in one hair colour. The middle strand takes the colour as chosen and
 * the painted light and dark stay as shading. Hair also has a sheen that does not come from its pigment, so
 * the lightest strands of black hair still show as strands. Without a canvas there is no picture and the
 * caller tints the plain map by its material colour.
 */
const tinted = new Map();
export function tintedStrands(name, hex) {
  const source = textures.get(name);
  if (!source || typeof document === "undefined") return null;
  const key = name + hex;
  if (tinted.has(key)) return tinted.get(key);
  const canvas = document.createElement("canvas"), image = source.image;
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height), data = pixels.data;
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), srgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const colour = [1, 3, 5].map((at) => lin(parseInt(hex.slice(at, at + 2), 16) / 255)), middle = lin(188 / 255);
  const luma = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2], sheen = 0.012 + 0.05 * (1 - Math.min(1, luma * 3)) ** 2;
  const table = colour.map((c) => Uint8ClampedArray.from({ length: 256 }, (_, v) => {
    // Lit hair is a little darker than its pigment in the middle; light strands rise toward it and are held
    // below white, so pale hair keeps its strands.
    const t = lin(v / 255) / middle, glint = between(t, 0.95, 1.7), level = 0.72 * (t <= 1 ? t : 1 + (t - 1) * 0.5);
    return Math.round(255 * srgb(Math.min(1, c * level + sheen * glint * glint)));
  }));
  for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) data[i + k] = table[k][data[i + k]];
  context.putImageData(pixels, 0, 0);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  map.flipY = source.flipY;
  if (tinted.size >= 12) {
    const oldest = tinted.keys().next().value;
    tinted.get(oldest).dispose();
    tinted.delete(oldest);
  }
  tinted.set(key, map);
  return map;
}
const directed = (style) => Object.keys(toneFields).some((field) => style[field]);
function between(x, a, b) { return Math.min(1, Math.max(0, (x - a) / (b - a))); }
/**
 * How the cloth of each library garment takes dye. A rule picks texels of the scanned garment by hue (0 to 1),
 * saturation and lightness and names the tone of the outfit that dyes them; `level` is the lightness the tone
 * stands for, so folds and seams painted into the texture stay as shading. `pale` names a second tone for the
 * light threads of a stripe. Texels no rule picks are left as they are.
 */
const dyes = {
  male_elegantsuit01: [
    { pick: (h, s, l) => s > 0.2 && h > 0.5 && h < 0.8 && l > 0.008, tone: "accent", level: 0.03 },
    { pick: (h, s, l) => s < 0.2 && l > 0.42, tone: "light", level: 0.74 },
    { pick: (h, s, l) => s < 0.35 && l <= 0.42, tone: "main", level: 0.165 },
  ],
  female_elegantsuit01: [
    { pick: (h, s, l) => s > 0.13 && (h > 0.88 || h < 0.07) && l > 0.05, tone: "dark", level: 0.2, pale: "light", from: 0.32, to: 0.5 },
    { pick: (h, s, l) => s <= 0.13 && l > 0.04, tone: "main", level: 0.285 },
  ],
  male_casualsuit05: [
    { pick: (h, s, l) => s > 0.14 && h > 0.5 && h < 0.68 && l > 0.1, tone: "dark", level: 0.37 },
    { pick: (h, s, l) => s > 0.16 && (h > 0.88 || h < 0.07) && l > 0.05, tone: "accent", level: 0.2, pale: "light", from: 0.32, to: 0.5 },
    { pick: (h, s, l) => s <= 0.14 && l >= 0.36, tone: "dark", level: 0.5 },
    { pick: (h, s, l) => s <= 0.14 && l > 0.1, tone: "main", level: 0.25 },
  ],
  male_worksuit01: [
    { pick: (h, s, l) => s < 0.05 && l >= 0.975, tone: "light", level: 1 },
    { pick: (h, s, l) => l > 0.2, tone: "main", level: 0.6 },
  ],
  shoes01: [{ pick: (h, s, l) => s > 0.2 && h < 0.13 && l > 0.08, tone: "leather", level: 0.36 }],
  shoes02: [{ pick: (h, s, l) => s < 0.3 && l > 0.05, tone: "leather", level: 0.4 }],
};
const dyed = new Map();
function dyedMap(name, tones) {
  const source = textures.get(name), levels = assets[name].panelLevels;
  // The original top and jeans sometimes use the same indigo dye. Their sewn
  // UV panels distinguish the pieces even where the hues are identical.
  // A costume carries its own chart: each texel names the rule that dyes it, or none.
  const charted = assets[name].dye;
  const panels = levels || charted ? array(name, "panels", Uint8Array) : null;
  const rules = charted ?? (levels ? [
    { tone: "main", level: Math.max(.09, levels[0]) },
    { tone: "dark", level: Math.max(.09, levels[1]) },
    { tone: "accent", level: .48 },
  ] : dyes[name]);
  if (!source || !rules || typeof document === "undefined") return null;
  const key = name + rules.map((rule) => tones[rule.tone] + (rule.pale ? tones[rule.pale] : "")).join("");
  if (dyed.has(key)) return dyed.get(key);
  const canvas = document.createElement("canvas"),
    image = source.image;
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height),
    data = pixels.data;
  const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const colours = rules.map((rule) => [rgb(tones[rule.tone]), rule.pale ? rgb(tones[rule.pale]) : null]);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255,
      g = data[i + 1] / 255,
      b = data[i + 2] / 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      l = (max + min) / 2,
      d = max - min;
    const s = d < 1e-4 ? 0 : d / (l < 0.5 ? max + min : 2 - max - min);
    const h = d < 1e-4 ? 0 : (((max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4) + 6) % 6) / 6;
    let at;
    if (panels) {
      at = panels[i / 4] - 1;
      if (at === 0 && name === "female_sportsuit01" && s > .45 && h < .16) at = 2;
    } else at = rules.findIndex((rule) => rule.pick(h, s, l));
    if (at < 0) continue;
    const rule = rules[at],
      [dye, pale] = colours[at];
    // Shading painted into the scan is kept, a little flatter so a pale dye still shows its folds.
    const shade = Math.min(1.5, Math.max(0.36, (l / rule.level) ** 0.72)),
      light = pale ? between(l, rule.from, rule.to) : 0;
    for (let c = 0; c < 3; c++) {
      const base = Math.min(255, dye[c] * (light ? Math.min(shade, 1) : shade));
      const dyedTo = pale ? base + (pale[c] - base) * light : base;
      // Worn cloth keeps a share of its own stains, rust and fading under the dye.
      data[i + c] = rule.worn ? dyedTo + (data[i + c] - dyedTo) * rule.worn : dyedTo;
    }
  }
  context.putImageData(pixels, 0, 0);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  map.flipY = source.flipY;
  // A few dyes are kept so changing something else about the figure does not dye the cloth again.
  if (dyed.size >= 24) {
    const oldest = dyed.keys().next().value;
    dyed.get(oldest).dispose();
    dyed.delete(oldest);
  }
  dyed.set(key, map);
  return map;
}
function array(name, key, Type) {
  const id = name + "/" + key;
  if (!decoded.has(id)) {
    const raw = unzlibSync(
      Uint8Array.from(atob(assets[name][key]), (c) => c.charCodeAt(0)),
    );
    decoded.set(
      id,
      new Type(
        raw.buffer,
        raw.byteOffset,
        raw.byteLength / Type.BYTES_PER_ELEMENT,
      ),
    );
  }
  return decoded.get(id);
}
function fittedProxy(s, name, idMap) {
  const refs = array(name, "refs", Uint16Array),
    weights = array(name, "weights", Float32Array),
    offsets = array(name, "offsets", Float32Array);
  const p = new Float32Array(refs.length),
    bones = new Uint8Array((refs.length / 3) * 4),
    skin = new Float32Array(bones.length);
  const panel = Object.values(libraryClothes).some(
    ([garment]) => garment === name,
  )
    ? new Float32Array(refs.length)
    : null;
  // Authored hair is held in its combed shape where it stands off the head (see settleAuthored).
  const held = assets[name].credit && assets[name].faceRefs
    ? { anchor: new Float32Array(refs.length), anchorRest: new Float32Array(refs.length), onSkull: new Uint8Array(refs.length / 3) }
    : null;
  const rest = humanRestPositions(),
    a = new T.Vector3(),
    b = new T.Vector3(),
    n = new T.Vector3(),
    orig = new T.Vector3(),
    delta = new T.Vector3();
  function frame(arr, idx) {
    orig.fromArray(arr, idx[0] * 3);
    a.fromArray(arr, idx[1] * 3)
      .sub(orig)
      .normalize();
    b.fromArray(arr, idx[2] * 3).sub(orig);
    n.crossVectors(a, b).normalize();
    b.crossVectors(n, a);
    return n.lengthSq() > 0.5;
  }
  for (let i = 0; i < p.length / 3; i++) {
    const base = i * 3,
      ix = [
        idMap.get(refs[base]),
        idMap.get(refs[base + 1]),
        idMap.get(refs[base + 2]),
      ];
    if (ix.some((v) => v === undefined))
      throw new Error("Missing source vertex in " + name);
    const influence = new Map();
    for (let j = 0; j < 3; j++) {
      const w = weights[base + j],
        v = ix[j];
      for (let d = 0; d < 3; d++) {
        p[base + d] += s.positions[v * 3 + d] * w;
        if (panel) panel[base + d] += rest[v * 3 + d] * w;
        if (held) held.anchorRest[base + d] += rest[v * 3 + d] * w;
      }
      for (let k = v * 4; k < v * 4 + 4; k++)
        if (s.weights[k]) {
          const bone = s.boneIndices[k];
          influence.set(
            bone,
            (influence.get(bone) ?? 0) + Math.max(0, w) * s.weights[k],
          );
        }
    }
    if (panel) for (let d = 0; d < 3; d++) panel[base + d] += offsets[base + d];
    if (held) {
      held.anchor.set(p.subarray(base, base + 3), base);
      let skull = 0, all = 0;
      for (const [bone, w] of influence) { all += w; if (s.names[bone].startsWith("head")) skull += w; }
      held.onSkull[i] = skull > .5 * all ? 1 : 0;
    }
    delta.fromArray(offsets, base);
    if (delta.lengthSq() > 0.000000001 && frame(rest, ix)) {
      const x = delta.dot(a),
        y = delta.dot(b),
        z = delta.dot(n);
      if (frame(s.positions, ix))
        delta
          .copy(a)
          .multiplyScalar(x)
          .addScaledVector(b, y)
          .addScaledVector(n, z);
    }
    delta.multiplyScalar(s.height / 1.72);
    p[base] += delta.x;
    p[base + 1] += delta.y;
    p[base + 2] += delta.z;
    const top = [...influence.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const sum = top.reduce((v, p) => v + p[1], 0);
    top.forEach(([id, w], k) => {
      bones[i * 4 + k] = id;
      skin[i * 4 + k] = w / sum;
    });
  }
  if (panel) {
    fitChestPanel(name, s, panel, p);
    // A fitted shirt interpolates between skin anchors. It can cut across the
    // curved neck-to-shoulder ridge when the adult gains upper-back tissue.
    const body = surfaceBody(s), shoulder = body.joint("upperarm_l"), neck = body.joint("neck_01"), k = body.scale;
    for (let j = 0; j < p.length; j += 3) {
      const dy = p[j+1] - shoulder[1];
      if (dy < -.039*k || p[j+1] > neck[1] + .09*k || Math.abs(p[j]) > Math.abs(shoulder[0]) + .035*k) continue;
      const point = [p[j], p[j+1], p[j+2]];
      const clear = body.clear(point, .009*k);
      p.set(clear, j);
    }
  }
  if (held && nativeBob(name)) settleNativeBob(name, p, held.onSkull, array(name, "corners", Uint16Array), surfaceFrame(s), surfaceBody(s));
  else if (held) settleAuthored(p, held.anchor, held.anchorRest, offsets, held.onSkull);
  return { p, bones, skin };
}
// Hair for the game export: the fitted cards themselves, cut to their outline by the map as
// they were authored. Trimmed cards are separate slivers that a simplifier pulls apart; whole
// cards share their vertices and thin evenly. Triangles the map leaves empty are left out;
// without a map to cut them, `cover` is the least share of a triangle that must be hair.
function gameCards(s, name, p, style, cover = 0) {
  const corners = array(name, "corners", Uint16Array),
    texCorners = array(name, "uvCorners", Uint16Array),
    uv = array(name, "uv", Uint16Array),
    refs = array(name, "faceRefs", Uint16Array),
    blend = array(name, "faceWeights", Uint16Array),
    faces = array(name, "faceIndices", Uint32Array);
  const triple = (a, b, c) => (a * 65536 + b) * 65536 + c,
    covered = new Map();
  // Each trimmed sliver lies inside one card triangle and knows how much of it it fills.
  for (let f = 0; f < faces.length; f += 3) {
    const i = faces[f] * 3,
      j = faces[f + 1] * 3,
      k = faces[f + 2] * 3,
      key = triple(refs[i], refs[i + 1], refs[i + 2]);
    const share =
      Math.abs((blend[j] - blend[i]) * (blend[k + 1] - blend[i + 1]) - (blend[k] - blend[i]) * (blend[j + 1] - blend[i + 1])) / 65535 ** 2;
    covered.set(key, (covered.get(key) ?? 0) + share);
  }
  const drawn = new Set();
  for (const [key, share] of covered) if (share >= cover) drawn.add(key);
  const cards = new T.BufferGeometry();
  cards.setAttribute("position", new T.BufferAttribute(p, 3));
  cards.setIndex(new T.BufferAttribute(corners, 1));
  cards.computeVertexNormals();
  const smooth = cards.attributes.normal.array,
    settled = p.slice();
  cards.dispose();
  if (style.fringe) settleFringe(settled, surfaceFrame(s), style.fringe);
  const pos = [],
    norm = [],
    tex = [],
    indices = [],
    seen = new Map();
  for (let c = 0; c < corners.length; c += 3) {
    if (!drawn.has(triple(corners[c], corners[c + 1], corners[c + 2]))) continue;
    for (let d = c; d < c + 3; d++) {
      const v = corners[d],
        t = texCorners[d],
        key = v * 65536 + t;
      if (!seen.has(key)) {
        seen.set(key, pos.length / 3);
        pos.push(settled[v * 3], settled[v * 3 + 1], settled[v * 3 + 2]);
        norm.push(smooth[v * 3], smooth[v * 3 + 1], smooth[v * 3 + 2]);
        tex.push(uv[t * 2] / 65535, uv[t * 2 + 1] / 65535);
      }
      indices.push(seen.get(key));
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(norm, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(tex, 2));
  g.setIndex(indices);
  return g;
}
// Join the slivers of trimmed cards where they meet, so a plain game export can thin them too.
function joinTrimmed(g) {
  const { position, normal, uv } = g.attributes,
    seen = new Map(),
    keep = [],
    index = Array.from(g.index.array, (i) => {
      const key =
        Math.round(position.getX(i) * 20000) + "," +
        Math.round(position.getY(i) * 20000) + "," +
        Math.round(position.getZ(i) * 20000) + "," +
        Math.round(uv.getX(i) * 2000) + "," +
        Math.round(uv.getY(i) * 2000);
      if (!seen.has(key)) {
        seen.set(key, keep.length);
        keep.push(i);
      }
      return seen.get(key);
    });
  const out = new T.BufferGeometry();
  for (const [name, a] of [["position", position], ["normal", normal], ["uv", uv]]) {
    const data = new Float32Array(keep.length * a.itemSize);
    keep.forEach((i, k) => data.set(a.array.subarray(i * a.itemSize, (i + 1) * a.itemSize), k * a.itemSize));
    out.setAttribute(name, new T.BufferAttribute(data, a.itemSize));
  }
  // Slivers that close up to nothing would only confuse the simplifier.
  out.setIndex(index.filter((_, k) => {
    const t = k - (k % 3);
    return index[t] !== index[t + 1] && index[t + 1] !== index[t + 2] && index[t] !== index[t + 2];
  }));
  g.dispose();
  return out;
}
// These three system shoes have separate stockings after the left/right shoe
// shells in the source OBJ. A full trouser cuff covers an ankle sock.
const stockingStart = { shoes01: 1434, shoes02: 1306, shoes05: 1306 };
function tuckSocks(positions, surface, start) {
  const joint = (name) => new T.Vector3().fromArray(surface.joints, 3*surface.names.indexOf(name));
  const legs = ["r", "l"].map(side => {
    const ankle = joint("foot_"+side), knee = joint("calf_"+side);
    return { ankle, axis: knee.sub(ankle).normalize() };
  });
  const delta = new T.Vector3(), offset = new T.Vector3(), k = surface.height/1.72;
  for (let i=start*3; i<positions.length; i+=3) {
    const {ankle,axis} = legs[positions[i] > 0 ? 1 : 0];
    delta.fromArray(positions,i).sub(ankle);
    const along = delta.dot(axis), rise = Math.max(0, along-.009*k);
    if (!rise) continue;
    offset.copy(delta).addScaledVector(axis,-along);
    const tuck = T.MathUtils.smoothstep(rise,0,.036*k);
    offset.multiplyScalar(1-.30*tuck).addScaledVector(axis,along-.82*rise).add(ankle).toArray(positions,i);
  }
}
function garment(s, name, idMap, material, plain, style, game) {
  const hair = Boolean(assets[name].faceRefs),
    authored = hair && Boolean(assets[name].credit),
    { p, bones, skin } = fittedProxy(s, name, idMap);
  // A dress or a robe hangs below the waist instead of following each leg.
  const joints = hair ? null : hangLibraryCloth(s, name, p, bones, skin);
  // Preserve tied and cropped silhouettes. Loose authored fringes still follow
  // the wearer's comb setting, including on glasses and under a hat.
  if (authored && !["Side-swept pixie", "Fringed bob", "Long centre part", "Loose waves"].includes(style.hair))
    style = { ...style, fringe: undefined };
  if (Object.hasOwn(stockingStart, name) && style.outfit !== "Striped blouse and skirt" && !bareLegged.has(style.outfit))
    tuckSocks(p, s, stockingStart[name]);
  // The fringe is combed on the fitted cards, before they are trimmed to their outline.
  if (hair && style.fringe) combFringe(p, surfaceFrame(s), style.fringe);
  const color = hair ? (style.hairColor ?? "#51433b") : "#ffffff";
  const m = material(color).clone();
  if (!plain) {
    // A style that names its tones dyes the cloth itself. One with only a cloth colour keeps the light tint it had.
    const dye = !hair && directed(style) ? dyedMap(name, palette(style)) : null;
    const strands = authored ? tintedStrands(name, color) : null;
    if (strands) m.color.set("#ffffff");
    m.map = dye ?? strands ?? textures.get(name) ?? null;
    if (normalMaps.has(name)) {
      m.normalMap = normalMaps.get(name);
      m.normalScale.setScalar(.82);
    }
    if (occlusionMaps.has(name)) {
      m.aoMap = occlusionMaps.get(name);
      m.aoMapIntensity = .72;
    }
    if (surfaceMaps.has(name)) {
      wearSurface(m, surfaceMaps.get(name));
    } else if (!hair && hasLibraryFabricProfile(name)) {
      const panels = assets[name].panelLevels || assets[name].dye ? array(name, "panels", Uint8Array) : null;
      const fab = buildLibraryFabricMaps(
        name,
        textures.get(name),
        normalMaps.get(name),
        occlusionMaps.get(name),
        panels,
        dyes[name],
      );
      if (fab) {
        wearSurface(m, fab.surface);
        m.normalMap = fab.normal;
        m.normalScale.setScalar(1.0);
      }
    }
    if (!hair && !dye && style.clothColor)
      m.color.lerp(new T.Color(style.clothColor), 0.32);
  }
  m.side = T.DoubleSide;
  if (hair) {
    // The game exporter gives tagged hair its own share of triangles and keeps its cards whole.
    // Some callers measure hair with bare stand-in materials that carry no user data.
    (m.userData ??= {}).hairCards = true;
    // Authored layers are painted thin where they overlap; cut at the usual opacity they open holes to the roots.
    const cutoff = authored ? 0.2 : 0.34;
    // A plain export has no map, so it keeps the trimmed outline. Where trimming cuts each card
    // triangle into many slivers no game budget can hold them, and the half-covered cards stand in.
    const fine = array(name, "faceIndices", Uint32Array).length > 8 * array(name, "corners", Uint16Array).length;
    const rounded = !plain && assets[name].smoothCards;
    if (name === "cloud_waves") {
      if (!plain) {
        m.alphaTest = cutoff;
        m.alphaToCoverage = true;
        m.roughness = 0.78;
        m.vertexColors = true;
      }
      const geometry = buildLooseWaves(
        s,
        p,
        array(name, "corners", Uint16Array),
        array(name, "uvCorners", Uint16Array),
        array(name, "uv", Uint16Array),
        style,
        plain,
      );
      const mesh = new T.Mesh(geometry, m);
      mesh.name = style.hair;
      mesh.userData.styleRegion = "head";
      mesh.userData.libraryHair = name;
      mesh.castShadow = true;
      return [mesh];
    }
    if (rounded || (game && (!plain || fine))) {
      if (!plain) {
        m.alphaTest = cutoff;
        m.alphaToCoverage = true;
        m.roughness = 0.78;
      }
      let geometry;
      if (rounded) {
        if (style.fringe) settleFringe(p, surfaceFrame(s), style.fringe);
        geometry = smoothHairCards(p, array(name,"corners",Uint16Array), array(name,"uvCorners",Uint16Array), array(name,"uv",Uint16Array));
      } else geometry = gameCards(s, name, p, style, plain ? 0.5 : 0);
      const mesh = new T.Mesh(geometry, m);
      mesh.name = style.hair;
      mesh.userData.styleRegion = "head";
      mesh.userData.libraryHair = name;
      mesh.castShadow = true;
      return [mesh];
    }
    const refs = array(name, "faceRefs", Uint16Array),
      blend = array(name, "faceWeights", Uint16Array),
      p2 = new Float32Array(refs.length);
    for (let i = 0; i < p2.length / 3; i++)
      for (let k = 0; k < 3; k++) {
        const id = refs[i * 3 + k],
          f = blend[i * 3 + k] / 65535;
        for (let d = 0; d < 3; d++) p2[i * 3 + d] += p[id * 3 + d] * f;
      }
    if (style.fringe) settleFringe(p2, surfaceFrame(s), style.fringe);
    // Clipping a hair card splits its triangles. Interpolate the original smooth
    // normals across those cuts so each little triangle does not catch a different light.
    const cards = new T.BufferGeometry();
    cards.setAttribute("position", new T.BufferAttribute(p, 3));
    cards.setIndex(
      new T.BufferAttribute(array(name, "corners", Uint16Array), 1),
    );
    cards.computeVertexNormals();
    const baseNormals = cards.attributes.normal,
      normals = new Float32Array(p2.length);
    const v = new T.Vector3(),
      sum = new T.Vector3();
    for (let i = 0; i < p2.length / 3; i++) {
      sum.set(0, 0, 0);
      for (let k = 0; k < 3; k++)
        sum.addScaledVector(
          v.fromBufferAttribute(baseNormals, refs[i * 3 + k]),
          blend[i * 3 + k] / 65535,
        );
      sum.normalize().toArray(normals, i * 3);
    }
    cards.dispose();
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(p2, 3));
    g.setAttribute("normal", new T.BufferAttribute(normals, 3));
    if (!plain) {
      m.alphaTest = cutoff;
      m.alphaToCoverage = true;
      m.roughness = 0.78;
    }
    g.setAttribute(
      "uv",
      new T.Float32BufferAttribute(
        Float32Array.from(array(name, "faceUV", Uint16Array), (u) => u / 65535),
        2,
      ),
    );
    g.setIndex(
      new T.BufferAttribute(array(name, "faceIndices", Uint32Array), 1),
    );
    const mesh = new T.Mesh(game ? joinTrimmed(g) : g, m);
    mesh.name = style.hair;
    mesh.userData.styleRegion = "head";
    mesh.userData.libraryHair = name;
    mesh.castShadow = true;
    return [mesh];
  }
  const corners = array(name, "corners", Uint16Array),
    texCorners = array(name, "uvCorners", Uint16Array),
    uv = array(name, "uv", Uint16Array);
  const whole = new T.BufferGeometry();
  whole.setAttribute("position", new T.BufferAttribute(p, 3));
  whole.setIndex(new T.BufferAttribute(corners, 1));
  whole.computeVertexNormals();
  const bins = new Map();
  for (let c = 0; c < corners.length; c += 3) {
    const votes = new Map();
    for (let d = c; d < c + 3; d++)
      for (let j = corners[d] * 4; j < corners[d] * 4 + 4; j++)
        votes.set(bones[j], (votes.get(bones[j]) ?? 0) + skin[j]);
    let best = -1,
      owner = 0;
    for (const [bone, value] of votes)
      if (value > best) {
        best = value;
        owner = bone;
      }
    if (!bins.has(owner)) bins.set(owner, []);
    bins.get(owner).push(c, c + 1, c + 2);
  }
  const out = [];
  for (const [owner, bin] of bins) {
    const pos = [],
      norm = [],
      tex = [],
      indices = [],
      bi = [],
      sw = [],
      seen = new Map();
    for (const c of bin) {
      const v = corners[c],
        t = texCorners[c],
        key = v * 65536 + t;
      if (!seen.has(key)) {
        seen.set(key, pos.length / 3);
        pos.push(...p.subarray(v * 3, v * 3 + 3));
        norm.push(...whole.attributes.normal.array.subarray(v * 3, v * 3 + 3));
        tex.push(uv[t * 2] / 65535, uv[t * 2 + 1] / 65535);
        bi.push(...bones.subarray(v * 4, v * 4 + 4));
        sw.push(...skin.subarray(v * 4, v * 4 + 4));
      }
      indices.push(seen.get(key));
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(norm, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(tex, 2));
    g.setIndex(indices);
    const mesh = new T.Mesh(g, m);
    mesh.castShadow = true;
    mesh.humanWeights = { boneIndices: bi, weights: sw };
    // The skirt, not the sleeves beside it, may hang from joints of its own.
    if (joints && !sleeveBone(s.names[owner])) mesh.humanWeights.clothJoints = joints;
    mesh.userData.styleRegion = s.names[owner];
    out.push(mesh);
  }
  whole.dispose();
  return out;
}
export function libraryPieces(s, style, material, plain, game = false, skin = "#bd9679") {
  const out = [],
    hidden = new Set(),
    ids = new Map(Array.from(s.ids, (v, i) => [v, i]));
  for (const key of [
    ...(libraryClothes[style.outfit] ?? []),
    libraryHair[style.hair],
  ].filter(Boolean)) {
    const pieces = garment(s, key, ids, material, plain, style, game);
    out.push(...pieces);
    if (!plain && ["pixie_swept", "ponytail_low", "bun_tied"].includes(key)) {
      const tips = hairLockTips(pieces[0], surfaceFrame(s), style.hairColor ?? "#51433b", style.hair);
      if (tips) out.push(tips);
    }
    for (const v of array(key, "hide", Uint16Array)) hidden.add(v);
  }
  if (libraryHair[style.hair]) {
    // Roots in a darker tone of the hair, about as dark as the shaded cards above them.
    const groom = libraryHair[style.hair], authored = Boolean(assets[groom].rootIds);
    const tone = "#" + new T.Color(style.hairColor ?? "#51433b").multiplyScalar(authored && !plain ? .86 : authored ? .5 : .6).getHexString();
    let within = null;
    if (authored) {
      // An authored groom records the scalp its cards cover, so its roots end at its own hairline.
      const rootIds = array(groom, "rootIds", Uint16Array), rootField = array(groom, "rootField", Int8Array),
        field = new Float32Array(s.positions.length / 3).fill(-1);
      rootIds.forEach((id, k) => { const v = ids.get(id); if (v !== undefined) field[v] = rootField[k] / 100; });
      // Let the painted root hairs emerge a little beyond the thickest locks.
      const fringe = !plain && ["short_layered", "short_receding", "bun_tied"].includes(groom) ? 0.38 : 0;
      within = (i) => (field[i] + fringe) * .3;
    }
    if (groom === "cloud_waves") {
      const f=surfaceFrame(s),body=surfaceBody(s),prior=within;
      within=i=>{
        const {phi,eps}=f.aim(body.point(i));
        return Math.abs(phi)<1.48?eps-frontRoot(phi)+.105:(prior?prior(i):1);
      };
    }
    const bed = hairRoots(surfaceBody(s), within);
    const roots = bed.mesh(material(tone, "hair"), "head", "Hair roots");
    if (!plain && groom === "cloud_waves") paintWaveRoots(roots,bed.shells[0],surfaceFrame(s),skin,style.hairColor ?? "#51433b");
    else if (!plain && authored) textureHairRoots(roots, bed.shells[0], surfaceFrame(s));
    roots.userData.hairRoots = true;
    out.push(roots);
  }
  return Object.assign(out, { hidden });
}
