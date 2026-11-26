import * as T from "three";
import { figureAssembly, figureHand, motionRole, quatNormalize, type Part } from "@irudd/document";
import type { BuiltCharacter, BuiltPart } from "../build.js";
import { partBounds } from "../garments.js";

function wristRotation(direction: T.Vector3, medial: T.Vector3) {
  const up = direction.clone().normalize().negate();
  const palm = medial.clone().addScaledVector(up, -medial.dot(up));
  if (palm.lengthSq() < 1e-8) {
    const axis = Math.abs(up.z) < 0.8 ? new T.Vector3(0, 0, -1) : new T.Vector3(0, 1, 0);
    palm.copy(axis).addScaledVector(up, -axis.dot(up));
  }
  palm.normalize();
  return new T.Quaternion().setFromRotationMatrix(
    new T.Matrix4().makeBasis(new T.Vector3().crossVectors(up, palm), up, palm),
  );
}

export function fitSweptHand(built: BuiltCharacter, source: Part) {
  const entry = built.parts.get(source.id);
  if (!entry?.part.sweep || entry.part.wear.role !== "hand")
    throw new Error("Select a swept hand.");
  built.group.updateWorldMatrix(true, true);
  const parent = source.parent && built.parts.get(source.parent);
  const frame = parent ? parent.mount.matrixWorld : new T.Matrix4(),
    inverse = frame.clone().invert();
  function ends(node: BuiltPart) {
    const knots = node.part.sweep?.knots,
      first = knots?.[0],
      last = knots?.at(-1);
    if (!first || !last) throw new Error("Missing hand or forearm sections.");
    const point = (k: typeof first) =>
      new T.Vector3(k[0], k[1], k[2]).applyMatrix4(node.object.matrixWorld).applyMatrix4(inverse);
    return [point(first), point(last)] as const;
  }
  const [a, b] = ends(entry);
  const centre = parent
    ? partBounds(parent.object).getCenter(new T.Vector3()).applyMatrix4(inverse)
    : undefined;
  const reverse = centre ? a.distanceToSquared(centre) > b.distanceToSquared(centre) : a.y < b.y;
  const wrist = reverse ? b : a,
    tip = reverse ? a : b,
    towards = tip.clone().sub(wrist);
  const side = wrist.clone().applyMatrix4(frame).x >= 0 ? 1 : -1;
  const height = entry.part.paint?.trace.height ?? Math.max(0.1, towards.length() * 10),
    span = T.MathUtils.clamp(towards.length() * 1.08, 0.076 * height, 0.125 * height);
  if (parent && parent.part.sweep && parent.part.wear.role === "forearm") {
    const [p, q] = ends(parent),
      distal = p.distanceToSquared(wrist) < q.distanceToSquared(wrist) ? p : q;
    towards
      .copy(distal)
      .sub(distal === p ? q : p)
      .normalize();
    wrist.copy(distal).addScaledVector(towards, -0.02 * span);
  }
  const rotation = wristRotation(
    towards,
    new T.Vector3(-side, 0, -0.42).transformDirection(inverse),
  );
  const size = [span * 0.46, span, span * 0.225] as const;
  const mount = frame
    .clone()
    .multiply(new T.Matrix4().compose(wrist, rotation, new T.Vector3(1, 1, 1)))
    .invert();
  const children = [...built.parts.values()]
    .filter((q) => q.part.parent === source.id)
    .map((q) => {
      const position = new T.Vector3(),
        turn = new T.Quaternion(),
        scale = new T.Vector3();
      mount.clone().multiply(q.object.matrixWorld).decompose(position, turn, scale);
      return {
        op: "part.set",
        part: q.part.id,
        set: {
          position: position.toArray(),
          rotation: quatNormalize(turn.toArray()),
          size: scale.toArray(),
        },
      };
    });
  const set = (feature: string, value: Part["features"][string] | null) => ({
    op: "feature.set",
    part: source.id,
    feature,
    value,
  });
  return [
    ...Object.keys(source.features)
      .filter((id) => id.startsWith("figure.") || id === "creature.blend")
      .map((id) => set(id, null)),
    {
      op: "part.set",
      part: source.id,
      set: {
        shape: "ellipsoid",
        size,
        position: wrist.toArray(),
        rotation: quatNormalize(rotation.toArray()),
        paint: null,
      },
    },
    set(figureAssembly.id, figureAssembly.json({ order: entry.part.order ?? 0, frameSize: size })),
    set(
      figureHand.id,
      figureHand.json({
        fingers: 4,
        side: side === 1 ? -1 : 1,
        relaxed: true,
        curl: 0.32,
        spread: 0.18,
      }),
    ),
    set(motionRole.id, motionRole.json({ role: "hand" })),
    ...children,
  ];
}
