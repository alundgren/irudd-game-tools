import { Schema } from "effect";
import { defineGenerator } from "../registry.js";
import { quatFromAxisAngle, rotate, add, scale, type Vec3 } from "../geometry.js";
import { Color, type BaseSlotInput } from "../schema.js";

const range = (minimum: number, maximum: number) =>
  Schema.Finite.check(Schema.isBetween({ minimum, maximum }));

export const FrameCreatureParams = Schema.Struct({
  scale: range(0.2, 4),
  trunk: Schema.Struct({
    length: range(0.2, 3),
    girth: range(0.05, 1),
    shape: Schema.Literals(["ellipsoid", "box", "capsule"]),
  }),
  neck: Schema.Struct({ length: range(0, 1.5), pitch: range(-80, 80) }),
  head: Schema.Struct({ size: range(0.05, 1) }),
  legs: Schema.Struct({
    pairs: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
    length: range(0.05, 2),
  }),
  tail: Schema.Struct({ length: range(0, 3) }),
  color: Color,
});
export type FrameCreatureParams = typeof FrameCreatureParams.Type;

const degrees = (d: number) => (d * Math.PI) / 180;
const xAxis: Vec3 = [1, 0, 0];

export function frameCreatureSlots(p: FrameCreatureParams): BaseSlotInput[] {
  const s = p.scale;
  const g = p.trunk.girth;
  const L = p.trunk.length;
  const slots: BaseSlotInput[] = [];
  const slot = (value: BaseSlotInput) => {
    slots.push(value);
  };
  const level = quatFromAxisAngle(xAxis, 0);
  slot({
    slot: "trunk",
    parent: null,
    label: "Body",
    shape: p.trunk.shape,
    position: [0, (p.legs.length + g) * s, 0],
    rotation: level,
    size: [2 * g * s, 2 * g * s, L * s],
    color: p.color,
  });

  const pitch = quatFromAxisAngle(xAxis, -degrees(p.neck.pitch));
  const shoulder: Vec3 = [0, 0.5 * g * s, 0.5 * L * s];
  let headParent = "trunk";
  let headPosition: Vec3 = add(shoulder, [0, 0, p.head.size * 0.5 * s]);
  let headRotation = level;
  if (p.neck.length > 0) {
    const n = p.neck.length * s;
    slot({
      slot: "neck",
      parent: "trunk",
      label: "Neck",
      shape: "capsule",
      position: add(shoulder, rotate(pitch, [0, 0, n / 2])),
      rotation: pitch,
      size: [0.6 * g * s, 0.6 * g * s, n],
      color: p.color,
    });
    headParent = "neck";
    headPosition = [0, 0, n / 2 + p.head.size * 0.5 * s];
    headRotation = quatFromAxisAngle(xAxis, degrees(p.neck.pitch));
  }
  slot({
    slot: "head",
    parent: headParent,
    label: "Head",
    shape: "ellipsoid",
    position: headPosition,
    rotation: headRotation,
    size: [p.head.size * s, p.head.size * s, 1.2 * p.head.size * s],
    color: p.color,
  });

  for (let i = 0; i < p.legs.pairs; i++) {
    const t = p.legs.pairs === 1 ? 0 : 0.35 - (0.7 * i) / (p.legs.pairs - 1);
    for (const [side, x, name] of [
      ["l", 1, "left"],
      ["r", -1, "right"],
    ] as const)
      slot({
        slot: `leg.${i}.${side}`,
        parent: "trunk",
        label: `Leg ${i + 1} ${name}`,
        shape: "capsule",
        position: scale([x * 0.8 * g, -(0.5 * g + 0.5 * p.legs.length), t * L], s),
        rotation: level,
        size: [0.35 * g * s, p.legs.length * s, 0.35 * g * s],
        color: p.color,
      });
  }

  if (p.tail.length > 0)
    slot({
      slot: "tail",
      parent: "trunk",
      label: "Tail",
      shape: "capsule",
      position: scale([0, 0.2 * g, -0.5 * L - 0.5 * p.tail.length], s),
      rotation: level,
      size: [0.3 * g * s, 0.3 * g * s, p.tail.length * s],
      color: p.color,
    });
  return slots;
}

export const frameCreature = defineGenerator({
  id: "irudd.frame-creature",
  version: 1,
  label: "Frame creature (protocol reference generator)",
  schema: FrameCreatureParams,
  toJson: (p) => p,
  generate: frameCreatureSlots,
});

export const defaultFrameCreatureParams: FrameCreatureParams = {
  scale: 1,
  trunk: { length: 0.9, girth: 0.2, shape: "ellipsoid" },
  neck: { length: 0.28, pitch: 45 },
  head: { size: 0.22 },
  legs: { pairs: 2, length: 0.45 },
  tail: { length: 0.5 },
  color: "#5f7a58",
};
