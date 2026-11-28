import { Euler, MathUtils, Matrix4, Vector3 } from "three";

export function restingWrist(direction: Vector3, medial: Vector3): number[] {
  const up = direction.clone().normalize().negate();
  const palm = medial.clone().addScaledVector(up, -medial.dot(up));
  if (palm.lengthSq() < 1e-8) {
    const axis = Math.abs(up.z) < 0.8 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
    palm.copy(axis).addScaledVector(up, -axis.dot(up));
  }
  palm.normalize();
  const across = new Vector3().crossVectors(up, palm);
  const angles = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(across, up, palm));
  return [angles.x, angles.y, angles.z].map(MathUtils.radToDeg);
}
