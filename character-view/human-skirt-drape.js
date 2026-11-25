// How a long skirt hangs. A skirt is a length of cloth sewn to the waist: it lies on the body down to the widest
// place under it, leaves the body there and falls. Its pattern is wider at the hem than the fall is, and what
// is left over stands in folds. The hem is where the cloth runs out, so it rides up over a belly or a seat and
// dips between folds.
//   drapes               named cloths: how full the pattern is, how soon the fall turns vertical, how many folds
//   drapeField(env, o)   the hanging surface over a measured figure
//   drapeJoints(...)     a few joints the lower cloth can hang from
import { clamp, dot, hash1, length, mix, smooth, sub } from "./human-style-kit.js";

const TAU = Math.PI * 2;

/**
 * Cloths that hang differently.
 *   sweep   how much wider the pattern grows per metre of length, as radius
 *   reach   the length over which the cloth leaving the hip turns to a vertical fall; stiff cloth has a long reach
 *   folds   how many folds the fullness gathers into around the whole skirt
 *   deep    the deepest a fold may stand, as a share of its width
 *   calm    how flat the centre front lies
 *   back    extra fullness carried behind
 *   lift    the most the hem may ride above or dip below its line, in metres before body scaling
 */
export const drapes = {
  // Heavy satin: few deep flutes that open late.
  gown: { sweep: .17, reach: .26, folds: 8, deep: .3, calm: .5, back: .35, lift: .03, onset: .14 },
  // A gored skirt in a lighter silk: a rounder bell and more, shallower folds.
  gored: { sweep: .3, reach: .2, folds: 11, deep: .27, calm: .2, back: .2, lift: .026, onset: .08 },
  // A cotton day dress: many small soft folds from the waist seam.
  dress: { sweep: .26, reach: .16, folds: 15, deep: .24, calm: .1, back: .1, lift: .02, onset: .05 },
  // A short wool or twill skirt: nearly straight, a few broad folds.
  skirt: { sweep: .15, reach: .14, folds: 9, deep: .2, calm: .3, back: .1, lift: .014, onset: .06 },
  // A woollen robe: a straight heavy tube that breaks in long folds under the belt.
  robe: { sweep: .1, reach: .3, folds: 7, deep: .26, calm: .15, back: .2, lift: .022, onset: .03 },
};

const turn = a => ((a % TAU) + TAU) % TAU;
// Distance round the circle from the centre front.
const fromFront = a => { const t = turn(a); return Math.min(t, TAU - t); };

/**
 * The hanging surface of a skirt over `env`, an Envelope measured round the figure and pulled taut round each
 * ring, running from the waist seam (row 0) down past the hem. `nominal` is the length to the designed hem line
 * and `seat` the depth of the fork of the legs: the cloth hangs from the trunk above it, and the legs below it
 * only push the cloth out where they stand further out than it falls.
 * Returns
 *   radius(h, a)   distance from the ring's centre at a depth and direction, folds included
 *   relief(h, a)   how far the folds stand out of (positive) or sink into the mean surface there
 *   hem(a)         depth of the hem in that direction
 *   leave(a)       depth at which the cloth leaves the body
 *   mean(h, a)     the surface without its folds
 *   free(h, a)     where the cloth would fall with no leg carrying it
 */
export function drapeField(env, { k, nominal, seat = nominal, seed = 0, sweep, reach, folds, deep, calm, back, lift, onset }) {
  const { rows, cols } = env, dh = (env.h1 - env.h0) / (rows - 1), body = env.r, at = (i, j) => i * cols + ((j % cols) + cols) % cols;
  // Hanging cloth never turns back in under a prominence.
  const hung = body.slice(), fork = Math.min(rows - 1, Math.round(seat / dh));
  for (let j = 0; j < cols; j++) for (let i = 1; i < rows; i++) hung[at(i, j)] = i > fork ? hung[at(fork, j)] : Math.max(hung[at(i, j)], hung[at(i - 1, j)]);
  // Cloth has some stiffness: it does not follow a sharp ledge under the waist seam but rounds it, standing a
  // little proud above the ledge. The corner may be no tighter than a few centimetres.
  const round = .045 * k;
  for (let j = 0; j < cols; j++) for (let pass = 0; pass < 3; pass++) for (let i = rows - 2; i >= 1; i--) {
    const span = Math.max(1, Math.round(round / dh)), lo = Math.max(0, i - span), hi = Math.min(rows - 1, i + span);
    const chord = mix(hung[at(lo, j)], hung[at(hi, j)], (i - lo) / (hi - lo));
    if (chord > hung[at(i, j)]) hung[at(i, j)] = mix(hung[at(i, j)], chord, .7);
  }
  // Round each ring too, without ever letting the cloth inside the figure.
  for (let pass = 0; pass < 2; pass++) {
    const old = hung.slice();
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) hung[at(i, j)] = Math.max(old[at(i, j)], (old[at(i, j - 1)] + 2 * old[at(i, j)] + old[at(i, j + 1)]) / 4);
  }
  // Below the fork a thigh or a knee that stands out carries the cloth, which hangs straight from it in turn.
  const legs = new Float32Array(rows * cols);
  for (let j = 0; j < cols; j++) for (let i = fork + 1; i < rows; i++) legs[at(i, j)] = Math.max(legs[at(i - 1, j)], body[at(i, j)]);
  for (let pass = 0; pass < 2; pass++) {
    const old = legs.slice();
    for (let i = fork + 1; i < rows; i++) for (let j = 0; j < cols; j++) legs[at(i, j)] = Math.max(old[at(i, j)], (old[at(i, j - 1)] + 2 * old[at(i, j)] + old[at(i, j + 1)]) / 4);
  }
  // Where the cloth leaves the body in each direction: the first depth at which it is as far out as it will get.
  const leaveRow = new Float32Array(cols);
  for (let j = 0; j < cols; j++) {
    const most = hung[at(rows - 1, j)];
    let i = 0;
    while (i < rows - 1 && hung[at(i, j)] < most - .003 * k) i++;
    leaveRow[j] = i;
  }
  for (let pass = 0; pass < 4; pass++) { const old = leaveRow.slice(); for (let j = 0; j < cols; j++) leaveRow[j] = (old[(j + cols - 1) % cols] + 2 * old[j] + old[(j + 1) % cols]) / 4; }
  // The folds of one skirt: unevenly spaced, some fuller than others, the same for the same figure and cloth.
  const s = n => hash1(seed * 7 + n) * TAU, even = Math.min(1, folds / 11);
  const phase = a => folds * a + even * (1.05 * Math.sin(2 * a + s(1)) + .8 * Math.sin(3 * a + s(2)) + .45 * Math.sin(5 * a + s(3))) + s(4);
  const fullness = a => (1 + .3 * Math.sin(2.3 * a + s(5)) + .18 * Math.sin(4 * a + s(6))) * (1 - calm * Math.exp(-((fromFront(a) / .5) ** 2))) * (1 + back * .5 * (1 - Math.cos(a)));
  // A fold seen from above: a broad lobe standing out and a narrower valley between two of them.
  const wave = p => -(Math.cos(p) + .32 * Math.cos(2 * p)) / 1.32;
  const mean = new Float32Array(rows * cols), stand = new Float32Array(rows * cols), free = new Float32Array(rows * cols);
  for (let j = 0; j < cols; j++) {
    const a = j / cols * TAU, full = fullness(a), lean = .5 * Math.sin(a * 2 + s(7));
    for (let i = 0; i < rows; i++) {
      const t = Math.max(0, (i - leaveRow[j]) * dh), far = hung[at(i, j)];
      // Leaving the hip the cloth carries on outward and gravity turns it down: a bell, not a cone.
      const bell = sweep * full * reach * k * (1 - Math.exp(-t / (reach * k)));
      // A leg standing further out than the fall carries the cloth out with it.
      const r = Math.max(far + bell, legs[at(i, j)] + .004 * k);
      // What the pattern has over the fall stands in folds. A wave of `folds` lobes and height A round a ring
      // of radius r is longer than the ring by about (folds * A / 2r)^2.
      const spare = Math.max(0, far + sweep * full * t - r), width = TAU * r / folds;
      const height = Math.min((2 * r / folds) * Math.sqrt(spare / r), deep * width) * smooth(0, onset * k, t);
      mean[at(i, j)] = r;
      free[at(i, j)] = far + bell;
      stand[at(i, j)] = height * wave(phase(a) + lean * t / k);
    }
  }
  // The hem lies where the cloth runs out. Every length of the pattern is as long as the designed hem line
  // needs on average, so cloth that travels further over a belly, a seat or the crest of a fold ends higher.
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
    // No hem is cut or pressed dead level: it wanders a little round the skirt and dips between the folds.
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

/** How many joints stand round each level of a hanging skirt. */
export const drapeColumns = 8;

/**
 * Joints for the hanging part of a skirt. Cloth skinned to the legs swings out with every step as a stiff cone;
 * hung from a ring of joints at mid length and another at the hem it stays upright under the hips, is pushed
 * out by a knee and comes back late. This only describes the joints, in the space the figure was fitted in. The
 * cloth itself keeps its weights on the body: the rig makes the joints, hangs the cloth below the hips on them
 * and moves them (human-drape-rig.js), and without that rig the cloth moves with the legs.
 *   top, bottom   heights of the seam and of the hem line
 *   least         the shortest length below the hips, in body lengths, that is given joints
 * Returns null for a skirt too short to hang free of the thighs.
 */
export function drapeJoints(body, m, env, field, { top, bottom, name = "Skirt", least = .2 }) {
  const k = m.k, high = m.hip + .02 * k, low = m.hip - .17 * k;
  if (low - bottom < least * k) return null;
  const joints = [], flat = (p, c) => Math.hypot(p[0] - c[0], p[2] - c[2]);
  [mix(low, bottom, .42), bottom].forEach((y, level) => {
    for (let c = 0; c < drapeColumns; c++) {
      const a = (c + .5) / drapeColumns * TAU, h = top - y, at = env.point(h, a, field.mean(h, a)), centre = env.point(h, a, 0);
      // The cloth this joint carries hangs from the hips at the height where the body lets go of it.
      const from = env.point(top - low, a, field.mean(top - low, a)), r = flat(at, centre) || 1;
      joints.push({ name: name + "_" + (level + 1) + "_" + (c + 1), level, column: c, at, from, dir: [(at[0] - centre[0]) / r, (at[2] - centre[2]) / r], free: field.free(h, a) });
    }
  });
  // The legs as rows of balls, each as thick as the limb is there.
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
  // Above `high` the cloth is the body's, below `low` the joints'.
  return { name, columns: drapeColumns, joints, legs, axis: [origin[0], origin[2]], pelvis: body.joint("pelvis"), floor: body.floor, scale: k, low, high };
}
