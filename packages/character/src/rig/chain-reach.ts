import * as T from "three";

export type LimbKind = "leg" | "arm" | "wing" | "fin" | "tail";

const at = (bone: T.Object3D) => bone.getWorldPosition(new T.Vector3());
const facing = (bone: T.Object3D | null) =>
  bone ? bone.getWorldQuaternion(new T.Quaternion()) : new T.Quaternion();

function setFacing(bone: T.Object3D, rotation: T.Quaternion) {
  bone.quaternion.copy(facing(bone.parent).invert().multiply(rotation));
  bone.updateWorldMatrix(false, true);
}
function aim(bone: T.Object3D, end: T.Object3D, toward: T.Vector3) {
  const origin = at(bone);
  const from = at(end).sub(origin),
    to = toward.clone().sub(origin);
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
  const turn = new T.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  setFacing(bone, turn.multiply(facing(bone)));
}

export interface ChainReach {
  readonly initial: T.Vector3;
  solve(goal: T.Vector3): number;
}

export function chainReach(
  chain: readonly [T.Bone, T.Bone, T.Bone],
  kind: LimbKind,
): ChainReach | undefined {
  const [a, b, c] = chain;
  a.updateWorldMatrix(true, true);
  const pa = at(a),
    pb = at(b),
    pc = at(c);
  const upper = pa.distanceTo(pb),
    lower = pb.distanceTo(pc);
  if (Math.min(upper, lower) < 0.001) return undefined;
  const axis = pc.clone().sub(pa);
  if (axis.lengthSq() < 1e-12) axis.copy(pb).sub(pa);
  axis.normalize();
  const pole = pb.clone().sub(pa);
  pole.addScaledVector(axis, -pole.dot(axis));
  if (pole.lengthSq() < 1e-6 * upper * upper) {
    pole.set(0, 0, kind === "leg" ? 1 : -1);
    if (Math.abs(pole.dot(axis)) > 0.92) pole.set(1, 0, 0);
    pole.addScaledVector(axis, -pole.dot(axis));
  }
  pole.normalize();
  const original = chain.map((j) => j.quaternion.clone());
  const carrier = a.parent,
    inCarrier = facing(carrier).invert(),
    axisLocal = axis.clone().applyQuaternion(inCarrier),
    poleLocal = pole.clone().applyQuaternion(inCarrier),
    tipFacing = facing(c);
  return {
    initial: pc,
    solve(goal) {
      chain.forEach((j, i) => j.quaternion.copy(original[i] ?? j.quaternion));
      carrier?.updateWorldMatrix(true, true);
      const origin = at(a),
        turn = facing(carrier);
      const axisNow = axisLocal.clone().applyQuaternion(turn),
        poleNow = poleLocal.clone().applyQuaternion(turn);
      const direction = goal.clone().sub(origin),
        wanted = direction.length();
      if (wanted < 1e-8) direction.copy(axisNow);
      else direction.divideScalar(wanted);
      const distance = T.MathUtils.clamp(
        wanted,
        Math.abs(upper - lower) + 1e-5,
        upper + lower - 1e-5,
      );
      const along = (upper * upper - lower * lower + distance * distance) / (2 * distance),
        side = Math.sqrt(Math.max(0, upper * upper - along * along));
      const bend = poleNow.applyQuaternion(
        new T.Quaternion().setFromUnitVectors(axisNow, direction),
      );
      const middle = origin.clone().addScaledVector(direction, along).addScaledVector(bend, side);
      const tip = origin.clone().addScaledVector(direction, distance);
      aim(a, b, middle);
      aim(b, c, tip);
      setFacing(c, tipFacing);
      return Math.max(0, wanted - distance);
    },
  };
}
