import { Euler, MathUtils, Quaternion, Vector3 } from "three";
import { randomStream } from "./random.js";

// Worn layers of a creature: a small ensemble of fitted pieces that follow
// the anatomy the plan built. Every piece is an ordinary rigid cage region
// carried by the trunk, the neck, the head or one limb segment, so it can be
// selected, recoloured, sculpted or removed like any other region.
const { clamp, lerp } = MathUtils;
const hexColor = (v, fallback) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;

export const dressDevices = ["none", "swallow", "oak", "sunburst", "tide", "compass"];
export const dressKinds = ["none", "herald", "warden", "sage", "nomad", "ranger"];
// Cloth and trim that were chosen together.
export const dressLiveries = [
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

export function readDress(raw = {}) {
  const kind = dressKinds.includes(raw.kind) ? raw.kind : "none";
  const number = (v, a, b, base) => (Number.isFinite(v) ? clamp(v, a, b) : base);
  return {
    kind,
    ...(dressDevices.includes(raw.device) && raw.device !== "none" ? { device: raw.device } : {}),
    color: hexColor(raw.color, dressLiveries[0][0]),
    trim: hexColor(raw.trim, dressLiveries[0][1]),
    // 1 keeps the signature piece, 2 adds limb pieces, 3 adds a headpiece.
    layers: Math.round(number(raw.layers, 1, 3, 3)),
    size: number(raw.size, 0.7, 1.4, 1),
    // A station along the spine that a carried pack occupies.
    ...(Number.isFinite(raw.clear) ? { clear: clamp(raw.clear, 0, 1) } : {}),
    // Cut 2 shapes armour to the animal. Cut 3 also fits a breastplate on inclined bipeds.
    ...([2, 3].includes(raw.cut) ? { cut: raw.cut } : {}),
    seed: Number.isInteger(raw.seed) ? clamp(raw.seed, 0, 4294967295) : 1,
  };
}

const hueOf = (hex) => {
  const n = parseInt(hex.slice(1), 16),
    r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const light = (max + min) / 2;
  if (d < 0.04) return [0, 0, light];
  const h =
    max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, d / (1 - Math.abs(2 * light - 1) + 1e-6), light];
};

// Choose an ensemble that suits the animal: what it can wear depends on its
// posture, its arms and what already grows on its back.
export function drawDress(plan, seed, odds = 0.45) {
  const draw = randomStream((seed ^ 0x5d2e61c7) >>> 0);
  const roll = draw();
  const legs = plan.limbs.filter((l) => l.kind === "leg");
  if (!legs.length || roll > odds) return null;
  const arms = plan.limbs.some((l) => l.kind === "arm");
  const upright = plan.spine.front > 55;
  const bareBack = plan.back.kind === "none";
  const options = upright
    ? arms
      ? ["herald", "warden", "sage", "ranger", "nomad", "sage"]
      : ["sage", "herald", "ranger", "nomad"]
    : arms
      ? ["warden", "ranger", "herald", "nomad"]
      : ["nomad", "nomad", "herald", "warden"];
  let kind = options[Math.floor(draw() * options.length)];
  if (kind === "sage" && !bareBack && !upright) kind = "herald";
  const [bodyHue, bodySat, bodyLight] = hueOf(plan.skin.base);
  // Cloth has to stand apart from the hide in hue or in value.
  const apart = dressLiveries.filter(([cloth]) => {
    const [h, s, l] = hueOf(cloth);
    const turn = Math.abs(((h - bodyHue + 540) % 360) - 180);
    return (s > 0.2 && bodySat > 0.15 && turn > 70) || Math.abs(l - bodyLight) > 0.27;
  });
  const pool = apart.length ? apart : dressLiveries;
  const [color, trim] = pool[Math.floor(draw() * pool.length)];
  return readDress({
    kind,
    device: { herald: "swallow", sage: "oak", nomad: "sunburst", warden: "tide", ranger: "compass" }[kind],
    color,
    trim,
    layers: draw() < 0.7 ? 3 : 2,
    size: lerp(0.9, 1.15, draw()),
    seed: Math.floor(draw() * 4294967296),
    cut: 3,
  });
}

// Closed loops of points become one shell. A closed path joins the last
// loop back to the first, like a ring; an open path is capped.
function shell(rings, closedPath = false) {
  const vertices = rings.flat(),
    faces = [],
    sides = rings[0].length,
    rows = rings.length;
  if (!closedPath) {
    const centre = (row) =>
      rings[row].reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / sides);
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
// A sheet with thickness from two matching grids of points.
function slab(outer, inner) {
  const m = outer.length,
    n = outer[0].length,
    vertices = [...outer.flat(), ...inner.flat()],
    faces = [];
  const o = (i, j) => i * n + j,
    q = (i, j) => m * n + i * n + j;
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
const grid = (m, n, at) =>
  Array.from({ length: m }, (_, i) =>
    Array.from({ length: n }, (_, j) => at(i / (m - 1), j / (n - 1), i, j)),
  );
function basis(axis) {
  const ref = Math.abs(axis.y) > 0.85 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const u = new Vector3().crossVectors(ref, axis).normalize(),
    v = new Vector3().crossVectors(axis, u).normalize();
  return [u, v];
}
// A faceted stone or stud seated on a surface.
function gem(at, normal, size, tall = 0.7) {
  const [u, v] = basis(normal);
  const ring = (h, r) =>
    Array.from({ length: 6 }, (_, i) =>
      at
        .clone()
        .addScaledVector(normal, h * size)
        .addScaledVector(u, r * size * Math.cos((i * Math.PI) / 3))
        .addScaledVector(v, r * size * Math.sin((i * Math.PI) / 3)),
    );
  return shell([ring(-0.3, 0.8), ring(0.1 * tall, 1), ring(tall, 0.42)]);
}
// A band around a straight limb segment or a neck.
function cuff(a, b, ra, rb, from, to, thick, flare = 0, sides = 10) {
  const axis = b.clone().sub(a).normalize(),
    [u, v] = basis(axis);
  const ring = (t, r) =>
    Array.from({ length: sides }, (_, i) =>
      a
        .clone()
        .lerp(b, t)
        .addScaledVector(u, r * Math.cos((i * 2 * Math.PI) / sides))
        .addScaledVector(v, r * Math.sin((i * 2 * Math.PI) / sides)),
    );
  const r = (t) => lerp(ra, rb, t);
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
// A flattened blade along a path: a plume, a fin on a helm or a pennant.
function blade(points, widths, normal, thick) {
  const rings = points.map((p, i) => {
    const along = (points[Math.min(points.length - 1, i + 1)] ?? p)
      .clone()
      .sub(points[Math.max(0, i - 1)])
      .normalize();
    const side = new Vector3().crossVectors(along, normal).normalize();
    const w = widths[i],
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
export const dressRegionCount = (dress) => needed[dress?.kind ?? "none"] ?? 0;

// Build the ensemble. `ctx` carries the measured anatomy: the spine frame,
// limb anchors and head frames in world metres, and `emit` to add a region.
export function dressCreature(ctx) {
  const { plan, spine, anchors, heads, emit, room } = ctx;
  const dress = plan.dress;
  if (!dress || dress.kind === "none") return;
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
  // An inclined two-legged animal carries the breastplate over its sternum.
  // A four-legged trunk needs a free underside between the front legs.
  const upright = chestRise > .72 || (dress.cut === 3 && dress.kind === "warden"
    && arms.length > 0 && legs.length === 2 && chestRise > .49);
  const winged = plan.limbs.some((l) => l.kind === "wing");
  const bareBack = plan.back.kind === "none" && !winged;
  const tailed = plan.tail.kind !== "none";
  const length = plan.spine.length * k;
  // The ellipsoids that grow at limb roots can extend past the trunk rings.
  // Cast through the actual anatomy once per garment sample in the bind pose.
  const supports = (ctx.supports ?? []).map(part => ({
    centre: new Vector3(...part.position),
    radius: new Vector3(...part.size).multiplyScalar(0.5),
    inverse: new Quaternion().setFromEuler(new Euler(...part.rotation.map(MathUtils.degToRad))).invert(),
  }));
  const bodyDepth = (origin, direction, depth) => {
    for (const { centre, radius, inverse } of supports) {
      const offset = origin.clone().sub(centre).applyQuaternion(inverse).divide(radius);
      const ray = direction.clone().applyQuaternion(inverse).divide(radius);
      const a = ray.lengthSq(), b = offset.dot(ray);
      const disc = b * b - a * (offset.lengthSq() - 1);
      if (disc >= 0) depth = Math.max(depth, (Math.sqrt(disc) - b) / a);
    }
    return depth;
  };
  // Limb roots carry shoulders and haunches that stand proud of the trunk.
  const proud = (t, angle) => {
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
  // A point around the trunk. Angle 0 is the back, pi the belly. Stations
  // below 0 continue straight past the hips, for a hem that hangs free.
  const trunk = (t, angle, r = 1, pad = 0) => {
    const f = spine.at(clamp(t, 0.1, 0.9)),
      g = spine.at(clamp(t, 0, 1));
    const reach = t < 0 ? t * length : t > 1 ? (t - 1) * length : 0;
    const [w, d] = t < 0.1 || t > 0.9 ? f.radius.map((v, i) => Math.max(v * 0.82, g.radius[i])) : g.radius;
    // Cinches and garments sit over the thickness of the dorsal plumage.
    const down = plan.back.kind === "contour plumage"
      ? girth * (0.07 + 0.11 * plan.back.height / plan.spine.girth)
        * MathUtils.smoothstep(Math.cos(angle), -0.64, -0.1)
        * MathUtils.smoothstep(t, 0.01, 0.17) * (1 - MathUtils.smoothstep(t, 0.87, 1))
      : 0;
    const extra = pad + down + proud(clamp(t, 0, 1), angle);
    const centre = g.centre.clone().addScaledVector(g.tangent, reach);
    const radial = g.dorsal.clone().multiplyScalar(d * Math.cos(angle));
    radial.x += w * Math.sin(angle);
    const depth = radial.length();
    radial.divideScalar(Math.max(0.00001, depth));
    return centre.addScaledVector(radial, bodyDepth(centre, radial, depth) * r + extra);
  };
  const loopAt = (t, r, pad, sides = 14, wave) =>
    Array.from({ length: sides }, (_, i) => {
      const angle = (i * 2 * Math.PI) / sides;
      return trunk(t + (wave ? wave(angle) : 0), angle, r, pad);
    });
  const belt = (t, half, pad = 0.012 * k, wave) =>
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
  const put = (id, parent, shells, color, surface = "canvas") => {
    if (made >= cap || !room()) return false;
    made++;
    emit("dress " + id, parent, shells, color, surface);
    return true;
  };
  // Stations that keep clear of a carried pack and its harness.
  const free = (t, half = 0.06) => dress.clear === undefined || Math.abs(t - dress.clear) > 0.2 + half;
  const head = heads.length === 1 ? heads[0] : null;
  const half = clamp((0.05 * girth) / Math.max(0.2, length) / 0.2, 0.018, 0.05) * size;

  // The collar closes every ensemble at the neck.
  function collar(scallops, drop = 1, yoke = true) {
    if (!head) return;
    const h = head;
    const neckLength = h.neckEnd.distanceTo(h.neckRoot);
    if (neckLength > 1.5 * h.nr0) {
      const axis = h.neckEnd.clone().sub(h.neckRoot).normalize(),
        [u, v] = basis(axis);
      const sides = 12;
      const ring = (t, r, wave = 0) =>
        Array.from({ length: sides }, (_, i) => {
          const a = (i * 2 * Math.PI) / sides;
          const rr = r * (1 + wave * (i % 2 ? 1 : -0.3));
          return h.neckRoot
            .clone()
            .lerp(h.neckEnd, t)
            .addScaledVector(u, rr * Math.cos(a))
            .addScaledVector(v, rr * Math.sin(a));
        });
      const r = (t) => lerp(h.nr0, h.nr1, Math.min(1, t * 1.3));
      const top = clamp((.69*h.nr0*size)/neckLength + .09,.17,.49);
      put(
        "collar",
        h.neckId,
        [
          shell(
            [
              ring(top, r(top) * 0.9),
              ring(top, r(top) * 1.2),
              ring(.14, r(.14) * (1.18+.15*drop), scallops ? .09 : 0),
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
        put("collar clasp", h.neckId, [gem(front, h.facing.clone().setY(0.2).normalize(), r(top) * 0.34)], trim, "metal");
    } else if (yoke) {
      // A head set on the shoulders wears a yoke on the front of the trunk.
      const wave = scallops ? (a) => 0.02 * Math.cos(6 * a) : null;
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
  // A plate over the root of a limb: a pauldron on an arm, a guard on a haunch.
  function guards(limbs, tiers, color, surface, name) {
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
      const shells = [];
      for (let tier = 0; tier < tiers; tier++) {
        const R = a.r0 * (1.43 - 0.15 * tier) * Math.min(size, 1.1),
          centre = a.root
            .clone()
            .addScaledVector(out, a.r0 * (0.17 + 0.34 * tier))
            .addScaledVector(up, a.r0 * (0.28 - 0.55 * tier));
        const at = (r) => (s, t) => {
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
  // A plate over the front of a shin, flared at the knee.
  function shins(limbs, color, name) {
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
      const at = (scale) => (s, t) => {
        const u = lerp(0.2, 0.9, s),
          angle = lerp(-1.7, 1.7, t) * (1 - 0.25 * s),
          r = lerp(a.r1, a.r2, u) * scale * (1 + 0.3 * (1 - s) ** 3) * (0.94 + 0.06 * size);
        return a.mid.clone().lerp(a.end, u).addScaledVector(fore, r * Math.cos(angle) * (1 + 0.12 * Math.cos(angle))).addScaledVector(flank, r * Math.sin(angle));
      };
      put(a.id + " " + name, a.lower, [slab(grid(5, 7, at(1.42)), grid(5, 7, at(1.1)))], color, "metal");
    }
  }
  // A breastplate: its lower edge runs down to a point over the belly, its
  // top is cut away under the arms and a keel stands along the breastbone.
  function breastplate(lo, hi) {
    const front = (a) => (1 - Math.cos(a)) / 2;
    const ring = (v, r, pad) =>
      Array.from({ length: 16 }, (_, i) => {
        const a = (i * 2 * Math.PI) / 16,
          f = front(a);
        const low = lo - 0.09 * f ** 3 + 0.05 * (1 - f) ** 2,
          high = hi + 0.03 * f ** 2 - 0.05 * Math.sin(a) ** 2;
        const keel = pad ? 0.07 * f ** 6 * Math.sin(Math.PI * Math.min(1, v * 1.1)) : 0;
        return trunk(lerp(low, high, v), a, r, girth * (pad + keel));
      });
    return shell([ring(0, 0.95, 0), ring(0, 1.04, 0.07), ring(0.3, 1.05, 0.13), ring(0.7, 1.05, 0.13), ring(1, 1.04, 0.07), ring(1, 0.95, 0)], true);
  }
  // Bands on the lower segment of a limb.
  function bands(limbs, color, surface, name, from = 0.3, to = 0.82, thick = 1.34, flare = 0.2) {
    const done = new Set();
    for (const a of limbs) {
      const key = a.id.replace(/^(left|right) /, "");
      if (done.size >= 2 && !done.has(key)) continue;
      done.add(key);
      put(a.id + " " + name, a.lower, [cuff(a.mid, a.end, a.r1, a.r2, from, to, thick * (0.94 + 0.06 * size), flare)], color, surface);
    }
  }
  // A cloak for an upright back or a saddle cloth for a level one.
  function mantle(front, hem, wide, flare, hemWave = 0) {
    const m = 7,
      n = 9;
    const at = (lift) => (s, t, i, j) => {
      const station = lerp(front, hem, s);
      const spread = lerp(wide[0], wide[1], s ** 0.7);
      const angle = lerp(-spread, spread, t);
      const edge = hemWave && i === m - 1 ? (j % 2 ? hemWave : -0.2 * hemWave) : 0;
      return trunk(station - edge, angle, 1.02, girth * (0.05 + flare * s * s + lift));
    };
    const rows = (lift) => grid(m, n, at(lift));
    const ok = put("mantle", "body", [slab(rows(0.045), rows(0))], cloth);
    // A border in the trim colour lies over the hem.
    const hemAt = (lift) => (s, t, i, j) => {
      const station = lerp(lerp(front, hem, 0.84), hem, s);
      const spread = lerp(wide[0], wide[1], (0.84 + 0.16 * s) ** 0.7);
      const angle = lerp(-spread, spread, t);
      const edge = hemWave && i === 2 ? (j % 2 ? hemWave : -0.2 * hemWave) : 0;
      const ss = 0.84 + 0.16 * s;
      return trunk(station - edge, angle, 1.02, girth * (0.05 + flare * ss * ss + lift));
    };
    if (ok) put("mantle border", "body", [slab(grid(3, n, hemAt(0.075)), grid(3, n, hemAt(0.035)))], trim);
    return ok;
  }
  // Headwear. A bare crown takes a cap; horns, ears or antennae take a band.
  function headpiece(style) {
    if (!head || plan.head.eyePlace === "top" || plan.head.crest === "crown") return;
    const h = head;
    const bare = plan.head.crest === "none" && plan.head.stalks < 0.005;
    const ringOn = (el, scale, sides = 12, tilt = 0) =>
      Array.from({ length: sides }, (_, i) => {
        const az = (i * 2 * Math.PI) / sides;
        return h.onHead(az, el + tilt * Math.cos(az), scale);
      });
    if (style === "wrap") {
      // Two bias-cut swathes cross above the eyes. At an ear or horn the
      // top stays open, while a smooth crown carries the gathered cap.
      const base = plan.head.eyes > 2 ? 0.83 : 0.69, wraps = [];
      for (const turn of [0, 1]) {
        const band = [[-.115,1.015],[-.085,1.17],[.074,1.16],[.115,1.01]];
        const rows = band.map(([edge, radius]) => Array.from({length:16}, (_,i) => {
          const az = i*2*Math.PI/16;
          const el = base + .16*turn + edge + (.10+.03*turn)*Math.sin(az*(turn ? -1 : 1)+.38)
            - .085*Math.cos(az-Math.PI);
          return h.onHead(az, el, radius + .035*turn);
        }));
        wraps.push(shell(rows, true));
      }
      if (bare) wraps.push(shell([ringOn(1.03,1.08,14),ringOn(1.20,1.22,14),
        ringOn(1.40,1.27,14),ringOn(1.55,1.23,14)]));
      put("folded headwrap", h.headId, wraps, cloth, "canvas");
      const az = .54, el = base+.05, normal = h.outward(az,el);
      const badge = h.onHead(az,el,1.15);
      const pin = gem(badge,normal,.065*h.hs,1);
      const stalk = h.up.clone().addScaledVector(h.across,.27).normalize();
      const vanes = [pin];
      for (const lean of [-.22,.12]) {
        const points = [], widths = [];
        for (let j=0; j<=12; j++) {
          const t=j/12;
          points.push(badge.clone().addScaledVector(stalk,t*h.hs*(.61+lean*.2))
            .addScaledVector(h.across,lean*t*t*h.hs).addScaledVector(h.facing,-.27*t*t*h.hs));
          widths.push(h.hs*(.009 + .072*Math.sin(Math.PI*t)**.75*(j%3===1?.7:1)));
        }
        vanes.push(blade(points,widths,normal,h.hs*.016));
      }
      put("feather pin",h.headId,vanes,trim,"plain");
    } else if (style === "helm" && bare) {
      // Rings from the brim to the crown and back along the inside.
      const rings = [0.5, 0.86, 1.2, 1.46].map((el, i) => ringOn(el, 1.1 + (i === 0 ? 0.05 : 0), 12, i < 2 ? -0.18 : -0.06));
      const inner = [1.46, 1.2, 0.86, 0.5].map((el) => ringOn(el, 0.96, 12, el < 1 ? -0.18 : -0.06));
      put("helm", h.headId, [shell([...rings, ...inner], true)], trim, "metal");
      // The crest grows from a keel fitted along the sagittal arc. Its lower
      // edge continues inside the shell from the brow to the back of the head.
      const crest = Array.from({ length: 11 }, (_, i) => {
        const t = i / 10, pitch = lerp(0.73, 2.48, t);
        const az = pitch <= Math.PI / 2 ? 0 : Math.PI;
        const el = Math.min(pitch, Math.PI - pitch);
        const seat = h.onHead(az, el, 1.025);
        const height = (0.027 + 0.20 * Math.sin(Math.PI*t)**1.4) * h.axes[1] * size;
        const spine = h.onHead(az, el, 1.10).addScaledVector(h.up, height)
          .addScaledVector(h.facing, -height * 0.23);
        const halfWidth = h.axes[0] * (0.012 + 0.033 * Math.sin(Math.PI*t));
        return [seat.clone().addScaledVector(h.across, halfWidth),
          spine.clone().addScaledVector(h.across, halfWidth*0.24),
          spine.clone().addScaledVector(h.across, -halfWidth*0.24),
          seat.clone().addScaledVector(h.across, -halfWidth)];
      });
      const binding = shell([ringOn(.49,1.153,16,-.18),ringOn(.56,1.155,16,-.18),
        ringOn(.56,1.085,16,-.18),ringOn(.49,1.085,16,-.18)],true);
      put("helm crest", h.headId, [shell(crest), binding], cloth);
    } else {
      const el = bare ? .64 : .55;
      put(
        "circlet",
        h.headId,
        [
          shell([ringOn(el-.07,.82,16,-.11),ringOn(el-.07,1.006,16,-.11),ringOn(el+.075,1.017,16,-.11),ringOn(el+.075,.82,16,-.11)], true),
          gem(h.onHead(0, el - 0.14, 1.08), h.outward(0, el - 0.14), h.hs * 0.085, 0.9),
        ],
        trim,
        "metal",
      );
      if (style === "plume" && bare) {
        const root = h.onHead(0.9, el + 0.1, 1.05);
        const lean = h.up.clone().multiplyScalar(0.8).addScaledVector(h.facing, -0.55).addScaledVector(h.across, 0.2).normalize();
        const path = [0, 0.3, 0.62, 1].map((t) =>
          root.clone().addScaledVector(lean, t * h.hs * 0.95 * size).addScaledVector(h.facing, -t * t * h.hs * 0.3),
        );
        put("plume", h.headId, [blade(path, [0.03, 0.12, 0.13, 0.02].map((w) => w * h.hs), h.across, h.hs * 0.04)], cloth);
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
  // A garment around the trunk from a top station down to a hem. The hem
  // stands off the body, so legs and a tail leave it freely.
  function tunic(id, top, hem, flare, color, surface = "canvas", scallop = 0) {
    const sides = 16, count = scallop ? 5 : 4;
    // These are sewn gores. Cloth hangs straighter over the hips but opens
    // below them, with one side gathered farther up than the other.
    const point = (v, a, lift = 0) => {
      const wave = Math.cos(a*count + .6*Math.sin(a*2) + v*.7);
      const hemDrop = (scallop+.014)*Math.cos(a*3+.4) - .032*Math.sin(a-.6);
      const station = lerp(top,hem,v) + v*v*hemDrop;
      const pleat = (.035+.085*v) * (wave + .28*Math.cos(2*a*count+.5));
      const stand = .065 + flare*v**1.9 + pleat*v + lift;
      return trunk(station,a,1.015,girth*stand);
    };
    const ring = (v,lift=0) => Array.from({length:sides},(_,j) => point(v,j*2*Math.PI/sides,lift));
    const clothRings = [ring(0),ring(.15),ring(.36),ring(.58),ring(.79),ring(.94),ring(1),ring(1,-.036),ring(.78,-.055),ring(.52,-.055),ring(.24,-.055),ring(0,-.042)];
    if (!put(id,"body",[shell(clothRings,true)],color,surface)) return;
    // Attachment follows the last two rows of the garment even at its folds.
    put(id+" border","body",[shell([ring(.915,.006),ring(.94,.009),ring(.98,.009),ring(.993,.004),
      ring(.98,-.015),ring(.915,-.015)],true)],trim,"canvas");

    if (id === "robe" || id === "surcoat") {
      // The overlapping front runs across the breast and fans out at the hip.
      const at = lift => (v,u) => {
        const centre = Math.PI + lerp(-.95,.5,v);
        const angle = centre + (u-.5)*(.32+.37*v);
        return point(.035+v*.77,angle,lift+.026*(1-4*(u-.5)**2));
      };
      put(id+" facing","body",[slab(grid(12,4,at(.052)),grid(12,4,at(.007)))],leather,"leather");
    }
  }
  const waist = upright ? 0.24 : 0.5;
  const hips = tailed ? 0.04 : -0.06;
  const kindOf = dress.kind,
    shaped = dress.cut >= 2;
  const limbBands = (name, color, surface, from, to, thick, flare) =>
    bands(arms.length ? arms : legs, color, surface, name, from, to, thick, flare);
  const studs = (limbs) => {
    for (const a of limbs.slice(0, 2)) {
      const at = a.root.clone().add(new Vector3(a.side * a.r0 * 1.25 * size, a.r0 * 1.55 * size, 0));
      put(a.id + " stud", a.upper, [gem(at, new Vector3(a.side * 0.54, 0.84, 0), a.r0 * 0.36 * size, 1.5)], cloth, "plain");
    }
  };

  if (kindOf === "herald") {
    // Court dress: a surcoat in the house colour under bright metal.
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
    // Armour: plate on the chest, the shoulders, the shins and the skull.
    collar(false, 0.6, !(shaped && upright && free(0.66, 0.16)));
    if (!upright && free(.56,.22)) {
      // Three shingled plates on each flank. Their top edges sit on the
      // shoulder blanket and the ridged outer lips overlap toward the tail.
      const lames = [];
      for (const sign of [-1,1]) for (let tier=0; tier<3; tier++) {
        const point = (inset) => (s,u) => {
          const front = .81-tier*.15;
          const corner = Math.abs(2*u-1);
          const station = front-.205*s + .034*s*corner*corner;
          const a = sign*(.17 + u*(1.50-.14*corner) + .08*s);
          const keel = .061*(1-corner*corner)*Math.sin(s*Math.PI);
          return trunk(station,a,1.03,girth*(.066+.08*s+.06*tier/3+keel+inset));
        };
        lames.push(slab(grid(3,5,point(0)),grid(3,5,point(-.047))));
      }
      put("lamellar barding","body",lames,trim,"metal");
    } else if (free(0.66, 0.16))
      put("cuirass", "body", [shaped ? breastplate(0.5, 0.84) : shell(
          [loopAt(0.5, 0.95, 0), loopAt(0.5, 1.04, girth * 0.09), loopAt(0.62, 1.05, girth * 0.14), loopAt(0.74, 1.05, girth * 0.13), loopAt(0.8, 1.04, girth * 0.08), loopAt(0.8, 0.95, 0)],
          true,
        )], trim, "metal");
    const shouldered = arms.length ? arms : legs.filter((a) => a.station > 0.5);
    if (arms.length || upright) {
      guards(shouldered.length ? shouldered : legs, 2, trim, "metal", arms.length ? "pauldron" : "guard");
      studs(shouldered.length ? shouldered : legs);
    } else if (bareBack && free(0.4, 0.12))
      // A level back takes a crupper plate over the hips instead.
      put("crupper", "body", [shell([loopAt(0.26, 0.95, 0), loopAt(0.26, 1.04, girth * 0.09), loopAt(0.36, 1.05, girth * 0.13), loopAt(0.44, 1.04, girth * 0.08), loopAt(0.44, 0.95, 0)], true)], trim, "metal");
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
    // Robes: a long gown, a cloak over the back and a jewelled band.
    collar(true, 1.6);
    if (upright && free(0.45, 0.35)) {
      // A ring of legs under the body leaves no room for a gown: a capelet
      // over the shoulders instead.
      if (shaped && plan.limbs.some((l) => l.kind === "leg" && l.fan > 100)) tunic("capelet", 0.8, 0.44, 0.3, cloth, "canvas", 0.03);
      else {
        tunic("robe", 0.72, hips - 0.04, 0.44, cloth);
      }
    } else if (free(0.72)) put("stole", "body", [belt(0.72, half * 2.4)], cloth);
    if (!upright && bareBack && free(0.5, 0.3)) mantle(0.84, 0.3, [1.25, 1.7], 0.14, 0.03);
    chestGem();
    if (dress.layers > 1 && arms.length) bands(arms, cloth, "canvas", "cuff", 0.5, 0.95, 1.5, 0.5);
    if (dress.layers > 2) headpiece("wrap");
  } else if (kindOf === "nomad") {
    // Travelling dress: a poncho or saddle cloth, straps and leg wraps.
    collar(false, 1);
    if (upright && free(0.6, 0.28)) {
      tunic("poncho", 0.86, 0.42, 0.5, cloth, "canvas", 0.03);
    } else if (!upright && bareBack && free(0.5, 0.25)) mantle(0.74, 0.28, [1.25, 1.8], 0.12, 0.035);
    else if (free(0.6)) put("cinch", "body", [belt(0.6, half * 1.8)], cloth);
    if (!upright && free(0.76, 0.02)) put("girth strap", "body", [belt(0.76, half * 0.8)], leather, "leather");
    if (dress.layers > 1) bands(legs, cloth, "canvas", "wrap", 0.25, 0.8, 1.36, 0.05);
    if (dress.layers > 2) headpiece("circlet");
  } else if (kindOf === "ranger") {
    // Field dress: a bandolier across the chest, a kilt and leather.
    const side = draw() < 0.5 ? 1 : -1;
    const wave = (a) => 0.11 * side * Math.sin(a) + 0.03 * Math.cos(a);
    if (free(0.62, 0.14)) {
      put("bandolier", "body", [belt(0.62, half * 1.25, 0.012 * k, wave)], leather, "leather");
      const at = trunk(0.62 + wave(Math.PI), Math.PI, 1.04, girth * 0.1),
        f = spine.at(0.62);
      put("badge", "body", [gem(at, at.clone().sub(f.centre).normalize(), girth * 0.17 * size, 0.5)], trim, "metal");
    }
    collar(true, 0.7);
    if (upright && free(waist)) {
      tunic("kilt", waist + 0.08, hips + 0.06, 0.38, cloth, "canvas", 0.025);
      put("belt", "body", [belt(waist + 0.07, half * 1.2)], leather, "leather");
    } else if (!upright && bareBack && free(0.45, 0.2)) mantle(0.6, 0.34, [1.0, 1.4], 0.08, 0.02);
    if (dress.layers > 1) limbBands(arms.length ? "bracer" : "wrap", leather, "leather", 0.38, 0.86);
    if (dress.layers > 2) headpiece("plume");
  }
}
