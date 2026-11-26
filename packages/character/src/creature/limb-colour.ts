// Pigment that follows the anatomy of a creature's limbs. Ported from
// character-view/creature-limb-colour.js at 2761eb1.
//
// Its length is measured along the linked thigh, shin and foot (or upper
// arm, forearm and hand), so the layers run on over each welded seam.
//   A fleshy limb is paler on its inner face, creased darker at the joint and
//   a little darker towards the foot, most on a hoofed leg.
//   A bird leg is bare below the joint: the shank and foot take a horn colour.
//   An arthropod leg has a pale membrane at each joint, a darker far segment
//   and a dark tip.
// `socks` with `limbFade` still fades the whole limb to its dark end. `socks`
// alone colours the far parts in the plan, so no darker end is added here.

import * as T from "three";
import type { CreaturePlan } from "@irudd/document";
import type { BuildPart } from "../view.js";

const { smoothstep, clamp } = T.MathUtils;

/** Tint a colour at a world point. */
export type LimbTint = (color: T.Color, p: T.Vector3) => void;

interface Segment {
  readonly a: T.Vector3;
  readonly dir: T.Vector3;
  readonly size: number;
  readonly offset: number;
}

export function limbPigments(
  plan: CreaturePlan,
  parts: ReadonlyArray<BuildPart>,
  objectOf: (id: string) => T.Object3D | undefined,
): Map<string, LimbTint> {
  const skin = plan.skin;
  const result = new Map<string, LimbTint>();
  const byId = new Map(parts.map((p) => [p.id, p]));
  for (const first of parts) {
    const chain = first.limbChain;
    if (!chain) continue;
    const objects = chain.chain.map(objectOf);
    if (!objects[0] || !objects[1]) continue;
    const { arm } = chain;
    const inward = chain.side === "left" ? -1 : 1;
    const limb = chain.limb === undefined ? undefined : plan.limbs[chain.limb];
    const points = objects.flatMap((o) => (o ? [o.getWorldPosition(new T.Vector3())] : []));
    const segments: Segment[] = [];
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (!a || !b) continue;
      const dir = new T.Vector3().subVectors(b, a);
      const size = dir.length();
      if (size <= 1e-5) continue;
      segments.push({ a, dir: dir.divideScalar(size), size, offset: length });
      length += size;
    }
    const firstSegment = segments[0];
    if (!length || !firstSegment) continue;
    // A limb with no foot of its own ends a segment's length below its joint.
    if (segments.length === 1) length *= 2;
    const joint = firstSegment.size / length;
    const leg = !arm && limb?.kind === "leg" ? limb : undefined;
    const hoofed = leg?.end === "hoof";
    const family =
      arm || !limb || hoofed
        ? "fleshy"
        : leg?.style === "insect"
          ? "arthropod"
          : leg?.style === "bird"
            ? "bird"
            : "fleshy";
    const fade = skin.limbFade && skin.socks ? skin.socks : 0;
    const base = new T.Color(skin.base);
    const delta = new T.Vector3();
    const shade = base.clone().multiplyScalar(0.26);
    const white = new T.Color("#ffffff");
    const dark = new T.Color();
    const bell = (x: number, wide: number): number => Math.exp(-((x / wide) ** 2));
    const tint: LimbTint = (color, p) => {
      let at = 0;
      let inner = 0;
      let closest = Infinity;
      for (const s of segments) {
        delta.subVectors(p, s.a);
        const t = clamp(delta.dot(s.dir), 0, s.size);
        const distance = delta.addScaledVector(s.dir, -t).lengthSq();
        if (distance < closest) {
          closest = distance;
          at = (s.offset + t) / length;
          inner = distance > 1e-10 ? (delta.x * inward) / Math.sqrt(distance) : 0;
        }
      }
      const crease = bell(at - joint, 0.03);
      const far = smoothstep(at, joint - 0.05, joint + 0.07);
      if (family === "arthropod") {
        // The far segment is darker, the membrane of the joint pale, the tip nearly black.
        color.lerp(dark.copy(color).multiplyScalar(0.62), 0.75 * far);
        color.lerp(dark.copy(color).lerp(white, 0.5), 0.6 * bell(at - joint, 0.022));
        color.multiplyScalar(1 - 0.62 * smoothstep(at, 0.86, 0.98));
      } else if (family === "bird") {
        // Bare horn: darker and greyer than the feathered or furred thigh.
        const grey = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
        color.lerp(dark.setScalar(grey), 0.3 * far).multiplyScalar(1 - 0.36 * far);
        color.multiplyScalar(1 - 0.14 * bell(at - joint, 0.02));
      } else {
        color.lerp(
          dark.copy(color).lerp(white, 0.4),
          0.55 * skin.belly * smoothstep(inner, 0.15, 0.9) * (1 - 0.6 * smoothstep(at, 0.6, 1)),
        );
        color.multiplyScalar(1 - 0.24 * crease);
        if (!skin.socks)
          color.lerp(
            dark.copy(color).multiplyScalar(0.5),
            (hoofed ? 0.62 : 0.36) * smoothstep(at, hoofed ? 0.56 : 0.5, 0.96),
          );
      }
      // Keep the body's native palette above the joint, arrive at the lower
      // limb's darker colour before the foot, and keep the bottom readable.
      if (fade) color.lerp(shade, fade * 0.83 * smoothstep(at, 0.34, 0.97));
    };
    for (const id of chain.tinted) if (!byId.get(id)?.paint) result.set(id, tint);
  }
  return result;
}

function standard(mesh: T.Mesh): T.MeshStandardMaterial {
  const material: T.Material | T.Material[] = mesh.material;
  if (!(material instanceof T.MeshStandardMaterial))
    throw new Error("Limb pigment paints a part with one standard material.");
  return material;
}

export function paintLimbPigment(mesh: T.Mesh, tint: LimbTint | undefined): void {
  if (!tint) return;
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry;
  const pos = geometry.getAttribute("position");
  const material = standard(mesh).clone();
  const old = material.vertexColors ? geometry.getAttribute("color") : undefined;
  const p = new T.Vector3();
  const c = new T.Color();
  const prior = new T.Color();
  const rgb = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    c.copy(material.color);
    if (old) c.multiply(prior.fromBufferAttribute(old, i));
    tint(c, p);
    c.toArray(rgb, i * 3);
  }
  geometry.setAttribute("color", new T.Float32BufferAttribute(rgb, 3));
  material.color.set(0xffffff);
  material.vertexColors = true;
  mesh.material = material;
}
