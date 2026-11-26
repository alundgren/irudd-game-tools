// The textured layers of a creature's eye: compound facets or an iris drawn
// across the cage's equator. Ported from
// character-view/creature-eye-surface.js at 2761eb1.

import * as T from "three";
import { context2d, type Raster } from "../raster.js";
import type { BuildPart } from "../view.js";

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
type Texel = readonly [number, number, number, number, number];

// The staggered lattice follows the dome. Each lens has its own curvature
// and a quiet edge; highlights come from the scene lights.
function facet(x: number, y: number): Texel {
  const spacing = 0.186;
  const rowHeight = (spacing * Math.sqrt(3)) / 2;
  const row = Math.round(y / rowHeight);
  let closest = Infinity;
  let second = Infinity;
  let dx = 0;
  let dy = 0;
  let variation = 0;
  for (let j = row - 1; j <= row + 1; j++) {
    const shift = (j & 1) * 0.5;
    const i = Math.round(x / spacing - shift);
    for (let k = i - 1; k <= i + 1; k++) {
      const u = x - (k + shift) * spacing;
      const v = y - j * rowHeight;
      const d = u * u + v * v;
      if (d >= closest) {
        second = Math.min(second, d);
        continue;
      }
      second = closest;
      closest = d;
      dx = u;
      dy = v;
      variation = Math.sin(k * 27.7 + j * 13.5) * 0.5 + 0.5;
    }
  }
  const edge = clamp((second - closest) / (0.23 * spacing * spacing), 0, 1);
  const body = 0.72 + 0.19 * edge + 0.12 * variation;
  const spot = 1 - 0.68 * Math.exp(-((x - 0.08) ** 2 + (y + 0.03) ** 2) / 0.095);
  const nx = (dx / spacing) * 0.69;
  const ny = (dy / spacing) * 0.69;
  return [body * spot * 0.93, body * spot, body * spot * (0.89 + 0.11 * variation), nx, ny];
}

function iris(x: number, y: number): Texel {
  const r = Math.hypot(x, y);
  const a = Math.atan2(y, x);
  const w = a + 0.026 * Math.sin(7 * a + 3 * r) + 0.033 * Math.sin(4 * a - 4 * r);
  const fibre = 0.5 + 0.5 * Math.sin(59 * w + 3 * Math.sin(19 * a) + r * 2);
  const crypt = 0.5 + 0.5 * Math.sin(16 * w + Math.sin(7 * w) - r * 7);
  const frill = Math.exp(-(((r - 0.5 - 0.035 * Math.sin(11 * a)) / 0.069) ** 2));
  const limbus = 1 - 0.61 * clamp((r - 0.77) / 0.22, 0, 1);
  const value = limbus * (0.73 + 0.23 * fibre + 0.14 * crypt - 0.18 * frill);
  return [value * (1 + 0.12 * (1 - r)), value, value * (0.96 - 0.18 * frill), 0, 0];
}

interface Artwork {
  readonly map: T.CanvasTexture;
  readonly normalMap: T.CanvasTexture | null;
}

function artwork(raster: Raster, kind: "compound" | "iris", textures: T.Texture[]): Artwork {
  const size = 128;
  const canvas = raster.canvas(size, size);
  const normals = raster.canvas(size, size);
  const colour = context2d(canvas);
  const relief = context2d(normals);
  const rgb = colour.createImageData(size, size);
  const nrm = relief.createImageData(size, size);
  const compound = kind === "compound";
  for (let i = 0; i < size * size; i++) {
    const x = (((i % size) + 0.5) / size - 0.5) * 2;
    const y = (0.5 - (Math.floor(i / size) + 0.5) / size) * 2;
    const [r, g, b, nx, ny] = compound ? facet(x, y) : iris(x, y);
    rgb.data.set([255 * r, 255 * g, 255 * b, 255], i * 4);
    nrm.data.set(
      [127.5 * (1 + nx), 127.5 * (1 + ny), 127.5 * (1 + Math.sqrt(1 - nx * nx - ny * ny)), 255],
      i * 4,
    );
  }
  colour.putImageData(rgb, 0, 0);
  relief.putImageData(nrm, 0, 0);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  const normalMap = compound ? new T.CanvasTexture(normals) : null;
  textures.push(map, ...(normalMap ? [normalMap] : []));
  return { map, normalMap };
}

/** One material per eye layer and colour, and one artwork per textured layer. */
export interface EyeFinish {
  readonly materials: Map<string, T.MeshStandardMaterial>;
  readonly artwork: Map<string, Artwork>;
}

export function finishCreatureEye(
  mesh: T.Mesh,
  part: BuildPart,
  finish: EyeFinish,
  raster: Raster,
  textures: T.Texture[],
): void {
  const kind = part.eyeSurface;
  const cage = part.cage;
  if (!kind || !cage) return;
  const key = kind + "/" + part.color;
  let material = finish.materials.get(key);
  if (!material) {
    const source: T.Material | T.Material[] = mesh.material;
    if (!(source instanceof T.MeshStandardMaterial))
      throw new Error("A creature eye has one standard material.");
    material = source.clone();
    material.roughness = kind === "compound" ? 0.32 : kind === "pupil" ? 0.16 : 0.24;
    if (kind === "iris" || kind === "compound") {
      let art = finish.artwork.get(kind);
      if (!art) {
        art = artwork(raster, kind, textures);
        finish.artwork.set(kind, art);
      }
      material.map = art.map;
      material.normalMap = art.normalMap;
    }
    finish.materials.set(key, material);
  }
  mesh.material = material;
  if (!material.map) return;
  // The equator is the first sixteen cage points, in anatomical order. Its
  // two diameters carry the texture through turning and hand sculpture.
  const ring = cage.vertices;
  const vec = (i: number): T.Vector3 => {
    const v = ring[i];
    if (!v) throw new Error("A creature eye's cage has no equator.");
    return new T.Vector3(v[0], v[1], v[2]);
  };
  const u = vec(0).sub(vec(8));
  const v = vec(4).sub(vec(12));
  const centre = vec(0).lerp(vec(8), 0.5);
  const extentU = Math.max(u.length() / 2, 0.001);
  const extentV = Math.max(v.length() / 2, 0.001);
  u.normalize();
  v.addScaledVector(u, -v.dot(u)).normalize();
  const pos = mesh.geometry.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  const p = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).sub(centre);
    uv[i * 2] = clamp(0.5 + (0.48 * p.dot(u)) / extentU, 0.005, 0.995);
    uv[i * 2 + 1] = clamp(0.5 + (0.48 * p.dot(v)) / extentV, 0.005, 0.995);
  }
  mesh.geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
}
