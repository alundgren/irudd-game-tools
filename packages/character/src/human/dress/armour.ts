import { context2d, type Raster } from "../../raster.js";
import * as T from "three";
import { Piece, Envelope, type DressBody, type Landmarks, type Shell, type Vec } from "./kit.js";
import type { TailorLayer } from "./tailor-data.js";
export interface TailoredPart {
  readonly piece: Piece;
  readonly tone: string;
  readonly region: string;
  readonly name: string;
  readonly type: string;
  readonly ground?: number;
}

export function fitArmour(
  body: DressBody,
  m: Landmarks,
  layer: TailorLayer,
  under: readonly Shell[],
  prior: readonly TailoredPart[],
): TailoredPart[] {
  const parts: TailoredPart[] = [];
  const samples: { point: Vec; bone: string }[] = [];
  function record(
    point: Vec,
    bones: ArrayLike<number>,
    weights: ArrayLike<number>,
    offset: number,
  ) {
    let major = offset;
    for (let i = offset + 1; i < offset + 4; i++)
      if ((weights[i] ?? 0) > (weights[major] ?? 0)) major = i;
    samples.push({ point, bone: body.names[bones[major] ?? 0] ?? "" });
  }
  for (let i = 0; i < body.count; i++) {
    const [bones, weights] = body.skinOf(i);
    record(body.point(i), bones, weights, 0);
  }
  for (const item of [...under, ...prior.map((p) => p.piece)]) {
    for (let i = 0; i < item.count; i++)
      record(
        [item.pos[i * 3] ?? 0, item.pos[i * 3 + 1] ?? 0, item.pos[i * 3 + 2] ?? 0],
        item.bones,
        item.weights,
        i * 4,
      );
  }
  const k = m.k,
    tone = String(layer["color"]),
    trim = String(layer["trim"]);
  const length = Number(layer["length"]),
    room = Number(layer["room"]) * 0.001 * k;
  function shell(
    bone: string,
    start: Vec,
    end: Vec,
    lo: number,
    hi: number,
    radius: number,
    name: string,
    shoulder = false,
  ) {
    const a = new T.Vector3(...start),
      b = new T.Vector3(...end),
      axis = b.clone().sub(a).normalize();
    const distance = a.distanceTo(b);
    const env = new Envelope(start, axis.toArray(), lo * distance, hi * distance, 16, 48);
    const region =
      bone === "pelvis"
        ? /^(pelvis|spine|thigh)/
        : bone === "spine_03"
          ? /^(pelvis|spine|clavicle|neck)/
          : new RegExp("^" + bone + "$");
    const near = samples
      .filter((s) => region.test(s.bone))
      .map((s) => s.point)
      .filter((p) => {
        const [h, x, y] = env.local(p);
        return (
          h > lo * distance - 0.025 * k &&
          h < hi * distance + 0.025 * k &&
          Math.hypot(x, y) < radius * 2.05 * k
        );
      });
    env.measure(near).taut(1.2).soften(3);
    const shell = new Piece(),
      border = new Piece(),
      weight = body.rigid(bone);
    function surface(t: number, angle: number, edge: number): Vec {
      const u = (t - lo) / (hi - lo);
      const h = distance * t + (shoulder ? 0.022 * k * (1 - u) * Math.cos(angle) : 0);
      const ridge = (0.5 + 0.5 * Math.cos(4 * angle)) ** 4 * 0.005 * k * Math.sin(Math.PI * u);
      return env.point(h, angle, env.sample(h, angle) + room + edge + ridge);
    }
    function ring(t: number, edge: number): Vec[] {
      return Array.from({ length: 48 }, (_, j) => surface(t, (-j * 2 * Math.PI) / 48, edge));
    }
    if (layer.piece === "tassets") {
      for (const side of [-1, 1])
        for (const centre of [0.52, 1.45, 2.55]) {
          const span = centre === 0.52 ? 0.8 : 0.68;
          for (let band = 0; band < 3; band++) {
            const section = (v: number, thickness: number) =>
              Array.from({ length: 13 }, (_, j) => {
                const across = j / 12,
                  angle = side * centre + (0.5 - across) * span;
                const lower = hi - 0.035 * (centre + 3 * (across - 0.5) ** 2);
                const t = lo + ((lower - lo) * (band + v)) / 3;
                return surface(t, angle, (band * 0.003 + v * 0.0025 + thickness) * k);
              });
            shell.slab(
              [section(0, 0), section(0.55, 0), section(1, 0)],
              [section(0, -0.0025), section(0.55, -0.0025), section(1, -0.0025)],
              weight,
            );
            border.slab(
              [section(0.91, 0.0008), section(1, 0.0008)],
              [section(0.91, -0.001), section(1, -0.001)],
              weight,
            );
          }
        }
    } else {
      const rows = Array.from({ length: 15 }, (_, i) => ring(lo + ((hi - lo) * i) / 14, 0));
      shell.loft(rows, weight, { capStart: shoulder });
      for (const t of [lo + 0.025, hi])
        border.loft([ring(t - 0.015, 0.0018 * k), ring(t, 0.002 * k)], weight);
    }
    parts.push(
      {
        piece: shell,
        tone,
        region: bone,
        name,
        type: layer["material"] === "leather" ? "leather" : "metal",
      },
      {
        piece: border,
        tone: trim,
        region: bone,
        name: name + " edging",
        type: "metal",
      },
    );
  }
  switch (layer.piece) {
    case "travellingMantle": {
      const depth = (0.38 + 0.36 * length) * k,
        top = m.neck[1] + 0.012 * k,
        neck: Vec = [m.neck[0], top, m.neck[2]];
      const env = new Envelope(neck, [0, -1, 0], 0, depth, 28, 64);
      env
        .measure(
          samples
            .map((s) => s.point)
            .filter(
              (p) =>
                p[1] > top - depth - 0.015 * k &&
                p[1] < top + 0.025 * k &&
                (p[1] > m.shoulder - 0.12 * k || Math.abs(p[0]) < m.shoulderWidth * 1.12),
            ),
        )
        .taut(1)
        .hang(0.02, 1)
        .soften(3);
      const cloth = new Piece(),
        border = new Piece();
      const sample = (u: number, frac: number, extra: number) => {
        const gap = 0.12 + 0.72 * u,
          angle = gap + frac * (2 * Math.PI - 2 * gap) + 0.38 * (1 - u);
        const h = u * depth * (0.55 - 0.4 * Math.cos(angle));
        const fold = k * (0.006 + 0.009 * Math.cos(10 * angle + u)) * u;
        const r = env.sample(h, angle) + room + fold + (0.014 + 0.035 * u) * k + extra;
        return env.point(h, angle, r);
      };
      const grid = (u: number, extra: number) =>
        Array.from({ length: 55 }, (_, j) => sample(u, j / 54, extra));
      const rings = Array.from({ length: 25 }, (_, i) => grid(i / 24, 0));
      cloth.slab(
        rings,
        Array.from({ length: 25 }, (_, i) => grid(i / 24, -0.003 * k)),
        (p) => body.trunkAt(p),
      );
      border.slab(
        [grid(0.972, 0.001 * k), grid(1, 0.001 * k)],
        [grid(0.972, -0.002 * k), grid(1, -0.002 * k)],
        (p) => body.trunkAt(p),
      );
      return [
        { piece: cloth, tone, region: "spine_03", name: "Travelling mantle", type: "cloth" },
        { piece: border, tone: trim, region: "spine_03", name: "Mantle facing", type: "cloth" },
      ];
    }
    case "cuirass":
      shell(
        "spine_03",
        m.neck,
        [0, m.belly - 0.06 * k, m.chest[2]],
        0.18,
        0.68 + length * 0.3,
        0.16,
        "Cuirass",
      );
      break;
    case "tassets":
      shell(
        "pelvis",
        [0, m.waistband, m.pelvis[2]],
        [0, m.hip - 0.21 * k, m.pelvis[2]],
        0,
        0.45 + length * 0.55,
        0.18,
        "Hip plates",
      );
      break;
    default:
      for (const side of ["l", "r"]) {
        const shoulder = layer.piece === "pauldrons",
          leg = layer.piece === "legguards";
        const bone = (shoulder ? "upperarm_" : leg ? "calf_" : "lowerarm_") + side;
        const tip = (shoulder ? "lowerarm_" : leg ? "foot_" : "hand_") + side;
        shell(
          bone,
          body.joint(bone),
          body.joint(tip),
          shoulder ? 0 : 0.1,
          shoulder ? 0.2 + length * 0.25 : 0.55 + length * 0.4,
          leg ? 0.07 : 0.055,
          shoulder ? "Pauldron" : leg ? "Greave" : "Vambrace",
          shoulder,
        );
      }
  }
  return parts;
}
export function finishMail(mesh: T.Mesh, raster: Raster) {
  const canvas = raster.canvas(64, 64),
    ctx = context2d(canvas);
  ctx.fillStyle = "#393e40";
  ctx.fillRect(0, 0, 64, 64);
  for (let row = -1; row <= 4; row++)
    for (let col = -1; col <= 4; col++) {
      const x = col * 16 + (row % 2) * 8,
        y = row * 16;
      for (const [dy, colour] of [
        [2, "#31373b"],
        [0, "#a8afb1"],
      ] as const) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(x, y + dy, 8, 10, row % 2 ? 0.45 : -0.45, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace;
  const pos = mesh.geometry.getAttribute("position"),
    uv: number[] = [];
  for (let i = 0; i < pos.count; i++)
    uv.push((pos.getX(i) + 0.45 * pos.getZ(i)) * 22, pos.getY(i) * 22);
  mesh.geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  if (mesh.material instanceof T.MeshStandardMaterial) {
    const mail = mesh.material.clone();
    mail.map = texture;
    mail.metalness = 0.65;
    mail.roughness = 0.38;
    mail.addEventListener("dispose", () => texture.dispose());
    mesh.material = mail;
  }
}
