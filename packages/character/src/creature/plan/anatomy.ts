import { MathUtils, Ray, Vector3 } from "three";
import { need } from "./need.js";
import type { Cage } from "./types.js";

export interface ShieldLeg {
  r0: number;
  root: Vector3;
  knee: Vector3;
  side: number;
  frame: { dorsal: Vector3; tangent: Vector3; radius: number[] };
}
interface FootProfile {
  width: number;
  length: number;
  spread: number;
}
interface Bill {
  length: number;
  width: number;
  depth: number;
  lower: number;
  bend: number;
  breadth: number[];
  crown: number[];
}

const { lerp } = MathUtils;

export function skullCage(shape: string, snout: string): Cage {
  const crusher = snout === "mandibles";
  const grazer = snout === "muzzle";
  const proboscis = snout === "trunk";
  const bill = snout === "bill";
  const low = shape === "flat" || bill;
  const skull = [
    [-0.59, 0.12, 0.19, -0.12],
    [-0.44, crusher ? 0.43 : 0.33, proboscis ? 0.52 : 0.37, -0.29],
    [-0.23, crusher ? 0.64 : 0.51, proboscis ? 0.71 : 0.54, grazer ? -0.57 : -0.43],
    [0.06, crusher ? 0.65 : 0.55, proboscis ? 0.67 : 0.48, grazer ? -0.55 : -0.44],
    [0.29, bill ? 0.5 : 0.43, low ? 0.32 : 0.43, -0.36],
    [0.48, bill ? 0.42 : 0.31, proboscis ? 0.35 : 0.21, -0.26],
    [0.56, bill ? 0.32 : 0.21, 0.08, -0.19],
  ];
  const rings = skull.map(([z = 0, w = 0, top = 0, base = 0]) => {
    const orbit = z > 0 && z < 0.4 ? 0.79 : 1;
    const points = [
      [0, top],
      [0.58 * w, top * 0.96],
      [0.86 * w, top * 0.66],
      [orbit * w, top * 0.22],
      [w * (z > -0.32 && z < 0.22 ? 1.11 : 0.98), base * 0.22],
      [w * 0.86, base * 0.71],
      [w * 0.53, base],
      [0, base * 1.04],
    ];
    return [
      ...points,
      ...points
        .slice(1, -1)
        .reverse()
        .map(([x = 0, y = 0]) => [-x, y]),
    ].map(([x = 0, y = 0]) => [x, y, z]);
  });
  return loft(rings);
}

export function skullSurfaceRadius(cage: Cage, az: number, el: number): number {
  const direction = new Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  const ray = new Ray(new Vector3(), direction);
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    hit = new Vector3();
  for (const face of cage.faces) {
    a.fromArray(need(cage.vertices[need(face[0])]));
    for (let j = 1; j < face.length - 1; j++)
      if (
        ray.intersectTriangle(
          a,
          b.fromArray(need(cage.vertices[need(face[j])])),
          c.fromArray(need(cage.vertices[need(face[j + 1])])),
          false,
          hit,
        )
      )
        return hit.length() * 0.971;
  }
  return 0.5;
}

function loft(rings: number[][][]): Cage {
  const vertices = rings.flat(),
    faces: number[][] = [],
    sides = need(rings[0]).length;
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < sides; i++) {
      const n = (i + 1) % sides,
        a = j * sides,
        b = a + sides;
      faces.push([a + i, a + n, b + n, b + i]);
    }
  for (const [row, first] of [
    [0, true],
    [rings.length - 1, false],
  ] as const) {
    const ring = need(rings[row]),
      center = ring.reduce((p, v) => p.map((x, i) => x + need(v[i]) / sides), [0, 0, 0]);
    const c = vertices.push(center) - 1,
      a = row * sides;
    for (let i = 0; i < sides; i++) {
      const n = (i + 1) % sides;
      faces.push(first ? [c, a + n, a + i] : [c, a + i, a + n]);
    }
  }
  return finish(vertices, faces);
}

function finish(vertices: number[][], faces: number[][]): Cage {
  let volume = 0;
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  for (const face of faces) {
    a.fromArray(need(vertices[need(face[0])]));
    for (let j = 1; j < face.length - 1; j++)
      volume += a.dot(
        b
          .fromArray(need(vertices[need(face[j])]))
          .cross(c.fromArray(need(vertices[need(face[j + 1])]))),
      );
  }
  if (volume < 0) for (const face of faces) face.reverse();
  return { vertices, faces, levels: 1 };
}

export function coxalShields(row: ShieldLeg[]) {
  row = [...row].sort((a, b) => b.r0 - a.r0).slice(0, 8);
  const points: number[][] = [],
    faces: number[][] = [];
  const centre = row
    .reduce((sum, leg) => sum.add(leg.root), new Vector3())
    .divideScalar(row.length);
  const unit = Math.max(...row.map((leg) => need(leg.frame.radius[0])), 0.01);
  const sides = Math.min(10, Math.floor((192 / row.length - 2) / 5));
  for (const { root, knee, r0, frame } of row) {
    const axis = knee.clone().sub(root).normalize();
    const dorsal = frame.dorsal.clone().addScaledVector(axis, -frame.dorsal.dot(axis)).normalize();
    const cross = new Vector3().crossVectors(axis, dorsal).normalize();
    const reach = Math.min(root.distanceTo(knee) * 0.56, need(frame.radius[0]) * 0.56);
    const partial = loft(
      [
        [-0.06, 0.95, 0],
        [0.38, 1.48, 0.28],
        [0.72, 1.41, 0.44],
        [1.05, 1.22, 0.17],
        [1.13, 0.91, 0],
      ].map(([t = 0, r = 0, lip = 0]) =>
        Array.from({ length: sides }, (_, i) => {
          const a = (i * 2 * Math.PI) / sides,
            top = Math.sin(a),
            span = Math.cos(a);
          const cap = root
            .clone()
            .addScaledVector(axis, reach * t)
            .addScaledVector(dorsal, r0 * (r * top + lip * Math.max(top, 0)))
            .addScaledVector(cross, r0 * r * span * 0.96)
            .addScaledVector(frame.tangent, -r0 * 0.45 * lip * Math.max(top, 0));
          return cap.sub(centre).divideScalar(unit).toArray();
        }),
      ),
    );
    const base = points.length;
    for (const v of partial.vertices) points.push(v);
    for (const f of partial.faces) faces.push(f.map((i) => i + base));
  }
  return { centre, unit, cage: { vertices: points, faces, levels: 1 } };
}

const pinnae: Record<string, number[][]> = {
  lance: [
    [0, 0, 0, 0.035],
    [0.09, 0.12, 0.01, 0.14],
    [0.19, 0.29, 0.065, 0.15],
    [0.29, 0.49, 0.16, 0.105],
    [0.35, 0.68, 0.22, 0.016],
  ],
  fan: [
    [0, 0, 0, 0.05],
    [0.085, 0.1, 0.02, 0.16],
    [0.2, 0.22, 0.08, 0.25],
    [0.29, 0.36, 0.15, 0.19],
    [0.33, 0.48, 0.23, 0.04],
  ],
  lop: [
    [0, 0, 0, 0.055],
    [0.15, 0.07, 0.03, 0.145],
    [0.32, 0.025, 0.07, 0.16],
    [0.4, -0.12, 0.15, 0.13],
    [0.41, -0.29, 0.19, 0.034],
  ],
  swept: [
    [0, 0, 0, 0.04],
    [0.12, 0.08, 0.05, 0.11],
    [0.28, 0.16, 0.16, 0.145],
    [0.42, 0.21, 0.3, 0.096],
    [0.53, 0.255, 0.45, 0.018],
  ],
  tufted: [
    [0, 0, 0, 0.075],
    [0.07, 0.085, 0.015, 0.16],
    [0.14, 0.2, 0.03, 0.125],
    [0.19, 0.34, 0.08, 0.065],
    [0.225, 0.49, 0.12, 0.009],
  ],
};

function shapedPinna(outward: Vector3, up: Vector3, forward: Vector3, style: string): Cage {
  const side = outward.clone().addScaledVector(up, -outward.dot(up));
  side.addScaledVector(forward, -side.dot(forward)).normalize();
  const stations = need(pinnae[style]);
  const rows = [
    [0.22, -0.062],
    [0.72, -0.066],
    [0.97, -0.038],
    [1, 0.012],
    [0.92, 0.051],
    [0.77, 0.025],
    [0.6, -0.031],
    [0.36, 0.002],
    [0.16, -0.027],
  ];
  const rings = rows.map(([radius = 0, depth = 0], ring) =>
    Array.from({ length: 16 }, (_, i) => {
      const angle = (i * Math.PI) / 8;
      const v = (0.5 + 0.5 * Math.sin(angle) * radius) * 4;
      const j = Math.min(3, Math.floor(v));
      const [reach = 0, height = 0, back = 0, width = 0] = need(stations[j]).map((value, k) =>
        lerp(value, need(need(stations[j + 1])[k]), v - j),
      );
      const x = radius * Math.cos(angle);
      const t = v / 4;
      const lateral = style === "lop" ? 0.46 : style === "swept" ? 0.55 : 0.85;
      const fold = ring === 6 || ring === 7 ? 0.038 * Math.max(0, 1 - 2 * t) : 0;
      return side
        .clone()
        .multiplyScalar(reach + x * width * lateral)
        .addScaledVector(up, height - x * width * (1 - lateral))
        .addScaledVector(forward, -back + depth + fold - 0.05 * x * x + x * width * 0.45)
        .toArray();
    }),
  );
  return loft(rings);
}

export function earCage(
  outward: Vector3,
  up: Vector3,
  forward: Vector3,
  rounded: boolean,
  style?: string,
): Cage {
  if (style !== undefined && Object.hasOwn(pinnae, style))
    return shapedPinna(outward, up, forward, style);
  const axis = outward
    .clone()
    .multiplyScalar(0.7)
    .addScaledVector(up, 0.56)
    .addScaledVector(forward, -0.15)
    .normalize();
  const across = new Vector3().crossVectors(axis, forward).normalize();
  const towards = new Vector3().crossVectors(across, axis).normalize();
  const size = rounded ? 0.5 : 0.67;
  const rows = [
    [0.19, -0.09],
    [0.7, -0.082],
    [1, -0.036],
    [1.01, 0.029],
    [0.86, 0.064],
    [0.72, 0.019],
    [0.53, -0.032],
    [0.35, 0.012],
    [0.17, -0.04],
  ];
  return loft(
    rows.map(([radius = 0, depth = 0], row) =>
      Array.from({ length: 16 }, (_, i) => {
        const a = (i * Math.PI) / 8,
          t = Math.sin(a);
        const profile = rounded ? 0.235 * (1 - 0.12 * t) : 0.185 * (1 - 0.45 * t);
        const x = Math.cos(a) * radius * profile;
        const y = size * (0.46 + 0.57 * t * radius);
        const bowl =
          depth +
          0.038 * t * t * radius -
          0.061 * Math.max(0, t) ** 2 * radius +
          (row === 7 ? 0.04 * (1 - t) * Math.abs(Math.cos(a)) : 0);
        return axis
          .clone()
          .multiplyScalar(y)
          .addScaledVector(across, x)
          .addScaledVector(towards, bowl)
          .toArray();
      }),
    ),
  );
}

export function chelaCage(part: string, forward: Vector3, opening: Vector3): Cage {
  const normal = new Vector3().crossVectors(forward, opening).normalize();
  let sections: number[][];
  if (part === "palm") {
    sections = [
      [-0.17, 0, 0.21, 0.24],
      [-0.08, 0, 0.3, 0.3],
      [0.11, -0.02, 0.34, 0.34],
      [0.28, -0.055, 0.47, 0.4],
      [0.6, -0.065, 0.55, 0.41],
      [0.84, -0.085, 0.51, 0.32],
      [1.01, -0.14, 0.39, 0.24],
      [1.12, -0.21, 0.24, 0.17],
    ];
  } else {
    const movable = part === "upper";
    const sign = movable ? 1 : -1;
    const profile = movable
      ? [
          [0.72, 0.25, 0.21],
          [0.88, 0.35, 0.25],
          [1.08, 0.46, 0.23],
          [1.23, 0.52, 0.185],
          [1.37, 0.53, 0.16],
          [1.49, 0.52, 0.14],
          [1.64, 0.47, 0.12],
          [1.81, 0.37, 0.085],
          [1.98, 0.17, 0.042],
          [2.03, 0.075, 0.016],
        ]
      : [
          [0.73, 0.22, 0.25],
          [0.95, 0.31, 0.29],
          [1.12, 0.37, 0.24],
          [1.26, 0.42, 0.21],
          [1.42, 0.43, 0.18],
          [1.57, 0.42, 0.15],
          [1.72, 0.37, 0.13],
          [1.89, 0.29, 0.095],
          [2.03, 0.19, 0.057],
          [2.14, 0.075, 0.014],
        ];
    sections = profile.map(([z = 0, y = 0, width = 0]) => [
      z,
      sign * y,
      width,
      width * (movable ? 0.78 : 0.95),
    ]);
  }
  return loft(
    sections.map(([z = 0, y = 0, width = 0, depth = 0], row) =>
      Array.from({ length: 10 }, (_, i) => {
        const a = (i * Math.PI) / 5,
          lateral = Math.cos(a);
        const inward = part === "upper" ? -lateral : lateral;
        const tooth =
          part !== "palm" && row >= 3 && row <= 7 && row % 2 === (part === "upper" ? 0 : 1)
            ? 0.15 * Math.max(0, inward) ** 5
            : 0;
        return forward
          .clone()
          .multiplyScalar(z)
          .addScaledVector(opening, y + (width + tooth) * lateral)
          .addScaledVector(normal, depth * Math.sin(a))
          .toArray();
      }),
    ),
  );
}

export function pectoralFinCage(
  side: number,
  sweep: number,
  span: number,
  chord: number,
  girth: number,
): Cage {
  const direction = new Vector3(side * Math.cos(sweep), -0.18, -Math.sin(sweep)).normalize();
  const across = new Vector3(-side * Math.sin(sweep), 0, -Math.cos(sweep));
  const up = new Vector3().crossVectors(direction, across).normalize().multiplyScalar(side);
  const vertices: number[][] = [],
    faces: number[][] = [],
    columns = 13,
    stations = [0, 0.24, 0.66, 1];
  const upper = columns * stations.length;
  const unit = Math.max(span, chord, girth);
  for (const sign of [1, -1])
    for (const t of stations)
      for (let i = 0; i < columns; i++) {
        const u = i / (columns - 1),
          ray = i % 2 === 0;
        const length = span * (0.94 + 0.12 * Math.sin(Math.PI * u) - 0.51 * u ** 2);
        const notch = ray ? 0 : 0.085 * span * t ** 3;
        const fan = (u - 0.28) * chord * (0.47 + 1.13 * t);
        const camber = span * (0.14 * t * (1 - t) - 0.095 * u * t ** 2);
        const web = girth * (0.16 * (1 - t) ** 2 + (ray ? 0.073 : 0.018) * (1 - 0.8 * t));
        vertices.push(
          direction
            .clone()
            .multiplyScalar(t * length - notch)
            .addScaledVector(across, fan + 0.2 * span * t ** 2)
            .addScaledVector(up, camber + sign * web)
            .divideScalar(unit)
            .toArray(),
        );
      }
  for (let row = 0; row < stations.length - 1; row++)
    for (let i = 0; i < columns - 1; i++) {
      const a = row * columns + i;
      const face = [a, a + columns, a + columns + 1, a + 1];
      faces.push(face, face.map((j) => j + upper).reverse());
    }
  const edge: number[] = [];
  for (let row = 0; row < stations.length; row++) edge.push(row * columns);
  for (let i = 1; i < columns; i++) edge.push(upper - columns + i);
  for (let row = stations.length - 2; row >= 0; row--) edge.push(row * columns + columns - 1);
  for (let i = columns - 2; i > 0; i--) edge.push(i);
  for (let i = 0; i < edge.length; i++) {
    const a = need(edge[i]),
      b = need(edge[(i + 1) % edge.length]);
    faces.push([b, a, a + upper, b + upper]);
  }
  return finish(vertices, faces);
}

export function caudalFinCage(along: Vector3, horizontal: boolean): Cage {
  const across = new Vector3(1, 0, 0).addScaledVector(along, -along.x).normalize();
  const vertical = new Vector3().crossVectors(across, along).normalize();
  const width = horizontal ? across : vertical,
    normal = horizontal ? vertical : across;
  const rings: number[][][] = [];
  for (let i = -8; i <= 8; i++) {
    const u = i / 8,
      v = Math.abs(u);
    const leading = -0.53 + 3.65 * v ** 1.68;
    const trailing = 1.62 + 1.7 * v ** 0.77 + 0.11 * Math.sin((i * Math.PI) / 2) ** 2;
    const half = Math.max(0.022, 0.28 * (1 - v ** 1.15));
    const middle = lerp(leading, trailing, 0.42);
    const bent = 0.2 * v ** 1.5;
    rings.push(
      [
        [leading, 0],
        [middle, half],
        [trailing, 0],
        [middle, -half],
      ].map(([z = 0, h = 0]) =>
        width
          .clone()
          .multiplyScalar(u * 3.65)
          .addScaledVector(along, z)
          .addScaledVector(normal, h + bent)
          .multiplyScalar(0.25)
          .toArray(),
      ),
    );
  }
  return loft(rings);
}

export function mammalMuzzle(
  profile: string | undefined,
  lower: boolean,
  width: number,
  height: number,
  reach: number,
  drop: number,
): Cage {
  const cat = profile === "feline",
    rooting = profile === "rooting";
  const grazing = profile === "grazing";
  const widths = lower
    ? [0.35, 0.38, 0.33, 0.26, 0.19, 0.11]
    : [
        0.4,
        0.38,
        0.3,
        cat ? 0.36 : 0.265,
        rooting ? 0.25 : cat ? 0.27 : 0.21,
        rooting ? 0.22 : 0.13,
      ];
  const sections = [0, 0.22, 0.49, 0.73, 0.91, 1];
  const rings = sections.map((t, i) => {
    const w = width * need(widths[i]);
    const h =
      height *
      need(
        (lower ? [0.19, 0.21, 0.17, 0.14, 0.105, 0.075] : [0.34, 0.35, 0.27, 0.19, 0.15, 0.12])[i],
      );
    const bridge = lower ? 0 : height * 0.047 * Math.sin(Math.PI * t);
    return Array.from({ length: 20 }, (_, j) => {
      const a = (2 * Math.PI * j) / 20,
        x = Math.cos(a),
        y = Math.sin(a);
      const pad = (cat ? 0.54 : grazing ? 0.4 : 0.32) * Math.sin(t * Math.PI * 0.65) ** 3;
      const lip = lower ? 0 : pad * Math.abs(x) ** 1.3 * Math.max(0, -y);
      const sectionY = y >= 0 ? y * (lower ? 0.72 : 1) : y * (lower ? 0.95 : 0.78) - lip;
      const tip = lower ? 0.007 : grazing ? 0.08 : 0.04;
      const z = reach * t + reach * tip * Math.abs(x) * t ** 4;
      return [w * x, drop * t + bridge + h * sectionY, z];
    });
  });
  return loft(rings);
}

export function noseWing(profile: string | undefined, side: number): Cage {
  const rooting = profile === "rooting";
  const scaleY = rooting ? 0.85 : 0.65;
  const border = [
    [0, 0.63],
    [0.31, 0.67],
    [0.76, 0.56],
    [1, 0.27],
    [0.99, -0.1],
    [0.73, -0.36],
    [0.34, -0.53],
    [0, -0.63],
    [0, -0.36],
    [0, -0.08],
    [0, 0.16],
    [0, 0.42],
  ];

  const edge = border.map(([x = 0, y = 0]) => [
    x,
    y,
    (rooting ? 0.33 : 0.45) - 0.29 * x * x + 0.09 * y,
  ]);
  const centre = [0.6, 0.03];
  const opening = border.map(([x = 0, y = 0]) => {
    const angle = Math.atan2(y - need(centre[1]), x - need(centre[0]));
    return [
      need(centre[0]) + 0.245 * Math.cos(angle),
      need(centre[1]) + 0.2 * Math.sin(angle) + 0.11 * Math.cos(angle),
    ];
  });
  const rings = [
    edge.map(([x = 0, y = 0, z = 0]) => [x * 0.88, y * 0.82, z - 0.66]),
    edge,
    opening.map(([x = 0, y = 0]) => [x, y, 0.47 - 0.2 * x]),
    opening.map(([x = 0, y = 0]) => [
      0.6 + (x - 0.6) * 0.69,
      0.03 + (y - 0.03) * 0.68,
      0.22 - 0.14 * x,
    ]),
    opening.map(([x = 0, y = 0]) => [
      0.6 + (x - 0.6) * 0.44,
      0.03 + (y - 0.03) * 0.38,
      0.05 - 0.12 * x,
    ]),
  ];
  return loft(rings.map((row) => row.map(([x = 0, y = 0, z = 0]) => [x * side, y * scaleY, z])));
}

const feedingBills: Record<string, Bill> = {
  spear: {
    length: 1.36,
    width: 0.72,
    depth: 0.64,
    lower: 0.985,
    bend: -0.08,
    breadth: [0.95, 1, 0.76, 0.5, 0.29, 0.12, 0.025],
    crown: [0.72, 1, 0.78, 0.54, 0.32, 0.14, 0.03],
  },
  spoon: {
    length: 1.3,
    width: 1.28,
    depth: 0.5,
    lower: 0.97,
    bend: 0.13,
    breadth: [0.7, 0.8, 0.51, 0.41, 0.86, 1, 0.52],
    crown: [0.88, 1, 0.65, 0.39, 0.45, 0.42, 0.26],
  },
  crusher: {
    length: 0.67,
    width: 1.32,
    depth: 1.09,
    lower: 0.87,
    bend: -0.34,
    breadth: [0.88, 1, 0.92, 0.65, 0.4, 0.18, 0.05],
    crown: [0.84, 1, 1.07, 1.03, 0.77, 0.41, 0.13],
  },
  shear: {
    length: 0.83,
    width: 1.4,
    depth: 0.69,
    lower: 0.93,
    bend: -0.47,
    breadth: [0.91, 1, 0.98, 0.88, 0.65, 0.32, 0.08],
    crown: [0.6, 0.82, 0.91, 0.8, 0.64, 0.44, 0.18],
  },
  scythe: {
    length: 1.54,
    width: 0.6,
    depth: 0.63,
    lower: 0.98,
    bend: -1.22,
    breadth: [0.82, 1, 0.76, 0.59, 0.43, 0.24, 0.06],
    crown: [0.77, 1, 0.85, 0.68, 0.43, 0.26, 0.09],
  },
};

export function beakCage(
  bill: boolean,
  lower: boolean,
  width: number,
  height: number,
  length: number,
  gape: number,
  profile: string | undefined,
): Cage {
  const cut = profile === undefined ? undefined : feedingBills[profile];
  width *= cut?.width ?? 1;
  height *= cut?.depth ?? 1;
  const long = length * (cut?.length ?? 1) * (lower ? (cut?.lower ?? (bill ? 0.96 : 0.77)) : 1);
  const rows = bill
    ? [
        [-0.12, 0.64, 0.94],
        [0.04, 0.68, 1],
        [0.27, 0.6, 0.66],
        [0.58, 0.8, 0.54],
        [0.81, 1, 0.49],
        [0.94, 0.81, 0.44],
        [1, 0.36, 0.31],
      ]
    : [
        [-0.13, 0.8, 0.82],
        [0.04, 1, 1],
        [0.27, 0.9, 1.05],
        [0.55, 0.65, 0.85],
        [0.78, 0.42, 0.65],
        [0.93, 0.18, 0.41],
        [1, 0.045, 0.13],
      ];
  const rings = rows.map(([t = 0, w = 0, h = 0], row) => {
    const at = Math.max(0, t);
    if (cut) {
      w = need(cut.breadth[row]);
      h = need(cut.crown[row]);
    }
    const arc = cut ? height * cut.bend * at ** 1.8 : 0;
    const y = cut
      ? arc - (lower ? height * 0.28 + long * at * Math.sin(gape * 0.49) : 0)
      : lower
        ? -height * 0.32 - long * at * Math.sin(gape * 0.49)
        : bill
          ? -at * height * 0.16
          : height * (0.21 * Math.sin(at * Math.PI) - 1.25 * Math.pow(at, 4));
    const W = width * w * (lower ? 0.89 : 1),
      H = height * h * (lower ? 0.58 : 1);
    const section = lower
      ? [
          [0, 0.16],
          [0.84, 0.15],
          [1, -0.05],
          [0.8, -0.57],
          [0, -1],
          [-0.8, -0.57],
          [-1, -0.05],
          [-0.84, 0.15],
        ]
      : [
          [0, 1],
          [0.62, 0.76],
          [0.93, 0.35],
          [1, -0.04],
          [0.82, -0.18],
          [0, -0.22],
          [-0.82, -0.18],
          [-1, -0.04],
          [-0.93, 0.35],
          [-0.62, 0.76],
        ];
    return section.map(([x = 0, d = 0]) => [x * W, y + d * H, t * long]);
  });
  return loft(rings);
}

export function mandibleCage(
  side: number,
  length: number,
  width: number,
  height: number,
  gape: number,
): Cage {
  const rows = [
    [-0.1, 0, 0.66],
    [0.04, 0.14, 1],
    [0.25, 0.4, 0.9],
    [0.43, 0.55, 0.66],
    [0.55, 0.57, 0.76],
    [0.64, 0.54, 0.47],
    [0.76, 0.39, 0.57],
    [0.86, 0.25, 0.31],
    [0.96, -0.04, 0.16],
    [1, -0.17, 0.025],
  ];
  return loft(
    rows.map(([t = 0, arc = 0, f = 0], i) => {
      const span = width * f,
        z = length * t,
        offset =
          side *
          (arc * width * 3.1 -
            width * 1.05 * Math.max(0, t) ** 3 +
            gape * Math.max(0, t) * length * 0.42);
      const inside = i === 4 || i === 6 ? 2.0 : 0.76,
        y = height * (-0.45 * Math.sin(Math.PI * t) + 1.38 * Math.max(0, t) ** 3);
      return [
        [0, 1],
        [0.81, 0.76],
        [1, -0.03],
        [0.65, -0.78],
        [-0.12, -0.8],
        [-inside, -0.06],
        [-0.61, 0.61],
      ].map(([x = 0, h = 0]) => [offset + side * x * span, y + h * height * f, z]);
    }),
  );
}

export function trunkTipCage(across: Vector3, axis: Vector3): Cage {
  const vertical = new Vector3().crossVectors(axis, across).normalize();
  const vertices: number[][] = [],
    faces: number[][] = [],
    ids = new Map<string, number>();
  const point = (x: number, y: number, z: number): number => {
    const key = [x, y, z].map((v) => v.toFixed(6)).join(",");
    if (!ids.has(key))
      ids.set(
        key,
        vertices.push(
          across
            .clone()
            .multiplyScalar(x)
            .addScaledVector(vertical, y)
            .addScaledVector(axis, z)
            .toArray(),
        ) - 1,
      );
    return need(ids.get(key));
  };
  const boundary = [
    [0, 1],
    [0.63, 0.94],
    [1, 0.51],
    [1.08, -0.03],
    [0.92, -0.58],
    [0.5, -0.83],
    [0, -0.76],
  ];
  for (const side of [1, -1]) {
    const outer = boundary.map(([x = 0, y = 0]) => point(x * side, y, 1.05));
    const rear = boundary.map(([x = 0, y = 0]) => point(x * 0.9 * side, y * 0.92, -0.55));
    const inner = boundary.map(([x = 0, y = 0]) =>
      point(side * (0.49 + (x - 0.49) * 0.62), 0.07 + (y - 0.07) * 0.65, 1.26),
    );
    const cavity = boundary.map(([x = 0, y = 0]) =>
      point(side * (0.49 + (x - 0.49) * 0.4), 0.07 + (y - 0.07) * 0.44, 0.43),
    );
    const polygons: number[][] = [];
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      if (j !== 0) polygons.push([need(rear[i]), need(rear[j]), need(outer[j]), need(outer[i])]);
      polygons.push(
        [need(outer[i]), need(outer[j]), need(inner[j]), need(inner[i])],
        [need(inner[i]), need(inner[j]), need(cavity[j]), need(cavity[i])],
      );
    }
    polygons.push(cavity, [...rear].reverse());
    for (const polygon of polygons) faces.push(side === 1 ? polygon : [...polygon].reverse());
  }
  return finish(vertices, faces);
}

function webbedFoot(digits: number, ankle: number): Cage {
  const n = Math.max(2, Math.min(digits || 2, 6)),
    columns = 2 * n - 1;
  const vertices: number[][] = [],
    faces: number[][] = [],
    rows: { top: number[]; bottom: number[] }[] = [];
  for (const [z = 0, w = 0, high = 0, notch = 0] of [
    [-1.38, 0.42, 0.72, 0],
    [-0.64, 0.88, ankle * 1.3 + 1.55, 0],
    [0.48, 1.42, 1.03, 0.04],
    [2.23, 2.31, 0.69, 0.16],
    [3.64, 2.91, 0.48, 0.53],
    [5.65, 3.42, 0.31, 1.41],
  ]) {
    const top: number[] = [],
      bottom: number[] = [];
    for (let j = 0; j < columns; j++) {
      const u = (2 * j) / (columns - 1) - 1,
        between = j % 2 === 1;
      const reach = z - Math.max(0, z) * 0.17 * u * u - (between ? notch : 0);
      const y = 0.045 + 0.04 * u * u;
      bottom.push(vertices.push([u * w, y - ankle, reach]) - 1);
      top.push(
        vertices.push([
          u * w,
          high * (1 - 0.22 * u * u) * (between && notch > 0.1 ? 0.61 : 1) - ankle,
          reach,
        ]) - 1,
      );
    }
    rows.push({ top, bottom });
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const a = need(rows[i]),
      b = need(rows[i + 1]),
      last = columns - 1;
    for (let j = 0; j < last; j++)
      faces.push(
        [need(a.top[j]), need(b.top[j]), need(b.top[j + 1]), need(a.top[j + 1])],
        [need(a.bottom[j]), need(a.bottom[j + 1]), need(b.bottom[j + 1]), need(b.bottom[j])],
      );
    faces.push(
      [need(a.bottom[0]), need(b.bottom[0]), need(b.top[0]), need(a.top[0])],
      [need(a.bottom[last]), need(a.top[last]), need(b.top[last]), need(b.bottom[last])],
    );
  }
  for (let j = 0; j < columns - 1; j++) {
    const a = need(rows[0]),
      b = need(rows.at(-1));
    faces.push(
      [need(a.bottom[j]), need(a.top[j]), need(a.top[j + 1]), need(a.bottom[j + 1])],
      [need(b.bottom[j]), need(b.bottom[j + 1]), need(b.top[j + 1]), need(b.top[j])],
    );
  }
  return finish(vertices, faces);
}

const footProfiles: Record<string, FootProfile> = {
  hoof: { width: 1.62, length: 2.85, spread: 0.45 },
  talons: { width: 1.43, length: 5.7, spread: 3.15 },
  point: { width: 0.81, length: 3.06, spread: 0.85 },
  tarsus: { width: 0.81, length: 4.15, spread: 0.85 },
  pad: { width: 1.83, length: 2.65, spread: 0.5 },
  paw: { width: 1.73, length: 3.96, spread: 1.05 },
};

function toeRay(profile: FootProfile, count: number, digit: number) {
  const side = (2 * digit + 1) / count - 1;
  return {
    centre: side * profile.width,
    shift: side * profile.spread,
    reach: profile.length * (1 - (profile === footProfiles["hoof"] ? 0.03 : 0.18) * Math.abs(side)),
  };
}

export function nailKnots(end: string, count: number, digit: number): number[][] {
  const ray = toeRay(need(footProfiles[end]), count, digit);
  return [
    [0.7, 0.53],
    [0.83, 0.54],
    [0.97, 0.28],
    [1.08, 0.08],
  ].map(([t = 0, h = 0]) => [ray.centre + t * ray.shift, h, lerp(1.12, ray.reach, t)]);
}

export function footCage(end: string, style: string, digits: number, ankleRatio: number): Cage {
  if (end === "paddle") return webbedFoot(digits, ankleRatio);
  if (!digits && (end === "paw" || end === "talons")) end = "pad";
  const hoof = end === "hoof",
    claw = end === "talons",
    point = end === "point";
  const n = hoof ? 2 : point ? (style === "insect" ? 2 : 1) : Math.max(1, Math.min(6, digits || 1));
  const profile = need(footProfiles[point && style === "insect" ? "tarsus" : end]),
    soleWidth = profile.width;
  const vertices: number[][] = [],
    faces: number[][] = [];
  const index = (x: number, y: number, z: number) => vertices.push([x, y - ankleRatio, z]) - 1;
  const body: { low: number[]; up: number[] }[] = [];
  const heelBack = claw ? -2.75 : point ? -1.13 : hoof ? -1.46 : -1.55;
  for (const [z = 0, half = 0, high = 0, bottom = 0] of [
    [heelBack, 0.48, claw ? 0.32 : 0.72, 0.14],
    [-0.73, 0.82, ankleRatio * 1.3 + 1.55, 0.023],
    [0.4, soleWidth, Math.max(1.12, ankleRatio * 0.65), 0.018],
    [1.12, soleWidth, hoof ? 1.33 : 1.03, 0.037],
  ]) {
    const low: number[] = [],
      up: number[] = [];
    for (let j = 0; j <= n; j++) {
      const u = (2 * j) / n - 1;
      low.push(index(u * half, bottom + 0.065 * u * u, z));
      up.push(index(u * half, high * (1 - 0.29 * u * u), z));
    }
    body.push({ low, up });
  }
  for (let i = 0; i < body.length - 1; i++) {
    const a = need(body[i]),
      b = need(body[i + 1]);
    for (let j = 0; j < n; j++)
      faces.push(
        [need(a.low[j]), need(a.low[j + 1]), need(b.low[j + 1]), need(b.low[j])],
        [need(a.up[j]), need(b.up[j]), need(b.up[j + 1]), need(a.up[j + 1])],
      );
    faces.push(
      [need(a.low[0]), need(b.low[0]), need(b.up[0]), need(a.up[0])],
      [need(a.low[n]), need(a.up[n]), need(b.up[n]), need(b.low[n])],
    );
  }
  const heel = need(body[0]),
    front = need(body.at(-1));
  for (let j = 0; j < n; j++) {
    faces.push([need(heel.low[j]), need(heel.up[j]), need(heel.up[j + 1]), need(heel.low[j + 1])]);
    const ray = toeRay(profile, n, j);
    let ring: number[] = [
      need(front.low[j]),
      need(front.low[j + 1]),
      need(front.up[j + 1]),
      need(front.up[j]),
    ];
    const half = soleWidth / n;
    const samples = hoof
      ? [
          [0.13, 1.02, 0.03, 1.48],
          [0.72, 0.97, 0.025, 0.97],
          [1, 0.71, 0.033, 0.49],
        ]
      : claw || point
        ? [
            [0.22, 0.78, 0.09, 0.8],
            [0.49, 0.62, 0.055, 0.63],
            [0.74, 0.49, 0.27, 0.75],
            [0.91, 0.31, 0.19, 0.47],
            [1, 0.075, 0.035, 0.16],
          ]
        : [
            [0.21, 0.93, 0.03, 0.96],
            [0.62, 0.91, 0.025, 1.0],
            [0.87, 0.81, 0.08, 0.8],
            [1, 0.48, 0.17, 0.52],
          ];
    for (const [t = 0, width = 0, low = 0, hi = 0] of samples) {
      const x = ray.centre + ray.shift * t,
        z = lerp(1.12, ray.reach, t),
        h = half * width;
      const next = [
        index(x - h, low, z),
        index(x + h, low, z),
        index(x + h, hi, z),
        index(x - h, hi, z),
      ];
      for (let k = 0; k < 4; k++) {
        let m = (k + 1) % 4;
        faces.push([need(ring[k]), need(ring[m]), need(next[m]), need(next[k])]);
      }
      ring = next;
    }
    faces.push(ring);
  }
  return finish(vertices, faces);
}
