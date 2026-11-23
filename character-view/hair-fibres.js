import { MathUtils, Vector3 } from "three";
export const fibrePatterns = ["Locks", "Side part", "Coils", "Braids", "Locs"];
const tau = Math.PI * 2,
  up = new Vector3(0, 1, 0),
  xAxis = new Vector3(1, 0, 0);
function tube(buffer, points, radii, flat = 1, sides = 5) {
  const base = buffer.count,
    axis = new Vector3(),
    u = new Vector3(),
    v = new Vector3(),
    point = new Vector3();
  for (let j = 0; j < points.length; j++) {
    axis
      .subVectors(
        points[Math.min(j + 1, points.length - 1)],
        points[Math.max(0, j - 1)],
      )
      .normalize();
    if (j === 0) u.copy(Math.abs(axis.y) < 0.8 ? up : xAxis);
    u.addScaledVector(axis, -u.dot(axis)).normalize();
    v.crossVectors(axis, u).normalize();
    for (let k = 0; k <= sides; k++) {
      const a = (k * tau) / sides;
      point
        .copy(points[j])
        .addScaledVector(u, radii[j] * Math.cos(a))
        .addScaledVector(v, radii[j] * flat * Math.sin(a));
      buffer.point(point, k / sides, j / (points.length - 1));
      if (j < points.length - 1 && k < sides) {
        const i = base + j * (sides + 1) + k;
        buffer.quad(i, i + 1, i + sides + 2, i + sides + 1);
      }
    }
  }
}
export function coilLift(phi, edge, options, phase) {
  const margin = 1 - MathUtils.smoothstep(phi / edge, 0.76, 1);
  const sx = Math.sin(phi) * Math.sin(phase),
    sy = Math.cos(phi),
    sz = Math.sin(phi) * Math.cos(phase);
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
export function shapedFibres({
  options,
  h,
  scalp,
  edge,
  clear,
  random,
  buffers,
}) {
  const { pattern, length, curl, sweep, gather, volume } = options,
    part = options.part ?? 0;
  const v = new Vector3(),
    normal = new Vector3(),
    side = new Vector3(),
    along = new Vector3();
  if (pattern === "Side part") {
    const count = 102;
    for (let n = 0; n < count; n++) {
      const sign = n % 2 ? 1 : -1,
        f = (Math.floor(n / 2) + random() * 0.48) / (count / 2),
        z = 0.91 - 1.86 * f;
      const rx =
        part * 0.78 * Math.sqrt(Math.max(0.01, 1 - z * z)) + sign * 0.016;
      const ry = Math.sqrt(Math.max(0.015, 1 - z * z - rx * rx));
      const startAngle = Math.atan2(rx, z),
        startPhi = Math.acos(MathUtils.clamp(ry, -1, 1));
      const tipAngle =
        sign * Math.acos(MathUtils.clamp(z * 0.92 - sweep * 0.11, -0.99, 0.99));
      const endPhi = edge(tipAngle),
        points = [],
        radii = [],
        width = h * (0.009 + 0.004 * random()),
        phase = random() * tau;
      const turn = Math.atan2(
        Math.sin(tipAngle - startAngle),
        Math.cos(tipAngle - startAngle),
      );
      for (let j = 0; j <= 36; j++) {
        const t = j / 36,
          s = Math.min(1, t / 0.85),
          free = Math.max(0, (t - 0.85) / 0.15);
        const a = startAngle + turn * s,
          phi = MathUtils.lerp(startPhi, endPhi, s);
        const lift =
          (0.042 + 0.21 * volume + 0.08 * Math.max(0, z)) *
          Math.sin(Math.PI * s);
        const p = scalp(a, phi, 1.018 + lift);
        p.z -= h * (0.062 + 0.038 * sweep) * Math.sin(Math.PI * s);
        p.x += h * sign * 0.005 * curl * Math.sin(s * 17 + phase);
        p.y -= free * h * length * (0.19 + (0.35 * (1 - z)) / 2);
        if (gather > 0) p.z -= free * h * 0.12 * gather;
        points.push(clear(p, 0.01));
        radii.push(
          width *
            (0.1 + 0.9 * Math.sin(Math.PI * Math.min(t / 0.92, 1)) ** 0.45) *
            (1 - 0.65 * free),
        );
      }
      tube(buffers[n % 3], points, radii, 0.34, 5);
    }
    return;
  }
  if (pattern === "Braids") {
    const count = 23,
      steps = 126;
    for (let lane = 0; lane < count; lane++) {
      const x = -0.92 + (1.84 * (lane + 0.5)) / count,
        sideRadius = Math.sqrt(1 - x * x),
        phase = random() * tau;
      const fall = h * (0.17 + length * (0.75 + 0.25 * random())),
        width = h * (0.009 + 0.0025 * random());
      function surfaceArc(angle) {
        const nx = MathUtils.clamp(
            x + 0.028 * sweep * Math.sin(angle * 2) * sideRadius,
            -0.98,
            0.98,
          ),
          r = Math.sqrt(1 - nx * nx);
        return [
          Math.atan2(nx, r * Math.cos(angle)),
          Math.acos(MathUtils.clamp(r * Math.sin(angle), -1, 1)),
        ];
      }
      const inside = (angle) => {
        const [a, p] = surfaceArc(angle);
        return p <= edge(a);
      };
      let from = 0,
        to = Math.PI * 0.5;
      while (from < Math.PI * 0.5 && !inside(from)) from += 0.018;
      while (to < Math.PI * 1.43 && inside(to + 0.018)) to += 0.018;
      const line = [];
      for (let j = 0; j <= steps; j++) {
        const t = j / steps,
          over = Math.min(1, t / 0.65),
          free = Math.max(0, (t - 0.65) / 0.35);
        const [a, phi] = surfaceArc(MathUtils.lerp(from, to, over)),
          p = scalp(a, phi, 1.025);
        p.y -= fall * free;
        p.x += h * (0.035 * Math.sin(lane * 1.63 + free * 5) + 0.04 * x) * free;
        p.z -= h * (0.075 + 0.05 * volume) * free;
        if (gather)
          p.x = MathUtils.lerp(
            p.x,
            scalp(Math.PI, 1.75).x,
            0.58 * gather * free,
          );
        line.push(clear(p, 0.012));
      }
      for (let strand = 0; strand < 3; strand++) {
        const points = [],
          radii = [];
        for (let j = 0; j <= steps; j++) {
          const t = j / steps,
            p = line[j].clone(),
            a = phase + tau * ((9 + 5 * length) * t + strand / 3);
          along
            .subVectors(line[Math.min(steps, j + 1)], line[Math.max(0, j - 1)])
            .normalize();
          side.copy(xAxis).addScaledVector(along, -along.x).normalize();
          normal.crossVectors(along, side).normalize();
          const taper =
            (0.23 + 0.77 * MathUtils.smoothstep(t, 0, 0.1)) *
            (1 - 0.7 * MathUtils.smoothstep(t, 0.91, 1));
          p.addScaledVector(side, width * taper * Math.sin(a)).addScaledVector(
            normal,
            width * taper * 0.54 * Math.sin(2 * a),
          );
          points.push(p);
          radii.push(width * taper * 0.67);
        }
        tube(buffers[(strand + lane) % 3], points, radii, 0.83, 5);
      }
    }
    return;
  }
  const coiled = pattern === "Coils",
    count = coiled ? 760 : 82;
  for (let n = 0; n < count; n++) {
    const a = n * 2.39996322973 + (random() - 0.5) * 0.19 + part * 0.4;
    const edgePhi = edge(a),
      phi = Math.acos(1 - ((n + 0.45) / count) * (1 - Math.cos(edgePhi)));
    const phase = random() * tau,
      noise = random();
    const tilt = MathUtils.clamp(Math.cos(a), 0, 1),
      fall = (0.19 + length * (0.64 + 0.29 * noise)) * (1 - 0.8 * tilt ** 5);
    if (coiled) {
      const surface = (angle, p) =>
        scalp(angle, p, 1 + coilLift(p, edge(angle), options, angle));
      const root = surface(a, phi),
        near = surface(a, phi + 0.018);
      along.subVectors(near, root).normalize();
      side.subVectors(surface(a + 0.015, phi), root).normalize();
      normal.crossVectors(side, along).normalize();
      if (
        normal.dot(
          v.set(
            Math.sin(a) * Math.sin(phi),
            Math.cos(phi),
            Math.cos(a) * Math.sin(phi),
          ),
        ) < 0
      )
        normal.negate();
      const points = [],
        radii = [],
        turns = 1.05 + curl * 2.8 + noise * 0.65,
        rad = h * (0.01 + 0.009 * (1 - curl) + noise * 0.003);
      for (let j = 0; j <= 22; j++) {
        const t = j / 22,
          wave = phase + t * tau * turns,
          rf = Math.sin(Math.PI * t) ** 0.45;
        const p = root
          .clone()
          .addScaledVector(along, h * t * (0.052 + 0.105 * length))
          .addScaledVector(
            side,
            rad * (Math.cos(wave) * rf + t * sweep + 1.3 * t * Math.sin(phase)),
          )
          .addScaledVector(
            normal,
            rad * (1.1 + Math.sin(wave) * rf) + h * 0.004 * t,
          );
        points.push(p);
        radii.push(h * (0.0051 + 0.0027 * noise) * (1 - 0.52 * t * t));
      }
      tube(buffers[n % 3], points, radii, 0.92, 4);
      continue;
    }
    const turns = 3 + length * 5,
      steps = 30,
      axisPath = [];
    for (let j = 0; j <= steps; j++) {
      const t = j / steps,
        over = Math.min(t / 0.43, 1),
        free = Math.max(0, (t - 0.43) / 0.57);
      const angle = a + sweep * 0.37 * over,
        arc = MathUtils.lerp(phi, edge(angle), over);
      const p = scalp(
        angle,
        arc,
        1.028 + 0.055 * Math.sin(Math.PI * over) * volume,
      );
      p.y -= h * fall * free;
      p.x +=
        h *
        (0.022 + volume * 0.09) *
        Math.sin(angle) *
        Math.sin(Math.PI * free);
      p.z -= h * (0.05 + 0.035 * tilt) * free;
      p.z += h * curl * 0.012 * Math.sin(phase + free * 8) * free;
      if (gather) {
        const back = scalp(Math.PI, 1.75, 1.04);
        p.x = MathUtils.lerp(
          p.x,
          back.x + h * 0.045 * Math.sin(a),
          gather * free,
        );
        p.z = MathUtils.lerp(p.z, back.z, gather * free);
      }
      axisPath.push(clear(p, 0.012));
    }
    const base = h * 0.018 * (0.8 + noise * 0.4);
    const radii = axisPath.map((_, j) => {
      const t = j / steps,
        tip = 1 - MathUtils.smoothstep(t, 0.87, 1) * 0.75;
      return base * tip * (1 + 0.065 * Math.sin(2 * (phase + tau * turns * t)));
    });
    tube(buffers[n % 3], axisPath, radii, 1, 6);
  }
}
