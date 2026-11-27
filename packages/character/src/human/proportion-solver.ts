import { required } from "./required.js";
import { Vector3 } from "three";
import { boneNames } from "./catalogue.js";
import type { HumanBody } from "./body.js";
import { humanRange, evaluateHuman, type HumanAxis, type HumanMeasurements } from "./surface.js";
import { fittingSkin, type FittedAdult } from "./fit-surface.js";
import { proportionPlaces as places, proportions } from "./proportion-places.js";
import { eyeOpenings, exteriorSkin, fitControls } from "./fit-topology.js";
import { familyFitAxes as humanFitAxes } from "./family-measurements.js";
type Options = { hold?: ((point: Vector3) => boolean) | undefined; keepEyeOpenings?: boolean };
type Effect = {
  rates: Record<string, number>;
  near: Record<string, number>;
  lift: Record<string, number>;
  shift: Float32Array;
  total: number;
  reachMm: number;
};
function createSolver(body: HumanBody) {
  const byId = new Map(proportions.map((p) => [p.id, p]));

  const poses = new Set(["lipParting", "smileLeft", "smileRight"]);

  function placeOf(cage: Float32Array, name: string) {
    const offsets = body.arrays.u32("subOffsets"),
      refs = body.arrays.u16("subRefs"),
      factors = body.arrays.f32("subFactors"),
      point = [0, 0, 0],
      list = required(places[name]);
    for (const v of list)
      for (let j = offsets[v] ?? 0; j < (offsets[v + 1] ?? 0); j++)
        for (let d = 0; d < 3; d++)
          point[d] =
            (point[d] ?? 0) +
            ((cage[(refs[j] ?? 0) * 3 + d] ?? 0) * (factors[j] ?? 0)) / list.length;
    return point;
  }
  function proportionReading(id: string, a: number[], b: number[]) {
    const kind = required(byId.get(id)).kind,
      rise = (b[1] ?? 0) - (a[1] ?? 0),
      outward = Math.abs(b[0] ?? 0) >= Math.abs(a[0] ?? 0) ? 1 : -1;
    return (
      (kind === "rise"
        ? outward * rise
        : kind === "height"
          ? Math.abs(rise)
          : Math.hypot((b[0] ?? 0) - (a[0] ?? 0), rise)) * 1000
    );
  }
  const readAll = (cage: Float32Array) =>
    Object.fromEntries(
      proportions.map((p) => [
        p.id,
        proportionReading(p.id, placeOf(cage, p.from), placeOf(cage, p.to)),
      ]),
    );
  const skinOf = (form: FittedAdult) => fittingSkin(body, form);
  const midline = [
    ...new Set(proportions.filter((p) => p.kind === "height").flatMap((p) => [p.from, p.to])),
  ];

  function measureProportions(form: FittedAdult) {
    return readAll(skinOf(form).positions);
  }

  const step = 0.1,
    around = 0.03;
  function apart(x: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>) {
    const ab = [(b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0), (b[2] ?? 0) - (a[2] ?? 0)],
      ax = [(x[0] ?? 0) - (a[0] ?? 0), (x[1] ?? 0) - (a[1] ?? 0), (x[2] ?? 0) - (a[2] ?? 0)],
      length = (ab[0] ?? 0) ** 2 + (ab[1] ?? 0) ** 2 + (ab[2] ?? 0) ** 2,
      along =
        length > 0
          ? Math.min(
              1,
              Math.max(
                0,
                ((ab[0] ?? 0) * (ax[0] ?? 0) +
                  (ab[1] ?? 0) * (ax[1] ?? 0) +
                  (ab[2] ?? 0) * (ax[2] ?? 0)) /
                  length,
              ),
            )
          : 0;
    return Math.hypot(
      (ax[0] ?? 0) - along * (ab[0] ?? 0),
      (ax[1] ?? 0) - along * (ab[1] ?? 0),
      (ax[2] ?? 0) - along * (ab[2] ?? 0),
    );
  }
  const tables = new WeakMap<HumanMeasurements, ReturnType<typeof makeTable>>();
  function makeTable(form: FittedAdult) {
    const base = evaluateHuman(body, form.human),
      head = boneNames.indexOf("head"),
      exterior = exteriorSkin(base, fitControls(body)),
      outside: number[] = [];
    for (let v = 0; v < base.bodyVertices; v++)
      if ((base.boneIndices[v * 4] ?? 0) === head && (exterior[v] ?? 0)) outside.push(v);
    const own = Object.fromEntries(
      proportions.map((p) => {
        const a = placeOf(base.positions, p.from),
          b = placeOf(base.positions, p.to),
          mirrored = [
            [-(a[0] ?? 0), a[1] ?? 0, a[2] ?? 0],
            [-(b[0] ?? 0), b[1] ?? 0, b[2] ?? 0],
          ];
        return [
          p.id,
          outside.map((v) => {
            const x = [
              base.positions[v * 3] ?? 0,
              base.positions[v * 3 + 1] ?? 0,
              base.positions[v * 3 + 2] ?? 0,
            ];
            return (
              apart(x, a, b) < around ||
              apart(x, required(required(mirrored[0])), required(required(mirrored[1]))) < around
            );
          }),
        ];
      }),
    );
    const table = {
      base,
      outside,
      own,
      readings: readAll(base.positions),
      rows: new Map<HumanAxis, { key: HumanAxis; up: Effect; down: Effect } | null>(),
    };
    return table;
  }
  function movement(form: FittedAdult) {
    let table = tables.get(form.human);
    if (!table) {
      table = makeTable(form);
      tables.set(form.human, table);
    }
    return table;
  }
  function effect(form: FittedAdult, key: HumanAxis) {
    const table = movement(form);
    if (table.rows.has(key)) return table.rows.get(key);
    const { base, outside, own, readings } = table,
      [lo, hi, rest] = humanRange(key),
      now = form.human[key] ?? rest;
    function toward(per: number): Effect | null {
      if (now + per > hi + 1e-9 || now + per < lo - 1e-9) return null;
      const moved = evaluateHuman(body, { ...form.human, [key]: now + per }).positions,
        shift = new Float32Array(outside.length * 3);
      let onHead = 0,
        all = 0;
      for (let i = 0; i < base.bodyVertices * 3; i++)
        all += ((moved[i] ?? 0) - (base.positions[i] ?? 0)) ** 2;
      outside.forEach((v, k) => {
        for (let d = 0; d < 3; d++) {
          const x = (((moved[v * 3 + d] ?? 0) - (base.positions[v * 3 + d] ?? 0)) / per) * 1000;
          shift[k * 3 + d] = x;
          onHead += x * x;
        }
      });
      if (!(onHead > 1e-9) || onHead * per * per * 1e-6 < 0.3 * all) return null;
      const after = readAll(moved),
        near: Record<string, number> = {};
      for (const p of proportions) {
        let on = 0;
        for (let k = 0; k < outside.length; k++)
          if (required(required(own[p.id])[k]))
            on +=
              (shift[k * 3] ?? 0) ** 2 +
              (shift[k * 3 + 1] ?? 0) ** 2 +
              (shift[k * 3 + 2] ?? 0) ** 2;
        near[p.id] = on / onHead;
      }
      return {
        rates: Object.fromEntries(
          proportions.map((p) => [p.id, ((after[p.id] ?? 0) - (readings[p.id] ?? 0)) / per]),
        ),
        lift: Object.fromEntries(
          midline.map((name) => [
            name,
            (((placeOf(moved, name)[1] ?? 0) - (placeOf(base.positions, name)[1] ?? 0)) * 1000) /
              per,
          ]),
        ),
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
      if (up || down) row = { key, up: required(up ?? down), down: required(down ?? up) };
    }
    table.rows.set(key, row);
    return row;
  }
  function keptSkin(form: FittedAdult, { hold, keepEyeOpenings = false }: Options) {
    if (!hold && !keepEyeOpenings) return null;
    const surface = skinOf(form),
      eyes = keepEyeOpenings ? eyeOpenings(surface, fitControls(body)) : null,
      p = new Vector3();
    return movement(form).outside.map((v) =>
      (eyes?.skin[v] ?? 0) ? 2 : hold?.(p.fromArray(surface.positions, v * 3)) ? 1 : 0,
    );
  }
  function proportionControls(form: FittedAdult, options: Options = {}) {
    const guard = keptSkin(form, options);
    return humanFitAxes.flatMap((key) => {
      const row = effect(form, key);
      if (!row) return [];
      let onKept = 0,
        onEyes = 0,
        total = 0;
      for (const { shift } of [row.up, row.down])
        for (let k = 0; k < shift.length / 3; k++) {
          const e =
            (shift[k * 3] ?? 0) ** 2 + (shift[k * 3 + 1] ?? 0) ** 2 + (shift[k * 3 + 2] ?? 0) ** 2;
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
          ...(free
            ? {}
            : { why: onEyes > 0.5 * onKept ? "eye openings kept" : "hidden on the reference" }),
        },
      ];
    });
  }
  const own = 0.5;
  function suggestControls(form: FittedAdult, ids: readonly string[], options: Options = {}) {
    const controls = proportionControls(form, options).filter((c) => c.free),
      chosen = new Set(),
      able = new Set();
    for (const id of ids) {
      const strength = controls.map((c) =>
          Math.max(
            (Math.abs(c.rates[id] ?? 0) / c.reachMm) * (c.near[id] ?? 0) >= own
              ? Math.abs(c.rates[id] ?? 0)
              : 0,
            (Math.abs(c.ratesDown[id] ?? 0) / c.reachDownMm) * (c.nearDown[id] ?? 0) >= own
              ? Math.abs(c.ratesDown[id] ?? 0)
              : 0,
          ),
        ),
        best = Math.max(0, ...strength);
      controls.forEach((c, i) => {
        if (Math.max(Math.abs(c.rates[id] ?? 0), Math.abs(c.ratesDown[id] ?? 0)) >= 0.5)
          able.add(c.key);
        if ((strength[i] ?? 0) >= 0.5 && (strength[i] ?? 0) >= 0.3 * best) chosen.add(c.key);
      });
    }
    return Object.assign(
      controls.filter((c) => chosen.has(c.key)).map((c) => c.key),
      { able: controls.filter((c) => able.has(c.key) || chosen.has(c.key)).map((c) => c.key) },
    );
  }

  function boxed(a: number[][], b: number[], most: number[]) {
    const n = b.length,
      x = Array.from({ length: n }, () => 0);
    for (let sweep = 0; sweep < 20000; sweep++) {
      let change = 0;
      for (let i = 0; i < n; i++) {
        if (!((most[i] ?? 0) > 0) || !((required(a[i])[i] ?? 0) > 0)) continue;
        let rest = b[i] ?? 0;
        for (let j = 0; j < n; j++) if (j !== i) rest -= (required(a[i])[j] ?? 0) * (x[j] ?? 0);
        const to = Math.min(most[i] ?? 0, Math.max(0, rest / (required(a[i])[i] ?? 0)));
        change = Math.max(change, Math.abs(to - (x[i] ?? 0)));
        x[i] = to;
      }
      if (change < 1e-7) break;
    }
    return x;
  }

  const calm = 0.01,
    care = 0.1;

  function fitProportions(
    form: FittedAdult,
    targets: Record<string, number>,
    { controls, hold, keepEyeOpenings = false }: Options & { controls?: readonly HumanAxis[] } = {},
  ) {
    const ids = Object.keys(targets);
    if (!form?.human) throw new Error("Open an adult human before matching proportions.");
    if (!ids.length) throw new Error("Mark at least one proportion on the reference first.");
    for (const id of ids)
      if (!byId.has(id) || !Number.isFinite(targets[id] ?? 0))
        throw new Error("Unknown proportion or reading: " + id + ".");
    const options = { hold, keepEyeOpenings },
      offered = proportionControls(form, options),
      keys = [...new Set(controls ?? suggestControls(form, ids, options))].filter((key) =>
        offered.some((c) => c.key === key && c.free),
      ),
      others = proportions.map((p) => p.id).filter((id) => !ids.includes(id)),
      before = measureProportions(form),
      start = Object.fromEntries(keys.map((key) => [key, form.human[key] ?? 0])),
      n = keys.length,
      { base: first, outside } = movement(form);

    const moved = (candidate: FittedAdult) => {
      const now = movement(candidate).base.positions,
        shift = new Float32Array(outside.length * 3);
      outside.forEach((v, k) => {
        for (let d = 0; d < 3; d++)
          shift[k * 3 + d] = ((now[v * 3 + d] ?? 0) - (first.positions[v * 3 + d] ?? 0)) * 1000;
      });
      return shift;
    };
    const price = (reading: Record<string, number>, shift: Float32Array) =>
      ids.reduce((sum, id) => sum + ((targets[id] ?? 0) - (reading[id] ?? 0)) ** 2, 0) +
      calm * others.reduce((sum, id) => sum + ((reading[id] ?? 0) - (before[id] ?? 0)) ** 2, 0) +
      (care * shift.reduce((sum, x) => sum + x * x, 0)) / outside.length;
    let next = form,
      values = { ...start },
      after = before,
      gone = moved(form),
      paid = price(after, gone);
    for (let turn = 0; n && turn < 6; turn++) {
      const rows = keys.map((key) => effect(next, key)).filter((row) => row != null);
      if (rows.length !== keys.length) break;
      const sides = rows.flatMap((row) => [
          { rates: row.up.rates, lift: row.up.lift, shift: row.up.shift, sign: 1 },
          { rates: row.down.rates, lift: row.down.lift, shift: row.down.shift, sign: -1 },
        ]),
        m = sides.length,
        most = sides.map(({ sign }, j) => {
          const [lo, hi] = humanRange(required(keys[j >> 1]));
          return sign > 0
            ? hi - (values[required(keys[j >> 1])] ?? 0)
            : (values[required(keys[j >> 1])] ?? 0) - lo;
        }),
        rate = ids.map((id) => sides.map((s) => s.sign * (s.rates[id] ?? 0))),
        miss = ids.map((id) => (targets[id] ?? 0) - (after[id] ?? 0)),
        drift = others.map((id) => sides.map((s) => s.sign * (s.rates[id] ?? 0))),
        skin = care / outside.length,
        cost = sides.map(() => Array.from({ length: m }, () => 0)),
        aim = Array.from({ length: m }, () => 0);
      for (let a = 0; a < m; a++) {
        const sa = required(sides[a]).shift;
        for (let b = a; b < m; b++) {
          let sum = 0;
          const sb = required(sides[b]).shift;
          for (let i = 0; i < sa.length; i++) sum += (sa[i] ?? 0) * (sb[i] ?? 0);
          required(cost[a])[b] = required(cost[b])[a] =
            rate.reduce((s, row) => s + (row[a] ?? 0) * (row[b] ?? 0), 0) +
            calm * drift.reduce((s, row) => s + (row[a] ?? 0) * (row[b] ?? 0), 0) +
            skin * sum * required(sides[a]).sign * required(sides[b]).sign;
        }
        let along = 0;
        for (let i = 0; i < sa.length; i++) along += (sa[i] ?? 0) * (gone[i] ?? 0);
        aim[a] =
          rate.reduce((s, row, d) => s + (row[a] ?? 0) * (miss[d] ?? 0), 0) -
          calm *
            drift.reduce(
              (s, row, d) =>
                s +
                (row[a] ?? 0) *
                  ((after[required(others[d])] ?? 0) - (before[required(others[d])] ?? 0)),
              0,
            ) -
          skin * along * required(sides[a]).sign;
      }
      let x = boxed(cost, aim, most);
      for (let again = 0; again < n; again++) {
        const both = keys
          .map((_, i) => i)
          .filter((i) => (x[2 * i] ?? 0) > 1e-6 && (x[2 * i + 1] ?? 0) > 1e-6);
        if (!both.length) break;
        for (const i of both) most[(x[2 * i] ?? 0) >= (x[2 * i + 1] ?? 0) ? 2 * i + 1 : 2 * i] = 0;
        x = boxed(cost, aim, most);
      }
      const tried = { ...values };
      keys.forEach(
        (key, i) =>
          (tried[key] = +((values[key] ?? 0) + (x[2 * i] ?? 0) - (x[2 * i + 1] ?? 0)).toFixed(2)),
      );
      if (keys.every((key) => (tried[key] ?? 0) === (values[key] ?? 0))) break;
      const patch = Object.fromEntries(
          keys
            .filter((key) => (tried[key] ?? 0) !== (start[key] ?? 0))
            .map((key) => [key, tried[key] ?? 0]),
        ),
        candidate = Object.keys(patch).length
          ? { ...form, human: { ...form.human, ...patch } }
          : form,
        reading = measureProportions(candidate),
        shift = moved(candidate),
        asked = price(reading, shift);
      if (!(asked < paid - 1e-9)) break;
      [next, values, after, gone, paid] = [candidate, tried, reading, shift, asked];
    }
    const changed = keys.filter((key) => (values[key] ?? 0) !== (start[key] ?? 0));
    return {
      form: next,
      changed: changed.length > 0,
      proportions: ids.map((id) => ({
        id,
        name: required(byId.get(id)).name,
        referenceMm: targets[id] ?? 0,
        beforeMm: before[id] ?? 0,
        afterMm: after[id] ?? 0,
      })),
      controls: changed.map((key) => {
        const [lo, hi] = humanRange(key);
        return {
          key,
          from: start[key] ?? 0,
          to: values[key] ?? 0,
          atLimit: (values[key] ?? 0) <= lo || (values[key] ?? 0) >= hi,
        };
      }),
      kept: (controls ?? []).flatMap((key) => {
        const c = offered.find((o) => o.key === key);
        return c && !c.free ? [{ key, why: c.why }] : [];
      }),
      others: others.map((id) => ({
        id,
        name: required(byId.get(id)).name,
        beforeMm: before[id] ?? 0,
        afterMm: after[id] ?? 0,
      })),
      skinMovedMm: Math.sqrt(gone.reduce((sum, x) => sum + x * x, 0) / outside.length),
    };
  }

  return { fitProportions, suggestControls, proportionControls };
}
const solvers = new WeakMap<HumanBody, ReturnType<typeof createSolver>>();
export function proportionSolver(body: HumanBody) {
  let solver = solvers.get(body);
  if (!solver) {
    solver = createSolver(body);
    solvers.set(body, solver);
  }
  return solver;
}
