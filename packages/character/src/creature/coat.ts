// A creature plan's coat: one pigment field along the spine that the welded
// trunk and its separate limbs share. Ported from
// character-view/creature-coat.js at 2761eb1.

import * as T from "three";
import type { CreatureCoat, CreaturePlan } from "@irudd/document";
import type { BuildPart } from "../view.js";
import type { MarkingField } from "../surfaces/markings.js";
import type { LimbTint } from "./limb-colour.js";

const { clamp, smoothstep: edge } = T.MathUtils;

const limbRoles: ReadonlySet<string> = new Set([
  "forearm",
  "upper arm",
  "thigh",
  "shin",
  "hand",
  "foot",
]);

export interface CoatField extends CreatureCoat {
  readonly surface: CreaturePlan["skin"]["surface"];
  readonly motifSize: number;
  sample(out: T.Color, base: T.Color, p: T.Vector3, n: T.Vector3, part: BuildPart): T.Color;
}

interface Segment {
  readonly a: T.Vector3;
  readonly dir: T.Vector3;
  readonly len: number;
  readonly at: number;
}

/** The spine organ of a creature, its knots and its built object. */
export function spineOf(
  parts: ReadonlyArray<BuildPart>,
  objectOf: (id: string) => T.Object3D | undefined,
): { readonly part: BuildPart; readonly object: T.Object3D | undefined } | undefined {
  const part = parts.find((p) => p.organ.rank === "spine");
  return part && { part, object: objectOf(part.id) };
}

/**
 * The coat's coordinates follow the spine, with tangent extension beyond
 * its ends, so separate limbs and the welded trunk see the same pigment.
 */
export function creatureCoatField(
  plan: CreaturePlan,
  parts: ReadonlyArray<BuildPart>,
  objectOf: (id: string) => T.Object3D | undefined,
): CoatField | undefined {
  const skin = plan.skin;
  const coat = skin.coat;
  const spine = spineOf(parts, objectOf);
  const knotList = spine?.part.sweep?.knots;
  const root = spine?.object;
  if (!coat || !knotList?.length || !root) return undefined;
  root.updateWorldMatrix(true, false);
  const knots = knotList.map((k) => ({
    p: new T.Vector3(k[0], k[1], k[2]).applyMatrix4(root.matrixWorld),
    ry: k[4],
  }));
  const segments: Segment[] = [];
  let length = 0;
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1];
    const b = knots[i];
    if (!a || !b) continue;
    const v = b.p.clone().sub(a.p);
    const len = v.length();
    if (len < 1e-6) continue;
    segments.push({ a: a.p, dir: v.divideScalar(len), len, at: length });
    length += len;
  }
  if (!segments.length) return undefined;
  const radius = Math.max(...knots.map((k) => k.ry));
  const p0 = new T.Vector3();
  const d = new T.Vector3();
  const yaw = (coat.seed % 104729) * 0.0157;
  const phase = yaw % 6.283;
  const density = coat.density;
  const light = new T.Color(skin.pale);
  const dark = new T.Color(skin.base).multiplyScalar(0.21);
  const accent = new T.Color(skin.accent);
  const ink = new T.Color(skin.base).lerp(accent, 0.29).multiplyScalar(0.37);
  const eyes = parts.flatMap((p) => {
    if (!p.organ.eye) return [];
    const o = objectOf(p.id);
    return o ? [{ at: o.getWorldPosition(new T.Vector3()), r: Math.max(...p.size) }] : [];
  });
  const height = root.matrixWorld.elements[13] ?? 0;
  return {
    ...coat,
    surface: skin.surface,
    motifSize: clamp(length * 0.045, 0.026, 0.077) / density,
    sample(out, base, p, n, part) {
      let near = Infinity;
      let t = 0;
      let vertical = 0;
      let up = 0;
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (!s) continue;
        d.subVectors(p, s.a);
        let travel = d.dot(s.dir);
        if (i > 0) travel = Math.max(0, travel);
        if (i + 1 < segments.length) travel = Math.min(s.len, travel);
        p0.copy(s.a).addScaledVector(s.dir, travel);
        const dy = p.y - p0.y;
        const dz = p.z - p0.z;
        const q = dy * dy + dz * dz;
        if (q < near) {
          near = q;
          t = (s.at + travel) / length;
          vertical = (dy * s.dir.z - dz * s.dir.y) / radius;
          up = n.y * s.dir.z - n.z * s.dir.y;
        }
      }
      const flank = Math.abs(p.x) / Math.max(0.035, radius);
      const y = vertical;
      const flow =
        t * 5.1 * density + 0.16 * Math.sin(t * 12 + phase) + 0.08 * Math.sin(y * 3.3 + phase);
      const belly = 1 - edge(y * 0.48 + up * 0.38 + Math.min(0.12, flank * 0.03), -0.68, 0.11);
      const distal = 1 - edge(p.y / Math.max(0.1, height + radius), 0.11, 0.57);
      out.copy(base);
      const c = coat.contrast;
      // The species' original light/dark field stays visible. Add one recognisable
      // signal track that follows the flank and sweeps up towards the collar.
      // Limbs retain their primary colour instead of acquiring a full-body print.
      const zone = part.coatZone ?? "body";
      const head = part.motion === "head";
      const limb = zone === "end" || limbRoles.has(part.motion ?? "");
      const existing = Boolean(skin.markings);
      const accentBudget = existing ? (coat.graded ? 0.64 : 0.34) : 0.85;
      const motif =
        coat.family === "wet skin"
          ? 0.14 * Math.sin(t * 14 + phase)
          : coat.family === "pelt"
            ? 0.09 * Math.sin(t * 9 + phase)
            : 0.12 * Math.sin(t * 6 + phase);
      const line = 0.17 + 0.43 * edge(t, 0.51, 0.96) + motif;
      const flankSide = edge(flank, 0.28, 0.67);
      const trace = Math.abs(y - line);
      const outer = (1 - edge(trace, 0.11, 0.22)) * flankSide;
      const core = (1 - edge(trace, 0.058, 0.14)) * flankSide;
      if (!limb) {
        const shoulder = edge(t, 0.46, 0.65) * (1 - edge(t, 1.06, 1.29));
        const rear = edge(t, -0.36, -0.15) * (1 - edge(t, 0.43, 0.63));
        // Large colour fields describe the animal at figure distance.
        if (coat.graded) {
          const ridge = y * 0.66 + up * 0.34;
          const mantle = edge(ridge + 0.1 * Math.sin(flow + phase), -0.08, 0.83);
          const throat = edge(-ridge, -0.12, 0.83) * (0.35 + 0.65 * edge(t, 0.38, 0.94));
          if (coat.family === "plumage") {
            const bib = throat * edge(t, 0.47, 0.96);
            out
              .lerp(ink, mantle * 0.36 * c)
              .lerp(accent, bib * 0.62 * c)
              .lerp(light, throat * (1 - bib) * 0.39 * c);
          } else if (coat.family === "wet skin") {
            out.lerp(dark, mantle * 0.52 * c).lerp(light, throat * 0.62 * c);
          } else if (coat.family === "pelt") {
            const saddle = mantle * (0.23 + 0.77 * (1 - edge(t, 0.45, 1.02)));
            out.lerp(ink, saddle * 0.61 * c).lerp(light, throat * 0.54 * c);
          } else {
            const crown = mantle * (0.28 + 0.72 * shoulder);
            out.lerp(accent, crown * 0.49 * c).lerp(dark, mantle * (1 - shoulder) * 0.29 * c);
            out.lerp(light, throat * 0.47 * c);
          }
        }
        const duty =
          coat.family === "plumage"
            ? 0.67 + 0.33 * edge(Math.sin(flow * 3.1 + phase), -0.35, 0.2)
            : coat.family === "scutes"
              ? 0.79 + 0.21 * edge(Math.sin(flow * 2.1 + phase), -0.6, -0.1)
              : 1;
        const track = (0.36 + 0.48 * shoulder + 0.18 * rear) * duty * c * accentBudget;
        out.lerp(light, outer * track * 0.61).lerp(accent, core * track);
        // A mantle has its largest distinct value shape on the shoulders and back.
        if (!existing && !head) {
          const cap = edge(y * 0.8 + up * 0.25, 0.26, 0.8) * (0.55 + 0.45 * shoulder);
          const edgeTint =
            edge(y * 0.8 + up * 0.25, 0.27, 0.4) * (1 - edge(y * 0.8 + up * 0.25, 0.44, 0.59));
          out.lerp(accent, cap * 0.49 * c).lerp(light, edgeTint * 0.18 * c);
        }
      } else {
        const end = distal * skin.socks;
        if (!skin.limbFade) out.lerp(dark, 0.32 * end);
        out.lerp(light, belly * 0.05 * (1 - end));
      }
      for (const eye of eyes) {
        const dx = p.x - eye.at.x;
        const dy = (p.y - eye.at.y) * 1.3;
        const dz = (p.z - eye.at.z) * 0.65;
        const q = Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(0.015, eye.r);
        if (q < 0.87) {
          out.lerp(light, (1 - edge(q, 0.67, 0.87)) * 0.77 * c);
          out.lerp(ink, (1 - edge(q, 0.49, 0.65)) * 0.78 * c);
        }
      }
      return out;
    },
  };
}

function standard(mesh: T.Mesh): T.MeshStandardMaterial {
  const material: T.Material | T.Material[] = mesh.material;
  if (!(material instanceof T.MeshStandardMaterial))
    throw new Error("A creature's coat paints a part with one standard material.");
  return material;
}

/**
 * Paint the coat into a coated part outside the hide, with its undercoat
 * beneath and its markings over it. False when the part takes no coat.
 */
export function applyCreatureCoat(
  mesh: T.Mesh,
  part: BuildPart,
  field: CoatField,
  extraMark: MarkingField | undefined,
  underMark: MarkingField | undefined,
  limbTint: LimbTint | undefined,
): boolean {
  if (!part.coatZone || part.paint || part.finish !== field.surface) return false;
  mesh.updateWorldMatrix(true, false);
  const geom = mesh.geometry;
  const pos = geom.getAttribute("position");
  const normals = geom.getAttribute("normal");
  // A coat swatch would also chart the organ; no frozen form paints one outside the hide.
  if (part.organ.coatSwatch)
    throw new Error(`Part ${part.id} would take a coat swatch, which is not ported.`);
  const material = standard(mesh).clone();
  const rgb = new Float32Array(pos.count * 3);
  const p = new T.Vector3();
  const n = new T.Vector3();
  const nm = new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const c = new T.Color();
  const base = new T.Color(part.color);
  const under = underMark && part.undercoat ? new T.Color(part.undercoat.color) : undefined;
  const source = new T.Color();
  const mark = extraMark && part.markings ? new T.Color(part.markings.color) : undefined;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(normals, i).applyNormalMatrix(nm);
    source.copy(base);
    if (under && underMark) source.lerp(under, underMark(p, n));
    field.sample(c, source, p, n, part);
    if (limbTint) limbTint(c, p);
    if (mark && extraMark) c.lerp(mark, extraMark(p, n) * 0.985);
    c.toArray(rgb, i * 3);
  }
  geom.setAttribute("color", new T.Float32BufferAttribute(rgb, 3));
  material.color.set(0xffffff);
  material.vertexColors = true;
  material.roughness = field.family === "wet skin" ? 0.56 : field.family === "scutes" ? 0.73 : 0.91;
  mesh.material = material;
  return true;
}
