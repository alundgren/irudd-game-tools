import { whiteVertexColors } from "./markings.js";
import * as T from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshoptSimplifier } from "three/addons/libs/meshopt_simplifier.module.js";

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
      // Identify which joints carry the weights. A rigid toe and a rigid
      // shin otherwise have the same attribute vector, [1, 0, 0, 0].
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
function simplify(g, b, ratio, input) {
  const idx = g.index.array.subarray(b.start, b.start + b.count);
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
      null,
      target,
      error,
      flags,
    )[0];
  }
  let result = run(0.011, ["Sparse"]);
  // A fitted garment can have a normal seam at each source triangle.
  // Permit seam collapses for materials that miss the target and retain
  // UVs, surface normals and joint influence in the error metric.
  if (result.length > target * 1.12)
    result = run(0.035, ["Sparse", "Permissive"]);
  if (result.length > target * 1.25)
    result = run(0.085, ["Sparse", "Permissive"]);
  return result;
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
function fillTile(ctx, rect, material, emission = false) {
  const [x, y, w, h] = rect,
    pad = Math.min(4, Math.floor((Math.min(w, h) - 1) / 3)),
    width = w - 2 * pad,
    height = h - 2 * pad;
  const tile = canvas(width, height),
    c = tile.getContext("2d", { willReadFrequently: true });
  const map = emission ? material.emissiveMap : material.map,
    colour = emission ? material.emissive : material.color;
  c.fillStyle = "white";
  c.fillRect(0, 0, width, height);
  if (map?.image) {
    const repeatX = Math.max(1, map.repeat.x),
      repeatY = Math.max(1, map.repeat.y);
    for (let j = 0; j < Math.ceil(repeatY); j++)
      for (let i = 0; i < Math.ceil(repeatX); i++)
        c.drawImage(
          map.image,
          (i * width) / repeatX,
          (j * height) / repeatY,
          width / repeatX,
          height / repeatY,
        );
  }
  const pixels = c.getImageData(0, 0, width, height),
    strength = emission ? (material.emissiveIntensity ?? 1) : 1;
  const factors = [colour?.r ?? 0, colour?.g ?? 0, colour?.b ?? 0].map(
    (v) => v * strength,
  );
  const lut = factors.map((f) =>
    Uint8ClampedArray.from({ length: 256 }, (_, i) => recode(i / 255, f)),
  );
  for (let i = 0; i < pixels.data.length; i += 4)
    for (let k = 0; k < 3; k++) pixels.data[i + k] = lut[k][pixels.data[i + k]];
  c.putImageData(pixels, 0, 0);
  // Extrude edge texels into the gutter for bilinear filtering.
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
function atlas(entries, size) {
  pack(
    entries.sort((a, b) => b.weight - a.weight),
    [0, 0, size, size],
  );
  const color = canvas(size),
    emit = canvas(size),
    surface = canvas(size),
    ctx = surface.getContext("2d");
  let anyEmission = false;
  for (const e of entries) {
    const m = e.material;
    e.uv = fillTile(color.getContext("2d"), e.rect, m);
    if ((m.emissive?.getHex() ?? 0) !== 0) {
      fillTile(emit.getContext("2d"), e.rect, m, true);
      anyEmission = true;
    } else {
      const ec = emit.getContext("2d");
      ec.fillStyle = "#000";
      ec.fillRect(...e.rect);
    }
    ctx.fillStyle =
      "rgb(255," +
      Math.round(255 * (m.roughness ?? 1)) +
      "," +
      Math.round(255 * (m.metalness ?? 0)) +
      ")";
    ctx.fillRect(...e.rect);
  }
  const map = texture(color, true),
    orm = texture(surface, false),
    emissiveMap = anyEmission ? texture(emit, true) : null;
  const material = new T.MeshStandardMaterial({
    map,
    roughness: 1,
    metalness: 1,
    roughnessMap: orm,
    metalnessMap: orm,
    emissive: anyEmission ? 0xffffff : 0,
    emissiveMap,
  });
  material.name = "Character atlas";
  return {
    material,
    dispose() {
      map.dispose();
      orm.dispose();
      emissiveMap?.dispose();
      material.dispose();
    },
  };
}
function remap(g, groups, ratio, tiles, size) {
  const input = simplifyInputs(g);
  const attributes = Object.entries(g.attributes),
    out = new Map(attributes.map(([k]) => [k, []])),
    indices = [],
    sourceOrder = [];
  for (const b of groups) {
    const simplified = simplify(g, b, b.ratio ?? ratio, input),
      lookup = new Map();
    const [x, y, w, h] = tiles.get(b.material).uv;
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
              (x + T.MathUtils.clamp(a.getX(i), 0, 1) * w) / size,
              1 - (y + (1 - T.MathUtils.clamp(a.getY(i), 0, 1)) * h) / size,
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
  { triangles = 24000, size = 1024 } = {},
) {
  await MeshoptSimplifier.ready;
  root.updateMatrixWorld(true);
  const meshes = [],
    tiles = new Map();
  let initial = 0,
    eyeTriangles = 0,
    fittedFaceTriangles = 0,
    foldedClothTriangles = 0;
  root.traverseVisible((m) => {
    if (!m.isMesh) return;
    const groups = batches(m);
    for (const b of groups) {
      initial += b.count / 3;
      if (m.userData.eyePiece) eyeTriangles += b.count / 3;
      else if (m.userData.fittedEyes) fittedFaceTriangles += b.count / 3;
      else if (b.material.userData.foldedCloth)
        foldedClothTriangles += b.count / 3;
      const e = tiles.get(b.material) ?? { material: b.material, weight: 0 };
      // Dense facial meshes retain more texture space, while tiny hardware
      // shares the remainder. All weights have a lower bound for padding.
      e.weight +=
        Math.sqrt(b.count) * (b.material.userData?.portrait ? 2.2 : 1);
      tiles.set(b.material, e);
    }
    meshes.push([m, groups]);
  });
  if (!meshes.length)
    throw new Error("The selected wardrobe has no visible mesh.");
  // Thin moving eye layers need closely matching surfaces after simplification.
  // Reserve part of the existing triangle budget so their depths stay ordered.
  const eyes = Math.min(eyeTriangles, triangles * 0.22),
    faces = Math.min(fittedFaceTriangles * 0.55, triangles * 0.34),
    cloth = Math.min(
      foldedClothTriangles * 0.6,
      (triangles - eyes - faces) * 0.32,
    );
  const page = atlas([...tiles.values()], size),
    ratio = Math.min(
      0.55,
      (triangles - eyes - faces - cloth) /
        Math.max(
          1,
          initial - eyeTriangles - fittedFaceTriangles - foldedClothTriangles,
        ),
    );
  page.material.vertexColors = meshes.some(([mesh]) =>
    Boolean(mesh.geometry.attributes.color),
  );
  let count = 0;
  for (const [mesh, groups] of meshes) {
    // Both sides of a close-fitting folded panel need enough samples to stay ordered.
    for (const batch of groups)
      if (batch.material.userData.foldedCloth && foldedClothTriangles)
        batch.ratio = cloth / foldedClothTriangles;
    if (page.material.vertexColors) whiteVertexColors(mesh.geometry);
    const original = mesh.geometry,
      joined = mergeVertices(original, 1e-5);
    const share = mesh.userData.eyePiece
      ? eyes / eyeTriangles
      : mesh.userData.fittedEyes
        ? faces / fittedFaceTriangles
        : ratio;
    mesh.geometry = remap(joined, groups, share, tiles, size);
    mesh.material = page.material;
    joined.dispose();
    original.dispose();
    count += mesh.geometry.index.count / 3;
  }
  return { ...page, initial, triangles: count };
}
