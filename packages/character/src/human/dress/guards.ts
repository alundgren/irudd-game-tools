import { armourDraws as draws } from "./armour-set.js";
import {
  Piece,
  add,
  at,
  clamp,
  length,
  lerp3,
  mix,
  smooth,
  sub,
  unit,
  vec,
  type DressBody,
  type Landmarks,
  type Skin,
  type Vec,
} from "./kit.js";
import { plate, stud, scale, Tube } from "./plate.js";
import type { TailorLayer } from "./tailor-data.js";
import type { TailoredPart } from "./armour-types.js";
export type Surface = { readonly pos: ArrayLike<number> };
const TAU = 2 * Math.PI;
const mm = (n: number) => n / 1000;
const sideName = (sign: number) => (sign > 0 ? "l" : "r");
export const finish = (layer: TailorLayer) =>
  layer["material"] === "leather" ? "leather" : layer["material"] === "lacquer" ? "satin" : "metal";
export const part = (
  piece: Piece,
  tone: string,
  region: string,
  name: string,
  type: string,
): TailoredPart => ({ piece, tone, region, name, type });
interface Shoulder {
  size: number;
  draw: (n: number) => number;
  cut: string;
  flange: number;
  lames: number;
  room: number;
}
type Pair = readonly [number, number];
function sidesOf(balance: string): readonly Pair[] {
  const sides: Record<string, readonly Pair[]> = {
    "left heavier": [
      [1, 0.4],
      [-1, -0.3],
    ],
    "right heavier": [
      [1, -0.3],
      [-1, 0.4],
    ],
    "left only": [[1, 0.15]],
    "right only": [[-1, 0.15]],
  };
  return (
    sides[balance] ?? [
      [1, 0],
      [-1, 0],
    ]
  );
}
function placements(style: string, angular: boolean): Pair[] {
  const all: Pair[] = [
    [0.44, 0.74],
    [1.38, 0.86],
    [2.5, 0.92],
  ];
  return all
    .slice(0, style === "front" ? 1 : style === "front and sides" ? 2 : 3)
    .map(([a, w]) => (angular ? [a === 0.44 ? 0.5 : a, w * 0.72] : [a, w]));
}
function jointPath(a: Vec, pivot: Vec, b: Vec, count: number): Vec[] {
  const centre = add(scale(pivot, 2), add(a, b), -0.5);
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return lerp3(lerp3(a, centre, t), lerp3(centre, b, t), t);
  });
}
export function figure(
  body: DressBody,
  shells: readonly Surface[],
  low: number,
  high: number,
  keep: (v: number) => boolean = () => true,
): Vec[] {
  const points: Vec[] = [];
  for (let v = 0; v < body.count; v++) {
    const y = at(body.P, v * 3 + 1);
    if (y > low && y < high && keep(v)) points.push(body.point(v));
  }
  for (const s of shells)
    for (let i = 0; i < s.pos.length; i += 3) {
      const y = at(s.pos, i + 1);
      if (y > low && y < high) points.push(vec(s.pos, i));
    }
  return points;
}
const facet = (sides: number) => (a: number) => {
  const sector = TAU / sides,
    x = ((((a + sector / 2) % sector) + sector) % sector) - sector / 2;
  return 0.93 / Math.cos(x) + 0.07;
};

function spaulder(
  body: DressBody,
  m: Landmarks,
  tube: Tube,
  sign: number,
  o: Shoulder,
  plates: Piece,
  trim: Piece,
  leather: Piece,
) {
  const k = m.k,
    side = sideName(sign),
    { size, draw } = o,
    pointed = o.cut === "pointed";
  const S = body.joint("upperarm_" + side),
    uS = tube.nearest(S),
    U = (d: number) => uS + d / tube.length;
  const skin = (t: number) =>
    body.blend([
      ["clavicle_" + side, (1 - t) * 0.7],
      ["spine_03", (1 - t) * 0.3],
      ["upperarm_" + side, t],
    ]);
  const thick = 0.003 * k,
    lap = 0.009 * k,
    roll = (pointed ? 0.0016 : 0.0022) * k,
    rollWidth = 0.007 * k;
  const crease = pointed
      ? (_v: number, w: number) => 0.0035 * k * Math.exp(-(((w - 0.5) / 0.05) ** 2))
      : null,
    marks = pointed ? [0.5] : [];
  const half = 0.96 + 0.22 * size,
    down = (0.036 + 0.012 * size) * k,
    inward = 0.016 * k,
    room = o.room,
    step = (0.0045 + 0.0015 * size) * k;
  const sweep = (w: number) =>
    pointed ? 0.022 * k * (1 - Math.abs(2 * w - 1)) ** 1.4 : -0.008 * k * (2 * w - 1) ** 2;
  const base = { thick, roll, rollWidth, relief: crease, marks, followLimb: true };
  const up = clamp(Math.round(0.9 + size * 1.3 + Math.max(0, o.flange) * 0.8), 1, 3),
    pitchUp = (0.024 + 0.004 * size) * k;
  for (let j = up - 1; j >= 0; j--) {
    const from = -inward - (j + 1) * pitchUp,
      to = -inward - j * pitchUp + lap,
      wide = half * (0.62 - 0.1 * j);
    const lift = (v: number, w: number) =>
      step * 0.7 * (1 - v) ** 1.5 * (j === up - 1 ? 0.35 : 1) + (crease ? crease(v, w) : 0);
    plate(plates, tube, {
      ...base,
      u0: U(from),
      u1: U(to),
      a0: -wide,
      a1: wide,
      rows: 3,
      cols: 14,
      gap: room,
      relief: lift,
      skin: skin(0.06 + 0.06 * (up - 1 - j)),
    });
  }
  const cop = {
    ...base,
    bell: true,
    u0: U(-inward - lap * 0.4),
    u1: U(down),
    a0: -half,
    a1: half,
    rows: 8,
    cols: 20,
    followLimb: false,
    gap: room + step * 0.8,
    flare: step * 0.6,
    bulge: (0.003 + 0.007 * size) * k,
    crest: 0.5,
    edge: sweep,
    arc: (v: number) => mix(0.66, 1, smooth(0, 0.55, v)),
    skin: skin(0.3),
  };
  plate(plates, tube, cop);
  const count = o.lames,
    pitch = (0.031 + 0.009 * size) * k,
    narrow = pointed ? 0.08 : 0.045;
  let low = down;
  for (let i = 0; i < count; i++) {
    const jitter = 1 + (draw(10 + i) - 0.5) * 0.16,
      top = low - lap,
      last = i === count - 1,
      wide = half - 0.07 - i * narrow,
      t = count === 1 ? 0.85 : mix(0.62, 1, i / (count - 1));
    low = top + lap + pitch * jitter;
    const lame = {
      ...base,
      u0: U(top),
      u1: U(low),
      a0: -wide,
      a1: wide,
      rows: 3,
      cols: 18,
      gap: room,
      flare: step,
      bulge: 0.001 * k,
      edge: (w: number) => sweep(w) * (last && pointed ? 1.25 : 0.7),
      lead: (w: number) => sweep(w) * 0.45,
      skin: skin(t),
    };
    plate(plates, tube, lame);
  }
  const band = 0.02 * k,
    at = U(low - pitch * 0.55),
    arm = skin(1),
    lastWide = half - 0.07 - (count - 1) * narrow;
  plate(leather, tube, {
    u0: at - band / 2 / tube.length,
    u1: at + band / 2 / tube.length,
    a0: lastWide - 0.12,
    a1: TAU - lastWide + 0.12,
    rows: 2,
    cols: 16,
    gap: Math.max(0.002 * k, room - 0.003 * k),
    thick: 0.0028 * k,
    followLimb: true,
    skin: arm,
  });
  plate(trim, tube, {
    u0: at - (band * 0.8) / tube.length,
    u1: at + (band * 0.8) / tube.length,
    a0: lastWide + 0.1,
    a1: lastWide + 0.34,
    rows: 2,
    cols: 4,
    gap: Math.max(0.004 * k, room - 0.001 * k),
    thick: 0.004 * k,
    followLimb: true,
    skin: arm,
  });
  const tabFrom = -inward - up * pitchUp - 0.04 * k,
    tabTo = -inward - up * pitchUp + 0.012 * k;
  if (U(tabFrom) > 0.02) {
    const tab = {
      u0: U(tabFrom),
      u1: U(tabTo),
      a0: -0.17,
      a1: 0.17,
      rows: 3,
      cols: 3,
      gap: room + step * 0.5,
      thick: 0.003 * k,
      followLimb: true,
      skin: skin(0.04),
    };
    plate(leather, tube, tab);
    plate(trim, tube, {
      ...tab,
      a0: -0.25,
      a1: 0.25,
      rows: 2,
      cols: 3,
      u0: U(tabFrom + 0.012 * k),
      u1: U(tabFrom + 0.026 * k),
      gap: room + step * 0.5 + 0.0025 * k,
      thick: 0.0035 * k,
    });
  }
}

function pauldron(
  body: DressBody,
  m: Landmarks,
  points: readonly Vec[],
  sign: number,
  o: Shoulder,
  plates: Piece,
  trim: Piece,
  leather: Piece,
) {
  const k = m.k,
    side = sideName(sign),
    S = body.joint("upperarm_" + side),
    E = body.joint("lowerarm_" + side),
    arm = unit(sub(E, S)),
    { cut: style, size, draw } = o;
  const count = o.lames,
    pitch = (0.03 + 0.008 * size) * k,
    lap = 0.011 * k,
    down = (0.05 + 0.02 * size) * k,
    inward = (0.03 + 0.022 * size) * k;
  const A = add(S, [-sign * (inward + 0.06 * k), -0.014 * k, 0]),
    D = add(S, arm, Math.min(down + count * pitch + 0.05 * k, length(sub(E, S)) * 0.85));
  const path = jointPath(A, S, D, 33);
  const tube = new Tube(path, [sign * 0.5, 0.85, 0], [0, 0, 1], 30, 48).measure(points, {
    reach: 0.17 * k,
    arc: 2.2,
    span: 1.8,
    soften: 2,
  });
  const uS = tube.nearest(S),
    U = (d: number) => uS + d / tube.length,
    angular = style === "angular",
    pointed = style === "pointed";
  if (!angular) {
    const own = points.filter((p) => sign * (p[0] - S[0]) > -0.03 * k || p[1] > S[1] - 0.005 * k);
    return spaulder(
      body,
      m,
      new Tube(path, [sign * 0.5, 0.85, 0], [0, 0, 1], 30, 48).measure(own, {
        reach: 0.17 * k,
        arc: 2.2,
        span: 1.2,
        soften: 2,
      }),
      sign,
      o,
      plates,
      trim,
      leather,
    );
  }
  const skin = (t: number) =>
    body.blend([
      ["clavicle_" + side, (1 - t) * 0.7],
      ["spine_03", (1 - t) * 0.3],
      ["upperarm_" + side, t],
    ]);
  const thick = (angular ? 0.006 : 0.003) * k,
    flare = thick + 0.003 * k,
    roll = angular ? 0 : (pointed ? 0.0018 : 0.0028) * k,
    groove = angular ? 0.0018 * k : 0;
  const section = angular ? facet(7) : null,
    crease = pointed
      ? (_v: number, w: number) => 0.004 * k * Math.exp(-(((w - 0.5) / 0.045) ** 2))
      : null;
  const half = (pointed ? 1.15 : 1.25) + 0.3 * size,
    capGap = o.room + 0.002 * k,
    dome = (0.004 + 0.015 * size) * k;
  const sweep = (w: number) =>
    pointed
      ? 0.03 * k * (1 - Math.abs(2 * w - 1)) ** 1.3
      : angular
        ? -0.012 * k * smooth(0.55, 1, Math.abs(2 * w - 1))
        : -0.014 * k * (2 * w - 1) ** 2;
  const cap = {
    bell: true,
    u0: U(-inward),
    u1: U(down),
    a0: -half,
    a1: half,
    rows: 9,
    cols: 22,
    gap: capGap,
    flare,
    bulge: dome,
    thick,
    edge: sweep,
    section,
    crest: 0.62,
    arc: (v: number) => mix(0.45, 1, smooth(0, 0.6, v)),
    skin: skin(0.3),
  };
  plate(plates, tube, {
    ...cap,
    roll,
    groove,
    rollWidth: 0.009 * k,
    relief: crease,
    marks: pointed ? [0.5] : [],
  });
  if (angular)
    plate(trim, tube, {
      ...cap,
      window: [0.5, 0.62, 0.22, 0.78],
      raise: 0.0015 * k,
      thick: 0.003 * k,
    });
  else
    for (const w of [0.09, 0.91])
      plate(trim, tube, {
        ...cap,
        window: [0.86, 0.92, w - 0.035, w + 0.035],
        raise: 0.003 * k,
        thick: 0.003 * k,
      });
  for (let i = 0; i < count; i++) {
    const jitter = 1 + (draw(10 + i) - 0.5) * 0.24,
      top = down - lap + i * pitch,
      low = top + pitch * jitter + lap,
      wide = half - 0.1 - i * (pointed ? 0.1 : 0.06),
      last = i === count - 1,
      t = count === 1 ? 0.85 : mix(0.6, 1, i / (count - 1));
    const lame = {
      u0: U(top),
      u1: U(low),
      a0: -wide,
      a1: wide,
      rows: 4,
      cols: 20,
      gap: o.room + (angular ? 0.002 * k : 0),
      flare: last ? flare * 0.6 : flare,
      bulge: 0.002 * k,
      thick,
      edge: (w: number) => sweep(w) * (last && pointed ? 1.2 : 0.75),
      lead: angular ? null : (w: number) => sweep(w) * 0.5,
      section,
      skin: skin(t),
    };
    plate(plates, tube, {
      ...lame,
      roll,
      groove,
      rollWidth: 0.008 * k,
      relief: crease,
      marks: pointed ? [0.5] : [],
    });
    if (!angular)
      for (const w of [0.08, 0.92])
        plate(trim, tube, {
          ...lame,
          window: [0.72, 0.84, w - 0.03, w + 0.03],
          raise: 0.0028 * k,
          thick: 0.003 * k,
        });
  }
  if (o.flange > 0.02) {
    const tall = (0.008 + o.flange * 0.024) * k,
      from = Math.max(-inward - (0.016 + 0.012 * o.flange) * k, (0.02 - uS) * tube.length);
    plate(plates, tube, {
      u0: U(from),
      u1: U(-inward + lap * 0.6),
      a0: -half * 0.42,
      a1: half * 0.42,
      rows: 5,
      cols: 16,
      gap: o.room,
      thick,
      roll,
      groove,
      rollWidth: 0.008 * k,
      relief: (v: number, w: number) =>
        tall * (1 - v) ** 2 * Math.max(0, Math.cos((w - 0.5) * Math.PI)),
      section,
      skin: skin(0.08),
    });
  }
}

export function pauldrons(
  body: DressBody,
  m: Landmarks,
  layer: TailorLayer,
  worn: readonly Surface[],
) {
  const k = m.k,
    kind = finish(layer),
    points = figure(body, worn, m.shoulder - 0.32 * k, m.neck[1] + 0.06 * k),
    parts = [],
    draw = draws(Number(layer["seed"]));
  for (const [sign, bias] of sidesOf(String(layer["balance"]))) {
    const plates = new Piece(),
      trim = new Piece(),
      leather = new Piece(),
      side = sideName(sign);
    plates.plateUV = [];
    pauldron(
      body,
      m,
      points,
      sign,
      {
        cut: String(layer["cut"]),
        size: clamp(Number(layer["size"]) + bias),
        lames: clamp(Math.round(Number(layer["lames"]) + bias * 3), 1, 6),
        flange: bias < 0 ? 0 : clamp(Number(layer["flange"]) + Math.max(0, bias) * 0.6),
        room: mm(Number(layer["room"])) * k,
        draw,
      },
      plates,
      trim,
      leather,
    );
    parts.push(part(plates, String(layer["color"]), "upperarm_" + side, "Pauldron", kind));
    if (trim.tri.length)
      parts.push(
        part(
          trim,
          String(layer["trim"]),
          "upperarm_" + side,
          String(layer["cut"]) === "angular" ? "Pauldron accent" : "Pauldron studs",
          kind === "leather" ? "metal" : kind,
        ),
      );
    if (leather.tri.length)
      parts.push(part(leather, "#4b3628", "upperarm_" + side, "Pauldron straps", "leather"));
  }
  return parts;
}

function styleOf(cutName: string, k: number, leather: boolean) {
  const angular = cutName === "angular",
    pointed = cutName === "pointed",
    thick = (angular ? 0.005 : leather ? 0.0045 : 0.003) * k;
  return {
    angular,
    pointed,
    thick,
    flare: thick + 0.003 * k,
    roll: angular ? 0 : (pointed ? 0.0018 : 0.0026) * k,
    groove: angular ? 0.0016 * k : 0,
    rollWidth: 0.008 * k,
  };
}

function strapRound(
  piece: Piece,
  tube: Tube,
  u: number,
  width: number,
  gap: number,
  skin: Skin,
  from: number,
  to: number,
) {
  plate(piece, tube, {
    u0: u - width / 2 / tube.length,
    u1: u + width / 2 / tube.length,
    a0: from,
    a1: to,
    rows: 2,
    cols: 20,
    gap,
    thick: 0.0028,
    skin,
  });
}

export function armguards(
  body: DressBody,
  m: Landmarks,
  layer: TailorLayer,
  worn: readonly Surface[],
) {
  const k = m.k,
    kind = finish(layer),
    shells = worn,
    parts = [],
    st = styleOf(String(layer["cut"]), k, kind === "leather"),
    room = mm(Number(layer["room"])) * k,
    draw = draws(Number(layer["seed"]));
  const points = figure(body, shells, m.shoulder - 0.75 * k, m.shoulder + 0.05 * k),
    elbow = String(layer["cover"]) !== "forearm",
    whole = String(layer["cover"]) === "whole arm";
  for (const [sign, bias] of sidesOf(String(layer["balance"]))) {
    const side = sideName(sign),
      S = body.joint("upperarm_" + side),
      E = body.joint("lowerarm_" + side),
      H = body.joint("hand_" + side),
      plates = new Piece(),
      straps = new Piece();
    plates.plateUV = [];
    const fore = body.rigid("lowerarm_" + side),
      upper = body.rigid("upperarm_" + side),
      bend = body.blend([
        ["lowerarm_" + side, 0.5],
        ["upperarm_" + side, 0.5],
      ]);
    const lower = new Tube([E, H], [sign * 0.75, 0.35, -0.55], [0, 0, 1], 16, 40).measure(points, {
      reach: 0.1 * k,
      soften: 3,
    });
    const full =
        bias > 0.2 || (String(layer["balance"]) === "matched" && Number(layer["room"]) > 9),
      wrap = st.angular ? 1.75 : full ? 2.25 : 1.95,
      section = st.angular ? facet(6) : null;
    const guard = {
      bell: true,
      followLimb: true,
      u0: 0.14,
      u1: 0.9,
      a0: -wrap,
      a1: wrap,
      rows: 7,
      cols: 22,
      gap: room,
      flare: -0.001 * k,
      lead: (w: number) =>
        -0.02 * k * Math.max(0, Math.cos((w - 0.5) * Math.PI)) ** 1.5 * (st.pointed ? 1.6 : 1),
      bulge: (st.angular ? 0.004 : 0.002) * k,
      thick: st.thick,
      section,
      skin: fore,
    };
    plate(plates, lower, {
      ...guard,
      roll: st.roll,
      groove: st.groove,
      rollWidth: st.rollWidth,
      relief: st.pointed
        ? (_v: number, w: number) => 0.0035 * k * Math.exp(-(((w - 0.5) / 0.05) ** 2))
        : st.angular
          ? null
          : (v: number) => 0.004 * k * (1 - v) ** 3,
      marks: st.pointed ? [0.5] : [],
    });
    if (full && !st.angular)
      plate(plates, lower, {
        u0: 0.2,
        u1: 0.88,
        a0: wrap - 0.12,
        a1: TAU - wrap + 0.12,
        rows: 5,
        cols: 14,
        gap: room - 0.0015 * k,
        thick: st.thick,
        roll: st.roll * 0.6,
        rollWidth: st.rollWidth,
        skin: fore,
      });
    else
      for (const u of [0.3, 0.72])
        strapRound(
          straps,
          lower,
          u,
          (st.angular ? 0.03 : 0.017) * k,
          room - 0.003 * k,
          fore,
          wrap - 0.25,
          TAU - wrap + 0.25,
        );
    if (st.angular)
      plate(straps, lower, {
        ...guard,
        window: [0.3, 0.62, 0.4, 0.6],
        raise: 0.0015 * k,
        thick: 0.003 * k,
      });
    if (elbow) {
      const a = unit(sub(S, E)),
        b = unit(sub(H, E)),
        inside = add(a, b),
        out: Vec = length(inside) > 0.08 ? scale(unit(inside), -1) : [0, 0, -1];
      const P0 = add(E, a, 0.075 * k),
        P1 = add(E, b, 0.075 * k),
        path = jointPath(P0, E, P1, 17);
      const joint = new Tube(path, out, [0, 0, 1], 14, 40).measure(points, {
        reach: 0.1 * k,
        arc: 2.2,
        soften: 3,
      });
      plate(plates, joint, {
        u0: 0.2,
        u1: 0.8,
        a0: -1.45,
        a1: 1.45,
        rows: 6,
        cols: 16,
        gap: room + 0.004 * k,
        bulge: (0.01 + 0.006 * Math.max(0, bias)) * k,
        thick: st.thick,
        roll: st.roll,
        groove: st.groove,
        rollWidth: st.rollWidth,
        edge: (w: number) => -0.012 * k * (2 * w - 1) ** 2,
        lead: (w: number) => 0.012 * k * (2 * w - 1) ** 2,
        relief: st.pointed
          ? (_v: number, w: number) => 0.004 * k * Math.exp(-(((w - 0.5) / 0.06) ** 2))
          : null,
        section: st.angular ? facet(6) : null,
        marks: st.pointed ? [0.5] : [],
        skin: bend,
      });
    }
    if (whole) {
      const high = new Tube([S, E], [sign * 0.8, 0.5, -0.2], [0, 0, 1], 16, 40).measure(points, {
        reach: 0.11 * k,
        soften: 3,
      });
      plate(plates, high, {
        u0: 0.5 + 0.06 * draw(3),
        u1: 0.86,
        a0: -1.9,
        a1: 1.9,
        rows: 5,
        cols: 20,
        gap: room + 0.001 * k,
        flare: st.flare * 0.5,
        thick: st.thick,
        roll: st.roll,
        groove: st.groove,
        rollWidth: st.rollWidth,
        section: st.angular ? facet(6) : null,
        skin: upper,
      });
      strapRound(straps, high, 0.68, 0.017 * k, room - 0.002 * k, upper, 1.7, TAU - 1.7);
    }
    parts.push(
      part(
        plates,
        String(layer["color"]),
        "lowerarm_" + side,
        elbow ? "Arm guard" : "Vambrace",
        kind,
      ),
    );
    if (straps.tri.length)
      parts.push(
        part(
          straps,
          String(layer["trim"]),
          "lowerarm_" + side,
          st.angular ? "Arm guard accent" : "Arm guard straps",
          st.angular ? kind : "leather",
        ),
      );
  }
  return parts;
}

function calfStrap(
  piece: Piece,
  tube: Tube,
  u: number,
  width: number,
  plateGap: number,
  skin: Skin,
  wrap: number,
  k: number,
) {
  const outer = [],
    inner = [],
    steps = 20;
  for (const edge of [-0.5, 0.5]) {
    const at = u + (edge * width) / tube.length,
      face = [],
      back = [];
    for (let i = 0; i <= steps; i++) {
      const w = i / steps,
        a = mix(wrap - 0.24, TAU - wrap + 0.24, w);
      const end = 1 - smooth(0, 0.21, Math.min(w, 1 - w));
      const r = tube.radius(at, a) + mix(0.0025 * k, plateGap - 0.001 * k, end);
      face.push(tube.point(at, a, r));
      back.push(tube.point(at, a, r - 0.0025 * k));
    }
    outer.push(face);
    inner.push(back);
  }
  piece.slab(outer, inner, skin);
}

export function legguards(
  body: DressBody,
  m: Landmarks,
  layer: TailorLayer,
  worn: readonly Surface[],
) {
  const k = m.k,
    kind = finish(layer),
    shells = worn,
    parts = [],
    st = styleOf(String(layer["cut"]), k, kind === "leather"),
    draw = draws(Number(layer["seed"]));

  const room = mm(Number(layer["room"])) * k,
    points = figure(
      body,
      shells,
      body.floor + 0.03 * k,
      m.hip + 0.03 * k,
      (v: number) => Math.abs(at(body.P, v * 3)) > 0.004,
    );
  const knee = String(layer["cover"]) !== "shin",
    whole = String(layer["cover"]) === "whole leg",
    section = st.angular ? facet(6) : null;
  for (const sign of [1, -1]) {
    const side = sideName(sign),
      T = body.joint("thigh_" + side),
      K = body.joint("calf_" + side),
      F = body.joint("foot_" + side),
      plates = new Piece(),
      straps = new Piece();
    plates.plateUV = [];
    const own = points.filter((p) => p[0] * sign > 0),
      shin = body.rigid("calf_" + side),
      thigh = body.rigid("thigh_" + side),
      bend = body.blend([
        ["calf_" + side, 0.5],
        ["thigh_" + side, 0.5],
      ]);
    const lower = new Tube([K, F], [sign * 0.12, 0, 1], [sign, 0, 0], 18, 40).measure(own, {
      reach: 0.12 * k,
      soften: 3,
    });
    const gap = room,
      wrap = st.angular ? 1.6 : whole ? 2.2 : 1.85;
    const greave = {
      bell: true,
      followLimb: true,
      u0: 0.11,
      u1: 0.9,
      a0: -wrap,
      a1: wrap,
      rows: 8,
      cols: 22,
      gap,
      lead: (w: number) => k * (0.024 - 0.057 * Math.sin(w * Math.PI) ** 2),
      edge: (w: number) => k * (0.012 - 0.041 * Math.sin(w * Math.PI) ** 4),
      bulge: 0.002 * k,
      thick: st.thick,
      section,
      skin: shin,
    };
    plate(plates, lower, {
      ...greave,
      roll: st.roll,
      groove: st.groove,
      rollWidth: st.rollWidth,
      relief: st.angular
        ? null
        : (_v: number, w: number) =>
            (st.pointed ? 0.0045 : 0.0025) * k * Math.exp(-(((w - 0.5) / 0.05) ** 2)),
      marks: st.angular ? [] : [0.5],
    });
    if (whole && !st.angular)
      plate(plates, lower, {
        u0: 0.16,
        u1: 0.86,
        a0: wrap - 0.12,
        a1: TAU - wrap + 0.12,
        rows: 6,
        cols: 14,
        gap: gap - 0.0015 * k,
        thick: st.thick,
        roll: st.roll * 0.6,
        rollWidth: st.rollWidth,
        skin: shin,
      });
    else {
      const bands = new Piece();
      for (const u of [0.28, 0.7])
        calfStrap(bands, lower, u, (st.angular ? 0.032 : 0.018) * k, gap, shin, wrap, k);
      parts.push(
        part(
          bands,
          st.angular ? "#463d36" : String(layer["trim"]),
          "calf_" + side,
          "Greave straps",
          "leather",
        ),
      );
    }
    if (st.angular)
      plate(straps, lower, {
        ...greave,
        window: [0.24, 0.5, 0.43, 0.57],
        raise: 0.0015 * k,
        thick: 0.003 * k,
      });
    if (knee) {
      const a = unit(sub(T, K)),
        b = unit(sub(F, K)),
        P0 = add(K, a, 0.1 * k),
        P1 = add(K, b, 0.085 * k),
        path = jointPath(P0, K, P1, 17);
      const joint = new Tube(path, [sign * 0.1, 0, 1], [sign, 0, 0], 16, 40).measure(own, {
        reach: 0.13 * k,
        arc: 2.3,
        soften: 3,
      });
      const cap = room + 0.004 * k;
      if (!st.angular)
        for (const [u0, u1, t] of [
          [0.08, 0.36, 0.2],
          [0.64, 0.92, 0.8],
        ] as const)
          plate(plates, joint, {
            u0,
            u1,
            a0: -1.25,
            a1: 1.25,
            rows: 3,
            cols: 14,
            gap: cap - 0.002 * k,
            thick: st.thick,
            roll: st.roll * 0.7,
            rollWidth: st.rollWidth,
            skin: body.blend([
              ["calf_" + side, t],
              ["thigh_" + side, 1 - t],
            ]),
          });
      plate(plates, joint, {
        u0: 0.27,
        u1: 0.73,
        a0: -1.4,
        a1: 1.4,
        rows: 6,
        cols: 16,
        gap: cap + st.thick,
        bulge: 0.012 * k,
        thick: st.thick,
        roll: st.roll,
        groove: st.groove,
        rollWidth: st.rollWidth,
        edge: (w: number) => -0.014 * k * (2 * w - 1) ** 2,
        lead: (w: number) => 0.014 * k * (2 * w - 1) ** 2,
        relief: st.pointed
          ? (_v: number, w: number) => 0.005 * k * Math.exp(-(((w - 0.5) / 0.06) ** 2))
          : null,
        section,
        marks: st.pointed ? [0.5] : [],
        skin: bend,
      });
    }
    if (whole) {
      const high = new Tube([T, K], [sign * 0.35, 0, 1], [sign, 0, 0], 18, 40).measure(own, {
        reach: 0.16 * k,
        arc: 2.4,
        soften: 3,
      });
      plate(plates, high, {
        u0: 0.34 + 0.05 * draw(4),
        u1: 0.84,
        a0: -1.25,
        a1: 1.6,
        rows: 7,
        cols: 20,
        gap: room + 0.002 * k,
        thick: st.thick,
        roll: st.roll,
        groove: st.groove,
        rollWidth: st.rollWidth,
        lead: (w: number) => -0.03 * k * Math.max(0, Math.cos((w - 0.45) * Math.PI)) ** 2,
        relief: st.angular
          ? null
          : (_v: number, w: number) => 0.003 * k * Math.exp(-(((w - 0.44) / 0.05) ** 2)),
        section,
        marks: st.angular ? [] : [0.44],
        skin: thigh,
      });
      strapRound(straps, high, 0.6, 0.02 * k, room - 0.002 * k, thigh, 1.4, TAU - 1.1);
    }
    parts.push(
      part(plates, String(layer["color"]), "calf_" + side, knee ? "Leg guard" : "Greave", kind),
    );
    if (straps.tri.length)
      parts.push(
        part(
          straps,
          String(layer["trim"]),
          "calf_" + side,
          st.angular ? "Leg guard accent" : "Leg guard straps",
          st.angular ? kind : "leather",
        ),
      );
  }
  return parts;
}

export function tassets(
  body: DressBody,
  m: Landmarks,
  layer: TailorLayer,
  worn: readonly Surface[],
  hem?: number,
) {
  const k = m.k,
    kind = finish(layer),
    shells = worn,
    st = styleOf(String(layer["cut"]), k, kind === "leather"),
    draw = draws(Number(layer["seed"])),
    room = mm(Number(layer["room"])) * k;
  const top = (hem ?? m.waist - 0.03 * k) + 0.012 * k,
    knee = body.joint("calf_l")[1],
    bottom = mix(m.hip - 0.05 * k, mix(m.hip, knee, 0.78), Number(layer["length"]));
  const arm = body.weight(/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/),
    points = figure(
      body,
      shells,
      bottom - 0.04 * k,
      top + 0.05 * k,
      (v: number) => at(arm, v) < 0.3,
    );
  const tube = new Tube(
    [
      [0, top, m.pelvis[2]],
      [0, bottom, m.pelvis[2]],
    ],
    [0, 0, 1],
    [1, 0, 0],
    Math.max(8, Math.round((top - bottom) / (0.02 * k))),
    64,
  ).measure(points, {
    reach: 0.4 * k,
    span: 1.2,
    soften: 2,
    hang: st.angular ? [0.5, 1] : [-0.1, 1],
  });
  const places = placements(String(layer["plates"]), st.angular);
  const plates = new Piece(),
    trim = new Piece(),
    count = Math.round(Number(layer["lames"])),
    lap = (0.017 * k) / tube.length,
    parts = [];
  for (const sign of [1, -1])
    for (const [n, [at, wide]] of places.entries()) {
      const side = sideName(sign),
        centre = sign * at,
        a0 = centre - wide / 2,
        a1 = centre + wide / 2,
        long = n === 0 ? 1 : n === 1 ? 0.8 : 0.66,
        each = long / count;
      for (let j = 0; j < count; j++) {
        const u0 = Math.max(0, j * each - (j ? lap : 0)),
          u1 = Math.min(
            1,
            (j + 1) * each * (1 + (j === count - 1 ? (draw(n * 7 + j) - 0.5) * 0.12 : 0)),
          ),
          last = j === count - 1,
          share =
            (n === 0 ? 1 : n === 1 ? 0.75 : 0.9) *
            mix(0.36, 0.5, count === 1 ? 0.6 : j / (count - 1));
        const sweep = (w: number) =>
          last
            ? st.pointed
              ? 0.045 * k * (1 - Math.abs(2 * w - 1)) ** 1.2 - 0.02 * k
              : st.angular
                ? -0.02 * k * smooth(0.5, 1, Math.abs(2 * w - 1))
                : -0.02 * k * (2 * w - 1) ** 2
            : 0;
        plate(plates, tube, {
          u0,
          u1,
          a0,
          a1,
          rows: 4,
          cols: 16,
          gap: room + 0.002 * k,
          flare: st.flare + 0.004 * k * j,
          thick: st.thick,
          roll: st.roll,
          groove: st.groove,
          rollWidth: st.rollWidth,
          edge: sweep,
          bulge: 0.003 * k,
          relief: st.pointed
            ? (_v: number, w: number) => 0.004 * k * Math.exp(-(((w - 0.5) / 0.05) ** 2))
            : null,
          marks: st.pointed ? [0.5] : [],
          skin: body.blend([
            ["pelvis", 1 - share],
            ["thigh_" + side, share],
          ]),
        });
        if (!st.angular && !last)
          for (const a of [a0 + 0.07, a1 - 0.07])
            stud(
              trim,
              tube,
              u1 - (0.013 * k) / tube.length,
              a,
              tube.radius(u1, a) + room + 0.002 * k + st.flare + 0.004 * k * j,
              0.0038 * k,
              body.blend([
                ["pelvis", 1 - share],
                ["thigh_" + side, share],
              ]),
            );
      }
    }
  parts.push(part(plates, String(layer["color"]), "pelvis", "Tassets", kind));
  if (trim.tri.length)
    parts.push(
      part(
        trim,
        String(layer["trim"]),
        "pelvis",
        "Tasset studs",
        kind === "leather" ? "metal" : kind,
      ),
    );
  return parts;
}
