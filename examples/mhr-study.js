import { buildFigure } from "../character-view/figure.js";
import { mhrFit as fit } from "./local-references.js";

export function mhrStudy(radialFit = fit) {
  const form = buildFigure({
    height: 1.727,
    archetype: "neutral",
    hair: "Bald",
    heads: 7.5,
    shoulderRise: 0.049,
    shoulders: 1.01,
    chest: 1.16,
    waist: 1.22,
    hips: 1.27,
    limbs: 1.1,
    pelvisDepth: 1.13,
    ribDepth: 1.1,
    legs: 1.012,
    stance: { arms: 43, forearmSpread: 62, elbows: 32, feet: 1.62 },
  });
  if (radialFit?.rows)
    form.parts.find((p) => p.id === "body").radialFit =
      structuredClone(radialFit);
  return form;
}
export const mhrStudies = fit
  ? [
      {
        id: "mhr-torso",
        title: "Momentum Human Rig · measured torso",
        game: "3D reference",
        make: () => mhrStudy(),
        source: "https://github.com/facebookresearch/MHR",
        angle: "Front",
      },
    ]
  : [];
