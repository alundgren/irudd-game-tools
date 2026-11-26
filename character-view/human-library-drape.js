import { Envelope, clamp, mergeSkin, mix, smooth } from "./human-style-kit.js";
import { landmarks } from "./human-style-cloth.js";
import { drapeField, drapeJoints, drapes } from "./human-skirt-drape.js";
import { surfaceBody } from "./human-fringe.js";

const TAU = Math.PI * 2, ARMS = /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/;

export const hungGarments = {
  shift_dress: { cloth: { sweep: .05, reach: .12, folds: 6, deep: .14, calm: .5, back: .1, lift: .006, onset: .08 }, ease: .009, keep: .6, name: "Dress" },
  full_skirt: { cloth: { ...drapes.gored, sweep: .2, deep: .07 }, ease: .01, keep: .85, name: "Skirt" },
};

export const sleeveBone = name => ARMS.test(name);

export function hangLibraryCloth(surface, name, p, bones, skin) {
  const cut = hungGarments[name];
  if (!cut) return null;
  const body = surfaceBody(surface), m = landmarks(body), k = m.k, count = p.length / 3, top = m.waistband;
  const arms = body.names.map(sleeveBone), lower = [];
  let bottom = Infinity;
  for (let i = 0; i < count; i++) {
    if (p[i * 3 + 1] >= top) continue;
    let sleeve = 0;
    for (let j = i * 4; j < i * 4 + 4; j++) if (arms[bones[j]]) sleeve += skin[j];
    if (sleeve > .3) continue;
    lower.push(i);
    bottom = Math.min(bottom, p[i * 3 + 1]);
  }
  if (lower.length < 24 || top - bottom < .12 * k) return null;
  const depth = top - bottom, past = (cut.cloth.lift + .012) * k, rows = Math.round((depth + past) / (.016 * k)) + 1, cols = 72;
  const ring = () => { const env = new Envelope([0, top, m.pelvis[2]], [0, -1, 0], 0, depth + past, rows, cols); env.fixed = true; return env; };
  const arm = body.weight(ARMS), figure = [];
  for (let v = 0; v < body.count; v++) { const y = body.P[v * 3 + 1]; if (arm[v] < .3 && y < top + .04 * k && y > bottom - .008 * k) figure.push(body.point(v)); }
  const env = ring().measure(figure).taut(1), at = i => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  const bins = 36, dh = (depth + past) / (rows - 1), sum = new Float32Array(rows * bins), hits = new Float32Array(rows * bins), cell0 = (i, j) => i * bins + ((j % bins) + bins) % bins;
  const polar = lower.map(i => env.polar(at(i)));
  for (const [h, a, r] of polar) { const c = cell0(clamp(Math.round(h / dh), 0, rows - 1), Math.floor((((a / TAU) % 1) + 1) % 1 * bins)); sum[c] += r; hits[c]++; }
  const broad = new Float32Array(rows * bins);
  for (let i = 0; i < rows; i++) for (let j = 0; j < bins; j++) {
    let found = -1;
    for (let d = 0; d <= bins / 2 && found < 0; d++) for (const [di, dj] of [[0, d], [0, -d], [-1, d], [1, d], [-1, -d], [1, -d]]) { const ii = i + di; if (ii >= 0 && ii < rows && hits[cell0(ii, j + dj)]) { found = cell0(ii, j + dj); break; } }
    broad[cell0(i, j)] = found < 0 ? 0 : sum[found] / hits[found];
  }
  for (let pass = 0; pass < 12; pass++) { const old = broad.slice(); for (let i = 0; i < rows; i++) for (let j = 0; j < bins; j++) broad[cell0(i, j)] = (old[cell0(i, j - 1)] + 2 * old[cell0(i, j)] + old[cell0(i, j + 1)]) / 4; }
  for (let pass = 0; pass < 2; pass++) { const old = broad.slice(); for (let i = 1; i < rows - 1; i++) for (let j = 0; j < bins; j++) broad[cell0(i, j)] = (old[cell0(i - 1, j)] + 2 * old[cell0(i, j)] + old[cell0(i + 1, j)]) / 4; }
  const own = (h, a) => {
    const fr = clamp(h / dh, 0, rows - 1), i = Math.min(rows - 2, Math.floor(fr)), t = fr - i, fc = (((a / TAU) % 1) + 1) % 1 * bins - .5, j = Math.floor(fc), u = fc - j;
    return mix(mix(broad[cell0(i, j)], broad[cell0(i, j + 1)], u), mix(broad[cell0(i + 1, j)], broad[cell0(i + 1, j + 1)], u), t);
  };
  const field = drapeField(env, { k, nominal: depth, seat: top - m.crotch + .05 * k, seed: Math.round(m.waist * 1013 + m.shoulderWidth * 7919 + depth * 331 + count), ...cut.cloth });
  lower.forEach((i, n) => {
    const [h, a, r] = polar[n], relief = (r - own(h, a)) * cut.keep;
    const hung = field.radius(h, a) + cut.ease * k * mix(.3, 1, smooth(0, .1 * depth, h)) + relief;
    p.set(env.point(h, a, mix(r, hung, smooth(0, .07 * k, h))), i * 3);
  });
  const cell = .03 * k, key = (x, y, z) => (Math.floor(x / cell) + 512) + (Math.floor(y / cell) + 512) * 1024 + (Math.floor(z / cell) + 512) * 1048576, grid = new Map();
  for (const i of lower) { const id = key(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); (grid.get(id) ?? grid.set(id, []).get(id)).push(i); }
  const mirror = i => {
    const x = -p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    let best = -1, least = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      for (const j of grid.get(key(x + dx * cell, y + dy * cell, z + dz * cell)) ?? []) { const d = (p[j * 3] - x) ** 2 + (p[j * 3 + 1] - y) ** 2 + (p[j * 3 + 2] - z) ** 2; if (d < least) { least = d; best = j; } }
    return best;
  };
  const shared = new Map();
  for (const i of lower) {
    const share = .5 - .5 * smooth(0, .04 * k, Math.abs(p[i * 3])), j = share > 0 ? mirror(i) : -1;
    if (j < 0 || j === i) continue;
    const pairs = [];
    for (let n = 0; n < 4; n++) pairs.push([bones[i * 4 + n], skin[i * 4 + n] * (1 - share)], [bones[j * 4 + n], skin[j * 4 + n] * share]);
    shared.set(i, mergeSkin(pairs));
  }
  for (const [i, [ids, weights]] of shared) for (let n = 0; n < 4; n++) { bones[i * 4 + n] = ids[n]; skin[i * 4 + n] = weights[n]; }
  return drapeJoints(body, m, env, field, { top, bottom, name: cut.name, least: .1 });
}
