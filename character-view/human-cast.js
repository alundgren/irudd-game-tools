import * as T from "three";
import { irisBaseTone } from "./human-eyes.js";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import figures from "./human-cast-data.json" with { type: "json" };
import { applyCastSurface } from "./human-cast-surface.js";
import { castOutfit } from "./human-cast-wardrobe.js";
import catalog from "./human-cast-catalog.json" with { type: "json" };
import { castCardIndex, castCardPixels } from "./human-cast-hair.js";
import { castSkirtJoints } from "./human-cast-skirt.js";
import { castLidTexels, paintCastLids } from "./human-cast-lids.js";

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

function spread(values, source, size) {
  const out = new values.constructor(source.length * size);
  for (let i = 0; i < source.length; i++)
    for (let j = 0; j < size; j++) out[i * size + j] = values[source[i] * size + j];
  return out;
}

function shapeFigure(figure, surface) {
  const field = figure.field;
  const starts = unpack(field, "starts", field.wide ? Uint32Array : Uint16Array);
  const vertices = unpack(field, "vertices", Uint16Array), weights = unpack(field, "weights", Float32Array);
  const delta = Float32Array.from(unpack(field, "rest", Float32Array), value => -value);
  for (let h = 0; h < starts.length - 1; h++) {
    for (let p = starts[h]; p < starts[h + 1]; p++)
      for (let d = 0; d < 3; d++) delta[h * 3 + d] += weights[p] * surface.positions[vertices[p] * 3 + d];
  }
  const near = unpack(field, "near", Uint16Array), pull = unpack(field, "pull", Float32Array);
  const rest = unpack(figure, "positions", Float32Array), moved = rest.slice();
  for (let i = 0; i < rest.length / 3; i++) {
    for (let j = 0; j < field.reach; j++) {
      const p = i * field.reach + j;
      for (let d = 0; d < 3; d++) moved[i * 3 + d] += pull[p] * delta[near[p] * 3 + d];
    }
  }
  return { rest, moved };
}

function attribute(geometry, name, values, size) {
  geometry.setAttribute(name, new T.BufferAttribute(values, size));
}

function morph(values, name) {
  const result = new T.BufferAttribute(values, 3);
  result.name = name;
  return result;
}

function smoothNormals(positions, index) {
  const geometry = new T.BufferGeometry();
  attribute(geometry, "position", positions, 3);
  geometry.setIndex(new T.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  return geometry.attributes.normal.array;
}

function picture(bytes, side) {
  let map;
  if (typeof document === "undefined" || typeof ImageData === "undefined") {
    map = new T.DataTexture(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), side, side);
    map.flipY = true;
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = side;
    canvas.getContext("2d").putImageData(new ImageData(bytes, side, side), 0, 0);
    map = new T.CanvasTexture(canvas);
  }
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

function paintedSkin(paint, colour, blend, pigment, eyeColour, lids) {
  const rgb = unpack(paint, "pixels", Uint8Array), mask = unpack(paint, "mask", Uint8Array).slice();
  const rgba = new Uint8ClampedArray(mask.length * 4);
  const delta = blend && pigment ? unpack(blend, "pixelDelta", Uint8Array) : null;
  const half = paint.side / 2;
  const lut = new T.Color(colour).toArray().map((value, channel) => {
    const gain = T.MathUtils.clamp(value / paint.tone[channel], .02, 6);
    return Uint8Array.from({ length: 256 }, (_, i) => {
      const srgb = i / 255;
      const linear = srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4;
      const tinted = Math.min(1, linear * gain);
      return Math.round(255 * (tinted <= .0031308 ? 12.92 * tinted : 1.055 * tinted ** (1 / 2.4) - .055));
    });
  });
  for (let i = 0; i < mask.length; i++) {
    for (let k = 0; k < 3; k++) {
      let orig = rgb[i * 3 + k];
      const x = i % paint.side;
      if (delta && x >= half && i < paint.side * half) {
        const p = (Math.floor(i / paint.side) * half + x - half) * 3 + k;
        const donor = (orig + delta[p]) & 255;
        orig = Math.round(orig + (donor - orig) * pigment);
      }
      rgba[i * 4 + k] = orig;
    }
    rgba[i * 4 + 3] = 255;
  }
  if (lids) paintCastLids(rgba, mask, paint.side, lids, paint.tone);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    for (let k = 0; k < 3; k++) {
      const orig = rgba[i * 4 + k];
      rgba[i * 4 + k] = orig + mask[i] / 255 * (lut[k][orig] - orig);
    }
  }
  const target = irisBaseTone(eyeColour);
  if (target) {
    const cx = .263 * half, cy = .929 * half, rx = .020 * half, ry = .019 * half;
    for (let y = Math.floor(cy-ry); y <= Math.ceil(cy+ry); y++)
      for (let x = Math.floor(cx-rx); x <= Math.ceil(cx+rx); x++) {
        const radius = Math.hypot((x-cx)/rx, (y-cy)/ry);
        const i = y * paint.side + x + half;
        const light = .23 * rgb[3*i] + .62 * rgb[3*i+1] + .15 * rgb[3*i+2];
        const fade = T.MathUtils.smoothstep(radius,.27,.45) * (1-T.MathUtils.smoothstep(radius,.79,1)) *
          T.MathUtils.smoothstep(light,20,60) * (1-T.MathUtils.smoothstep(light,178,228));
        for (let k=0; k<3; k++)
          rgba[4*i+k] += fade * (target[k] * light / 112 - rgba[4*i+k]);
      }
  }
  return picture(rgba, paint.side);
}

function hairCards(figure, moved, rest, surface, origin, material, plain) {
  const cards = figure.cards, originalPoints = unpack(cards, "points", Float32Array);
  const points = originalPoints.slice();
  const ties = unpack(cards, "ties", Uint16Array), shares = unpack(cards, "shares", Float32Array);
  for (let i = 0; i < points.length; i++) {
    const d = i % 3, vertex = i - d;
    points[i] -= origin[d];
    for (let k = vertex; k < vertex + 3; k++)
      points[i] += shares[k] * (moved[ties[k] * 3 + d] - rest[ties[k] * 3 + d]);
  }
  const geometry = new T.BufferGeometry();
  attribute(geometry, "position", points, 3);
  attribute(geometry, "uv", unpack(cards, "uv", Float32Array).slice(), 2);
  geometry.setIndex(new T.BufferAttribute(castCardIndex(originalPoints, unpack(cards, "index", Uint16Array)), 1));
  geometry.computeVertexNormals();
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = Object.keys(cards.expressions).map(name => morph(unpack(cards.expressions, name, Float32Array).slice(), name));
  const mat = material("#ffffff").clone();
  mat.side = T.DoubleSide;
  if (!plain) {
    mat.map = picture(castCardPixels(unpack(figure.cardPaint, "pixels", Uint8Array), figure.cardPaint.side), figure.cardPaint.side);
    mat.userData.ownedColorMap = true;
    mat.userData.castHairSheet = true;
    mat.alphaTest = .5;
    mat.roughness = .6;
    mat.metalness = 0;
  }
  const mesh = new T.Mesh(geometry, mat), count = points.length / 3;
  const boneIndices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { boneIndices[i * 4] = surface.names.indexOf("head"); weights[i * 4] = 1; }
  mesh.humanWeights = { boneIndices, weights, names: surface.names };
  mesh.name = "Cast hair and lashes";
  return mesh;
}

function leavesHairQuarterFree(uv, indices) {
  for (let cursor = 0; cursor < indices.length; cursor += 3) {
    const a = 2 * indices[cursor], b = 2 * indices[cursor + 1], c = 2 * indices[cursor + 2];
    const right = Math.max(uv[a], uv[b], uv[c]);
    const bottom = Math.min(uv[a + 1], uv[b + 1], uv[c + 1]);
    if (right > 0.5 && bottom < 0.5) return false;
  }
  return true;
}

export function castMeshes(label, surface, origin, material, plain, colour, style = {}, eyeColour) {
  const figure = castOutfit(figures[label], label, style), art = figure.surface;
  const source = unpack(art, "source", Uint16Array), index = unpack(art, "index", Uint16Array);
  const smooth = unpack(art, "smooth", Uint16Array), { moved, rest } = shapeFigure(figure, surface);
  const shape = figure.blend && style.castShape;
  if (shape) {
    const delta = unpack(figure.blend, "shape", Float32Array);
    for (let i = 0; i < moved.length; i++) moved[i] += shape * delta[i];
  }
  const normals = smoothNormals(moved, smooth), position = spread(moved, source, 3);
  for (let i = 0; i < position.length; i++) position[i] -= origin[i % 3];
  const geometry = new T.BufferGeometry();
  attribute(geometry, "position", position, 3);
  attribute(geometry, "normal", spread(normals, source, 3), 3);
  attribute(geometry, "uv", unpack(art, "uv", Float32Array).slice(), 2);
  const mat = material(colour).clone();
  mat.side = T.DoubleSide;
  if (!plain) {
    mat.color.set(0xffffff);
    mat.userData.castBodySheet = Boolean(figure.cards) && leavesHairQuarterFree(geometry.attributes.uv.array, index);
    const lids = castLidTexels({ uv: geometry.attributes.uv.array, index, faceTriangles: figure.faceTriangles, source,
      blink: unpack(figure.poses, "Blink", Float32Array), side: figure.paint.side });
    mat.map = paintedSkin(figure.paint, colour, figure.blend, style.castPigment, eyeColour, lids);
    mat.userData.ownedColorMap = true;
    mat.metalness = 0;
    applyCastSurface(mat, label, style, picture);
    mat.userData.ownedSurfaceMaps = true;
  }
  const faceEnd = figure.faceTriangles * 3;
  const jointLookup = catalog.bones.map(name => surface.names.indexOf(name));
  const humanWeights = {
    boneIndices: Uint16Array.from(spread(unpack(figure, "joints", Uint8Array), source, 4), j => jointLookup[j]),
    weights: spread(unpack(figure, "weights", Float32Array), source, 4), names: surface.names,
  };
  function part(name, indices) {
    const g = new T.BufferGeometry();
    for (const [key, attr] of Object.entries(geometry.attributes)) g.setAttribute(key, attr);
    g.setIndex(new T.BufferAttribute(Uint16Array.from(indices), 1));
    const mesh = new T.Mesh(g, mat);
    mesh.humanWeights = humanWeights;
    mesh.name = name;
    mesh.castShadow = true;
    return mesh;
  }
  const face = part("Cast face", index.subarray(0, faceEnd));
  face.userData.faceSurface = face.userData.fittedEyes = true;
  face.geometry.morphTargetsRelative = true;
  const names = Object.keys(figure.poses);
  const shifts = names.map(name => {
    const authored = unpack(figure.poses, name, Float32Array);
    if (!shape) return authored;
    const correction = unpack(figure.blend.poses, name, Float32Array);
    return Float32Array.from(authored, (value, i) => value + shape * correction[i]);
  });
  face.geometry.morphAttributes.position = shifts.map((shift,i) => morph(spread(shift, source, 3), names[i]));
  face.geometry.morphAttributes.normal = shifts.map((shift,i) => {
    const posed = smoothNormals(Float32Array.from(moved, (x, i) => x + shift[i]), smooth);
    for (let i = 0; i < posed.length; i++) posed[i] -= normals[i];
    return morph(spread(posed, source, 3), names[i]);
  });
  face.updateMorphTargets();
  const meshes = [face];
  if (figure.skirt) {
    const mask = new Uint8Array(rest.length / 3);
    for (const i of unpack(figure, "skirt", Uint16Array)) mask[i] = 1;
    const cloth = [], body = [];
    for (let i = faceEnd; i < index.length; i += 3) {
      const [a,b,c] = index.subarray(i,i+3);
      (mask[source[a]] || mask[source[b]] || mask[source[c]] ? cloth : body).push(a,b,c);
    }
    const skirt = part("Cast tunic hem", cloth);
    skirt.humanWeights = { ...humanWeights, clothJoints: castSkirtJoints(surface, moved, mask, origin) };
    meshes.push(part("Cast body and clothing", body), skirt);
  } else meshes.push(part("Cast body and clothing", index.subarray(faceEnd)));
  if (figure.cards) meshes.push(hairCards(figure, moved, rest, surface, origin, material, plain));
  return meshes;
}
