// Procedural coat patterns painted into vertex colours by the full and game
// presets. Ported from character-view/markings.js at 2761eb1.

import * as T from "three";
import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { FigureMarkings } from "@irudd/document";
import type { BlendOwners } from "./blend.js";

function hash(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export type MarkingField = (p: T.Vector3, n: T.Vector3) => number;

export function markingField(m: FigureMarkings): MarkingField {
  const phase = hash(1, 2, 3, m.seed) * 6.283;
  const angle = (m.angle * Math.PI) / 180;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const ease = T.MathUtils.smoothstep;
  return (p, n) => {
    const x = p.x / m.spacing;
    const y = (p.y * cos - p.z * sin) / m.spacing;
    const z = (p.z * cos + p.y * sin) / m.spacing;
    if (m.kind === "Countershade") {
      const underside = -(n.y * cos - n.z * sin) + 0.07 * Math.sin(phase + 2 * z + 0.3 * x);
      return ease(underside, 0.66 - 1.6 * m.coverage, 1.2 - 1.6 * m.coverage);
    }
    if (m.kind === "Bands") {
      const wave = Math.cos(
        Math.PI *
          2 *
          (z +
            0.16 * Math.sin(phase + 0.9 * x + 1.2 * y) +
            0.08 * Math.sin(0.74 * z - 0.8 * x + phase)),
      );
      const cutoff = Math.cos(Math.PI * m.coverage);
      return ease(wave, cutoff - 0.17, cutoff + 0.17);
    }
    if (m.kind === "Marbled") {
      const drift =
        0.67 * Math.sin(1.8 * z + 1.2 * x + phase) +
        0.26 * Math.sin(2.7 * y - 1.3 * z + 0.7 * phase);
      const vein = Math.abs(Math.sin(Math.PI * (0.65 * y + 0.3 * x + drift)));
      const width = Math.sin(0.5 * Math.PI * m.coverage);
      return 1 - ease(vein, width - 0.08, width + 0.08);
    }
    // Jittered 3D cells give neighbouring limbs the same field on their seam.
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    let distance = Infinity;
    let second = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const a = ix + dx;
          const b = iy + dy;
          const c = iz + dz;
          const cx = a + 0.18 + 0.64 * hash(a, b, c, m.seed) - x;
          const cy = b + 0.18 + 0.64 * hash(a, b, c, m.seed ^ 1543) - y;
          const cz = c + 0.18 + 0.64 * hash(a, b, c, m.seed ^ 9377) - z;
          const squared = cx * cx + cy * cy + cz * cz;
          if (squared < distance) {
            second = distance;
            distance = squared;
          } else if (squared < second) second = squared;
        }
    if (m.kind === "Reticulated") {
      const gap = Math.sqrt(second) - Math.sqrt(distance);
      const width = 0.018 + 0.4 * m.coverage;
      return 1 - ease(gap, width * 0.7, width * 1.3);
    }
    const r = Math.sqrt(distance);
    const outer = 0.26 + 0.48 * m.coverage;
    const spot = 1 - ease(r, outer - 0.07, outer + 0.05);
    return m.kind === "Spots" ? spot : spot * ease(r, outer * 0.52 - 0.04, outer * 0.63);
  };
}

function standard(mesh: T.Mesh): T.MeshStandardMaterial {
  const material: T.Material | T.Material[] = mesh.material;
  if (!(material instanceof T.MeshStandardMaterial))
    throw new Error("Markings paint a part with one standard material.");
  return material;
}

/** Paint a part's markings, refining large triangles first unless the mesh is joined. */
export function paintMarkings(mesh: T.Mesh, m: FigureMarkings, joined: boolean): void {
  mesh.updateWorldMatrix(true, false);
  let geo = mesh.geometry;
  const triangles = (geo.index?.count ?? geo.getAttribute("position").count) / 3;
  const iterations = Math.min(5, Math.floor(Math.log2(16000 / triangles)));
  if (iterations > 0 && !joined && !geo.morphAttributes["position"]) {
    // Bisect large triangles on their existing planes. Physical coordinates
    // keep narrow markings sharp even when the local axes have unequal scales.
    const world = geo.clone().applyMatrix4(mesh.matrixWorld);
    const split = new TessellateModifier(m.spacing * 0.19, iterations).modify(world);
    const refined = mergeVertices(split, 1e-6);
    refined.applyMatrix4(mesh.matrixWorld.clone().invert());
    refined.normalizeNormals();
    world.dispose();
    split.dispose();
    geo.dispose();
    mesh.geometry = geo = refined;
  }
  const mat = standard(mesh).clone();
  const pos = geo.getAttribute("position");
  const normals = geo.getAttribute("normal");
  const rgb = new Float32Array(pos.count * 3);
  const base = new T.Color();
  const previous = mat.vertexColors ? geo.getAttribute("color") : null;
  const accent = new T.Color(m.color);
  const p = new T.Vector3();
  const n = new T.Vector3();
  const normalMatrix = new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const sample = markingField(m);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix);
    if (previous) base.fromBufferAttribute(previous, i).multiply(mat.color);
    else base.copy(mat.color);
    const t = sample(p, n);
    rgb[i * 3] = T.MathUtils.lerp(base.r, accent.r, t);
    rgb[i * 3 + 1] = T.MathUtils.lerp(base.g, accent.g, t);
    rgb[i * 3 + 2] = T.MathUtils.lerp(base.b, accent.b, t);
  }
  geo.setAttribute("color", new T.Float32BufferAttribute(rgb, 3));
  mat.color.set(0xffffff);
  mat.vertexColors = true;
  mesh.material = mat;
}

/** What a joined skin paints for one owner: its undercoat, then a limb tint, then its markings. */
export interface CoatLayers {
  readonly under?: FigureMarkings | undefined;
  readonly tint?: ((color: T.Color, p: T.Vector3) => void) | undefined;
  readonly mark?: FigureMarkings | undefined;
}

/**
 * Paint a joined skin with each owner's undercoat, limb tint and markings. A
 * boundary vertex mixes its two owners with the weights the skin uses for joints.
 */
export function paintJoinedCoat(
  mesh: T.Mesh,
  owners: BlendOwners,
  layersOf: (id: string) => CoatLayers,
): void {
  const layer = (m: FigureMarkings | undefined) =>
    m && { sample: markingField(m), color: new T.Color(m.color) };
  const layers = owners.ids.map((id) => {
    const { under, tint, mark } = layersOf(id);
    return { under: layer(under), tint, mark: layer(mark) };
  });
  if (!layers.some((l) => l.under || l.tint || l.mark)) return;
  mesh.updateWorldMatrix(true, false);
  const geo = mesh.geometry;
  const material = standard(mesh).clone();
  const pos = geo.getAttribute("position");
  const normals = geo.getAttribute("normal");
  const prior = material.vertexColors ? geo.getAttribute("color") : undefined;
  const colors = new Float32Array(pos.count * 3);
  const p = new T.Vector3();
  const n = new T.Vector3();
  const base = new T.Color();
  const a = new T.Color();
  const b = new T.Color();
  const normalMatrix = new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const coat = (color: T.Color, index: number) => {
    color.copy(base);
    const owner = layers[index];
    if (owner?.under) color.lerp(owner.under.color, owner.under.sample(p, n));
    if (owner?.tint) owner.tint(color, p);
    if (owner?.mark) color.lerp(owner.mark.color, owner.mark.sample(p, n));
  };
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix);
    base.copy(material.color);
    if (prior) base.multiply(b.fromBufferAttribute(prior, i));
    const first = owners.first[i] ?? 0;
    const second = owners.second[i] ?? 0;
    const weight = owners.weight[i] ?? 1;
    coat(a, first);
    if (weight < 1 && first !== second) {
      coat(b, second);
      a.lerp(b, 1 - weight);
    }
    a.toArray(colors, i * 3);
  }
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  material.color.set(0xffffff);
  material.vertexColors = true;
  mesh.material = material;
}
