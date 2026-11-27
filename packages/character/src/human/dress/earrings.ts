import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { HumanSurface } from "../surface.js";
import { boneNames } from "../catalogue.js";
import { earSources } from "./strand-groom.js";
import type { HumanBody } from "../body.js";
export interface EarringStyle {
  readonly earrings?: string;
  readonly metalColor?: string;
  readonly clothAccent?: string;
}

export const earringStyles = [
  "None",
  "Pearl studs",
  "Hammered hoops",
  "Enamel drops",
  "Single ear pendant",
  "Sea fan ear cuffs",
];

function lobe(surface: HumanSurface, sign: number, scale: number, ear: ReadonlySet<number>) {
  const p = surface.positions;
  let low = Infinity,
    best = -Infinity,
    anchor;
  for (let i = 0; i < surface.ids.length; i++)
    if ((p[3 * i] ?? 0) * sign > 0 && ear.has(surface.ids[i] ?? -1))
      low = Math.min(low, p[3 * i + 1] ?? 0);
  for (let i = 0; i < surface.ids.length; i++) {
    const x = (p[3 * i] ?? 0) * sign,
      y = p[3 * i + 1] ?? 0,
      z = p[3 * i + 2] ?? 0;
    if (x <= 0 || !ear.has(surface.ids[i] ?? -1) || y > low + 0.012 * scale) continue;
    const score = x + 0.35 * z - 0.75 * Math.abs(y - low - 0.004 * scale);
    if (score > best) {
      best = score;
      anchor = new T.Vector3(x * sign, y, z);
    }
  }
  return anchor;
}

function seaFan(
  metal: T.BufferGeometry[],
  stones: T.BufferGeometry[],
  anchor: T.Vector3,
  sign: number,
  scale: number,
) {
  const size = scale * (sign === 1 ? 1 : 0.71);
  const point = (x: number, y: number, z: number) =>
    new T.Vector3(anchor.x + sign * x * size, anchor.y + y * size, anchor.z + z * size);
  const rod = (points: T.Vector3[], radius: number) => {
    const curve = new T.CatmullRomCurve3(points);
    metal.push(new T.TubeGeometry(curve, 10, radius * size, 5, false));
  };
  rod(
    [
      point(0, 0, 0.001),
      point(0.007, 0.016, -0.002),
      point(0.009, 0.034, -0.014),
      point(0.004, 0.049, -0.021),
      point(-0.002, 0.047, -0.023),
    ],
    0.0022,
  );
  const blades: [number, number, number, number][] = [
    [0.016, 0.089, -0.025, 0.012],
    [0.036, 0.082, -0.027, 0.012],
    [0.051, 0.063, -0.029, 0.013],
    [0.056, 0.041, -0.03, 0.012],
    [0.05, 0.021, -0.03, 0.009],
  ];
  for (const [i, [x, y, z, width]] of blades.entries()) {
    const start = point(0.005, 0.034 - i * 0.005, -0.013 + i * 0.002);
    const tip = point(x, y, z);
    const across = new T.Vector3(-sign * (y - (0.034 - i * 0.005)), x - 0.005, 0).normalize();
    const mid = start.clone().lerp(tip, 0.6);
    const left = mid.clone().addScaledVector(across, width * size * 0.5);
    const right = mid.clone().addScaledVector(across, -width * size * 0.5);
    rod([start, left, tip], 0.00145);
    rod([start, right, tip], 0.00145);
    const gem = new T.OctahedronGeometry(1);
    const axis = tip.clone().sub(start);
    const length = axis.length();
    const centre = start.clone().lerp(tip, 0.69);
    centre.z += 0.0008 * size;
    gem.scale(width * 0.38 * size, length * 0.245, 0.0029 * size);
    gem.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()),
    );
    stones.push(gem.translate(centre.x, centre.y, centre.z));
  }
  const drop = point(0.006, -0.03, 0.001);
  rod([point(0.001, 0, 0.003), point(0.008, -0.009, 0.004), point(0.005, -0.021, 0.002)], 0.0012);
  stones.push(
    new T.SphereGeometry(1, 9, 6)
      .scale(0.0048 * size, 0.0095 * size, 0.004 * size)
      .translate(drop.x, drop.y, drop.z),
  );
}

export function fittedEarrings(
  body: HumanBody,
  surface: HumanSurface,
  style: EarringStyle,
  material: (color: string, kind: string) => T.Material,
  plain: boolean,
) {
  const cut = style.earrings === "Hoops" ? "Hammered hoops" : style.earrings;
  if (!cut || cut === "None" || !earringStyles.includes(cut)) return [];
  const scale = (surface.joints[boneNames.indexOf("head") * 3 + 1] || 1.55) / 1.55;
  const metal: T.BufferGeometry[] = [],
    stones: T.BufferGeometry[] = [];
  for (const sign of cut === "Single ear pendant" ? [1] : [-1, 1]) {
    const anchor = lobe(surface, sign, scale, earSources(body));
    if (!anchor) continue;
    const rotation = sign * 0.66;
    const place = (g: T.BufferGeometry, x: number, y: number, z: number) =>
      g
        .translate(x, y, z)
        .rotateY(rotation)
        .scale(scale, scale, scale)
        .translate(anchor.x, anchor.y, anchor.z);
    const bead = (
      parts: T.BufferGeometry[],
      dx: number,
      dy: number,
      dz: number,
      rx: number,
      ry: number,
      rz: number,
      facets = 10,
    ) => {
      const g = new T.SphereGeometry(1, facets, 6).scale(rx, ry, rz);
      parts.push(place(g, dx, dy, dz));
    };
    const loop = (height: number, width: number, tube: number, y: number, tilt = 0) => {
      const g = new T.TorusGeometry(1, tube / width, 6, 24);
      g.scale(width, height, width).rotateY(tilt);
      metal.push(place(g, sign * 0.001, y, 0.001));
    };
    if (cut === "Sea fan ear cuffs") {
      seaFan(metal, stones, anchor, sign, scale);
    } else if (cut === "Pearl studs") {
      bead(metal, sign * 0.001, 0, 0.001, 0.0049, 0.0049, 0.0026);
      bead(stones, sign * 0.002, 0, 0.0032, 0.0046, 0.0046, 0.0042);
    } else if (cut === "Hammered hoops") {
      const g = new T.TorusGeometry(0.014, 0.0015, 6, 28);
      const p = g.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          y = p.getY(i),
          z = p.getZ(i);
        const a = Math.atan2(y, x),
          r = 0.014,
          thick = 1.2 - 0.62 * Math.sin(a);
        p.setXYZ(
          i,
          r * Math.cos(a) + (x - r * Math.cos(a)) * thick,
          r * Math.sin(a) + (y - r * Math.sin(a)) * thick,
          z * thick,
        );
      }
      g.computeVertexNormals();
      metal.push(place(g.rotateY(sign * 0.45), sign * 0.001, -0.0135, 0.0005));
    } else {
      const long = cut === "Single ear pendant";
      bead(metal, sign * 0.001, 0, 0.001, 0.0031, 0.0031, 0.0029);
      loop(0.005, 0.0031, 0.0009, -0.006, sign * 0.55);
      const y = long ? -0.029 : -0.02;
      if (long) loop(0.009, 0.0026, 0.00075, -0.016, sign * -0.4);
      const gem = new T.OctahedronGeometry(1).scale(0.0065, 0.01, 0.0036);
      stones.push(place(gem, sign * 0.001, y, 0.001));
      loop(0.0097, 0.0068, 0.00095, y);
      bead(metal, sign * 0.001, y - 0.01, 0.001, 0.0019, 0.0019, 0.0019);
    }
  }
  const make = (
    parts: T.BufferGeometry[],
    colour: string,
    kind: string,
    roughness: number,
    metallic: number,
  ) => {
    if (!parts.length) return [];
    const buffers = parts.map((g) => (g.index ? g.toNonIndexed() : g));
    const geometry = mergeGeometries(buffers);
    for (const g of new Set([...buffers, ...parts])) g.dispose();
    const mat = material(colour, kind).clone();
    if (!plain && mat instanceof T.MeshStandardMaterial) {
      mat.roughness = roughness;
      mat.metalness = metallic;
    }
    mat.userData["fibreLOD"] = true;
    const mesh = new T.Mesh(geometry, mat);
    mesh.name =
      style.earrings === "Hoops" && kind === "metal"
        ? "Hoops"
        : cut + (kind === "metal" ? " settings" : " inlay");
    mesh.userData["styleRegion"] = "head";
    mesh.castShadow = true;
    return [{ mesh, region: "head" }];
  };
  const pearl = cut === "Pearl studs";
  return [
    ...make(metal, style.metalColor ?? "#bf9860", "metal", 0.29, 0.72),
    ...make(
      stones,
      pearl ? "#eadac1" : (style.clothAccent ?? "#2d8881"),
      "cloth",
      pearl ? 0.31 : 0.2,
      0.12,
    ),
  ];
}
