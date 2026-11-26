import * as T from "three";
import { figureSweep, figureFinish, figurePaint, type CharacterDocument } from "@irudd/document";
import { retainRemovedPaint } from "../paint/repaint.js";
import type { BuiltCharacter, BuiltPart } from "../build.js";

export interface ArmChain {
  upper: BuiltPart;
  lower: BuiltPart;
  hand: BuiltPart;
}

export function armChains(character: BuiltCharacter): ArmChain[] {
  const parts = [...character.parts.values()];
  const role = (p: BuiltPart) => p.part.motion ?? p.part.wear.role;
  return parts.flatMap((lower) => {
    if (role(lower) !== "forearm" || !lower.part.parent) return [];
    const upper = character.parts.get(lower.part.parent);
    const hand = parts.find((p) => p.part.parent === lower.part.id && role(p) === "hand");
    return upper && hand && role(upper) === "upper arm" ? [{ upper, lower, hand }] : [];
  });
}

const pivot = (p: BuiltPart) => p.object.getWorldPosition(new T.Vector3());

export function bendElbow({ upper, lower, hand }: ArmChain, degrees: number) {
  const local = upper.mount.matrixWorld.clone().invert();
  const elbow = pivot(lower).applyMatrix4(local);
  const a = elbow.clone().sub(pivot(upper).applyMatrix4(local));
  const b = pivot(hand).applyMatrix4(local).sub(elbow);
  if (Math.min(a.length(), b.length()) < 0.001)
    throw new Error("Separate the shoulder, elbow and wrist before bending.");
  a.normalize();
  b.normalize();
  const angle = a.angleTo(b);
  const axis = a.clone().cross(b);
  if (axis.lengthSq() < 1e-6)
    axis.crossVectors(b, new T.Vector3(0, 0, 1).transformDirection(local));
  if (axis.lengthSq() < 1e-6)
    axis.crossVectors(b, Math.abs(b.x) < 0.8 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0));
  const delta =
    T.MathUtils.clamp(angle + T.MathUtils.degToRad(degrees), 0, T.MathUtils.degToRad(155)) - angle;
  const rotation = new T.Quaternion()
    .setFromAxisAngle(axis.normalize(), delta)
    .multiply(new T.Quaternion(...lower.part.rotation))
    .normalize();
  return { op: "part.set", part: lower.part.id, set: { rotation: rotation.toArray() } };
}

export function recutSleeves(
  doc: CharacterDocument,
  { upper, lower, hand }: ArmChain,
  color: string,
) {
  if (!upper.part.sweep || !lower.part.sweep)
    throw new Error("Select a swept upper arm and forearm.");
  function sleeve(p: BuiltPart, next: BuiltPart, profile: readonly (readonly [number, number])[]) {
    const end = p.object.worldToLocal(pivot(next));
    if (end.length() < 0.015)
      throw new Error("Separate the shoulder, elbow and wrist before cutting sleeves.");
    const radius = T.MathUtils.clamp(end.length() * 0.22, 0.006, 1);
    const knots = profile
      .map(([t, r]): [number, number, number, number, number] => [
        end.x * t,
        end.y * t,
        end.z * t,
        radius * r,
        radius * r * (t < 0 || t > 1 ? 1 : 0.98),
      ])
      .reverse();
    return [
      { op: "part.set", part: p.part.id, set: { color, paint: null } },
      {
        op: "feature.set",
        part: p.part.id,
        feature: figureSweep.id,
        value: figureSweep.json({ knots }),
      },
      {
        op: "feature.set",
        part: p.part.id,
        feature: figureFinish.id,
        value: figureFinish.json({ surface: "canvas" }),
      },
      ...(p.part.paint
        ? [{ op: "feature.set", part: p.part.id, feature: figurePaint.id, value: null }]
        : []),
    ];
  }
  return [
    ...sleeve(upper, lower, [
      [-0.09, 0.28],
      [0, 0.75],
      [0.16, 1.13],
      [0.42, 0.99],
      [0.66, 0.94],
      [0.85, 0.77],
      [1, 0.72],
      [1.055, 0.3],
    ]),
    ...sleeve(lower, hand, [
      [-0.09, 0.28],
      [0, 0.74],
      [0.18, 0.93],
      [0.36, 0.95],
      [0.64, 0.72],
      [0.86, 0.54],
      [1, 0.49],
      [1.055, 0.3],
    ]),
    ...(upper.part.paint || lower.part.paint
      ? [retainRemovedPaint(doc, [upper.part.id, lower.part.id])]
      : []),
  ];
}
