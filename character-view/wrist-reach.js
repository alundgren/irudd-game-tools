import { MathUtils, Quaternion, Vector3 } from "three";
import { armChain } from "./graft.js";

const at = (bone) => bone.getWorldPosition(new Vector3());
const orientation = (bone) => bone.getWorldQuaternion(new Quaternion());
function setWorldRotation(bone, rotation) {
  bone.quaternion.copy(orientation(bone.parent).invert().multiply(rotation));
  bone.updateWorldMatrix(false, true);
}
function aim(bone, end, toward) {
  const origin = at(bone);
  const turn = new Quaternion().setFromUnitVectors(
    at(end).sub(origin).normalize(),
    toward.clone().sub(origin).normalize(),
  );
  setWorldRotation(bone, turn.multiply(orientation(bone)));
}

// Sample both limb segments against the stationary arms. The radii and torso
// ellipsoid are posing guides. The exported triangles can still intersect.
function clearanceGuide(parts, root, chain, regions) {
  const spans = [],
    point = new Vector3(),
    nearest = new Vector3();
  function radius(part, length) {
    const radii = part.knots
      ?.map((k) => (k[3] + k[4]) * 0.5)
      .sort((a, b) => a - b);
    return MathUtils.clamp(
      radii?.[Math.floor(radii.length / 2)] ?? length * 0.17,
      length * 0.07,
      length * 0.4,
    );
  }
  function segment(part, end) {
    const from = at(root(part)),
      to = at(root(end)),
      axis = to.clone().sub(from);
    return {
      from,
      axis,
      squared: axis.lengthSq(),
      radius: radius(part, axis.length()),
    };
  }
  for (const hand of parts) {
    if (
      (hand.motionRole ?? hand.outfitRole) !== "hand" ||
      hand.id === chain.hand.id
    )
      continue;
    const other = armChain(parts, hand.id);
    if (other && [other.upper, other.lower, other.hand].every(root))
      spans.push(
        segment(other.upper, other.lower),
        segment(other.lower, other.hand),
      );
  }
  const widths = [
    segment(chain.upper, chain.lower).radius,
    segment(chain.lower, chain.hand).radius,
  ];
  const torso = regions?.get(chain.upper.parent);
  const torsoBox =
    torso && !torso.bounds.isEmpty() && torso.role === "torso"
      ? torso.bounds
      : null;
  const center = torsoBox?.getCenter(new Vector3()),
    radii = torsoBox?.getSize(new Vector3()).multiplyScalar(0.49);
  let bodyTransform;
  if (torsoBox) {
    const part = root(torso.part);
    // Centre and bounds are stored in rest-world metres. Carry the guide
    // through any root or torso motion that was playing when posing began.
    if (part && torso.points?.[0]) {
      const q = orientation(part),
        pivot = at(part),
        bindAt = torso.points[0];
      const inverse = q.clone().invert();
      bodyTransform = (p) =>
        nearest.copy(p).sub(pivot).applyQuaternion(inverse).add(bindAt);
    }
  }
  return (shoulder, elbow, wrist) => {
    let penalty = 0;
    const points = [shoulder, elbow, wrist];
    for (const [index, width] of widths.entries()) {
      const from = points[index],
        to = points[index + 1];
      for (let i = 1; i <= 8; i++) {
        point.lerpVectors(from, to, i / 8);
        for (const s of spans) {
          const t = MathUtils.clamp(
            nearest.copy(point).sub(s.from).dot(s.axis) / (s.squared || 1),
            0,
            1,
          );
          nearest.copy(s.from).addScaledVector(s.axis, t);
          const overlap = Math.max(
            0,
            width + s.radius + 0.008 - point.distanceTo(nearest),
          );
          penalty += overlap * overlap;
        }
        if (torsoBox && (index === 1 || i >= 4)) {
          const offset = bodyTransform
            ? bodyTransform(point)
            : nearest.copy(point);
          offset.sub(center);
          const depth =
            1 -
            Math.hypot(
              offset.x / Math.max(0.01, radii.x + width),
              offset.y / Math.max(0.01, radii.y + width),
              offset.z / Math.max(0.01, radii.z + width),
            );
          if (depth > 0)
            penalty += (depth * Math.min(radii.x, radii.y, radii.z)) ** 2;
        }
      }
    }
    return penalty;
  };
}

// Two fixed segment lengths and the artist's initial elbow plane define the
// circle of possible elbow positions. Only three part-root rotations change.
export function wristReach(parts, bindings, id, regions) {
  const chain = armChain(parts, id);
  if (!chain) return null;
  function root(part) {
    return bindings.get(JSON.stringify([part.id, 0, ""]))?.bone;
  }
  const shoulder = root(chain.upper),
    elbow = root(chain.lower),
    wrist = root(chain.hand);
  if (!shoulder || !elbow || !wrist) return null;
  const a = at(shoulder),
    b = at(elbow),
    c = at(wrist);
  const upper = a.distanceTo(b),
    lower = b.distanceTo(c);
  if (Math.min(upper, lower) < 0.001) return null;
  const originalAxis = c.clone().sub(a);
  if (originalAxis.lengthSq() < 1e-12) originalAxis.copy(b).sub(a);
  originalAxis.normalize();
  const pole = b.clone().sub(a);
  pole.addScaledVector(originalAxis, -pole.dot(originalAxis));
  if (pole.lengthSq() < 1e-6 * upper * upper) {
    // A straight arm has no bend plane. Seed it behind the shoulder, using
    // the character side when that direction lies along the arm.
    pole.set(0, 0, -1).applyQuaternion(orientation(shoulder.parent));
    if (Math.abs(pole.dot(originalAxis)) > 0.92)
      pole.set(1, 0, 0).applyQuaternion(orientation(shoulder.parent));
    pole.addScaledVector(originalAxis, -pole.dot(originalAxis));
  }
  pole.normalize();
  const clearance = clearanceGuide(parts, root, chain, regions);
  const original = [shoulder, elbow, wrist].map((j) => j.quaternion.clone());
  const handFacing = orientation(wrist),
    epsilon = Math.min(upper, lower) * 0.00001;
  return {
    wrist,
    initial: c,
    solve(goal, roll = 0, elbowDirection = null) {
      for (const [i, joint] of [shoulder, elbow, wrist].entries())
        joint.quaternion.copy(original[i]);
      shoulder.updateWorldMatrix(true, true);
      const direction = goal.clone().sub(a),
        requested = direction.length();
      if (requested < 1e-8) direction.copy(originalAxis);
      else direction.divideScalar(requested);
      const distance = MathUtils.clamp(
        requested,
        Math.abs(upper - lower) + epsilon,
        upper + lower - epsilon,
      );
      const along =
        (upper * upper - lower * lower + distance * distance) / (2 * distance);
      const side = Math.sqrt(Math.max(0, upper * upper - along * along));
      const bend = pole
        .clone()
        .applyQuaternion(
          new Quaternion().setFromUnitVectors(originalAxis, direction),
        );
      const wristGoal = a.clone().addScaledVector(direction, distance);
      if (elbowDirection === "clear") {
        const initial = bend.clone(),
          test = new Vector3(),
          trial = new Vector3();
        let best = Infinity;
        for (let i = 0; i < 36; i++) {
          test.copy(initial).applyAxisAngle(direction, (i * Math.PI) / 18);
          trial
            .copy(a)
            .addScaledVector(direction, along)
            .addScaledVector(test, side);
          const score =
            clearance(a, trial, wristGoal) + (1 - test.dot(initial)) * 0.00001;
          if (score < best) {
            best = score;
            bend.copy(test);
          }
        }
      } else if (elbowDirection) {
        const preferred = elbowDirection
          .clone()
          .addScaledVector(direction, -elbowDirection.dot(direction));
        if (preferred.lengthSq() > 1e-8) bend.copy(preferred.normalize());
      }
      bend.applyAxisAngle(direction, MathUtils.degToRad(roll));
      const elbowGoal = a
        .clone()
        .addScaledVector(direction, along)
        .addScaledVector(bend, side);
      aim(shoulder, elbow, elbowGoal);
      aim(elbow, wrist, wristGoal);
      setWorldRotation(wrist, handFacing.clone());
      return at(wrist).distanceTo(goal);
    },
  };
}
