import { Euler, MathUtils, Matrix4, Vector3 } from "three";

// Local -Y follows the forearm, +Z is the palm. The thumb in handGeometry
// lies on local -X for grip.side=1. With +X on the character's left, a
// thumb-forward resting hand therefore uses grip.side=-side.
export function restingWrist(direction, medial) {
  const up = direction.clone().normalize().negate();
  const palm = medial.clone().addScaledVector(up, -medial.dot(up));
  if (palm.lengthSq() < 1e-8) {
    const axis =
      Math.abs(up.z) < 0.8 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
    palm.copy(axis).addScaledVector(up, -axis.dot(up));
  }
  palm.normalize();
  const across = new Vector3().crossVectors(up, palm);
  const angles = new Euler().setFromRotationMatrix(
    new Matrix4().makeBasis(across, up, palm),
  );
  return [angles.x, angles.y, angles.z].map(MathUtils.radToDeg);
}
