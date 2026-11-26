import { Vector3 } from "three";
import { evaluateHuman, humanFitAxes, humanRange, humanSmoothSources } from "./human-surface.js";
import { changeHuman } from "./human-form.js";
import { exteriorSkin } from "./human-fit-exterior.js";
import { eyeOpenings } from "./human-fit-eyes.js";

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
export const proportionFitted = (id) => byId.get(id).kind !== "height";

const poses = new Set(["lipParting", "smileLeft", "smileRight"]);

function placeOf(cage, name) {
  const { offsets, refs, factors } = humanSmoothSources(),
    point = [0, 0, 0],
    list = places[name];
  for (const v of list)
    for (let j = offsets[v]; j < offsets[v + 1]; j++)
      for (let d = 0; d < 3; d++) point[d] += (cage[refs[j] * 3 + d] * factors[j]) / list.length;
  return point;
}
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
const midline = [...new Set(proportions.filter((p) => p.kind === "height").flatMap((p) => [p.from, p.to]))];
const heightsOf = (cage) => Object.fromEntries(midline.map((name) => [name, placeOf(cage, name)[1] * 1000]));

export function measureProportions(form) {
  return readAll(skinOf(form).positions);
}
export function proportionEnds(form, id, surface = skinOf(form)) {
  const p = byId.get(id);
  return [placeOf(surface.positions, p.from), placeOf(surface.positions, p.to)];
}

const step = 0.1,
  around = 0.03;
function apart(x, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    ax = [x[0] - a[0], x[1] - a[1], x[2] - a[2]],
    length = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2,
    along = length > 0 ? Math.min(1, Math.max(0, (ab[0] * ax[0] + ab[1] * ax[1] + ab[2] * ax[2]) / length)) : 0;
  return Math.hypot(ax[0] - along * ab[0], ax[1] - along * ab[1], ax[2] - along * ab[2]);
}
const tables = new WeakMap();
function movement(form) {
  if (tables.has(form.human)) return tables.get(form.human);
  const base = evaluateHuman(form.human),
    head = base.names.indexOf("head"),
    exterior = exteriorSkin(base),
    outside = [];
  for (let v = 0; v < base.bodyVertices; v++)
    if (base.boneIndices[v * 4] === head && exterior[v]) outside.push(v);
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
      lift: Object.fromEntries(midline.map((name) => [name, (placeOf(moved, name)[1] - placeOf(base.positions, name)[1]) * 1000 / per])),
      near,
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
function keptSkin(form, { hold = null, keepEyeOpenings = false }) {
  if (!hold && !keepEyeOpenings) return null;
  const surface = skinOf(form),
    eyes = keepEyeOpenings ? eyeOpenings(surface) : null,
    p = new Vector3();
  return movement(form).outside.map((v) =>
    eyes?.skin[v] ? 2 : hold?.(p.fromArray(surface.positions, v * 3)) ? 1 : 0,
  );
}
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

const calm = 0.01,
  care = 0.1;

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
    placed = ids.filter((id) => byId.get(id).kind === "height" && ends?.[id]?.length === 2),
    read = ids.filter((id) => !placed.includes(id)),
    wantedAt = {},
    marksAt = {},
    before = measureProportions(form),
    start = Object.fromEntries(keys.map((key) => [key, form.human[key] ?? 0])),
    n = keys.length,
    { base: first, outside } = movement(form);
  for (const id of placed) {
    const [upper, lower] = [...ends[id]].sort((a, b) => b[1] - a[1]);
    for (const [name, point] of [[byId.get(id).from, upper], [byId.get(id).to, lower]]) (marksAt[name] ??= []).push(point[1] * 1000);
  }
  const spots = Object.keys(marksAt);
  for (const name of spots) wantedAt[name] = marksAt[name].reduce((sum, y) => sum + y, 0) / marksAt[name].length;
  const standing = (candidate) => heightsOf(skinOf(candidate).positions),
    stood = standing(form);
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
    const rows = keys.map((key) => effect(next, key));
    if (rows.some((row) => !row)) break;
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
    kept: (controls ?? []).flatMap((key) => {
      const c = offered.find((o) => o.key === key);
      return c && !c.free ? [{ key, why: c.why }] : [];
    }),
    ends: spots.map((name) => ({ place: name, referenceMm: wantedAt[name], beforeMm: stood[name], afterMm: high[name] })),
    others: others.map((id) => ({ id, name: byId.get(id).name, beforeMm: before[id], afterMm: after[id] })),
    skinMovedMm: Math.sqrt(gone.reduce((sum, x) => sum + x * x, 0) / outside.length),
  };
}

const one = (x) => x.toFixed(1);
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
