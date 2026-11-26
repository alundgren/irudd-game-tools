import { bakeFaceOcclusion, transferFaceNormals } from "./game-face-relief.js";
import { whiteVertexColors } from "./markings.js";
import { measureTileScale, packSurfaceChannels, heightNormals, packNormals } from "./game-surface.js";
import { bakeContact, contactRampRows, drawContactRamp } from "./game-contact.js";
import * as T from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshoptSimplifier } from "three/addons/libs/meshopt_simplifier.module.js";

export const gameTriangleTarget = 24000;
const restShare = 0.085,
  restLimit = 0.45,
  keptFloor = 0.3;
function batches(mesh) {
  const g = mesh.geometry,
    materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.length === 1)
    return [
      {
        start: 0,
        count: g.index?.count ?? g.attributes.position.count,
        material: materials[0],
      },
    ];
  return g.groups.map((b) => ({ ...b, material: materials[b.materialIndex] }));
}
function simplifyInputs(g) {
  const p = g.attributes.position,
    n = g.attributes.normal,
    u = g.attributes.uv,
    w = g.attributes.skinWeight,
    bones = g.attributes.skinIndex;
  const color = g.attributes.color,
    colorOffset = w ? 12 : 5;
  const stride = colorOffset + (color ? 3 : 0),
    attr = new Float32Array(stride * p.count);
  for (let i = 0; i < p.count; i++) {
    const out = i * stride;
    attr[out] = n.getX(i);
    attr[out + 1] = n.getY(i);
    attr[out + 2] = n.getZ(i);
    attr[out + 3] = u.getX(i);
    attr[out + 4] = u.getY(i);
    if (color) {
      attr[out + colorOffset] = color.getX(i);
      attr[out + colorOffset + 1] = color.getY(i);
      attr[out + colorOffset + 2] = color.getZ(i);
    }
    if (!w) continue;
    for (let j = 0; j < 4; j++) {
      const influence = w.array[4 * i + j],
        bone = bones.array[4 * i + j];
      attr[out + 5 + j] = influence;
      if (!influence) continue;
      attr[out + 9] += influence * Math.sin(2.13 * bone);
      attr[out + 10] += influence * Math.cos(1.81 * bone);
      attr[out + 11] += influence * Math.sin(3.61 * bone);
    }
  }
  return {
    p,
    attr,
    stride,
    weights: [
      ...(w
        ? [0.1, 0.1, 0.1, 0.13, 0.13, 0.35, 0.35, 0.35, 0.35, 0.22, 0.22, 0.22]
        : [0.1, 0.1, 0.1, 0.13, 0.13]),
      ...(color ? [0.25, 0.25, 0.25] : []),
    ],
  };
}
function reduce(idx, ratio, input, lock, hair = false) {
  const target =
    3 *
    Math.min(idx.length / 3, Math.max(12, Math.ceil((idx.length / 3) * ratio)));
  if (target >= idx.length) return idx;
  const { p, attr, stride, weights } = input;
  function run(error, flags) {
    return MeshoptSimplifier.simplifyWithAttributes(
      idx,
      p.array,
      3,
      attr,
      stride,
      weights,
      lock,
      target,
      error,
      flags,
    )[0];
  }
  let result = run(0.011, ["Sparse"]);
  if (result.length > target * (hair ? 1.5 : 1.12))
    result = run(0.035, ["Sparse", "Permissive"]);
  if (result.length > target * (hair ? 1.5 : 1.25))
    result = run(0.085, ["Sparse", "Permissive"]);
  return result;
}
function simplify(g, b, ratio, input) {
  return reduce(
    g.index.array.subarray(b.start, b.start + b.count),
    ratio,
    input,
    g.attributes.lodAnchor?.array ?? null,
    b.material.userData.hairCards,
  );
}
function together(g, pool, ratio, input) {
  const count = g.attributes.position.count,
    owner = new Int32Array(count).fill(-1),
    shared = new Uint8Array(count),
    lock = Uint8Array.from(g.attributes.lodAnchor?.array ?? shared),
    idx = new Uint32Array(pool.reduce((n, b) => n + b.count, 0));
  let at = 0;
  pool.forEach((b, k) => {
    const part = g.index.array.subarray(b.start, b.start + b.count);
    idx.set(part, at);
    at += b.count;
    for (const i of part)
      if (owner[i] < 0) owner[i] = k;
      else if (owner[i] !== k) shared[i] = lock[i] = 1;
  });
  const result = reduce(idx, ratio, input, lock),
    parts = pool.map(() => []);
  for (let t = 0; t < result.length; t += 3) {
    const corners = [result[t], result[t + 1], result[t + 2]],
      own = corners.find((i) => !shared[i]) ?? corners[0];
    parts[owner[own]].push(...corners);
  }
  return parts;
}
const pooledFloor = 0.7;
function simplifyPool(g, pool, budget, input) {
  const size = (list) => list.reduce((n, b) => n + b.count / 3, 0),
    kept = (list) => list.reduce((n, b) => n + b.result.length / 3, 0),
    even = Math.min(1, budget / Math.max(1, size(pool))),
    floor = (b) =>
      Math.min(
        b.count / 3,
        Math.max(12, Math.floor((b.count / 3) * even * pooledFloor)),
      ),
    alone = (b, triangles) =>
      simplify(g, b, Math.min(1, triangles / (b.count / 3)), input),
    held = [];
  let open = pool.slice();
  for (let pass = 0; open.length; pass++) {
    const share = Math.max(0, budget - kept(held)),
      parts =
        open.length > 1
          ? together(g, open, share / size(open), input)
          : [alone(open[0], share)],
      short = pass < 5 ? open.filter((b, k) => parts[k].length / 3 < floor(b)) : [];
    if (!short.length) {
      open.forEach((b, k) => (b.result = parts[k]));
      break;
    }
    for (const b of short) b.result = alone(b, floor(b));
    held.push(...short);
    open = open.filter((b) => !short.includes(b));
  }
  const spare = budget - kept(pool);
  if (held.length && spare > 0.01 * budget)
    for (const b of held)
      b.result = alone(b, b.result.length / 3 + (spare * b.count) / 3 / size(held));
}
function pack(entries, rect) {
  if (entries.length === 1) {
    entries[0].rect = rect;
    return;
  }
  const total = entries.reduce((n, e) => n + e.weight, 0);
  let first = entries[0].weight,
    i = 1;
  while (
    i < entries.length - 1 &&
    Math.abs(first + entries[i].weight - total * 0.5) <
      Math.abs(first - total * 0.5)
  )
    first += entries[i++].weight;
  const [x, y, w, h] = rect,
    frac = Math.max(0.12, Math.min(0.88, first / total));
  if (w >= h) {
    const s = Math.round(w * frac);
    pack(entries.slice(0, i), [x, y, s, h]);
    pack(entries.slice(i), [x + s, y, w - s, h]);
  } else {
    const s = Math.round(h * frac);
    pack(entries.slice(0, i), [x, y, w, s]);
    pack(entries.slice(i), [x, y + s, w, h - s]);
  }
}
function canvas(n, h = n) {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = h;
  return c;
}
const recode = (v, m) =>
  Math.round(
    255 *
      (v <= 0.04045
        ? linear((v / 12.92) * m)
        : linear(((v + 0.055) / 1.055) ** 2.4 * m)),
  );
const linear = (x) =>
  x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
function tileBounds(rect) {
  const [x, y, w, h] = rect;
  const pad = Math.min(4, Math.floor((Math.min(w, h) - 1) / 3));
  return [x + pad, y + pad, w - 2 * pad, h - 2 * pad];
}
function noteSampledUV(entry, geometry, group, defaultUV) {
  if (entry.sampleUV === null) return;
  const uv = geometry.attributes.uv;
  const end = group.start + (uv ? group.count : 1);
  for (let c = group.start; c < end; c++) {
    const v = geometry.index ? geometry.index.getX(c) : c;
    const u = uv ? T.MathUtils.clamp(uv.getX(v), 0, 1) : defaultUV;
    const y = uv ? T.MathUtils.clamp(uv.getY(v), 0, 1) : defaultUV;
    if ((u !== 0 && u !== 1) || (y !== 0 && y !== 1)) {
      entry.sampleUV = null;
      return;
    }
    if (!entry.sampleUV) entry.sampleUV = [u, y];
    else if (u !== entry.sampleUV[0] || y !== entry.sampleUV[1]) {
      entry.sampleUV = null;
      return;
    }
  }
}

function drawMap(c, map, width, height, sampleUV) {
  const repeatX = Math.max(1, map.repeat.x), repeatY = Math.max(1, map.repeat.y);
  if (sampleUV) {
    const image = map.image;
    const x = sampleUV[0] * (image.width - 1);
    const y = (1 - sampleUV[1]) * (image.height - 1);
    c.drawImage(image, x, y, 1, 1, 0, 0, width, height);
    return;
  }
  for (let j = 0; j < Math.ceil(repeatY); j++)
    for (let i = 0; i < Math.ceil(repeatX); i++)
      c.drawImage(map.image, i * width / repeatX, j * height / repeatY, width / repeatX, height / repeatY);
}
function fillTile(ctx, rect, material, emission = false, sampleUV) {
  const [, , width, height] = tileBounds(rect);
  const tile = canvas(width, height),
    c = tile.getContext("2d", { willReadFrequently: true });
  const map = emission ? material.emissiveMap : material.map,
    colour = emission ? material.emissive : material.color;
  const cutout = !emission && map?.image && material.alphaTest > 0;
  if (!cutout) {
    c.fillStyle = "white";
    c.fillRect(0, 0, width, height);
  }
  if (map?.image) drawMap(c, map, width, height, sampleUV);
  const pixels = c.getImageData(0, 0, width, height),
    strength = emission ? (material.emissiveIntensity ?? 1) : 1;
  const factors = [colour?.r ?? 0, colour?.g ?? 0, colour?.b ?? 0].map(
    (v) => v * strength,
  );
  const lut = factors.map((f) =>
    Uint8ClampedArray.from({ length: 256 }, (_, i) => recode(i / 255, f)),
  );
  for (let i = 0; i < pixels.data.length; i += 4) {
    for (let k = 0; k < 3; k++) pixels.data[i + k] = lut[k][pixels.data[i + k]];
    if (cutout) {
      const a = pixels.data[i + 3] / 255, threshold = material.alphaTest;
      pixels.data[i + 3] = Math.round(255 * (a <= threshold
        ? 0.5 * a / threshold : 0.5 + 0.5 * (a - threshold) / (1 - threshold)));
    }
  }
  c.putImageData(pixels, 0, 0);
  return writeTile(ctx, rect, tile);
}
function writeTile(ctx, rect, tile) {
  const [x, y, w, h] = rect, { width, height } = tile;
  const pad = (w - width) / 2;
  ctx.drawImage(tile, 0, 0, 1, 1, x, y, pad, pad);
  ctx.drawImage(tile, width - 1, 0, 1, 1, x + w - pad, y, pad, pad);
  ctx.drawImage(tile, 0, height - 1, 1, 1, x, y + h - pad, pad, pad);
  ctx.drawImage(
    tile,
    width - 1,
    height - 1,
    1,
    1,
    x + w - pad,
    y + h - pad,
    pad,
    pad,
  );
  ctx.drawImage(tile, 0, 0, width, 1, x + pad, y, width, pad);
  ctx.drawImage(
    tile,
    0,
    height - 1,
    width,
    1,
    x + pad,
    y + h - pad,
    width,
    pad,
  );
  ctx.drawImage(tile, 0, 0, 1, height, x, y + pad, pad, height);
  ctx.drawImage(
    tile,
    width - 1,
    0,
    1,
    height,
    x + w - pad,
    y + pad,
    pad,
    height,
  );
  ctx.drawImage(tile, x + pad, y + pad);
  return [x + pad, y + pad, width, height];
}
function texture(c, srgb) {
  const t = new T.CanvasTexture(c);
  if (srgb) t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function fillSurface(surface, normals, entry) {
  const m = entry.material;
  const [, , w, h] = tileBounds(entry.rect);
  const hasProperties = Boolean(m.roughnessMap?.image || m.metalnessMap?.image || m.aoMap?.image);
  if (!hasProperties) {
    surface.fillStyle = "rgb(255," + Math.round(255 * (m.roughness ?? 1)) + "," + Math.round(255 * (m.metalness ?? 0)) + ")";
    surface.fillRect(...entry.rect);
  }
  if (!hasProperties && !m.bumpMap?.image && !m.normalMap?.image) return;
  const tile = canvas(w,h);
  const c = tile.getContext("2d", {willReadFrequently: true});
  function read(map) {
    if (!map?.image) return null;
    c.clearRect(0,0,w,h);
    drawMap(c,map,w,h,entry.sampleUV);
    return c.getImageData(0,0,w,h).data;
  }
  const pixels = c.createImageData(w,h);
  if (hasProperties) {
    const rough = read(m.roughnessMap);
    const metal = m.metalnessMap === m.roughnessMap ? rough : read(m.metalnessMap);
    const ambient = m.aoMap === m.roughnessMap ? rough : m.aoMap === m.metalnessMap ? metal : read(m.aoMap);
    packSurfaceChannels(pixels.data, rough, metal, m.roughness ?? 1, m.metalness ?? 0, ambient, m.aoMapIntensity ?? 1);
    c.putImageData(pixels,0,0);
    writeTile(surface,entry.rect,tile);
  }
  if (normals && (m.normalMap?.image || m.bumpMap?.image)) {
    if (m.normalMap?.image) packNormals(pixels.data, read(m.normalMap), m.normalScale);
    else heightNormals(pixels.data,read(m.bumpMap),w,h,m.bumpScale,entry.uvScale,m.bumpMap.colorSpace === T.SRGBColorSpace);
    c.putImageData(pixels,0,0);
    writeTile(normals,entry.rect,tile);
  }
}
function atlas(entries, size, contact) {
  for (const entry of entries) {
    const m = entry.material;
    const maps = [m.map, m.emissiveMap, m.aoMap, m.bumpMap, m.normalMap, m.roughnessMap, m.metalnessMap];
    if (entry.sampleUV && maps.some(map => map?.image &&
        (!Number.isInteger(Math.max(1, map.repeat.x)) || !Number.isInteger(Math.max(1, map.repeat.y))))) {
      entry.sampleUV = null;
    }
    if (entry.sampleUV) entry.weight = Math.min(4, entry.weight);
    if (m.userData?.bodySkin) entry.weight = Math.min(100, entry.weight);
    if (!maps.some(map => map?.image))
      entry.weight = Math.min(16, entry.weight);
  }
  const page = [0, 0, size, size - (contact ? contactRampRows(size) : 0)];
  const body = entries.find(entry => entry.material.userData.castBodySheet);
  const hair = entries.find(entry => entry.material.userData.castHairSheet);
  const usesHairQuarter = size >= 64 && entries.length === 2 && body && hair;
  if (usesHairQuarter) {
    body.rect = page;
    const [x, y, width, height] = tileBounds(page);
    const left = Math.ceil(width / 2) + 2, top = Math.ceil(height / 2) + 2;
    hair.rect = [x + left, y + top, width - left - 2, height - top - 2];
    entries = [body, hair];
  } else {
    pack(entries.sort((a, b) => b.weight - a.weight), page);
  }
  const color = canvas(size),
    emit = canvas(size),
    surface = canvas(size),
    ctx = surface.getContext("2d");
  const relief = entries.some(e => e.material.normalMap?.image || e.material.bumpMap?.image) ? canvas(size) : null;
  const normals = relief?.getContext("2d");
  if (normals) {
    normals.fillStyle = "rgb(128,128,255)";
    normals.fillRect(0,0,size,size);
  }
  const base = color.getContext("2d");
  let anyEmission = false;
  for (const e of entries) {
    const m = e.material;
    if (usesHairQuarter && e === hair) {
      base.clearRect(...e.rect);
      normals?.fillRect(...e.rect);
    }
    e.uv = fillTile(base, e.rect, m, false, e.sampleUV);
    if ((m.emissive?.getHex() ?? 0) !== 0) {
      fillTile(emit.getContext("2d"), e.rect, m, true, e.sampleUV);
      anyEmission = true;
    } else {
      const ec = emit.getContext("2d");
      ec.fillStyle = "#000";
      ec.fillRect(...e.rect);
    }
    fillSurface(ctx,normals,e);
  }
  if (contact) drawContactRamp(ctx, size);
  const map = texture(color, true),
    orm = texture(surface, false),
    emissiveMap = anyEmission ? texture(emit, true) : null;
  const occlusion = contact ? orm.clone() : entries.some(e => e.material.aoMap?.image) ? orm : null;
  if (contact) occlusion.channel = 1;
  const material = new T.MeshStandardMaterial({
    map,
    roughness: 1,
    metalness: 1,
    roughnessMap: orm,
    metalnessMap: orm,
    aoMap: occlusion,
    normalMap: relief ? texture(relief, false) : null,
    emissive: anyEmission ? 0xffffff : 0,
    emissiveMap,
  });
  if (entries.some(({ material: m }) => m.alphaTest > 0 && m.map?.image)) {
    material.alphaTest = 0.5;
    material.alphaToCoverage = true;
    if (entries.some(({material: m}) => m.alphaTest > 0 && m.side === T.DoubleSide)) {
      material.side = T.DoubleSide;
    }
  }
  material.name = "Character atlas";
  return {
    material,
    dispose() {
      map.dispose();
      orm.dispose();
      if (contact) occlusion.dispose();
      material.normalMap?.dispose();
      emissiveMap?.dispose();
      material.dispose();
    },
  };
}
export function canonicalizeGameAttributes(geometry) {
  const color = geometry.getAttribute("color");
  if (color && !color.normalized) {
    const data = color.array;
    for (let i = 0; i < data.length; i++)
      data[i] = T.MathUtils.clamp(data[i], 0, 1);
  }
  const joints = geometry.getAttribute("skinIndex")?.array;
  const weights = geometry.getAttribute("skinWeight")?.array;
  if (joints && weights)
    for (let i = 0; i < joints.length; i++)
      if (weights[i] === 0) joints[i] = 0;
}

function remap(g, groups, tiles, size) {
  const attributes = Object.entries(g.attributes).filter(
      ([name]) => name !== "lodAnchor",
    ),
    out = new Map(attributes.map(([k]) => [k, []])),
    indices = [],
    sourceOrder = [];
  for (const b of groups) {
    const tile = tiles.get(b.material);
    const simplified = b.result,
      lookup = new Map();
    const [x, y, w, h] = tile.uv;
    for (const i of simplified) {
      let dest = lookup.get(i);
      if (dest === undefined) {
        dest = out.get("position").length / 3;
        lookup.set(i, dest);
        sourceOrder.push(i);
        for (const [key, a] of attributes) {
          const values = out.get(key);
          if (key === "uv") {
            values.push(
              (x + (tile.sampleUV ? 0.5 : T.MathUtils.clamp(a.getX(i), 0, 1)) * w) / size,
              1 - (y + (tile.sampleUV ? 0.5 : 1 - T.MathUtils.clamp(a.getY(i), 0, 1)) * h) / size,
            );
          } else
            for (let j = 0; j < a.itemSize; j++)
              values.push(a.array[a.itemSize * i + j]);
        }
      }
      indices.push(dest);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setIndex(indices);
  for (const [key, a] of attributes)
    geo.setAttribute(
      key,
      new T.BufferAttribute(
        new a.array.constructor(out.get(key)),
        a.itemSize,
        a.normalized,
      ),
    );
  canonicalizeGameAttributes(geo);
  geo.morphTargetsRelative = g.morphTargetsRelative;
  for (const [key, targets] of Object.entries(g.morphAttributes)) {
    geo.morphAttributes[key] = targets.map((target) => {
      const data = new Float32Array(sourceOrder.length * target.itemSize);
      sourceOrder.forEach((source, dest) =>
        data.set(
          target.array.subarray(
            source * target.itemSize,
            (source + 1) * target.itemSize,
          ),
          dest * target.itemSize,
        ),
      );
      const attr = new T.Float32BufferAttribute(data, target.itemSize);
      attr.name = target.name;
      return attr;
    });
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
export async function optimizeForGame(
  root,
  { triangles = gameTriangleTarget, size = 1024, contact = true } = {},
) {
  await MeshoptSimplifier.ready;
  root.updateMatrixWorld(true);
  const meshes = [],
    tiles = new Map();
  let initial = 0,
    eyeTriangles = 0,
    fittedFaceTriangles = 0,
    foldedClothTriangles = 0,
    carrierTriangles = 0,
    trimTriangles = 0,
    hairTriangles = 0,
    retainedTriangles = 0;
  const retainsGeometry = material => material.userData.fibreLOD || material.userData.wingLOD;
  const portraitFace = (mesh) =>
    mesh.userData.fittedEyes ||
    (mesh.userData.faceSurface && mesh.material.userData?.portraitPlate);
  root.traverseVisible((m) => {
    if (!m.isMesh) return;
    const groups = batches(m);
    const defaultUV = groups.some(({ material }) => material.map || material.emissiveMap) ? 0 : 0.5;
    for (const b of groups) {
      initial += b.count / 3;
      if (retainsGeometry(b.material)) retainedTriangles += b.count / 3;
      else if (b.material.userData.attachmentDetail === "carrier")
        carrierTriangles += b.count / 3;
      else if (b.material.userData.attachmentDetail === "trim")
        trimTriangles += b.count / 3;
      else if (b.material.userData.hairCards) hairTriangles += b.count / 3;
      else if (m.userData.eyePiece) eyeTriangles += b.count / 3;
      else if (portraitFace(m)) fittedFaceTriangles += b.count / 3;
      else if (b.material.userData.foldedCloth)
        foldedClothTriangles += b.count / 3;
      const e = tiles.get(b.material) ?? { material: b.material, weight: 0, uvScale: {u:0, v:0, area:0} };
      noteSampledUV(e, m.geometry, b, defaultUV);
      if (b.material.bumpMap?.image) measureTileScale(m,b,e.uvScale);
      e.weight +=
        Math.sqrt(b.count) *
        (b.material.userData?.creatureHide
          ? 3.2
          : b.material.userData?.portrait
            ? 2.2
            : b.material.userData?.hairCards ? 1.85 : 1);
      tiles.set(b.material, e);
    }
    meshes.push([m, groups]);
  });
  if (!meshes.length)
    throw new Error("The selected wardrobe has no visible mesh.");
  const available = Math.max(0, triangles - retainedTriangles);
  const carriers = Math.min(carrierTriangles, available * 0.065);
  const trim = Math.min(trimTriangles, available * 0.085);
  const hair = Math.min(hairTriangles, available * 0.11);
  const shared = available - carriers - trim - hair;
  const eyes = Math.min(eyeTriangles, shared * 0.22),
    faces = Math.min(fittedFaceTriangles * 0.55, shared * 0.34),
    cloth = Math.min(
      foldedClothTriangles * 0.6,
      (shared - eyes - faces) * 0.32,
    );
  const useContact = contact && size >= 32;
  const page = atlas([...tiles.values()], size, useContact);
  const rest =
      initial -
      retainedTriangles -
      carrierTriangles -
      trimTriangles -
      hairTriangles -
      eyeTriangles -
      fittedFaceTriangles -
      foldedClothTriangles,
    want = Math.min(rest * restShare, triangles * restLimit),
    thinned = T.MathUtils.clamp(
      want - (shared - eyes - faces - cloth),
      0,
      Math.max(0, retainedTriangles - triangles * keptFloor),
    ),
    kept = retainedTriangles - thinned;
  page.material.vertexColors = meshes.some(([mesh]) =>
    Boolean(mesh.geometry.attributes.color),
  );
  let count = 0,
    pooled = 0;
  const work = [],
    shares = [];
  for (const [mesh, groups] of meshes) {
    const share = mesh.userData.eyePiece
      ? eyes / eyeTriangles
      : portraitFace(mesh)
        ? faces / fittedFaceTriangles
        : undefined;
    for (const batch of groups)
      if (initial <= triangles) batch.ratio = 1;
      else if (retainsGeometry(batch.material)) batch.ratio = kept / retainedTriangles;
      else if (batch.material.userData.attachmentDetail === "carrier")
        batch.ratio = carriers / carrierTriangles;
      else if (batch.material.userData.attachmentDetail === "trim")
        batch.ratio = trim / trimTriangles;
      else if (batch.material.userData.hairCards)
        batch.ratio = hair / hairTriangles;
      else if (batch.material.userData.foldedCloth && foldedClothTriangles)
        batch.ratio = cloth / foldedClothTriangles;
      else batch.ratio = share;
    if (page.material.vertexColors) whiteVertexColors(mesh.geometry);
    const original = mesh.geometry,
      joined = mergeVertices(original, 1e-5);
    if (!joined.attributes.normal) joined.computeVertexNormals();
    if (!joined.attributes.uv) {
      const coordinate = groups.some(({ material }) => material.map || material.emissiveMap) ? 0 : 0.5;
      const uvs = new Float32Array(joined.attributes.position.count * 2).fill(coordinate);
      joined.setAttribute("uv", new T.BufferAttribute(uvs, 2));
    }
    const input = simplifyInputs(joined);
    for (const batch of groups)
      if (batch.ratio === undefined) pooled += batch.count / 3;
      else {
        batch.result = simplify(joined, batch, batch.ratio, input);
        count += batch.result.length / 3;
      }
    original.dispose();
    work.push({ mesh, groups, joined, input });
  }
  const left = Math.min(0.55 * pooled, Math.max(0, triangles - count));
  for (const { mesh, groups, joined, input } of work) {
    const pool = groups.filter((batch) => !batch.result);
    if (pool.length)
      simplifyPool(joined, pool, (left * pool.reduce((n, batch) => n + batch.count / 3, 0)) / pooled, input);
    for (const batch of pool) count += batch.result.length / 3;
    for (const batch of groups)
      shares.push({
        material: batch.material,
        initial: batch.count / 3,
        triangles: batch.result.length / 3,
      });
    if (mesh.userData.faceSurface) {
      const normalAtlas = page.material.normalMap?.image.getContext("2d", { willReadFrequently: true });
      const occlusionAtlas = useContact && page.material.aoMap?.image.getContext("2d", { willReadFrequently: true });
      for (const batch of groups) {
        if (!batch.material.userData.faceLayout) continue;
        const [x,y,w,h] = tiles.get(batch.material).uv;
        const original = joined.index.array.subarray(batch.start,batch.start+batch.count);
        if (normalAtlas && batch.result.length !== batch.count) {
          const region = normalAtlas.getImageData(x,y,w,h);
          transferFaceNormals(region.data,w,h,joined,original,batch.result);
          normalAtlas.putImageData(region,x,y);
        }
        if (occlusionAtlas && batch.material.aoMap?.image) {
          const region = occlusionAtlas.getImageData(x,y,w,h);
          bakeFaceOcclusion(region.data,w,h,joined,original);
          occlusionAtlas.putImageData(region,x,y);
        }
      }
    }
    mesh.geometry = remap(joined, groups, tiles, size);
    mesh.material = page.material;
    joined.dispose();
  }
  if (useContact) bakeContact(work, size);
  return { ...page, initial, triangles: count, shares };
}
