import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

export const groomDefaults = Object.freeze({
  length: 0.46,
  curl: 0.18,
  gather: 0,
  sweep: 0.24,
  volume: 0.18,
  seed: 1,
});
export function validGroom(g) {
  return (
    g &&
    Object.entries({
      length: [0, 2],
      curl: [0, 1],
      gather: [0, 1],
      sweep: [-1, 1],
      volume: [0, 1],
      seed: [0, 4294967295],
    }).every(
      ([key, [min, max]]) =>
        Number.isFinite(g[key]) && g[key] >= min && g[key] <= max,
    ) &&
    Number.isInteger(g.seed) &&
    /^#[0-9a-f]{6}$/i.test(g.color)
  );
}
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const tau = 2 * Math.PI;
function buffer() {
  const p = [],
    uv = [],
    idx = [];
  return {
    point(v, u, t) {
      p.push(v.x, v.y, v.z);
      uv.push(u, t);
    },
    quad(a, b, c, d) {
      idx.push(a, b, c, a, c, d);
    },
    get count() {
      return p.length / 3;
    },
    finish() {
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(p, 3));
      g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.computeBoundingBox();
      return g;
    },
  };
}
// The cap follows the actual head bounds. Locks run over the crown, leave the
// hairline, then fall freely or gather at a common point behind the scalp.
function headClearance(box, geometry, transform, rx, rz, cz) {
  if (!geometry) return (v) => v;
  const rows = 36,
    sectors = 48,
    grid = new Float32Array(rows * sectors);
  const center = box.getCenter(new Vector3()),
    h = box.max.y - box.min.y,
    tmp = new Vector3();
  const sector = (a) => (Math.round((a / tau) * sectors) + sectors) % sectors;
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    tmp.fromBufferAttribute(geometry.attributes.position, i);
    if (transform) tmp.applyMatrix4(transform);
    const x = (tmp.x - center.x) / rx,
      z = (tmp.z - cz) / rz,
      j = Math.max(
        0,
        Math.min(rows - 1, Math.round(((tmp.y - box.min.y) / h) * (rows - 1))),
      );
    const k = j * sectors + sector(Math.atan2(x, z));
    grid[k] = Math.max(grid[k], Math.hypot(x, z));
  }
  const filled = new Float32Array(grid.length);
  for (let j = 0; j < rows; j++)
    for (let k = 0; k < sectors; k++) {
      let sum = 0,
        weights = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const row = Math.max(0, Math.min(rows - 1, j + dy));
          const r = grid[row * sectors + ((k + dx + sectors) % sectors)];
          if (!r) continue;
          const w = 1 / (0.25 + dy * dy + dx * dx);
          sum += r * w;
          weights += w;
        }
      filled[j * sectors + k] = weights ? sum / weights : 0;
    }
  return (v, pad = 0.035) => {
    const fy = ((v.y - box.min.y) / h) * (rows - 1);
    if (fy < 0 || fy >= rows - 1) return v;
    const x = (v.x - center.x) / rx,
      z = (v.z - cz) / rz,
      r = Math.hypot(x, z);
    if (r < 0.001) return v;
    const fk = (Math.atan2(x, z) / tau + 1) * sectors,
      j = Math.floor(fy),
      k = Math.floor(fk);
    const read = (row, col) => filled[row * sectors + (col % sectors)];
    const low = mix(read(j, k), read(j, k + 1), fk - k),
      high = mix(read(j + 1, k), read(j + 1, k + 1), fk - k);
    const minRadius = mix(low, high, fy - j) + pad;
    if (r < minRadius) {
      const target = mix(
        r,
        minRadius,
        smooth(Math.min(1, (rows - 1 - fy) / 3)),
      );
      v.x = center.x + (rx * x * target) / r;
      v.z = cz + (rz * z * target) / r;
    }
    return v;
  };
}
export function groomGeometry(box, options, geometry, transform) {
  const { length, curl, gather, sweep, volume } = options;
  let state = options.seed >>> 0;
  function random() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  }
  const size = box.getSize(new Vector3()),
    center = box.getCenter(new Vector3()),
    h = size.y;
  const rx = size.x * (0.518 + 0.075 * volume),
    rz = size.z * (0.516 + 0.08 * volume),
    ry = h * (0.31 + 0.11 * volume);
  const cy = box.max.y - ry + h * (0.013 + 0.04 * volume),
    cz = center.z - 0.012 * h;
  const clear = headClearance(box, geometry, transform, rx, rz, cz);
  function edge(a) {
    const front = (1 + Math.cos(a)) / 2;
    return 2.12 - 0.96 * front ** 2 + 0.07 * Math.sin(2 * a + 0.4) * sweep;
  }
  function scalp(a, phi, inflate = 1) {
    return clear(
      new Vector3(
        center.x + rx * inflate * Math.sin(a) * Math.sin(phi),
        cy + ry * inflate * Math.cos(phi),
        cz + rz * inflate * Math.cos(a) * Math.sin(phi),
      ),
      0.035 + (inflate - 1),
    );
  }
  const cap = buffer(),
    rows = 16,
    cols = 64;
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const a = (tau * i) / cols,
        phi = 0.004 + ((edge(a) - 0.004) * j) / rows;
      cap.point(scalp(a, phi), i / cols, j / rows);
      if (i < cols && j < rows) {
        const v = j * (cols + 1) + i;
        cap.quad(v, v + cols + 1, v + cols + 2, v + 1);
      }
    }
  const locks = [buffer(), buffer(), buffer()];
  const count = 48,
    steps = 28 + Math.ceil(curl * 20),
    sides = 7;
  for (let n = 0; n < count; n++) {
    const a = (tau * (n + (random() - 0.5) * 0.38)) / count;
    const noise = random(),
      phase = random() * tau,
      front = (1 + Math.cos(a)) / 2;
    const sign = Math.sin(a) >= 0 ? 1 : -1;
    const wrapped = Math.atan2(Math.sin(a), Math.cos(a));
    const tipAngle =
      a +
      sign * front ** 5 * 0.64 +
      sweep * (0.22 + 0.26 * front) +
      sign * gather * (Math.PI - Math.abs(wrapped)) * 0.62;
    const rootAngle = a - sweep * (0.85 + 0.35 * front) - sign * 0.08;
    const startPhi = 0.12 + 0.26 * noise,
      limit = edge(tipAngle);
    const drop =
      h * (0.015 + length * (0.82 + 0.32 * noise) * (1 - 0.86 * front ** 5));
    const ring = locks[n % 3],
      base = ring.count;
    const tangent = new Vector3(),
      normal = new Vector3(),
      side = new Vector3();
    function path(t) {
      const travel = Math.min(t / 0.55, 1),
        free = Math.max((t - 0.55) / 0.45, 0);
      const a = mix(rootAngle, tipAngle, smooth(travel));
      const phi = mix(startPhi, limit, travel);
      const v = scalp(a, phi, 1.02 + 0.017 * Math.sin(Math.PI * travel));
      if (free > 0) {
        const w = smooth(Math.min(free / 0.52, 1)) * gather;
        const flare = Math.sin(Math.PI * free) * (0.045 + 0.11 * volume);
        v.x += h * Math.sin(a) * flare + sweep * h * 0.11 * free;
        v.z += h * Math.cos(a) * flare - h * 0.06 * free;
        v.y -= drop * free;
        const fall = Math.max(0, free - 0.42) / 0.58;
        const bundle =
          rx * (0.12 + 0.25 * Math.sin(Math.PI * fall)) * (1 - 0.55 * fall);
        v.lerp(
          new Vector3(
            center.x +
              sweep * rx * 0.32 +
              h * 0.08 * free +
              bundle * Math.sin(a),
            cy + 0.1 * h - drop * fall,
            cz - rz * (1.15 + free * 0.45) + bundle * 0.75 * Math.cos(a),
          ),
          w,
        );
      }
      const amp = h * curl * 0.035 * (0.24 + 0.76 * smooth(t)),
        wave = phase + t * tau * (1 + 3.8 * curl);
      v.x += amp * Math.sin(wave) * Math.cos(a);
      v.z -= amp * Math.sin(wave) * Math.sin(a);
      v.y += amp * 0.79 * Math.cos(wave);
      return clear(v, 0.062);
    }
    for (let j = 0; j <= steps; j++) {
      const t = j / steps,
        v = path(t);
      tangent
        .copy(path(Math.min(1, t + 0.002)))
        .sub(path(Math.max(0, t - 0.002)))
        .normalize();
      normal.set(v.x - center.x, (v.y - cy) * 0.76, v.z - cz);
      if (t > 0.57)
        normal.set(
          mix(Math.sin(tipAngle), 0, gather),
          0.13,
          mix(Math.cos(tipAngle), -1, gather),
        );
      side.crossVectors(tangent, normal);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
      else side.normalize();
      normal.crossVectors(side, tangent).normalize();
      const thickness = h * (0.032 + 0.013 * volume) * (0.84 + 0.32 * noise);
      const tip = Math.max(0.035, (1 - t ** 3) ** 0.64);
      const width =
        thickness *
        (0.57 + 0.68 * Math.sin((Math.PI * Math.min(t / 0.64, 1)) / 2)) *
        tip;
      for (let i = 0; i <= sides; i++) {
        const ang = (tau * i) / sides;
        const q = v
          .clone()
          .addScaledVector(side, width * Math.cos(ang))
          .addScaledVector(normal, width * (0.3 + 0.31 * curl) * Math.sin(ang));
        ring.point(q, i / sides, t);
        if (j < steps && i < sides) {
          const k = base + j * (sides + 1) + i;
          ring.quad(k, k + sides + 1, k + sides + 2, k + 1);
        }
      }
    }
  }
  return [cap, ...locks].map((b) => b.finish());
}
