import {
  decodeWith,
  figureScapulaMount,
  type CharacterDocument,
  type FigureWing,
} from "@irudd/document";
import { type HumanBody } from "../human/body.js";
import {
  humanAdultId,
  HumanAdultParams,
  humanMeasurements,
  humanSlot,
} from "../human/generator.js";
import { scapulaSocket } from "../human/sockets.js";
import { evaluateHuman } from "../human/surface.js";
const adultWingArms = {
  bat: [
    [0, 0, 0, 0.03648, 0.03648],
    [0.12681, 0.01263, -0.12616, 0.02918, 0.02918],
    [0.26896, 0.17012, -0.24344, 0.02334, 0.02334],
    [0.45605, 0.23085, -0.36773, 0.01226, 0.01226],
    [0.66727, 0.24125, -0.48662, 0.00379, 0.00379],
  ],
  feather: [
    [0, 0, 0, 0.04936, 0.04936],
    [0.13886, 0.01807, -0.13734, 0.04085, 0.04085],
    [0.2756, 0.17278, -0.24821, 0.03132, 0.03132],
    [0.41035, 0.19443, -0.34307, 0.0143, 0.0143],
    [0.53119, 0.22798, -0.41293, 0.00477, 0.00477],
    [0.64927, 0.25291, -0.47554, 0.0017, 0.0017],
  ],
  insect: [
    [0, 0, 0, 0.00955, 0.00955],
    [0.17281, 0.10327, -0.16659, 0.00801, 0.00801],
    [0.39565, 0.19229, -0.33372, 0.00554, 0.00554],
    [0.6617, 0.26575, -0.48075, 0.00154, 0.00154],
  ],
} as const;

function mixTone(a: string, b: string, t: number) {
  return (
    "#" +
    [1, 3, 5]
      .map((i) => {
        const x = parseInt(a.slice(i, i + 2), 16);
        const y = parseInt(b.slice(i, i + 2), 16);
        return Math.round(x + (y - x) * t)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}

export function mountWings(
  doc: CharacterDocument,
  body: HumanBody,
  structure: FigureWing["structure"],
  length: number,
  color: string,
  seed: number,
) {
  const g = doc.generation;
  const params = g?.generator === humanAdultId && decodeWith(HumanAdultParams, g.params);
  const chest = doc.parts.find((p) => p.slot === humanSlot("spine_03"));
  if (!params || !params.ok || !chest) throw new Error("Choose an editable adult with a chest.");
  const surface = evaluateHuman(body, humanMeasurements(params.value));
  return ([1, -1] as const).flatMap((side): object[] => {
    const rise = Math.PI / 10,
      sweep = Math.PI / 5;
    const chord = (length * 0.31) / 0.86;
    const base = "#665745",
      pale = "#d5c3a0";
    const insect = structure === "insect";
    const limb = insect ? mixTone(base, "#000000", 0.35) : base;
    const wing: FigureWing = {
      structure,
      side,
      span: [
        side * length * Math.cos(rise) * Math.cos(sweep),
        length * Math.sin(rise),
        -length * Math.cos(rise) * Math.sin(sweep),
      ],
      back: [0, -chord * 1.15 * Math.cos(0.077), -chord * 1.15 * Math.sin(0.077)],
      bone:
        { bat: 0.036, feather: 0.042, insect: 0.019 }[structure] * (0.6 * length + 0.95 * chord),
      bend: 0.35,
      count: { bat: 4, feather: 9, insect: 5 }[structure],
      notch: 0.4,
      point: 0.5,
      pattern: "tips",
      seed,
      dark: mixTone(structure === "feather" ? mixTone(color, base, 0.3) : color, "#000000", 0.62),
      pale,
      limb,
    };
    const arm = doc.parts.find(
      (p) =>
        p.parent === chest.id &&
        figureScapulaMount.read(p.features)?.side === side &&
        (p.features["figure.wing"] || p.features["figure.sweep"]),
    );
    const armId = arm?.id ?? "p-" + crypto.randomUUID();
    const film = doc.parts.find((p) => p.parent === armId && p.features["figure.wing"]);
    const identity = { shape: "ellipsoid", size: [1, 1, 1], rotation: [0, 0, 0, 1], sculpt: [] };
    const name = side === 1 ? "Left wing" : "Right wing";
    const { "figure.wing": _legacy, ...features } = arm?.features ?? {};
    return [
      {
        op: arm ? "part.replace" : "part.add",
        part: {
          ...identity,
          id: armId,
          label: name,
          position: scapulaSocket(surface, side),
          parent: chest.id,
          ...arm,
          color: limb,
          features: {
            ...features,
            "figure.scapula-mount": { side },
            "figure.sweep": {
              knots: adultWingArms[structure].map(([x, y, z, w, d]) =>
                [side * x, y, z, w, d].map((v) => (v * length) / 0.86),
              ),
            },
            "motion.role": { role: "wing" },
            "figure.finish": { surface: insect ? "plain" : "scales" },
          },
        },
      },
      {
        op: film ? "part.replace" : "part.add",
        part: {
          ...identity,
          parent: armId,
          id: "p-" + crypto.randomUUID(),
          label: name + " surface",
          position: [0, 0, 0],
          ...film,
          color: insect ? mixTone(color, pale, 0.55) : color,
          features: { ...film?.features, "figure.wing": wing, "motion.role": { role: "rigid" } },
        },
      },
    ];
  });
}
