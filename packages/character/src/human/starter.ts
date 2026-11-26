// The adult human as a host starter: the generator over a loaded body pack,
// named presets from frozen seeds and the seeded draw. A host registers
// `generator` and offers `starter`; both hold the same generator object, which
// is how a host tells a starter's generator is the one it registered.

import type { GeneratorDefinition, Json } from "@irudd/document";
import type { HumanBody } from "./body.js";
import { humanAdultGenerator, seededHumanAdult } from "./generator.js";
import { dressedAdult, humanLooks } from "./looks.js";

export interface HumanStarterPreset {
  readonly id: string;
  readonly label: string;
  readonly params: Json;
}

/** The shape of a workshop host's generator starter. */
export interface HumanStarter {
  readonly id: string;
  readonly label: string;
  readonly generator: GeneratorDefinition;
  readonly reference: boolean;
  readonly description: string;
  readonly presets: ReadonlyArray<HumanStarterPreset>;
  readonly seed: (seed: number) => Json;
}

const presetSeeds = [
  [491, "Hip-shot, grey eyes"],
  [8950, "Inked arm, untrimmed brows"],
  [8990, "Brisk, engraved sleeve"],
  [716973847, "Older, slouched"],
] as const;

export function humanAdultStarter(body: HumanBody): {
  readonly generator: GeneratorDefinition;
  readonly starter: HumanStarter;
} {
  const generator = humanAdultGenerator(body);
  return {
    generator,
    starter: {
      id: "human-adult",
      label: "Adult human",
      generator,
      reference: false,
      description:
        "An ordinary adult body: measurements, posture, skin and eye colour, brows, arm ink, complexion and face marks drawn as the reference workshop's seeded adult does, and dressed looks with a tailored outfit, hair and accessories. Every value is an editable parameter; the 52 body regions are parts that keep manual edits when the parameters are steered.",
      presets: [
        ...presetSeeds.map(([seed, label]) => ({
          id: `seed-${seed}`,
          label,
          params: seededHumanAdult(body, seed),
        })),
        ...humanLooks.map((look) => ({
          id: look.id,
          label: look.label,
          params: dressedAdult(seededHumanAdult(body, look.seed), look),
        })),
      ],
      seed: (seed) => seededHumanAdult(body, seed),
    },
  };
}
