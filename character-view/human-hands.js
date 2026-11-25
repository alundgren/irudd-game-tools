import { Matrix4, Vector3 } from "three";

// Flex from the knuckles in the plane of each palm. The ring and little
// fingers lead a relaxed curl and the thumb bends around its own oblique axis.
export function poseFingers(positions, joints, bones, weights, names, amount) {
  const transforms = new Map(),
    point = new Vector3(),
    moved = new Vector3(),
    delta = new Vector3();
  const joint = (n, side) =>
    new Vector3().fromArray(joints, names.indexOf(n + side) * 3);
  for (const [side, sign] of [
    ["_l", 1],
    ["_r", -1],
  ]) {
    const across = joint("pinky_01", side)
      .sub(joint("index_01", side))
      .normalize()
      .multiplyScalar(sign);
    for (const [digit, bend] of Object.entries({
      index: 0.72,
      middle: 0.86,
      ring: 1,
      pinky: 1.1,
      thumb: 0.5,
    })) {
      const axis = across.clone();
      if (digit === "thumb")
        axis.lerp(new Vector3(sign, 0, 0), 0.7).normalize();
      let parent = new Matrix4();
      for (const [index, factor] of [
        [1, 0.64],
        [2, 1.0],
        [3, 0.63],
      ]) {
        const i = names.indexOf(digit + "_0" + index + side),
          pivot = new Vector3().fromArray(joints, i * 3);
        const around = new Matrix4()
          .makeTranslation(pivot.x, pivot.y, pivot.z)
          .multiply(
            new Matrix4().makeRotationAxis(axis, bend * amount * factor),
          )
          .multiply(
            new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z),
          );
        parent = parent.clone().multiply(around);
        transforms.set(i, parent);
      }
    }
  }
  for (let i = 0; i < positions.length / 3; i++) {
    point.fromArray(positions, i * 3);
    delta.set(0, 0, 0);
    for (let k = i * 4; k < i * 4 + 4; k++) {
      const matrix = transforms.get(bones[k]);
      if (matrix && weights[k])
        delta.addScaledVector(
          moved.copy(point).applyMatrix4(matrix).sub(point),
          weights[k],
        );
    }
    point.add(delta).toArray(positions, i * 3);
  }
  for (const [i, matrix] of transforms)
    point
      .fromArray(joints, i * 3)
      .applyMatrix4(matrix)
      .toArray(joints, i * 3);
}
