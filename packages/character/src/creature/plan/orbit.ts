import { Vector3 } from "three";
import { need } from "./need.js";
import type { Head } from "./types.js";

export interface Surface {
  vertices: number[][];
  faces: number[][];
}
function surface(rows: Vector3[][], closed = false): Surface {
  const n = need(rows[0]).length;
  const vertices = rows.flat().map((p) => p.toArray());
  const faces: number[][] = [];
  for (let i = 0; i < (closed ? rows.length : rows.length - 1); i++) {
    const next = (i + 1) % rows.length;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      faces.push([i * n + j, i * n + k, next * n + k, next * n + j]);
    }
  }
  if (!closed) {
    for (const i of [0, rows.length - 1]) {
      const centre = need(rows[i])
        .reduce((a, p) => a.add(p), new Vector3())
        .divideScalar(n);
      const v = vertices.push(centre.toArray()) - 1;
      for (let j = 0; j < n; j++) {
        const a = i * n + j,
          b = i * n + ((j + 1) % n);
        faces.push(i === 0 ? [v, b, a] : [v, a, b]);
      }
    }
  }
  return { vertices, faces };
}

function ring(sample: (x: number, y: number) => Vector3) {
  return Array.from({ length: 16 }, (_, i) => {
    const angle = (i * Math.PI) / 8;
    return sample(Math.cos(angle), Math.sin(angle));
  });
}

export function creatureOrbit({
  head,
  gaze,
  up,
  side,
  seatOnSkull,
}: {
  head: Head;
  gaze: Vector3;
  up: Vector3;
  side: number;
  seatOnSkull?: ((p: Vector3) => Vector3) | undefined;
}) {
  const horizontal = new Vector3().crossVectors(up, gaze).normalize();
  const vertical = new Vector3().crossVectors(gaze, horizontal).normalize();
  const insect = head.snout === "mandibles";
  const bird = head.snout === "beak" || head.snout === "bill";
  const grazer = head.eyePlace === "side" && head.snout === "muzzle" && head.teeth < 4;
  const tall = insect ? 1 : bird ? 0.86 : grazer ? 0.63 : 0.76;
  const wide = insect ? 0.9 : bird ? 0.96 : 1.08;
  const slope = insect ? 0.22 : bird ? 0.07 : 0.1 - head.brow * 0.21;
  const bulge = insect ? 0.68 : 0.44;
  const frame = (x: number, y: number, z: number) =>
    horizontal
      .clone()
      .multiplyScalar(x * wide)
      .addScaledVector(vertical, y * tall + side * x * slope)
      .addScaledVector(gaze, z);
  const almond = (x: number) => 1 - (insect || bird ? 0.08 : 0.31) * x * x;
  const lens = (x: number, y: number) => 0.13 + bulge * (1 - x * x - y * y);
  const eyeRow = (r: number, z?: number) =>
    ring((x, y) => frame(r * x, r * y * almond(x), z ?? lens(r * x, r * y)));
  const eye = surface([
    eyeRow(0.82, -0.64),
    eyeRow(1, -0.06),
    eyeRow(1, 0.15),
    eyeRow(0.82, lens(0.82, 0)),
    eyeRow(0.52, lens(0.52, 0)),
    eyeRow(0.18, lens(0.18, 0)),
  ]);
  const pupilWidth = grazer ? 0.45 : bird ? 0.28 : 0.24;
  const pupilHeight = grazer ? 0.19 : bird ? 0.31 : 0.4;
  function disc(w: number, h: number, z: number) {
    const row = (r: number, dz: number) =>
      ring((a, b) => {
        const x = r * a * w - 0.07 * side,
          y = r * b * h;
        return frame(x, y, lens(x, y) + dz);
      });
    return surface([row(0.97, z - 0.095), row(1, z), row(0.78, z + 0.012), row(0.27, z + 0.016)]);
  }
  const rim = ring((x, y) => frame(1.28 * x, 1.29 * y * almond(x), -0.5));
  const outer = rim.map((p) => (seatOnSkull ? seatOnSkull(p) : p));
  const lip = (scale: number, offset: number) =>
    ring((x, y) => {
      const upper = Math.max(0, y),
        lid = head.lids * upper * 0.48;
      return frame(
        scale * x,
        scale * y * almond(x) - lid,
        offset + upper * (0.055 + 0.12 * head.brow),
      );
    });
  return {
    eye,
    iris: insect ? null : disc(bird ? 0.72 : 0.66, bird ? 0.81 : 0.85, 0.042),
    pupil: insect ? null : disc(pupilWidth, pupilHeight, 0.098),
    rim: surface(
      [
        outer,
        lip(1.18, 0.04),
        lip(0.96, 0.24),
        lip(0.91, 0.19),
        lip(0.94, -0.18),
        outer.map((p) => p.clone().addScaledVector(gaze, -0.1)),
      ],
      true,
    ),
  };
}
