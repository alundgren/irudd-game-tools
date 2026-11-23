import * as T from "three";

const palettes = {
  Tide: ["#38685f", "#e49a55", "#bcccb7"],
  Ochre: ["#bc904c", "#375951", "#e3d6b0"],
  Clay: ["#a35847", "#e1bf75", "#d6b9a3"],
  Polar: ["#93aeb4", "#e68d5a", "#d3dfdc"],
};
const waist = "#374a46",
  sole = "#273a38",
  hardware = "#85958c";
const up = new T.Vector3(0, 1, 0);

// Ring sections, in metres, describe the outer contour at each landmark.
// Each row holds height, half-width, half-depth, forward offset and lateral offset.
function shellGeometry(rows, sides) {
  const points = [],
    indices = [];
  for (const [y, width, depth, z = 0, x = 0] of rows) {
    for (let i = 0; i < sides; i++) {
      const angle = ((i + 0.5) * Math.PI * 2) / sides;
      points.push(x + Math.sin(angle) * width, y, z + Math.cos(angle) * depth);
    }
  }
  for (let row = 1; row < rows.length; row++) {
    for (let i = 0; i < sides; i++) {
      const a = (row - 1) * sides + i;
      const b = (row - 1) * sides + ((i + 1) % sides);
      indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
  }
  const end = (rows.length - 1) * sides;
  for (let i = 1; i < sides - 1; i++)
    indices.push(0, i + 1, i, end, end + i, end + i + 1);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(points, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createCharacter(recipe, silhouette) {
  const group = new T.Group(),
    materials = new Map();
  const [cloth, trim, panel] = palettes[recipe.palette];
  const suit = recipe.outfit === "Pressure suit",
    work = recipe.outfit === "Work clothes";
  const body = { Slender: 0.86, Athletic: 1, Broad: 1.14 }[recipe.build];
  const skin = recipe.skin,
    hair = recipe.hairColor;
  const stretch = recipe.height / 1.76;
  group.scale.setScalar(stretch);
  function mesh(geometry, color, x = 0, y = 0, z = 0) {
    const key = silhouette ? "ink" : color;
    if (!materials.has(key))
      materials.set(
        key,
        silhouette
          ? new T.MeshBasicMaterial({ color: "#203733" })
          : new T.MeshStandardMaterial({
              color,
              flatShading: true,
              roughness: 0.84,
            }),
      );
    const part = new T.Mesh(geometry, materials.get(key));
    part.position.set(x, y, z);
    part.castShadow = true;
    group.add(part);
    return part;
  }
  function shell(rows, color, sides = 12, x = 0, z = 0) {
    return mesh(shellGeometry(rows, sides), color, x, 0, z);
  }
  function oval(x, y, z, width, height, depth, color, detail = 1) {
    const part = mesh(new T.IcosahedronGeometry(1, detail), color, x, y, z);
    part.scale.set(width, height, depth);
    return part;
  }
  function box(x, y, z, width, height, depth, color) {
    return mesh(new T.BoxGeometry(width, height, depth), color, x, y, z);
  }
  function segment(a, b, radiusA, radiusB, color, depth = 1) {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b);
    const delta = end.clone().sub(start);
    const geo = new T.CylinderGeometry(radiusB, radiusA, delta.length(), 10);
    geo.scale(1, 1, depth);
    const part = mesh(geo, color);
    part.position.copy(start).lerp(end, 0.5);
    part.quaternion.setFromUnitVectors(up, delta.normalize());
    return part;
  }

  const hip = 0.104 * body,
    shoulder = 0.198 * body;
  const torso = (rows, color) =>
    shell(
      rows.map(([y, x, z, dz]) => [y, x * body, z, dz]),
      color,
    );
  const pack = suit ? 0.024 : 0;
  for (const side of [-1, 1]) {
    const x = hip * side,
      foot = x + 0.036 * side;
    const leg = suit ? cloth : work ? waist : skin;
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
      10,
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
        10,
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
        10,
        x,
      );
      box(x + side * 0.091, 0.72, 0.01, 0.027, 0.137, 0.103, waist);
    } else if (work) {
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
      suit ? waist : work ? "#685343" : sole,
      10,
      foot,
    );
    shell(
      [
        [0, 0.066 + pack, 0.127 + pack, 0.045],
        [0.021, 0.067 + pack, 0.129 + pack, 0.045],
      ],
      sole,
      10,
      foot,
    );
    box(foot, 0.068, 0.122, 0.085, 0.014, 0.025, suit ? trim : hardware);
  }
  torso(
    [
      [0.79, 0.176, 0.11],
      [0.88, 0.181, 0.116],
      [0.99, 0.146, 0.109],
      [1.16, 0.175, 0.125],
      [1.31, 0.202, 0.134],
      [1.39, 0.176, 0.099],
      [1.43, 0.074, 0.078],
    ],
    suit ? cloth : work ? cloth : "#435e58",
  );
  torso(
    [
      [0.795, 0.183, 0.118],
      [0.87, 0.186, 0.119],
      [0.91, 0.163, 0.114],
    ],
    waist,
  );
  torso(
    [
      [0.905, 0.184, 0.127],
      [0.942, 0.179, 0.129],
    ],
    suit ? waist : sole,
  );
  box(0, 0.925, 0.13, 0.059, 0.036, 0.018, hardware);

  for (const side of [-1, 1]) {
    const outer = shoulder + (suit ? 0.026 : 0);
    const elbow = outer + 0.073,
      wrist = outer + 0.099;
    const armColor = suit || work ? cloth : skin;
    oval(
      side * outer,
      1.318,
      -0.005,
      0.086 + pack,
      0.105 + pack,
      0.087 + pack,
      armColor,
    );
    segment(
      [side * outer, 1.318, 0],
      [side * elbow, 1.09, 0.006],
      0.077 + pack,
      0.051 + pack,
      armColor,
    );
    oval(
      side * elbow,
      1.09,
      0.006,
      0.056 + pack,
      0.066 + pack,
      0.057 + pack,
      suit ? waist : armColor,
    );
    segment(
      [side * elbow, 1.09, 0.009],
      [side * wrist, 0.887, 0.048],
      0.057 + pack,
      0.034 + pack,
      armColor,
    );
    if (suit || work) {
      oval(
        side * outer,
        1.346,
        0.005,
        0.101 + pack,
        0.074 + pack,
        0.105 + pack,
        suit ? panel : cloth,
      );
      segment(
        [side * (wrist - 0.003), 0.91, 0.043],
        [side * wrist, 0.883, 0.048],
        0.045 + pack,
        0.042 + pack,
        suit ? trim : panel,
      );
    }
    oval(
      side * wrist,
      0.834,
      0.056,
      0.04 + pack * 0.5,
      0.072,
      0.037 + pack * 0.4,
      suit ? sole : skin,
    );
    oval(
      side * (wrist - 0.028),
      0.85,
      0.083,
      0.016,
      0.041,
      0.019,
      suit ? waist : skin,
    );
  }
  shell(
    [
      [1.37, 0.063, 0.062],
      [1.49, 0.056, 0.06],
    ],
    skin,
  );
  for (const side of [-1, 1])
    oval(side * 0.088, 1.606, 0.002, 0.021, 0.039, 0.019, skin);
  shell(
    [
      [1.466, 0.045, 0.054, 0.031],
      [1.49, 0.066, 0.075, 0.024],
      [1.54, 0.083, 0.092, 0.011],
      [1.61, 0.093, 0.098, 0.006],
      [1.68, 0.095, 0.1],
      [1.735, 0.074, 0.081],
      [1.76, 0.025, 0.033],
    ],
    skin,
    12,
  );
  oval(0, 1.587, 0.109, 0.021, 0.039, 0.031, skin);
  for (const side of [-1, 1]) {
    oval(side * 0.039, 1.624, 0.094, 0.018, 0.007, 0.005, "#302e2a");
    const brow = box(side * 0.041, 1.641, 0.095, 0.038, 0.009, 0.009, hair);
    brow.rotation.z = side * 0.11;
  }
  box(0, 1.54, 0.101, 0.043, 0.005, 0.007, "#795343");
  shell(
    [
      [1.655, 0.095, 0.101, -0.008],
      [1.7, 0.101, 0.105, -0.006],
      [1.75, 0.084, 0.089, -0.008],
      [1.771, 0.041, 0.043, -0.008],
    ],
    hair,
  );
  if (recipe.hair === "Sweep") {
    const fringe = oval(-0.021, 1.714, 0.063, 0.083, 0.039, 0.067, hair);
    fringe.rotation.z = 0.3;
    oval(0.012, 1.663, -0.089, 0.075, 0.085, 0.05, hair);
  } else if (recipe.hair === "Coils") {
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
  if (work) {
    box(0, 1.165, 0.126, 0.013, 0.355, 0.014, waist);
    for (const side of [-1, 1]) {
      const collar = box(
        side * 0.055,
        1.381,
        0.077,
        0.082,
        0.049,
        0.024,
        panel,
      );
      collar.rotation.z = side * 0.44;
      box(side * 0.091 * body, 1.246, 0.12, 0.076, 0.072, 0.022, cloth);
      box(side * 0.091 * body, 1.276, 0.133, 0.08, 0.018, 0.012, panel);
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
      16,
    );
    shell(
      [
        [1.443, 0.134, 0.123],
        [1.463, 0.125, 0.116],
      ],
      waist,
      16,
    );
    // An open-face helmet leaves the face visible and gives the suit a
    // distinct outline in profile. The cheek guards join the neck seal.
    shell(
      [
        [1.55, 0.115, 0.059, -0.069],
        [1.68, 0.123, 0.081, -0.042],
        [1.754, 0.113, 0.103, -0.014],
        [1.79, 0.086, 0.084, -0.012],
        [1.805, 0.048, 0.05, -0.013],
      ],
      panel,
      16,
    );
    for (const side of [-1, 1]) {
      oval(side * 0.11, 1.625, -0.025, 0.032, 0.06, 0.058, waist);
      oval(side * 0.128, 1.627, -0.025, 0.02, 0.041, 0.044, trim);
      segment(
        [side * 0.118, 1.62, -0.042],
        [side * 0.103, 1.47, 0.012],
        0.024,
        0.02,
        panel,
      );
    }
    box(0, 1.764, 0.081, 0.123, 0.019, 0.039, waist);
    box(0, 1.227, 0.151, 0.194, 0.122, 0.04, panel);
    box(-0.026, 1.24, 0.174, 0.101, 0.039, 0.008, sole);
    box(-0.023, 1.245, 0.18, 0.071, 0.009, 0.005, "#94cebd");
    for (let i = 0; i < 3; i++)
      box(0.041 + i * 0.017, 1.201, 0.176, 0.01, 0.013, 0.009, trim);
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
        10,
        side * 0.128,
        -0.181,
      );
      box(side * 0.126, 1.143, -0.24, 0.097, 0.031, 0.021, trim);
    }
  }
  return group;
}

export function disposeCharacter(group) {
  const materials = new Set();
  group.traverse((part) => {
    if (part.isMesh) {
      part.geometry.dispose();
      materials.add(part.material);
    }
  });
  for (const material of materials) material.dispose();
}
