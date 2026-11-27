import { at, vec, Envelope, clamp, mergeSkin, mix, smooth, type Skin } from "./kit.js";
import { landmarks } from "./cloth.js";
import { drapeField, drapeJoints, drapes, type Cloth } from "./skirt.js";
import { surfaceBody } from "./fringe.js";
import type { HumanSurface } from "../surface.js";
const TAU = Math.PI * 2,
  ARMS = /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;

const hungGarments: Record<string, { cloth: Cloth; ease: number; keep: number; name: string }> = {
  shift_dress: {
    cloth: {
      sweep: 0.05,
      reach: 0.12,
      folds: 6,
      deep: 0.14,
      calm: 0.5,
      back: 0.1,
      lift: 0.006,
      onset: 0.08,
    },
    ease: 0.009,
    keep: 0.6,
    name: "Dress",
  },
  full_skirt: {
    cloth: { ...drapes.gored, sweep: 0.2, deep: 0.07 },
    ease: 0.01,
    keep: 0.85,
    name: "Skirt",
  },
};

export const sleeveBone = (name: string) => ARMS.test(name);

export function hangLibraryCloth(
  surface: HumanSurface,
  name: string,
  p: Float32Array,
  bones: Uint8Array,
  skin: Float32Array,
) {
  const cut = hungGarments[name];
  if (!cut) return null;
  const body = surfaceBody(surface),
    m = landmarks(body),
    k = m.k,
    count = p.length / 3,
    top = m.waistband;
  const arms = body.names.map(sleeveBone),
    lower = [];
  let bottom = Infinity;
  for (let i = 0; i < count; i++) {
    if (at(p, i * 3 + 1) >= top) continue;
    let sleeve = 0;
    for (let j = i * 4; j < i * 4 + 4; j++) if (arms[at(bones, j)]) sleeve += at(skin, j);
    if (sleeve > 0.3) continue;
    lower.push(i);
    bottom = Math.min(bottom, at(p, i * 3 + 1));
  }
  if (lower.length < 24 || top - bottom < 0.12 * k) return null;
  const depth = top - bottom,
    past = (cut.cloth.lift + 0.012) * k,
    rows = Math.round((depth + past) / (0.016 * k)) + 1,
    cols = 72;
  const ring = () => {
    const env = new Envelope([0, top, m.pelvis[2]], [0, -1, 0], 0, depth + past, rows, cols);
    env.fixed = true;
    return env;
  };
  const arm = body.weight(ARMS),
    figure = [];
  for (let v = 0; v < body.count; v++) {
    const y = at(body.P, v * 3 + 1);
    if (at(arm, v) < 0.3 && y < top + 0.04 * k && y > bottom - 0.008 * k)
      figure.push(body.point(v));
  }
  const env = ring().measure(figure).taut(1),
    position = (i: number) => vec(p, 3 * i);
  const bins = 36,
    dh = (depth + past) / (rows - 1),
    sum = new Float32Array(rows * bins),
    hits = new Float32Array(rows * bins),
    cell0 = (i: number, j: number) => i * bins + (((j % bins) + bins) % bins);
  const polar = lower.map((i) => env.polar(position(i)));
  for (const [h, a, r] of polar) {
    const c = cell0(
      clamp(Math.round(h / dh), 0, rows - 1),
      Math.floor(((((a / TAU) % 1) + 1) % 1) * bins),
    );
    sum[c] = at(sum, c) + r;
    hits[c] = at(hits, c) + 1;
  }
  const broad = new Float32Array(rows * bins);
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < bins; j++) {
      let found = -1;
      for (let d = 0; d <= bins / 2 && found < 0; d++)
        for (const [di, dj] of [
          [0, d],
          [0, -d],
          [-1, d],
          [1, d],
          [-1, -d],
          [1, -d],
        ] as const) {
          const ii = i + di;
          if (ii >= 0 && ii < rows && at(hits, cell0(ii, j + dj))) {
            found = cell0(ii, j + dj);
            break;
          }
        }
      broad[cell0(i, j)] = found < 0 ? 0 : at(sum, found) / at(hits, found);
    }
  for (let pass = 0; pass < 12; pass++) {
    const old = broad.slice();
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < bins; j++)
        broad[cell0(i, j)] =
          (at(old, cell0(i, j - 1)) + 2 * at(old, cell0(i, j)) + at(old, cell0(i, j + 1))) / 4;
  }
  for (let pass = 0; pass < 2; pass++) {
    const old = broad.slice();
    for (let i = 1; i < rows - 1; i++)
      for (let j = 0; j < bins; j++)
        broad[cell0(i, j)] =
          (at(old, cell0(i - 1, j)) + 2 * at(old, cell0(i, j)) + at(old, cell0(i + 1, j))) / 4;
  }
  const own = (h: number, a: number) => {
    const fr = clamp(h / dh, 0, rows - 1),
      i = Math.min(rows - 2, Math.floor(fr)),
      t = fr - i,
      fc = ((((a / TAU) % 1) + 1) % 1) * bins - 0.5,
      j = Math.floor(fc),
      u = fc - j;
    return mix(
      mix(at(broad, cell0(i, j)), at(broad, cell0(i, j + 1)), u),
      mix(at(broad, cell0(i + 1, j)), at(broad, cell0(i + 1, j + 1)), u),
      t,
    );
  };
  const field = drapeField(env, {
    k,
    nominal: depth,
    seat: top - m.crotch + 0.05 * k,
    seed: Math.round(m.waist * 1013 + m.shoulderWidth * 7919 + depth * 331 + count),
    ...cut.cloth,
  });
  lower.forEach((i, n) => {
    const [h, a, r] = polar[n] ?? [0, 0, 0],
      relief = (r - own(h, a)) * cut.keep;
    const hung =
      field.radius(h, a) + cut.ease * k * mix(0.3, 1, smooth(0, 0.1 * depth, h)) + relief;
    p.set(env.point(h, a, mix(r, hung, smooth(0, 0.07 * k, h))), i * 3);
  });
  const cell = 0.03 * k,
    key = (x: number, y: number, z: number) =>
      Math.floor(x / cell) +
      512 +
      (Math.floor(y / cell) + 512) * 1024 +
      (Math.floor(z / cell) + 512) * 1048576,
    grid = new Map<number, number[]>();
  for (const i of lower) {
    const id = key(at(p, i * 3), at(p, i * 3 + 1), at(p, i * 3 + 2));
    let list = grid.get(id);
    if (!list) grid.set(id, (list = []));
    list.push(i);
  }
  const mirror = (i: number) => {
    const x = -at(p, i * 3),
      y = at(p, i * 3 + 1),
      z = at(p, i * 3 + 2);
    let best = -1,
      least = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const j of grid.get(key(x + dx * cell, y + dy * cell, z + dz * cell)) ?? []) {
            const d =
              (at(p, j * 3) - x) ** 2 + (at(p, j * 3 + 1) - y) ** 2 + (at(p, j * 3 + 2) - z) ** 2;
            if (d < least) {
              least = d;
              best = j;
            }
          }
    return best;
  };
  const shared = new Map<number, Skin>();
  for (const i of lower) {
    const share = 0.5 - 0.5 * smooth(0, 0.04 * k, Math.abs(at(p, i * 3))),
      j = share > 0 ? mirror(i) : -1;
    if (j < 0 || j === i) continue;
    const pairs: [number, number][] = [];
    for (let n = 0; n < 4; n++)
      pairs.push(
        [at(bones, i * 4 + n), at(skin, i * 4 + n) * (1 - share)],
        [at(bones, j * 4 + n), at(skin, j * 4 + n) * share],
      );
    shared.set(i, mergeSkin(pairs));
  }
  for (const [i, [ids, weights]] of shared)
    for (let n = 0; n < 4; n++) {
      bones[i * 4 + n] = at(ids, n);
      skin[i * 4 + n] = at(weights, n);
    }
  return drapeJoints(body, m, env, field, { top, bottom, name: cut.name, least: 0.1 });
}
