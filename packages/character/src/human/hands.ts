// Relaxed finger curl of the fitting pose (character-view/human-hands.js).
// Flex from the knuckles in the plane of each palm. The ring and little
// fingers lead a relaxed curl and the thumb bends around its own oblique axis.
//
// The arithmetic follows three's Vector3 and Matrix4 step for step, so the
// curl is bit-identical to G0 while the adult's parameters and evaluation stay
// free of three for hosts without a DOM.

import { boneNames } from "./catalogue.js";

type Vec = [number, number, number];
/** Column-major, as three stores a Matrix4. */
type Mat = number[];

const names: ReadonlyArray<string> = boneNames;
const index = (name: string) => names.indexOf(name);

const identity = (): Mat => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translation = (x: number, y: number, z: number): Mat => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  x,
  y,
  z,
  1,
];
function rotation([x, y, z]: Vec, angle: number): Mat {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    t = 1 - c,
    tx = t * x,
    ty = t * y;
  return [
    tx * x + c,
    tx * y + s * z,
    tx * z - s * y,
    0,
    tx * y - s * z,
    ty * y + c,
    ty * z + s * x,
    0,
    tx * z + s * y,
    ty * z - s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ];
}
function multiply(a: Mat, b: Mat): Mat {
  const out: Mat = Array.from({ length: 16 }, () => 0);
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++)
      out[col * 4 + row] =
        (a[row] ?? 0) * (b[col * 4] ?? 0) +
        (a[4 + row] ?? 0) * (b[col * 4 + 1] ?? 0) +
        (a[8 + row] ?? 0) * (b[col * 4 + 2] ?? 0) +
        (a[12 + row] ?? 0) * (b[col * 4 + 3] ?? 0);
  return out;
}
function apply(e: Mat, [x, y, z]: Vec): Vec {
  const w = 1 / ((e[3] ?? 0) * x + (e[7] ?? 0) * y + (e[11] ?? 0) * z + (e[15] ?? 0));
  return [
    ((e[0] ?? 0) * x + (e[4] ?? 0) * y + (e[8] ?? 0) * z + (e[12] ?? 0)) * w,
    ((e[1] ?? 0) * x + (e[5] ?? 0) * y + (e[9] ?? 0) * z + (e[13] ?? 0)) * w,
    ((e[2] ?? 0) * x + (e[6] ?? 0) * y + (e[10] ?? 0) * z + (e[14] ?? 0)) * w,
  ];
}
function normalize([x, y, z]: Vec): Vec {
  const inverse = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
  return [x * inverse, y * inverse, z * inverse];
}
const read = (array: Float32Array, at: number): Vec => [
  array[at] ?? 0,
  array[at + 1] ?? 0,
  array[at + 2] ?? 0,
];

export function poseFingers(
  positions: Float32Array,
  joints: Float32Array,
  bones: Uint8Array,
  weights: Float32Array,
  amount: number,
): void {
  const transforms = new Map<number, Mat>();
  const joint = (n: string, side: string) => read(joints, index(n + side) * 3);
  for (const [side, sign] of [
    ["_l", 1],
    ["_r", -1],
  ] as const) {
    const [px, py, pz] = joint("pinky_01", side),
      [ix, iy, iz] = joint("index_01", side),
      [nx, ny, nz] = normalize([px - ix, py - iy, pz - iz]),
      across: Vec = [nx * sign, ny * sign, nz * sign];
    for (const [digit, bend] of [
      ["index", 0.72],
      ["middle", 0.86],
      ["ring", 1],
      ["pinky", 1.1],
      ["thumb", 0.5],
    ] as const) {
      let axis: Vec = across;
      if (digit === "thumb") {
        const [x, y, z] = across;
        axis = normalize([x + (sign - x) * 0.7, y + (0 - y) * 0.7, z + (0 - z) * 0.7]);
      }
      let parent = identity();
      for (const [segment, factor] of [
        [1, 0.64],
        [2, 1.0],
        [3, 0.63],
      ] as const) {
        const i = index(digit + "_0" + segment + side),
          [x, y, z] = read(joints, i * 3);
        const around = multiply(
          multiply(translation(x, y, z), rotation(axis, bend * amount * factor)),
          translation(-x, -y, -z),
        );
        parent = multiply(parent, around);
        transforms.set(i, parent);
      }
    }
  }
  for (let i = 0; i < positions.length / 3; i++) {
    const point = read(positions, i * 3),
      delta: Vec = [0, 0, 0];
    for (let k = i * 4; k < i * 4 + 4; k++) {
      const matrix = transforms.get(bones[k] ?? -1);
      const w = weights[k] ?? 0;
      if (matrix && w) {
        const [mx, my, mz] = apply(matrix, point);
        delta[0] += (mx - point[0]) * w;
        delta[1] += (my - point[1]) * w;
        delta[2] += (mz - point[2]) * w;
      }
    }
    positions[i * 3] = point[0] + delta[0];
    positions[i * 3 + 1] = point[1] + delta[1];
    positions[i * 3 + 2] = point[2] + delta[2];
  }
  for (const [i, matrix] of transforms) {
    const [x, y, z] = apply(matrix, read(joints, i * 3));
    joints[i * 3] = x;
    joints[i * 3 + 1] = y;
    joints[i * 3 + 2] = z;
  }
}
