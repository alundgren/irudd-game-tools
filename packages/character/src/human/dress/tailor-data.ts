export type TailorField =
  | { readonly type: "colour"; readonly value: string; readonly label: string }
  | {
      readonly type: "range";
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly value: number;
      readonly step: number;
    }
  | {
      readonly type: "choice";
      readonly label: string;
      readonly options: ReadonlyArray<string>;
      readonly value: string;
    };

const colour = (value: string, label = "Colour"): TailorField => ({ type: "colour", value, label });
const range = (
  label: string,
  min: number,
  max: number,
  value: number,
  step = (max - min) / 100,
): TailorField => ({
  type: "range",
  label,
  min,
  max,
  value,
  step,
});
const choice = (
  label: string,
  options: ReadonlyArray<string>,
  value = options[0] ?? "",
): TailorField => ({
  type: "choice",
  label,
  options,
  value,
});

export interface TailorPiece {
  readonly label: string;
  readonly fields: Readonly<Record<string, TailorField>>;
}

export const tailorPieces: Readonly<Record<string, TailorPiece>> = {
  top: {
    label: "Top or jacket",
    fields: {
      color: colour("#6f7f86"),
      material: choice("Material", ["cloth", "leather", "mail"]),
      sleeve: range("Sleeve end (0 shoulder, 1 elbow, 2 wrist)", 0.05, 1.97, 0.5),
      length: range("Hem (0 waist, 1 seat)", 0, 1, 0.6),
      ease: range("Room over the body, mm", 2, 40, 8, 1),
      stiff: range("Structure (0 soft, 1 holds its shape)", 0, 1, 0.2),
      neck: choice("Neckline", ["crew", "v", "scoop", "high"]),
      depth: range("Neck opening depth, mm", 0, 260, 60, 5),
      collar: choice("Collar", ["none", "shirt", "stand", "hood"]),
      front: choice("Front", ["plain", "placket", "zip", "buttons"]),
      buttons: range("Buttons", 0, 8, 4, 1),
      cuff: range("Cuff band, mm", 0, 60, 16, 1),
      hemBand: range("Hem band, mm", 0, 70, 16, 1),
      gather: range("Hem drawn in (0 hangs free, 1 snug)", 0, 1, 0),
      pockets: choice("Pockets", ["none", "chest", "hip", "chest and hip"]),
      trim: colour("#8f9296", "Buttons and zip"),
    },
  },
  trousers: {
    label: "Trousers or shorts",
    fields: {
      color: colour("#3c4656"),
      material: choice("Material", ["cloth", "leather"]),
      length: range("Leg end (1 knee, 2 ankle)", 0.3, 2.03, 2.03),
      rise: range("Waistband (0 low, 1 natural waist)", 0, 1, 0.55),
      ease: range("Room over the body, mm", 2, 40, 9, 1),
      fit: range("Leg shape (0 straight, 1 follows the leg)", 0, 1, 0.15),
      waistband: range("Waistband, mm", 0, 60, 32, 1),
      hemBand: range("Leg hem, mm", 0, 60, 14, 1),
      pockets: choice("Pockets", ["none", "back", "cargo", "back and cargo"]),
    },
  },
  boots: {
    label: "Boots",
    fields: {
      color: colour("#5b4334"),
      sole: colour("#2c2a28", "Sole"),
      material: choice("Material", ["leather", "cloth"]),
      fastening: choice("Shaft fastening", ["plain", "buckled"]),
      height: range("Top of the shaft (1 knee, 2 ankle)", 1.05, 1.9, 1.5),
      ease: range("Room over the leg, mm", 3, 40, 11, 1),
      straight: range("Shaft (0 follows the calf, 1 straight tube)", 0, 1, 0.5),
      cuff: range("Top band, mm", 0, 70, 40, 1),
      thick: range("Sole, mm", 4, 40, 15, 1),
      heel: range("Heel, mm", 0, 70, 8, 1),
      toe: range("Toe room, mm", 0, 20, 0, 1),
    },
  },
  shoes: {
    label: "Shoes",
    fields: {
      color: colour("#5b4334"),
      sole: colour("#2c2a28", "Sole"),
      material: choice("Material", ["leather", "cloth"]),
      collar: range("Height at the ankle, mm", 30, 140, 58, 1),
      thick: range("Sole, mm", 4, 40, 11, 1),
      heel: range("Heel, mm", 0, 70, 0, 1),
      toe: range("Toe room, mm", 0, 20, 0, 1),
    },
  },
  gloves: {
    label: "Gloves",
    fields: {
      color: colour("#7c8a6c"),
      material: choice("Material", ["leather", "cloth"]),
      from: range("Cuff (1 elbow, 2 wrist)", 1.3, 1.97, 1.86),
      ease: range("Room over the hand, mm", 2, 12, 4, 1),
      cuff: range("Cuff band, mm", 0, 50, 0, 1),
    },
  },
  belt: {
    label: "Belt",
    fields: {
      color: colour("#4a3a2c"),
      material: choice("Material", ["leather", "cloth"]),
      at: range("Height (0 hip band, 1 natural waist)", 0, 1, 0.5),
      height: range("Width, mm", 15, 70, 34, 1),
      buckle: choice("Buckle", ["frame", "none"]),
      trim: colour("#8f9296", "Buckle"),
    },
  },
};
export const tailorLimit = 12;

export type TailorLayer = { readonly piece: string } & Readonly<Record<string, string | number>>;
export interface Tailor {
  readonly layers: ReadonlyArray<TailorLayer>;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const own = (o: object, key: string) => Object.hasOwn(o, key);

export function tailorLayer(
  piece: string,
  values: Readonly<Record<string, string | number>> = {},
): TailorLayer {
  const spec = own(tailorPieces, piece) ? tailorPieces[piece] : undefined;
  if (!spec) throw new Error("Unknown outfit piece.");
  return {
    ...Object.fromEntries(Object.entries(spec.fields).map(([key, field]) => [key, field.value])),
    ...values,
    piece,
  };
}

export function tailorProblems(tailor: unknown): string[] {
  if (!isRecord(tailor) || Object.keys(tailor).some((key) => key !== "layers"))
    return ["Use an object containing layers."];
  const layers = tailor["layers"];
  if (!Array.isArray(layers) || !layers.length || layers.length > tailorLimit)
    return ["Choose between 1 and " + tailorLimit + " outfit layers."];
  const problems: string[] = [];
  for (const [index, layer] of layers.entries()) {
    const piece = isRecord(layer) ? layer["piece"] : undefined;
    const spec =
      typeof piece === "string" && own(tailorPieces, piece) ? tailorPieces[piece] : undefined;
    if (!isRecord(layer) || !spec || typeof piece !== "string") {
      problems.push("Layer " + (index + 1) + " needs a known outfit piece.");
      continue;
    }
    const fields = spec.fields;
    for (const [key, value] of Object.entries(layer)) {
      if (key === "piece") continue;
      const label = piece + "." + key;
      const field = own(fields, key) ? fields[key] : undefined;
      if (!field) {
        problems.push(
          label +
            " is unavailable. Fields for " +
            piece +
            " are " +
            Object.keys(fields).join(", ") +
            ".",
        );
        continue;
      }
      if (field.type === "colour") {
        if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
          problems.push(label + " needs a six-digit hex colour.");
      } else if (field.type === "choice") {
        if (typeof value !== "string" || !field.options.includes(value))
          problems.push(label + " accepts " + field.options.join(", ") + ".");
      } else if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < field.min ||
        value > field.max
      ) {
        problems.push(label + " must be between " + field.min + " and " + field.max + ".");
      }
    }
  }
  return problems;
}

export function readTailor(tailor: unknown): Tailor | undefined {
  if (tailorProblems(tailor).length || !isRecord(tailor)) return undefined;
  const layers = tailor["layers"];
  if (!Array.isArray(layers)) return undefined;
  return {
    layers: layers.filter(isRecord).map((layer) => {
      const values: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(layer))
        if (typeof value === "string" || typeof value === "number") values[key] = value;
      return tailorLayer(String(layer["piece"]), values);
    }),
  };
}

export function defaultTailor(clothColor = "#6f7f86"): Tailor {
  return {
    layers: [
      tailorLayer("trousers"),
      tailorLayer("top", {
        color: clothColor,
        sleeve: 1.42,
        collar: "shirt",
        front: "buttons",
        neck: "v",
        depth: 50,
      }),
      tailorLayer("belt"),
      tailorLayer("shoes"),
    ],
  };
}
