import {
  add,
  identity,
  scale,
  sub,
  type BaseSlotInput,
  type CreaturePlan,
  type CreatureLimb,
  type FigureWing,
  type Json,
  type Knot,
  type Vec3,
} from "@irudd/document";

const rad = Math.PI / 180;
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const girthProfiles = {
  barrel: (t: number) => 0.5 + 0.5 * Math.sin(Math.PI * t) ** 0.7,
  pear: (t: number) => 0.42 + 0.58 * Math.sin(Math.PI * t ** 0.62) ** 0.9,
  wedge: (t: number) => 0.42 + 0.58 * Math.sin(Math.PI * t ** 1.7) ** 0.9,
  tube: () => 0.9,
  wasp: (t: number) =>
    0.34 +
    0.66 *
      Math.max(Math.exp(-(((t - 0.22) / 0.19) ** 2)), 0.82 * Math.exp(-(((t - 0.76) / 0.16) ** 2))),
};
function spineFrame(p: CreaturePlan) {
  const s = p.spine,
    k = p.scale,
    steps = 64,
    widths = Math.sqrt(s.flat);
  const radius = (t: number) => {
    const u = t * 4,
      i = Math.min(3, Math.floor(u));
    const cap = Math.sqrt(Math.max(0.06, 1 - (1 - Math.min(1, Math.min(t, 1 - t) / 0.13)) ** 2));
    return (
      girthProfiles[s.profile](t) *
      cap *
      s.girth *
      k *
      lerp(s.bulge[i] ?? 1, s.bulge[i + 1] ?? 1, smooth(u - i))
    );
  };
  let y = 0,
    z = 0,
    lowest = Infinity;
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps,
      pitch = (lerp(s.rear, s.front, smooth(t)) + s.arch * Math.cos(Math.PI * t)) * rad;
    const point = { y, z, pitch };
    lowest = Math.min(lowest, y - (radius(t) * Math.cos(pitch)) / widths);
    y += (Math.sin(pitch) * s.length * k) / steps;
    z += (Math.cos(pitch) * s.length * k) / steps;
    return point;
  });
  const lift = p.limbs.some((l) => l.kind !== "arm")
    ? Math.max(s.stance * k, 0.02 - lowest)
    : 0.004 - lowest;
  const middle = (points[steps]?.z ?? 0) / 2;
  return (station: number) => {
    const t = Math.max(0, Math.min(1, station)),
      u = t * steps,
      i = Math.min(steps - 1, Math.floor(u)),
      f = u - i;
    const a = points[i],
      b = points[i + 1];
    if (!a || !b) throw new Error("Invalid spine station.");
    const pitch = lerp(a.pitch, b.pitch, f),
      r = radius(t);
    const point: Vec3 = [0, lerp(a.y, b.y, f) + lift, lerp(a.z, b.z, f) - middle];
    const dorsal: Vec3 = [0, Math.cos(pitch), -Math.sin(pitch)],
      tangent: Vec3 = [0, Math.sin(pitch), Math.cos(pitch)];
    return { point, dorsal, tangent, width: r * widths, depth: r / widths };
  };
}
const frames = new WeakMap<CreaturePlan, ReturnType<typeof spineFrame>>();
export function bodyStation(p: CreaturePlan, t: number) {
  let frame = frames.get(p);
  if (!frame) {
    frame = spineFrame(p);
    frames.set(p, frame);
  }
  return frame(t);
}
const limbOffsets = {
  leg: [0.68, -0.3],
  arm: [0.86, 0],
  wing: [0.5, 0.62],
  fin: [0.9, 0],
  tentacle: [0.82, 0],
} as const;
export function limbSocket(p: CreaturePlan, kind: CreatureLimb["kind"], t: number, side: number) {
  const s = bodyStation(p, t),
    [across, back] = limbOffsets[kind];
  return add(add(s.point, [side * s.width * across, 0, 0]), scale(s.dorsal, s.depth * back));
}

export function wingSurface(
  structure: FigureWing["structure"],
  side: 1 | -1,
  span: Vec3,
  back: Vec3,
  skin: Pick<CreaturePlan["skin"], "base" | "accent" | "pale">,
  seed: number,
): FigureWing {
  return {
    structure,
    side,
    span,
    back,
    bone: 0.015,
    bend: 0.38,
    notch: 0.42,
    point: 0.57,
    count: structure === "feather" ? 9 : 4,
    pattern: "tips",
    seed,
    dark: skin.base,
    pale: skin.pale,
    limb: skin.accent,
  };
}

export function creatureSlots(p: CreaturePlan): BaseSlotInput[] {
  const slots: BaseSlotInput[] = [];
  const { skin, head, tail } = p,
    k = p.scale;
  const origin = new Map<string, Vec3>();
  const core = {
    "creature.organ": { hide: "core" },
    "figure.finish": { surface: skin.surface },
    ...(skin.markings ? { "figure.markings": skin.markings } : {}),
  };
  function part(
    slot: string,
    parent: string | null,
    point: Vec3,
    size: Vec3,
    color: string,
    features: Record<string, Json> = {},
  ) {
    origin.set(slot, point);
    slots.push({
      slot,
      parent,
      label: slot.replaceAll(".", " "),
      shape: "ellipsoid",
      position: sub(point, parent ? (origin.get(parent) ?? [0, 0, 0]) : [0, 0, 0]),
      size,
      rotation:
        /^head\.\d+$/.test(slot) && head.turn
          ? [0, Math.sin((head.turn * rad) / 2), 0, Math.cos((head.turn * rad) / 2)]
          : identity,
      color,
      features,
    });
  }
  function tube(
    slot: string,
    parent: string | null,
    knots: readonly Knot[],
    color = skin.base,
    features: Record<string, Json> = core,
  ) {
    const [x, y, z] = knots[0] ?? [0, 0, 0];
    part(slot, parent, [x, y, z], [1, 1, 1], color, {
      ...features,
      "figure.sweep": {
        knots: knots.map(([a, b, c, w, d]) => [
          a - x,
          b - y,
          c - z,
          Math.max(0.0005, w),
          Math.max(0.0005, d),
        ]),
      },
    });
  }
  const knot = (pos: Vec3, w: number, d = w): Knot => [...pos, w, d];
  const body = Array.from({ length: 13 }, (_, i) => {
    const s = bodyStation(p, i / 12);
    return knot(s.point, s.width, s.depth);
  });
  tube("body", null, body, skin.base, {
    ...core,
    "creature.organ": { rank: "spine", hide: "core" },
  });
  const hips = bodyStation(p, 0.04).point,
    chest = bodyStation(p, 0.95).point,
    g = p.spine.girth * k;
  const detail = (slot: string, parent: string, point: Vec3, size: Vec3, color = skin.accent) =>
    part(slot, parent, point, size, color);
  const tapered = (
    slot: string,
    parent: string,
    a: Vec3,
    b: Vec3,
    c: Vec3,
    r: number,
    color: string,
    thickness = 1,
  ) =>
    tube(
      slot,
      parent,
      [knot(a, r, r * thickness), knot(b, r * 0.69, r * 0.69 * thickness), knot(c, r * 0.028)],
      color,
      {},
    );
  for (let h = 0; h < head.count; h++) {
    const prefix = "head." + h;
    const neck = head.neck * k,
      pitch = head.neckPitch * rad;
    const at = add(chest, [
      (h - (head.count - 1) / 2) * g * 1.9,
      Math.sin(pitch) * neck,
      Math.cos(pitch) * neck,
    ]);
    tube(prefix + ".neck", "body", [
      knot(chest, g * 0.72 * head.neckGirth),
      knot(add(chest, scale(sub(at, chest), 0.54)), g * 0.56 * head.neckGirth),
      knot(at, g * 0.47 * head.neckGirth),
    ]);
    const r = head.size * g * 0.74,
      w = r * (head.shape === "wide" ? 1.3 : 1),
      d = r * (head.shape === "long" ? 1.35 : 1),
      height = r * (head.shape === "flat" ? 0.64 : 1);
    part(prefix, prefix + ".neck", at, [2 * w, 1.8 * height, 2 * d], skin.base, {
      ...core,
      "creature.organ": { hide: "core", rank: "head", head: true },
    });
    for (let i = 0; i < head.eyes; i++) {
      const side = i % 2 === 0 ? 1 : -1,
        row = Math.floor(i / 2);
      const e = r * 0.26 * head.eyeSize;
      const eye = add(at, [
        side * w * ((head.eyePlace === "side" ? 0.79 : 0.46) - row * 0.12),
        height * ((head.eyePlace === "top" ? 0.85 : 0.25) + row * 0.31) + head.stalks * k,
        d * ((head.eyePlace === "front" ? 0.82 : 0.41) - row * 0.48),
      ]);
      const id = prefix + ".eye." + i;
      if (head.stalks > 0.01)
        tube(id + ".stalk", prefix, [
          knot(add(eye, [0, -head.stalks * k, 0]), e * 0.56),
          knot(eye, e * 0.32),
        ]);
      if (head.lids > 0.03)
        detail(
          id + ".lid",
          prefix,
          add(eye, [0, e * 0.66, 0]),
          [e * 1.12, e * 0.59 * head.lids, e * 1.41],
          skin.base,
        );
      if (head.brow > 0.05)
        detail(
          id + ".brow",
          prefix,
          add(eye, [-side * e * 0.13, e * 0.85, 0]),
          [e * 1.04, e * 0.6 * head.brow, e * 1.54],
          skin.accent,
        );
      detail(id, prefix, eye, [e * 1.1, e * 1.4, e * 1.4], "#2d252b");
      detail(
        id + ".iris",
        id,
        add(eye, [side * e * 0.28, 0, e * 0.23]),
        [e * 0.75, e * 1.05, e * 0.99],
        skin.eye,
      );
      detail(
        id + ".pupil",
        id,
        add(eye, [side * e * 0.49, 0, e * 0.33]),
        [e * 0.39, e * 0.8, e * 0.51],
        "#201924",
      );
      detail(
        id + ".glint",
        id,
        add(eye, [side * e * 0.56, e * 0.23, e * 0.42]),
        [e * 0.2, e * 0.23, e * 0.2],
        "#ffefcf",
      );
    }
    const muzzleWidth =
      head.muzzleProfile === "grazing" ? 1.3 : head.muzzleProfile === "feline" ? 0.83 : 1;
    const billWidth =
      head.billProfile === "spoon"
        ? 1.8
        : head.billProfile === "crusher"
          ? 1.45
          : head.billProfile === "shear"
            ? 0.66
            : 1;
    const muzzle =
      r *
      head.snoutLength *
      (head.muzzleProfile === "rooting" ? 0.73 : head.billProfile === "scythe" ? 1.24 : 1);
    const base = add(at, [0, -height * 0.19, d * 0.53]);
    if (head.snout === "muzzle" || head.snout === "bill" || head.snout === "beak") {
      const beak = head.snout !== "muzzle",
        flat = head.snout === "bill";
      tube(
        prefix + ".snout",
        prefix,
        [
          knot(base, w * 0.78, height * 0.52),
          knot(
            add(base, [0, 0.02 * r, muzzle * 0.72]),
            w * (flat ? 0.68 * billWidth : 0.51 * muzzleWidth),
            height * (flat ? 0.2 : 0.37),
          ),
          knot(
            add(base, [
              0,
              -r * (head.billProfile === "scythe" ? 0.45 : 0.09),
              muzzle * (beak ? 1.65 : 1.13),
            ]),
            w * (beak ? (head.billProfile === "spoon" ? 0.4 : 0.03) : 0.36 * muzzleWidth),
            height * (beak ? 0.04 : 0.22),
          ),
        ],
        beak ? skin.pale : skin.base,
        beak ? {} : core,
      );
      if (head.jaw > 0.01) {
        const a = add(base, [0, -r * 0.29, 0]),
          b = add(a, [0, -r * 0.12, muzzle * 0.64]),
          c = add(a, [0, -r * (0.14 + head.jaw * 0.86), muzzle * (beak ? 1.51 : 1.08)]);
        tapered(prefix + ".jaw", prefix, a, b, c, w * 0.52, beak ? skin.pale : skin.base, 0.47);
      }
      for (const side of [1, -1]) {
        if (head.nostrils)
          detail(
            prefix + ".nostril." + (side + 1),
            prefix,
            add(base, [side * w * 0.25, height * 0.16, muzzle * 0.85]),
            [r * 0.12, r * 0.08, r * 0.15],
            "#322124",
          );
        for (let t = 0; t < head.teeth; t++) {
          const a = add(base, [
            side * w * 0.38,
            -r * 0.16,
            muzzle * (0.27 + (0.64 * t) / Math.max(head.teeth - 1, 1)),
          ]);
          tapered(
            prefix + ".tooth." + (side + 1) + "." + t,
            prefix,
            a,
            add(a, [0, -r * 0.12, 0]),
            add(a, [0, -r * 0.25, r * 0.03]),
            r * 0.064,
            skin.pale,
          );
        }
        if (head.whiskers)
          for (let t = 0; t < 3; t++) {
            const a = add(base, [side * w * 0.42, 0, muzzle * (0.44 + t * 0.12)]);
            tapered(
              prefix + ".whisker." + (side + 1) + "." + t,
              prefix,
              a,
              add(a, [side * r * 0.48, 0, r * 0.11]),
              add(a, [side * r * 0.94, (t - 1) * r * 0.2, r * 0.2]),
              r * 0.025,
              skin.pale,
            );
          }
      }
      if (!beak)
        detail(
          prefix + ".nose",
          prefix,
          add(base, [0, height * 0.13, muzzle * 1.12]),
          [w * 0.67, height * 0.35, r * 0.2],
          "#3a3030",
        );
    } else if (head.snout === "trunk")
      tapered(
        prefix + ".trunk",
        prefix,
        base,
        add(base, [0, -r * 0.8, muzzle]),
        add(base, [r * 0.24, -r * 1.6, muzzle * 1.2]),
        r * 0.44,
        skin.base,
      );
    for (const side of [1, -1] as const) {
      if (p.details.includes("tusks")) {
        const tooth = add(base, [side * w * 0.64, -height * 0.21, muzzle * 0.3]);
        tapered(
          prefix + ".tusk." + (side === 1 ? "l" : "r"),
          prefix,
          tooth,
          add(tooth, [side * r * 0.16, -r * 0.46, r * 0.27]),
          add(tooth, [side * r * 0.22, -r * 0.3, r * 0.7]),
          r * 0.15,
          skin.pale,
        );
      }
      if (head.snout === "mandibles")
        tapered(
          prefix + ".jaw." + (side === 1 ? "l" : "r"),
          prefix,
          add(base, [side * w * 0.65, 0, 0]),
          add(base, [side * w * 0.83, -r * 0.14, r * 0.94]),
          add(base, [side * w * 0.24, -r * 0.04, r * 1.5]),
          r * 0.25,
          skin.pale,
        );
      for (const ornament of [
        "frill",
        "dewlap",
        "nose horn",
        "brow horns",
        "beard",
        "cheek frills",
      ] as const) {
        if (!p.details.includes(ornament)) continue;
        const central = ornament === "nose horn" || ornament === "dewlap" || ornament === "beard";
        if (central && side < 0) continue;
        const horn = ornament === "nose horn" || ornament === "brow horns",
          under = ornament === "beard" || ornament === "dewlap";
        const a = add(at, [
          central ? 0 : side * w * 0.72,
          (horn ? 0.5 : under ? -0.54 : 0.14) * height,
          (ornament === "nose horn" ? 0.98 : 0.37) * d,
        ]);
        tapered(
          prefix + ".detail." + ornament.replaceAll(" ", ".") + "." + (side + 1),
          prefix,
          a,
          add(a, [central ? 0 : side * r * 0.29, (horn ? 0.38 : under ? -0.34 : 0.11) * r, 0]),
          add(a, [
            central ? 0 : side * r * (horn ? 0.45 : 0.89),
            (horn ? 0.94 : under ? -0.92 : 0.21) * r,
            -r * (horn ? 0.12 : 0.71),
          ]),
          r * (horn ? 0.17 : 0.49),
          horn ? skin.pale : skin.accent,
          horn ? 1 : 0.42,
        );
      }
      if (head.crest === "none") continue;
      const id = prefix + ".crest." + (side === 1 ? "l" : "r");
      const ear = head.crest === "ears",
        feather = head.crest === "plume" || head.crest === "fan";
      const len = r * head.crestSize * (head.crest === "nubs" ? 0.5 : feather ? 1.9 : 1.55);
      const a = add(at, [side * w * 0.55, height * 0.61, -d * 0.34]);
      const b = add(a, [side * len * 0.33, len * 0.64, -len * 0.24]),
        c = add(a, [
          side * len * 0.57,
          len * (ear ? (head.ear === "lop" ? -0.72 : head.ear === "swept" ? 0.65 : 1.15) : 1),
          -len * (head.ear === "swept" ? 1.08 : 0.54),
        ]);
      tapered(
        id,
        prefix,
        a,
        b,
        c,
        r *
          (ear || feather
            ? head.ear === "fan"
              ? 0.78
              : head.ear === "tufted"
                ? 0.56
                : 0.45
            : 0.21),
        ear ? skin.base : feather ? skin.accent : skin.pale,
        ear || feather ? 0.4 : 1,
      );
      if (head.crest === "antlers")
        tapered(
          id + ".tine",
          id,
          b,
          add(b, [side * r * 0.2, r * 0.41, r * 0.18]),
          add(b, [side * r * 0.24, r * 0.88, r * 0.27]),
          r * 0.11,
          skin.pale,
        );
    }
  }
  if (tail.kind !== "none") {
    const len = tail.length * k,
      angle = tail.lift * rad;
    const end = add(hips, [
      Math.sin((tail.sway ?? 0) * rad) * len * 0.4,
      Math.sin(angle) * len,
      -Math.cos(angle) * len,
    ]);
    const mid = add(hips, scale(sub(end, hips), 0.5));
    tube("tail", "body", [
      knot(hips, g * 0.65 * tail.girth),
      knot(add(mid, [0, g * 0.3, 0]), g * 0.33 * tail.girth),
      knot(end, g * 0.065),
    ]);
    if (p.details.includes("tail tuft"))
      detail("tail.tuft", "tail", end, [g * 0.72, g * 0.74, g * 1.18], skin.accent);
    if (tail.kind === "club") detail("tail.club", "tail", end, [g, g * 0.75, g * 1.23]);
    if (tail.kind === "fan" || tail.kind === "fluke")
      for (const side of [1, -1]) {
        tapered(
          "tail.fluke." + (side === 1 ? "l" : "r"),
          "tail",
          end,
          add(end, [side * g * 0.83, 0, -g * 0.36]),
          add(end, [side * g * 1.65, g * 0.12, -g * 0.78]),
          g * 0.55,
          skin.accent,
          0.19,
        );
      }
    if (tail.kind === "stinger")
      tapered(
        "tail.sting",
        "tail",
        end,
        add(end, [0, g * 0.28, -g * 0.4]),
        add(end, [0, g * 0.77, -g * 0.55]),
        g * 0.2,
        skin.pale,
      );
  }
  for (const ornament of ["mane", "belly plates", "shoulder spikes"] as const) {
    if (!p.details.includes(ornament)) continue;
    const count = ornament === "shoulder spikes" ? 1 : 5;
    for (let i = 0; i < count; i++) {
      const station = bodyStation(
        p,
        ornament === "mane"
          ? 0.72 + i * 0.05
          : ornament === "shoulder spikes"
            ? 0.77
            : 0.19 + i * 0.12,
      );
      if (ornament === "belly plates") {
        detail(
          "belly.plate." + i,
          "body",
          add(station.point, [0, -station.depth * 0.84, 0]),
          [station.width * 1.61, g * 0.34, p.spine.length * k * 0.17],
          skin.pale,
        );
        continue;
      }
      for (const side of [1, -1]) {
        const a = add(station.point, [side * station.width * 0.62, station.depth * 0.56, 0]);
        tapered(
          (ornament === "mane" ? "mane." : "shoulder.spike.") + i + (side === 1 ? ".l" : ".r"),
          "body",
          a,
          add(a, [side * g * 0.33, g * 0.33, -g * 0.2]),
          add(a, [side * g * 0.52, g * (ornament === "mane" ? -0.28 : 0.67), -g * 0.72]),
          g * (ornament === "mane" ? 0.43 : 0.21),
          ornament === "mane" ? skin.accent : skin.pale,
        );
      }
    }
  }
  if (p.back.kind !== "none")
    for (let i = 0; i < p.back.count; i++) {
      const s = bodyStation(p, (i + 1) / (p.back.count + 1)),
        a = add(s.point, [0, s.depth * 0.83, 0]),
        h = p.back.height * k * (0.7 + 0.45 * Math.sin((i / p.back.count) * Math.PI));
      const growth = p.back.kind;
      if (p.back.spread !== undefined) {
        const spread = p.back.spread,
          phase = ((p.back.seed ?? 0) % 71) * 0.08 + i * 0.74;
        if (growth === "spiral shell") {
          const angle = i * 2.4,
            radius = g * (0.15 + 0.56 * (1 - i / p.back.count));
          const s = bodyStation(p, 0.54);
          detail(
            "back.shell." + i,
            "body",
            add(s.point, [0, s.depth + Math.sin(angle) * radius, Math.cos(angle) * radius]),
            [g * (1.6 + spread), radius * 1.9 + h, radius * 1.9 + h],
            i % 2 === 0 ? skin.accent : skin.pale,
          );
        } else
          for (const side of [1, -1]) {
            const root = add(a, [side * s.width * (0.2 + 0.43 * spread), 0, 0]),
              id = "back." + i + "." + (side + 1);
            if (growth === "drum sacs" || growth === "shingles")
              detail(
                id,
                "body",
                root,
                [
                  g * (growth === "shingles" ? 1.24 : 0.84),
                  h * (growth === "shingles" ? 0.56 : 1.8),
                  g * (0.8 + spread * 0.5),
                ],
                i % 3 === 0 ? skin.pale : skin.accent,
              );
            else {
              const shag = growth === "shag mantle",
                plume = growth === "contour plumage";
              tapered(
                id,
                "body",
                root,
                add(root, [side * h * 0.33, h * 0.26, 0]),
                add(root, [
                  side * h * (0.4 + spread * 0.7),
                  h * (shag ? -0.84 : plume ? 0.1 : 1.34),
                  -h * (1.25 + 0.2 * Math.sin(phase)),
                ]),
                g * (shag ? 0.47 : 0.66),
                i % 2 === 0 ? skin.accent : skin.base,
                shag ? 0.68 : 0.26,
              );
            }
          }
        continue;
      }
      tapered(
        "back." + i,
        "body",
        a,
        add(a, [0, h * 0.65, -h * 0.17]),
        add(a, [0, h * 1.38, -h * 0.65]),
        g * (p.back.kind === "plates" ? 0.58 : 0.27),
        skin.accent,
        p.back.kind === "fins" ? 0.32 : 0.8,
      );
    }
  function limb(l: CreatureLimb, id: string, side: 1 | -1, t: number) {
    const point = limbSocket(p, l.kind, t, side);
    const reach = g * l.girth;
    if (l.kind === "fin") {
      const len = l.length * k,
        chord = l.chord * k,
        angle = l.sweep * rad;
      const mid = add(point, [side * len * 0.55, 0.045 * k, -len * Math.sin(angle) * 0.36]);
      const end = add(point, [side * len * Math.cos(angle), -0.055 * k, -len * Math.sin(angle)]);
      tube(
        id,
        "body",
        [
          knot(point, chord * 0.64, chord * 0.18),
          knot(mid, chord * 0.73, chord * 0.14),
          knot(end, chord * 0.045, chord * 0.04),
        ],
        skin.accent,
        {},
      );
    } else if (l.kind === "wing") {
      const len = l.length * k,
        rise = l.rise;
      const span: Vec3 = [
        side * len * Math.cos(l.sweep * rad) * Math.cos(rise * rad),
        len * Math.sin(rise * rad),
        -len * Math.sin(l.sweep * rad),
      ];
      if (l.structure === "plain") {
        tube(
          id,
          "body",
          [
            knot(point, l.chord * k * 0.47, 0.025 * k),
            knot(add(point, scale(span, 0.48)), l.chord * k * 0.56, 0.02 * k),
            knot(add(point, span), 0.008 * k, 0.004 * k),
          ],
          skin.accent,
          {},
        );
        return;
      }
      const w = wingSurface(l.structure, side, span, [0, -len * 0.09, -l.chord * k], skin, l.seed);
      const surface = {
        ...w,
        count: l.ribs,
        bend: l.bend,
        notch: l.notch,
        point: l.point,
        pattern: l.pattern,
      };
      part(id, "body", point, [1, 1, 1], skin.accent, { "figure.wing": surface });
    } else if (l.kind === "tentacle") {
      const len = l.length * k;
      tube(
        id,
        "body",
        Array.from({ length: 9 }, (_, j) => {
          const u = j / 8;
          return knot(
            add(point, [
              side * len * (0.22 * u + 0.3 * Math.sin(u * 2.7)),
              len * (-Math.sin(l.droop * rad) * u + 0.31 * l.curl * u * u),
              len *
                (Math.sin(l.forward * rad) * u +
                  ((0.5 - t) * u * l.fan) / 60 +
                  l.curl * u * u * 0.45),
            ]),
            reach * (0.34 * (1 - u) ** 0.68 + 0.008),
          );
        }),
      );
    } else {
      const leg = l.kind === "leg",
        insect = leg && l.style === "insect",
        length = leg ? Math.max(0.05, point[1]) : l.length * k;
      const hip = point;
      const wide = leg ? Math.tan(l.splay * rad) * length * 0.59 : length * 0.38;
      const foot = add(point, [
        side * (wide + reach * 0.52),
        leg ? -point[1] + reach * 0.12 : -length * Math.sin(l.drop * rad),
        leg ? (t - 0.5) * length * 0.36 : Math.sin(l.forward * rad) * length,
      ]);
      const knee = add(hip, [
        side * (insect ? wide * 1.45 + reach : wide * 0.72 + reach * 0.3),
        length * (insect ? 0.04 : -0.4),
        length *
          (leg
            ? l.style === "bird"
              ? 0.29
              : l.style === "pillar"
                ? 0.03
                : t < 0.5
                  ? 0.22
                  : -0.13
            : -0.36 * Math.sin(l.elbow * rad)),
      ]);
      const ankle = add(foot, [-side * wide * 0.07, length * 0.2, -length * 0.12]);
      const muscle =
        reach * (insect ? 0.24 : leg && l.style === "pillar" ? 0.6 : 0.42) * l.muscle + 0.004;
      tube(id, "body", [
        knot(hip, muscle * 0.84),
        knot(add(hip, scale(sub(knee, hip), 0.4)), muscle * 1.06),
        knot(knee, muscle * 0.56),
      ]);
      tube(id + ".shin", id, [
        knot(knee, muscle * 0.58),
        knot(add(knee, scale(sub(ankle, knee), 0.4)), muscle * 0.56),
        knot(ankle, muscle * 0.29),
        knot(foot, muscle * 0.23),
      ]);
      if (leg && p.details.includes("spurs")) {
        tapered(
          id + ".spur",
          id + ".shin",
          ankle,
          add(ankle, [0, reach * 0.18, -reach * 0.34]),
          add(ankle, [0, reach * 0.29, -reach * 0.6]),
          reach * 0.15,
          skin.pale,
        );
      }
      if (l.end === "pincer" || l.end === "spike") {
        for (const digit of l.end === "pincer" ? [-1, 1] : [0]) {
          const a = add(foot, [digit * reach * 0.15, 0, 0]),
            b = add(foot, [digit * reach * 0.42, reach * 0.08, reach * 0.56]),
            c = add(foot, [digit * reach * 0.19, reach * 0.18, reach * 1.08]);
          tapered(id + ".tip." + (digit + 1), id + ".shin", a, b, c, reach * 0.2, skin.pale);
        }
      } else if (l.end !== "point" && l.end !== "none") {
        const radius = reach * (leg ? 0.38 : 0.32);
        detail(
          id + ".pad",
          id + ".shin",
          foot,
          [
            radius * (l.end === "paddle" ? 2.75 : 1.6),
            radius * (l.end === "paddle" ? 0.48 : 0.85),
            radius * (l.end === "paddle" ? 3.6 : 2.1),
          ],
          l.end === "hoof" ? skin.pale : skin.base,
        );
        if (l.end !== "hoof" && l.end !== "pad")
          for (let j = 0; j < l.digits; j++) {
            const spread = (j - (l.digits - 1) / 2) * radius * 0.36;
            tapered(
              id + ".digit." + j,
              id + ".pad",
              add(foot, [spread * 0.62, 0, radius * 0.4]),
              add(foot, [spread * 1.2, -radius * 0.1, radius * 1.15]),
              add(foot, [spread * 1.55, -radius * 0.2, radius * 1.8]),
              radius * 0.25,
              skin.pale,
            );
          }
      }
    }
  }
  p.limbs.forEach((l, index) => {
    for (let j = 0; j < l.pairs; j++) {
      const t =
        l.pairs === 1 ? (l.from + l.to) / 2 : l.from + ((l.to - l.from) * j) / (l.pairs - 1);
      for (const side of [1, -1] as const)
        if (l.side === "both" || l.side === (side === 1 ? "left" : "right"))
          limb(l, l.kind + "." + index + "." + j + "." + (side === 1 ? "l" : "r"), side, t);
    }
  });

  if (p.dress) {
    const dress = p.dress;
    if (dress.device) {
      const s = bodyStation(p, 0.66),
        at = add(s.point, [s.width * 1.05, -g * 0.12, 0]);
      const count = { swallow: 2, oak: 3, sunburst: 8, tide: 4, compass: 4 }[dress.device];
      detail("dress.badge", "body", at, [g * 0.14, g * 0.46, g * 0.46], dress.trim);
      for (let j = 0; j < count; j++) {
        const angle = (j * Math.PI * 2) / count,
          pos = add(at, [g * 0.07, g * 0.18 * Math.cos(angle), g * 0.18 * Math.sin(angle)]);
        detail("dress.badge." + j, "dress.badge", pos, [g * 0.07, g * 0.14, g * 0.14], dress.color);
      }
    }
    for (let i = 0; i < dress.layers; i++) {
      const t = 0.7 - i * 0.075,
        s = bodyStation(p, t),
        size = dress.size;
      const at = add(s.point, [0, s.depth * 0.63, 0]);
      part("dress." + i, "body", at, [1, 1, 1], i % 2 === 0 ? dress.color : dress.trim, {
        "figure.finish": { surface: dress.kind === "warden" ? "metal" : "canvas" },
        "figure.mantle": {
          cut: {
            kind: dress.kind === "herald" ? "Tabard" : dress.kind === "sage" ? "Poncho" : "Cape",
            width: s.width * 2.28,
            depth: k * p.spine.length * 0.87,
            drop: Math.max(0.03, g * (1.1 + i * 0.24) * size),
            flare: 1.16,
            opening: 55,
            folds: 5 + i,
          },
        },
      });
    }
  }
  if (p.equipment && p.equipment.kind !== "none") {
    const kit = p.equipment,
      s = bodyStation(p, kit.station),
      size = g * kit.size;
    for (const side of [1, -1]) {
      if (kit.kind !== "trader panniers" && side !== (kit.side === "left" ? 1 : -1)) continue;
      const id = "pack." + (side === 1 ? "l" : "r"),
        at = add(s.point, [
          side * s.width * (kit.mount === "back" ? 0.45 : 0.94),
          s.depth * (kit.mount === "back" ? 1.07 : kit.hang),
          0,
        ]);
      part(id, "body", at, [size * 0.74, size * 1.15, size * 1.48], kit.color, {
        "figure.finish": { surface: "leather" },
      });
      part(
        id + ".flap",
        id,
        add(at, [side * size * 0.24, size * 0.24, 0]),
        [size * 0.34, size * 0.62, size * 1.33],
        skin.pale,
        { "figure.finish": { surface: "leather" } },
      );
      detail(
        id + ".buckle",
        id,
        add(at, [side * size * 0.44, size * 0.03, 0]),
        [size * 0.09, size * 0.24, size * 0.27],
        skin.accent,
      );
      const a = add(at, [0, size * 0.45, 0]),
        b = add(s.point, [side * s.width * 0.65, s.depth * 0.85, 0]),
        c = add(s.point, [0, s.depth, 0]);
      tube(
        id + ".strap",
        "body",
        [knot(a, size * 0.11), knot(b, size * 0.1), knot(c, size * 0.08)],
        kit.color,
        { "figure.finish": { surface: "leather" } },
      );
    }
  }
  return slots;
}
