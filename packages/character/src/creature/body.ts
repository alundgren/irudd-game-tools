import type { BaseSlotInput, CreatureLimb, CreaturePlan, Vec3 } from "@irudd/document";
import { buildCreature, readCreaturePlan, spineFrame } from "./plan/plan.js";
import { formSlots } from "./plan/slots.js";
import type { Spine } from "./plan/types.js";

const frames = new WeakMap<CreaturePlan, Spine>();
const triple = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];

export function bodyStation(p: CreaturePlan, t: number) {
  let frame = frames.get(p);
  if (!frame) {
    frame = spineFrame(readCreaturePlan(p));
    frames.set(p, frame);
  }
  const s = frame.at(t);
  return {
    point: triple(s.centre),
    dorsal: triple(s.dorsal),
    tangent: triple(s.tangent),
    width: s.radius[0],
    depth: s.radius[1],
    pitch: s.pitch,
  };
}

const limbOffsets = {
  leg: [0.68, 0],
  arm: [0.86, 0],
  wing: [0.5, 0.62],
  fin: [0.9, 0],
  tentacle: [0.82, 0],
} as const;
export function limbSocket(
  p: CreaturePlan,
  kind: CreatureLimb["kind"],
  t: number,
  side: number,
): Vec3 {
  const s = bodyStation(p, t),
    [across, back] = limbOffsets[kind];
  const drop = kind === "leg" ? -s.depth * 0.3 * Math.abs(Math.cos(s.pitch)) : 0;
  return [
    s.point[0] + side * s.width * across + s.dorsal[0] * s.depth * back,
    s.point[1] + drop + s.dorsal[1] * s.depth * back,
    s.point[2] + s.dorsal[2] * s.depth * back,
  ];
}

export function creatureSlots(p: CreaturePlan): BaseSlotInput[] {
  return formSlots(buildCreature(p));
}
