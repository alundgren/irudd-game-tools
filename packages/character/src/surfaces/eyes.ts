import { context2d, drawable, type Raster } from "../raster.js";
import type { FigureEyes } from "@irudd/document";
import * as T from "three";
import { faceProjector } from "../rig/expressions.js";
import type { HeadSpace } from "./face.js";

export const gazeNames = ["LookLeft", "LookRight", "LookUp", "LookDown"] as const;

type Point = readonly [number, number, number];

interface Surface {
  readonly p: number[];
  readonly uv: number[];
  readonly rgb: number[];
  readonly idx: number[];
  readonly targets: Map<string, number[]>;
}

const surface = (targets: ReadonlyArray<string> = []): Surface => ({
  p: [],
  uv: [],
  rgb: [],
  idx: [],
  targets: new Map(targets.map((n) => [n, []])),
});

function put(
  s: Surface,
  p: Point,
  uv: readonly [number, number],
  rgb: T.Color | null,
  poses: Readonly<Record<string, Point>> = {},
): number {
  const i = s.p.length / 3;
  s.p.push(...p);
  s.uv.push(...uv);
  if (rgb) s.rgb.push(rgb.r, rgb.g, rgb.b);
  for (const [name, row] of s.targets) {
    const next = poses[name] ?? p;
    row.push(next[0] - p[0], next[1] - p[1], next[2] - p[2]);
  }
  return i;
}

const quad = (s: Surface, a: number, b: number, c: number, d: number) =>
  s.idx.push(a, b, d, b, c, d);

function geometry(s: Surface): T.BufferGeometry {
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(s.p, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(s.uv, 2));
  if (s.rgb.length) g.setAttribute("color", new T.Float32BufferAttribute(s.rgb, 3));
  g.setIndex(s.idx);
  g.computeVertexNormals();
  const poses = [...s.targets];
  if (poses.length) {
    g.morphTargetsRelative = true;
    g.morphAttributes["position"] = poses.map(([name, arr]) => {
      const a = new T.Float32BufferAttribute(arr, 3);
      a.name = name;
      return a;
    });
    const base = g.getAttribute("normal").array;
    g.morphAttributes["normal"] = poses.map(([name, arr]) => {
      const posed = new T.BufferGeometry();
      posed.setAttribute(
        "position",
        new T.Float32BufferAttribute(
          s.p.map((v, i) => v + (arr[i] ?? 0)),
          3,
        ),
      );
      posed.setIndex(g.index);
      posed.computeVertexNormals();
      const after = posed.getAttribute("normal").array;
      const delta = new T.Float32BufferAttribute(
        Array.from(after, (v, i) => v - (base[i] ?? 0)),
        3,
      );
      delta.name = name;
      posed.dispose();
      return delta;
    });
  }
  return g;
}

function frame(mesh: T.Mesh, paint: HeadSpace | undefined) {
  const g = mesh.geometry;
  g.computeBoundingBox();
  const box = g.boundingBox ?? new T.Box3();
  const dim = box.getSize(new T.Vector3());
  const c = box.getCenter(new T.Vector3());
  const face = paint?.portrait;
  const h = face && paint ? paint.height : dim.y;
  return {
    h,
    half: face ? face.width * h : dim.x * 0.5,
    cx: face && paint ? face.center * h - paint.offset[0] : c.x,
    cy: face && paint ? face.eyes * h - paint.offset[1] : box.min.y + 0.566 * h,
    probe: faceProjector(g),
  };
}

export function attachEyes(
  mesh: T.Mesh,
  settings: FigureEyes,
  paint: HeadSpace | undefined,
  uniform: T.Material | null = null,
): boolean {
  const { h, half, cx, cy, probe } = frame(mesh, paint);
  const lids = surface(["Blink"]);
  const whites = surface();
  const irises = surface(gazeNames);
  const pigment = new T.Color(settings.color);
  const sclera = new T.Color("#c1b6a7");
  const corner = new T.Color("#9f7870");
  const preservePaint = Boolean(settings.source);
  const aperture = surface(gazeNames);
  const width = 0.205 * half * settings.width;
  const irisRadius = Math.min(0.024 * h * settings.iris, width * 0.62);
  for (const [side, sign] of [-1, 1].entries()) {
    const shift = settings.offsets?.[side] ?? [0, 0];
    const ex = cx + 0.425 * half * settings.spacing * sign + shift[0] * h;
    const ey = cy + (shift[1] + settings.lift) * h;
    const eyeDepth = (x: number, y: number): number | null => {
      const hit = probe(x, y);
      if (!hit) return null;
      const nx = (x - ex) / width;
      const ny = (y - ey) / width;
      return hit.z + h * (0.0018 + 0.008 * Math.max(0, 1 - nx * nx - 0.8 * ny * ny));
    };
    const at = (x: number, y: number, bias = 0): Point => [x, y, (eyeDepth(x, y) ?? 0) + h * bias];
    if (!probe(ex - width * 1.3, ey) || !probe(ex + width * 1.3, ey)) return false;
    const rows = 10;
    const cols = 36;
    const margin = (u: number) => Math.max(0.0004, 1 - u * u) ** 0.66;
    const line = (u: number) => ey + h * 0.006 * sign * u;
    const contour = settings.contours?.[side];
    const profile = (u: number, samples: ReadonlyArray<number> | undefined, height: number) => {
      if (!samples) return height * margin(u);
      const t = T.MathUtils.clamp((u + 1) * 4, 0, 8);
      const lo = Math.min(7, Math.floor(t));
      return T.MathUtils.lerp(samples[lo] ?? 0, samples[lo + 1] ?? 0, t - lo);
    };
    const upper = (u: number) => line(u) + h * settings.opening * profile(u, contour?.upper, 0.021);
    const lower = (u: number) =>
      line(u) + h * settings.opening * profile(u, contour?.lower, -0.015);
    const shut = (u: number) => T.MathUtils.lerp(lower(u), upper(u), 0.25);
    const eye = preservePaint ? aperture : whites;
    const start = eye.p.length / 3;
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= cols; i++) {
        const u = (2 * i) / cols - 1;
        const t = j / rows;
        const x = ex + width * u;
        const y = T.MathUtils.lerp(lower(u), upper(u), t);
        const xy = (u: number, t: number) =>
          at(ex + width * u, T.MathUtils.lerp(lower(u), upper(u), t));
        if (preservePaint) {
          const scale = settings.iris - 1;
          const fittedU = u + scale * u * (1 - Math.abs(u));
          const fittedT = t + scale * (t - 0.5) * (1 - Math.abs(2 * t - 1));
          const shiftX = 0.43 * (1 - fittedU * fittedU);
          const shiftY = 0.23 * Math.sin(Math.PI * fittedT);
          const hit = probe(x, y);
          if (!hit) return false;
          put(eye, xy(fittedU, fittedT), [hit.u, hit.v], null, {
            LookLeft: xy(fittedU + shiftX, fittedT),
            LookRight: xy(fittedU - shiftX, fittedT),
            LookUp: xy(fittedU, fittedT + shiftY),
            LookDown: xy(fittedU, fittedT - shiftY),
          });
        } else {
          const edge = Math.abs(u) ** 3 * 0.4 + (1 - Math.sin(t * Math.PI)) * 0.16;
          put(eye, at(x, y), [i / cols, t], sclera.clone().lerp(corner, edge));
        }
        if (j < rows && i < cols) {
          const a = start + j * (cols + 1) + i;
          quad(eye, a, a + 1, a + cols + 2, a + cols + 1);
        }
      }
    for (const direction of [1, -1]) {
      const begin = lids.p.length / 3;
      const rings = 8;
      for (let j = 0; j <= rings; j++)
        for (let i = 0; i <= cols; i++) {
          const u = (2 * i) / cols - 1;
          const t = j / rings;
          const v = margin(u);
          const outer = Math.sqrt(Math.max(0.0001, 1 - u * u));
          const x = ex + u * width * (1 + 0.39 * t);
          const rim = direction === 1 ? upper(u) : lower(u);
          const outerY = line(u) + direction * h * (0.052 + 0.019 * settings.opening) * outer;
          const y = T.MathUtils.lerp(rim, outerY, t);
          const closed = T.MathUtils.lerp(shut(u), outerY, t);
          const flat = probe(x, y);
          if (!flat) return false;
          const sampleY = y + direction * h * (settings.source ? 0.001 : 0.009) * (1 - t) * v;
          const skin = probe(x, sampleY) ?? flat;
          const lidDepth = (Y: number) => {
            const p = probe(x, Y) ?? flat;
            const relief = (eyeDepth(x, Y) ?? p.z) - p.z;
            return (
              p.z +
              (relief + h * 0.0045) * (1 - T.MathUtils.smoothstep(t, 0.57, 1)) +
              h * 0.003 * Math.sin(Math.PI * t) * v +
              h * 0.0004
            );
          };
          put(lids, [x, y, lidDepth(y)], [skin.u, skin.v], null, {
            Blink: [x, closed, lidDepth(closed) + h * 0.0005 * v * (1 - t)],
          });
          if (j < rings && i < cols) {
            const a = begin + j * (cols + 1) + i;
            if (direction === 1) quad(lids, a, a + 1, a + cols + 2, a + cols + 1);
            else quad(lids, a, a + cols + 1, a + cols + 2, a + 1);
          }
        }
    }
    if (preservePaint) continue;
    const radial = [0, 0.27, 0.34, 0.38, 0.51, 0.68, 0.84, 0.93, 1];
    const segments = 64;
    const startI = irises.p.length / 3;
    const gaze: ReadonlyArray<readonly [number, number]> = [
      [width * 0.45, 0],
      [-width * 0.45, 0],
      [0, h * 0.014],
      [0, -h * 0.014],
    ];
    for (const [j, r] of radial.entries())
      for (let k = 0; k <= segments; k++) {
        const theta = (2 * Math.PI * k) / segments;
        const dx = irisRadius * r * Math.cos(theta);
        const dy = irisRadius * r * Math.sin(theta);
        const x = ex + dx;
        const y = ey + dy;
        const fibre =
          0.82 +
          0.2 * Math.sin(19 * theta + Math.sin(7 * theta) + 1.9 * r) +
          0.12 * Math.cos(31 * theta - 2 * r);
        const color =
          r <= 0.34
            ? new T.Color("#171514")
            : pigment.clone().multiplyScalar((r >= 0.93 ? 0.55 : r <= 0.51 ? 1.28 : 1.0) * fibre);
        const bias = 0.0018 + 0.0015 * (1 - r * r);
        const poses: Record<string, Point> = {};
        gazeNames.forEach((n, i) => {
          const [gx, gy] = gaze[i] ?? [0, 0];
          poses[n] = at(x + gx, y + gy, bias);
        });
        put(
          irises,
          at(x, y, bias),
          [0.5 + 0.5 * r * Math.cos(theta), 0.5 + 0.5 * r * Math.sin(theta)],
          color,
          poses,
        );
        if (j < radial.length - 1 && k < segments) {
          const a = startI + j * (segments + 1) + k;
          if (j === 0) irises.idx.push(a, a + segments + 1, a + segments + 2);
          else quad(irises, a, a + segments + 1, a + segments + 2, a + 1);
        }
      }
  }
  const add = (data: Surface, material: T.Material | T.Material[], id: string) => {
    const piece = new T.Mesh(geometry(data), material);
    piece.name = id;
    piece.userData["eyePiece"] = id;
    mesh.add(piece);
  };
  add(lids, mesh.material, "Lids");
  if (preservePaint) add(aperture, uniform ?? mesh.material, "Iris");
  else {
    add(
      whites,
      uniform ??
        new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.43 }),
      "Sclera",
    );
    add(
      irises,
      uniform ??
        new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.36 }),
      "Iris",
    );
  }
  mesh.userData["fittedEyes"] = true;
  return true;
}

export function fitPaintedEyes(
  mesh: T.Mesh,
  paint: HeadSpace | undefined,
  material: T.Material | T.Material[],
  raster: Raster,
): FigureEyes {
  const settings = { color: "#574331", width: 1, opening: 1, lift: 0, iris: 1, spacing: 1 };
  const map = material instanceof T.MeshStandardMaterial ? material.map : null;
  const im = drawable(map?.image);
  if (!im || !map) return settings;
  const { h, half, cx, cy, probe } = frame(mesh, paint);
  const ctx = context2d(raster.canvas(im.width, im.height), { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  const data = ctx.getImageData(0, 0, im.width, im.height).data;
  const { width, height } = im,
    flipY = map.flipY;
  function luminance(x: number, y: number) {
    const point = probe(x, y);
    if (!point) return 0.27;
    const u = T.MathUtils.clamp(point.u, 0, 1) * (width - 1),
      v = T.MathUtils.clamp(flipY ? 1 - point.v : point.v, 0, 1) * (height - 1);
    function sample(i: number, j: number) {
      const k = 4 * (Math.min(height - 1, j) * width + Math.min(width - 1, i));
      return (0.21 * (data[k] ?? 0) + 0.72 * (data[k + 1] ?? 0) + 0.07 * (data[k + 2] ?? 0)) / 255;
    }
    const a = Math.floor(u),
      b = Math.floor(v);
    return T.MathUtils.lerp(
      T.MathUtils.lerp(sample(a, b), sample(a + 1, b), u - a),
      T.MathUtils.lerp(sample(a, b + 1), sample(a + 1, b + 1), u - a),
      v - b,
    );
  }
  function offsetFor(sign: number): [number, number] {
    const x0 = cx + sign * 0.425 * half;
    let best = -Infinity,
      offset: [number, number] = [0, 0];
    for (let iy = -6; iy <= 6; iy++)
      for (let ix = -7; ix <= 7; ix++) {
        const dx = ix * 0.003,
          dy = iy * 0.0027,
          x = x0 + dx * h,
          y = cy + dy * h;
        const core =
          (2 * luminance(x, y) +
            luminance(x - 0.003 * h, y) +
            luminance(x + 0.003 * h, y) +
            luminance(x, y + 0.003 * h)) /
          5;
        const surround =
          (luminance(x - 0.022 * h, y) +
            luminance(x + 0.022 * h, y) +
            luminance(x, y - 0.016 * h)) /
          3;
        const score = surround - core - 0.16 * core - 0.045 * ((ix / 7) ** 2 + (iy / 6) ** 2);
        if (score > best) {
          best = score;
          offset = [dx, dy];
        }
      }
    return offset;
  }
  const offsets = [offsetFor(-1), offsetFor(1)] as const;
  function contourFor([dx, dy]: readonly [number, number], side: number) {
    const sign = side ? 1 : -1,
      ex = cx + sign * 0.425 * half + dx * h,
      ey = cy + dy * h;
    function trace(direction: number) {
      const line: number[] = [];
      for (let i = 0; i < 9; i++) {
        const u = i / 4 - 1,
          arc = Math.max(0, 1 - u * u) ** 0.66;
        const prior = arc * (direction > 0 ? 0.021 : 0.015),
          x = ex + u * 0.205 * half;
        let best = -Infinity,
          edge = prior;
        for (let j = -5; j <= 5; j++) {
          const distance = Math.max(0.002, prior + j * 0.0019 * arc),
            y = ey + (0.006 * sign * u + direction * distance) * h;
          const outside = luminance(x, y + direction * 0.004 * h),
            inside = luminance(x, y - direction * 0.003 * h),
            middle = luminance(x, y);
          const score =
            0.65 * Math.abs(inside - outside) +
            0.35 * (Math.max(inside, outside) - middle) -
            0.08 * (j / 5) ** 2;
          if (score > best) {
            best = score;
            edge = distance;
          }
        }
        line.push(direction * (arc ? edge : 0));
      }
      return line.map((v, i) =>
        i && i < 8
          ? Number((0.22 * (line[i - 1] ?? v) + 0.56 * v + 0.22 * (line[i + 1] ?? v)).toFixed(5))
          : v,
      );
    }
    return { upper: trace(1), lower: trace(-1) };
  }
  return {
    ...settings,
    source: true,
    offsets,
    contours: [contourFor(offsets[0], 0), contourFor(offsets[1], 1)],
  };
}
