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

export const presetOutfits = {
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
