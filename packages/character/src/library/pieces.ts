import {
  pieceNames,
  type Appearance,
  type Finish,
  type Knot,
  type OutfitName,
  type PieceName,
} from "@irudd/document";
import * as T from "three";
import { faceTexture, type FacePaint } from "../paint/faces.js";
import { earGeometry, faceCell, faceGeometry, shapeNeck } from "../surfaces/head.js";
import { sweepGeometry } from "../surfaces/sweep.js";

import { pieceAnchors } from "./anchors.js";
export { pieceAnchors } from "./anchors.js";

const palettes = {
  Tide: ["#38685f", "#e49a55", "#bcccb7"],
  Ochre: ["#bc904c", "#375951", "#e3d6b0"],
  Clay: ["#a35847", "#e1bf75", "#d6b9a3"],
  Polar: ["#93aeb4", "#e68d5a", "#d3dfdc"],
} as const;
const waist = "#374a46";
const sole = "#273a38";
const hardware = "#85958c";
const up = new T.Vector3(0, 1, 0);

type Row = readonly [number, number, number, (number | undefined)?, (number | undefined)?];

const shellGeometry = (rows: ReadonlyArray<Row>): T.BufferGeometry =>
  sweepGeometry(rows.map(([y, w, d, z = 0, x = 0]): Knot => [x, y, z, w, d]));

export function builtinFace(
  look: Pick<Appearance, "face" | "skin" | "sculpt">,
  material: (color: string, finish: Finish) => T.Material,
  paint: FacePaint | undefined,
  adultProfile = false,
): T.Mesh {
  const surface = paint
    ? new T.MeshStandardMaterial({
        map: faceTexture(paint, faceCell(look), look.skin),
        roughness: 0.9,
      })
    : material(look.skin, "plain");
  const face = new T.Mesh(faceGeometry(look, adultProfile), surface);
  face.castShadow = true;
  face.userData["faceSurface"] = true;
  return face;
}

export function bodyPieces(
  look: Appearance,
  outfit: OutfitName,
  material: (color: string, finish: Finish) => T.Material,
  paint: FacePaint | undefined,
): Record<PieceName, T.Group> {
  const groups: Record<PieceName, T.Group> = {
    torso: new T.Group(),
    head: new T.Group(),
    "left arm": new T.Group(),
    "right arm": new T.Group(),
    "left leg": new T.Group(),
    "right leg": new T.Group(),
  };
  let region: PieceName = "torso";
  const base = palettes[look.palette];
  const tones = look.tones ?? {};
  const cloth = tones.cloth ?? base[0];
  const trim = tones.trim ?? base[1];
  const panel = tones.panel ?? base[2];
  const suit = outfit === "Pressure suit";
  const work = outfit === "Work clothes";
  const body = 1;
  const skin = look.skin;
  const hair = look.hairColor;
  function mesh(geometry: T.BufferGeometry, color: string, x = 0, y = 0, z = 0): T.Mesh {
    const type: Finish =
      color === skin || color === hair
        ? "plain"
        : color === hardware
          ? "metal"
          : color === sole || color === "#685343" || color === tones.boots
            ? "leather"
            : "canvas";
    const part = new T.Mesh(geometry, material(color, type));
    part.position.set(x, y, z);
    part.castShadow = true;
    groups[region].add(part);
    return part;
  }
  const shell = (rows: ReadonlyArray<Row>, color: string, x = 0, z = 0): T.Mesh =>
    mesh(shellGeometry(rows), color, x, 0, z);
  function oval(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    color: string,
  ): T.Mesh {
    const part = mesh(new T.SphereGeometry(1, 24, 14), color, x, y, z);
    part.scale.set(width, height, depth);
    return part;
  }
  const box = (
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    color: string,
  ): T.Mesh => mesh(new T.BoxGeometry(width, height, depth), color, x, y, z);
  function segment(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    radiusA: number,
    radiusB: number,
    color: string,
  ): T.Mesh {
    const start = new T.Vector3(...a);
    const end = new T.Vector3(...b);
    const delta = end.clone().sub(start);
    const geo = new T.CylinderGeometry(radiusB, radiusA, delta.length(), 10);
    const part = mesh(geo, color);
    part.position.copy(start).lerp(end, 0.5);
    part.quaternion.setFromUnitVectors(up, delta.normalize());
    return part;
  }

  const hip = 0.104 * body;
  const shoulder = 0.198 * body;
  const torso = (rows: ReadonlyArray<Row>, color: string): T.Mesh =>
    shell(
      rows.map(([y, x, z, dz]): Row => [y, x * body, z, dz]),
      color,
    );
  const pack = suit ? 0.024 : 0;
  for (const side of [-1, 1]) {
    region = side > 0 ? "left leg" : "right leg";
    const x = hip * side;
    const foot = x + 0.036 * side;
    const leg = suit ? cloth : work ? (tones.pants ?? waist) : skin;
    shell(
      [
        [0.075, 0.045 + pack, 0.048 + pack, 0, 0.036 * side],
        [0.17, 0.043 + pack, 0.048 + pack, 0, 0.03 * side],
        [0.33, 0.064 + pack, 0.073 + pack, -0.013, 0.014 * side],
        [0.47, 0.06 + pack, 0.063 + pack, 0.008],
        [0.55, 0.074 + pack, 0.081 + pack],
        [0.73, 0.089 + pack, 0.096 + pack],
        [0.87, 0.098 + pack, 0.105 + pack],
      ],
      leg,
      x,
    );
    if (!work && !suit)
      shell(
        [
          [0.61, 0.089, 0.099],
          [0.7, 0.1, 0.105],
          [0.87, 0.101, 0.113],
        ],
        waist,
        x,
      );
    if (suit) {
      oval(x, 0.495, 0.09, 0.07, 0.074, 0.034, panel);
      box(x, 0.494, 0.119, 0.076, 0.012, 0.009, hardware);
      shell(
        [
          [0.205, 0.073, 0.079],
          [0.226, 0.075, 0.08],
        ],
        trim,
        x,
      );
      box(x + side * 0.091, 0.72, 0.01, 0.027, 0.137, 0.103, waist);
    } else if (work && look.pockets !== false) {
      box(x + side * 0.082, 0.69, 0.018, 0.025, 0.114, 0.085, cloth);
      box(x + side * 0.09, 0.735, 0.018, 0.024, 0.026, 0.098, panel);
    }
    const boot = suit ? 0.211 : work ? 0.155 : 0.086;
    shell(
      [
        [0.013, 0.064 + pack, 0.12 + pack, 0.046],
        [0.045, 0.067 + pack, 0.126 + pack, 0.044],
        [0.081, 0.061 + pack, 0.091 + pack, 0.031],
        [boot, 0.053 + pack, 0.06 + pack, -0.003],
      ],
      suit ? waist : work ? (tones.boots ?? "#685343") : sole,
      foot,
    );
    shell(
      [
        [0, 0.066 + pack, 0.127 + pack, 0.045],
        [0.021, 0.067 + pack, 0.129 + pack, 0.045],
      ],
      sole,
      foot,
    );
    for (let lace = 0; lace < 3; lace++) {
      const z = 0.087 - lace * 0.019;
      const y = 0.076 + lace * 0.012;
      segment(
        [foot - 0.032, y, z],
        [foot + 0.032, y + 0.008, z + 0.006],
        0.0026,
        0.0026,
        suit ? trim : sole,
      );
    }
  }
  region = "torso";
  const belly = look.belly ?? 1;
  const jacket = torso(
    [
      [0.815, 0.176, 0.11],
      [0.88, 0.181, 0.116],
      [0.99, 0.156 * belly, 0.113 * belly, (belly - 1) * 0.052],
      [1.12, 0.164 * belly, 0.122 * belly, (belly - 1) * 0.045],
      [1.21, 0.185, 0.132],
      [1.31, 0.202, 0.134],
      [1.39, 0.176, 0.099],
      [1.43, 0.074, 0.078],
    ],
    suit || work ? cloth : (tones.cloth ?? "#435e58"),
  );
  if (work && look.collar !== false) jacket.material = material(cloth, "jacket");
  torso(
    [
      [0.763, 0.105, 0.078, -0.019],
      [0.795, 0.164, 0.114],
      [0.87, 0.186, 0.119],
      [0.91, 0.163, 0.114],
    ],
    work ? (tones.pants ?? waist) : waist,
  );
  torso(
    [
      [0.905, 0.184, 0.127],
      [0.942, 0.179, 0.129],
    ],
    suit ? waist : (tones.boots ?? "#554738"),
  );
  box(0, 0.925, 0.13, 0.059, 0.036, 0.018, hardware);

  for (const side of [-1, 1]) {
    region = side > 0 ? "left arm" : "right arm";
    const outer = shoulder + (suit ? 0.026 : 0);
    const elbow = outer + 0.073;
    const wrist = outer + 0.099;
    const armColor = suit || work ? cloth : skin;
    const shortSleeve = work && look.sleeves === "short";
    const bare = work && look.sleeves === "none";
    const armSurface = bare ? skin : armColor;
    const outline: Knot[] = [
      [side * (outer - 0.041), 1.368, -0.012, 0.041 + pack, 0.05 + pack],
      [side * (outer - 0.006), 1.336, -0.004, 0.075 + pack, 0.081 + pack],
      [side * (outer + 0.019), 1.28, -0.005, 0.076 + pack, 0.079 + pack],
      [side * (outer + 0.044), 1.208, -0.004, 0.058 + pack, 0.067 + pack],
      [side * (elbow - 0.007), 1.137, 0, 0.052 + pack, 0.058 + pack],
      [side * elbow, 1.087, 0.009, 0.048 + pack, 0.05 + pack],
      [side * (elbow + 0.01), 1.032, 0.021, 0.053 + pack, 0.053 + pack],
      [side * (wrist - 0.004), 0.946, 0.04, 0.04 + pack, 0.042 + pack],
      [side * wrist, 0.88, 0.05, 0.032 + pack, 0.033 + pack],
    ];
    mesh(sweepGeometry(outline), shortSleeve ? skin : armSurface);
    if (shortSleeve)
      mesh(
        sweepGeometry(
          outline.slice(0, 4).map(([x, y, z, w, d]): Knot => [x, y, z, w + 0.003, d + 0.003]),
        ),
        armColor,
      );
    if (suit || (work && !bare && !shortSleeve)) {
      if (suit) oval(side * outer, 1.351, 0, 0.11 + pack, 0.063 + pack, 0.09 + pack, panel);
      segment(
        [side * (wrist - 0.003), 0.91, 0.043],
        [side * wrist, 0.883, 0.048],
        0.045 + pack,
        0.042 + pack,
        suit ? trim : panel,
      );
    }
    const hand = suit ? sole : skin;
    const handX = side * wrist;
    oval(handX, 0.843, 0.056, 0.031 + pack * 0.35, 0.049, 0.04 + pack * 0.4, hand);
    const lengths = [0.045, 0.058, 0.063, 0.057];
    for (let i = 0; i < 4; i++) {
      const z = 0.026 + i * 0.018;
      const length = lengths[i] ?? 0;
      mesh(
        sweepGeometry([
          [handX, 0.821, z, 0.009 + pack * 0.12, 0.011 + pack * 0.12],
          [handX + side * 0.004, 0.802, z + 0.005, 0.009 + pack * 0.12, 0.01 + pack * 0.12],
          [handX - side * 0.002, 0.82 - length, z + 0.011, 0.006 + pack * 0.1, 0.007 + pack * 0.1],
        ]),
        hand,
      );
    }
    mesh(
      sweepGeometry([
        [handX - side * 0.014, 0.855, 0.084, 0.015, 0.015],
        [handX - side * 0.024, 0.826, 0.104, 0.012, 0.012],
        [handX - side * 0.023, 0.804, 0.105, 0.008, 0.008],
      ]),
      hand,
    );
  }
  region = "head";
  mesh(
    shapeNeck(
      sweepGeometry(
        [
          [0, 1.364, -0.005, 0.095, 0.074],
          [0, 1.389, -0.007, 0.078, 0.067],
          [0, 1.421, -0.012, 0.068, 0.063],
          [0, 1.458, -0.015, 0.057, 0.059],
          [0, 1.505, -0.015, 0.052, 0.054],
          [0, 1.547, -0.012, 0.051, 0.053],
          [0, 1.564, -0.01, 0.045, 0.048],
        ],
        true,
        48,
      ),
    ),
    skin,
  ).userData["neckSurface"] = true;
  for (const side of [-1, 1])
    mesh(earGeometry(side), skin, side * 0.088, 1.601, -0.02).userData["earSurface"] = true;
  groups.head.add(builtinFace(look, material, paint));
  const hairStart = groups.head.children.length;
  if (look.hair !== "Bald")
    shell(
      [
        [1.655, 0.095, 0.101, -0.008],
        [1.7, 0.101, 0.105, -0.006],
        [1.75, 0.084, 0.089, -0.008],
        [1.771, 0.041, 0.043, -0.008],
      ],
      hair,
    );
  if (look.hair === "Sweep") {
    const fringe = oval(-0.021, 1.714, 0.063, 0.083, 0.039, 0.067, hair);
    fringe.rotation.z = 0.3;
    oval(0.012, 1.663, -0.089, 0.075, 0.085, 0.05, hair);
  } else if (look.hair === "Coils") {
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5;
      oval(
        0.069 * Math.sin(angle),
        1.72 + 0.009 * Math.cos(3 * angle),
        0.073 * Math.cos(angle),
        0.046,
        0.053,
        0.048,
        hair,
      );
    }
    oval(0, 1.755, 0, 0.076, 0.045, 0.077, hair);
  }
  for (const child of groups.head.children.slice(hairStart)) child.userData["baseHair"] = true;
  region = "torso";
  if (work && look.collar !== false) {
    for (const side of [-1, 1]) {
      const collar = box(side * 0.055, 1.381, 0.077, 0.082, 0.049, 0.024, panel);
      collar.rotation.z = side * 0.44;
    }
  }
  if (suit) {
    torso(
      [
        [0.995, 0.157, 0.122],
        [1.1, 0.184, 0.148],
        [1.29, 0.211, 0.155],
        [1.36, 0.192, 0.136],
      ],
      cloth,
    );
    shell(
      [
        [1.38, 0.114, 0.108],
        [1.408, 0.14, 0.128],
        [1.444, 0.14, 0.128],
        [1.451, 0.115, 0.109],
      ],
      trim,
    );
    shell(
      [
        [1.443, 0.134, 0.123],
        [1.463, 0.125, 0.116],
      ],
      waist,
    );
    region = "head";
    shell(
      [
        [1.55, 0.115, 0.059, -0.069],
        [1.68, 0.123, 0.081, -0.042],
        [1.754, 0.113, 0.103, -0.014],
        [1.79, 0.086, 0.084, -0.012],
        [1.805, 0.048, 0.05, -0.013],
      ],
      panel,
    );
    for (const side of [-1, 1]) {
      oval(side * 0.11, 1.625, -0.025, 0.032, 0.06, 0.058, waist);
      oval(side * 0.128, 1.627, -0.025, 0.02, 0.041, 0.044, trim);
      segment([side * 0.118, 1.62, -0.042], [side * 0.103, 1.47, 0.012], 0.024, 0.02, panel);
    }
    box(0, 1.764, 0.081, 0.123, 0.019, 0.039, waist);
    region = "torso";
    box(0, 1.227, 0.151, 0.194, 0.122, 0.04, panel);
    box(-0.026, 1.24, 0.174, 0.101, 0.039, 0.008, sole);
    box(-0.023, 1.245, 0.18, 0.071, 0.009, 0.005, "#94cebd");
    for (let i = 0; i < 3; i++) box(0.041 + i * 0.017, 1.201, 0.176, 0.01, 0.013, 0.009, trim);
    box(0, 1.19, -0.164, 0.283, 0.33, 0.132, waist);
    for (const side of [-1, 1]) {
      segment(
        [side * 0.129 * body, 1.344, 0.103],
        [side * 0.121 * body, 1.103, 0.142],
        0.018,
        0.017,
        waist,
      );
      shell(
        [
          [0.988, 0.043, 0.045],
          [1.022, 0.064, 0.066],
          [1.3, 0.065, 0.066],
          [1.337, 0.045, 0.046],
        ],
        panel,
        side * 0.128,
        -0.181,
      );
      box(side * 0.126, 1.143, -0.24, 0.097, 0.031, 0.021, trim);
    }
  }
  for (const key of pieceNames) {
    const pivot = new T.Vector3(...pieceAnchors[key]);
    for (const child of groups[key].children) child.position.sub(pivot);
  }
  return groups;
}
