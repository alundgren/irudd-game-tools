import type { FigureGroom } from "@irudd/document";
import * as T from "three";

const tau = Math.PI * 2;
const up = new T.Vector3(0, 1, 0);
const xAxis = new T.Vector3(1, 0, 0);

export interface StrandBuffer {
  point(v: T.Vector3, u: number, t: number): void;
  quad(a: number, b: number, c: number, d: number): void;
  readonly count: number;
}

export interface GroomFrame {
  readonly options: FigureGroom;
  readonly h: number;
  readonly scalp: (a: number, phi: number, inflate?: number) => T.Vector3;
  readonly edge: (a: number) => number;
  readonly clear: (v: T.Vector3, pad?: number) => T.Vector3;
  readonly random: () => number;
  readonly buffers: readonly [StrandBuffer, StrandBuffer, StrandBuffer];
}

const at = <V>(list: ReadonlyArray<V>, i: number): V => {
  const v = list[i];
  if (v === undefined) throw new Error("Strand index out of range.");
  return v;
};

function tube(
  buffer: StrandBuffer,
  points: ReadonlyArray<T.Vector3>,
  radii: ReadonlyArray<number>,
  flat = 1,
  sides = 5,
): void {
  const base = buffer.count;
  const axis = new T.Vector3();
  const u = new T.Vector3();
  const v = new T.Vector3();
  const point = new T.Vector3();
  for (let j = 0; j < points.length; j++) {
    axis
      .subVectors(at(points, Math.min(j + 1, points.length - 1)), at(points, Math.max(0, j - 1)))
      .normalize();
    if (j === 0) u.copy(Math.abs(axis.y) < 0.8 ? up : xAxis);
    u.addScaledVector(axis, -u.dot(axis)).normalize();
    v.crossVectors(axis, u).normalize();
    for (let k = 0; k <= sides; k++) {
      const a = (k * tau) / sides;
      point
        .copy(at(points, j))
        .addScaledVector(u, at(radii, j) * Math.cos(a))
        .addScaledVector(v, at(radii, j) * flat * Math.sin(a));
      buffer.point(point, k / sides, j / (points.length - 1));
      if (j < points.length - 1 && k < sides) {
        const i = base + j * (sides + 1) + k;
        buffer.quad(i, i + 1, i + sides + 2, i + sides + 1);
      }
    }
  }
}

export function coilLift(phi: number, edge: number, options: FigureGroom, phase: number): number {
  const margin = 1 - T.MathUtils.smoothstep(phi / edge, 0.76, 1);
  const sx = Math.sin(phi) * Math.sin(phase);
  const sy = Math.cos(phi);
  const sz = Math.sin(phi) * Math.cos(phase);
  const grain =
    0.022 * Math.sin(37 * sx + 15 * sy) * Math.cos(34 * sz - 17 * sy) +
    0.013 * Math.sin(58 * sy + 27 * sx + 9 * sz);
  return (
    margin *
    ((0.1 + 0.39 * options.length) *
      (0.52 + 0.7 * options.volume) *
      (1 + 0.08 * Math.cos(phase * 7 + phi * 9)) +
      grain)
  );
}

function sidePart(f: GroomFrame): void {
  const { options, h, scalp, edge, clear, random, buffers } = f;
  const { length, curl, sweep, gather, volume } = options;
  const part = options.part ?? 0;
  const loose = 1 - 0.8 * (options.nape ?? 0);
  const count = 102;
  for (let n = 0; n < count; n++) {
    const sign = n % 2 ? 1 : -1;
    const fr = (Math.floor(n / 2) + random() * 0.48) / (count / 2);
    const z = 0.91 - 1.86 * fr;
    const rx = part * 0.78 * Math.sqrt(Math.max(0.01, 1 - z * z)) + sign * 0.016;
    const ry = Math.sqrt(Math.max(0.015, 1 - z * z - rx * rx));
    const startAngle = Math.atan2(rx, z);
    const startPhi = Math.acos(T.MathUtils.clamp(ry, -1, 1));
    const tipAngle = sign * Math.acos(T.MathUtils.clamp(z * 0.92 - sweep * 0.11, -0.99, 0.99));
    const endPhi = edge(tipAngle);
    const points: T.Vector3[] = [];
    const radii: number[] = [];
    const width = h * (0.009 + 0.004 * random());
    const phase = random() * tau;
    const turn = Math.atan2(Math.sin(tipAngle - startAngle), Math.cos(tipAngle - startAngle));
    for (let j = 0; j <= 36; j++) {
      const t = j / 36;
      const s = Math.min(1, t / 0.85);
      const free = Math.max(0, (t - 0.85) / 0.15);
      const a = startAngle + turn * s;
      const phi = T.MathUtils.lerp(startPhi, endPhi, s);
      const lift = (0.042 + 0.21 * volume + 0.08 * Math.max(0, z)) * loose * Math.sin(Math.PI * s);
      const p = scalp(a, phi, 1.018 + lift);
      p.z -= h * (0.062 + 0.038 * sweep) * loose * Math.sin(Math.PI * s);
      p.x += h * sign * 0.005 * curl * Math.sin(s * 17 + phase);
      p.y -= free * h * length * (0.19 + (0.35 * (1 - z)) / 2);
      if (gather > 0) p.z -= free * h * 0.12 * gather;
      points.push(clear(p, 0.01));
      radii.push(
        width * (0.1 + 0.9 * Math.sin(Math.PI * Math.min(t / 0.92, 1)) ** 0.45) * (1 - 0.65 * free),
      );
    }
    tube(at(buffers, n % 3), points, radii, 0.34, 5);
  }
}

function braids(f: GroomFrame): void {
  const { options, h, scalp, edge, clear, random, buffers } = f;
  const { length, sweep, gather, volume } = options;
  const along = new T.Vector3();
  const side = new T.Vector3();
  const normal = new T.Vector3();
  const count = 23;
  const steps = 126;
  for (let lane = 0; lane < count; lane++) {
    const x = -0.92 + (1.84 * (lane + 0.5)) / count;
    const sideRadius = Math.sqrt(1 - x * x);
    const phase = random() * tau;
    const fall = h * (0.17 + length * (0.75 + 0.25 * random()));
    const width = h * (0.009 + 0.0025 * random());
    const surfaceArc = (angle: number): readonly [number, number] => {
      const nx = T.MathUtils.clamp(
        x + 0.028 * sweep * Math.sin(angle * 2) * sideRadius,
        -0.98,
        0.98,
      );
      const r = Math.sqrt(1 - nx * nx);
      return [
        Math.atan2(nx, r * Math.cos(angle)),
        Math.acos(T.MathUtils.clamp(r * Math.sin(angle), -1, 1)),
      ];
    };
    const inside = (angle: number): boolean => {
      const [a, p] = surfaceArc(angle);
      return p <= edge(a);
    };
    let from = 0;
    let to = Math.PI * 0.5;
    while (from < Math.PI * 0.5 && !inside(from)) from += 0.018;
    while (to < Math.PI * 1.43 && inside(to + 0.018)) to += 0.018;
    const line: T.Vector3[] = [];
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      const over = Math.min(1, t / 0.65);
      const free = Math.max(0, (t - 0.65) / 0.35);
      const [a, phi] = surfaceArc(T.MathUtils.lerp(from, to, over));
      const p = scalp(a, phi, 1.025);
      p.y -= fall * free;
      p.x += h * (0.035 * Math.sin(lane * 1.63 + free * 5) + 0.04 * x) * free;
      p.z -= h * (0.075 + 0.05 * volume) * free;
      if (gather) p.x = T.MathUtils.lerp(p.x, scalp(Math.PI, 1.75).x, 0.58 * gather * free);
      line.push(clear(p, 0.012));
    }
    for (let strand = 0; strand < 3; strand++) {
      const points: T.Vector3[] = [];
      const radii: number[] = [];
      for (let j = 0; j <= steps; j++) {
        const t = j / steps;
        const p = at(line, j).clone();
        const a = phase + tau * ((9 + 5 * length) * t + strand / 3);
        along
          .subVectors(at(line, Math.min(steps, j + 1)), at(line, Math.max(0, j - 1)))
          .normalize();
        side.copy(xAxis).addScaledVector(along, -along.x).normalize();
        normal.crossVectors(along, side).normalize();
        const taper =
          (0.23 + 0.77 * T.MathUtils.smoothstep(t, 0, 0.1)) *
          (1 - 0.7 * T.MathUtils.smoothstep(t, 0.91, 1));
        p.addScaledVector(side, width * taper * Math.sin(a)).addScaledVector(
          normal,
          width * taper * 0.54 * Math.sin(2 * a),
        );
        points.push(p);
        radii.push(width * taper * 0.67);
      }
      tube(at(buffers, (strand + lane) % 3), points, radii, 0.83, 5);
    }
  }
}

function spiral(f: GroomFrame): void {
  const { options, h, scalp, edge, clear, random, buffers } = f;
  const { pattern, length, curl, sweep, gather, volume } = options;
  const part = options.part ?? 0;
  const v = new T.Vector3();
  const normal = new T.Vector3();
  const side = new T.Vector3();
  const along = new T.Vector3();
  const coiled = pattern === "Coils";
  const count = coiled ? 760 : 82;
  for (let n = 0; n < count; n++) {
    const a = n * 2.39996322973 + (random() - 0.5) * 0.19 + part * 0.4;
    const edgePhi = edge(a);
    const phi = Math.acos(1 - ((n + 0.45) / count) * (1 - Math.cos(edgePhi)));
    const phase = random() * tau;
    const noise = random();
    const tilt = T.MathUtils.clamp(Math.cos(a), 0, 1);
    const fall = (0.19 + length * (0.64 + 0.29 * noise)) * (1 - 0.8 * tilt ** 5);
    if (coiled) {
      const surface = (angle: number, p: number) =>
        scalp(angle, p, 1 + coilLift(p, edge(angle), options, angle));
      const root = surface(a, phi);
      const near = surface(a, phi + 0.018);
      along.subVectors(near, root).normalize();
      side.subVectors(surface(a + 0.015, phi), root).normalize();
      normal.crossVectors(side, along).normalize();
      if (
        normal.dot(v.set(Math.sin(a) * Math.sin(phi), Math.cos(phi), Math.cos(a) * Math.sin(phi))) <
        0
      )
        normal.negate();
      const points: T.Vector3[] = [];
      const radii: number[] = [];
      const turns = 1.05 + curl * 2.8 + noise * 0.65;
      const rad = h * (0.01 + 0.009 * (1 - curl) + noise * 0.003);
      for (let j = 0; j <= 22; j++) {
        const t = j / 22;
        const wave = phase + t * tau * turns;
        const rf = Math.sin(Math.PI * t) ** 0.45;
        const p = root
          .clone()
          .addScaledVector(along, h * t * (0.052 + 0.105 * length))
          .addScaledVector(
            side,
            rad * (Math.cos(wave) * rf + t * sweep + 1.3 * t * Math.sin(phase)),
          )
          .addScaledVector(normal, rad * (1.1 + Math.sin(wave) * rf) + h * 0.004 * t);
        points.push(p);
        radii.push(h * (0.0051 + 0.0027 * noise) * (1 - 0.52 * t * t));
      }
      tube(at(buffers, n % 3), points, radii, 0.92, 4);
      continue;
    }
    const turns = 3 + length * 5;
    const steps = 30;
    const axisPath: T.Vector3[] = [];
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      const over = Math.min(t / 0.43, 1);
      const free = Math.max(0, (t - 0.43) / 0.57);
      const angle = a + sweep * 0.37 * over;
      const arc = T.MathUtils.lerp(phi, edge(angle), over);
      const p = scalp(angle, arc, 1.028 + 0.055 * Math.sin(Math.PI * over) * volume);
      p.y -= h * fall * free;
      p.x += h * (0.022 + volume * 0.09) * Math.sin(angle) * Math.sin(Math.PI * free);
      p.z -= h * (0.05 + 0.035 * tilt) * free;
      p.z += h * curl * 0.012 * Math.sin(phase + free * 8) * free;
      if (gather) {
        const back = scalp(Math.PI, 1.75, 1.04);
        p.x = T.MathUtils.lerp(p.x, back.x + h * 0.045 * Math.sin(a), gather * free);
        p.z = T.MathUtils.lerp(p.z, back.z, gather * free);
      }
      axisPath.push(clear(p, 0.012));
    }
    const base = h * 0.018 * (0.8 + noise * 0.4);
    const radii = axisPath.map((_, j) => {
      const t = j / steps;
      const tip = 1 - T.MathUtils.smoothstep(t, 0.87, 1) * 0.75;
      return base * tip * (1 + 0.065 * Math.sin(2 * (phase + tau * turns * t)));
    });
    tube(at(buffers, n % 3), axisPath, radii, 1, 6);
  }
}

export function shapedFibres(f: GroomFrame): void {
  if (f.options.pattern === "Side part") sidePart(f);
  else if (f.options.pattern === "Braids") braids(f);
  else spiral(f);
}
