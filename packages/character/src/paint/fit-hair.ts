import { MathUtils } from "three";
import { hairCapSize, type FigurePaint } from "@irudd/document";
import { sweepGeometry } from "../surfaces/sweep.js";
import { headSpace } from "../surfaces/face.js";
import type { Panel } from "./panel.js";
import type { SheetPanels, HairOutline } from "./trace-build.js";
type Outline = readonly (readonly [number, number])[];
type Polygons = readonly Outline[];

const [width, height] = hairCapSize,
  bytes = width * height;
const encode = (a: Uint8Array) => btoa(String.fromCharCode(...a));
function coverage(x: number, y: number, polygons: Polygons) {
  let best = 0;
  for (const poly of polygons) {
    let inside = false,
      dist = 1;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const one = poly[i],
        two = poly[j];
      if (!one || !two) continue;
      const [ax, ay] = one,
        [bx, by] = two,
        dx = bx - ax,
        dy = by - ay;
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      const t = MathUtils.clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      dist = Math.min(dist, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    best = Math.max(best, MathUtils.smoothstep(inside ? dist : -dist, -0.023, 0.023));
  }
  return best;
}
function hairMask(panel: Panel, polygons: Polygons) {
  const n = 128,
    len = n * n,
    prior = new Float32Array(len),
    rgb = new Float32Array(len * 3);
  const frozen = new Uint8Array(len),
    next = new Float32Array(len),
    hist = [new Float32Array(512), new Float32Array(512)] as const,
    counts: [number, number] = [0, 0],
    subject = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const x = ((i % n) + 0.5) / n,
      y = (Math.floor(i / n) + 0.5) / n;
    let count = 0;
    for (const [dx, dy] of [
      [0, 0],
      [-0.022, 0],
      [0.022, 0],
      [0, -0.022],
      [0, 0.022],
    ] as const)
      count += coverage(x + dx, y + dy, polygons);
    const p = (prior[i] = count / 5);

    const j =
      4 *
      (Math.min(panel.size - 1, Math.floor(y * panel.size)) * panel.size +
        Math.min(panel.size - 1, Math.floor(x * panel.size)));
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] = (panel.pixels[j + k] ?? 0) / 255;
    subject[i] = panel.mask[j / 4] ?? 0;
    if (subject[i] && (p > 0.86 || p < 0.02)) {
      const side = p > 0.86 ? 1 : 0;
      const bin = colorBin(i);
      hist[side][bin] = (hist[side][bin] ?? 0) + 1;
      counts[side]++;
    }
  }
  function colorBin(i: number) {
    const r = rgb[3 * i] ?? 0,
      g = rgb[3 * i + 1] ?? 0,
      b = rgb[3 * i + 2] ?? 0,
      s = r + g + b + 0.03,
      bin = (v: number) => MathUtils.clamp(Math.floor(v * 8), 0, 7);
    return bin(((r - g) / s) * 2.6 + 0.4) * 64 + bin(((g - b) / s) * 2.6 + 0.4) * 8 + bin(s / 3);
  }
  const geometric = prior.slice();
  for (let i = 0; i < len; i++) {
    const x = ((i % n) + 0.5) / n,
      y = (Math.floor(i / n) + 0.5) / n;
    if (!subject[i]) continue;
    const key = colorBin(i),
      hair = ((hist[1][key] ?? 0) + 0.25) / (counts[1] + 128),
      skin = ((hist[0][key] ?? 0) + 0.25) / (counts[0] + 128);
    let near = false;
    for (const [dx, dy] of [
      [0, -0.075],
      [0, 0.075],
      [-0.075, 0],
      [0.075, 0],
    ] as const) {
      const k =
        MathUtils.clamp(Math.floor((y + dy) * n), 0, n - 1) * n +
        MathUtils.clamp(Math.floor((x + dx) * n), 0, n - 1);
      if ((geometric[i] ?? 0) > 0.5 !== (geometric[k] ?? 0) > 0.5) {
        near = true;
        break;
      }
    }
    if (!near) {
      frozen[i] = Number((geometric[i] ?? 0) < 0.025 || (geometric[i] ?? 0) > 0.975);
      continue;
    }
    const odds = MathUtils.clamp(Math.log(hair / skin), -5, 5);
    prior[i] = 1 / (1 + Math.exp(-(((geometric[i] ?? 0) - 0.5) * 3.0 + odds)));
    frozen[i] = Number(Math.abs(odds) > 2.6);
  }
  let a = prior.slice(),
    b = next;
  for (let pass = 0; pass < 24; pass++) {
    for (let i = 0; i < len; i++) {
      if (frozen[i]) {
        b[i] = prior[i] ?? 0;
        continue;
      }
      const x = i % n,
        y = Math.floor(i / n);
      let sum = 0.12 * (prior[i] ?? 0),
        weight = 0.12;
      for (const j of [
        x ? i - 1 : i,
        x < n - 1 ? i + 1 : i,
        y ? i - n : i,
        y < n - 1 ? i + n : i,
      ]) {
        let diff = 0;
        for (let k = 0; k < 3; k++) diff += ((rgb[i * 3 + k] ?? 0) - (rgb[j * 3 + k] ?? 0)) ** 2;
        const w = 0.002 + Math.exp(-diff / 0.004);
        sum += (a[j] ?? 0) * w;
        weight += w;
      }
      b[i] = sum / weight;
    }
    [a, b] = [b, a];
  }
  return (x: number, y: number) =>
    a[
      MathUtils.clamp(Math.round(y * n - 0.5), 0, n - 1) * n +
        MathUtils.clamp(Math.round(x * n - 0.5), 0, n - 1)
    ] ?? 0;
}
function lightAt(panel: Panel, x: number, y: number) {
  const i =
      4 *
      (MathUtils.clamp(Math.round(y * panel.size), 0, panel.size - 1) * panel.size +
        MathUtils.clamp(Math.round(x * panel.size), 0, panel.size - 1)),
    p = panel.pixels;
  return (0.25 * (p[i] ?? 0) + 0.55 * (p[i + 1] ?? 0) + 0.2 * (p[i + 2] ?? 0)) / 255;
}
export function fitHairCap(
  binding: FigurePaint,
  panels: SheetPanels,
  shapes: readonly HairOutline[],
) {
  if (!shapes.length) return null;
  const front = shapes.map((r) => r.front),
    side = shapes.map((r) => r.side);
  const mask = new Uint8Array(bytes),
    texture = new Float32Array(bytes),
    relief = new Uint8Array(bytes);
  const rest = sweepGeometry(binding.rest, true, width),
    positions = rest.getAttribute("position");
  const rows = positions.count / (width + 1) - 1,
    [f, s] = panels;
  const frontMask = hairMask(f, front),
    sideMask = hairMask(s, side);
  let area = 0;
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const row = Math.min(rows, Math.round((j / (height - 1)) * rows)),
        k = row * (width + 1) + i;
      const x = (positions.getX(k) + binding.offset[0]) / binding.height,
        y = (positions.getY(k) + binding.offset[1]) / binding.height,
        z = (positions.getZ(k) + binding.offset[2]) / binding.height;
      const fx = (f.mid + x * f.span) / f.size,
        fy = (f.feet - y * f.span) / f.size,
        sx = (s.mid - z * s.span) / s.size,
        sy = (s.feet - y * s.span) / s.size;
      const theta = (i / width) * Math.PI * 2,
        zNormal = -Math.sin(theta),
        frontWeight = MathUtils.smoothstep(zNormal, 0.08, 0.78);
      const amount = MathUtils.lerp(sideMask(sx, sy), frontMask(fx, fy), frontWeight);
      mask[j * width + i] = Math.round(255 * amount);
      area += amount;
      const panel = zNormal < -0.4 ? panels[2] : f;
      const px = panel === f ? fx : (panel.mid - x * panel.span) / panel.size,
        py = (panel.feet - y * panel.span) / panel.size;
      texture[j * width + i] = MathUtils.lerp(
        lightAt(s, sx, sy),
        lightAt(panel, px, py),
        Math.max(frontWeight, MathUtils.smoothstep(-zNormal, 0.15, 0.9)),
      );
    }
  rest.dispose();
  if (area < bytes * 0.025 || area > bytes * 0.85) return null;
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      let surround = 0;
      for (const [dx, dy] of [
        [-3, 0],
        [3, 0],
        [0, -3],
        [0, 3],
        [-2, 2],
        [2, -2],
      ] as const)
        surround +=
          texture[MathUtils.clamp(j + dy, 0, height - 1) * width + ((i + dx + width) % width)] ?? 0;
      const u = (i / width) * Math.PI * 2,
        v = j / (height - 1);
      const locks =
        Math.sin(17 * u + v * 24 + 2.3 * Math.sin(3 * u + v * 7)) * 0.18 +
        0.1 * Math.sin(29 * u - v * 21 + 1.5 * Math.sin(5 * u));
      relief[j * width + i] = Math.round(
        255 *
          MathUtils.clamp(0.5 + 2.1 * ((texture[j * width + i] ?? 0) - surround / 6) + locks, 0, 1),
      );
    }
  const head = headSpace(binding),
    face = head.portrait;
  if (!face) return null;
  const nx = (face.center * head.height - head.offset[0] + binding.offset[0]) / binding.height;
  const ny =
    ((face.eyes + 0.085) * head.height - head.offset[1] + binding.offset[1]) / binding.height;
  const index =
    4 *
    (MathUtils.clamp(Math.round(f.feet - ny * f.span), 0, f.size - 1) * f.size +
      MathUtils.clamp(Math.round(f.mid + nx * f.span), 0, f.size - 1));
  return {
    mask: encode(mask),
    relief: encode(relief),
    scalp:
      "#" +
      Array.from(f.pixels.slice(index, index + 3), (n) => n.toString(16).padStart(2, "0")).join(""),
  };
}
