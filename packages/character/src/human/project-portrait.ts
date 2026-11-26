import type { HumanBody } from "./body.js";
import { chartPixel, faceChart } from "./chart.js";

type Point = readonly [number, number];
export interface ProfilePhoto {
  readonly image: ImageData;
  readonly marks: readonly Point[];
}

function registration(a: Point, b: Point, c: Point, p: Point, q: Point, r: Point) {
  const bx = b[0] - a[0],
    by = b[1] - a[1],
    cx = c[0] - a[0],
    cy = c[1] - a[1],
    det = bx * cy - by * cx;
  if (Math.abs(det) < 0.0001) throw new Error("Choose three distinct landmarks spanning the face.");
  const ux = ((q[0] - p[0]) * cy - (r[0] - p[0]) * by) / det,
    uy = ((r[0] - p[0]) * bx - (q[0] - p[0]) * cx) / det;
  const vx = ((q[1] - p[1]) * cy - (r[1] - p[1]) * by) / det,
    vy = ((r[1] - p[1]) * bx - (q[1] - p[1]) * cx) / det;
  return [ux, uy, p[0] - ux * a[0] - uy * a[1], vx, vy, p[1] - vx * a[0] - vy * a[1]] as const;
}
function projection(image: ImageData, transform: ReturnType<typeof registration>) {
  const [ux, uy, du, vx, vy, dv] = transform;
  function key(at: number) {
    const r = image.data[at] ?? 0,
      g = image.data[at + 1] ?? 0,
      b = image.data[at + 2] ?? 0;
    if (Math.min(r, b) > g * 1.5 + 26) return "magenta";
    if (g > Math.max(r, b) + 25) return "green";
    return undefined;
  }
  const last = image.width * image.height - 1;
  const corners = [0, image.width - 1, last - image.width + 1, last].map((i) => key(4 * i));
  const background = corners.find((k) => k && corners.filter((c) => c === k).length >= 3);
  return (x: number, y: number) => {
    const u = ux * x + uy * y + du,
      v = vx * x + vy * y + dv;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return -1;
    const at = 4 * (Math.floor(v * image.height) * image.width + Math.floor(u * image.width));
    return background && key(at) === background ? -1 : at;
  };
}

export function nativePortraitLayer(
  body: HumanBody,
  photo: ImageData,
  eyes: readonly Point[],
  lip: Point,
  profile?: ProfilePhoto,
) {
  const [left, right] = eyes;
  if (!left || !right || right[0] - left[0] < 0.04 || lip[1] <= (left[1] + right[1]) / 2 + 0.02)
    throw new Error("Mark the left eye, right eye and lip seam in that order.");
  const chart = faceChart(body),
    out = new ImageData(chart.width, chart.height);
  const mouth = chart.points.mouth.centre,
    unit = chart.unit;
  const front = projection(
    photo,
    registration([-unit / 2, 0], [unit / 2, 0], mouth, left, right, lip),
  );
  function sideProjection(side: ProfilePhoto) {
    const [eye, nose, lips] = side.marks;
    if (!eye || !nose || !lips || nose[0] < eye[0] + 0.02 || lips[1] <= eye[1])
      throw new Error("On a right-facing profile, mark the eye, nose tip and lips.");
    const landmarks = [chart.points.eyes[0].centre, chart.points.noseTip, mouth].map(
      ([x, y]): Point => [chart.z[chartPixel(body, x, y)] ?? 0, y],
    );
    const [a, b, c] = landmarks;
    if (!a || !b || !c) throw new Error("Missing face chart landmarks.");
    return projection(side.image, registration(a, b, c, eye, nose, lips));
  }
  const side = profile && sideProjection(profile);
  for (let i = 0; i < chart.hit.length; i++) {
    if (!chart.hit[i]) continue;
    const x = chart.x[i] ?? 0,
      y = chart.y[i] ?? 0,
      fx = front(x, y),
      sx = side?.(chart.z[i] ?? 0, y) ?? -1;
    if (fx < 0 && sx < 0) continue;
    const turn = Math.min(1, Math.max(0, (Math.abs(chart.nx[i] ?? 0) - 0.3) / 0.55));
    const lateral = Math.abs(x / unit),
      down = y / mouth[1];
    const edge = Math.max(
      0,
      Math.min(1, (1.55 - lateral) * 3, (2.25 - down) * 3, (1.35 + down) * 3),
    );
    const frontWeight = fx >= 0 ? (photo.data[fx + 3] ?? 0) * (side ? 1 - turn : 1) : 0;
    const sideWeight = sx >= 0 && profile ? (profile.image.data[sx + 3] ?? 0) * turn : 0;
    const total = frontWeight + sideWeight;
    if (!total) continue;
    for (let c = 0; c < 3; c++)
      out.data[4 * i + c] =
        ((photo.data[fx + c] ?? 0) * frontWeight +
          (profile?.image.data[sx + c] ?? 0) * sideWeight) /
        total;
    out.data[4 * i + 3] = edge * total;
  }
  return out;
}
