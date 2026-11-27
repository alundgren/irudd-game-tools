import { armourDraws as draws } from "./armour-set.js";
import {
  Piece,
  Shell,
  add,
  at,
  clamp,
  cut,
  dot,
  loops,
  mix,
  relax,
  smooth,
  sub,
  subdivide,
  unit,
  type DressBody,
  type Landmarks,
  type Skin,
  type Vec,
} from "./kit.js";
import { figure, finish, part, type Surface } from "./guards.js";
import { clear, edging, field, rolledRims, setSkin, solid } from "./plate-shell.js";
import { Tube, plate } from "./plate.js";
import { fairChest } from "./fair-chest.js";
import { garment } from "./cloth.js";
import { pod } from "./gear.js";
import { mailStandard } from "./mail-standard.js";
import type { TailoredPart } from "./armour-types.js";
import type { TailorLayer } from "./tailor-data.js";
const TAU = 2 * Math.PI;
type Test = (s: Shell, i: number) => number;
type Lift = (s: Shell, i: number, h: number) => number;
interface Trim {
  thick?: number;
  width?: number;
  edged?: (s: Shell, i: number) => boolean;
  measure?: Test;
  low?: number;
  rise?: number;
  plain?: boolean;
}
function spineSkin(body: DressBody, m: Landmarks, y: number) {
  const step = (name: string) =>
    smooth(body.joint(name)[1] - 0.04 * m.k, body.joint(name)[1] + 0.02 * m.k, y);
  const w3 = step("spine_03"),
    w2 = (1 - w3) * step("spine_02"),
    w1 = (1 - w3 - w2) * step("spine_01");
  return body.blend([
    ["spine_03", w3],
    ["spine_02", w2],
    ["spine_01", w1],
    ["pelvis", Math.max(0, 1 - w3 - w2 - w1)],
  ]);
}
function collarPlates(
  body: DressBody,
  m: Landmarks,
  shells: readonly Surface[],
  kind: string,
  room: number,
  relief: number,
  plates: Piece,
  trim: Piece,
) {
  const k = m.k,
    base = add(m.neck, [0, -0.03 * k, -0.004 * k]),
    top = add(m.neck, [0, 0.06 * k, 0.012 * k]),
    head = body.weight(/^head/);
  const points = figure(
    body,
    shells,
    base[1] - 0.05 * k,
    top[1] + 0.03 * k,
    (v) => at(head, v) < 0.6,
  );
  const tube = new Tube([base, top], [0, 0, 1], [1, 0, 0], 12, 48).measure(points, {
    reach: 0.13 * k,
    soften: 2,
  });
  const neck = body.blend([
      ["neck_01", 0.35],
      ["spine_03", 0.65],
    ]),
    chest = body.rigid("spine_03"),
    all = Math.PI - 0.001;
  if (kind === "ring") {
    plate(plates, tube, {
      u0: 0.2,
      u1: 0.62,
      a0: -all,
      a1: all,
      rows: 5,
      cols: 44,
      gap: (0.012 + room * 0.3) * k,
      bulge: 0.004 * k,
      thick: 0.012 * k,
      groove: 0.0015 * k,
      rollWidth: 0.007 * k,
      skin: chest,
    });
    plate(trim, tube, {
      u0: 0.34,
      u1: 0.48,
      a0: -all,
      a1: all,
      rows: 2,
      cols: 44,
      gap: (0.0185 + room * 0.3) * k,
      thick: 0.004 * k,
      skin: chest,
    });
    return;
  }
  const edge = { thick: 0.003 * k, roll: (0.001 + 0.002 * relief) * k, rollWidth: 0.008 * k };
  plate(plates, tube, {
    u0: 0.24,
    u1: 0.52,
    a0: -all,
    a1: all,
    rows: 4,
    cols: 44,
    gap: 0.009 * k,
    ...edge,
    skin: chest,
  });
  plate(plates, tube, {
    u0: 0.36,
    u1: 0.88,
    a0: -all,
    a1: all,
    rows: 5,
    cols: 44,
    gap: 0.016 * k,
    flare: 0.008 * k,
    edge: (w) => -0.022 * k * Math.max(0, Math.cos((w - 0.5) * TAU)) ** 2,
    ...edge,
    skin: neck,
  });
}

export function cuirass(
  body: DressBody,
  m: Landmarks,
  layer: TailorLayer,
  under: readonly Shell[],
) {
  const k = m.k,
    room = Number(layer["room"]) / 1000,
    kind = finish(layer),
    relief = Number(layer["relief"]),
    draw = draws(Number(layer["seed"])),
    build = String(layer["build"]);
  const hem = mix(m.waist + 0.05 * k, m.belly - 0.02 * k, Number(layer["length"])),
    neckY = m.neck[1];
  const g = garment(body, m, {
    sleeve: -0.07,
    hem,
    ease: room,
    gap: Math.min(room, 0.012),
    fall: build === "fitted" ? 0.55 : 0.3,
    rise: 1.2,
    tension: 1,
    span: 3,
    passes: 12,
    soft: 12,
    chestSoft: 90,
    neck: { height: -0.02, wide: 0.13, bow: 5, scoop: 0.034, scoopWidth: 0.068 },
    folds: 0,
    under,
  });
  clear(g.s, under, 0.006 * k);
  const stand = Array.from({ length: g.s.count }, (_, i) =>
    dot(sub(g.s.at(i), g.s.anchor(i)), g.s.normal(i)),
  );
  relax(g.s, { passes: 24, strength: 0.6, edge: 0.3, gap: (i) => at(stand, i), apart: true });
  fairChest(g.s, m, hem);
  const s = subdivide(g.s),
    n = s.count;
  let zc = 0;
  for (let i = 0; i < n; i++) zc += at(s.pos, i * 3 + 2) / n;
  const ribs =
    mix(Math.max(hem + 0.07 * k, m.waist + 0.035 * k), m.shoulder, 0.3) +
    (draw(1) - 0.5) * 0.02 * k;
  const push = (i: number, d: number, a: number) => {
    s.pos[i * 3 + d] = at(s.pos, i * 3 + d) + a;
  };
  for (let i = 0; i < n; i++) {
    const out = unit([at(s.pos, i * 3), 0, at(s.pos, i * 3 + 2) - zc]),
      kick = 0.012 * k * smooth(hem + 0.05 * k, hem, at(s.pos, i * 3 + 1)) ** 2;
    push(i, 0, out[0] * kick);
    push(i, 2, out[2] * kick);
  }
  if (build === "fitted")
    for (let i = 0; i < n; i++) {
      const x = at(s.pos, i * 3),
        y = at(s.pos, i * 3 + 1),
        z = at(s.pos, i * 3 + 2) - zc,
        along =
          smooth(hem + 0.02 * k, ribs + 0.02 * k, y) *
          smooth(neckY - 0.05 * k, neckY - 0.17 * k, y);
      if (z > 0)
        push(
          i,
          2,
          smooth(0, 0.03 * k, z) *
            along *
            (relief * 0.014 * k * Math.exp(-((x / (0.02 * k)) ** 2)) +
              0.01 * k * Math.exp(-((x / (0.1 * k)) ** 2))),
        );
      else
        push(
          i,
          2,
          smooth(0, 0.03 * k, -z) * along * relief * 0.006 * k * Math.exp(-((x / (0.03 * k)) ** 2)),
        );
    }
  if (build !== "hardshell") {
    const mid = mix(ribs, neckY, 0.45);
    for (let i = 0; i < n; i++) {
      const x = at(s.pos, i * 3),
        y = at(s.pos, i * 3 + 1),
        z = at(s.pos, i * 3 + 2) - zc;
      if (z > 0)
        push(
          i,
          2,
          smooth(0, 0.03 * k, z) *
            0.019 *
            k *
            smooth(ribs - 0.01 * k, ribs + 0.05 * k, y) *
            smooth(neckY - 0.03 * k, mid - 0.02 * k, y) *
            Math.exp(-((x / (0.13 * k)) ** 2)),
        );
    }
    const low: number[] = [];
    for (let i = 0; i < n; i++) if (at(s.pos, i * 3 + 1) < ribs + 0.03 * k) low.push(i);
    const angle = low.map((i) => Math.atan2(at(s.pos, i * 3), at(s.pos, i * 3 + 2) - zc)),
      far = low.map((i) => Math.hypot(at(s.pos, i * 3), at(s.pos, i * 3 + 2) - zc)),
      bins = 40,
      rows = Math.max(1, Math.ceil((ribs + 0.03 * k - hem) / (0.012 * k)));
    const sum = new Float32Array(bins * rows),
      most = new Float32Array(bins * rows),
      count = new Float32Array(bins * rows);
    const cell = (j: number) => {
      const a = Math.floor((at(angle, j) / TAU + 0.5) * bins) % bins,
        r = clamp(Math.floor((at(s.pos, at(low, j) * 3 + 1) - hem) / (0.012 * k)), 0, rows - 1);
      return r * bins + ((a + bins) % bins);
    };
    low.forEach((_, j) => {
      const c = cell(j);
      sum[c] = at(sum, c) + at(far, j);
      most[c] = Math.max(at(most, c), at(far, j));
      count[c] = at(count, c) + 1;
    });
    let even = Float32Array.from(sum, (v, c) => (at(count, c) ? v / at(count, c) : 0));
    for (let pass = 0; pass < 4; pass++)
      even = even.map((v, c) => {
        const r = Math.floor(c / bins),
          a = c % bins;
        let total = 0,
          weight = 0;
        for (const d of [-2, -1, 0, 1, 2]) {
          const o = r * bins + ((a + d + bins) % bins);
          if (at(count, o)) {
            total += at(even, o) * (3 - Math.abs(d));
            weight += 3 - Math.abs(d);
          }
        }
        return weight ? total / weight : v;
      });
    low.forEach((i, j) => {
      const c = cell(j),
        target = Math.max(at(even, c), at(far, j)),
        blend =
          smooth(ribs + 0.03 * k, ribs, at(s.pos, i * 3 + 1)) *
          (1 - smooth(0.25, 0.6, field(s, "wArm", i)));
      const grow = 1 + blend * (target / Math.max(at(far, j), 1e-6) - 1);
      s.pos[i * 3] = at(s.pos, i * 3) * grow;
      s.pos[i * 3 + 2] = zc + (at(s.pos, i * 3 + 2) - zc) * grow;
    });
  }
  s.f["y"] = Array.from({ length: n }, (_, i) => at(s.pos, i * 3 + 1));
  s.f["x"] = Array.from({ length: n }, (_, i) => Math.abs(at(s.pos, i * 3)));
  s.f["z"] = Array.from({ length: n }, (_, i) => at(s.pos, i * 3 + 2) - zc);
  const rim = new Float32Array(n);
  s.f["rim"] = rim;
  for (const loop of loops(s))
    for (const i of loop) if (at(s.pos, i * 3 + 1) > ribs + 0.02 * k) rim[i] = 1;
  const turn = (p: Shell, i: number) => Math.atan2(field(p, "x", i), field(p, "z", i));
  const plates = new Piece(),
    trim = new Piece();
  const chest = body.rigid("spine_03"),
    rise = (0.002 + 0.004 * relief) * k,
    thick = (kind === "leather" ? 0.006 : 0.0045) * k;
  const cutPlate = (keep: Test[], lift: Lift | null, skin: Skin, o: Trim = {}) => {
    let p = s;
    for (const test of keep) {
      const from = p;
      p = cut(from, (i) => test(from, i));
    }
    if (!p.tri.length) return;
    const edged = o.edged
      ? Array.from({ length: p.count }, (_, i) => Boolean(o.edged?.(p, i)))
      : null;
    if (lift)
      for (let i = 0; i < p.count; i++)
        p.set(i, add(p.at(i), p.normal(i), lift(p, i, field(p, "y", i))));
    setSkin(p, skin);
    solid(plates, p, { thickness: o.thick ?? thick });
    const rolled = build !== "hardshell" && !o.measure && o.low === undefined;
    if (rolled)
      rolledRims(trim, p, (i) => field(p, "rim", i) > 0.99, {
        width: 0.0058 * k,
        rise: (0.003 + 0.002 * relief) * k,
        pace: 0.011 * k,
        skin,
      });
    else
      edging(o.plain ? plates : trim, p, {
        width: (o.width ?? 0.014) * k,
        rise: o.rise ?? rise,
        thickness: o.thick ?? thick,
        only: edged ? (i) => Boolean(edged[i]) : null,
        measure: o.measure
          ? (i) => o.measure?.(p, i) ?? 0
          : o.low === undefined
            ? null
            : (i) => field(p, "y", i) - (o.low ?? 0),
      });
  };
  const Y = (p: Shell, i: number) => field(p, "y", i);
  const hoops = (top: number, count: number, band: number, step: number) => {
    if (!count) return;
    const points: Vec[] = [];
    for (let i = 0; i < n; i++)
      if (at(s.pos, i * 3 + 1) < top + 0.05 * k)
        points.push([at(s.pos, i * 3), at(s.pos, i * 3 + 1), at(s.pos, i * 3 + 2)]);
    const low = top - count * band,
      long = top + 0.014 * k - low,
      all = Math.PI - 0.001;
    const tube = new Tube(
      [
        [0, top + 0.014 * k, zc],
        [0, low, zc],
      ],
      [0, 0, 1],
      [1, 0, 0],
      Math.max(6, Math.round(long / (0.012 * k))),
      64,
    ).measure(points, { reach: 0.5 * k, span: 1.2, soften: 3 });
    for (let j = 0; j < count; j++) {
      const u0 = (j * band) / long,
        u1 = ((j + 1) * band + 0.014 * k) / long;
      plate(plates, tube, {
        u0,
        u1,
        a0: -all,
        a1: all,
        rows: 3,
        cols: 56,
        gap: 0.0012 * k,
        flare: step,
        thick,
        roll: rise * 0.7,
        rollWidth: 0.007 * k,
        skin: spineSkin(body, m, top - (j + 0.5) * band),
      });
    }
  };
  const seam = Math.PI / 2,
    lap = 0.07;
  const pair = (keep: Test[], lift: Lift | null, skin: Skin, o: Trim = {}) => {
    cutPlate([...keep, (p, i) => seam + lap - turn(p, i)], lift, skin, {
      ...o,
      edged: o.edged
        ? (p, i) => Boolean(o.edged?.(p, i)) && turn(p, i) < seam + lap * 0.5
        : (p, i) => turn(p, i) < seam + lap * 0.5,
    });
    cutPlate(
      [...keep, (p, i) => turn(p, i) - seam],
      (p, i, h) =>
        (lift ? lift(p, i, h) : 0) + 0.0042 * k * smooth(seam + 0.5, seam + 0.08, turn(p, i)),
      skin,
      o,
    );
  };
  if (build === "fitted") {
    const peak = (0.07 + 0.05 * draw(2)) * k,
      line = (p: Shell, i: number) =>
        ribs -
        0.05 * k +
        peak *
          (Math.max(0, 1 - turn(p, i) / 0.85) ** 1.3 +
            0.7 * Math.max(0, 1 - (Math.PI - turn(p, i)) / 0.8) ** 1.3);
    const count = Math.max(0, Math.round(Number(layer["lames"])) - 1),
      band = Math.min(0.036 * k, (ribs - 0.05 * k - hem) / Math.max(1, count + 1.2)),
      skirtTop = hem + count * band,
      step = 0.007 * k;
    pair([(p, i) => Y(p, i) - line(p, i) + 0.014 * k], null, chest, {
      edged: (p, i) => Y(p, i) > line(p, i) + 0.02 * k,
    });
    cutPlate(
      [(p, i) => line(p, i) - Y(p, i), (p, i) => Y(p, i) - skirtTop + (count ? 0 : 1)],
      () => step,
      spineSkin(body, m, (ribs + skirtTop) / 2),
      { measure: (p, i) => (line(p, i) - Y(p, i)) * 0.8 },
    );
    hoops(skirtTop, count, band, step);
  } else if (build === "segmented") {
    const count = Math.round(Number(layer["lames"])),
      band = (ribs - hem) / count,
      step = (0.007 + 0.003 * relief) * k;
    pair([(p, i) => Y(p, i) - ribs], (_p, _i, h) => step * smooth(ribs + 0.05 * k, ribs, h), chest);
    hoops(ribs, count, band, step);
  } else {
    const chevron = (p: Shell, i: number) =>
      ribs -
      0.035 * k * Math.max(0, 1 - turn(p, i) / 0.75) -
      0.02 * k * Math.max(0, 1 - (Math.PI - turn(p, i)) / 0.7);
    cutPlate([(p, i) => Y(p, i) - chevron(p, i)], null, chest, {
      plain: true,
      width: 0.009,
      rise: rise * 0.7,
    });
    const mid = mix(ribs, neckY, 0.42),
      tall = (neckY - ribs) * 0.2,
      half = (0.05 + 0.02 * draw(3)) * k;
    cutPlate(
      [
        (p, i) => field(p, "z", i),
        (p, i) => half - field(p, "x", i) - 0.55 * Math.abs(Y(p, i) - mid),
        (p, i) => tall - Math.abs(Y(p, i) - mid),
      ],
      () => (0.004 + 0.003 * relief) * k,
      chest,
      { plain: true, width: 0.006, rise: rise * 0.5 },
    );
    const count = Math.round(Number(layer["lames"])),
      gapY = 0.007 * k,
      band = (ribs - 0.045 * k - hem) / count;
    for (let j = 0; j < count; j++) {
      const top = ribs - 0.045 * k - j * band,
        low = top - band + gapY,
        wide = 0.85 - j * 0.06,
        skin = spineSkin(body, m, (top + low) / 2);
      for (const back of [false, true])
        cutPlate(
          [
            (p, i) => top - Y(p, i),
            (p, i) => Y(p, i) - low,
            (p, i) => (back ? wide * 0.8 - (Math.PI - turn(p, i)) : wide - turn(p, i)) * 0.1,
          ],
          () => 0.002 * k,
          skin,
          { plain: true, width: 0.007, rise: rise * 0.6 },
        );
    }
    let bar = cut(s, (i) => field(s, "z", i));
    for (const test of [
      (q: { x: number; y: number }) => 0.045 * k - q.x,
      (q: { x: number; y: number }) => 0.006 * k - Math.abs(q.y - (mid + tall + 0.022 * k)),
    ]) {
      const from = bar;
      bar = cut(from, (i) => test({ x: field(from, "x", i), y: field(from, "y", i) }));
    }
    for (let i = 0; i < bar.count; i++) bar.set(i, add(bar.at(i), bar.normal(i), 0.004 * k));
    if (bar.tri.length)
      solid(trim, setSkin(bar, chest), { thickness: 0.004 * k, lining: Infinity });
  }
  const straps = new Piece(),
    buckles = new Piece();
  if (build !== "hardshell") {
    const strap = (keep: Test[], buckle: Test) => {
      let p = s;
      for (const test of keep) {
        const from = p;
        p = cut(from, (i) => test(from, i));
      }
      if (!p.tri.length) return;
      const metal = cut(p, (i) => buckle(p, i));
      for (let i = 0; i < p.count; i++) p.set(i, add(p.at(i), p.normal(i), 0.0034 * k));
      solid(straps, setSkin(p, chest), { thickness: 0.003 * k, lining: Infinity });
      if (metal.tri.length) {
        for (let i = 0; i < metal.count; i++)
          metal.set(i, add(metal.at(i), metal.normal(i), 0.0058 * k));
        solid(buckles, setSkin(metal, chest), { thickness: 0.003 * k, lining: Infinity });
      }
    };
    let inner = Infinity,
      outer = 0,
      crest = -Infinity;
    for (let i = 0; i < n; i++)
      if (Math.abs(field(s, "z", i)) < 0.012 * k && field(s, "y", i) > neckY - 0.07 * k) {
        inner = Math.min(inner, field(s, "x", i));
        outer = Math.max(outer, field(s, "x", i));
        crest = Math.max(crest, field(s, "y", i));
      }
    if (outer > inner) {
      const centre = mix(inner, outer, 0.5),
        half = Math.min(0.016 * k, (outer - inner) * 0.34),
        reach = 0.085 * k;
      strap(
        [
          (p, i) => half - Math.abs(field(p, "x", i) - centre),
          (p, i) => reach - Math.abs(field(p, "z", i)) - 0.6 * (crest - field(p, "y", i)),
          (p, i) => field(p, "y", i) - (crest - 0.09 * k),
        ],
        (p, i) =>
          Math.min(
            field(p, "z", i) - 0.03 * k,
            0.058 * k - field(p, "z", i),
            half * 1.5 - Math.abs(field(p, "x", i) - centre),
          ),
      );
    }
    const armpit = m.shoulder - 0.11 * k,
      span = Math.max(0.03 * k, armpit - ribs);
    for (const ratio of [0.25, 0.72]) {
      const y0 = ribs + span * ratio,
        tall = 0.011 * k;
      strap(
        [
          (p, i) => tall - Math.abs(field(p, "y", i) - y0),
          (p, i) => 0.34 - Math.abs(turn(p, i) - seam - 0.03),
        ],
        (p, i) => Math.min(seam - 0.1 - turn(p, i), turn(p, i) - (seam - 0.27)),
      );
    }
  }
  const clav = body.weight(/^(clavicle|upperarm)/),
    top = build === "hardshell" ? ribs + 0.02 * k : -Infinity;
  const covers = cut(g.s, (i) => {
    const v = body.nearest(g.s.anchor(i), 1);
    return Math.min(0.2 - (v < 0 ? 1 : at(clav, v)), at(g.s.pos, i * 3 + 1) - top);
  });
  const cuirass = {
    ...part(plates, String(layer["color"]), "spine_03", "Cuirass", kind),
    breastplate: { layer, ribs, centreZ: zc, bottom: hem, top: neckY },
    hem,
    cover: covers,
    shell: s,
  };
  const parts: TailoredPart[] = [cuirass];
  if (trim.tri.length)
    parts.push(
      part(
        trim,
        String(layer["trim"]),
        "spine_03",
        build === "hardshell" ? "Cuirass accent" : "Cuirass edging",
        kind === "leather" ? "metal" : kind,
      ),
    );
  if (straps.tri.length)
    parts.push(part(straps, "#4b3628", "spine_03", "Cuirass straps", "leather"));
  if (buckles.tri.length)
    parts.push(part(buckles, String(layer["trim"]), "spine_03", "Cuirass buckles", "metal"));
  if (String(layer["collar"]) === "mail standard") {
    const columns = 64;
    const standard = mailStandard(body, m, [...under, s, plates, trim], columns);
    parts.push(part(standard.mail, "#494544", "spine_03", "Mail standard", "mail"));
    parts.push(
      part(standard.band, "#4b3628", "spine_03", "Mail standard band", "leather"),
      part(standard.buckle, String(layer["trim"]), "spine_03", "Mail standard buckle", "metal"),
    );
  } else if (String(layer["collar"]) !== "open") {
    const ring = new Piece(),
      accent = new Piece();
    collarPlates(body, m, [...under, s], String(layer["collar"]), room, relief, ring, accent);
    parts.push(
      part(
        ring,
        String(layer["color"]),
        "spine_03",
        String(layer["collar"]) === "ring" ? "Collar ring" : "Gorget",
        kind,
      ),
    );
    if (accent.tri.length)
      parts.push(part(accent, String(layer["trim"]), "spine_03", "Collar accent", kind));
  }
  if (String(layer["back"]) === "pack") {
    let reach = 0;
    for (let i = 0; i < n; i++)
      if (
        Math.abs(at(s.pos, i * 3)) < 0.07 * k &&
        Math.abs(at(s.pos, i * 3 + 1) - (m.shoulder - 0.1 * k)) < 0.09 * k &&
        field(s, "z", i) < 0
      )
        reach = Math.max(reach, -field(s, "z", i));
    const unitPiece = new Piece(),
      vents = new Piece(),
      centre: Vec = [0, m.shoulder - 0.1 * k, zc - reach - 0.022 * k];
    pod(
      unitPiece,
      centre,
      [
        [0.08 * k, 0, 0],
        [0, 0.115 * k, 0],
        [0, 0, 0.03 * k],
      ],
      chest,
      { power: 9, rings: 12, around: 28 },
    );
    for (const sx of [-1, 1])
      pod(
        vents,
        add(centre, [sx * 0.04 * k, 0.03 * k, -0.03 * k]),
        [
          [0.022 * k, 0, 0],
          [0, 0.06 * k, 0],
          [0, 0, 0.012 * k],
        ],
        chest,
        { power: 4, rings: 6, around: 12 },
      );
    parts.push(
      part(unitPiece, String(layer["color"]), "spine_03", "Back unit", kind),
      part(vents, String(layer["trim"]), "spine_03", "Back unit vents", kind),
    );
  }
  return parts;
}
