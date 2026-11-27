import { cuirass } from "./cuirass.js";
import { mantle } from "./mantle.js";
import { pod } from "./gear.js";
import { Piece, type DressBody, type Landmarks, Shell, mix, smooth, type Vec } from "./kit.js";
import type { TailorLayer } from "./tailor-data.js";
export type { TailoredPart } from "./armour-types.js";
import type { TailoredPart } from "./armour-types.js";
import { pauldrons, armguards, legguards, tassets } from "./guards.js";
export function fitArmour(
  body: DressBody,
  m: Landmarks,
  layer: TailorLayer,
  under: readonly Shell[],
  prior: readonly TailoredPart[],
): TailoredPart[] {
  const parts: TailoredPart[] = [];
  const k = m.k,
    tone = String(layer["color"]),
    trim = String(layer["trim"]);
  const material =
    layer["material"] === "leather"
      ? "leather"
      : layer["material"] === "lacquer"
        ? "satin"
        : "metal";
  const finish = (piece: Piece, name: string, region: string, tone: string, type = material) =>
    parts.push({ piece, tone, region, name, type });
  const length = Number(layer["length"] ?? 0.6);
  const surfaces = [...under, ...prior.map((p) => p.piece)];
  switch (layer.piece) {
    case "travellingMantle": {
      const side = layer["shoulder"] === "right" ? 1 : -1;
      const shortDrop = m.neck[1] - m.chest[1] + 0.045 * k;
      const longDrop = m.neck[1] - m.waist + (0.1 + 0.32 * length) * k;
      const surfaces = [
        ...under,
        ...prior.map(({ piece }) => {
          const shell = new Shell();
          shell.pos = piece.pos;
          shell.tri = piece.tri;
          return shell;
        }),
      ];
      const cut = mantle(body, m, surfaces, {
        open: (v) => 0.4 + 1.28 * v,
        swing: (v) => -side * (0.28 + 0.83 * v),
        drop: (a, direction) =>
          mix(
            shortDrop,
            longDrop,
            smooth(0.74, 2.45, a) * (0.91 + 0.09 * side * direction * Math.sin(a)) +
              0.12 * Math.max(0, side * direction * Math.sin(a)) ** 2,
          ),
        facing: 0.065,
        ease: 0.018,
        fold: 0.039,
        flare: 0.016,
        armLow: m.shoulder - 0.19 * k,
        cols: 54,
      });
      const metal = new Piece(),
        pin = cut.at(0.21, side, 0.004 * k);
      const skin = body.rigid("spine_03");
      const rings = [];
      for (let j = 0; j <= 22; j++) {
        const a = mix(0.36, 2 * Math.PI - 0.36, j / 22),
          x = Math.sin(a),
          y = -Math.cos(a);
        rings.push(
          Array.from({ length: 6 }, (_, n): Vec => {
            const u = (2 * Math.PI * n) / 6,
              radius = (0.023 + 0.0038 * Math.cos(u)) * k;
            return [pin[0] + x * radius, pin[1] + y * radius, pin[2] + 0.0038 * k * Math.sin(u)];
          }),
        );
      }
      metal.loft(rings, skin, { capStart: true, capEnd: true });
      pod(
        metal,
        pin,
        [
          [0.004 * k, -0.001 * k, 0],
          [0.01 * k, 0.027 * k, 0],
          [0, 0, 0.004 * k],
        ],
        skin,
      );
      parts.push({
        piece: cut.cloth,
        name: "Travelling mantle",
        region: "spine_03",
        tone,
        type: "cloth",
        mantleFinish: layer,
      });
      finish(cut.lining, "Wool facing", "spine_03", trim, "cloth");
      finish(metal, "Mantle brooch", "spine_03", String(layer["clasp"] ?? trim), "metal");
      break;
    }
    case "cuirass":
      return cuirass(body, m, layer, under);
    case "tassets":
      return tassets(body, m, layer, surfaces, prior.findLast((p) => p.hem !== undefined)?.hem);
    case "pauldrons":
      return pauldrons(body, m, layer, surfaces).map((p) =>
        p.piece.plateUV ? { ...p, stamping: layer } : p,
      );
    case "armguards":
      return armguards(body, m, layer, surfaces).map((p) =>
        p.piece.plateUV ? { ...p, stamping: layer } : p,
      );
    case "legguards":
      return legguards(body, m, layer, surfaces).map((p) =>
        p.piece.plateUV ? { ...p, stamping: layer } : p,
      );
  }
  return parts;
}
