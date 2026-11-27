import * as T from "three";
import type { FigureCage, Finish, PlateField, PlateFieldRest, Vec3 } from "@irudd/document";
import { randomStream } from "../random.js";
import { sweepGeometry } from "./sweep.js";
import type { BuildPart } from "../view.js";

const stations = [
  [0, 0.55, 0.12, 0],
  [0.1, 0.82, 0.39, 0.004],
  [0.2, 0.96, 0.69, 0.012],
  [0.25, 0.98, 0.58, 0.018],
  [0.35, 1, 0.89, 0.028],
  [0.4, 0.98, 0.69, 0.04],
  [0.48, 0.96, 1, 0.055],
  [0.53, 0.93, 0.76, 0.07],
  [0.63, 0.82, 0.86, 0.1],
  [0.68, 0.77, 0.65, 0.13],
  [0.79, 0.57, 0.57, 0.21],
  [0.9, 0.32, 0.29, 0.33],
  [1, 0.075, 0.095, 0.45],
] as const;
const ring = [
  [-1, 0],
  [-0.69, 0.47],
  [-0.19, 0.8],
  [0.015, 1],
  [0.63, 0.5],
  [1, 0],
  [0.58, -0.22],
  [-0.58, -0.22],
] as const;

export function hasPlatedAxis(part: BuildPart | undefined): boolean {
  if (!part?.sweep || !part.plateField) return false;
  const role = part.motion ?? part.wear.role;
  return role === "tail" || role === "axial spine";
}

interface Control {
  readonly p: T.Vector3;
  readonly u: number;
  readonly v: number;
}

function growthUv(
  geometry: T.BufferGeometry,
  part: BuildPart,
  cageFaces: ReadonlyArray<number> | undefined,
): Uint8Array | undefined {
  const cage = part.cage;
  const width = ring.length;
  const count = stations.length;
  const expected = 2 + (count - 1) * width;
  if (
    !cage ||
    cage.vertices.length !== count * width ||
    cage.faces.length !== expected ||
    !cageFaces
  )
    return undefined;
  const coords: Control[] = cage.vertices.map((v, i) => {
    const row = Math.floor(i / width);
    const col = i % width;
    return {
      p: new T.Vector3(...v),
      u: 0.5 + 0.5 * (ring[col]?.[0] ?? 0) * (stations[row]?.[1] ?? 0),
      v: 1 - (stations[row]?.[0] ?? 0),
    };
  });
  const control = (i: number | undefined): Control => {
    const c = i === undefined ? undefined : coords[i];
    if (!c) throw new Error(`Plate ${part.id} names a missing cage vertex.`);
    return c;
  };
  const triangles = cage.faces.map((face) => {
    const first = control(face[0]);
    return face.slice(1, -1).map((id, i) => {
      const b = control(id);
      const c = control(face[i + 2]);
      return { triangle: new T.Triangle(first.p, b.p, c.p), controls: [first, b, c] as const };
    });
  });
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  if (!index) return undefined;
  const seen = new Uint8Array(pos.count);
  const at = new T.Vector3();
  const point = new T.Vector3();
  const closest = new T.Vector3();
  const weights = new T.Vector3();
  const underside = new Uint8Array(pos.count);
  for (let i = 0; i < index.count; i++) {
    const v = index.getX(i);
    if (seen[v]) continue;
    seen[v] = 1;
    const face = cageFaces[Math.floor(i / 3)] ?? 0;
    let best: (typeof triangles)[number][number] | undefined;
    let dist = Infinity;
    at.fromBufferAttribute(pos, v);
    for (const patch of triangles[face] ?? []) {
      patch.triangle.closestPointToPoint(at, point);
      const d = at.distanceToSquared(point);
      if (d < dist) {
        best = patch;
        dist = d;
        closest.copy(point);
      }
    }
    if (!best || !best.triangle.getBarycoord(closest, weights)) continue;
    const [a, b, c] = best.controls;
    uv.setXY(
      v,
      weights.x * a.u + weights.y * b.u + weights.z * c.u,
      weights.x * a.v + weights.y * b.v + weights.z * c.v,
    );
    if (face > 0 && face < expected - 1 && (face - 1) % width >= 5) underside[v] = 1;
  }
  return underside;
}

export function finishPlateSurface(
  mesh: T.Mesh,
  part: BuildPart,
  cageFaces: ReadonlyArray<number> | undefined,
  materials: (color: string, finish: Finish) => T.Material,
): void {
  const g = mesh.geometry;
  const lower = growthUv(g, part, cageFaces);
  if (!lower) return;
  const base = new T.Color(part.color);
  const uv = g.getAttribute("uv");
  const rgb = new Float32Array(3 * uv.count);
  const tileX = part.hornSwatch % 2;
  const tileY = Math.floor(part.hornSwatch / 2);
  for (let i = 0; i < uv.count; i++) {
    const t = 1 - uv.getY(i);
    const shade = lower[i] ? 0.54 : 0.83 + 0.17 * t;
    uv.setXY(i, (tileX + 0.025 + 0.95 * uv.getX(i)) / 2, (tileY + 0.025 + 0.95 * uv.getY(i)) / 2);
    rgb[i * 3] = base.r * shade;
    rgb[i * 3 + 1] = base.g * shade;
    rgb[i * 3 + 2] = base.b * shade;
  }
  g.setAttribute("color", new T.Float32BufferAttribute(rgb, 3));
  const shared = materials("#ffffff", "horn");
  shared.vertexColors = true;
  if (shared instanceof T.MeshStandardMaterial) shared.roughness = 0.72;
  mesh.material = shared;
}

const rounded = (v: number) => Math.round(v * 1e8) / 1e8;
const xyz = (v: T.Vector3): Vec3 => [rounded(v.x), rounded(v.y), rounded(v.z)];
const directions = {
  Back: [0, 0, -1],
  Front: [0, 0, 1],
  Left: [1, 0, 0],
  Right: [-1, 0, 0],
  Top: [0, 1, 0],
};
function stream(seed: number, row: number, column: number) {
  return randomStream(
    (seed ^ Math.imul(row + 1, 0x9e3779b1) ^ Math.imul(column + 1, 0x85ebca77)) >>> 0,
  );
}

export function surfaceChart(rest: PlateFieldRest, settings: PlateField) {
  const geometry = sweepGeometry(rest.knots, rest.horizontal, 8);
  const positions = geometry.getAttribute("position"),
    rings: { center: T.Vector3; across: T.Vector3; depth: T.Vector3; distance: number }[] = [];
  let length = 0;
  for (let i = 0; i < positions.count; i += 9) {
    const first = new T.Vector3().fromBufferAttribute(positions, i);
    const center = new T.Vector3().fromBufferAttribute(positions, i + 4).lerp(first, 0.5);
    const last = rings.at(-1);
    if (last) length += center.distanceTo(last.center);
    rings.push({
      center,
      across: first.sub(center),
      depth: new T.Vector3().fromBufferAttribute(positions, i + 2).sub(center),
      distance: length,
    });
  }
  geometry.dispose();
  if (length < 0.015) throw new Error("Choose a longer carrier for the plate field.");
  const mount = new T.Vector3(...rest.frameSize);
  function section(t: number) {
    const distance = T.MathUtils.clamp(t, 0, 1) * length;
    let lo = 0,
      hi = rings.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((rings[mid]?.distance ?? 0) < distance) lo = mid;
      else hi = mid;
    }
    const a = rings[lo],
      b = rings[hi];
    if (!a || !b) throw new Error("Missing plate section.");
    const f = (distance - a.distance) / (b.distance - a.distance || 1);
    return {
      center: a.center.clone().lerp(b.center, f),
      across: a.across.clone().lerp(b.across, f),
      depth: a.depth.clone().lerp(b.depth, f),
    };
  }
  let face = settings.face;
  if (settings.mirrored && ["Left", "Right"].includes(face))
    face = face === "Left" ? "Right" : "Left";
  const middle = section((settings.start + settings.end) / 2);
  const across = middle.across.clone().normalize(),
    depth = middle.depth.clone().normalize();
  let outward = new T.Vector3(...directions[face]);
  if (Math.hypot(outward.dot(across), outward.dot(depth)) < 0.05) {
    outward.set(0, 1, 0);
    if (Math.hypot(outward.dot(across), outward.dot(depth)) < 0.05) outward.copy(depth);
  }
  const centerAngle = Math.atan2(
    outward.dot(depth) / middle.depth.length(),
    outward.dot(across) / middle.across.length(),
  );
  function point(t: number, angle: number) {
    const ring = section(t);
    return ring.center
      .addScaledVector(ring.across, Math.cos(angle))
      .addScaledVector(ring.depth, Math.sin(angle));
  }
  function normal(t: number, angle: number) {
    const along = point(t + 0.0003, angle).sub(point(t - 0.0003, angle));
    const around = point(t, angle + 0.001).sub(point(t, angle - 0.001));
    const n = around.cross(along).normalize();
    if (n.dot(point(t, angle).sub(section(t).center)) < 0) n.negate();
    return n;
  }
  const arcs = new Map<number, number[]>();
  function arcMeridian(t: number, fraction: number) {
    const side = fraction < 0 ? -1 : 1,
      key = side * (t + 1);
    let table = arcs.get(key);
    const delta = (side * T.MathUtils.degToRad(settings.wrap)) / 48;
    if (!table) {
      table = [0];
      const ring = section(t),
        width = ring.across.length(),
        depth = ring.depth.length();
      let prevX = width * Math.cos(centerAngle),
        prevY = depth * Math.sin(centerAngle);
      for (let i = 1; i <= 36; i++) {
        const a = centerAngle + i * delta,
          x = width * Math.cos(a),
          y = depth * Math.sin(a);
        table.push((table[i - 1] ?? 0) + Math.hypot(x - prevX, y - prevY));
        prevX = x;
        prevY = y;
      }
      arcs.set(key, table);
    }
    const target = Math.min(table[36] ?? 0, Math.abs(fraction) * (table[24] ?? 0));
    let i = 1;
    while (i < 36 && (table[i] ?? 0) < target) i++;
    return (
      centerAngle +
      delta *
        (i - 1 + (target - (table[i - 1] ?? 0)) / ((table[i] ?? 0) - (table[i - 1] ?? 0) || 1))
    );
  }
  return { length, point, normal, arcMeridian, mount };
}

export function makePlate(
  chart: ReturnType<typeof surfaceChart>,
  settings: PlateField,
  row: number,
  column: number,
) {
  const draw = stream(settings.seed, row, column),
    tip = stream(settings.tipSeed, row, column);
  const rank = Math.ceil(column / 2) * (column % 2 ? -1 : 1);
  const phase = (Math.abs(rank) % 2 === 1 ? 0.16 : -0.12) + (draw() - 0.5) * 0.13;
  const u = (row + 0.5 + phase) / settings.rows;
  const s = T.MathUtils.lerp(settings.start, settings.end, u),
    pitch = (settings.end - settings.start) / settings.rows;
  const edge = (2 * Math.abs(rank)) / settings.columns;
  const dorsal = Math.exp(-2.25 * edge * edge);
  const flex = 0.53 + 0.47 * Math.sin(Math.PI * u) ** 0.62;
  const sign = settings.direction === "first" ? -1 : 1;
  const angularCell = 2 / settings.columns;
  const side =
    rank * angularCell +
    angularCell * ((row % 2 ? 0.14 : -0.14) * (column ? 1 : 0.42) + (draw() - 0.5) * 0.06);
  const spin = chart.arcMeridian(s, side);
  const angle0 = chart.arcMeridian(s, side - angularCell * 0.4),
    angle1 = chart.arcMeridian(s, side + angularCell * 0.4);
  const width = chart.point(s, angle0).distanceTo(chart.point(s, angle1)) / 0.8;
  const span = Math.min(
    settings.end - settings.start,
    pitch * (0.89 + 0.23 * dorsal) * flex * (1 + 0.9 * settings.overlap) * (0.96 + 0.08 * draw()),
  );
  const length = chart.length * span;
  if (Math.min(width, length) < 0.011)
    throw new Error("Choose a longer or wider carrier, or use fewer plates.");
  const height = Math.min(width, length) * (0.11 + settings.crest * (0.12 + 0.49 * dorsal)) * flex;
  const root = T.MathUtils.clamp(
    s - sign * span * 0.34,
    settings.start + (sign < 0 ? span : 0),
    settings.end - (sign > 0 ? span : 0),
  );
  const widthFactor = (0.83 + 0.19 * dorsal) * (0.77 + 0.23 * flex) * (0.97 + 0.08 * draw());
  const flare = (draw() - 0.5) * 0.06 + rank * 0.11;
  const sway = (tip() - 0.5) * 0.3,
    curl = (tip() - 0.5) * 0.63,
    chip = tip() * 0.32,
    chippedSide = tip() < 0.5 ? -1 : 1;
  const base = chart.point(T.MathUtils.clamp(root, settings.start, settings.end), spin);
  const vertices: Vec3[] = [];
  const rise = settings.rise ?? 1;
  for (const [t, envelope, ridge, lift] of stations) {
    const distal = T.MathUtils.smoothstep(t, 0.52, 1);
    const free = T.MathUtils.smoothstep(t, 0.1, 0.95);
    const tilt = Math.max(0, rise - 1) * height * free * (0.35 + 0.8 * t);
    const flatten = 1 + Math.min(0, rise - 1) * free;
    for (const [x, z] of ring) {
      const swept = t - 0.16 * Math.abs(x) ** 1.3 * Math.sin(Math.PI * t);
      const pathT = root + sign * span * swept;
      const edgeLoss = Math.sign(x) === chippedSide ? chip * distal * Math.abs(x) : 0;
      const cross =
        side +
        (x * envelope * widthFactor * 0.55 * (1 - edgeLoss) + t * t * flare + distal * sway) *
          angularCell;
      const angle = chart.arcMeridian(pathT, cross);
      const h =
        height * (z * ridge + lift * (1 + curl * distal)) * flatten +
        tilt -
        Math.min(0.004, height * 0.13) * (1 - t);
      const v = chart
        .point(pathT, angle)
        .addScaledVector(chart.normal(pathT, angle), h)
        .sub(base)
        .multiply(chart.mount);
      if (settings.mirrored) v.x *= -1;
      vertices.push(xyz(v));
    }
  }
  const faces = [],
    creaselines: [number, number][] = [];
  const k = ring.length;
  faces.push(Array.from({ length: k }, (_, i) => k - 1 - i));
  for (let r = 0; r < stations.length - 1; r++) {
    for (let c = 0; c < k; c++) {
      const n = (c + 1) % k,
        a = r * k + c,
        b = r * k + n;
      faces.push([a, b, b + k, a + k]);
    }
    for (const c of [0, 5]) creaselines.push([r * k + c, (r + 1) * k + c]);
    if (r > 0 && r < stations.length - 2) creaselines.push([r * k + 3, (r + 1) * k + 3]);
  }
  faces.push(Array.from({ length: k }, (_, i) => (stations.length - 1) * k + i));
  if (sign < 0 !== settings.mirrored) for (const face of faces) face.reverse();
  const position = base.clone().multiply(chart.mount);
  if (settings.mirrored) position.x *= -1;
  const tone = new T.Color(settings.color).multiplyScalar(0.83 + 0.12 * dorsal + 0.19 * draw());
  return {
    position: xyz(position),

    color: "#" + tone.getHexString(),

    hornSwatch: Math.floor(stream(0x418a59d3, row, column)() * 4),

    cage: { vertices, faces, creases: creaselines, levels: 1 as const },
    surfaceJoin: {
      faces: [0],
      depth: T.MathUtils.clamp(height * 0.09, 0.001, 0.006),
    },
    plateSite: { row, column },
  };
}

export function legacyPlateCage(row: number, column: number): FigureCage {
  const width = ring.length,
    vertices: Vec3[] = [],
    faces: number[][] = [],
    creases: [number, number][] = [];
  const bend = Math.sin((row + 1) * 19.73 + column * 7.87) * 0.09;
  for (const [t, envelope, ridge, lift] of stations)
    for (const [x, z] of ring) {
      vertices.push([
        x * envelope * 0.5 + bend * t * t,
        0.5 - t + 0.08 * Math.abs(x) * Math.sin(Math.PI * t),
        z * ridge + lift,
      ]);
    }
  faces.push(Array.from({ length: width }, (_, i) => width - 1 - i));
  for (let r = 0; r < stations.length - 1; r++) {
    for (let c = 0; c < width; c++) {
      const a = r * width + c,
        b = r * width + ((c + 1) % width);
      faces.push([a, b, b + width, a + width]);
    }
    for (const c of [0, 5, 3]) creases.push([r * width + c, (r + 1) * width + c]);
  }
  faces.push(Array.from({ length: width }, (_, i) => (stations.length - 1) * width + i));
  return { vertices, faces, creases, levels: 1 };
}
