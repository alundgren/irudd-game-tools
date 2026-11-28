import { Euler, MathUtils, Quaternion, Vector3 } from "three";
import { dressDevices as devices, dressKinds as kinds } from "@irudd/document";
import { randomStream } from "../../random.js";
import { need } from "./need.js";
import type { Anchor, DressContext, Plan, RawDress, Shell } from "./types.js";

const { clamp, lerp } = MathUtils;
const hexColor = (v: unknown, fallback: string) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;

type Livery = NonNullable<Plan["dress"]>;
type DressKind = Livery["kind"];
export type ReadDress = Omit<Livery, "kind"> & { kind: DressKind | "none" };
const isKind = (v: unknown): v is DressKind => kinds.some((k) => k === v);
const isDevice = (v: unknown): v is NonNullable<Livery["device"]> => devices.some((k) => k === v);
export const dressLiveries: [string, string][] = [
  ["#b3202e", "#f0c24f"],
  ["#27408b", "#e8ecf2"],
  ["#167a56", "#f0c24f"],
  ["#f2ead8", "#1fa3a0"],
  ["#f0a020", "#fff1c9"],
  ["#6a3aa2", "#f3d36b"],
  ["#23252e", "#ff8a2a"],
  ["#128a98", "#f6ecd0"],
  ["#cf3f7c", "#fbe7a8"],
  ["#7b3f20", "#8fe0c8"],
];

export function readDress(raw: RawDress = {}): ReadDress {
  const kind = isKind(raw.kind) ? raw.kind : "none";
  const number = (v: number | undefined, a: number, b: number, base: number) =>
    v !== undefined && Number.isFinite(v) ? clamp(v, a, b) : base;
  const [color, trim] = need(dressLiveries[0]);
  return {
    kind,
    ...(isDevice(raw.device) ? { device: raw.device } : {}),
    color: hexColor(raw.color, color),
    trim: hexColor(raw.trim, trim),
    layers: Math.round(number(raw.layers, 1, 3, 3)),
    size: number(raw.size, 0.7, 1.4, 1),
    ...(raw.clear !== undefined && Number.isFinite(raw.clear)
      ? { clear: clamp(raw.clear, 0, 1) }
      : {}),
    ...(raw.cut === 2 || raw.cut === 3 ? { cut: raw.cut } : {}),
    seed: raw.seed !== undefined && Number.isInteger(raw.seed) ? clamp(raw.seed, 0, 4294967295) : 1,
  };
}

const hueOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16),
    r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const light = (max + min) / 2;
  if (d < 0.04) return [0, 0, light];
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, d / (1 - Math.abs(2 * light - 1) + 1e-6), light];
};

export function drawDress(plan: Plan, seed: number, odds = 0.45): Livery | null {
  const draw = randomStream((seed ^ 0x5d2e61c7) >>> 0);
  const roll = draw();
  const legs = plan.limbs.filter((l) => l.kind === "leg");
  if (!legs.length || roll > odds) return null;
  const arms = plan.limbs.some((l) => l.kind === "arm");
  const upright = plan.spine.front > 55;
  const bareBack = plan.back.kind === "none";
  const options: DressKind[] = upright
    ? arms
      ? ["herald", "warden", "sage", "ranger", "nomad", "sage"]
      : ["sage", "herald", "ranger", "nomad"]
    : arms
      ? ["warden", "ranger", "herald", "nomad"]
      : ["nomad", "nomad", "herald", "warden"];
  let kind: DressKind = need(options[Math.floor(draw() * options.length)]);
  if (kind === "sage" && !bareBack && !upright) kind = "herald";
  const [bodyHue, bodySat, bodyLight] = hueOf(plan.skin.base);
  const apart = dressLiveries.filter(([cloth]) => {
    const [h, s, l] = hueOf(cloth);
    const turn = Math.abs(((h - bodyHue + 540) % 360) - 180);
    return (s > 0.2 && bodySat > 0.15 && turn > 70) || Math.abs(l - bodyLight) > 0.27;
  });
  const pool = apart.length ? apart : dressLiveries;
  const [color, trim] = need(pool[Math.floor(draw() * pool.length)]);
  const read = readDress({
    kind,
    device: (
      {
        herald: "swallow",
        sage: "oak",
        nomad: "sunburst",
        warden: "tide",
        ranger: "compass",
      } as const
    )[kind],
    color,
    trim,
    layers: draw() < 0.7 ? 3 : 2,
    size: lerp(0.9, 1.15, draw()),
    seed: Math.floor(draw() * 4294967296),
    cut: 3,
  });
  return { ...read, kind };
}

function shell(rings: Vector3[][], closedPath = false): Shell {
  const vertices = rings.flat(),
    faces: number[][] = [],
    sides = need(rings[0]).length,
    rows = rings.length;
  if (!closedPath) {
    const centre = (row: number) =>
      need(rings[row])
        .reduce((a, p) => a.add(p), new Vector3())
        .multiplyScalar(1 / sides);
    const a = vertices.push(centre(0)) - 1,
      b = vertices.push(centre(rows - 1)) - 1;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      faces.push([a, j, i], [b, (rows - 1) * sides + i, (rows - 1) * sides + j]);
    }
  }
  for (let r = 0; r < (closedPath ? rows : rows - 1); r++)
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides,
        next = (r + 1) % rows;
      faces.push([r * sides + i, r * sides + j, next * sides + j, next * sides + i]);
    }
  return { vertices, faces };
}
function slab(outer: Vector3[][], inner: Vector3[][]): Shell {
  const m = outer.length,
    n = need(outer[0]).length,
    vertices = [...outer.flat(), ...inner.flat()],
    faces: number[][] = [];
  const o = (i: number, j: number) => i * n + j,
    q = (i: number, j: number) => m * n + i * n + j;
  for (let i = 0; i < m - 1; i++)
    for (let j = 0; j < n - 1; j++)
      faces.push(
        [o(i, j), o(i, j + 1), o(i + 1, j + 1), o(i + 1, j)],
        [q(i, j), q(i + 1, j), q(i + 1, j + 1), q(i, j + 1)],
      );
  for (let j = 0; j < n - 1; j++)
    faces.push(
      [o(0, j), q(0, j), q(0, j + 1), o(0, j + 1)],
      [o(m - 1, j), o(m - 1, j + 1), q(m - 1, j + 1), q(m - 1, j)],
    );
  for (let i = 0; i < m - 1; i++)
    faces.push(
      [o(i, 0), o(i + 1, 0), q(i + 1, 0), q(i, 0)],
      [o(i, n - 1), q(i, n - 1), q(i + 1, n - 1), o(i + 1, n - 1)],
    );
  return { vertices, faces };
}
type Sheet = (s: number, t: number, i: number, j: number) => Vector3;
const grid = (m: number, n: number, at: Sheet) =>
  Array.from({ length: m }, (_, i) =>
    Array.from({ length: n }, (_, j) => at(i / (m - 1), j / (n - 1), i, j)),
  );
function basis(axis: Vector3): [Vector3, Vector3] {
  const ref = Math.abs(axis.y) > 0.85 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const u = new Vector3().crossVectors(ref, axis).normalize(),
    v = new Vector3().crossVectors(axis, u).normalize();
  return [u, v];
}
function gem(at: Vector3, normal: Vector3, size: number, tall = 0.7) {
  const [u, v] = basis(normal);
  const ring = (h: number, r: number) =>
    Array.from({ length: 6 }, (_, i) =>
      at
        .clone()
        .addScaledVector(normal, h * size)
        .addScaledVector(u, r * size * Math.cos((i * Math.PI) / 3))
        .addScaledVector(v, r * size * Math.sin((i * Math.PI) / 3)),
    );
  return shell([ring(-0.3, 0.8), ring(0.1 * tall, 1), ring(tall, 0.42)]);
}
function cuff(
  a: Vector3,
  b: Vector3,
  ra: number,
  rb: number,
  from: number,
  to: number,
  thick: number,
  flare = 0,
  sides = 10,
) {
  const axis = b.clone().sub(a).normalize(),
    [u, v] = basis(axis);
  const ring = (t: number, r: number) =>
    Array.from({ length: sides }, (_, i) =>
      a
        .clone()
        .lerp(b, t)
        .addScaledVector(u, r * Math.cos((i * 2 * Math.PI) / sides))
        .addScaledVector(v, r * Math.sin((i * 2 * Math.PI) / sides)),
    );
  const r = (t: number) => lerp(ra, rb, t);
  return shell(
    [
      ring(from, r(from) * 0.86),
      ring(from, r(from) * (thick + flare)),
      ring((from + to) / 2, r((from + to) / 2) * thick),
      ring(to, r(to) * (thick + 0.4 * flare)),
      ring(to, r(to) * 0.86),
    ],
    true,
  );
}
function blade(points: Vector3[], widths: number[], normal: Vector3, thick: number) {
  const rings = points.map((p, i) => {
    const along = (points[Math.min(points.length - 1, i + 1)] ?? p)
      .clone()
      .sub(need(points[Math.max(0, i - 1)]))
      .normalize();
    const side = new Vector3().crossVectors(along, normal).normalize();
    const w = need(widths[i]),
      t = thick * (0.4 + 0.6 * Math.min(1, w / Math.max(...widths)));
    return [
      p.clone().addScaledVector(side, w),
      p.clone().addScaledVector(normal, t),
      p.clone().addScaledVector(side, -w),
      p.clone().addScaledVector(normal, -t),
    ];
  });
  return shell(rings);
}

const needed = { none: 0, herald: 12, warden: 15, sage: 11, nomad: 11, ranger: 12 };
export const dressRegionCount = (dress: { kind: DressKind | "none" } | undefined | null) =>
  needed[dress?.kind ?? "none"];

export function dressCreature(ctx: DressContext) {
  const { plan, spine, anchors, heads, emit, room } = ctx;
  const dress = plan.dress;
  if (!dress) return;
  const k = plan.scale,
    girth = plan.spine.girth * k,
    size = dress.size,
    draw = randomStream(dress.seed);
  const cloth = dress.color,
    trim = dress.trim,
    leather = "#5a4334";
  const arms = anchors.filter((a) => a.kind === "arm"),
    legs = anchors.filter((a) => a.kind === "leg");
  const chestRise = Math.sin(spine.at(0.5).pitch);
  const upright =
    chestRise > 0.72 ||
    (dress.cut === 3 &&
      dress.kind === "warden" &&
      arms.length > 0 &&
      legs.length === 2 &&
      chestRise > 0.49);
  const winged = plan.limbs.some((l) => l.kind === "wing");
  const bareBack = plan.back.kind === "none" && !winged;
  const tailed = plan.tail.kind !== "none";
  const length = plan.spine.length * k;
  const supports = (ctx.supports ?? []).map((part) => ({
    centre: new Vector3().fromArray(part.position),
    radius: new Vector3().fromArray(part.size).multiplyScalar(0.5),
    inverse: new Quaternion()
      .setFromEuler(
        new Euler(
          ...new Vector3().fromArray(part.rotation).multiplyScalar(MathUtils.DEG2RAD).toArray(),
        ),
      )
      .invert(),
  }));
  const bodyDepth = (origin: Vector3, direction: Vector3, depth: number) => {
    for (const { centre, radius, inverse } of supports) {
      const offset = origin.clone().sub(centre).applyQuaternion(inverse).divide(radius);
      const ray = direction.clone().applyQuaternion(inverse).divide(radius);
      const a = ray.lengthSq(),
        b = offset.dot(ray);
      const disc = b * b - a * (offset.lengthSq() - 1);
      if (disc >= 0) depth = Math.max(depth, (Math.sqrt(disc) - b) / a);
    }
    return depth;
  };
  const proud = (t: number, angle: number) => {
    const f = spine.at(t);
    let most = 0;
    for (const a of anchors) {
      const along = Math.abs(a.root.clone().sub(f.centre).dot(f.tangent));
      const reach = a.r0 * 1.7;
      if (along < reach)
        most = Math.max(most, a.r0 * 0.6 * (1 - along / reach) * Math.abs(Math.sin(angle)) ** 0.6);
    }
    return most;
  };
  const trunk = (t: number, angle: number, r = 1, pad = 0) => {
    const f = spine.at(clamp(t, 0.1, 0.9)),
      g = spine.at(clamp(t, 0, 1));
    const reach = t < 0 ? t * length : t > 1 ? (t - 1) * length : 0;
    const [w, d] =
      t < 0.1 || t > 0.9
        ? [Math.max(f.radius[0] * 0.82, g.radius[0]), Math.max(f.radius[1] * 0.82, g.radius[1])]
        : g.radius;
    const down =
      plan.back.kind === "contour plumage"
        ? girth *
          (0.07 + (0.11 * plan.back.height) / plan.spine.girth) *
          MathUtils.smoothstep(Math.cos(angle), -0.64, -0.1) *
          MathUtils.smoothstep(t, 0.01, 0.17) *
          (1 - MathUtils.smoothstep(t, 0.87, 1))
        : 0;
    const extra = pad + down + proud(clamp(t, 0, 1), angle);
    const centre = g.centre.clone().addScaledVector(g.tangent, reach);
    const radial = g.dorsal.clone().multiplyScalar(d * Math.cos(angle));
    radial.x += w * Math.sin(angle);
    const depth = radial.length();
    radial.divideScalar(Math.max(0.00001, depth));
    return centre.addScaledVector(radial, bodyDepth(centre, radial, depth) * r + extra);
  };
  type Wave = ((a: number) => number) | null | undefined;
  const loopAt = (t: number, r: number, pad: number, sides = 14, wave?: Wave) =>
    Array.from({ length: sides }, (_, i) => {
      const angle = (i * 2 * Math.PI) / sides;
      return trunk(t + (wave ? wave(angle) : 0), angle, r, pad);
    });
  const belt = (t: number, half: number, pad = 0.012 * k, wave?: Wave) =>
    shell(
      [
        loopAt(t - half, 0.94, 0, 14, wave),
        loopAt(t - half, 1.03, pad + girth * 0.07, 14, wave),
        loopAt(t + half, 1.03, pad + girth * 0.07, 14, wave),
        loopAt(t + half, 0.94, 0, 14, wave),
      ],
      true,
    );
  let made = 0;
  const cap = dressRegionCount(dress);
  const put = (id: string, parent: string, shells: Shell[], color: string, surface = "canvas") => {
    if (made >= cap || !room()) return false;
    made++;
    emit("dress " + id, parent, shells, color, surface);
    return true;
  };
  const free = (t: number, half = 0.06) =>
    dress.clear === undefined || Math.abs(t - dress.clear) > 0.2 + half;
  const head = heads.length === 1 ? need(heads[0]) : null;
  const half = clamp((0.05 * girth) / Math.max(0.2, length) / 0.2, 0.018, 0.05) * size;

  function collar(scallops: boolean, drop = 1, yoke = true) {
    if (!head) return;
    const h = head;
    const neckLength = h.neckEnd.distanceTo(h.neckRoot);
    if (neckLength > 1.5 * h.nr0) {
      const axis = h.neckEnd.clone().sub(h.neckRoot).normalize(),
        [u, v] = basis(axis);
      const sides = 12;
      const ring = (t: number, r: number, wave = 0) =>
        Array.from({ length: sides }, (_, i) => {
          const a = (i * 2 * Math.PI) / sides;
          const rr = r * (1 + wave * (i % 2 ? 1 : -0.3));
          return h.neckRoot
            .clone()
            .lerp(h.neckEnd, t)
            .addScaledVector(u, rr * Math.cos(a))
            .addScaledVector(v, rr * Math.sin(a));
        });
      const r = (t: number) => lerp(h.nr0, h.nr1, Math.min(1, t * 1.3));
      const top = clamp((0.69 * h.nr0 * size) / neckLength + 0.09, 0.17, 0.49);
      put(
        "collar",
        h.neckId,
        [
          shell(
            [
              ring(top, r(top) * 0.9),
              ring(top, r(top) * 1.2),
              ring(0.14, r(0.14) * (1.18 + 0.15 * drop), scallops ? 0.09 : 0),
              ring(0.12, r(0.12) * 0.9),
            ],
            true,
          ),
        ],
        scallops ? cloth : trim,
        scallops ? "canvas" : "metal",
      );
      const front = h.neckRoot
        .clone()
        .lerp(h.neckEnd, top * 0.7)
        .addScaledVector(h.facing, r(top) * 1.22)
        .addScaledVector(h.up, -r(top) * 0.25);
      if (scallops)
        put(
          "collar clasp",
          h.neckId,
          [gem(front, h.facing.clone().setY(0.2).normalize(), r(top) * 0.34)],
          trim,
          "metal",
        );
    } else if (yoke) {
      const wave = scallops ? (a: number) => 0.02 * Math.cos(6 * a) : null;
      put(
        "collar",
        "body",
        [
          shell(
            [
              loopAt(0.9, 0.9, 0),
              loopAt(0.9, 1.04, girth * 0.05),
              loopAt(0.8 - 0.03 * drop, 1.05, girth * 0.1, 14, wave),
              loopAt(0.8 - 0.03 * drop, 0.93, 0, 14, wave),
            ],
            true,
          ),
        ],
        scallops ? cloth : trim,
        scallops ? "canvas" : "metal",
      );
    }
  }
  function guards(limbs: Anchor[], tiers: number, color: string, surface: string, name: string) {
    const done = new Set();
    for (const a of limbs) {
      const key = a.id.replace(/^(left|right) /, "");
      if (done.size >= 1 && !done.has(key)) continue;
      done.add(key);
      const out = new Vector3(a.side, 0, 0),
        up = new Vector3(0, 1, 0);
      const pole = up.clone().multiplyScalar(0.84).addScaledVector(out, 0.54).normalize();
      const e1 = out.clone().addScaledVector(pole, -out.dot(pole)).normalize(),
        e2 = new Vector3().crossVectors(pole, e1);
      const shells: Shell[] = [];
      for (let tier = 0; tier < tiers; tier++) {
        const R = a.r0 * (1.43 - 0.15 * tier) * Math.min(size, 1.1),
          centre = a.root
            .clone()
            .addScaledVector(out, a.r0 * (0.17 + 0.34 * tier))
            .addScaledVector(up, a.r0 * (0.28 - 0.55 * tier));
        const at = (r: number) => (s: number, t: number) => {
          const phi = lerp(0.1, 1.45, s),
            theta = lerp(-2.1, 2.1, t),
            flare = 1 + 0.18 * s * s;
          return centre
            .clone()
            .addScaledVector(pole, r * Math.cos(phi))
            .addScaledVector(e1, r * flare * Math.sin(phi) * Math.cos(theta))
            .addScaledVector(e2, r * flare * Math.sin(phi) * Math.sin(theta) * 1.06);
        };
        shells.push(slab(grid(4, 7, at(R)), grid(4, 7, at(R * 0.8))));
      }
      put(a.id + " " + name, a.upper, shells, color, surface);
    }
  }
  function shins(limbs: Anchor[], color: string, name: string) {
    const done = new Set();
    for (const a of limbs) {
      const key = a.id.replace(/^(left|right) /, "");
      if (done.size >= 2 && !done.has(key)) continue;
      done.add(key);
      const axis = a.end.clone().sub(a.mid).normalize();
      const fore = new Vector3(0, 0, 1);
      fore.addScaledVector(axis, -fore.dot(axis));
      if (fore.lengthSq() < 0.05) fore.set(0, -1, 0).addScaledVector(axis, axis.y);
      fore.normalize();
      const flank = new Vector3().crossVectors(fore, axis);
      const at = (scale: number) => (s: number, t: number) => {
        const u = lerp(0.2, 0.9, s),
          angle = lerp(-1.7, 1.7, t) * (1 - 0.25 * s),
          r = lerp(a.r1, a.r2, u) * scale * (1 + 0.3 * (1 - s) ** 3) * (0.94 + 0.06 * size);
        return a.mid
          .clone()
          .lerp(a.end, u)
          .addScaledVector(fore, r * Math.cos(angle) * (1 + 0.12 * Math.cos(angle)))
          .addScaledVector(flank, r * Math.sin(angle));
      };
      put(
        a.id + " " + name,
        a.lower,
        [slab(grid(5, 7, at(1.42)), grid(5, 7, at(1.1)))],
        color,
        "metal",
      );
    }
  }
  function breastplate(lo: number, hi: number) {
    const front = (a: number) => (1 - Math.cos(a)) / 2;
    const ring = (v: number, r: number, pad: number) =>
      Array.from({ length: 16 }, (_, i) => {
        const a = (i * 2 * Math.PI) / 16,
          f = front(a);
        const low = lo - 0.09 * f ** 3 + 0.05 * (1 - f) ** 2,
          high = hi + 0.03 * f ** 2 - 0.05 * Math.sin(a) ** 2;
        const keel = pad ? 0.07 * f ** 6 * Math.sin(Math.PI * Math.min(1, v * 1.1)) : 0;
        return trunk(lerp(low, high, v), a, r, girth * (pad + keel));
      });
    return shell(
      [
        ring(0, 0.95, 0),
        ring(0, 1.04, 0.07),
        ring(0.3, 1.05, 0.13),
        ring(0.7, 1.05, 0.13),
        ring(1, 1.04, 0.07),
        ring(1, 0.95, 0),
      ],
      true,
    );
  }
  function bands(
    limbs: Anchor[],
    color: string,
    surface: string,
    name: string,
    from = 0.3,
    to = 0.82,
    thick = 1.34,
    flare = 0.2,
  ) {
    const done = new Set();
    for (const a of limbs) {
      const key = a.id.replace(/^(left|right) /, "");
      if (done.size >= 2 && !done.has(key)) continue;
      done.add(key);
      put(
        a.id + " " + name,
        a.lower,
        [cuff(a.mid, a.end, a.r1, a.r2, from, to, thick * (0.94 + 0.06 * size), flare)],
        color,
        surface,
      );
    }
  }
  function mantle(front: number, hem: number, wide: [number, number], flare: number, hemWave = 0) {
    const m = 7,
      n = 9;
    const at = (lift: number) => (s: number, t: number, i: number, j: number) => {
      const station = lerp(front, hem, s);
      const spread = lerp(wide[0], wide[1], s ** 0.7);
      const angle = lerp(-spread, spread, t);
      const edge = hemWave && i === m - 1 ? (j % 2 ? hemWave : -0.2 * hemWave) : 0;
      return trunk(station - edge, angle, 1.02, girth * (0.05 + flare * s * s + lift));
    };
    const rows = (lift: number) => grid(m, n, at(lift));
    const ok = put("mantle", "body", [slab(rows(0.045), rows(0))], cloth);
    const hemAt = (lift: number) => (s: number, t: number, i: number, j: number) => {
      const station = lerp(lerp(front, hem, 0.84), hem, s);
      const spread = lerp(wide[0], wide[1], (0.84 + 0.16 * s) ** 0.7);
      const angle = lerp(-spread, spread, t);
      const edge = hemWave && i === 2 ? (j % 2 ? hemWave : -0.2 * hemWave) : 0;
      const ss = 0.84 + 0.16 * s;
      return trunk(station - edge, angle, 1.02, girth * (0.05 + flare * ss * ss + lift));
    };
    if (ok)
      put(
        "mantle border",
        "body",
        [slab(grid(3, n, hemAt(0.075)), grid(3, n, hemAt(0.035)))],
        trim,
      );
    return ok;
  }
  function headpiece(style: string) {
    if (!head || plan.head.eyePlace === "top" || plan.head.crest === "crown") return;
    const h = head;
    const bare = plan.head.crest === "none" && plan.head.stalks < 0.005;
    const ringOn = (el: number, scale: number, sides = 12, tilt = 0) =>
      Array.from({ length: sides }, (_, i) => {
        const az = (i * 2 * Math.PI) / sides;
        return h.onHead(az, el + tilt * Math.cos(az), scale);
      });
    if (style === "wrap") {
      const base = plan.head.eyes > 2 ? 0.83 : 0.69,
        wraps: Shell[] = [];
      for (const turn of [0, 1]) {
        const band = [
          [-0.115, 1.015],
          [-0.085, 1.17],
          [0.074, 1.16],
          [0.115, 1.01],
        ];
        const rows = band.map(([edge = 0, radius = 0]) =>
          Array.from({ length: 16 }, (_, i) => {
            const az = (i * 2 * Math.PI) / 16;
            const el =
              base +
              0.16 * turn +
              edge +
              (0.1 + 0.03 * turn) * Math.sin(az * (turn ? -1 : 1) + 0.38) -
              0.085 * Math.cos(az - Math.PI);
            return h.onHead(az, el, radius + 0.035 * turn);
          }),
        );
        wraps.push(shell(rows, true));
      }
      if (bare)
        wraps.push(
          shell([
            ringOn(1.03, 1.08, 14),
            ringOn(1.2, 1.22, 14),
            ringOn(1.4, 1.27, 14),
            ringOn(1.55, 1.23, 14),
          ]),
        );
      put("folded headwrap", h.headId, wraps, cloth, "canvas");
      const az = 0.54,
        el = base + 0.05,
        normal = h.outward(az, el);
      const badge = h.onHead(az, el, 1.15);
      const pin = gem(badge, normal, 0.065 * h.hs, 1);
      const stalk = h.up.clone().addScaledVector(h.across, 0.27).normalize();
      const vanes = [pin];
      for (const lean of [-0.22, 0.12]) {
        const points: Vector3[] = [],
          widths: number[] = [];
        for (let j = 0; j <= 12; j++) {
          const t = j / 12;
          points.push(
            badge
              .clone()
              .addScaledVector(stalk, t * h.hs * (0.61 + lean * 0.2))
              .addScaledVector(h.across, lean * t * t * h.hs)
              .addScaledVector(h.facing, -0.27 * t * t * h.hs),
          );
          widths.push(
            h.hs * (0.009 + 0.072 * Math.sin(Math.PI * t) ** 0.75 * (j % 3 === 1 ? 0.7 : 1)),
          );
        }
        vanes.push(blade(points, widths, normal, h.hs * 0.016));
      }
      put("feather pin", h.headId, vanes, trim, "plain");
    } else if (style === "helm" && bare) {
      const rings = [0.5, 0.86, 1.2, 1.46].map((el, i) =>
        ringOn(el, 1.1 + (i === 0 ? 0.05 : 0), 12, i < 2 ? -0.18 : -0.06),
      );
      const inner = [1.46, 1.2, 0.86, 0.5].map((el) =>
        ringOn(el, 0.96, 12, el < 1 ? -0.18 : -0.06),
      );
      put("helm", h.headId, [shell([...rings, ...inner], true)], trim, "metal");
      const crest = Array.from({ length: 11 }, (_, i) => {
        const t = i / 10,
          pitch = lerp(0.73, 2.48, t);
        const az = pitch <= Math.PI / 2 ? 0 : Math.PI;
        const el = Math.min(pitch, Math.PI - pitch);
        const seat = h.onHead(az, el, 1.025);
        const height = (0.027 + 0.2 * Math.sin(Math.PI * t) ** 1.4) * need(h.axes[1]) * size;
        const spine = h
          .onHead(az, el, 1.1)
          .addScaledVector(h.up, height)
          .addScaledVector(h.facing, -height * 0.23);
        const halfWidth = need(h.axes[0]) * (0.012 + 0.033 * Math.sin(Math.PI * t));
        return [
          seat.clone().addScaledVector(h.across, halfWidth),
          spine.clone().addScaledVector(h.across, halfWidth * 0.24),
          spine.clone().addScaledVector(h.across, -halfWidth * 0.24),
          seat.clone().addScaledVector(h.across, -halfWidth),
        ];
      });
      const binding = shell(
        [
          ringOn(0.49, 1.153, 16, -0.18),
          ringOn(0.56, 1.155, 16, -0.18),
          ringOn(0.56, 1.085, 16, -0.18),
          ringOn(0.49, 1.085, 16, -0.18),
        ],
        true,
      );
      put("helm crest", h.headId, [shell(crest), binding], cloth);
    } else {
      const el = bare ? 0.64 : 0.55;
      put(
        "circlet",
        h.headId,
        [
          shell(
            [
              ringOn(el - 0.07, 0.82, 16, -0.11),
              ringOn(el - 0.07, 1.006, 16, -0.11),
              ringOn(el + 0.075, 1.017, 16, -0.11),
              ringOn(el + 0.075, 0.82, 16, -0.11),
            ],
            true,
          ),
          gem(h.onHead(0, el - 0.14, 1.08), h.outward(0, el - 0.14), h.hs * 0.085, 0.9),
        ],
        trim,
        "metal",
      );
      if (style === "plume" && bare) {
        const root = h.onHead(0.9, el + 0.1, 1.05);
        const lean = h.up
          .clone()
          .multiplyScalar(0.8)
          .addScaledVector(h.facing, -0.55)
          .addScaledVector(h.across, 0.2)
          .normalize();
        const path = [0, 0.3, 0.62, 1].map((t) =>
          root
            .clone()
            .addScaledVector(lean, t * h.hs * 0.95 * size)
            .addScaledVector(h.facing, -t * t * h.hs * 0.3),
        );
        put(
          "plume",
          h.headId,
          [
            blade(
              path,
              [0.03, 0.12, 0.13, 0.02].map((w) => w * h.hs),
              h.across,
              h.hs * 0.04,
            ),
          ],
          cloth,
        );
      }
    }
  }
  const chestGem = () => {
    const t = upright ? 0.72 : 0.9;
    const at = trunk(t, Math.PI, 1.04, girth * 0.07),
      f = spine.at(t);
    const n = at.clone().sub(f.centre).normalize();
    put("medallion", "body", [gem(at, n, girth * 0.2 * size, 0.6)], trim, "metal");
  };
  function tunic(
    id: string,
    top: number,
    hem: number,
    flare: number,
    color: string,
    surface = "canvas",
    scallop = 0,
  ) {
    const sides = 16,
      count = scallop ? 5 : 4;
    const point = (v: number, a: number, lift = 0) => {
      const wave = Math.cos(a * count + 0.6 * Math.sin(a * 2) + v * 0.7);
      const hemDrop = (scallop + 0.014) * Math.cos(a * 3 + 0.4) - 0.032 * Math.sin(a - 0.6);
      const station = lerp(top, hem, v) + v * v * hemDrop;
      const pleat = (0.035 + 0.085 * v) * (wave + 0.28 * Math.cos(2 * a * count + 0.5));
      const stand = 0.065 + flare * v ** 1.9 + pleat * v + lift;
      return trunk(station, a, 1.015, girth * stand);
    };
    const ring = (v: number, lift = 0) =>
      Array.from({ length: sides }, (_, j) => point(v, (j * 2 * Math.PI) / sides, lift));
    const clothRings = [
      ring(0),
      ring(0.15),
      ring(0.36),
      ring(0.58),
      ring(0.79),
      ring(0.94),
      ring(1),
      ring(1, -0.036),
      ring(0.78, -0.055),
      ring(0.52, -0.055),
      ring(0.24, -0.055),
      ring(0, -0.042),
    ];
    if (!put(id, "body", [shell(clothRings, true)], color, surface)) return;
    put(
      id + " border",
      "body",
      [
        shell(
          [
            ring(0.915, 0.006),
            ring(0.94, 0.009),
            ring(0.98, 0.009),
            ring(0.993, 0.004),
            ring(0.98, -0.015),
            ring(0.915, -0.015),
          ],
          true,
        ),
      ],
      trim,
      "canvas",
    );

    if (id === "robe" || id === "surcoat") {
      const at = (lift: number) => (v: number, u: number) => {
        const centre = Math.PI + lerp(-0.95, 0.5, v);
        const angle = centre + (u - 0.5) * (0.32 + 0.37 * v);
        return point(0.035 + v * 0.77, angle, lift + 0.026 * (1 - 4 * (u - 0.5) ** 2));
      };
      put(
        id + " facing",
        "body",
        [slab(grid(12, 4, at(0.052)), grid(12, 4, at(0.007)))],
        leather,
        "leather",
      );
    }
  }
  const waist = upright ? 0.24 : 0.5;
  const hips = tailed ? 0.04 : -0.06;
  const kindOf = dress.kind,
    shaped = (dress.cut ?? 0) >= 2;
  const limbBands = (
    name: string,
    color: string,
    surface: string,
    from?: number,
    to?: number,
    thick?: number,
    flare?: number,
  ) => bands(arms.length ? arms : legs, color, surface, name, from, to, thick, flare);
  const studs = (limbs: Anchor[]) => {
    for (const a of limbs.slice(0, 2)) {
      const at = a.root
        .clone()
        .add(new Vector3(a.side * a.r0 * 1.25 * size, a.r0 * 1.55 * size, 0));
      put(
        a.id + " stud",
        a.upper,
        [gem(at, new Vector3(a.side * 0.54, 0.84, 0), a.r0 * 0.36 * size, 1.5)],
        cloth,
        "plain",
      );
    }
  };

  if (kindOf === "herald") {
    collar(true, 1.2);
    if (upright && free(0.5, 0.3)) {
      tunic("surcoat", 0.7, hips + 0.08, 0.34, cloth, "canvas", 0.012);
      put("sash", "body", [belt(waist + 0.06, half * 1.3)], trim, "metal");
    } else if (!upright && free(0.5, 0.2) && bareBack) mantle(0.76, 0.26, [1.2, 1.75], 0.1, 0.025);
    else if (free(0.7)) put("sash", "body", [belt(0.7, half * 1.8)], cloth);
    if (arms.length) guards(arms, 1, trim, "metal", "pauldron");
    chestGem();
    if (dress.layers > 1) limbBands(arms.length ? "bracer" : "anklet", trim, "metal", 0.42, 0.86);
    if (dress.layers > 2) headpiece("plume");
  } else if (kindOf === "warden") {
    collar(false, 0.6, !(shaped && upright && free(0.66, 0.16)));
    if (!upright && free(0.56, 0.22)) {
      const lames: Shell[] = [];
      for (const sign of [-1, 1])
        for (let tier = 0; tier < 3; tier++) {
          const point = (inset: number) => (s: number, u: number) => {
            const front = 0.81 - tier * 0.15;
            const corner = Math.abs(2 * u - 1);
            const station = front - 0.205 * s + 0.034 * s * corner * corner;
            const a = sign * (0.17 + u * (1.5 - 0.14 * corner) + 0.08 * s);
            const keel = 0.061 * (1 - corner * corner) * Math.sin(s * Math.PI);
            return trunk(
              station,
              a,
              1.03,
              girth * (0.066 + 0.08 * s + (0.06 * tier) / 3 + keel + inset),
            );
          };
          lames.push(slab(grid(3, 5, point(0)), grid(3, 5, point(-0.047))));
        }
      put("lamellar barding", "body", lames, trim, "metal");
    } else if (free(0.66, 0.16))
      put(
        "cuirass",
        "body",
        [
          shaped
            ? breastplate(0.5, 0.84)
            : shell(
                [
                  loopAt(0.5, 0.95, 0),
                  loopAt(0.5, 1.04, girth * 0.09),
                  loopAt(0.62, 1.05, girth * 0.14),
                  loopAt(0.74, 1.05, girth * 0.13),
                  loopAt(0.8, 1.04, girth * 0.08),
                  loopAt(0.8, 0.95, 0),
                ],
                true,
              ),
        ],
        trim,
        "metal",
      );
    const shouldered = arms.length ? arms : legs.filter((a) => a.station > 0.5);
    if (arms.length || upright) {
      guards(
        shouldered.length ? shouldered : legs,
        2,
        trim,
        "metal",
        arms.length ? "pauldron" : "guard",
      );
      studs(shouldered.length ? shouldered : legs);
    } else if (bareBack && free(0.4, 0.12))
      put(
        "crupper",
        "body",
        [
          shell(
            [
              loopAt(0.26, 0.95, 0),
              loopAt(0.26, 1.04, girth * 0.09),
              loopAt(0.36, 1.05, girth * 0.13),
              loopAt(0.44, 1.04, girth * 0.08),
              loopAt(0.44, 0.95, 0),
            ],
            true,
          ),
        ],
        trim,
        "metal",
      );
    if (upright && free(waist)) {
      tunic("tassets", waist + 0.1, hips + 0.1, 0.34, cloth, "canvas", 0.02);
      put("belt", "body", [belt(waist + 0.09, half * 1.2)], leather, "leather");
    }
    if (dress.layers > 1) {
      if (shaped) shins(legs, trim, "greave");
      else bands(legs, trim, "metal", "greave", 0.3, 0.9, 1.4, 0.12);
      if (arms.length) bands(arms, leather, "leather", "bracer", 0.35, 0.85);
    }
    if (dress.layers > 2) headpiece("helm");
  } else if (kindOf === "sage") {
    collar(true, 1.6);
    if (upright && free(0.45, 0.35)) {
      if (shaped && plan.limbs.some((l) => l.kind === "leg" && (l.fan ?? 0) > 100))
        tunic("capelet", 0.8, 0.44, 0.3, cloth, "canvas", 0.03);
      else {
        tunic("robe", 0.72, hips - 0.04, 0.44, cloth);
      }
    } else if (free(0.72)) put("stole", "body", [belt(0.72, half * 2.4)], cloth);
    if (!upright && bareBack && free(0.5, 0.3)) mantle(0.84, 0.3, [1.25, 1.7], 0.14, 0.03);
    chestGem();
    if (dress.layers > 1 && arms.length) bands(arms, cloth, "canvas", "cuff", 0.5, 0.95, 1.5, 0.5);
    if (dress.layers > 2) headpiece("wrap");
  } else if (kindOf === "nomad") {
    collar(false, 1);
    if (upright && free(0.6, 0.28)) {
      tunic("poncho", 0.86, 0.42, 0.5, cloth, "canvas", 0.03);
    } else if (!upright && bareBack && free(0.5, 0.25))
      mantle(0.74, 0.28, [1.25, 1.8], 0.12, 0.035);
    else if (free(0.6)) put("cinch", "body", [belt(0.6, half * 1.8)], cloth);
    if (!upright && free(0.76, 0.02))
      put("girth strap", "body", [belt(0.76, half * 0.8)], leather, "leather");
    if (dress.layers > 1) bands(legs, cloth, "canvas", "wrap", 0.25, 0.8, 1.36, 0.05);
    if (dress.layers > 2) headpiece("circlet");
  } else if (kindOf === "ranger") {
    const side = draw() < 0.5 ? 1 : -1;
    const wave = (a: number) => 0.11 * side * Math.sin(a) + 0.03 * Math.cos(a);
    if (free(0.62, 0.14)) {
      put("bandolier", "body", [belt(0.62, half * 1.25, 0.012 * k, wave)], leather, "leather");
      const at = trunk(0.62 + wave(Math.PI), Math.PI, 1.04, girth * 0.1),
        f = spine.at(0.62);
      put(
        "badge",
        "body",
        [gem(at, at.clone().sub(f.centre).normalize(), girth * 0.17 * size, 0.5)],
        trim,
        "metal",
      );
    }
    collar(true, 0.7);
    if (upright && free(waist)) {
      tunic("kilt", waist + 0.08, hips + 0.06, 0.38, cloth, "canvas", 0.025);
      put("belt", "body", [belt(waist + 0.07, half * 1.2)], leather, "leather");
    } else if (!upright && bareBack && free(0.45, 0.2)) mantle(0.6, 0.34, [1.0, 1.4], 0.08, 0.02);
    if (dress.layers > 1)
      limbBands(arms.length ? "bracer" : "wrap", leather, "leather", 0.38, 0.86);
    if (dress.layers > 2) headpiece("plume");
  }
}
