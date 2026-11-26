import { clamp, dot, hash1, length, mix, smooth, sub } from "./human-style-kit.js";

const TAU = Math.PI * 2;

export const drapes = {
  gown: { sweep: .17, reach: .26, folds: 8, deep: .3, calm: .5, back: .35, lift: .03, onset: .14 },
  gored: { sweep: .3, reach: .2, folds: 11, deep: .27, calm: .2, back: .2, lift: .026, onset: .08 },
  dress: { sweep: .26, reach: .16, folds: 15, deep: .24, calm: .1, back: .1, lift: .02, onset: .05 },
  skirt: { sweep: .15, reach: .14, folds: 9, deep: .2, calm: .3, back: .1, lift: .014, onset: .06 },
  robe: { sweep: .1, reach: .3, folds: 7, deep: .26, calm: .15, back: .2, lift: .022, onset: .03 },
};

const turn = a => ((a % TAU) + TAU) % TAU;
const fromFront = a => { const t = turn(a); return Math.min(t, TAU - t); };

export function drapeField(env, { k, nominal, seat = nominal, seed = 0, sweep, reach, folds, deep, calm, back, lift, onset }) {
  const { rows, cols } = env, dh = (env.h1 - env.h0) / (rows - 1), body = env.r, at = (i, j) => i * cols + ((j % cols) + cols) % cols;
  const hung = body.slice(), fork = Math.min(rows - 1, Math.round(seat / dh));
  for (let j = 0; j < cols; j++) for (let i = 1; i < rows; i++) hung[at(i, j)] = i > fork ? hung[at(fork, j)] : Math.max(hung[at(i, j)], hung[at(i - 1, j)]);
  const round = .045 * k;
  for (let j = 0; j < cols; j++) for (let pass = 0; pass < 3; pass++) for (let i = rows - 2; i >= 1; i--) {
    const span = Math.max(1, Math.round(round / dh)), lo = Math.max(0, i - span), hi = Math.min(rows - 1, i + span);
    const chord = mix(hung[at(lo, j)], hung[at(hi, j)], (i - lo) / (hi - lo));
    if (chord > hung[at(i, j)]) hung[at(i, j)] = mix(hung[at(i, j)], chord, .7);
  }
  for (let pass = 0; pass < 2; pass++) {
    const old = hung.slice();
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) hung[at(i, j)] = Math.max(old[at(i, j)], (old[at(i, j - 1)] + 2 * old[at(i, j)] + old[at(i, j + 1)]) / 4);
  }
  const legs = new Float32Array(rows * cols);
  for (let j = 0; j < cols; j++) for (let i = fork + 1; i < rows; i++) legs[at(i, j)] = Math.max(legs[at(i - 1, j)], body[at(i, j)]);
  for (let pass = 0; pass < 2; pass++) {
    const old = legs.slice();
    for (let i = fork + 1; i < rows; i++) for (let j = 0; j < cols; j++) legs[at(i, j)] = Math.max(old[at(i, j)], (old[at(i, j - 1)] + 2 * old[at(i, j)] + old[at(i, j + 1)]) / 4);
  }
  const leaveRow = new Float32Array(cols);
  for (let j = 0; j < cols; j++) {
    const most = hung[at(rows - 1, j)];
    let i = 0;
    while (i < rows - 1 && hung[at(i, j)] < most - .003 * k) i++;
    leaveRow[j] = i;
  }
  for (let pass = 0; pass < 4; pass++) { const old = leaveRow.slice(); for (let j = 0; j < cols; j++) leaveRow[j] = (old[(j + cols - 1) % cols] + 2 * old[j] + old[(j + 1) % cols]) / 4; }
  const s = n => hash1(seed * 7 + n) * TAU, even = Math.min(1, folds / 11);
  const phase = a => folds * a + even * (1.05 * Math.sin(2 * a + s(1)) + .8 * Math.sin(3 * a + s(2)) + .45 * Math.sin(5 * a + s(3))) + s(4);
  const fullness = a => (1 + .3 * Math.sin(2.3 * a + s(5)) + .18 * Math.sin(4 * a + s(6))) * (1 - calm * Math.exp(-((fromFront(a) / .5) ** 2))) * (1 + back * .5 * (1 - Math.cos(a)));
  const wave = p => -(Math.cos(p) + .32 * Math.cos(2 * p)) / 1.32;
  const mean = new Float32Array(rows * cols), stand = new Float32Array(rows * cols), free = new Float32Array(rows * cols);
  for (let j = 0; j < cols; j++) {
    const a = j / cols * TAU, full = fullness(a), lean = .5 * Math.sin(a * 2 + s(7));
    for (let i = 0; i < rows; i++) {
      const t = Math.max(0, (i - leaveRow[j]) * dh), far = hung[at(i, j)];
      const bell = sweep * full * reach * k * (1 - Math.exp(-t / (reach * k)));
      const r = Math.max(far + bell, legs[at(i, j)] + .004 * k);
      const spare = Math.max(0, far + sweep * full * t - r), width = TAU * r / folds;
      const height = Math.min((2 * r / folds) * Math.sqrt(spare / r), deep * width) * smooth(0, onset * k, t);
      mean[at(i, j)] = r;
      free[at(i, j)] = far + bell;
      stand[at(i, j)] = height * wave(phase(a) + lean * t / k);
    }
  }
  const length = new Float32Array(rows * cols), reachRow = nominal / dh;
  for (let j = 0; j < cols; j++) for (let i = 1; i < rows; i++) {
    const dr = mean[at(i, j)] + stand[at(i, j)] - mean[at(i - 1, j)] - stand[at(i - 1, j)];
    length[at(i, j)] = length[at(i - 1, j)] + Math.hypot(dh, dr);
  }
  const along = (j, f) => { const i = Math.min(rows - 2, Math.floor(f)); return mix(length[at(i, j)], length[at(i + 1, j)], f - i); };
  let cut = 0;
  for (let j = 0; j < cols; j++) cut += along(j, Math.min(rows - 1, reachRow)) / cols;
  const hemRow = new Float32Array(cols);
  for (let j = 0; j < cols; j++) {
    let i = 1;
    while (i < rows - 1 && length[at(i, j)] < cut) i++;
    const f = i - 1 + clamp((cut - length[at(i - 1, j)]) / Math.max(1e-6, length[at(i, j)] - length[at(i - 1, j)]));
    const a = j / cols * TAU, wander = lift * k * (.4 * Math.sin(2 * a + s(8)) + .28 * Math.sin(3 * a + s(9)) - .22 * wave(phase(a)));
    hemRow[j] = clamp(f + wander / dh, reachRow - lift * k / dh, Math.min(rows - 1, reachRow + lift * k / dh));
  }
  for (let pass = 0; pass < 1; pass++) { const old = hemRow.slice(); for (let j = 0; j < cols; j++) hemRow[j] = (old[(j + cols - 1) % cols] + 2 * old[j] + old[(j + 1) % cols]) / 4; }
  const sample = (field, h, a) => {
    const fr = clamp((h - env.h0) / dh, 0, rows - 1), i = Math.min(rows - 2, Math.floor(fr)), t = fr - i, fc = turn(a) / TAU * cols, j = Math.floor(fc) % cols, u = fc - Math.floor(fc);
    return mix(mix(field[at(i, j)], field[at(i, j + 1)], u), mix(field[at(i + 1, j)], field[at(i + 1, j + 1)], u), t);
  };
  const ring = (field, a) => { const fc = turn(a) / TAU * cols, j = Math.floor(fc) % cols, u = fc - Math.floor(fc); return mix(field[j], field[(j + 1) % cols], u); };
  return {
    radius: (h, a) => sample(mean, h, a) + sample(stand, h, a),
    mean: (h, a) => sample(mean, h, a),
    free: (h, a) => sample(free, h, a),
    relief: (h, a) => sample(stand, h, a),
    hem: a => env.h0 + ring(hemRow, a) * dh,
    leave: a => env.h0 + ring(leaveRow, a) * dh,
  };
}

export const drapeColumns = 8;

export function drapeJoints(body, m, env, field, { top, bottom, name = "Skirt", least = .2 }) {
  const k = m.k, high = m.hip + .02 * k, low = m.hip - .17 * k;
  if (low - bottom < least * k) return null;
  const joints = [], flat = (p, c) => Math.hypot(p[0] - c[0], p[2] - c[2]);
  [mix(low, bottom, .42), bottom].forEach((y, level) => {
    for (let c = 0; c < drapeColumns; c++) {
      const a = (c + .5) / drapeColumns * TAU, h = top - y, at = env.point(h, a, field.mean(h, a)), centre = env.point(h, a, 0);
      const from = env.point(top - low, a, field.mean(top - low, a)), r = flat(at, centre) || 1;
      joints.push({ name: name + "_" + (level + 1) + "_" + (c + 1), level, column: c, at, from, dir: [(at[0] - centre[0]) / r, (at[2] - centre[2]) / r], free: field.free(h, a) });
    }
  });
  const legs = [];
  for (const side of ["l", "r"]) for (const [from, to, limb] of [["thigh", "calf", true], ["calf", "foot", true], ["foot", "ball", false]]) {
    const a = body.joint(from + "_" + side), b = body.joint(to + "_" + side), axis = sub(b, a), span = dot(axis, axis) || 1, count = limb ? 6 : 2;
    const w = limb ? body.weight(new RegExp("^(thigh|calf)_" + side)) : null, far = Array.from({ length: count }, () => []);
    if (w) for (let v = 0; v < body.count; v++) {
      if (w[v] < .5) continue;
      const p = body.point(v), t = dot(sub(p, a), axis) / span, i = Math.floor(t * count);
      if (i >= 0 && i < count) far[i].push(length(sub(p, [a[0] + axis[0] * t, a[1] + axis[1] * t, a[2] + axis[2] * t])));
    }
    const radii = far.map(list => { list.sort((x, y) => x - y); return list.length > 8 ? list[Math.floor(list.length * .9)] : (limb ? .06 : .045) * k; });
    legs.push({ from: from + "_" + side, to: to + "_" + side, radii });
  }
  const origin = env.point(0, 0, 0);
  return { name, columns: drapeColumns, joints, legs, axis: [origin[0], origin[2]], pelvis: body.joint("pelvis"), floor: body.floor, scale: k, low, high };
}
