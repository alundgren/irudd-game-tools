// A creature plan's face marking, painted in the head's own skull
// coordinates so both sides agree. Ported from
// character-view/creature-face-coat.js at 2761eb1.

import * as T from "three";
import type { CreaturePlan } from "@irudd/document";
import type { BuildPart } from "../view.js";

const { smoothstep } = T.MathUtils;
const edge = (distance: number, width: number, feather = 0.055): number =>
  1 - smoothstep(distance, width - feather, width + feather);

export interface FaceCoat {
  /** Paint at a point in the head's frame, `share` of the way to the marking. */
  local(color: T.Color, x: number, y: number, z: number, share?: number): T.Color;
  /** Paint at a world point. */
  world(color: T.Color, x: number, y: number, z: number, share: number): T.Color;
}

/** The face marking of a head organ, or none. The hide between the marks stays visible. */
export function faceCoat(
  part: BuildPart,
  object: T.Object3D | undefined,
  plan: CreaturePlan,
): FaceCoat | undefined {
  const style = plan.skin.faceMarking;
  if (!style || part.organ.rank !== "head" || !object) return undefined;
  const { eyePlace } = plan.head;
  const azimuth = eyePlace === "side" ? 1.25 : eyePlace === "top" ? 0.42 : 0.5;
  const elevation = eyePlace === "side" ? 0.26 : eyePlace === "top" ? 0.98 : 0.36;
  const base = new T.Color(part.color);
  const accent = new T.Color(plan.skin.accent).lerp(base, 0.13);
  const pale = new T.Color(plan.skin.pale).lerp(base, 0.16);
  const shadow = base.clone().lerp(accent, 0.13).multiplyScalar(0.28);
  const ink = new T.Color();
  object.updateWorldMatrix(true, false);
  const e = object.matrixWorld.clone().invert().elements;
  const paint = (color: T.Color, x: number, y: number, z: number, share = 1): T.Color => {
    const angle = Math.abs(Math.atan2(x, z));
    const height = Math.atan2(y, Math.hypot(x, z));
    const a = angle - azimuth;
    const h = height - elevation;
    // Break up the edge in short, paired strokes, like hairs rooted along one contour.
    const fringe =
      0.015 * Math.sin(39 * angle + 9 * height) + 0.01 * Math.sin(67 * angle - 6 * height);
    let dark = 0;
    let light = 0;
    let bright = 0;
    if (style === "Eye stripe") {
      const width = 0.2 * (1 - smoothstep(a, 0.15, 1.18));
      const active = smoothstep(a, -0.72, -0.38) * (1 - smoothstep(a, 0.92, 1.15));
      const line = h - 0.15 * a + 0.13 * Math.sin(2.3 * a);
      dark = active * edge(Math.abs(line) + fringe, width);
      light = active * edge(Math.abs(line - width - 0.055) + fringe, 0.075) * 0.9;
    } else if (style === "Facial disc") {
      const d = Math.hypot(a / 0.63, (h + 0.11) / 0.61);
      dark = edge(d + fringe, 1.04);
      light = edge(d + fringe, 0.91) * 0.92;
      bright = edge(d, 0.46) * 0.64;
    } else if (style === "Cheek flashes") {
      const q = (a - 0.15) / 0.72;
      const along = 1 - smoothstep(Math.abs(q), 0.7, 1);
      const line = h + 0.39 + 0.1 * Math.cos(2.2 * q) - 0.22 * q;
      bright = along * edge(Math.abs(line) + fringe, 0.13);
      dark = along * edge(Math.abs(line + 0.2) + fringe, 0.055);
      light = along * edge(Math.abs(line - 0.18) + fringe, 0.045);
    } else if (style === "Forehead blaze") {
      const t = smoothstep(height, -0.48, 0.93);
      const width = 0.1 + 0.19 * t + 0.11 * Math.exp(-((height - 0.61) ** 2) / 0.035);
      const fade = smoothstep(height, -0.56, -0.33) * (1 - smoothstep(height, 1.17, 1.42));
      dark = edge(angle + fringe, width + 0.075) * fade;
      light = edge(angle + fringe, width) * fade;
      bright = fade * edge(angle, width * 0.55) * smoothstep(height, 0.32, 0.67);
    }
    ink
      .copy(color)
      .lerp(shadow, 0.9 * dark)
      .lerp(pale, 0.9 * light)
      .lerp(accent, 0.91 * bright);
    return color.lerp(ink, share);
  };
  const m = (i: number): number => e[i] ?? 0;
  return {
    local: paint,
    world: (color, x, y, z, share) =>
      paint(
        color,
        m(0) * x + m(4) * y + m(8) * z + m(12),
        m(1) * x + m(5) * y + m(9) * z + m(13),
        m(2) * x + m(6) * y + m(10) * z + m(14),
        share,
      ),
  };
}

function standard(mesh: T.Mesh): T.MeshStandardMaterial {
  const material: T.Material | T.Material[] = mesh.material;
  if (!(material instanceof T.MeshStandardMaterial))
    throw new Error("A creature's coat paints a part with one standard material.");
  return material;
}

/** Paint the face marking into a head's vertex colours when the hide does not carry it. */
export function paintFaceCoatVertices(mesh: T.Mesh, part: BuildPart, plan: CreaturePlan): void {
  if (part.paint || part.volume || part.finish !== plan.skin.surface) return;
  const coat = faceCoat(part, mesh, plan);
  if (!coat) return;
  const material = standard(mesh).clone();
  const geometry = mesh.geometry;
  const prior = material.vertexColors ? geometry.getAttribute("color") : undefined;
  const p = geometry.getAttribute("position");
  const rgb = new Float32Array(3 * p.count);
  const color = new T.Color();
  for (let i = 0; i < p.count; i++) {
    color.copy(material.color);
    if (prior) {
      color.r *= prior.getX(i);
      color.g *= prior.getY(i);
      color.b *= prior.getZ(i);
    }
    coat.local(color, p.getX(i), p.getY(i), p.getZ(i)).toArray(rgb, 3 * i);
  }
  geometry.setAttribute("color", new T.Float32BufferAttribute(rgb, 3));
  material.color.setHex(0xffffff);
  material.vertexColors = true;
  mesh.material = material;
}
