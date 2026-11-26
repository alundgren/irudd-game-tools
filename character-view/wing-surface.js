import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Float32BufferAttribute,
  Vector3,
} from "three";
import { randomStream } from "./random.js";

export const wingStructures = ["plain", "bat", "feather", "insect"];
export const wingPatterns = ["none", "tips", "bars", "eyespot"];
export const wingCounts = { bat: [2, 5], feather: [4, 12], insect: [3, 8] };

const rad = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
const ease = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const vec = (v, least) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => finite(n) && Math.abs(n) <= 12) &&
  Math.hypot(...v) >= least;
const hex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

export function validWing(w) {
  return (
    w &&
    typeof w === "object" &&
    !Array.isArray(w) &&
    wingStructures.slice(1).includes(w.structure) &&
    [1, -1].includes(w.side) &&
    vec(w.span, 0.01) &&
    vec(w.back, 0.005) &&
    finite(w.bone) &&
    w.bone >= 0.0005 &&
    w.bone <= 1 &&
    [w.bend, w.notch, w.point].every((v) => finite(v) && v >= 0 && v <= 1) &&
    Number.isInteger(w.count) &&
    w.count >= 2 &&
    w.count <= 12 &&
    wingPatterns.includes(w.pattern) &&
    Number.isInteger(w.seed) &&
    w.seed >= 0 &&
    w.seed <= 0xffffffff &&
    [w.dark, w.pale, w.limb].every(hex)
  );
}

function frameOf(w) {
  const span = new Vector3(...w.span),
    L = span.length(),
    s = span.clone().divideScalar(L);
  const back = new Vector3(...w.back),
    C = back.length(),
    c = back.clone().addScaledVector(s, -back.dot(s));
  if (c.lengthSq() < 1e-10)
    c.set(0, 0, -1).addScaledVector(s, s.z);
  c.normalize();
  const n = new Vector3().crossVectors(s, c).multiplyScalar(w.side);
  const droop = { bat: 0.1, feather: 0.13, insect: 0.04 }[w.structure];
  const rest = (u, v) =>
    0.05 * L * Math.sin(Math.PI * clamp(u / L, 0, 1)) - (droop * v * v) / C;
  return { L, C, s, c, n, rest };
}
const place = (f, [u, v, h]) =>
  new Vector3()
    .addScaledVector(f.s, u)
    .addScaledVector(f.c, v)
    .addScaledVector(f.n, h);

function featherPlan(w, f) {
  const { L, C } = f,
    b = w.bend;
  const S = [0, 0],
    E = [0.22 * L, 0.02 * L + 0.09 * L * b],
    W = [0.47 * L, -(0.01 * L + 0.13 * L * b)],
    H = [0.66 * L, W[1] + 0.035 * L];
  const np = clamp(w.count, 4, 12),
    feathers = [];
  const out = (7 - 11 * w.notch) * rad,
    inner = 64 * rad;
  const peak = lerp(3.2, 0.5, w.point) * ((np - 1) / 8),
    shortfall = lerp(0.24, 0.05, w.point);
  const fan = [];
  for (let j = 0; j < np; j++) {
    const t = np === 1 ? 0 : j / (np - 1),
      base = [lerp(H[0], W[0], t), lerp(H[1], W[1], t)],
      phi = lerp(out, inner, t ** 0.9);
    fan.push({ base, phi, t });
  }
  const within = (C - W[1]) / Math.sin(inner);
  const share = (j) =>
    j <= peak ? 1 - shortfall * ((peak - j) / Math.max(peak, 1e-6)) ** 1.6 : 1;
  let longest = Infinity;
  for (let j = 0; j < np && j <= Math.ceil(peak); j++)
    longest = Math.min(
      longest,
      (L - fan[j].base[0]) / (share(j) * Math.cos(fan[j].phi)),
    );
  for (let j = 0; j < np; j++) {
    const length =
      j <= peak
        ? longest * share(j)
        : lerp(longest, within, ((j - peak) / Math.max(1e-6, np - 1 - peak)) ** 1.2);
    feathers.push({ ...fan[j], length, kind: "primary", outer: j });
  }
  const forearm = Math.hypot(W[0] - E[0], W[1] - E[1]),
    hand = Math.hypot(H[0] - W[0], H[1] - W[1]);
  const ns = clamp(Math.round(((np * forearm) / hand) * 0.72), 4, 14);
  for (let i = 0; i < ns; i++) {
    const t = (i + 0.7) / (ns + 0.2),
      base = [lerp(W[0], E[0], t), lerp(W[1], E[1], t)],
      phi = lerp(70, 89, t) * rad;
    feathers.push({ base, phi, length: (C - base[1]) / Math.sin(phi), kind: "secondary" });
  }
  const nt = clamp(Math.round(ns * 0.4), 2, 4);
  for (let i = 0; i < nt; i++) {
    const t = lerp(0.14, 0.74, nt === 1 ? 0 : i / (nt - 1)),
      base = [lerp(E[0], S[0], t), lerp(E[1], S[1], t)],
      phi = lerp(94, 116, t) * rad;
    feathers.push({
      base,
      phi,
      length: ((C - base[1]) / Math.sin(phi)) * lerp(0.97, 0.78, t),
      kind: "tertial",
    });
  }
  const tip = feathers[0];
  const shaft = (r) => [
    tip.base[0] + Math.cos(tip.phi) * tip.length * r - Math.sin(tip.phi) * 0.05 * tip.length * r * r,
    tip.base[1] + Math.sin(tip.phi) * tip.length * r + Math.cos(tip.phi) * 0.05 * tip.length * r * r,
  ];
  return { S, E, W, H, M: shaft(0.5), T: shaft(0.97), feathers };
}

function insectOutline(w, f) {
  const { L, C } = f;
  const rise = lerp(1.1, 0.55, w.point),
    fall = lerp(0.38, 0.6, w.point);
  const at = rise / (rise + fall),
    top = at ** rise * (1 - at) ** fall;
  const chord = (t) =>
    C *
    (0.07 * (1 - t) ** 3 +
      (clamp(t, 0, 1) ** rise * (1 - clamp(t, 0, 1)) ** fall) / top);
  const lead = (t) => -0.07 * C * Math.sin(Math.PI * t ** 0.85);
  return { chord, lead };
}

export function wingArm(w) {
  const f = frameOf(w),
    { L } = f,
    r = w.bone,
    b = w.bend;
  let joints;
  if (w.structure === "bat") {
    const wrist = [0.46 * L, -(0.01 * L + 0.13 * L * b)],
      tip = [L, 0.03 * L];
    joints = [
      [0, 0, 1.25],
      [0.2 * L, 0.02 * L + 0.09 * L * b, 1],
      [...wrist, 0.8],
      [lerp(wrist[0], tip[0], 0.5), lerp(wrist[1], tip[1], 0.5) - 0.03 * L, 0.42],
      [...tip, 0.13],
    ];
  } else if (w.structure === "feather") {
    const p = featherPlan(w, f);
    joints = [
      [...p.S, 1.45],
      [...p.E, 1.2],
      [...p.W, 0.92],
      [...p.H, 0.42],
      [...p.M, 0.14],
      [...p.T, 0.05],
    ];
  } else {
    const { lead } = insectOutline(w, f);
    joints = [0, 0.3, 0.64, 1].map((t, i) => [
      t * L,
      lead(t),
      [0.62, 0.52, 0.36, 0.1][i],
    ]);
  }
  return joints.map(([u, v, k]) => ({
    at: [u, v, f.rest(u, v)],
    radius: Math.max(0.0012, r * k),
  }));
}
export function wingArmKnots(w) {
  const f = frameOf(w);
  return wingArm(w).map(({ at, radius }) => [
    ...place(f, at).toArray(),
    radius,
    radius,
  ]);
}

function surface() {
  const pos = [],
    col = [],
    idx = [];
  const area = (a, b, c) =>
    (pos[b * 3] - pos[a * 3]) * (pos[c * 3 + 1] - pos[a * 3 + 1]) -
    (pos[b * 3 + 1] - pos[a * 3 + 1]) * (pos[c * 3] - pos[a * 3]);
  const api = {
    pos,
    col,
    idx,
    point(p, color) {
      pos.push(p[0], p[1], p[2]);
      col.push(color.r, color.g, color.b);
      return pos.length / 3 - 1;
    },
    sheet(rows, facing) {
      const quads = [];
      let turn = 0;
      for (let i = 0; i < rows.length - 1; i++)
        for (let j = 0; j < rows[i].length - 1; j++) {
          const a = rows[i][j],
            b = rows[i][j + 1],
            c = rows[i + 1][j + 1],
            d = rows[i + 1][j];
          quads.push([a, b, c, d]);
          turn += area(a, b, c) + area(a, c, d);
        }
      const flip = turn * facing < 0;
      for (const [a, b, c, d] of quads)
        if (flip) idx.push(a, c, b, a, d, c);
        else idx.push(a, b, c, a, c, d);
    },
    rod(points, radii, color, sides = 6, lift = [0, 0, 1]) {
      const rings = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[Math.max(0, i - 1)],
          b = points[Math.min(points.length - 1, i + 1)];
        const t = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (t.lengthSq() < 1e-14) t.set(1, 0, 0);
        t.normalize();
        const e1 = new Vector3(...lift).addScaledVector(t, -t.dot(new Vector3(...lift)));
        if (e1.lengthSq() < 1e-8) e1.set(0, 1, 0).addScaledVector(t, -t.y);
        e1.normalize();
        const e2 = new Vector3().crossVectors(t, e1);
        const shade = typeof color === "function" ? color(i / (points.length - 1)) : color;
        rings.push(
          Array.from({ length: sides + 1 }, (_, k) => {
            const angle = (k / sides) * Math.PI * 2,
              x = Math.cos(angle) * radii[i],
              y = Math.sin(angle) * radii[i];
            return api.point(
              [
                points[i][0] + e1.x * x + e2.x * y,
                points[i][1] + e1.y * x + e2.y * y,
                points[i][2] + e1.z * x + e2.z * y,
              ],
              shade,
            );
          }),
        );
      }
      for (let i = 0; i < rings.length - 1; i++)
        for (let k = 0; k < sides; k++) {
          const a = rings[i][k],
            b = rings[i][k + 1],
            c = rings[i + 1][k + 1],
            d = rings[i + 1][k];
          idx.push(a, b, d, b, c, d);
        }
      for (const [ring, end, outward] of [
        [rings[0], points[0], false],
        [rings.at(-1), points.at(-1), true],
      ]) {
        const shade =
          typeof color === "function" ? color(outward ? 1 : 0) : color;
        const centre = api.point(end, shade);
        for (let k = 0; k < sides; k++)
          if (outward) idx.push(ring[k], ring[k + 1], centre);
          else idx.push(ring[k + 1], ring[k], centre);
      }
    },
  };
  return api;
}

function pigment(w, f) {
  const { L, C } = f;
  const eye = [0.56 * L, 0.5 * C],
    reach = 0.3 * Math.min(0.62 * L, C);
  return (u, v, along) => {
    if (w.pattern === "tips") return [ease(0.6, 0.9, along), 0];
    if (w.pattern === "bars")
      return [0.9 * ease(0.1, 0.5, Math.sin(along * Math.PI * 6.2 - 1.1)) * ease(0.12, 0.3, along), 0];
    if (w.pattern === "eyespot") {
      const d = Math.hypot(u - eye[0], v - eye[1]) / reach;
      return [
        ease(0.3, 0.46, d) * (1 - ease(0.82, 1, d)),
        (1 - ease(0.18, 0.34, d)) * 0.9 + 0.5 * ease(0.88, 1, d) * (1 - ease(1.12, 1.3, d)),
      ];
    }
    return [0, 0];
  };
}

function shades(w, color) {
  const main = new Color(color),
    dark = new Color(w.dark),
    pale = new Color(w.pale),
    limb = new Color(w.limb);
  const tone = (base, darkness = 0, paleness = 0, value = 1) =>
    base
      .clone()
      .multiplyScalar(value)
      .lerp(dark, clamp(darkness, 0, 1))
      .lerp(pale, clamp(paleness, 0, 1));
  return { main, dark, pale, limb, tone };
}

function webFan(S, rayA, rayB, o) {
  const { across = 8, along = 10, scallop, sag, thickness, shade } = o;
  const top = [],
    under = [],
    edge = [];
  for (let i = 0; i <= along; i++) {
    const rowTop = [],
      rowUnder = [];
    for (let j = 0; j <= across; j++) {
      const a = j / across,
        r = (i / along) * (1 - scallop * 4 * a * (1 - a));
      const p = rayA(r),
        q = rayB(r);
      const width = Math.hypot(p[0] - q[0], p[1] - q[1]);
      const at = mix3(p, q, a);
      at[2] -=
        sag * width * Math.sin(Math.PI * a) * Math.sin(Math.PI * Math.min(1, r * 1.15)) ** 0.8;
      const color = shade(at, a, r);
      rowTop.push(S.point([at[0], at[1], at[2] + thickness / 2], color));
      rowUnder.push(S.point([at[0], at[1], at[2] - thickness / 2], color));
      if (i === along) edge.push(at);
    }
    top.push(rowTop);
    under.push(rowUnder);
  }
  S.sheet(top, 1);
  S.sheet(under, -1);
  return edge;
}

function buildBat(S, w, f, color) {
  const { L, C, rest } = f,
    c = shades(w, color),
    spot = pigment(w, f),
    draw = randomStream(w.seed),
    vary = (amount) => 1 + amount * (2 * draw() - 1);
  const arm = wingArm(w),
    curve = new CatmullRomCurve3(
      arm.map((j) => new Vector3(...j.at)),
      false,
      "centripetal",
    );
  const along = (from, to) => (r) =>
    curve.getPoint(lerp(from, to, clamp(r, 0, 1)) / (arm.length - 1)).toArray();
  const wrist = arm[2].at,
    tip = arm[4].at,
    elbow = arm[1].at;
  const count = clamp(w.count, 2, 5);
  const first = Math.atan2(tip[1] - wrist[1], tip[0] - wrist[0]),
    last = lerp(98, 72, w.point) * rad;
  const reach = Math.hypot(tip[0] - wrist[0], tip[1] - wrist[1]),
    rear = (C * lerp(1, 0.82, w.point) - wrist[1]) / Math.sin(last);
  const fingers = [along(2, 4)];
  const bones = [];
  for (let k = 1; k < count; k++) {
    const t = k / (count - 1),
      angle =
        lerp(first, last, t ** lerp(1, 1.35, w.point)) +
        ((last - first) / (count - 1)) * 0.16 * (2 * draw() - 1) * (k < count - 1 ? 1 : 0.4),
      length =
        lerp(reach, rear, t) *
        (1 + 0.08 * Math.sin(Math.PI * t) * (1 - w.point)) *
        vary(0.07);
    const dir = [Math.cos(angle), Math.sin(angle)],
      side = [Math.sin(angle), -Math.cos(angle)],
      bend = 0.05 * vary(0.5);
    const ray = (r) => {
      const bow = bend * length * Math.sin(Math.PI * r);
      const u = wrist[0] + dir[0] * length * r + side[0] * bow,
        v = wrist[1] + dir[1] * length * r + side[1] * bow;
      return [u, v, rest(u, v)];
    };
    fingers.push(ray);
    bones.push([ray, length]);
  }
  const film = c.main;
  const shade = (at, a, r) => {
    const [darkness, paleness] = spot(at[0], at[1], r);
    return c.tone(film, darkness, paleness, lerp(0.74, 1.06, Math.sin(Math.PI * a) ** 0.6));
  };
  const thickness = Math.max(0.0016, 0.16 * w.bone);
  const edges = [];
  for (let k = 0; k + 1 < fingers.length; k++)
    edges.push(
      webFan(S, fingers[k], fingers[k + 1], {
        scallop: (0.06 + 0.3 * w.notch) * vary(0.18),
        sag: 0.11 * vary(0.25),
        thickness,
        shade,
      }),
    );
  edges.push(
    webFan(S, along(1, 0), along(1, 2), {
      across: 8,
      along: 5,
      scallop: 0.26,
      sag: 0.04,
      thickness,
      shade: (at, a) => c.tone(film, 0, 0, lerp(0.74, 0.98, Math.sin(Math.PI * a) ** 0.6)),
    }),
  );
  const flank = [0, C, rest(0, C)],
    shoulder = arm[0].at,
    lastFinger = fingers.at(-1),
    end = lastFinger(1);
  const pull = 0.22 + 0.4 * w.notch;
  const middle = mix3(mix3(flank, end, 0.5), elbow, pull);
  const hem = (s) => {
    const a = mix3(flank, middle, s),
      b = mix3(middle, end, s),
      at = mix3(a, b, s);
    return [at[0], at[1], rest(at[0], at[1])];
  };
  const upper = along(0, 2),
    rows = 10,
    cols = 14,
    top = [],
    under = [],
    hemline = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      rowTop = [],
      rowUnder = [];
    for (let j = 0; j <= cols; j++) {
      const s = j / cols;
      const a = upper(s),
        b = hem(s),
        l = mix3(shoulder, flank, t),
        r = lastFinger(t);
      const at = [0, 1, 2].map(
        (x) =>
          (1 - t) * a[x] +
          t * b[x] +
          (1 - s) * l[x] +
          s * r[x] -
          ((1 - s) * (1 - t) * shoulder[x] +
            s * (1 - t) * wrist[x] +
            (1 - s) * t * flank[x] +
            s * t * end[x]),
      );
      at[2] -= 0.07 * C * Math.sin(Math.PI * s) * Math.sin(Math.PI * t);
      const [darkness, paleness] = spot(at[0], at[1], t);
      const color = c.tone(
        film,
        darkness,
        paleness,
        lerp(0.74, 1.04, (Math.sin(Math.PI * s) * Math.sin(Math.PI * Math.min(1, t * 1.4))) ** 0.5),
      );
      rowTop.push(S.point([at[0], at[1], at[2] + thickness / 2], color));
      rowUnder.push(S.point([at[0], at[1], at[2] - thickness / 2], color));
      if (i === rows) hemline.push(at);
    }
    top.push(rowTop);
    under.push(rowUnder);
  }
  S.sheet(top, 1);
  S.sheet(under, -1);
  edges.push(hemline);
  const cord = c.tone(film, 0.25, 0, 0.7);
  for (const edge of edges)
    S.rod(edge, edge.map(() => Math.max(0.0012, 0.2 * w.bone)), cord, 5);
  const bone = c.tone(c.limb, 0, 0, 0.82);
  for (const [ray, length] of bones) {
    const steps = 14,
      points = [],
      radii = [];
    for (let i = 0; i <= steps; i++) {
      const r = i / steps,
        knuckle =
          1 +
          0.34 * Math.exp(-(((r - 0.4) / 0.035) ** 2)) +
          0.3 * Math.exp(-(((r - 0.72) / 0.035) ** 2));
      points.push(ray(r));
      radii.push(Math.max(0.001, w.bone * lerp(0.46, 0.12, r) * knuckle * Math.min(1, length / (0.3 * L) + 0.4)));
    }
    S.rod(points, radii, bone, 7);
  }
  const claw = [];
  for (let i = 0; i <= 5; i++) {
    const r = i / 5,
      reachOut = 0.085 * L * r;
    const u = wrist[0] + reachOut * (0.55 + 0.3 * r),
      v = wrist[1] - reachOut * (0.84 - 0.5 * r * r);
    claw.push([u, v, rest(u, v) + 0.012 * L * Math.sin(Math.PI * r * 0.8)]);
  }
  S.rod(
    claw,
    claw.map((_, i) => Math.max(0.0008, w.bone * 0.5 * (1 - i / 5.3))),
    (r) => c.tone(c.limb, 0, ease(0.45, 0.9, r), 0.82),
    6,
  );
}

function buildFeathers(S, w, f, color, game) {
  const { L, C, rest } = f,
    c = shades(w, color),
    spot = pigment(w, f),
    draw = randomStream(w.seed);
  const plan = featherPlan(w, f),
    { S: shoulder, W: wrist, H: hand, feathers } = plan;
  const arm = wingArm(w),
    curve = new CatmullRomCurve3(
      arm.map((j) => new Vector3(...j.at)),
      false,
      "centripetal",
    );
  const armLine = Array.from({ length: 49 }, (_, i) => {
    const t = (i / 48) * (3 / (arm.length - 1));
    return [curve.getPoint(t).toArray(), lerp(arm[0].radius, arm[3].radius, i / 48)];
  });
  const leadAt = (u) =>
    u <= wrist[0]
      ? lerp(shoulder[1], wrist[1], clamp(u / wrist[0], 0, 1)) +
        0.018 * L * Math.sin(Math.PI * clamp(u / wrist[0], 0, 1))
      : lerp(wrist[1], hand[1], clamp((u - wrist[0]) / (hand[0] - wrist[0]), 0, 1));
  const armAt = (u, v) => {
    let best = Infinity,
      radius = arm[0].radius,
      behind = 0;
    for (const [p, r] of armLine) {
      const d = (p[0] - u) ** 2 + (p[1] - v) ** 2;
      if (d < best) {
        best = d;
        radius = r;
        behind = v - p[1];
      }
    }
    if (behind >= 0 || u > wrist[0])
      return [radius, radius * 1.05 * Math.exp(-((behind / (2 * radius)) ** 2))];
    const gap = Math.max(1e-6, v - behind - leadAt(u));
    return [radius, radius * lerp(1.05, 0.6, clamp(-behind / gap, 0, 1))];
  };
  const curlOf = (kind) => (kind === "primary" ? 0.05 : 0.02);
  const point = (feather, r) => [
    feather.base[0] + Math.cos(feather.phi) * feather.length * r - Math.sin(feather.phi) * curlOf(feather.kind) * feather.length * r * r,
    feather.base[1] + Math.sin(feather.phi) * feather.length * r + Math.cos(feather.phi) * curlOf(feather.kind) * feather.length * r * r,
  ];
  feathers.forEach((feather, i) => {
    if (!i) return;
    feather.length *= 1 + 0.045 * (2 * draw() - 1);
    feather.phi += 1.3 * rad * (2 * draw() - 1);
  });
  feathers.forEach((feather, i) => {
    const gaps = [feathers[i - 1], feathers[i + 1]].filter(Boolean).map((other) => {
      const a = point(feather, 0.62),
        b = point(other, 0.62);
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    });
    feather.width = clamp(
      Math.max(...gaps) * 1.75,
      feather.length * 0.1,
      feather.length * (feather.kind === "primary" ? 0.2 : 0.3),
    );
    feather.value = 0.93 + 0.14 * draw();
  });
  const roll = 0.09,
    layer = Math.max(0.004, 0.016 * C),
    stations = game
      ? [0, 0.18, 0.38, 0.62, 0.84, 0.96, 1]
      : [0, 0.07, 0.2, 0.38, 0.56, 0.72, 0.84, 0.93, 0.98, 1];
  function blade(feather, o) {
    const { length, phi } = feather,
      long = length * o.length,
      dir = [Math.cos(phi), Math.sin(phi)],
      out = [Math.sin(phi), -Math.cos(phi)];
    const narrow =
      feather.kind === "primary" && feather.outer < 5 && !o.covert
        ? w.notch * (1 - feather.outer / 6)
        : 0;
    const outerShare = o.covert ? 0.5 : feather.kind === "primary" ? 0.32 : 0.42;
    const rows = o.covert && game ? [0, 0.48, 0.8, 1]
      : o.small ? [0, 0.4, 0.8, 1]
      : o.covert ? [0, 0.3, 0.6, 0.82, 0.95, 1] : stations;
    const shafts = game || o.small ? [1, 0, -1]
      : o.covert ? [1, 0.6, 0, -0.6, -1] : [1, 0.55, 0, -0.5, -1];
    const top = [],
      under = [];
    const from = o.from ?? feather.base;
    for (const r of rows) {
      const fill = o.covert ? lerp(0.82, 1, Math.min(1, r / 0.3)) : Math.min(1, (r / 0.14) ** 0.6),
        round = o.covert ? 0.45 : feather.kind === "primary" ? 0.7 : 0.8,
        tipIn = r > round ? Math.sqrt(Math.max(0, 1 - ((r - round) / (1 - round)) ** 2)) : 1,
        emarginate = 1 - 0.62 * narrow * ease(0.4, 0.62, r);
      const widthHere = feather.width * o.width * Math.max(0.06, fill * tipIn) * emarginate;
      const curl = (o.covert ? 0 : curlOf(feather.kind)) * long * r * r;
      const cu = from[0] + dir[0] * long * r - out[0] * curl,
        cv = from[1] + dir[1] * long * r - out[1] * curl;
      const rowTop = [],
        rowUnder = [];
      for (const x of shafts) {
        const side = x > 0 ? outerShare : 1 - outerShare,
          across = x * widthHere * side;
        const u = cu + out[0] * across,
          v = cv + out[1] * across;
        let h = rest(u, v) + o.lift + across * roll;
        if (x < 0) h -= 0.11 * widthHere * side * x * x;
        else if (o.covert) h -= 0.1 * widthHere * side * x * x;
        if (o.covert) h -= 0.06 * long * r * r;
        if (o.ride) h += o.ride * armAt(u, v)[1];
        const thick = (o.covert ? 0.04 : 0.06) * layer * (1 - Math.abs(x)) ** 0.7,
          shaft = x === 0 ? (o.covert ? 0.1 : 0.26) * layer * (1 - 0.7 * r) : 0;
        const [darkness, paleness] = o.covert ? [0, 0] : spot(u, v, r);
        const fringe = o.covert ? 0.2 * ease(0.62, 1, r) : 0;
        const value =
          feather.value *
          (o.value ?? 1) *
          (x === 0 ? 1.08 : Math.abs(x) === 1 ? 0.8 : 0.98) *
          lerp(1.05, 0.9, r);
        const color = c.tone(o.color, darkness, Math.max(paleness, fringe, x === 0 && !o.covert ? 0.2 : 0), value);
        if (o.face >= 0) rowTop.push(S.point([u, v, h + thick + shaft], color));
        if (o.face <= 0)
          rowUnder.push(
            S.point(
              [u, v, h - thick - shaft * 1.4],
              o.face ? color : c.tone(o.color, darkness * 0.8, Math.max(paleness, x === 0 ? 0.3 : 0), value * 0.88),
            ),
          );
      }
      top.push(rowTop);
      under.push(rowUnder);
    }
    if (o.face >= 0) S.sheet(top, 1);
    if (o.face <= 0) S.sheet(under, -1);
  }
  const flight = c.main,
    cover = c.limb;
  for (const feather of feathers)
    blade(feather, { length: 1, width: 1, lift: -0.25 * arm[2].radius, face: 0, color: flight });
  const between = (a, b, t) => ({
    base: [lerp(a.base[0], b.base[0], t), lerp(a.base[1], b.base[1], t)],
    phi: lerp(a.phi, b.phi, t),
    length: lerp(a.length, b.length, t),
    width: lerp(a.width, b.width, t),
    kind: t < 0.5 ? a.kind : b.kind,
    value: 0.92 + 0.16 * draw(),
  });
  const rows = [
    [0.48, 0, 1.1, 0.4, 1, 0],
    [0.3, 0.12, 2.2, 0.16, 1, 0.5],
    [0.17, 0.6, 3.2, 0.05, 1, 0],
    [0.09, 1, 4.1, 0, 1, 0.5],
    [0.42, 0, -1.8, 0.3, -1, 0],
    [0.2, 0.55, -2.9, 0.08, -1, 0.5],
  ];
  for (const [share, forward, height, tint, side, shift] of rows) {
    if (game && [0.3, 0.09, 0.2].includes(share)) continue;
    for (let i = 0; i + 1 < feathers.length; i++) {
      const feather = between(feathers[i], feathers[i + 1], shift);
      const u = feather.base[0],
        gap = Math.max(0, feather.base[1] - leadAt(u)),
        primary = feather.kind === "primary";
      blade(feather, {
        covert: true,
        small: share < 0.25,
        from: [u, feather.base[1] - forward * gap],
        length: (share * (primary ? 0.8 : 1) * feather.length + forward * gap * 0.8) / feather.length,
        width: lerp(1.1, 0.96, forward),
        lift: height * layer,
        ride: side,
        face: primary || forward >= 0.5 ? 0 : side,
        color: cover.clone().lerp(flight, tint),
        value: side > 0 ? 1 : 0.9,
      });
    }
  }
  const web = (r, t) => {
    const back = curve.getPoint(t * (2 / (arm.length - 1))).toArray(),
      u = lerp(back[0], lerp(shoulder[0], wrist[0], t), r);
    return [u, lerp(back[1], leadAt(lerp(shoulder[0], wrist[0], t)), r)];
  };
  const top = [],
    under = [];
  for (let i = 0; i <= 6; i++) {
    const rowTop = [],
      rowUnder = [];
    for (let j = 0; j <= 12; j++) {
      const [u, v] = web(i / 6, j / 12),
        swell = armAt(u, v)[0] * lerp(0.92, 0.5, i / 6);
      rowTop.push(S.point([u, v, rest(u, v) + swell], c.tone(cover, 0, 0, lerp(0.9, 1, i / 6))));
      rowUnder.push(S.point([u, v, rest(u, v) - swell], c.tone(cover, 0, 0.14, 0.9)));
    }
    top.push(rowTop);
    under.push(rowUnder);
  }
  S.sheet(top, 1);
  S.sheet(under, -1);
  const lead = Array.from({ length: 13 }, (_, j) => {
    const [u, v] = web(1, j / 12);
    return [u, v, rest(u, v)];
  });
  S.rod(lead, lead.map(([u, v]) => armAt(u, v)[0] * 0.52), c.tone(cover, 0, 0, 0.96), 7);
  for (let i = 0; i < 3; i++)
    blade(
      {
        base: [wrist[0] + 0.012 * L * i, wrist[1] + 0.008 * L * i],
        phi: (8 + 6 * i) * rad,
        length: L * (0.15 - 0.022 * i),
        width: L * 0.05,
        kind: "primary",
        outer: 9,
        value: 0.95,
      },
      { length: 1, width: 1, lift: (5.2 + i * 0.5) * layer, ride: 0.75, face: 0, color: flight.clone().lerp(cover, 0.35) },
    );
}

function buildInsect(S, w, f, color) {
  const { L, C, rest } = f,
    c = shades(w, color),
    spot = pigment(w, f),
    draw = randomStream(w.seed);
  const { chord, lead } = insectOutline(w, f);
  const veins = clamp(w.count, 3, 8),
    steps = 18,
    thickness = Math.max(0.001, 0.1 * w.bone),
    pleat = 0.02 * C;
  const rim = (t) => [t * L, lead(t) + chord(t)];
  const fore = (t) => [t * L, lead(t)];
  const ends = [1];
  for (let i = 1; i <= veins; i++)
    ends.push(1 - ((i - 0.35) / veins) ** 1.1 * 0.92);
  const rays = [(r) => fore(r)];
  for (let i = 1; i <= veins; i++) {
    const start = (i / (veins + 1)) ** 1.3 * 0.9,
      end = ends[i],
      power = lerp(2.6, 1.7, i / veins);
    rays.push((r) => {
      const t = r * end,
        q = start + (1 - start) * r ** power;
      return [t * L, lead(t) + q * chord(t)];
    });
  }
  rays.push((r) => rim(r * ends[veins]));
  ends.push(ends[veins]);
  const height = (i, r) => (i % 2 ? -1 : 1) * pleat * (1 - 0.7 * r) * (i === 0 || i === veins + 1 ? 0.4 : 1);
  const film = c.main,
    veinTone = c.tone(c.limb, 0.2, 0, 0.7);
  const across = 4;
  const lines = [];
  for (let i = 0; i + 1 < rays.length; i++) {
    const top = [],
      under = [],
      mid = [];
    const closing = i === veins;
    for (let k = 0; k <= steps; k++) {
      const r = k / steps,
        rowTop = [],
        rowUnder = [],
        a0 = rays[i](r),
        b0 = rays[i + 1](r);
      for (let j = 0; j <= across; j++) {
        const a = j / across;
        let u = lerp(a0[0], b0[0], a),
          v = lerp(a0[1], b0[1], a);
        if (!closing) {
          const edge = rim(lerp(ends[i], ends[i + 1], a)),
            chordal = [lerp(rays[i](1)[0], rays[i + 1](1)[0], a), lerp(rays[i](1)[1], rays[i + 1](1)[1], a)],
            bay = 1 - 0.5 * w.notch * 4 * a * (1 - a) * (i ? 1 : 0.4);
          u += r ** 3 * (lerp(chordal[0], edge[0], bay) - chordal[0]);
          v += r ** 3 * (lerp(chordal[1], edge[1], bay) - chordal[1]);
          if (w.notch > 0.01) {
            const pullIn = 0.16 * w.notch * 4 * a * (1 - a) * r ** 3 * (i ? 1 : 0.4);
            u = lerp(u, lerp(a0[0], b0[0], 0.5) * 0.86, pullIn);
            v = lerp(v, lerp(a0[1], b0[1], 0.5), pullIn * 0.4);
          }
        }
        const h = rest(u, v) + lerp(height(i, r), height(i + 1, r), a);
        const [darkness, paleness] = spot(u, v, r);
        const stigma = i === 0 && r > 0.8 && r < 0.9 && a < 0.3 ? 0.8 : 0;
        const root = 0.4 * (1 - ease(0.02, 0.22, u / L));
        const colour = c.tone(film, Math.max(darkness, stigma, root), paleness, lerp(0.94, 1.05, Math.sin(Math.PI * a)));
        rowTop.push(S.point([u, v, h + thickness / 2], colour));
        rowUnder.push(S.point([u, v, h - thickness / 2], colour));
        if (j === 0 && i > 0) (lines[i] ??= []).push([u, v, h]);
        if (j === 0 && i === 0) (lines[0] ??= []).push([u, v, h]);
        if (j === across && i === veins) (lines[veins + 1] ??= []).push([u, v, h]);
        (mid[j] ??= []).push([u, v, h]);
        if (k === steps) (lines.margin ??= []).push([u, v, h]);
      }
      top.push(rowTop);
      under.push(rowUnder);
    }
    S.sheet(top, 1);
    S.sheet(under, -1);
    const cells = 3 + Math.floor(draw() * 3) + Math.round(3 * ends[i]),
      shift = draw();
    const outer = Math.hypot(rays[i](1)[0] - rays[i + 1](1)[0], rays[i](1)[1] - rays[i + 1](1)[1]);
    const forks = closing
      ? []
      : outer > 0.42 * C
        ? [2, 1, 3]
        : outer > 0.16 * C || draw() < 0.5
          ? [2]
          : [];
    for (let n = 0; n < cells; n++) {
      const k = clamp(Math.round(((n + 0.35 + 0.5 * shift) / cells) ** 0.85 * steps), 2, steps - 1);
      const row = Array.from({ length: across + 1 }, (_, j) => {
        const p = top[k][j];
        return [S.pos[p * 3], S.pos[p * 3 + 1], S.pos[p * 3 + 2] - thickness / 2];
      });
      const span = Math.hypot(row[0][0] - row[across][0], row[0][1] - row[across][1]);
      if (span < 0.012 * C) continue;
      S.rod(row, row.map(() => Math.max(0.0007, w.bone * 0.13)), veinTone, 4);
    }
    for (const [n, j] of forks.entries()) {
      const from = Math.round(steps * lerp(n ? 0.62 : 0.4, n ? 0.8 : 0.62, draw())),
        line = mid[j].slice(from);
      S.rod(
        line,
        line.map((_, k, all) => Math.max(0.0007, w.bone * lerp(0.2, 0.08, k / all.length))),
        veinTone,
        4,
      );
    }
  }
  for (let i = 0; i <= veins + 1; i++) {
    const line = lines[i];
    if (!line) continue;
    const base = i === 0 ? 0.6 : i > veins ? 0.22 : lerp(0.42, 0.3, i / veins);
    S.rod(
      line,
      line.map((_, k) => Math.max(0.0008, w.bone * base * lerp(1, i === 0 ? 0.3 : 0.2, k / steps))),
      veinTone,
      i === 0 ? 7 : 5,
    );
  }
  const margin = lines.margin ?? [];
  const order = [];
  for (let i = 0; i <= veins; i++)
    for (let j = i === 0 ? 0 : 1; j <= across; j++) order.push(margin[i * (across + 1) + j]);
  S.rod(order.filter(Boolean), order.filter(Boolean).map(() => Math.max(0.0008, w.bone * 0.2)), veinTone, 5);
}

export function wingGeometry(w, color = "#d7a24c", { game = false } = {}) {
  const f = frameOf(w),
    S = surface();
  if (w.structure === "bat") buildBat(S, w, f, color);
  else if (w.structure === "feather") buildFeathers(S, w, f, color, game);
  else buildInsect(S, w, f, color);
  const count = S.pos.length / 3,
    position = new Float32Array(count * 3),
    uv = new Float32Array(count * 2),
    p = new Vector3();
  for (let i = 0; i < count; i++) {
    const at = [S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]];
    place(f, at).toArray(position, i * 3);
    uv[i * 2] = clamp(at[0] / f.L, 0, 1);
    uv[i * 2 + 1] = clamp(at[1] / f.C, 0, 1);
  }
  const index = S.idx;
  if (w.side < 0)
    for (let i = 0; i < index.length; i += 3)
      [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(S.col, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const normal = geometry.attributes.normal;
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(normal, i);
    if (p.lengthSq() > 0.5) continue;
    if (i) p.fromBufferAttribute(normal, i - 1);
    if (p.lengthSq() < 0.5) p.copy(f.n);
    normal.setXYZ(i, p.x, p.y, p.z);
  }
  return geometry;
}
