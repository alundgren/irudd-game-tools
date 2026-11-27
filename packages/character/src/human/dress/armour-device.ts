import * as T from "three";
import { context2d, type Raster } from "../../raster.js";
import type { DressMesh } from "./kit.js";
import type { TailorLayer } from "./tailor-data.js";

import type { BreastplateFit } from "./armour-types.js";
export const breastplateDevices = ["Plain", "Night moth", "Reed heron", "Knotted oak", "Compass"];

function plateChart(dress: DressMesh, { centreZ, bottom, top }: BreastplateFit) {
  const geometry = dress.mesh.geometry,
    weights = dress;
  const position = geometry.getAttribute("position"),
    normals = geometry.getAttribute("normal");
  const ids = new Map<number, number>(),
    points: number[] = [],
    directions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    boneIds: number[] = [],
    influences: number[] = [];
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds || !geometry.index) throw new Error("The breastplate needs indexed geometry.");
  const { min, max } = bounds,
    halfWidth = Math.max(Math.abs(min.x), Math.abs(max.x), 0.01);
  const corners = geometry.index.array;
  for (let face = 0; face < corners.length; face += 3) {
    const front =
      (position.getZ(corners[face] ?? 0) +
        position.getZ(corners[face + 1] ?? 0) +
        position.getZ(corners[face + 2] ?? 0)) /
        3 >=
      centreZ;
    for (let corner = 0; corner < 3; corner++) {
      const source = corners[face + corner] ?? 0,
        key = source * 2 + Number(front);
      let target = ids.get(key);
      if (target === undefined) {
        target = points.length / 3;
        ids.set(key, target);
        const x = position.getX(source),
          y = position.getY(source);
        points.push(x, y, position.getZ(source));
        directions.push(normals.getX(source), normals.getY(source), normals.getZ(source));
        const height = Math.max(0.001, top - bottom);
        uv.push(
          (front ? 0.25 : 0.75) + ((front ? 1 : -1) * 0.24 * x) / halfWidth,
          Math.min(0.99, Math.max(0.01, (y - bottom) / height)),
        );
        for (let j = 0; j < 4; j++) {
          boneIds.push(weights.boneIndices[source * 4 + j] ?? 0);
          influences.push(weights.weights[source * 4 + j] ?? 0);
        }
      }
      indices.push(target);
    }
  }
  geometry.setAttribute("position", new T.Float32BufferAttribute(points, 3));
  geometry.setAttribute("normal", new T.Float32BufferAttribute(directions, 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  return {
    widthM: 2 * halfWidth,
    bottom,
    top,
    dress: {
      ...dress,
      weights: Float32Array.from(influences),
      boneIndices: Uint8Array.from(boneIds),
    },
  };
}

function rgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function mottle(x: number, y: number) {
  const at = (i: number, j: number) => {
    const n = Math.imul((i * 374761393 + j * 668265263) ^ 0x5bd1e995, 1274126177);
    return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
  };
  const soft = (px: number, py: number) => {
    const i = Math.floor(px),
      j = Math.floor(py),
      a = px - i,
      b = py - j,
      u = a * a * (3 - 2 * a),
      v = b * b * (3 - 2 * b);
    return (
      (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) +
      (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v
    );
  };
  return (soft(x, y) * 2 + soft(x * 2.7 + 9, y * 2.7 + 4)) / 1.5 - 1;
}

export function finishBreastplate(
  input: DressMesh,
  fit: BreastplateFit,
  raster: Raster,
  devices: Uint8Array,
): DressMesh {
  const mesh = input.mesh;
  if (!(mesh.material instanceof T.MeshStandardMaterial)) return input;
  const { layer, ribs } = fit;
  const { widthM, bottom, top, dress } = plateChart(input, fit);
  const heightM = top - bottom;
  const width = 768,
    height = 384,
    diffuse = context2d(raster.canvas(width, height)),
    surface = context2d(raster.canvas(width, height));
  const device = breastplateDevices.indexOf(String(layer["device"])) - 1;
  const h = height * 0.39,
    w = ((h * heightM) / widthM) * 0.96;
  const colour = diffuse.createImageData(width, height),
    detail = surface.createImageData(width, height);
  const base = rgb(String(layer["color"])),
    inlay = rgb(String(layer["trim"]));
  const leather = layer["material"] === "leather",
    steel = layer["material"] === "steel";
  const waistBand = Math.max(0.018, (ribs - bottom) / Math.max(1, Number(layer["lames"])));
  const segmented = layer["build"] === "segmented";
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  let random = 42;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = 4 * (y * width + x);
      const u = Math.floor(((x - width * 0.25) / w + 0.5) * 256),
        v = Math.floor(((y - height * 0.34) / h + 0.5) * 256);
      const mark =
        device >= 0 && u >= 0 && v >= 0 && u < 256 && v < 256
          ? (devices[(Math.floor(device / 2) * 256 + v) * 512 + (device % 2) * 256 + u] ?? 0) / 255
          : 0;
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const grit = random / 4294967296 - 0.5;
      const hammer =
        Math.sin(x * 0.15 + Math.sin(y * 0.17) * 1.7) * Math.cos(y * 0.13 + Math.sin(x * 0.07));
      const patch = mottle((x / width) * 14, (y / height) * 7);
      const grain =
        (leather ? grit * 0.12 + hammer * 0.025 : grit * 0.042 + hammer * 0.019) +
        patch * (leather ? 0.07 : 0.085);
      const px = Math.abs(((((x + 0.5) % (width / 2)) / (width / 2) - 0.5) * widthM) / 0.96);
      const aboveHem = (1 - (y + 0.5) / height) * heightM;
      let metal = mark,
        raise = 0,
        seam = 0,
        strap = 0;
      if (segmented) {
        const waist = aboveHem < ribs - bottom;
        const row = waist
          ? (((aboveHem / waistBand + 0.15) % 1) - 0.5) * waistBand
          : aboveHem - 0.79 * heightM;
        const col = waist ? px - 0.31 * widthM : px - 0.29 * widthM;
        const d = Math.hypot(col, row);
        const rivet = clamp((0.0047 - d) / 0.0014);
        const rim = clamp(1 - Math.abs(d - 0.0051) / 0.0019);
        metal = Math.max(metal, 0.83 * rivet);
        raise = 0.8 * rivet + 0.27 * rim;
        seam = 0.23 * rim;
        if (leather && px > 0.27 * widthM) {
          const dist = Math.min(
            Math.abs(aboveHem - 0.54 * heightM),
            Math.abs(aboveHem - 0.68 * heightM),
          );
          const fromEnd = px - 0.27 * widthM;
          const sideEdge = Math.max(dist - 0.012, 0.007 - fromEnd - Math.max(0, 0.009 - dist));
          strap = clamp(-sideEdge / 0.0015);
          const stitch =
            clamp(1 - Math.abs(sideEdge + 0.0036) / 0.0014) *
            clamp((Math.cos((fromEnd * 2 * Math.PI) / 0.006) + 0.35) * 1.7);
          const buckle = Math.max(Math.abs(fromEnd - 0.037) - 0.006, dist - 0.015);
          const frame = clamp(1 - Math.abs(buckle) / 0.0025);
          metal = Math.max(metal, 0.9 * frame, 0.34 * stitch);
          raise += 0.38 * strap + 0.73 * frame + 0.23 * stitch;
          seam += 0.27 * clamp(1 - Math.abs(sideEdge - 0.001) / 0.0022);
        }
      }
      for (let c = 0; c < 3; c++)
        colour.data[offset + c] =
          ((base[c] ?? 0) * (1 - metal) * (1 - 0.27 * strap) + (inlay[c] ?? 0) * metal) *
          (1 + grain - seam);
      colour.data[offset + 3] = 255;
      detail.data[offset] = 88 + 106 * mark + 98 * raise + grit * (leather ? 24 : 7) + 6 * hammer;
      detail.data[offset + 1] =
        (leather ? 172 : steel ? 112 : 92) -
        54 * metal +
        14 * grit +
        6 * hammer -
        (leather ? 16 : 30) * patch;
      detail.data[offset + 2] = (steel ? 214 : 8) * (1 - metal) + 189 * metal;
      detail.data[offset + 3] = 255;
    }
  diffuse.putImageData(colour, 0, 0);
  surface.putImageData(detail, 0, 0);
  const material = mesh.material.clone(),
    map = new T.CanvasTexture(diffuse.canvas),
    orm = new T.CanvasTexture(surface.canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = orm.anisotropy = 4;
  material.color.set(0xffffff);
  material.map = map;
  material.metalness = material.roughness = 1;
  material.metalnessMap = material.roughnessMap = material.bumpMap = orm;
  material.bumpScale = 0.0016;
  material.name =
    "Cuirass " +
    String(layer["material"]) +
    (device >= 0 ? " with " + String(layer["device"]) : "");
  material.addEventListener("dispose", () => {
    map.dispose();
    orm.dispose();
  });
  mesh.material = material;
  return dress;
}

export function finishGuards(
  mesh: T.Mesh,
  coordinates: number[],
  style: TailorLayer,
  limb: boolean,
  raster: Raster,
) {
  if (!(mesh.material instanceof T.MeshStandardMaterial)) return;
  mesh.geometry.setAttribute("uv", new T.Float32BufferAttribute(coordinates, 2));
  const base = mesh.material,
    size = 256,
    albedo = context2d(raster.canvas(size, size)),
    details = context2d(raster.canvas(size, size));
  const colour = albedo.createImageData(size, size),
    packed = details.createImageData(size, size);
  const metal = String(style["material"]) === "steel",
    leather = String(style["material"]) === "leather";
  const tint = new T.Color(String(style["trim"])),
    plate = new T.Color(String(style["color"])),
    sample = new T.Color();
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size - 0.012) / 0.976,
        y = (j + 0.5) / size,
        bell = y < 0.675;
      const t = bell ? (y - 0.02) / 0.64 : (y - 0.69) / 0.29;
      const width = Math.min(x, 1 - x),
        edge = Math.min(width, (bell ? 0.34 : 0.13) * Math.min(t, 1 - t));
      const rim = Math.exp(-((edge - 0.009) ** 2) / 0.000013);
      const recessed = Math.exp(-((edge - 0.021) ** 2) / 0.000012);
      const span = 0.105 + 0.48 * Math.min(1, Math.max(0, t));
      const rib = Math.abs((x - 0.5) / span);
      let ridge =
        bell && rib < 1 && t > 0 && t < 1
          ? Math.cos(rib * Math.PI * 3) ** 8 * Math.sin(Math.PI * t) ** 0.7
          : 0;
      const u = Math.min(1, Math.max(0, t));
      if (limb && bell) {
        const across = Math.abs(x - 0.5);
        const flute = across - (0.045 + 0.255 * (1 - u) ** 1.6);
        ridge =
          Math.sin(Math.PI * u) ** 0.48 *
          (Math.exp(-(across ** 2) / 0.00022) + 0.8 * Math.exp(-(flute ** 2) / 0.00028));
      }
      const v = limb && bell ? (t < 0.5 ? 0.22 : 0.78) : bell ? 0.82 : 0.64;
      const distance = Math.hypot(
        Math.min(Math.abs(x - 0.085), Math.abs(x - 0.915)),
        (t - v) * (bell ? 0.34 : 0.13),
      );
      const stud = Math.max(0, Math.min(1, (0.014 - distance) / 0.004));
      const peen = Math.exp(-((distance - 0.017) ** 2) / 0.000012);
      const chased = limb && bell ? 0.28 * ridge : 0;
      const bright = Math.max(chased, (bell ? 0.45 : 0.64) * rim);
      const raised = Math.max(bright, stud);
      const metalTone = metal ? 1 : 0.5;
      const hammer = Math.sin(i * 0.37 + Math.sin(j * 0.19)) * Math.sin(j * 0.51 + i * 0.06);
      const patch = mottle((i / size) * 7, (j / size) * 9);
      sample
        .copy(plate)
        .multiplyScalar(
          1 -
            0.33 * recessed -
            0.24 * peen +
            0.08 * ridge +
            0.022 * hammer +
            (leather ? 0.07 : 0.085) * patch,
        );
      sample.lerp(tint, raised).convertLinearToSRGB();
      const k = 4 * (j * size + i);
      colour.data[k] = 255 * sample.r;
      colour.data[k + 1] = 255 * sample.g;
      colour.data[k + 2] = 255 * sample.b;
      colour.data[k + 3] = 255;
      packed.data[k] = 112 + 54 * ridge + 48 * rim - 36 * recessed + 70 * stud + 4 * hammer;
      packed.data[k + 1] =
        (leather ? 163 : 107) +
        22 * recessed -
        30 * raised +
        8 * hammer -
        (leather ? 16 : 30) * patch;
      packed.data[k + 2] = metal ? 214 + 30 * raised : 5 + 200 * metalTone * raised;
      packed.data[k + 3] = 255;
    }
  albedo.putImageData(colour, 0, 0);
  details.putImageData(packed, 0, 0);
  const mat = base.clone(),
    map = new T.CanvasTexture(albedo.canvas),
    pbr = new T.CanvasTexture(details.canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = pbr.anisotropy = 4;
  mat.map = map;
  mat.color.set(0xffffff);
  mat.bumpMap = mat.roughnessMap = mat.metalnessMap = pbr;
  mat.bumpScale = 0.0022;
  mat.roughness = mat.metalness = 1;
  mat.name = (limb ? "Fluted limb guard " : "Articulated shoulder ") + String(style["material"]);
  mat.addEventListener("dispose", () => {
    map.dispose();
    pbr.dispose();
  });
  mesh.material = mat;
}
