import { mantle, type MantlePattern } from "./mantle.js";
import * as T from "three";
import type { Raster } from "../../raster.js";
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
  hood,
  landmarks,
  patch,
  plate,
  roll,
  shaft,
  shoe,
  sleeveGuard,
  type Garment,
  type GarmentOptions,
} from "./cloth.js";
import type { Ray } from "../../game/raycast.js";
import {
  Piece,
  Shell,
  analyse,
  dot,
  loops,
  mix,
  smooth,
  sub,
  type DressBody,
  type DressMesh,
  type Landmarks,
  type Skin,
  type Vec,
} from "./kit.js";
import { finishFootwear } from "./shoe-finish.js";
import { apron, backpack, cape, helmet, pod } from "./gear.js";
import { skirt } from "./skirt.js";
import type { OutfitPattern } from "./outfit-names.js";

export interface OutfitPart {
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
): OutfitPart => ({
  piece,
  tone,
  region,
  name,
  type,
});

function shoes(
  body: DressBody,
  m: Landmarks,
  parts: OutfitPart[],
  o: Parameters<typeof shoe>[3] = {},
  tone = "leather",
  soleTone = "sole",
  name = "Shoe",
): void {
  for (const side of ["l", "r"]) {
    const made = shoe(body, m, side, o);
    parts.push(part(made.upper, tone, "foot_" + side, name, "leather"));
    parts.push({
      ...part(made.sole, soleTone, "foot_" + side, name + " sole", "leather"),
      ground: made.ground,
    });
  }
}

function boots(
  body: DressBody,
  m: Landmarks,
  parts: OutfitPart[],
  {
    from = 1.5,
    ease = 0.011,
    cuff = 0.04,
    ...o
  }: Parameters<typeof shoe>[3] & {
    readonly from?: number;
    readonly cuff?: number;
  } = {},
  tone = "leather",
): Shell[] {
  const shafts: Shell[] = [];
  shoes(body, m, parts, { collar: 0.1, sole: 0.015, heel: 0.008, ...o }, tone, "sole", "Boot");
  for (const side of ["l", "r"]) {
    const leg = shaft(body, m, side, { from, ease, foot: 0.07 }),
      piece = new Piece().shell(leg.s);
    if (cuff) band(piece, leg.s, highest(leg), { width: cuff * m.k, rise: 0.003 * m.k });
    parts.push(part(piece, tone, "calf_" + side, "Boot shaft", "leather"));
    if (cuff) {
      const { leather, metal } = bootFastenings(body, m, side, leg.s);
      if (leather.count)
        parts.push(
          part(leather, "sole", "calf_" + side, "Boot straps", "leather"),
          part(metal, "metal", "calf_" + side, "Boot buckles", "metal"),
        );
    }
    shafts.push(leg.s);
  }
  return shafts;
}
const meanY = (s: Shell, loop: ReadonlyArray<number>) =>
  loop.reduce((t, i) => t + (s.pos[i * 3 + 1] ?? 0), 0) / loop.length;
const highest = (g: { readonly s: Shell; readonly all: ReadonlyArray<ReadonlyArray<number>> }) =>
  g.all.reduce<ReadonlyArray<number> | null>(
    (best, loop) => (!best || meanY(g.s, loop) > meanY(g.s, best) ? loop : best),
    null,
  );

function finish(
  g: Garment,
  k: number,
  o: {
    readonly neck?: number;
    readonly cuff?: number;
    readonly hem?: number;
    readonly legs?: number;
    readonly waist?: number;
    readonly rise?: number;
    readonly thickness?: number;
  } = {},
): Piece {
  const { neck = 0, cuff = 0, hem = 0, legs = 0, waist = 0, rise = 0.0015, thickness } = o;
  const piece = new Piece().shell(g.s, thickness === undefined ? {} : { thickness });
  if (neck) band(piece, g.s, g.upper, { width: neck * k, rise: rise * k });
  if (waist) band(piece, g.s, g.upper, { width: waist * k, rise: rise * k });
  if (hem) band(piece, g.s, g.lower, { width: hem * k, rise: rise * k });
  if (cuff)
    for (const loop of g.sleeves) band(piece, g.s, loop, { width: cuff * k, rise: rise * k });
  if (legs) for (const loop of g.legs) band(piece, g.s, loop, { width: legs * k, rise: rise * k });
  return piece;
}

function front(
  piece: Piece,
  cast: Ray,
  body: DressBody,
  m: Landmarks,
  {
    top,
    bottom,
    width = 0.032,
    rise = 0.004,
    buttons = 0,
    x = 0,
    buttonTone = null,
  }: {
    readonly top: number;
    readonly bottom: number;
    readonly width?: number;
    readonly rise?: number;
    readonly buttons?: number;
    readonly x?: number;
    readonly buttonTone?: string | null;
  },
): Piece {
  const k = m.k;
  patch(piece, cast, body, {
    centre: [x, (top + bottom) / 2, m.chest[2]],
    facing: [0, 0, 1],
    across: [1, 0, 0],
    width: width * k,
    height: top - bottom,
    rise: rise * k,
    nx: 2,
    ny: 26,
  });
  const studs = buttonTone ? new Piece() : piece;
  for (let i = 0; i < buttons; i++)
    button(studs, cast, body, {
      centre: [
        x,
        mix(top - 0.03 * k, bottom + 0.04 * k, buttons === 1 ? 0 : i / (buttons - 1)),
        m.chest[2],
      ],
      facing: [0, 0, 1],
      radius: 0.0075 * k,
      rise: (rise + 0.0035) * k,
    });
  return studs;
}

function pocket(
  piece: Piece,
  cast: Ray,
  body: DressBody,
  m: Landmarks,
  {
    x,
    y,
    width = 0.1,
    height = 0.11,
    facing = [0, 0, 1],
    across = [1, 0, 0],
    flap = true,
    rise = 0.0045,
    z = m.chest[2],
    skin = (p: Vec): Skin => body.trunkAt(p),
  }: {
    readonly x: number;
    readonly y: number;
    readonly width?: number;
    readonly height?: number;
    readonly facing?: Vec;
    readonly across?: Vec;
    readonly flap?: boolean;
    readonly rise?: number;
    readonly z?: number;
    readonly skin?: (p: Vec) => Skin;
  },
): void {
  const k = m.k,
    centre: Vec = [x, y, z];
  const depth = (dy: number) => {
    const o = [x - facing[0] * 0.6, y + dy - facing[1] * 0.6, z - facing[2] * 0.6];
    return cast(
      [
        (o[0] ?? 0) + 2 * facing[0] * 0.6,
        (o[1] ?? 0) + 2 * facing[1] * 0.6,
        (o[2] ?? 0) + 2 * facing[2] * 0.6,
      ],
      [-facing[0], -facing[1], -facing[2]],
    );
  };
  const top = depth(height * k * 0.5),
    mid = depth(0),
    low = depth(-height * k * 0.5);
  if (
    ![top, mid, low].every(Number.isFinite) ||
    Math.abs(top - low) > height * k * 0.25 ||
    (top + low) / 2 - mid > 0.005 * k
  )
    return;
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
      rise: (rise + 0.004) * k,
      ny: 2,
      skin,
    });
}

function jeans(
  body: DressBody,
  m: Landmarks,
  o: GarmentOptions = {},
): { g: Garment; piece: Piece } {
  const k = m.k,
    g = garment(body, m, { waist: m.waistband, taper: 0.07, ease: 0.008, ...o }),
    piece = finish(g, k, { waist: 0.032, legs: 0.014, rise: 0.002 });
  return { g, piece };
}

function cargoPockets(piece: Piece, g: Garment, body: DressBody, m: Landmarks): void {
  const cast = caster([g.s]);
  for (const sign of [1, -1]) {
    const hip = body.joint(sign > 0 ? "thigh_l" : "thigh_r"),
      knee = body.joint(sign > 0 ? "calf_l" : "calf_r");
    pocket(piece, cast, body, m, {
      x: mix(hip[0], knee[0], 0.62),
      y: mix(hip[1], knee[1], 0.62),
      z: mix(hip[2], knee[2], 0.62),
      facing: [sign, 0, 0],
      across: [0, 0, 1],
      width: 0.13,
      height: 0.15,
      rise: 0.006,
    });
  }
}

function backPockets(piece: Piece, g: Garment, body: DressBody, m: Landmarks): void {
  const cast = caster([g.s]);
  for (const sign of [1, -1])
    pocket(piece, cast, body, m, {
      x: sign * 0.078 * m.k,
      y: m.hip + 0.025 * m.k,
      facing: [sign * 0.3, 0, -1],
      across: [1, 0, sign * 0.3],
      width: 0.115,
      height: 0.12,
      flap: false,
      rise: 0.002,
      z: m.pelvis[2],
    });
}

const overWaist =
  (m: Landmarks, room: number) =>
  (y: number): number =>
    room * smooth(m.waistband + 0.04 * m.k, m.waistband + 0.012 * m.k, y);

function buckle(
  piece: Piece,
  body: DressBody,
  m: Landmarks,
  shells: ReadonlyArray<Shell>,
  y: number,
  height = 0.034,
): void {
  const probe = new Piece(),
    k = m.k,
    env = belt(probe, body, m, shells, y, { height, buckle: false });
  const p = env.point(0.05 * k, 0, env.sample(0.05 * k, 0) + 0.0075 * k),
    skin = body.trunkAt(p),
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
      piece,
      [p[0] + dx, p[1] + dy, p[2]],
      [
        [sx, 0, 0],
        [0, sy, 0],
        [0, 0, t],
      ],
      skin,
    );
}

function surfaceOf(piece: Piece): Shell {
  const s = new Shell();
  s.pos = piece.pos;
  s.tri = piece.tri;
  return s;
}

type Outfit = (body: DressBody, m: Landmarks) => OutfitPart[];

function wayfarer(body: DressBody, m: Landmarks, hooded: boolean) {
  const parts: OutfitPart[] = [],
    k = m.k,
    seam = m.waist - 0.01 * k;
  const legs = garment(body, m, { waist: m.waistband, leg: 1.6, ease: 0.009, taper: 0.25 });
  parts.push(part(new Piece().shell(legs.s), "dark", "pelvis", "Breeches"));
  const tunic = garment(body, m, {
    sleeve: 1.93,
    hem: seam - 0.03 * k,
    ease: 0.012,
    fall: 0.15,
    tension: 1,
    span: 2.2,
    sleeveFall: 0.2,
    sleeveEase: 0.004,
    passes: 7,
    neck: { v: 0.06 },
  });
  const tails = skirt(body, m, {
    top: seam + 0.012 * k,
    bottom: m.crotch - (hooded ? 0.2 : 0.13) * k,
    ease: 0.014,
    flare: 0.13,
    fold: 0.008,
    folds: 9,
    shells: [tunic.s, legs.s],
  });
  parts.push(
    part(finish(tunic, k, { neck: 0.016, cuff: 0.034, rise: 0.003 }), "main", "spine_03", "Tunic"),
    part(tails.piece, "main", "pelvis", "Tunic skirt"),
  );
  const leather = new Piece(),
    metal = new Piece();
  belt(leather, body, m, [tunic.s], seam, { height: 0.056, thick: 0.005, buckle: false });
  buckle(metal, body, m, [tunic.s], seam, 0.056);
  const env = belt(leather, body, m, [tunic.s, surfaceOf(tails.piece)], seam - 0.05 * k, {
    height: 0.02,
    thick: 0.005,
    buckle: false,
  });
  const at = env.point(
    0.05 * k + 0.045 * k,
    hooded ? -1.1 : 1.1,
    env.sample(0.05 * k, hooded ? -1.1 : 1.1) + 0.03 * k,
  );
  pod(
    leather,
    at,
    [
      [0.042 * k, 0, -0.02 * k * (hooded ? -1 : 1)],
      [0, 0.052 * k, 0],
      [0.012 * k, 0, 0.024 * k],
    ],
    body.rigid("pelvis"),
    { power: 3.2 },
  );
  parts.push(part(leather, "leather", "spine_01", "Belts and pouch", "leather"));
  const elbow = body.joint("lowerarm_l")[1];
  const fall = (y: number) => m.neck[1] - y;
  const shape: MantlePattern = hooded
    ? {
        drop: (a) =>
          Math.min(
            mix(fall(m.waist) + 0.03 * k, fall(m.hip) + 0.04 * k, smooth(0.5, 2.6, a)),
            mix(fall(elbow) - 0.01 * k, 9, smooth(0.5, 1.15, Math.abs(a - 1.45))),
          ),
        open: (v) => 0.05 + 0.34 * v ** 1.5,
        facing: 0.07,
        fold: 0.012,
        armLow: elbow - 0.01 * k,
      }
    : {
        drop: (a) =>
          mix(fall(m.chest[1]) + 0.12 * k, fall(m.knee) + 0.14 * k, smooth(1.45, 1.95, a)),
        open: (v) => 0.1 + 0.9 * v ** 1.3,
        facing: 0.09,
        fold: 0.014,
        armLow: elbow + 0.05 * k,
        split: 0.3,
        flare: 0.06,
      };
  const cloak = mantle(body, m, [tunic.s, surfaceOf(tails.piece)], shape);
  if (hooded)
    hood(cloak.cloth, body, [tunic.s, surfaceOf(cloak.cloth)], tunic.s, tunic.upper, m, {
      length: 0.2,
      thick: 0.026,
      stand: 0.022,
      front: 0.5,
    });
  parts.push(
    part(cloak.cloth, "accent", "spine_03", hooded ? "Shoulder cloak" : "Split mantle"),
    part(cloak.lining, "light", "spine_03", "Mantle lining"),
  );
  const skinAt = body.rigid("spine_03");
  for (const v of hooded ? [0.1, 0.3] : [0.09]) {
    const a = cloak.at(v, 1, 0.006 * k),
      b = cloak.at(v, -1, 0.006 * k),
      mid: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.max(a[2], b[2]) + 0.004 * k],
      wide = Math.abs(a[0] - b[0]) / 2;
    for (const q of [a, b])
      pod(
        metal,
        [q[0], q[1], q[2] + 0.002 * k],
        [
          [(hooded ? 0.011 : 0.019) * k, 0, 0],
          [0, (hooded ? 0.011 : 0.019) * k, 0],
          [0, 0, 0.006 * k],
        ],
        skinAt,
        { power: 2.2, rings: 6, around: 12 },
      );
    box(
      hooded ? leather : metal,
      mid,
      [
        [wide, 0, 0],
        [0, (hooded ? 0.006 : 0.004) * k, 0],
        [0, 0, 0.003 * k],
      ],
      skinAt,
    );
  }
  parts.push(part(metal, "metal", "spine_03", "Clasp and buckle", "metal"));
  boots(body, m, parts, { from: hooded ? 1.42 : 1.26, cuff: 0.05, ease: 0.016 });
  return parts;
}

function garmentSheet(skin: (p: Vec) => Skin) {
  return (
    piece: Piece,
    rows: number,
    cols: number,
    point: (u: number, v: number) => Vec,
    relief?: (u: number, v: number) => number,
  ) => {
    const base = piece.count;
    const grid = Array.from({ length: rows + 1 }, (_, i) =>
      Array.from({ length: cols + 1 }, (_, j) => point(j / cols, i / rows)),
    );
    piece.loft(grid, skin, { closed: false, flip: true });
    if (relief) {
      const heights = Float32Array.from({ length: (rows + 1) * (cols + 1) }, (_, i) =>
        relief((i % (cols + 1)) / cols, Math.floor(i / (cols + 1)) / rows),
      );
      piece.foldBands.push([base, heights]);
      piece.draped = true;
    }
  };
}

function bomber(body: DressBody, m: Landmarks, rolled: boolean) {
  const parts: OutfitPart[] = [],
    k = m.k,
    waist = m.waist + 0.012 * k;
  const legs = garment(body, m, {
    waist,
    leg: rolled ? 1.84 : 1.98,
    ease: 0.015,
    legEase: rolled ? 0.02 : 0.028,
    taper: 0.012,
    flare: 4,
    soft: 12,
    folds: 0.45,
  });
  const lower = finish(legs, k, { waist: 0.046, legs: rolled ? 0.07 : 0.055, rise: 0.0035 }),
    cast = caster([legs.s]);
  for (const sign of [1, -1])
    pocket(lower, cast, body, m, {
      x: sign * 0.062 * k,
      y: m.waist - 0.09 * k,
      width: 0.012,
      height: 0.15,
      flap: false,
      rise: 0.004,
      z: m.pelvis[2],
    });
  parts.push(part(lower, "dark", "pelvis", rolled ? "Cuffed wide trousers" : "Wide trousers"));
  const tee = garment(body, m, {
    sleeve: 0.3,
    hem: waist - 0.03 * k,
    ease: 0.005,
    neck: rolled ? { scoop: 0.04, scoopWidth: 0.07 } : {},
  });
  parts.push(part(finish(tee, k, { neck: 0.012 }), "light", "spine_03", "Tucked top"));
  const leather = new Piece(),
    metal = new Piece();
  belt(leather, body, m, [legs.s, tee.s], waist - 0.024 * k, {
    height: 0.03,
    thick: 0.004,
    buckle: false,
  });
  buckle(metal, body, m, [legs.s, tee.s], waist - 0.024 * k, 0.03);
  parts.push(
    part(leather, "leather", "pelvis", "Belt", "leather"),
    part(metal, "metal", "pelvis", "Buckle", "metal"),
  );
  const jacket = garment(body, m, {
    sleeve: rolled ? 1.22 : 1.93,
    hem: waist - 0.012 * k,
    ease: 0.03,
    gap: 0.012,
    fall: 0.05,
    tension: 1,
    span: 3,
    sleeveFall: 0.06,
    sleeveEase: 0.008,
    passes: 10,
    neck: { v: rolled ? 0.2 : 0.26, height: 0.012 },
    under: [tee.s, legs.s],
  });
  const shell = new Piece().shell(jacket.s, { thickness: 0.006 }),
    ribs = new Piece();
  const edge = jacket.lower;
  if (edge) {
    const points = edge.map((i) => jacket.s.at(i));
    const centre = points
      .reduce((sum, p) => [(sum[0] ?? 0) + p[0], (sum[1] ?? 0) + p[2]], [0, 0])
      .map((x) => x / points.length);
    const ring = (down: number, gather: number) =>
      points.map(([x, y, z]): Vec => [
        (centre[0] ?? 0) + (x - (centre[0] ?? 0)) * gather,
        y - down * k,
        (centre[1] ?? 0) + (z - (centre[1] ?? 0)) * gather,
      ]);
    const signedArea = points.reduce((sum, p, i) => {
      const next = points[(i + 1) % points.length] ?? p;
      return sum + p[0] * next[2] - p[2] * next[0];
    }, 0);
    ribs.loft(
      [
        ring(-0.003, 0.99),
        ring(0.001, 1.002),
        ring(0.022, 0.988),
        ring(0.043, 0.966),
        ring(0.043, 0.94),
      ],
      (_p, _row, j) => jacket.s.skin(edge[j] ?? 0),
      { flip: signedArea > 0 },
    );
  }
  band(ribs, jacket.s, jacket.upper, { width: 0.03 * k, rise: 0.0045 * k });
  for (const loop of jacket.sleeves)
    band(ribs, jacket.s, loop, {
      width: (rolled ? 0.06 : 0.05) * k,
      rise: (rolled ? 0.007 : 0.0045) * k,
    });
  const on = caster([jacket.s]);
  for (const sign of [1, -1])
    pocket(shell, on, body, m, {
      x: sign * 0.105 * k,
      y: m.chest[1] - 0.015 * k,
      width: 0.03,
      height: 0.12,
      flap: false,
      rise: 0.004,
      across: [1, sign * 0.35, 0],
    });
  parts.push(
    part(shell, "main", "spine_03", rolled ? "Rolled-sleeve bomber" : "Short bomber"),
    part(ribs, "accent", "spine_03", "Ribbing"),
  );
  if (rolled)
    shoes(body, m, parts, { collar: 0.05, sole: 0.012, heel: 0.014 }, "leather", "sole", "Loafer");
  else
    shoes(
      body,
      m,
      parts,
      { collar: 0.066, sole: 0.024, toe: 0.004 },
      "light",
      "light",
      "Chunky trainer",
    );
  return parts;
}

function bodiced(body: DressBody, m: Landmarks, draped: boolean) {
  const parts: OutfitPart[] = [],
    k = m.k,
    seam = m.waist - 0.02 * k;
  const bodice = garment(body, m, {
    sleeve: draped ? 0.46 : 0.16,
    hem: seam - 0.026 * k,
    ease: 0.007,
    fall: 0.22,
    below: 0.16,
    rise: 0.5,
    sleeveEase: draped ? 0.022 : 0,
    ...(draped ? { sleeveFall: 0.05 } : {}),
    neck: draped
      ? { height: -0.02, scoop: 0.085, scoopWidth: 0.12, wide: 0.075 }
      : { height: -0.012, scoop: 0.1, scoopWidth: 0.085, wide: 0.03 },
  });
  const top = finish(bodice, k, { neck: 0.014, cuff: draped ? 0.03 : 0.014, rise: 0.003 });
  parts.push(part(top, "main", "spine_03", "Bodice", "satin"));
  if (!draped)
    for (const sign of [1, -1]) {
      const cap = plate(
        body,
        m,
        [
          (s, i) => (s.anchor(i)[0] * sign > 0 ? 0.3 - s.value("arm", i) : -1),
          (s, i) => s.value("arm", i) + 0.05,
          (s, i) => s.anchor(i)[1] - (m.shoulder - 0.075 * k) + 10 * s.value("wArm", i),
        ],
        { ease: 0.024, passes: 12, near: body.joint(sign > 0 ? "upperarm_l" : "upperarm_r") },
      );
      const wing = new Piece().shell(cap.s, { thickness: 0.006 });
      for (const loop of cap.all) band(wing, cap.s, loop, { width: 0.012 * k, rise: 0.003 * k });
      parts.push(
        part(wing, "accent", sign > 0 ? "upperarm_l" : "upperarm_r", "Shoulder wing", "satin"),
      );
    }
  const length = draped ? m.ankle + 0.05 * k : mix(m.knee, m.ankle, 0.42);
  const lower = skirt(body, m, {
    top: seam + 0.015 * k,
    bottom: length,
    ease: 0.014,
    flare: draped ? 0.16 : 0.26,
    fold: draped ? 0.022 : 0.018,
    folds: draped ? 12 : 10,
    cols: 84,
    shells: [bodice.s],
    yoke: 0.018,
    gores: true,
    drape: draped ? { cloth: "gown", sweep: 0.21, folds: 10, calm: 0.2 } : { cloth: "gored" },
  });
  const centre = draped ? 0.55 : 0,
    spread = draped ? 0.34 : 0.5,
    edge = (v: number) => 0.05 + spread * v ** 1.25,
    face = (v: number) => 0.035 + 0.11 * v;
  const at = (v: number, a: number, lift = 0) =>
    lower.pointAt(
      0.012 + 0.988 * v,
      (((a + centre) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
      lift * k,
    );
  const sheet = garmentSheet(lower.skin);
  const reliefAt = (v: number, a: number) =>
    lower.relief(0.012 + 0.988 * v, (((a + centre) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
  const wrap = new Piece(),
    panel = new Piece(),
    facings = new Piece();
  const spans: ReadonlyArray<
    readonly [Piece, (v: number) => number, (v: number) => number, number]
  > = [
    [wrap, (v) => edge(v) + face(v), (v) => Math.PI * 2 - edge(v) - face(v), 72],
    [panel, (v) => -edge(v), edge, 22],
    [facings, edge, (v) => edge(v) + face(v), 6],
    [facings, (v) => Math.PI * 2 - edge(v) - face(v), (v) => Math.PI * 2 - edge(v), 6],
  ];
  for (const [piece, from, to, cols] of spans) {
    sheet(
      piece,
      18,
      cols,
      (u, v) => at(v, mix(from(v), to(v), u)),
      (u, v) => reliefAt(v, mix(from(v), to(v), u)),
    );
    sheet(piece, 2, cols, (u, v) => at(1 - 0.03 * v, mix(from(1), to(1), u), -0.005 * v));
  }
  if (lower.rig) for (const piece of [wrap, panel, facings]) piece.clothJoints = lower.rig;
  parts.push(
    part(
      wrap,
      draped ? "main" : "dark",
      "pelvis",
      draped ? "Draped skirt" : "Gored skirt",
      "satin",
    ),
    part(panel, "accent", "pelvis", "Skirt panel", "satin"),
    part(facings, "light", "pelvis", "Skirt facing", "satin"),
  );
  const girdle = new Piece(),
    studs = new Piece(),
    tall = draped ? 0.05 : 0.085;
  belt(girdle, body, m, [bodice.s, surfaceOf(lower.piece)], seam + (draped ? 0 : 0.014 * k), {
    height: tall,
    thick: 0.004,
    buckle: false,
  });
  const on = caster([surfaceOf(girdle)]);
  if (!draped)
    for (let i = 0; i < 4; i++)
      button(studs, on, body, {
        centre: [0, seam + 0.014 * k + mix(-0.3, 0.3, i / 3) * tall * k, m.chest[2]],
        facing: [0, 0, 1],
        radius: 0.0075 * k,
        rise: 0.005 * k,
      });
  parts.push(
    part(girdle, draped ? "accent" : "main", "spine_01", draped ? "Sash" : "Girdle", "satin"),
  );
  if (studs.tri.length) parts.push(part(studs, "metal", "spine_01", "Girdle studs", "metal"));
  if (draped)
    shoes(body, m, parts, { collar: 0.05, sole: 0.008, heel: 0.025 }, "dark", "sole", "Dress shoe");
  else
    shoes(
      body,
      m,
      parts,
      { collar: 0.11, sole: 0.01, heel: 0.024 },
      "leather",
      "sole",
      "Ankle boot",
    );
  return parts;
}

export const presetOutfits = {
  "Split mantle": (body, m) => wayfarer(body, m, false),
  "Hooded shoulder cloak": (body, m) => wayfarer(body, m, true),
  "Evening gown"(body, m) {
    const k = m.k,
      seam = m.waist - 0.027 * k,
      parts: OutfitPart[] = [];
    const bodice = garment(body, m, {
      sleeve: 0.27,
      hem: seam - 0.026 * k,
      ease: 0.008,
      fall: 0.18,
      below: 0.16,
      rise: 0.5,
      neck: { height: -0.023, scoop: 0.105, scoopWidth: 0.117, wide: 0.07 },
    });
    const top = finish(bodice, k, { neck: 0.012, cuff: 0.014 });
    parts.push(part(top, "main", "spine_03", "Evening bodice", "satin"));
    const skirtTop = seam + 0.015 * k,
      skirtEnd = m.ankle + 0.045 * k;
    const lower = skirt(body, m, {
      top: skirtTop,
      bottom: skirtEnd,
      ease: 0.013,
      flare: 0.075,
      fold: 0.031,
      folds: 8,
      cols: 84,
      shells: [bodice.s],
      yoke: 0.018,
      gores: true,
      drape: { cloth: "gown" },
    });
    const tau = Math.PI * 2;
    const angle = (u: number, v: number) => {
      const gap = 0.12 + 0.69 * v;
      return gap + u * (tau - 2 * gap) + 0.29 - 0.4 * v;
    };
    const atHip = (a: number) => 0.5 + 0.5 * Math.cos(a - 1.2);
    const fall = (a: number) => 0.71 + 0.1 * (1 - Math.cos(a)) - 0.25 * atHip(a) ** 3;
    const at = (d: number, a: number, lift = 0) => lower.pointAt(d, a, lift * k);
    const pleat = (u: number, v: number, a: number) => {
      const tuck = atHip(a);
      const gather = 0.5 + 0.5 * Math.cos(25 * v + 4 * (1 - Math.cos(a - 1.2)) - 3 * Math.sin(a));
      const swag = (0.005 + 0.017 * tuck * tuck) * gather ** 2 * Math.sin(Math.PI * v) ** 0.7;
      const hanging = (0.006 + 0.01 * v) * (1 + Math.sin(a * 7 - 1.9 * v + 0.55 * Math.sin(a * 2)));
      return (
        (swag + hanging) *
        Math.min(1, u * 22, (1 - u) * 22) *
        smooth(1, 0.93, v) *
        smooth(0, 0.13, v)
      );
    };
    const panel = (u: number, v: number) => {
      const a = angle(u, v);
      return at(0.012 * smooth(0, 0.1, v) + fall(a) * v, a, pleat(u, v, a));
    };
    const sheet = garmentSheet(lower.skin);
    const field = new Piece(),
      wrap = new Piece(),
      edging = new Piece();
    const wrapRows = 22,
      wrapColumns = 72;
    sheet(
      wrap,
      wrapRows,
      wrapColumns,
      (u, v) => panel(u, v * 0.967),
      (u, v) => {
        const a = angle(u, v * 0.967);
        return lower.relief(0.012 + fall(a) * v * 0.967, a) + (pleat(u, v * 0.967, a) - 0.012) * k;
      },
    );

    sheet(edging, 1, 72, (u, v) => panel(u, 0.967 + v * 0.033));
    sheet(
      field,
      16,
      20,
      (u, v) => {
        const left = angle(1, v) - tau,
          right = angle(0, v);
        const a = mix(left, right, u);
        return at(0.012 + v * fall(a), a);
      },
      (u, v) => {
        const a = mix(angle(1, v) - tau, angle(0, v), u);
        return lower.relief(0.012 + v * fall(a), a);
      },
    );
    for (const [start, end, cols] of [
      [angle(0, 1), angle(1, 1), 72],
      [angle(1, 1) - tau, angle(0, 1), 20],
    ] as const) {
      const hemPoint = (u: number, v: number) => {
        const a = mix(start, end, u),
          d = mix(0.012 + fall(a), 1, v);
        return at(d, a);
      };
      sheet(field, 10, cols, hemPoint, (u, v) => {
        const a = mix(start, end, u);
        return lower.relief(mix(0.012 + fall(a), 1, v), a);
      });
      sheet(field, 2, cols, (u, v) => at(1 - 0.024 * v, mix(start, end, u), -0.005 * v));
    }
    if (lower.rig) for (const piece of [field, wrap, edging]) piece.clothJoints = lower.rig;
    parts.push(
      part(field, "main", "pelvis", "Gored satin skirt", "satin"),
      part(wrap, "dark", "pelvis", "Gathered overskirt", "satin"),
      part(edging, "accent", "pelvis", "Overskirt binding", "satin"),
    );
    const sash = new Piece();
    belt(sash, body, m, [bodice.s, surfaceOf(lower.piece)], seam, {
      height: 0.047,
      thick: 0.004,
      buckle: false,
    });
    parts.push(part(sash, "dark", "spine_01", "Sash", "satin"));
    shoes(body, m, parts, { collar: 0.05, sole: 0.008, heel: 0.025 }, "dark", "sole", "Dress shoe");
    return parts;
  },
  "Bomber and wide trousers": (body, m) => bomber(body, m, false),
  "Rolled bomber and cuffed trousers": (body, m) => bomber(body, m, true),
  "Bodice and gored skirt": (body, m) => bodiced(body, m, false),
  "Draped bodice gown": (body, m) => bodiced(body, m, true),

  "T-shirt and jeans"(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k,
      lower = jeans(body, m);
    backPockets(lower.piece, lower.g, body, m);
    parts.push(part(lower.piece, "dark", "pelvis", "Jeans"));
    const tee = garment(body, m, {
      sleeve: 0.5,
      hem: m.hip - 0.02 * k,
      ease: 0.008,
      fall: 0.16,
      extra: overWaist(m, 0.006),
      under: [surfaceOf(lower.piece)],
    });
    parts.push(
      part(
        finish(tee, k, { neck: 0.013, cuff: 0.016, hem: 0.016, rise: 0.0018 }),
        "main",
        "spine_03",
        "T-shirt",
      ),
    );
    shoes(body, m, parts, { collar: 0.06, sole: 0.014 }, "light", "light", "Trainer");
    return parts;
  },
  "Hoodie and joggers"(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k;
    const legs = garment(body, m, {
      waist: m.waistband,
      leg: 1.92,
      ease: 0.013,
      taper: 0.11,
      flare: 0.8,
    });
    parts.push(part(finish(legs, k, { legs: 0.04, rise: 0.003 }), "dark", "pelvis", "Joggers"));
    const fleece = garment(body, m, {
      sleeve: 1.9,
      hem: m.hip - 0.035 * k,
      ease: 0.016,
      fall: 0.12,
      tension: 1,
      span: 2.4,
      sleeveFall: 0.1,
      sleeveEase: 0.004,
      passes: 8,
      neck: {},
      under: [legs.s],
    });
    const piece = finish(fleece, k, { cuff: 0.045, hem: 0.05, rise: 0.003 }),
      cast = caster([fleece.s]);
    hood(piece, body, [fleece.s], fleece.s, fleece.upper, m, {
      length: 0.17,
      thick: 0.024,
      stand: 0.026,
    });
    patch(piece, cast, body, {
      centre: [0, m.waist - 0.03 * k, m.chest[2]],
      facing: [0, 0, 1],
      across: [1, 0, 0],
      width: 0.27 * k,
      height: 0.13 * k,
      rise: 0.005 * k,
      nx: 8,
    });
    for (const sign of [1, -1])
      patch(piece, cast, body, {
        centre: [sign * 0.032 * k, m.neck[1] - 0.1 * k, m.chest[2]],
        facing: [0, 0, 1],
        across: [1, 0, 0],
        width: 0.006 * k,
        height: 0.12 * k,
        rise: 0.004 * k,
        nx: 1,
        ny: 8,
      });
    parts.push(part(piece, "main", "spine_03", "Hoodie"));
    shoes(body, m, parts, { collar: 0.062, sole: 0.016 }, "light", "light", "Trainer");
    return parts;
  },
  "Shirt and chinos"(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k;
    const shirt = garment(body, m, {
      sleeve: 1.42,
      hem: m.waistband - 0.03 * k,
      ease: 0.008,
      fall: 0.16,
      sleeveFall: 0.5,
      sleeveEase: 0.003,
      neck: { v: 0.05 },
    });
    const top = finish(shirt, k, { cuff: 0.04, rise: 0.004 }),
      cast = caster([shirt.s]);
    collar(top, shirt.s, shirt.upper, m, {});
    const studs = front(top, cast, body, m, {
      top: m.neck[1] - 0.05 * k,
      bottom: m.waistband,
      buttons: 5,
      buttonTone: "light",
    });
    pocket(top, cast, body, m, {
      x: 0.085 * k,
      y: m.chest[1] + 0.11 * k,
      width: 0.085,
      height: 0.09,
      flap: false,
      rise: 0.002,
    });
    parts.push(part(top, "main", "spine_03", "Shirt"), part(studs, "light", "spine_03", "Buttons"));
    const legs = garment(body, m, { waist: m.waistband + 0.012 * k, taper: 0.05, ease: 0.011 }),
      lower = finish(legs, k, { legs: 0.012 });
    backPockets(lower, legs, body, m);
    parts.push(part(lower, "dark", "pelvis", "Chinos"));
    const leather = new Piece(),
      metal = new Piece();
    belt(leather, body, m, [legs.s], m.waistband - 0.008 * k, { buckle: false });
    buckle(metal, body, m, [legs.s], m.waistband - 0.008 * k);
    parts.push(
      part(leather, "leather", "pelvis", "Belt", "leather"),
      part(metal, "metal", "pelvis", "Buckle", "metal"),
    );
    shoes(body, m, parts, { collar: 0.052, sole: 0.008, heel: 0.01 });
    return parts;
  },
  "Sweater and skirt"(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k;
    const tights = garment(body, m, {
      waist: m.waistband,
      leg: 1.97,
      ease: 0.0025,
      gap: 0.0015,
      taper: 9,
      passes: 2,
    });
    parts.push(part(new Piece().shell(tights.s, { close: false }), "dark", "pelvis", "Tights"));
    const knit = garment(body, m, {
      sleeve: 1.93,
      hem: m.waist - 0.05 * k,
      ease: 0.013,
      fall: 0.15,
      tension: 1,
      span: 2.2,
      sleeveFall: 0.15,
      passes: 8,
      neck: {},
    });
    parts.push(
      part(
        finish(knit, k, { neck: 0.028, cuff: 0.05, rise: 0.004 }),
        "main",
        "spine_03",
        "Sweater",
      ),
    );
    const lower = skirt(body, m, {
      top: m.waist + 0.005 * k,
      bottom: m.knee + 0.01 * k,
      ease: 0.01,
      flare: 0.14,
      fold: 0.007,
      shells: [tights.s, knit.s],
      yoke: 0.012,
      drape: { cloth: "skirt" },
    });
    belt(lower.piece, body, m, [knit.s, surfaceOf(lower.piece)], m.waist - 0.012 * k, {
      height: 0.04,
      thick: 0.003,
      buckle: false,
    });
    parts.push(part(lower.piece, "accent", "pelvis", "Skirt"));
    shoes(
      body,
      m,
      parts,
      { collar: 0.11, sole: 0.01, heel: 0.022 },
      "leather",
      "sole",
      "Ankle boot",
    );
    return parts;
  },
  "Day dress"(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k,
      seam = m.waist - 0.01 * k;
    const bodice = garment(body, m, {
      sleeve: 0.36,
      hem: seam - 0.02 * k,
      ease: 0.008,
      fall: 0.25,
      tension: 1,
      span: 2,
      below: 0.16,
      rise: 0.5,
      neck: { scoop: 0.07, scoopWidth: 0.08 },
    });
    const piece = finish(bodice, k, { neck: 0.01, cuff: 0.012, rise: 0.0015 });
    const lower = skirt(body, m, {
      top: seam + 0.01 * k,
      bottom: m.knee - 0.05 * k,
      ease: 0.012,
      flare: 0.24,
      fold: 0.011,
      folds: 18,
      shells: [bodice.s],
      yoke: 0.012,
      drape: { cloth: "dress" },
    });
    parts.push(
      part(piece, "main", "spine_03", "Dress bodice"),
      part(lower.piece, "main", "pelvis", "Dress skirt"),
    );
    const sash = new Piece();
    belt(sash, body, m, [bodice.s, surfaceOf(lower.piece)], seam, {
      height: 0.04,
      thick: 0.0065,
      buckle: false,
    });
    parts.push(part(sash, "dark", "spine_01", "Sash"));
    shoes(body, m, parts, { collar: 0.04, sole: 0.006, heel: 0.004 }, "dark", "sole", "Flat");
    return parts;
  },
  "Running kit"(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k;
    const shorts = garment(body, m, {
      waist: m.waistband,
      leg: 0.58,
      ease: 0.014,
      taper: 0.02,
      flare: 0.3,
    });
    parts.push(
      part(
        finish(shorts, k, { waist: 0.03, legs: 0.012, rise: 0.002 }),
        "dark",
        "pelvis",
        "Shorts",
      ),
    );
    const vest = garment(body, m, {
      sleeve: 0.06,
      hem: m.hip,
      ease: 0.009,
      fall: 0.2,
      neck: { scoop: 0.05, scoopWidth: 0.07 },
      extra: overWaist(m, 0.008),
      under: [shorts.s],
    });
    parts.push(
      part(finish(vest, k, { neck: 0.012, cuff: 0.012, hem: 0.012 }), "main", "spine_03", "Vest"),
    );
    const socks = new Piece();
    for (const side of ["l", "r"]) {
      const sock = shaft(body, m, side, { from: 1.84, ease: 0.003, taper: 9, foot: 0.05 });
      socks.shell(sock.s);
    }
    parts.push(part(socks, "light", "pelvis", "Socks"));
    shoes(body, m, parts, { collar: 0.06, sole: 0.018 }, "accent", "light", "Trainer");
    return parts;
  },
  Coveralls(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k;
    const suit = garment(body, m, {
      sleeve: 1.93,
      leg: 1.93,
      ease: 0.014,
      fall: 0.15,
      tension: 1,
      span: 2.2,
      taper: 0.035,
      sleeveFall: 0.12,
      passes: 7,
      neck: { v: 0.045 },
    });
    const piece = finish(suit, k, { cuff: 0.03, legs: 0.03, rise: 0.003 }),
      cast = caster([suit.s]);
    collar(piece, suit.s, suit.upper, m, { stand: 0.02, fall: 0.04 });
    front(piece, cast, body, m, {
      top: m.neck[1] - 0.045 * k,
      bottom: m.crotch + 0.07 * k,
      width: 0.022,
    });
    for (const sign of [1, -1])
      pocket(piece, cast, body, m, {
        x: sign * 0.09 * k,
        y: m.chest[1] + 0.1 * k,
        width: 0.1,
        height: 0.1,
      });
    cargoPockets(piece, suit, body, m);
    parts.push(part(piece, "main", "spine_03", "Coveralls"));
    const webbing = new Piece(),
      metal = new Piece();
    belt(webbing, body, m, [suit.s], m.waist - 0.01 * k, {
      height: 0.04,
      thick: 0.003,
      buckle: false,
    });
    buckle(metal, body, m, [suit.s], m.waist - 0.01 * k, 0.04);
    parts.push(
      part(webbing, "dark", "spine_01", "Belt"),
      part(metal, "metal", "spine_01", "Buckle", "metal"),
    );
    shoes(
      body,
      m,
      parts,
      { collar: 0.12, sole: 0.017, heel: 0.008, toe: 0.006 },
      "leather",
      "sole",
      "Work boot",
    );
    return parts;
  },
  "Chore jacket"(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k,
      lower = jeans(body, m, { taper: 0.035, ease: 0.012 });
    cargoPockets(lower.piece, lower.g, body, m);
    parts.push(part(lower.piece, "dark", "pelvis", "Work trousers"));
    const tee = garment(body, m, {
      sleeve: 0.3,
      hem: m.waistband - 0.02 * k,
      ease: 0.005,
      neck: {},
    });
    parts.push(part(new Piece().shell(tee.s), "light", "spine_03", "Undershirt"));
    const coat = garment(body, m, {
      sleeve: 1.93,
      hem: m.hip - 0.05 * k,
      ease: 0.017,
      fall: 0.1,
      tension: 1,
      span: 2.4,
      sleeveFall: 0.1,
      passes: 8,
      neck: { v: 0.1 },
      under: [lower.g.s, tee.s],
    });
    const piece = finish(coat, k, { cuff: 0.028, hem: 0.02, rise: 0.0025 }),
      cast = caster([coat.s]);
    collar(piece, coat.s, coat.upper, m, { stand: 0.022, fall: 0.046 });
    const studs = front(piece, cast, body, m, {
      top: m.neck[1] - 0.1 * k,
      bottom: m.hip - 0.04 * k,
      width: 0.03,
      buttons: 4,
      buttonTone: "metal",
    });
    pocket(piece, cast, body, m, {
      x: 0.09 * k,
      y: m.chest[1] + 0.1 * k,
      width: 0.1,
      height: 0.1,
      flap: false,
    });
    for (const sign of [1, -1])
      pocket(piece, cast, body, m, {
        x: sign * 0.1 * k,
        y: m.waistband - 0.03 * k,
        width: 0.13,
        height: 0.14,
        flap: false,
      });
    parts.push(
      part(piece, "main", "spine_03", "Chore jacket"),
      part(studs, "metal", "spine_03", "Buttons", "metal"),
    );
    shoes(
      body,
      m,
      parts,
      { collar: 0.12, sole: 0.017, heel: 0.008, toe: 0.006 },
      "leather",
      "sole",
      "Work boot",
    );
    return parts;
  },
  "Workshop apron"(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k;
    const legs = garment(body, m, { waist: m.waistband + 0.012 * k, taper: 0.05, ease: 0.011 });
    const shirt = garment(body, m, {
      sleeve: 1.3,
      hem: m.waistband - 0.03 * k,
      ease: 0.008,
      fall: 0.16,
      sleeveFall: 0.4,
      sleeveEase: 0.003,
      neck: { v: 0.04 },
    });
    const top = finish(shirt, k, { cuff: 0.045, rise: 0.0045 });
    collar(top, shirt.s, shirt.upper, m, {});
    parts.push(
      part(top, "light", "spine_03", "Shirt"),
      part(finish(legs, k, { waist: 0.03, legs: 0.012 }), "dark", "pelvis", "Trousers"),
    );
    const made = apron(body, m, [shirt.s, legs.s]);
    parts.push(
      part(made.piece, "main", "spine_02", "Apron", "leather"),
      part(made.ties, "leather", "spine_02", "Apron ties", "leather"),
    );
    shoes(
      body,
      m,
      parts,
      { collar: 0.11, sole: 0.015, heel: 0.008 },
      "leather",
      "sole",
      "Work boot",
    );
    return parts;
  },
  Overcoat(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k,
      seam = m.waist - 0.015 * k;
    const legs = garment(body, m, { waist: m.waistband, taper: 0.05, ease: 0.01 });
    parts.push(part(finish(legs, k, { legs: 0.012 }), "dark", "pelvis", "Trousers"));
    const coat = garment(body, m, {
      sleeve: 1.95,
      hem: seam - 0.02 * k,
      ease: 0.02,
      fall: 0.08,
      tension: 1,
      span: 2.6,
      sleeveFall: 0.08,
      passes: 9,
      neck: { v: 0.09 },
    });
    const piece = finish(coat, k, { cuff: 0.03, rise: 0.002 }),
      cast = caster([coat.s]);
    collar(piece, coat.s, coat.upper, m, { stand: 0.026, fall: 0.056 });
    const tails = skirt(body, m, {
      top: seam + 0.012 * k,
      bottom: m.knee,
      ease: 0.02,
      flare: 0.07,
      fold: 0.006,
      folds: 9,
      shells: [coat.s, legs.s],
    });
    const studs = front(piece, cast, body, m, {
      top: m.neck[1] - 0.1 * k,
      bottom: seam + 0.03 * k,
      width: 0.03,
      buttons: 3,
      buttonTone: "dark",
    });
    parts.push(
      part(piece, "main", "spine_03", "Overcoat"),
      part(tails.piece, "main", "pelvis", "Coat skirt"),
      part(studs, "dark", "spine_03", "Buttons"),
    );
    const tie = new Piece(),
      scarf = new Piece();
    belt(tie, body, m, [coat.s], seam, { height: 0.04, thick: 0.005, buckle: true });
    parts.push(part(tie, "main", "spine_01", "Coat belt"));
    roll(scarf, coat.s, coat.upper, m, {
      radius: 0.019,
      front: 0.95,
      drop: -0.01,
      out: 0.004,
      flat: 1.7,
      wraps: 0.3,
      sides: 14,
    });
    parts.push(part(scarf, "accent", "neck_01", "Scarf"));
    shoes(body, m, parts, { collar: 0.055, sole: 0.009, heel: 0.012 });
    return parts;
  },
  Traveller(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k,
      seam = m.waist - 0.01 * k;
    const legs = garment(body, m, { waist: m.waistband, leg: 1.6, ease: 0.009, taper: 0.25 });
    parts.push(part(new Piece().shell(legs.s), "dark", "pelvis", "Breeches"));
    const under = garment(body, m, {
      sleeve: 1.93,
      hem: seam - 0.03 * k,
      ease: 0.004,
      neck: {},
    });
    parts.push(
      part(finish(under, k, { cuff: 0.02, neck: 0.012 }), "light", "spine_03", "Undershirt"),
    );
    const tunic = garment(body, m, {
      sleeve: 1.05,
      hem: seam - 0.02 * k,
      ease: 0.013,
      fall: 0.15,
      tension: 1,
      span: 2.2,
      sleeveFall: 0.12,
      sleeveEase: 0.004,
      passes: 7,
      neck: { v: 0.075 },
    });
    const piece = finish(tunic, k, { neck: 0.014, cuff: 0.018, rise: 0.002 });
    const tails = skirt(body, m, {
      top: seam + 0.012 * k,
      bottom: m.crotch - 0.12 * k,
      ease: 0.014,
      flare: 0.1,
      fold: 0.006,
      folds: 11,
      shells: [tunic.s, legs.s],
    });
    parts.push(
      part(piece, "main", "spine_03", "Tunic"),
      part(tails.piece, "main", "pelvis", "Tunic skirt"),
    );
    const leather = new Piece(),
      metal = new Piece();
    const env = belt(leather, body, m, [tunic.s], seam, {
      height: 0.042,
      thick: 0.005,
      buckle: false,
    });
    buckle(metal, body, m, [tunic.s], seam, 0.042);
    const at = env.point(0.05 * k + 0.05 * k, 1.15, env.sample(0.05 * k, 1.15) + 0.03 * k);
    pod(
      leather,
      at,
      [
        [0.04 * k, 0, -0.02 * k],
        [0, 0.05 * k, 0],
        [0.012 * k, 0, 0.024 * k],
      ],
      body.rigid("pelvis"),
      { power: 3.2 },
    );
    parts.push(
      part(leather, "leather", "spine_01", "Belt and pouch", "leather"),
      part(metal, "metal", "spine_01", "Buckle", "metal"),
    );
    const cloak = cape(body, m, [tunic.s, tails.piece], { bottom: m.knee - 0.1 * k });
    hood(
      cloak.piece,
      body,
      [tunic.s, { pos: cloak.piece.pos.slice(), tri: cloak.piece.tri.slice() }],
      tunic.s,
      tunic.upper,
      m,
      { length: 0.19, thick: 0.022, stand: 0.02, front: 0.45 },
    );
    parts.push(part(cloak.piece, "accent", "spine_03", "Cloak"));
    boots(body, m, parts, { from: 1.32, cuff: 0.05, ease: 0.016 });
    return parts;
  },
  "Pressure suit"(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k;
    const suit = garment(body, m, {
      sleeve: 1.97,
      leg: 1.97,
      ease: 0.034,
      gap: 0.011,
      fall: 0.03,
      tension: 1,
      span: 3.2,
      taper: 0.02,
      sleeveFall: 0.03,
      sleeveEase: 0.004,
      passes: 12,
      soft: 10,
      neck: { height: 0.012 },
    });
    const piece = new Piece().shell(suit.s, { thickness: 0.01 }),
      rings = new Piece(),
      cast = caster([suit.s]);
    for (const loop of [...suit.sleeves, ...suit.legs])
      band(rings, suit.s, loop, { width: 0.034 * k, rise: 0.011 * k });
    for (const sign of [1, -1])
      pocket(piece, cast, body, m, {
        x: sign * 0.1 * k,
        y: m.waist + 0.02 * k,
        width: 0.11,
        height: 0.1,
        rise: 0.008,
      });
    patch(piece, cast, body, {
      centre: [0, m.chest[1] + 0.1 * k, m.chest[2]],
      facing: [0, 0, 1],
      across: [1, 0, 0],
      width: 0.17 * k,
      height: 0.11 * k,
      rise: 0.016 * k,
      nx: 6,
    });
    for (const x of [-0.045, 0, 0.045])
      button(rings, cast, body, {
        centre: [x * k, m.chest[1] + 0.1 * k, m.chest[2]],
        facing: [0, 0, 1],
        radius: 0.011 * k,
        rise: 0.022 * k,
      });
    parts.push(part(piece, "main", "spine_03", "Pressure suit"));
    const hood = helmet(body, m),
      pack = backpack(body, m, [suit.s], { tanks: true });
    parts.push(
      part(hood.shell, "light", "head", "Helmet", "metal"),
      part(hood.trim, "metal", "spine_03", "Helmet ring", "metal"),
    );
    if (pack)
      parts.push(
        part(pack.pack, "dark", "spine_03", "Air pack"),
        part(pack.gear, "light", "spine_03", "Air tanks", "metal"),
      );
    const webbing = new Piece();
    belt(webbing, body, m, [suit.s], m.waist - 0.03 * k, {
      height: 0.05,
      thick: 0.008,
      buckle: true,
    });
    parts.push(
      part(webbing, "dark", "spine_01", "Harness belt", "leather"),
      part(rings, "metal", "spine_03", "Lock rings", "metal"),
    );
    for (const side of ["l", "r"]) {
      const glove = sleeveGuard(body, m, side, { from: 1.9, ease: 0.008, passes: 4 });
      parts.push(part(new Piece().shell(glove.s), "dark", "hand_" + side, "Suit glove", "leather"));
    }
    shoes(
      body,
      m,
      parts,
      { collar: 0.13, sole: 0.024, heel: 0.004, toe: 0.01, ease: 0.012 },
      "dark",
      "sole",
      "Suit boot",
    );
    return parts;
  },
  Explorer(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k,
      lower = jeans(body, m, { taper: 0.04, ease: 0.012 });
    cargoPockets(lower.piece, lower.g, body, m);
    parts.push(part(lower.piece, "dark", "pelvis", "Field trousers"));
    const coat = garment(body, m, {
      sleeve: 1.93,
      hem: m.hip - 0.04 * k,
      ease: 0.017,
      fall: 0.1,
      tension: 1,
      span: 2.4,
      sleeveFall: 0.1,
      passes: 8,
      neck: {},
    });
    const piece = finish(coat, k, { cuff: 0.03, hem: 0.02, rise: 0.0025 }),
      cast = caster([coat.s]);
    collar(piece, coat.s, coat.upper, m, { kind: "stand", stand: 0.04 });
    front(piece, cast, body, m, {
      top: m.neck[1],
      bottom: m.hip - 0.03 * k,
      width: 0.03,
    });
    for (const sign of [1, -1]) {
      pocket(piece, cast, body, m, {
        x: sign * 0.09 * k,
        y: m.chest[1] + 0.1 * k,
        width: 0.1,
        height: 0.1,
      });
      pocket(piece, cast, body, m, {
        x: sign * 0.1 * k,
        y: m.waistband - 0.03 * k,
        width: 0.13,
        height: 0.13,
      });
    }
    parts.push(part(piece, "main", "spine_03", "Field jacket"));
    const pack = backpack(body, m, [coat.s]);
    if (pack)
      parts.push(
        part(pack.pack, "accent", "spine_03", "Backpack"),
        part(pack.gear, "leather", "spine_03", "Pack straps", "leather"),
      );
    const webbing = new Piece();
    belt(webbing, body, m, [coat.s], m.waist - 0.02 * k, { height: 0.036, thick: 0.004 });
    parts.push(part(webbing, "leather", "spine_01", "Belt", "leather"));
    shoes(
      body,
      m,
      parts,
      { collar: 0.12, sole: 0.018, heel: 0.008, toe: 0.005 },
      "leather",
      "sole",
      "Hiking boot",
    );
    return parts;
  },
  Parka(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k,
      seam = m.waist - 0.02 * k;
    const footwear: OutfitPart[] = [],
      shafts = boots(body, m, footwear, {
        from: 1.55,
        cuff: 0,
        ease: 0.011,
        sole: 0.02,
        toe: 0.006,
      });
    const legs = garment(body, m, {
      waist: m.waistband,
      taper: 0.03,
      ease: 0.015,
      leg: 1.85,
      over: shafts,
    });
    parts.push(part(new Piece().shell(legs.s), "dark", "pelvis", "Snow trousers"));
    const coat = garment(body, m, {
      sleeve: 1.96,
      hem: seam - 0.02 * k,
      ease: 0.03,
      fall: 0.04,
      tension: 1,
      span: 3,
      sleeveFall: 0.04,
      sleeveEase: 0.004,
      passes: 10,
      neck: {},
    });
    const piece = finish(coat, k, { cuff: 0.035, rise: 0.003 }),
      cast = caster([coat.s]);
    const yoke = 0.016,
      tails = skirt(body, m, {
        top: seam + 0.012 * k,
        bottom: m.crotch - 0.1 * k,
        ease: 0.03,
        flare: 0.02,
        shells: [coat.s, legs.s],
        yoke,
      });
    front(piece, cast, body, m, {
      top: m.neck[1] + 0.01 * k,
      bottom: seam + 0.02 * k,
      width: 0.04,
      rise: 0.004,
    });
    for (const sign of [1, -1])
      pocket(tails.piece, caster([surfaceOf(tails.piece)]), body, m, {
        x: sign * 0.11 * k,
        y: m.hip + 0.01 * k,
        width: 0.13,
        height: 0.13,
        rise: 0.004,
        z: m.pelvis[2],
        skin: tails.skin,
      });
    parts.push(
      part(piece, "main", "spine_03", "Parka"),
      part(tails.piece, "main", "pelvis", "Parka skirt"),
    );
    const cord = new Piece(),
      trim = new Piece();
    belt(cord, body, m, [coat.s], seam + (0.012 + yoke) * k, {
      height: 0.022,
      thick: 0.006,
      buckle: false,
    });
    parts.push(part(cord, "dark", "spine_01", "Drawcord"));
    hood(piece, body, [coat.s], coat.s, coat.upper, m, {
      length: 0.2,
      thick: 0.03,
      stand: 0.024,
      front: 0.5,
    });
    roll(trim, coat.s, coat.upper, m, {
      radius: 0.024,
      front: 0.6,
      drop: -0.008,
      out: 0.012,
      flat: 0.8,
      lumps: 0.2,
      sides: 12,
    });
    parts.push(part(trim, "light", "spine_03", "Fur trim", "hair"));
    for (const side of ["l", "r"]) {
      const glove = sleeveGuard(body, m, side, { from: 1.86, ease: 0.007, passes: 4 });
      parts.push(part(new Piece().shell(glove.s), "leather", "hand_" + side, "Glove", "leather"));
    }
    parts.push(...footwear);
    return parts;
  },
  "Leather armour"(body, m) {
    const parts: OutfitPart[] = [],
      k = m.k,
      seam = m.waist - 0.015 * k;
    const legs = garment(body, m, { waist: m.waistband, leg: 1.6, ease: 0.009, taper: 0.25 });
    parts.push(part(new Piece().shell(legs.s), "dark", "pelvis", "Breeches"));
    const tunic = garment(body, m, {
      sleeve: 1.93,
      hem: seam - 0.03 * k,
      ease: 0.008,
      fall: 0.18,
      sleeveFall: 0.3,
      sleeveEase: 0.003,
      neck: {},
    });
    const tails = skirt(body, m, {
      top: seam + 0.01 * k,
      bottom: m.crotch - 0.1 * k,
      ease: 0.012,
      flare: 0.1,
      fold: 0.006,
      folds: 11,
      shells: [tunic.s, legs.s],
    });
    parts.push(
      part(finish(tunic, k, { neck: 0.014 }), "main", "spine_03", "Tunic"),
      part(tails.piece, "main", "pelvis", "Tunic skirt"),
    );
    const vest = garment(body, m, {
      sleeve: 0.05,
      hem: seam,
      ease: 0.02,
      gap: 0.015,
      fall: 0.15,
      tension: 1,
      span: 3,
      passes: 14,
      neck: { v: 0.03 },
    });
    const armour = finish(vest, k, {
      neck: 0.014,
      cuff: 0.014,
      hem: 0.02,
      rise: 0.004,
      thickness: 0.007,
    });
    for (const sign of [1, -1]) {
      const cap = plate(
        body,
        m,
        [
          (s, i) => ((s.anc[i * 3] ?? 0) * sign > 0 ? 0.42 - s.value("arm", i) : -1),
          (s, i) => s.value("arm", i) + 0.06,
          (s, i) => (s.anc[i * 3 + 1] ?? 0) - (m.shoulder - 0.1 * k) + 10 * s.value("wArm", i),
        ],
        { ease: 0.03, passes: 12, near: body.joint(sign > 0 ? "upperarm_l" : "upperarm_r") },
      );
      const capPiece = new Piece().shell(cap.s, { thickness: 0.008 });
      for (const loop of cap.all)
        band(capPiece, cap.s, loop, { width: 0.014 * k, rise: 0.003 * k });
      parts.push(
        part(
          capPiece,
          "leather",
          sign > 0 ? "upperarm_l" : "upperarm_r",
          "Shoulder guard",
          "leather",
        ),
      );
      const side = sign > 0 ? "l" : "r",
        guard = sleeveGuard(body, m, side, {
          from: 1.2,
          to: 1.9,
          ease: 0.011,
          passes: 6,
          over: [tunic.s],
        }),
        bracer = new Piece().shell(guard.s, { thickness: 0.006 });
      for (const loop of guard.all)
        band(bracer, guard.s, loop, { width: 0.014 * k, rise: 0.003 * k });
      parts.push(part(bracer, "leather", "lowerarm_" + side, "Bracer", "leather"));
    }
    parts.push(part(armour, "leather", "spine_03", "Cuirass", "leather"));
    const strapPiece = new Piece(),
      metal = new Piece();
    belt(strapPiece, body, m, [vest.s], seam, { height: 0.045, thick: 0.006, buckle: false });
    buckle(metal, body, m, [vest.s], seam, 0.045);
    parts.push(
      part(strapPiece, "dark", "spine_01", "Belt", "leather"),
      part(metal, "metal", "spine_01", "Buckle", "metal"),
    );
    boots(body, m, parts, { from: 1.28, cuff: 0.05, ease: 0.016 });
    return parts;
  },
} satisfies Readonly<Record<OutfitPattern, Outfit>>;

export const toneFields = {
  clothSecond: "dark",
  clothLight: "light",
  accentColor: "accent",
  leatherColor: "leather",
  soleColor: "sole",
  metalColor: "metal",
} as const;
export type ToneField = keyof typeof toneFields;

export type OutfitTones = { readonly clothColor?: string | undefined } & Partial<
  Record<ToneField, string | undefined>
>;

export const defaultClothColor = "#6f7f86";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const skinLike = (hue: number) => hue > 0.94 || hue < 0.17;

export function outfitPalette(style: OutfitTones): Record<string, string> {
  const main = new T.Color(style.clothColor ?? defaultClothColor),
    hsl = main.getHSL({ h: 0, s: 0, l: 0 });
  const tone = (h: number, s: number, l: number) =>
    "#" + new T.Color().setHSL((hsl.h + h + 1) % 1, clamp01(hsl.s * s), clamp01(l)).getHexString();
  const tones: Record<string, string> = {
    main: "#" + main.getHexString(),
    dark: tone(0.02, 0.8, hsl.l * 0.5 + 0.06),
    light: tone(-0.02, 0.55, hsl.l * 0.45 + 0.52),
    accent: tone(
      skinLike((hsl.h + 0.5) % 1) ? (skinLike((hsl.h + 0.67) % 1) ? 0.33 : 0.67) : 0.5,
      0.75,
      hsl.l * 0.5 + 0.14,
    ),
    leather: "#" + new T.Color("#5b4334").lerp(main, 0.12).getHexString(),
    sole: "#" + new T.Color("#2c2a28").lerp(main, 0.08).getHexString(),
    metal: "#8f9296",
  };
  for (const [field, name] of Object.entries(toneFields)) {
    const named: unknown = Object.hasOwn(style, field) ? Reflect.get(style, field) : undefined;
    if (typeof named === "string" && named) tones[name] = "#" + new T.Color(named).getHexString();
  }
  return tones;
}

function cover(body: DressBody, s: Shell, margin: number): Uint8Array {
  const over = new Uint8Array(body.count),
    P = body.P,
    grid = new Map<string, Array<readonly [number, number, number]>>(),
    key = (x: number, y: number, z: number) =>
      Math.floor(x / margin) + "," + Math.floor(y / margin) + "," + Math.floor(z / margin);
  const p = (i: number) => P[i] ?? 0;
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
      (p(v * 3) - a[0]) ** 2 + (p(v * 3 + 1) - a[1]) ** 2 + (p(v * 3 + 2) - a[2]) ** 2 > 1e-8
    )
      continue;
    if (dot(sub(s.at(i), a), s.normal(i)) > 0.0005) over[v] = 1;
  }
  for (let v = 0; v < body.count; v++) {
    if (!over[v]) continue;
    const x = p(v * 3),
      y = p(v * 3 + 1),
      z = p(v * 3 + 2);
    open: for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const a of grid.get(key(x + dx * margin, y + dy * margin, z + dz * margin)) ?? [])
            if ((a[0] - x) ** 2 + (a[1] - y) ** 2 + (a[2] - z) ** 2 < margin * margin) {
              over[v] = 0;
              break open;
            }
  }
  return over;
}

export function concealed(
  body: DressBody,
  pieces: ReadonlyArray<Piece>,
  margin = 0.04,
): Set<number> {
  const hidden = new Set<number>();
  for (const piece of pieces)
    for (const s of piece.shells) {
      const over = cover(body, s, margin * body.scale);
      for (let v = 0; v < body.count; v++) if (over[v]) hidden.add(body.surface.ids[v] ?? -1);
    }
  return hidden;
}

export interface OutfitMesh extends DressMesh {
  readonly type: string;
  readonly tone: string;
}

export interface DressedOutfit {
  readonly meshes: ReadonlyArray<OutfitMesh>;
  readonly ground: number;
  readonly hidden: ReadonlySet<number>;
  readonly landmarks: Landmarks;
}

export interface OutfitFinish {
  readonly raster: Raster;
  readonly cloth?: (mesh: T.Mesh, m: Landmarks) => void;
}

export function dressPreset(
  surface: HumanSurface,
  name: OutfitPattern,
  style: Parameters<typeof outfitPalette>[0],
  material: (tone: string, type: string) => T.Material,
  finish?: OutfitFinish,
): DressedOutfit {
  const body = analyse(surface),
    m = landmarks(body),
    tones = outfitPalette(style),
    meshes: OutfitMesh[] = [],
    worn: Piece[] = [];
  let ground = body.floor;
  for (const p of presetOutfits[name](body, m)) {
    if (!p.piece.tri.length) continue;
    worn.push(p.piece);
    const base = material(tones[p.tone] ?? p.tone, p.type),
      made = p.piece.mesh(base, p.region, p.name);
    made.mesh.userData["styleType"] = p.type;
    if (finish) {
      finishFootwear(finish.raster, made.mesh, p.piece.shoeUV);
      finish.cloth?.(made.mesh, m);
      if (p.piece.draped) {
        const own = made.mesh.material === base ? base.clone() : made.mesh.material;
        if (!Array.isArray(own)) {
          own.userData["foldedCloth"] = true;
          made.mesh.material = own;
        }
      }
    }
    meshes.push({ ...made, type: p.type, tone: p.tone });
    if (p.ground !== undefined) ground = Math.min(ground, p.ground);
  }
  return { meshes, ground, hidden: concealed(body, worn), landmarks: m };
}
