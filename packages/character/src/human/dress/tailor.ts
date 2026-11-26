import type * as T from "three";
import type { Raster } from "../../raster.js";
import { finishTailored, type ClothStyle } from "./cloth-finish.js";
import { finishFootwear } from "./shoe-finish.js";
import type { Ray } from "../../game/raycast.js";
import type { HumanSurface } from "../surface.js";
import {
  band,
  belt,
  bootFastenings,
  box,
  button,
  caster,
  collar,
  garment,
  landmarks,
  patch,
  shaft,
  shoe,
  sleeveGuard,
  type Landmarks,
} from "./cloth.js";
import {
  Piece,
  add,
  analyse,
  at,
  dot,
  lerp3,
  loops,
  mix,
  smooth,
  sub,
  unit,
  type DressBody,
  type DressMesh,
  type Shell,
  type Vec,
} from "./kit.js";

import { tailorLayer, tailorProblems, type Tailor, type TailorLayer } from "./tailor-data.js";

export * from "./tailor-data.js";

const num = (layer: TailorLayer, key: string): number => {
  const v = layer[key];
  return typeof v === "number" ? v : 0;
};
const str = (layer: TailorLayer, key: string): string => {
  const v = layer[key];
  return typeof v === "string" ? v : "";
};
const mm = (value: number) => value / 1000;

export interface TailoredPart {
  readonly piece: Piece;
  readonly tone: string;
  readonly region: string;
  readonly name: string;
  readonly type: string;
  readonly ground?: number;
}
const part = (
  piece: Piece,
  tone: string,
  region: string,
  name: string,
  type = "cloth",
): TailoredPart => ({
  piece,
  tone,
  region,
  name,
  type,
});

interface Worn {
  readonly kind: string;
  readonly shell?: Shell;
  readonly ease?: number;
  readonly waist?: number;
  readonly length?: number;
  readonly height?: number;
  readonly shafts?: ReadonlyArray<Shell>;
}
interface Made {
  readonly parts: TailoredPart[];
  readonly covers?: ReadonlyArray<Shell>;
  readonly worn: Worn;
  readonly ground?: number;
}

function pocket(
  piece: Piece,
  cast: Ray,
  body: DressBody,
  m: Landmarks,
  {
    x,
    y,
    z = m.chest[2],
    width = 0.1,
    height = 0.11,
    facing = [0, 0, 1],
    across = [1, 0, 0],
    flap = true,
    rise = 0.0028,
  }: {
    readonly x: number;
    readonly y: number;
    readonly z?: number;
    readonly width?: number;
    readonly height?: number;
    readonly facing?: Vec;
    readonly across?: Vec;
    readonly flap?: boolean;
    readonly rise?: number;
  },
): void {
  const k = m.k,
    centre: Vec = [x, y, z],
    skin = (p: Vec) => body.trunkAt(p);
  patch(piece, cast, body, {
    centre,
    facing,
    across,
    width: width * k,
    height: height * k,
    rise: rise * k,
    skin,
  });
  if (flap)
    patch(piece, cast, body, {
      centre: [x, y + height * k * 0.36, z],
      facing,
      across,
      width: (width + 0.008) * k,
      height: height * k * 0.34,
      rise: (rise + 0.0028) * k,
      ny: 2,
      skin,
    });
}

type PerVertex = number | ((i: number) => number);
const valueOf = (x: PerVertex, i: number) => (typeof x === "function" ? x(i) : x);

function snug(
  s: Shell,
  weight: (i: number) => number,
  limit: PerVertex,
  least: PerVertex = 0.0012,
): void {
  for (let i = 0; i < s.count; i++) {
    const w = weight(i);
    if (w <= 0) continue;
    const a = s.anchor(i),
      n = s.normal(i),
      d = dot(sub(s.at(i), a), n),
      most = valueOf(limit, i),
      floor = valueOf(least, i);
    s.set(
      i,
      lerp3(s.at(i), add(a, n, Math.min(Math.max(d, Math.min(floor, most)), most)), Math.min(1, w)),
    );
  }
}

function clear(s: Shell, shells: ReadonlyArray<Shell>, margin: number): void {
  if (!shells.length) return;
  const cell = 0.024,
    grid = new Map<string, Array<readonly [number, number, number, number]>>(),
    key = (x: number, y: number, z: number) =>
      Math.floor(x / cell) + "," + Math.floor(y / cell) + "," + Math.floor(z / cell);
  for (const under of shells)
    for (let i = 0; i < under.count; i++) {
      const a = under.anchor(i),
        k = key(a[0], a[1], a[2]),
        d = dot(sub(under.at(i), a), under.normal(i));
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push([a[0], a[1], a[2], d]);
    }
  for (let i = 0; i < s.count; i++) {
    const a = s.anchor(i),
      n = s.normal(i);
    let most = -Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const [x, y, z, d] of grid.get(
            key(a[0] + dx * cell, a[1] + dy * cell, a[2] + dz * cell),
          ) ?? [])
            if ((x - a[0]) ** 2 + (y - a[1]) ** 2 + (z - a[2]) ** 2 < 0.022 ** 2)
              most = Math.max(most, d);
    const d = dot(sub(s.at(i), a), n);
    if (d < most + margin) s.set(i, add(s.at(i), n, most + margin - d));
  }
}

function cover(body: DressBody, s: Shell, margin: number): Float32Array {
  const over = new Float32Array(body.count).fill(-1),
    P = body.P,
    grid = new Map<string, Vec[]>(),
    key = (x: number, y: number, z: number) =>
      Math.floor(x / margin) + "," + Math.floor(y / margin) + "," + Math.floor(z / margin);
  for (const loop of loops(s))
    for (const i of loop) {
      const a = s.anchor(i),
        k = key(a[0], a[1], a[2]);
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(a);
    }
  for (let i = 0; i < s.count; i++) {
    const a = s.anchor(i),
      v = body.nearest(a, 1);
    if (
      v < 0 ||
      (at(P, v * 3) - a[0]) ** 2 + (at(P, v * 3 + 1) - a[1]) ** 2 + (at(P, v * 3 + 2) - a[2]) ** 2 >
        1e-8
    )
      continue;
    const d = dot(sub(s.at(i), a), s.normal(i));
    over[v] = at(over, v) < 0 ? d : Math.min(at(over, v), d);
  }
  for (let v = 0; v < body.count; v++) {
    if (at(over, v) < 0) continue;
    const x = at(P, v * 3),
      y = at(P, v * 3 + 1),
      z = at(P, v * 3 + 2);
    open: for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const a of grid.get(key(x + dx * margin, y + dy * margin, z + dz * margin)) ?? [])
            if ((a[0] - x) ** 2 + (a[1] - y) ** 2 + (a[2] - z) ** 2 < margin * margin) {
              over[v] = -1;
              break open;
            }
  }
  return over;
}

function conceal(body: DressBody, made: ReadonlyArray<Made>): Set<number> {
  const margin = 0.03 * body.scale,
    covers = made.map((layer) => (layer.covers ?? []).map((s) => cover(body, s, margin))),
    hidden = new Set<number>(),
    P = body.P,
    N = body.N;
  for (const layer of covers)
    for (const over of layer)
      for (let v = 0; v < body.count; v++)
        if (at(over, v) > 0.0005) hidden.add(at(body.surface.ids, v));
  made.forEach((layer, index) => {
    const others = covers.flatMap((list, other) => (other === index ? [] : list));
    if (!others.length) return;
    for (const { piece } of layer.parts) {
      const inside = new Uint8Array(piece.count);
      for (let i = 0; i < piece.count; i++) {
        const p: Vec = [at(piece.pos, i * 3), at(piece.pos, i * 3 + 1), at(piece.pos, i * 3 + 2)],
          v = body.nearest(p, 3);
        if (v < 0) continue;
        const d =
          (p[0] - at(P, v * 3)) * at(N, v * 3) +
          (p[1] - at(P, v * 3 + 1)) * at(N, v * 3 + 1) +
          (p[2] - at(P, v * 3 + 2)) * at(N, v * 3 + 2);
        inside[i] = others.some((over) => at(over, v) - 0.0005 > d) ? 1 : 0;
      }
      const tri: number[] = [];
      for (let t = 0; t < piece.tri.length; t += 3)
        if (
          !(
            inside[at(piece.tri, t)] &&
            inside[at(piece.tri, t + 1)] &&
            inside[at(piece.tri, t + 2)]
          )
        )
          tri.push(at(piece.tri, t), at(piece.tri, t + 1), at(piece.tri, t + 2));
      piece.tri = tri;
    }
  });
  return hidden;
}

function hood(
  piece: Piece,
  s: Shell,
  loop: ReadonlyArray<number> | null,
  m: Landmarks,
  cast: Ray,
): void {
  if (!loop) return;
  const k = m.k,
    z0 = m.neck[2],
    sides = 10,
    rings = Array.from({ length: sides }, (): Vec[] => []);
  for (const i of loop) {
    const p = s.at(i),
      o = unit([p[0], 0, p[2] - z0]),
      back = smooth(1.45, 2.6, Math.abs(Math.atan2(p[0], p[2] - z0)));
    const deep = (0.004 + 0.017 * back) * k,
      tall = (0.006 + 0.082 * back * back) * k,
      centre: [number, number, number] = [
        p[0] + o[0] * deep * 0.9,
        p[1] + 0.004 * k - tall * back,
        p[2] + o[2] * deep * 0.9,
      ];
    const from: Vec = [p[0] + o[0] * 0.4, centre[1], p[2] + o[2] * 0.4],
      reach = back > 0 ? cast(from, [-o[0], 0, -o[2]]) : Infinity;
    if (Number.isFinite(reach))
      for (const d of [0, 2] as const)
        centre[d] = mix(centre[d], from[d] - o[d] * (reach - deep * 0.9), back);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      rings[j]?.push([
        centre[0] + o[0] * Math.cos(a) * deep,
        centre[1] + Math.sin(a) * tall,
        centre[2] + o[2] * Math.cos(a) * deep,
      ]);
    }
  }
  const skins = loop.map((i) => s.skin(i));
  piece.loft(
    [...rings, rings[0] ?? []],
    (_p, _i, j) =>
      skins[j] ?? [
        [0, 0, 0, 0],
        [1, 0, 0, 0],
      ],
  );
}

const shellsOf = (worn: ReadonlyArray<Worn>): Shell[] =>
  worn.flatMap((w) => (w.shell ? [w.shell] : []));

function top(
  body: DressBody,
  m: Landmarks,
  layer: TailorLayer,
  worn: ReadonlyArray<Worn>,
  later: ReadonlyArray<TailorLayer>,
): Made {
  const k = m.k,
    parts: TailoredPart[] = [],
    stiff = num(layer, "stiff"),
    collarKind = str(layer, "collar"),
    neckKind = str(layer, "neck"),
    material = str(layer, "material");
  const hem = mix(m.waist, m.crotch + 0.02 * k, num(layer, "length")),
    waists = worn.filter((w) => w.kind === "trousers");
  const seat = collarKind === "none" ? 0 : -0.02;
  const openPlate =
    collarKind === "stand" &&
    later.some((outer) => outer.piece === "cuirass" && outer["collar"] === "open");
  const depth = mm(num(layer, "depth")),
    neck =
      neckKind === "v"
        ? { v: depth, height: seat }
        : neckKind === "scoop"
          ? { scoop: depth, scoopWidth: 0.075, height: seat }
          : neckKind === "high"
            ? { height: openPlate ? -0.013 : 0.012 }
            : { height: seat };
  const band0 = waists.length ? Math.max(...waists.map((w) => w.waist ?? 0)) : null;
  const ease = mm(num(layer, "ease"));
  const g = garment(body, m, {
    sleeve: num(layer, "sleeve"),
    hem,
    ease,
    neck,
    fall: mix(0.45, 0.06, stiff),
    tension: 1,
    span: mix(2, 2.8, stiff),
    sleeveFall: mix(0.5, 0.08, stiff),
    sleeveEase: stiff > 0.5 ? 0.004 : 0.002,
    passes: Math.round(mix(6, 9, stiff)),
    extra: band0 === null ? null : (y) => 0.006 * smooth(band0 + 0.04 * k, band0 + 0.012 * k, y),
    under: shellsOf(worn),
  });
  const layered = worn
      .filter((w) => w.kind === "top")
      .reduce((sum, w) => sum + (w.ease ?? 0) + 0.004, 0),
    near = (ease + layered) * k,
    least = near - ease * 0.5 * k,
    y = (i: number) => at(g.s.anc, i * 3 + 1);
  const over = (i: number) =>
    band0 === null
      ? 0
      : (Math.max(...waists.map((w) => w.ease ?? 0)) + 0.005) *
        k *
        smooth(band0 + 0.02 * k, band0 - 0.01 * k, y(i));
  snug(
    g.s,
    (i) =>
      smooth(m.neck[1] - 0.075 * k, m.neck[1] - 0.005 * k, y(i)) *
      (1 - smooth(0.2, 0.6, g.s.value("wArm", i))),
    near,
    least,
  );
  const sleeve = num(layer, "sleeve");
  if (sleeve < 0.3)
    snug(
      g.s,
      (i) => smooth(0.03, 0.25, g.s.value("wArm", i)) * smooth(0.3, 0.15, sleeve),
      near,
      least,
    );
  const gather = num(layer, "gather"),
    hemBand = num(layer, "hemBand");
  if (gather)
    snug(
      g.s,
      (i) =>
        gather *
        smooth(hem + (mm(hemBand) + 0.13) * k, hem + mm(hemBand) * 0.6 * k, y(i)) *
        (1 - smooth(0.2, 0.6, g.s.value("wArm", i))),
      (i) => near + over(i),
      (i) => least + over(i),
    );
  const thickness = material === "leather" ? 0.006 : 0.004;
  clear(g.s, shellsOf(worn), thickness + 0.0015 * k);
  const piece = new Piece().shell(g.s, { thickness }),
    rise = (stiff > 0.5 ? 0.0025 : 0.0018) * k;
  const cuff = num(layer, "cuff");
  if (cuff) for (const loop of g.sleeves) band(piece, g.s, loop, { width: mm(cuff) * k, rise });
  if (hemBand) band(piece, g.s, g.lower, { width: mm(hemBand) * k, rise });
  if (collarKind === "none" && neckKind !== "high")
    band(piece, g.s, g.upper, { width: 0.013 * k, rise });
  const tuckedCollar = later.some(
    (outer) => outer.piece === "top" && outer["neck"] === "high" && outer["collar"] === "stand",
  );
  if (collarKind === "shirt" && !tuckedCollar)
    collar(piece, g.s, g.upper, m, stiff > 0.5 ? { stand: 0.02, fall: 0.042 } : {});
  if (collarKind === "stand")
    collar(piece, g.s, g.upper, m, { kind: "stand", stand: openPlate ? 0.022 : 0.04 });
  const cast = caster([g.s]);
  if (collarKind === "hood") hood(piece, g.s, g.upper, m, cast);
  const front = str(layer, "front"),
    topY = m.neck[1] - (neckKind === "v" ? depth + 0.02 : 0.045) * k,
    trim = new Piece();
  if (front !== "plain" && topY > hem + 0.08 * k) {
    const zip = front === "zip";
    patch(piece, cast, body, {
      centre: [0, (topY + hem) / 2, m.chest[2]],
      facing: [0, 0, 1],
      across: [1, 0, 0],
      width: (zip ? 0.024 : 0.032) * k,
      height: topY - hem,
      rise: 0.004 * k,
      nx: 2,
      ny: 26,
    });
    if (zip) {
      patch(trim, cast, body, {
        centre: [0, (topY + hem) / 2, m.chest[2]],
        facing: [0, 0, 1],
        across: [1, 0, 0],
        width: 0.008 * k,
        height: topY - hem - 0.01 * k,
        rise: 0.0065 * k,
        nx: 1,
        ny: 26,
      });
      patch(trim, cast, body, {
        centre: [0, topY - 0.012 * k, m.chest[2]],
        facing: [0, 0, 1],
        across: [1, 0, 0],
        width: 0.011 * k,
        height: 0.026 * k,
        rise: 0.007 * k,
        nx: 1,
        ny: 2,
      });
    } else if (front === "buttons") {
      const count = Math.round(num(layer, "buttons"));
      for (let i = 0; i < count; i++)
        button(trim, cast, body, {
          centre: [
            0,
            mix(topY - 0.03 * k, hem + 0.04 * k, count === 1 ? 0 : i / (count - 1)),
            m.chest[2],
          ],
          facing: [0, 0, 1],
          radius: 0.0075 * k,
          rise: 0.0075 * k,
        });
    }
  }
  const pockets = str(layer, "pockets");
  if (pockets.includes("chest"))
    for (const sign of stiff > 0.5 ? [1, -1] : [1])
      pocket(piece, cast, body, m, {
        x: sign * 0.088 * k,
        y: m.chest[1] + 0.1 * k,
        width: 0.095,
        height: 0.1,
        flap: stiff > 0.5,
      });
  if (pockets.includes("hip") && hem < m.waist - 0.1 * k)
    for (const sign of [1, -1])
      pocket(piece, cast, body, m, {
        x: sign * 0.1 * k,
        y: Math.max(hem + 0.09 * k, m.waistband - 0.03 * k),
        width: 0.13,
        height: 0.13,
        flap: false,
      });
  parts.push(
    part(
      piece,
      str(layer, "color"),
      "spine_03",
      collarKind === "hood" ? "Hooded top" : stiff > 0.5 ? "Jacket" : "Top",
      material,
    ),
  );
  if (trim.tri.length)
    parts.push(
      part(trim, str(layer, "trim"), "spine_03", front === "zip" ? "Zip" : "Buttons", "metal"),
    );
  return { parts, covers: [g.s], worn: { kind: "top", shell: g.s, ease } };
}

function trousers(
  body: DressBody,
  m: Landmarks,
  layer: TailorLayer,
  worn: ReadonlyArray<Worn>,
  later: ReadonlyArray<TailorLayer>,
): Made {
  const k = m.k,
    waist = mix(m.belly, m.waist, num(layer, "rise")),
    boots = worn.find((w) => w.kind === "boots"),
    length = num(layer, "length"),
    fit = num(layer, "fit"),
    ease = mm(num(layer, "ease"));
  const tucked = later.find((l) => l.piece === "boots" && num(l, "height") < length);
  const g = garment(body, m, {
    waist,
    leg: length,
    ease,
    taper: 0.03 * 300 ** fit,
    flare: fit > 0.6 ? 4 : mix(0.8, 4, fit / 0.6),
    legEase:
      boots && length > (boots.height ?? 0) ? Math.max(0, (boots.ease ?? 0) + 0.004 - ease) : 0,
    passes: fit > 0.8 ? 3 : 6,
    under: shellsOf(worn),
  });
  if (tucked) {
    const height = num(tucked, "height");
    snug(
      g.s,
      (i) =>
        smooth(height - 0.1, height + 0.03, g.s.value("leg", i)) *
        smooth(0.3, 0.7, g.s.value("wLeg", i)),
      0.0012 * k,
      0.0012 * k,
    );
  }
  const material = str(layer, "material"),
    thickness = material === "leather" ? 0.006 : 0.004;
  clear(g.s, shellsOf(worn), thickness + 0.0015 * k);
  const piece = new Piece().shell(g.s, { thickness });
  const waistband = num(layer, "waistband"),
    hemBand = num(layer, "hemBand"),
    pockets = str(layer, "pockets");
  if (waistband) band(piece, g.s, g.upper, { width: mm(waistband) * k, rise: 0.002 * k });
  if (hemBand)
    for (const loop of g.legs) band(piece, g.s, loop, { width: mm(hemBand) * k, rise: 0.002 * k });
  const cast = caster([g.s]);
  if (pockets.includes("back"))
    for (const sign of [1, -1])
      pocket(piece, cast, body, m, {
        x: sign * 0.078 * k,
        y: m.hip + 0.025 * k,
        z: m.pelvis[2],
        facing: [sign * 0.3, 0, -1],
        across: [1, 0, sign * 0.3],
        width: 0.115,
        height: 0.12,
        flap: false,
        rise: 0.002,
      });
  if (pockets.includes("cargo") && length > 0.9)
    for (const sign of [1, -1]) {
      const hip = body.joint(sign > 0 ? "thigh_l" : "thigh_r"),
        knee = body.joint(sign > 0 ? "calf_l" : "calf_r"),
        on = (d: 0 | 1 | 2) => mix(hip[d], knee[d], 0.62);
      pocket(piece, cast, body, m, {
        x: on(0),
        y: on(1),
        z: on(2),
        facing: [sign, 0, 0],
        across: [0, 0, 1],
        width: 0.13,
        height: 0.15,
        rise: 0.006,
      });
    }
  return {
    parts: [
      part(piece, str(layer, "color"), "pelvis", length < 1.2 ? "Shorts" : "Trousers", material),
    ],
    covers: [g.s],
    worn: { kind: "trousers", shell: g.s, ease, length, waist },
  };
}

function footwear(body: DressBody, m: Landmarks, layer: TailorLayer, tall: boolean): Made {
  const parts: TailoredPart[] = [],
    covers: Shell[] = [],
    k = m.k,
    name = tall ? "Boot" : "Shoe",
    material = str(layer, "material");
  let ground = body.floor;
  const ease = tall ? mm(num(layer, "ease")) : 0;
  for (const side of ["l", "r"]) {
    const made = shoe(body, m, side, {
      collar: tall ? 0.1 : mm(num(layer, "collar")),
      sole: mm(num(layer, "thick")),
      heel: mm(num(layer, "heel")),
      toe: mm(num(layer, "toe")),
      ease: tall ? Math.max(0.005, ease - 0.001) : 0.005,
    });
    parts.push(part(made.upper, str(layer, "color"), "foot_" + side, name, material), {
      ...part(made.sole, str(layer, "sole"), "foot_" + side, name + " sole", "leather"),
      ground: made.ground,
    });
    ground = Math.min(ground, made.ground);
    if (!tall) continue;
    const leg = shaft(body, m, side, {
        from: num(layer, "height"),
        ease,
        taper: 0.03 * 300 ** (1 - num(layer, "straight")),
        foot: 0.05,
      }),
      fit = Math.max(0.005, ease - 0.001) * k;
    snug(
      leg.s,
      (i) => smooth(body.floor + 0.2 * k, body.floor + 0.1 * k, at(leg.s.anc, i * 3 + 1)),
      fit + 0.0015 * k,
      fit,
    );
    const piece = new Piece().shell(leg.s);
    covers.push(leg.s);
    const cuff = num(layer, "cuff");
    if (cuff) {
      const meanY = (loop: ReadonlyArray<number>) =>
        loop.reduce((t, i) => t + at(leg.s.pos, i * 3 + 1), 0) / loop.length;
      band(
        piece,
        leg.s,
        leg.all.reduce<number[] | null>(
          (best, loop) => (!best || meanY(loop) > meanY(best) ? loop : best),
          null,
        ),
        { width: mm(cuff) * k, rise: 0.003 * k },
      );
    }
    parts.push(part(piece, str(layer, "color"), "calf_" + side, "Boot shaft", material));
    if (str(layer, "fastening") === "buckled") {
      const { leather, metal } = bootFastenings(body, m, side, leg.s);
      if (leather.count)
        parts.push(
          part(leather, str(layer, "sole"), "calf_" + side, "Boot straps", "leather"),
          part(metal, "#a69574", "calf_" + side, "Boot buckles", "metal"),
        );
    }
  }
  return {
    parts,
    covers,
    worn: {
      kind: tall ? "boots" : "shoes",
      height: tall ? num(layer, "height") : 2,
      ease,
      shafts: covers,
    },
    ground,
  };
}

function gloves(body: DressBody, m: Landmarks, layer: TailorLayer): Made {
  const parts: TailoredPart[] = [],
    covers: Shell[] = [];
  for (const side of ["l", "r"]) {
    const glove = sleeveGuard(body, m, side, {
        from: num(layer, "from"),
        ease: mm(num(layer, "ease")),
        passes: 3,
      }),
      piece = new Piece().shell(glove.s);
    covers.push(glove.s);
    const cuff = num(layer, "cuff");
    if (cuff)
      for (const loop of glove.all)
        band(piece, glove.s, loop, { width: mm(cuff) * m.k, rise: 0.003 * m.k });
    parts.push(part(piece, str(layer, "color"), "hand_" + side, "Glove", str(layer, "material")));
  }
  return { parts, covers, worn: { kind: "gloves" } };
}

function waistBelt(
  body: DressBody,
  m: Landmarks,
  layer: TailorLayer,
  worn: ReadonlyArray<Worn>,
): Made {
  const k = m.k,
    shells = shellsOf(worn),
    parts: TailoredPart[] = [];
  if (!shells.length) return { parts, worn: { kind: "belt" } };
  const y = mix(m.waistband - 0.008 * k, m.waist - 0.01 * k, num(layer, "at")),
    strap = new Piece(),
    height = mm(num(layer, "height"));
  const env = belt(strap, body, m, shells, y, { height, buckle: false });
  const region = y > mix(m.waistband, m.waist, 0.5) ? "spine_01" : "pelvis";
  parts.push(part(strap, str(layer, "color"), region, "Belt", str(layer, "material")));
  if (str(layer, "buckle") === "frame") {
    const metal = new Piece(),
      p = env.point(0.05 * k, 0, env.sample(0.05 * k, 0) + 0.0075 * k),
      skin = body.skinAt(p),
      h = height * k * 0.62,
      w = 0.021 * k,
      t = 0.0035 * k;
    for (const [dx, dy, sx, sy] of [
      [0, h, w + t, t],
      [0, -h, w + t, t],
      [w, 0, t, h],
      [-w, 0, t, h],
      [0, 0, t * 0.8, h],
    ] as const)
      box(
        metal,
        [p[0] + dx, p[1] + dy, p[2]],
        [
          [sx, 0, 0],
          [0, sy, 0],
          [0, 0, t],
        ],
        skin,
      );
    parts.push(part(metal, str(layer, "trim"), region, "Buckle", "metal"));
  }
  return { parts, worn: { kind: "belt" } };
}

function make(
  body: DressBody,
  m: Landmarks,
  layer: TailorLayer,
  worn: ReadonlyArray<Worn>,
  later: ReadonlyArray<TailorLayer>,
): Made {
  switch (layer.piece) {
    case "top":
      return top(body, m, layer, worn, later);
    case "trousers":
      return trousers(body, m, layer, worn, later);
    case "boots":
      return footwear(body, m, layer, true);
    case "shoes":
      return footwear(body, m, layer, false);
    case "gloves":
      return gloves(body, m, layer);
    case "belt":
      return waistBelt(body, m, layer, worn);
    default:
      throw new Error("Unknown outfit piece.");
  }
}

export interface TailoredParts {
  readonly parts: ReadonlyArray<TailoredPart>;
  readonly ground: number;
  readonly hidden: ReadonlySet<number>;
}

export function tailorParts(body: DressBody, m: Landmarks, tailor: Tailor): TailoredParts {
  if (tailorProblems(tailor).length) throw new Error("Unknown or out-of-range outfit piece.");
  const parts: TailoredPart[] = [],
    worn: Worn[] = [],
    all: Made[] = [];
  let ground = body.floor;
  const layers = tailor.layers.map((layer) => tailorLayer(layer.piece, layer));
  for (const layer of layers) {
    const made = make(body, m, layer, worn, layers.slice(worn.length + 1));
    parts.push(...made.parts);
    worn.push(made.worn);
    all.push(made);
    if (made.ground !== undefined) ground = Math.min(ground, made.ground);
  }
  return { parts, ground, hidden: conceal(body, all) };
}

export interface TailoredMesh extends DressMesh {
  readonly type: string;
  readonly tone: string;
  readonly shoeUV?: ReadonlyArray<number>;
}

export interface Tailored {
  readonly meshes: ReadonlyArray<TailoredMesh>;
  readonly ground: number;
  readonly hidden: ReadonlySet<number>;
  readonly landmarks: Landmarks;
}

export interface TailorFinish {
  readonly raster: Raster;
  readonly style: ClothStyle;
}

export function tailorHuman(
  surface: HumanSurface,
  tailor: Tailor,
  material: (tone: string, type: string) => T.Material,
  finish?: TailorFinish,
): Tailored {
  const body = analyse(surface),
    m = landmarks(body),
    made = tailorParts(body, m, tailor),
    meshes: TailoredMesh[] = [];
  for (const p of made.parts)
    if (p.piece.tri.length) {
      const mesh = p.piece.mesh(
        material(p.tone, p.type === "mail" ? "cloth" : p.type),
        p.region,
        p.name,
      );
      if (finish) finishFootwear(finish.raster, mesh.mesh, p.piece.shoeUV);
      mesh.mesh.userData["styleType"] = p.type;
      meshes.push({
        ...mesh,
        type: p.type,
        tone: p.tone,
        ...(p.piece.shoeUV ? { shoeUV: p.piece.shoeUV } : {}),
      });
    }
  if (finish)
    finishTailored(
      finish.raster,
      meshes.map((t) => t.mesh),
      finish.style,
      m,
    );
  return { meshes, ground: made.ground, hidden: made.hidden, landmarks: m };
}
