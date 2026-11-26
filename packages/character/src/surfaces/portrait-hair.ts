import * as T from "three";
import { hairCapSize, type HairCap, type Knot } from "@irudd/document";
import { context2d, drawable, type Raster } from "../raster.js";
import { unpack } from "./packed.js";

const [width, height] = hairCapSize;

function value(field: Uint8Array, u: number, v: number): number {
  const x = (u - Math.floor(u)) * width;
  const y = T.MathUtils.clamp(v, 0, 1) * (height - 1);
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const jx = (ix + 1) % width;
  const jy = Math.min(height - 1, iy + 1);
  const at = (i: number) => field[i] ?? 0;
  return (
    T.MathUtils.lerp(
      T.MathUtils.lerp(at(iy * width + ix), at(iy * width + jx), x - ix),
      T.MathUtils.lerp(at(jy * width + ix), at(jy * width + jx), x - ix),
      y - iy,
    ) / 255
  );
}

export interface HairShell {
  readonly geometry: T.BufferGeometry;
  readonly lining: ReadonlyArray<number>;
}

export function separateHair(
  geometry: T.BufferGeometry,
  cap: HairCap,
  needShell: boolean,
): HairShell | undefined {
  const mask = unpack(cap.mask);
  const relief = unpack(cap.relief);
  const pos = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return undefined;
  const extent = box.getSize(new T.Vector3());
  const center = box.getCenter(new T.Vector3());
  const H = extent.y;
  const p = new T.Vector3();
  const n = new T.Vector3();
  const coords: number[] = [];
  const tex: number[] = [];
  const indices: number[] = [];
  const edgeLookup = new Map<number, readonly [number, number]>();
  const vertices = new Map<number, number>();
  const weights = new Float32Array(pos.count);
  const shell = new Float32Array(pos.count * 3);
  const lining: number[] = [];
  const innerPoints = new Map<number, number>();
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const weight = value(mask, u, v);
    const detail = value(relief, u, v);
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(normal, i);
    weights[i] = weight;
    const lift = H * (0.004 + 0.024 * (detail - 0.4));
    p.clone()
      .addScaledVector(n, lift)
      .toArray(shell, 3 * i);
    const band = T.MathUtils.smoothstep((p.y - box.min.y) / H, 0.28, 0.65);
    const under = Math.max(band * 0.82, T.MathUtils.smoothstep(weight, 0.04, 0.9));
    const side = p.x - center.x;
    const back = p.z - center.z;
    const above = Math.max(0, p.y - (box.min.y + H * 0.47));
    const faceFront = T.MathUtils.smoothstep(-Math.sin(u * Math.PI * 2), 0.25, 0.8) * (1 - weight);
    const inset = under * (1 - faceFront);
    pos.setXYZ(
      i,
      p.x - side * 0.205 * inset,
      p.y - above * 0.24 * inset,
      p.z - back * 0.16 * inset,
    );
  }
  const s = (i: number) => shell[i] ?? 0;
  const w = (i: number) => weights[i] ?? 0;
  const append = (x: number, y: number, z: number, u: number, v: number): number => {
    const index = coords.length / 3;
    coords.push(x, y, z);
    tex.push(u, v);
    return index;
  };
  const add = (i: number): number => {
    let index = vertices.get(i);
    if (index === undefined) {
      index = append(s(i * 3), s(i * 3 + 1), s(i * 3 + 2), uv.getX(i), uv.getY(i));
      vertices.set(i, index);
    }
    return index;
  };
  const innerVertex = (outer: number, point: T.Vector3): number => {
    const index = append(point.x, point.y, point.z, tex[outer * 2] ?? 0, tex[outer * 2 + 1] ?? 0);
    lining.push(index);
    innerPoints.set(outer, index);
    return index;
  };
  const insideOriginal = (i: number): void => {
    const a = add(i);
    if (!innerPoints.has(a)) innerVertex(a, new T.Vector3().fromBufferAttribute(pos, i));
  };
  const edge = (i: number, j: number): readonly [number, number] => {
    const key = Math.min(i, j) * pos.count + Math.max(i, j);
    const known = edgeLookup.get(key);
    if (known) return known;
    const t = (0.48 - w(i)) / (w(j) - w(i));
    const lerp = (a: number, b: number) => T.MathUtils.lerp(a, b, t);
    const top = append(
      lerp(s(i * 3), s(j * 3)),
      lerp(s(i * 3 + 1), s(j * 3 + 1)),
      lerp(s(i * 3 + 2), s(j * 3 + 2)),
      lerp(uv.getX(i), uv.getX(j)),
      lerp(uv.getY(i), uv.getY(j)),
    );
    const inner = innerVertex(
      top,
      new T.Vector3(
        lerp(pos.getX(i), pos.getX(j)),
        lerp(pos.getY(i), pos.getY(j)),
        lerp(pos.getZ(i), pos.getZ(j)),
      ),
    );
    const pair = [top, inner] as const;
    edgeLookup.set(key, pair);
    return pair;
  };
  const innerOf = (outer: number | undefined): number => {
    const inner = outer === undefined ? undefined : innerPoints.get(outer);
    if (inner === undefined) throw new Error("A hair shell vertex has no lining.");
    return inner;
  };
  const source = geometry.getIndex();
  if (needShell && source) {
    for (let k = 0; k < source.count; k += 3) {
      const poly: number[] = [];
      const cuts: { cross: readonly [number, number]; exit: boolean }[] = [];
      for (let j = 0; j < 3; j++) {
        const i = source.getX(k + j);
        const next = source.getX(k + ((j + 1) % 3));
        const inside = w(i) >= 0.48;
        if (inside) {
          poly.push(add(i));
          insideOriginal(i);
        }
        if (inside !== w(next) >= 0.48) {
          const cross = edge(i, next);
          poly.push(cross[0]);
          cuts.push({ cross, exit: inside });
        }
      }
      const first = poly[0];
      for (let j = 1; j + 1 < poly.length; j++) {
        const b = poly[j];
        const c = poly[j + 1];
        if (first === undefined || b === undefined || c === undefined) continue;
        indices.push(first, b, c, innerOf(c), innerOf(b), innerOf(first));
      }
      const [one, two] = cuts;
      if (cuts.length === 2 && one && two) {
        const [a, b] = one.exit ? [one.cross, two.cross] : [two.cross, one.cross];
        indices.push(b[0], a[0], a[1], b[0], a[1], b[1]);
      }
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (!indices.length) return undefined;
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(coords, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(tex, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return { geometry: g, lining };
}

const margins = new Map<string, Uint8Array>();

function hairMargin(key: string): Uint8Array {
  const known = margins.get(key);
  if (known) return known;
  const a = Uint8Array.from(unpack(key), (v) => (v >= 123 ? 255 : 0));
  const at = (field: Uint8Array, i: number) => field[i] ?? 0;
  for (let k = 0; k < 8; k++) {
    const prev = a.slice();
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!prev[i]) continue;
        const near = Math.min(
          at(prev, y * width + ((x + 1) % width)),
          at(prev, y * width + ((x + width - 1) % width)),
          at(prev, Math.max(0, y - 1) * width + x),
          at(prev, Math.min(height - 1, y + 1) * width + x),
        );
        a[i] = Math.min(at(prev, i), near + 32);
      }
  }
  for (let i = 0; i < a.length; i++)
    a[i] = Math.round(255 * T.MathUtils.smoothstep(at(a, i) / 255, 0, 1));
  const oldest = margins.keys().next();
  if (margins.size >= 8 && !oldest.done) margins.delete(oldest.value);
  margins.set(key, a);
  return a;
}

export function seatHair(
  hair: T.Mesh,
  lining: ReadonlyArray<number>,
  head: T.Object3D,
  rows: ReadonlyArray<Knot>,
  cap: HairCap,
): void {
  if (!lining.length) return;
  head.updateWorldMatrix(true, false);
  hair.updateWorldMatrix(true, false);
  const toHead = head.matrixWorld.clone().invert().multiply(hair.matrixWorld);
  const toHair = toHead.clone().invert();
  const p = new T.Vector3();
  const original = new T.Vector3();
  const pos = hair.geometry.getAttribute("position");
  const uv = hair.geometry.getAttribute("uv");
  const inner = new Set(lining);
  const margin = hairMargin(cap.mask);
  const last = rows.length - 1;
  const row = (i: number): Knot => {
    const knot = rows[i];
    if (!knot) throw new Error("A seated hair cap's head has no knots.");
    return knot;
  };
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(toHead);
    original.copy(p);
    const coverage = inner.has(i) ? 0 : value(margin, uv.getX(i), uv.getY(i));
    if (coverage > 0.999) continue;
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (row(mid)[1] < p.y) lo = mid;
      else hi = mid;
    }
    const a = row(lo);
    const b = row(hi);
    const t = T.MathUtils.clamp((p.y - a[1]) / (b[1] - a[1] || 1), 0, 1);
    const at = (k: 0 | 2 | 3 | 4) => T.MathUtils.lerp(a[k], b[k], t);
    const dx = p.x - at(0);
    const dz = p.z - at(2);
    const radius = Math.hypot(dx / at(3), dz / at(4));
    if (radius > 0.91) {
      p.x = at(0) + (dx * 0.91) / radius;
      p.z = at(2) + (dz * 0.91) / radius;
    }
    p.lerp(original, coverage).applyMatrix4(toHair);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  hair.geometry.computeVertexNormals();
  hair.geometry.computeBoundingBox();
  hair.geometry.computeBoundingSphere();
}

const scalps = new WeakMap<T.Texture, Map<string, T.CanvasTexture>>();

export function scalpMaterial(
  raster: Raster,
  source: T.Material,
  cap: HairCap,
  made: T.Texture[],
): T.Material {
  if (!(source instanceof T.MeshStandardMaterial) || !source.map) return source;
  const map = source.map;
  const image = drawable(map.image);
  if (!image) return source;
  let choices = scalps.get(map);
  if (!choices) {
    choices = new Map();
    scalps.set(map, choices);
  }
  let texture = choices.get(cap.mask);
  if (!texture) {
    const c = raster.canvas(image.width, image.height);
    const ctx = context2d(c, { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const im = ctx.getImageData(0, 0, c.width, c.height);
    const rgb = [1, 3, 5].map((i) => parseInt(cap.scalp.slice(i, i + 2), 16));
    const mask = unpack(cap.mask);
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = 4 * (y * c.width + x);
        const weight = T.MathUtils.smoothstep(
          value(mask, (x + 0.5) / c.width, 1 - (y + 0.5) / c.height),
          0.19,
          0.69,
        );
        for (let k = 0; k < 3; k++)
          im.data[i + k] = T.MathUtils.lerp(im.data[i + k] ?? 0, rgb[k] ?? 0, weight);
      }
    ctx.putImageData(im, 0, 0);
    texture = new T.CanvasTexture(c);
    texture.colorSpace = T.SRGBColorSpace;
    texture.wrapS = map.wrapS;
    texture.wrapT = map.wrapT;
    choices.set(cap.mask, texture);
    made.push(texture);
  }
  const m = source.clone();
  m.map = texture;
  if (m.emissiveMap) m.emissiveMap = texture;
  return m;
}
