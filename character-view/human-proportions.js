import { Vector3 } from "three";
import { evaluateHuman, humanFitAxes, humanRange, humanSmoothSources } from "./human-surface.js";
import { changeHuman } from "./human-form.js";
import { exteriorSkin } from "./human-fit-exterior.js";
import { eyeOpenings } from "./human-fit-eyes.js";

/* Named proportions of the editable face, each a caliper reading between two places of
   its own skin. A place is one vertex of the smooth surface, or the middle of a few.
   They are the same places on every head this generator makes: where the edges of the
   lids meet and where they stand highest and lowest, the corners of the mouth, the
   widest point of the nostril wings and the turning points of the profile down the
   middle of the face. Each is where an artist would mark that feature on this head. */
const places = {
  eyeOuter: [13377],
  eyeInner: [13365],
  lidUpper: [13352],
  lidLower: [13370],
  eyeOuterRight: [6781],
  eyeInnerRight: [6769],
  mouthLeft: [7272],
  mouthRight: [527],
  nostrilLeft: [11673],
  nostrilRight: [5056],
  noseRoot: [132],
  noseBase: [5072],
  lipTop: [455],
  mouthLine: [474, 523],
  lipBottom: [492, 5337],
  chinBase: [732],
};
export const proportionPlaces = places;

/* `ends` tells the artist what to mark on a reference; either end may be marked first.
   Every reading is taken as the face is seen from straight ahead, the way proportions
   are compared on a drawing or a photograph: a span is the distance between its ends in
   that view and a height their vertical distance. How far forward an end lies does not
   count, so the curve of the face and the depth of a click change nothing. A rise is how
   far the end farther from the middle of the face stands above the nearer one, so it
   can be negative. */
export const proportions = [
  { id: "mouthWidth", name: "Mouth width", from: "mouthLeft", to: "mouthRight",
    ends: ["one corner of the mouth", "the other corner of the mouth"] },
  { id: "noseWidth", name: "Nose width", from: "nostrilLeft", to: "nostrilRight",
    ends: ["the widest point of one nostril wing", "the widest point of the other wing"] },
  { id: "eyeLength", name: "Eye length", from: "eyeInner", to: "eyeOuter",
    ends: ["the inner corner of one eye, where the lid edges meet", "the outer corner of the same eye"] },
  { id: "eyeOpening", name: "Eye opening height", from: "lidUpper", to: "lidLower",
    ends: ["the edge of the upper lid above the middle of the eye", "the edge of the lower lid below it"] },
  { id: "innerEyes", name: "Between the inner eye corners", from: "eyeInner", to: "eyeInnerRight",
    ends: ["the inner corner of one eye, where the lid edges meet", "the inner corner of the other eye"] },
  { id: "outerEyes", name: "Between the outer eye corners", from: "eyeOuter", to: "eyeOuterRight",
    ends: ["the outer corner of one eye", "the outer corner of the other eye"] },
  { id: "eyeSlant", name: "Outer eye corner above the inner", kind: "rise", from: "eyeInner", to: "eyeOuter",
    ends: ["the inner corner of one eye, where the lid edges meet", "the outer corner of the same eye"] },
  { id: "noseLength", name: "Nose length", kind: "height", from: "noseRoot", to: "noseBase",
    ends: ["the bridge of the nose between the eyes, level with the upper lids", "where the nose meets the upper lip"] },
  { id: "noseToMouth", name: "Nose to mouth line", kind: "height", from: "noseBase", to: "mouthLine",
    ends: ["where the nose meets the upper lip", "the line between the lips at the middle"] },
  { id: "upperLip", name: "Upper lip height", kind: "height", from: "lipTop", to: "mouthLine",
    ends: ["the top edge of the upper lip at the middle", "the line between the lips below it"] },
  { id: "lowerLip", name: "Lower lip height", kind: "height", from: "mouthLine", to: "lipBottom",
    ends: ["the line between the lips at the middle", "the bottom edge of the lower lip below it"] },
  { id: "mouthToChin", name: "Mouth line to chin", kind: "height", from: "mouthLine", to: "chinBase",
    ends: ["the line between the lips at the middle", "the underside of the chin at the middle"] },
];
const byId = new Map(proportions.map((p) => [p.id, p]));
export const proportionNamed = (id) => byId.get(id);
/* Whether the dialog hands a marked proportion to the fit. The heights down the middle
   of the face are read and listed only: a distance does not say which of its two ends
   is out of place, and the sliders that set these heights each move a neighbouring
   feature along. Widths and the eye's own proportions each have a slider made for them. */
export const proportionFitted = (id) => byId.get(id).kind !== "height";

// Shape controls that pose the face instead of building it: they never serve a proportion.
const poses = new Set(["lipParting", "smileLeft", "smileRight"]);

// A place of the smooth skin, in metres, from the cage it is smoothed from.
function placeOf(cage, name) {
  const { offsets, refs, factors } = humanSmoothSources(),
    point = [0, 0, 0],
    list = places[name];
  for (const v of list)
    for (let j = offsets[v]; j < offsets[v + 1]; j++)
      for (let d = 0; d < 3; d++) point[d] += (cage[refs[j] * 3 + d] * factors[j]) / list.length;
  return point;
}
// Millimetres between two points as this proportion reads them, seen from straight ahead.
export function proportionReading(id, a, b) {
  const kind = byId.get(id).kind,
    rise = b[1] - a[1],
    outward = Math.abs(b[0]) >= Math.abs(a[0]) ? 1 : -1;
  return (kind === "rise" ? outward * rise : kind === "height" ? Math.abs(rise) : Math.hypot(b[0] - a[0], rise)) * 1000;
}
const readAll = (cage) =>
  Object.fromEntries(
    proportions.map((p) => [p.id, proportionReading(p.id, placeOf(cage, p.from), placeOf(cage, p.to))]),
  );
const skinOf = (form) => evaluateHuman(form.human, form.humanFit, form.humanDetail);
// The places down the middle of the face, and how high each stands on a skin, in mm.
const midline = [...new Set(proportions.filter((p) => p.kind === "height").flatMap((p) => [p.from, p.to]))];
const heightsOf = (cage) => Object.fromEntries(midline.map((name) => [name, placeOf(cage, name)[1] * 1000]));

// Every named proportion of this recipe's skin, sculpt and fine layer included, in mm.
export function measureProportions(form) {
  return readAll(skinOf(form).positions);
}
// The two ends of one proportion on this recipe's skin, in its rest space.
export function proportionEnds(form, id, surface = skinOf(form)) {
  const p = byId.get(id);
  return [placeOf(surface.positions, p.from), placeOf(surface.positions, p.to)];
}

const step = 0.1,
  // Skin within this many metres of a measured stretch counts as that feature's own.
  around = 0.03;
// Metres from `x` to the stretch between `a` and `b`.
function apart(x, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    ax = [x[0] - a[0], x[1] - a[1], x[2] - a[2]],
    length = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2,
    along = length > 0 ? Math.min(1, Math.max(0, (ab[0] * ax[0] + ab[1] * ax[1] + ab[2] * ax[2]) / length)) : 0;
  return Math.hypot(ax[0] - along * ab[0], ax[1] - along * ab[1], ax[2] - along * ab[2]);
}
/* What the face controls do to this recipe: millimetres of every proportion per unit of
   a control, and how far it moves the outside of the head while doing so. Most controls
   act differently above and below their rest setting, so each has an effect upward and
   one downward. A face control is an ordinary shape control with a real share of its
   movement on the outside of the head; the controls of the build and of the limbs fall
   away. `near` is the share of a control's movement that lies on the feature a
   proportion measures, on either side of the face: close to 1 for a control made for
   that feature and small for one that reshapes the whole head. */
const tables = new WeakMap();
function movement(form) {
  if (tables.has(form.human)) return tables.get(form.human);
  const base = evaluateHuman(form.human),
    head = base.names.indexOf("head"),
    exterior = exteriorSkin(base),
    outside = [];
  for (let v = 0; v < base.bodyVertices; v++)
    if (base.boneIndices[v * 4] === head && exterior[v]) outside.push(v);
  // For every proportion, which vertices of the outside of the head lie on its feature.
  const own = Object.fromEntries(
    proportions.map((p) => {
      const a = placeOf(base.positions, p.from),
        b = placeOf(base.positions, p.to),
        mirrored = [[-a[0], a[1], a[2]], [-b[0], b[1], b[2]]];
      return [
        p.id,
        outside.map((v) => {
          const x = [base.positions[v * 3], base.positions[v * 3 + 1], base.positions[v * 3 + 2]];
          return apart(x, a, b) < around || apart(x, ...mirrored) < around;
        }),
      ];
    }),
  );
  const table = { base, outside, own, readings: readAll(base.positions), rows: new Map() };
  tables.set(form.human, table);
  return table;
}
function effect(form, key) {
  const table = movement(form);
  if (table.rows.has(key)) return table.rows.get(key);
  const { base, outside, own, readings } = table,
    [lo, hi, rest] = humanRange(key),
    now = form.human[key] ?? rest;
  // The effect of a small move one way, as rates per unit of the control.
  function toward(per) {
    if (now + per > hi + 1e-9 || now + per < lo - 1e-9) return null;
    const moved = evaluateHuman({ ...form.human, [key]: now + per }).positions,
      shift = new Float32Array(outside.length * 3);
    let onHead = 0,
      all = 0;
    for (let i = 0; i < base.bodyVertices * 3; i++) all += (moved[i] - base.positions[i]) ** 2;
    outside.forEach((v, k) => {
      for (let d = 0; d < 3; d++) {
        const x = ((moved[v * 3 + d] - base.positions[v * 3 + d]) / per) * 1000;
        shift[k * 3 + d] = x;
        onHead += x * x;
      }
    });
    if (!(onHead > 1e-9) || onHead * per * per * 1e-6 < 0.3 * all) return null;
    const after = readAll(moved),
      near = {};
    for (const p of proportions) {
      let on = 0;
      for (let k = 0; k < outside.length; k++)
        if (own[p.id][k]) on += shift[k * 3] ** 2 + shift[k * 3 + 1] ** 2 + shift[k * 3 + 2] ** 2;
      near[p.id] = on / onHead;
    }
    return {
      rates: Object.fromEntries(proportions.map((p) => [p.id, (after[p.id] - readings[p.id]) / per])),
      // Millimetres each place down the middle of the face rises per unit of the control.
      lift: Object.fromEntries(midline.map((name) => [name, (placeOf(moved, name)[1] - placeOf(base.positions, name)[1]) * 1000 / per])),
      near,
      // Millimetres each vertex of the outside of the head moves per unit of the control.
      shift,
      total: onHead,
      reachMm: Math.sqrt(onHead / outside.length),
    };
  }
  let row = null;
  if (!poses.has(key) && lo === -1) {
    const up = toward(step),
      down = toward(-step);
    if (up || down) row = { key, up: up ?? down, down: down ?? up };
  }
  table.rows.set(key, row);
  return row;
}
// Skin a proportion fit must leave alone: kept eye openings and parts hidden on the reference.
function keptSkin(form, { hold = null, keepEyeOpenings = false }) {
  if (!hold && !keepEyeOpenings) return null;
  const surface = skinOf(form),
    eyes = keepEyeOpenings ? eyeOpenings(surface) : null,
    p = new Vector3();
  return movement(form).outside.map((v) =>
    eyes?.skin[v] ? 2 : hold?.(p.fromArray(surface.positions, v * 3)) ? 1 : 0,
  );
}
/* The face controls a proportion fit may use on this recipe, each with its effect on
   every proportion in mm per unit and the root mean square movement of the outside of
   the head. `free` is false for a control whose movement lies mostly on skin that is
   kept, and `why` then says which. */
export function proportionControls(form, options = {}) {
  const guard = keptSkin(form, options);
  return humanFitAxes.flatMap((key) => {
    const row = effect(form, key);
    if (!row) return [];
    let onKept = 0,
      onEyes = 0,
      total = 0;
    for (const { shift } of [row.up, row.down])
      for (let k = 0; k < shift.length / 3; k++) {
        const e = shift[k * 3] ** 2 + shift[k * 3 + 1] ** 2 + shift[k * 3 + 2] ** 2;
        total += e;
        if (!guard?.[k]) continue;
        onKept += e;
        if (guard[k] === 2) onEyes += e;
      }
    const free = !(onKept > 0.5 * total);
    return [
      {
        key,
        // Upward and downward from where the control stands.
        rates: row.up.rates,
        ratesDown: row.down.rates,
        near: row.up.near,
        nearDown: row.down.near,
        reachMm: row.up.reachMm,
        reachDownMm: row.down.reachMm,
        free,
        ...(free ? {} : { why: onEyes > 0.5 * onKept ? "eye openings kept" : "hidden on the reference" }),
      },
    ];
  });
}
/* The controls suggested for the chosen proportions. A control belongs to a proportion
   when it changes the reading by moving mostly the measured feature: at least `own` mm
   of reading for each mm its skin moves, counting the skin on that feature only. That
   keeps the controls that reshape the whole head away from a feature. Of those that
   belong, the ones at least three tenths as strong as the strongest are suggested.
   `able` on the result lists every free control that can change one of the proportions
   by a millimetre over its range, the suggested ones included, for an artist who does
   want another control. */
const own = 0.5;
export function suggestControls(form, ids, options = {}) {
  const controls = proportionControls(form, options).filter((c) => c.free),
    chosen = new Set(),
    able = new Set();
  for (const id of ids) {
    const strength = controls.map((c) =>
        Math.max(
          (Math.abs(c.rates[id]) / c.reachMm) * c.near[id] >= own ? Math.abs(c.rates[id]) : 0,
          (Math.abs(c.ratesDown[id]) / c.reachDownMm) * c.nearDown[id] >= own ? Math.abs(c.ratesDown[id]) : 0,
        ),
      ),
      best = Math.max(0, ...strength);
    controls.forEach((c, i) => {
      if (Math.max(Math.abs(c.rates[id]), Math.abs(c.ratesDown[id])) >= 0.5) able.add(c.key);
      if (strength[i] >= 0.5 && strength[i] >= 0.3 * best) chosen.add(c.key);
    });
  }
  return Object.assign(
    controls.filter((c) => chosen.has(c.key)).map((c) => c.key),
    { able: controls.filter((c) => able.has(c.key) || chosen.has(c.key)).map((c) => c.key) },
  );
}

/* The x between 0 and `most` that makes x·a·x / 2 − b·x smallest, for a symmetric `a`
   that is never negative along any direction. One unknown at a time, round and round. */
function boxed(a, b, most) {
  const n = b.length,
    x = new Array(n).fill(0);
  for (let sweep = 0; sweep < 20000; sweep++) {
    let change = 0;
    for (let i = 0; i < n; i++) {
      if (!(most[i] > 0) || !(a[i][i] > 0)) continue;
      let rest = b[i];
      for (let j = 0; j < n; j++) if (j !== i) rest -= a[i][j] * x[j];
      const to = Math.min(most[i], Math.max(0, rest / a[i][i]));
      change = Math.max(change, Math.abs(to - x[i]));
      x[i] = to;
    }
    if (change < 1e-7) break;
  }
  return x;
}

/* A reading marked by hand is good to about half a millimetre, so a fit does not strain
   for less: `calm` is what a millimetre of change in a proportion nobody marked costs
   beside a millimetre missed on one that was, and `care` what a millimetre of skin moved
   costs, as the root mean square over the outside of the head. Both are small enough
   that a control made for a proportion reaches its reading, and large enough that
   controls are not driven to their limits against each other for a last tenth. */
const calm = 0.01,
  care = 0.1;

/* Brings the chosen proportions of `form` to the millimetres in `targets`, an object of
   proportion id to reading, by moving ordinary face controls only. `controls` names the
   controls to use; without it the best ones for these proportions are taken. Reaching
   the readings comes first, then leaving the other named proportions as they are, then
   moving little skin. Every control stays within its range, controls that were not
   chosen stay as they are, and a sculpt or fine layer on the recipe is carried along.
   `hold` and `keepEyeOpenings` mean what they mean for a reference fit: controls that
   move mostly that skin stay as they are.

   A height down the middle of the face can be met by moving either of its ends, and a
   distance does not say which one is out of place. `ends` settles that where the
   reference is aligned with the head: an object of proportion id to the two marked
   points in the head's rest space. For a height named there, each end is brought to the
   height of its mark, so an end that already stands where the reference has it stays,
   and the reading follows from the two ends. */
export function fitProportions(form, targets, { controls = null, hold = null, keepEyeOpenings = false, ends = null } = {}) {
  const ids = Object.keys(targets);
  if (!form?.human) throw new Error("Open an adult human before matching proportions.");
  if (!ids.length) throw new Error("Mark at least one proportion on the reference first.");
  for (const id of ids)
    if (!byId.has(id) || !Number.isFinite(targets[id])) throw new Error("Unknown proportion or reading: " + id + ".");
  const options = { hold, keepEyeOpenings },
    offered = proportionControls(form, options),
    keys = [...new Set(controls ?? suggestControls(form, ids, options))].filter((key) =>
      offered.some((c) => c.key === key && c.free),
    ),
    others = proportions.map((p) => p.id).filter((id) => !ids.includes(id)),
    // Heights fitted by where their ends stand, and the readings fitted as distances.
    placed = ids.filter((id) => byId.get(id).kind === "height" && ends?.[id]?.length === 2),
    read = ids.filter((id) => !placed.includes(id)),
    wantedAt = {},
    marksAt = {},
    before = measureProportions(form),
    start = Object.fromEntries(keys.map((key) => [key, form.human[key] ?? 0])),
    n = keys.length,
    { base: first, outside } = movement(form);
  for (const id of placed) {
    // The upper mark belongs to the upper end.
    const [upper, lower] = [...ends[id]].sort((a, b) => b[1] - a[1]);
    for (const [name, point] of [[byId.get(id).from, upper], [byId.get(id).to, lower]]) (marksAt[name] ??= []).push(point[1] * 1000);
  }
  const spots = Object.keys(marksAt);
  for (const name of spots) wantedAt[name] = marksAt[name].reduce((sum, y) => sum + y, 0) / marksAt[name].length;
  const standing = (candidate) => heightsOf(skinOf(candidate).positions),
    stood = standing(form);
  // How far the outside of the head has moved from where this fit began, in mm.
  const moved = (candidate) => {
    const now = movement(candidate).base.positions,
      shift = new Float32Array(outside.length * 3);
    outside.forEach((v, k) => {
      for (let d = 0; d < 3; d++) shift[k * 3 + d] = (now[v * 3 + d] - first.positions[v * 3 + d]) * 1000;
    });
    return shift;
  };
  const price = (reading, shift, high) =>
    read.reduce((sum, id) => sum + (targets[id] - reading[id]) ** 2, 0) +
    spots.reduce((sum, name) => sum + (wantedAt[name] - high[name]) ** 2, 0) +
    calm * others.reduce((sum, id) => sum + (reading[id] - before[id]) ** 2, 0) +
    (care * shift.reduce((sum, x) => sum + x * x, 0)) / outside.length;
  let next = form,
    values = { ...start },
    after = before,
    high = stood,
    gone = moved(form),
    paid = price(after, gone, high);
  for (let turn = 0; n && turn < 6; turn++) {
    // The effect of the controls where the recipe now stands. A sculpt rides along unchanged.
    const rows = keys.map((key) => effect(next, key));
    if (rows.some((row) => !row)) break;
    /* Each control is two unknowns that only grow: how far it goes up and how far down,
       because the two ways act differently. */
    const sides = rows.flatMap((row) => [
        { rates: row.up.rates, lift: row.up.lift, shift: row.up.shift, sign: 1 },
        { rates: row.down.rates, lift: row.down.lift, shift: row.down.shift, sign: -1 },
      ]),
      m = sides.length,
      most = sides.map(({ sign }, j) => {
        const [lo, hi] = humanRange(keys[j >> 1]);
        return sign > 0 ? hi - values[keys[j >> 1]] : values[keys[j >> 1]] - lo;
      }),
      rate = [
        ...read.map((id) => sides.map((s) => s.sign * s.rates[id])),
        ...spots.map((name) => sides.map((s) => s.sign * s.lift[name])),
      ],
      miss = [...read.map((id) => targets[id] - after[id]), ...spots.map((name) => wantedAt[name] - high[name])],
      drift = others.map((id) => sides.map((s) => s.sign * s.rates[id])),
      skin = care / outside.length,
      cost = sides.map(() => new Array(m).fill(0)),
      aim = new Array(m).fill(0);
    for (let a = 0; a < m; a++) {
      const sa = sides[a].shift;
      for (let b = a; b < m; b++) {
        let sum = 0;
        const sb = sides[b].shift;
        for (let i = 0; i < sa.length; i++) sum += sa[i] * sb[i];
        cost[a][b] = cost[b][a] =
          rate.reduce((s, row) => s + row[a] * row[b], 0) +
          calm * drift.reduce((s, row) => s + row[a] * row[b], 0) +
          skin * sum * sides[a].sign * sides[b].sign;
      }
      let along = 0;
      for (let i = 0; i < sa.length; i++) along += sa[i] * gone[i];
      aim[a] =
        rate.reduce((s, row, d) => s + row[a] * miss[d], 0) -
        calm * drift.reduce((s, row, d) => s + row[a] * (after[others[d]] - before[others[d]]), 0) -
        skin * along * sides[a].sign;
    }
    let x = boxed(cost, aim, most);
    // A control goes one way only: where both were asked for, the lesser way is closed.
    for (let again = 0; again < n; again++) {
      const both = keys.map((_, i) => i).filter((i) => x[2 * i] > 1e-6 && x[2 * i + 1] > 1e-6);
      if (!both.length) break;
      for (const i of both) most[x[2 * i] >= x[2 * i + 1] ? 2 * i + 1 : 2 * i] = 0;
      x = boxed(cost, aim, most);
    }
    const tried = { ...values };
    keys.forEach((key, i) => (tried[key] = +(values[key] + x[2 * i] - x[2 * i + 1]).toFixed(2)));
    if (keys.every((key) => tried[key] === values[key])) break;
    const patch = Object.fromEntries(keys.filter((key) => tried[key] !== start[key]).map((key) => [key, tried[key]])),
      candidate = Object.keys(patch).length ? changeHuman(form, patch) : form,
      reading = measureProportions(candidate),
      shift = moved(candidate),
      height = standing(candidate),
      asked = price(reading, shift, height);
    if (!(asked < paid - 1e-9)) break;
    [next, values, after, gone, paid, high] = [candidate, tried, reading, shift, asked, height];
  }
  const changed = keys.filter((key) => values[key] !== start[key]);
  return {
    form: next,
    changed: changed.length > 0,
    proportions: ids.map((id) => ({
      id,
      name: byId.get(id).name,
      referenceMm: targets[id],
      beforeMm: before[id],
      afterMm: after[id],
    })),
    controls: changed.map((key) => {
      const [lo, hi] = humanRange(key);
      return { key, from: start[key], to: values[key], atLimit: values[key] <= lo || values[key] >= hi };
    }),
    // Chosen controls this fit had to leave alone, with the reason.
    kept: (controls ?? []).flatMap((key) => {
      const c = offered.find((o) => o.key === key);
      return c && !c.free ? [{ key, why: c.why }] : [];
    }),
    // Where each marked end of a placed height stood and stands, against its mark, in mm of height.
    ends: spots.map((name) => ({ place: name, referenceMm: wantedAt[name], beforeMm: stood[name], afterMm: high[name] })),
    // Every other named proportion, so that nothing changes unseen.
    others: others.map((id) => ({ id, name: byId.get(id).name, beforeMm: before[id], afterMm: after[id] })),
    // Root mean square movement of the outside of the head, in mm.
    skinMovedMm: Math.sqrt(gone.reduce((sum, x) => sum + x * x, 0) / outside.length),
  };
}

const one = (x) => x.toFixed(1);
/* One line for the dialog's list of steps: what was measured, which controls moved and
   which other named proportions changed with them by 0.3 mm or more. `names` gives the
   artist's name of a control. */
export function proportionText({ proportions: rows, controls, others = [] }, names = {}) {
  const also = others.filter((o) => Math.abs(o.afterMm - o.beforeMm) >= 0.3);
  return (
    "Proportions · " +
    rows
      .map((r) => r.name + " " + one(r.beforeMm) + " → " + one(r.afterMm) + " mm (reference " + one(r.referenceMm) + ")")
      .join(", ") +
    " · controls: " +
    (controls.length
      ? controls
          .map(
            (c) =>
              (names[c.key] ?? c.key) + " " + c.from.toFixed(2) + " → " + c.to.toFixed(2) + (c.atLimit ? " at its limit" : ""),
          )
          .join(", ")
      : "none changed") +
    (also.length
      ? " · also changed: " +
        also
          .map((o) => o.name + " " + (o.afterMm < o.beforeMm ? "−" : "+") + one(Math.abs(o.afterMm - o.beforeMm)) + " mm")
          .join(", ")
      : "")
  );
}
